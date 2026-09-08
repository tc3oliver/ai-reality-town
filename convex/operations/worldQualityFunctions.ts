/**
 * The operator read surface for FR-M002's world-quality evaluators (ART-58).
 *
 * ## Why this is in `operations` and not in `quality`
 *
 * The same reason `productAnalyticsFunctions.ts` is in `operations` and not in `analytics`: the
 * gate lives here. `requireOperator` reads the deployment's operator registry, and `quality` is
 * a pure module listed in `canonWriteBoundary.forbiddenModules` — it must not be able to reach the
 * console's authorization any more than it can reach a Canon write. So the evaluator computes,
 * this file reads evidence rows and applies the gate, and neither knows the other's tables.
 *
 * ## READ-ONLY, gated on `world.inspect`
 *
 * Reused rather than minted, for the reason ART-47 and ART-133 reused `schedule.inspect`: a
 * capability is a decision about the operator role model, and this file reports numbers. It is
 * `world.inspect` and not `schedule.inspect` because that is the capability the FR-K002 proposal
 * review already uses for the same class of evidence — accepted history and its validation.
 *
 * ## Why an operator gate at all
 *
 * The report carries only ids, codes and counts. But 「這個世界昨天有幾個 Canon 衝突」 is exactly
 * the kind of operational fact that should not be readable by an anonymous caller enumerating
 * world ids, and a finding names accepted event ids that a public reader has no other route to.
 *
 * ## Evidence reads, and their bounds
 *
 * Everything is index-scoped to the world and to the window:
 *
 *  - the fold origin is ONE point read — the daily snapshot of the day before the window, else
 *    the `initial` snapshot, else genesis — so the read does not grow with the world's age;
 *  - the window's accepted events come from `by_world_and_day`, capped at `SCAN_LIMIT`;
 *  - one point read per day for its snapshot, episode, recap formats and share formats;
 *  - the secrets and the rule context are seed-sized.
 *
 * A window is at most `MAX_WINDOW_DAYS` days. A read that hits `SCAN_LIMIT` is reported as
 * `coverage.scanLimitReached`, which is a distinguishable answer rather than a quietly wrong one.
 *
 * ## What the query does NOT do
 *
 * It does not persist anything, so there is no run to deduplicate and no evaluator-version
 * migration to manage: the evidence is the durable record, and the report is derived from it on
 * every call. Exactly-once is a property of the evidence ids (every id on the live path is derived
 * from `(worldId, worldDay, timeSlot)`), and the pure module counts by those ids.
 */

import { v } from 'convex/values';
import type { GenericQueryCtx } from 'convex/server';

import { mutation, query } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import type { AcceptedEvent, WorldProjection } from '../canon/model';
import { emptyProjection } from '../canon/model';
import { readCanonRuleContext } from '../canon/ruleContextReader';
import { rowToAcceptedEvent } from '../canon/serialize';
import { deriveEventId } from '../shared/ids';
import { cloneProjection, type CanonSnapshot } from '../canon/snapshots';
import { replayWorldEvents } from '../canon/replay';
import { dailyEpisodePublicText, type DailyEpisode } from '../editorial/episode';
import { shareFormatsPublicText, type EpisodeShareFormats } from '../editorial/derived/shareFormats';
import type { RecapFormats } from '../recaps/recapFormats';
import {
  CONTINUITY_EVALUATOR,
  evaluateContinuityWindow,
  type FoldOrigin,
  type PublicationEvidence,
  type SnapshotEvidence,
} from '../quality/continuity';
import type { EvaluationReport, EvaluatorDefinition } from '../quality/evaluator';
import { evaluateNarrative, NARRATIVE_EVALUATOR, type NarrativeSceneEvidence } from '../quality/narrative';
import { personaAnchorFromSeed, type PersonaAnchor } from '../canon/personaDeviation';
import { groupingRunId } from '../simulation/worldDayLive';
import { TIME_SLOTS } from '../canon/eventTypes';
import type { SceneSimulationResult } from '../simulation/sceneSimulation';
import { credentialArgs, operatorNow, recordAudit, requireOperator } from './opsConsoleFunctions';
import { isActiveArcStatus } from '../story/lifecycle';
import { ARC_STAGNATION_WORLD_DAYS } from '../story/resolution';
import { HIGH_IMPORTANCE_THRESHOLD } from '../editorial/episode';
import { buildCoverageExclusion, CoverageExclusionError, reconcileCoverageExclusion, type CoverageExclusionRecord } from '../recaps/coverageExclusions';
import {
  evaluateOperationalQuality, OPERATIONAL_QUALITY_EVALUATOR,
  type AuthoringAttemptEvidence, type ProposalValidationEvidence, type SceneSafetyEvidence,
} from '../quality/operationalQuality';
import {
  evaluateStoryQuality, STORY_QUALITY_EVALUATOR,
  type ArcEvidence, type CoverageExclusionEvidence, type PublishedContentEvidence, type StoryEventEvidence,
} from '../quality/storyQuality';

type QueryCtx = GenericQueryCtx<DataModel>;
type ReadDb = QueryCtx['db'];

/** The default report covers the last week of world days. */
export const DEFAULT_WINDOW_DAYS = 7;
/** A window is bounded so the per-day point reads and the event scan stay bounded with it. */
export const MAX_WINDOW_DAYS = 31;
/**
 * Accepted events one report will read before it stops. Five slots a day times a handful of
 * scenes is well under this for the longest window; reaching it means the world is busier than
 * the report's bound, and the report says so instead of measuring a prefix.
 */
export const SCAN_LIMIT = 4_000;

const evidenceRefValidator = v.object({
  kind: v.string(),
  id: v.string(),
  code: v.optional(v.string()),
  worldDay: v.optional(v.number()),
});

const observationValidator = v.object({
  key: v.string(),
  label: v.string(),
  numerator: v.number(),
  denominator: v.number(),
  rate: v.union(v.number(), v.null()),
  status: v.string(),
  target: v.union(v.number(), v.null()),
  direction: v.string(),
  meetsTarget: v.union(v.boolean(), v.null()),
  excluded: v.number(),
  excludedReason: v.union(v.string(), v.null()),
});

const scoreValidator = v.object({
  key: v.string(),
  prdName: v.string(),
  value: v.union(v.number(), v.null()),
  status: v.string(),
  components: v.array(v.object({
    key: v.string(), metricKey: v.string(), weight: v.number(),
    value: v.union(v.number(), v.null()), status: v.string(),
  })),
  weightMeasured: v.number(),
  weightTotal: v.number(),
});

const findingValidator = v.object({
  code: v.string(),
  severity: v.string(),
  subjectId: v.string(),
  worldDay: v.number(),
  evidence: v.array(evidenceRefValidator),
  detail: v.string(),
});

const definitionValidator = v.object({
  evaluatorId: v.string(),
  version: v.number(),
  metrics: v.array(v.object({
    key: v.string(), prdName: v.string(), numerator: v.string(), denominator: v.string(),
    target: v.union(v.number(), v.null()), direction: v.string(),
  })),
  score: v.union(v.null(), v.object({
    key: v.string(), prdName: v.string(),
    components: v.array(v.object({ key: v.string(), metricKey: v.string(), weight: v.number(), transform: v.string() })),
  })),
  findingCodes: v.record(v.string(), v.string()),
});

export const evaluationReportValidator = v.object({
  schemaVersion: v.literal(1),
  evaluatorId: v.string(),
  evaluatorVersion: v.number(),
  worldId: v.string(),
  window: v.object({ fromWorldDay: v.number(), toWorldDay: v.number() }),
  metrics: v.array(observationValidator),
  score: v.union(scoreValidator, v.null()),
  findings: v.array(findingValidator),
  coverage: v.object({
    worldDaysEvaluated: v.array(v.number()),
    worldDaysWithoutEvidence: v.array(v.number()),
    scanLimitReached: v.boolean(),
  }),
  digest: v.string(),
});

/**
 * Spread the pure module's `readonly` arrays into mutable ones: Convex's `returns` validator
 * describes the wire shape, and the evaluator hands back frozen-by-type reports so a caller cannot
 * edit a computed number. Structure only; nothing is recomputed here.
 */
function wireReport(report: EvaluationReport) {
  return {
    ...report,
    metrics: [...report.metrics],
    score: report.score === null ? null : { ...report.score, components: [...report.score.components] },
    findings: report.findings.map((finding) => ({ ...finding, evidence: [...finding.evidence] })),
    coverage: {
      ...report.coverage,
      worldDaysEvaluated: [...report.coverage.worldDaysEvaluated],
      worldDaysWithoutEvidence: [...report.coverage.worldDaysWithoutEvidence],
    },
  };
}

function wireDefinition(definition: EvaluatorDefinition) {
  return {
    ...definition,
    metrics: [...definition.metrics],
    score: definition.score === null ? null : { ...definition.score, components: [...definition.score.components] },
    findingCodes: { ...definition.findingCodes } as Record<string, string>,
  };
}

const rowToSnapshot = (row: {
  snapshotVersion?: number; worldId: string; worldDay?: number; lastSequenceNumber: number;
  projection: unknown; projectionHash?: string; createdAt: number;
}): CanonSnapshot => ({
  snapshotVersion: row.snapshotVersion as 1,
  worldId: row.worldId,
  worldDay: row.worldDay as number,
  lastSequenceNumber: row.lastSequenceNumber,
  projection: row.projection as WorldProjection,
  projectionHash: row.projectionHash as string,
  createdAt: row.createdAt,
});

async function dailySnapshot(db: ReadDb, worldId: string, worldDay: number) {
  return db.query('canonSnapshots')
    .withIndex('by_world_day_and_kind', (q) => q.eq('worldId', worldId).eq('worldDay', worldDay).eq('kind', 'daily'))
    .first();
}

/**
 * Where the window's fold starts. One point read, and the answer says which it was.
 *
 * The previous day's daily snapshot is preferred because it makes the replay metric mean
 * "snapshot D equals D-1 plus day D" — the snapshot-resume-versus-replay link. When there is
 * none (the window starts at day 0, or the snapshot for that day failed), the seeded `initial`
 * snapshot is the origin, and events from day 0 up to the window are folded through it so the
 * origin projection is right; that pre-window fold is bounded by the same scan limit.
 */
async function resolveFoldOrigin(db: ReadDb, worldId: string, fromWorldDay: number): Promise<{
  origin: FoldOrigin; preWindowEventsRead: number; scanLimitReached: boolean;
}> {
  if (fromWorldDay > 0) {
    const previous = await dailySnapshot(db, worldId, fromWorldDay - 1);
    if (previous) {
      const snapshot = rowToSnapshot(previous);
      return {
        origin: { kind: 'daily_snapshot', ref: String(previous._id), projection: snapshot.projection, lastSequenceNumber: snapshot.lastSequenceNumber },
        preWindowEventsRead: 0, scanLimitReached: false,
      };
    }
  }
  const initial = await db.query('canonSnapshots')
    .withIndex('by_world_day_and_kind', (q) => q.eq('worldId', worldId).eq('worldDay', 0).eq('kind', 'initial'))
    .unique();
  const base: FoldOrigin = initial
    ? { kind: 'initial_snapshot', ref: String(initial._id), projection: rowToSnapshot(initial).projection, lastSequenceNumber: initial.lastSequenceNumber }
    : { kind: 'genesis', ref: 'genesis', projection: emptyProjection(worldId), lastSequenceNumber: -1 };
  if (fromWorldDay === 0) return { origin: base, preWindowEventsRead: 0, scanLimitReached: false };
  // Fold the days before the window through the base, so the window starts from the right state.
  const rows = await db.query('canonEvents')
    .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).lt('worldDay', fromWorldDay))
    .take(SCAN_LIMIT + 1);
  const events = rows.slice(0, SCAN_LIMIT).map(rowToAcceptedEvent)
    .filter((event) => event.sequenceNumber > base.lastSequenceNumber)
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  const projection = replayWorldEvents(cloneProjection(base.projection), events);
  return {
    origin: {
      kind: base.kind, ref: base.ref, projection,
      lastSequenceNumber: events.length > 0 ? events[events.length - 1].sequenceNumber : base.lastSequenceNumber,
    },
    preWindowEventsRead: events.length,
    scanLimitReached: rows.length > SCAN_LIMIT,
  };
}

/** The public texts published for one day, each with the accepted events it cites. */
async function publicationsFor(db: ReadDb, worldId: string, worldDay: number): Promise<PublicationEvidence[]> {
  const publications: PublicationEvidence[] = [];
  const episode = await db.query('dailyEpisodes')
    .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).eq('worldDay', worldDay)).first();
  if (episode?.episode) {
    publications.push({
      ref: `episode:${worldId}:${worldDay}`,
      text: dailyEpisodePublicText(episode.episode as DailyEpisode),
      citedEventIds: episode.sourceEventIds,
    });
  }
  const recap = await db.query('episodeRecapFormats')
    .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).eq('worldDay', worldDay)).first();
  if (recap?.formats) {
    const formats = recap.formats as RecapFormats;
    publications.push({
      ref: `recap_formats:${worldId}:${worldDay}`,
      text: [formats.quickRecap, formats.standardRecap, formats.deepRecap].join(' '),
      citedEventIds: recap.sourceEventIds,
    });
  }
  const share = await db.query('episodeShareFormats')
    .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).eq('worldDay', worldDay)).first();
  if (share?.formats) {
    publications.push({
      ref: `share_formats:${worldId}:${worldDay}`,
      text: shareFormatsPublicText(share.formats as EpisodeShareFormats),
      citedEventIds: share.sourceEventIds,
    });
  }
  return publications;
}

/**
 * FR-M002 Continuity Score and the five §16.2 Canon targets for one world, over a window of
 * world days. Read-only; see the module note for the evidence reads and their bounds.
 */
export const getContinuityQualityMetrics = query({
  args: {
    ...credentialArgs,
    worldId: v.string(),
    /** Inclusive. Defaults to the world's latest accepted day. */
    toWorldDay: v.optional(v.number()),
    /** Defaults to `DEFAULT_WINDOW_DAYS`; clamped to `[1, MAX_WINDOW_DAYS]`. */
    windowDays: v.optional(v.number()),
  },
  returns: v.object({
    definition: definitionValidator,
    report: evaluationReportValidator,
    /** How the fold origin was chosen, and how much pre-window history it folded. */
    origin: v.object({ kind: v.string(), ref: v.string(), preWindowEventsRead: v.number() }),
  }),
  handler: async (ctx, args) => {
    await requireOperator(ctx, 'world.inspect', args);
    const { worldId } = args;

    const latest = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).order('desc').first();
    const toWorldDay = Math.max(0, Math.floor(args.toWorldDay ?? latest?.worldDay ?? 0));
    const windowDays = Math.min(Math.max(1, Math.floor(args.windowDays ?? DEFAULT_WINDOW_DAYS)), MAX_WINDOW_DAYS);
    const fromWorldDay = Math.max(0, toWorldDay - windowDays + 1);

    const { origin, preWindowEventsRead, scanLimitReached: originTruncated } = await resolveFoldOrigin(ctx.db, worldId, fromWorldDay);

    const rows = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).gte('worldDay', fromWorldDay).lte('worldDay', toWorldDay))
      .take(SCAN_LIMIT + 1);
    const events = rows.slice(0, SCAN_LIMIT).map(rowToAcceptedEvent)
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber);
    const eventsByDay = new Map<number, AcceptedEvent[]>();
    for (const event of events) eventsByDay.set(event.worldDay, [...(eventsByDay.get(event.worldDay) ?? []), event]);

    const snapshotByDay = new Map<number, SnapshotEvidence>();
    const publicationsByDay = new Map<number, PublicationEvidence[]>();
    for (let worldDay = fromWorldDay; worldDay <= toWorldDay; worldDay += 1) {
      if (!eventsByDay.has(worldDay)) continue;
      const snapshot = await dailySnapshot(ctx.db, worldId, worldDay);
      if (snapshot?.projectionHash) {
        snapshotByDay.set(worldDay, { ref: String(snapshot._id), lastSequenceNumber: snapshot.lastSequenceNumber, projectionHash: snapshot.projectionHash });
      }
      publicationsByDay.set(worldDay, await publicationsFor(ctx.db, worldId, worldDay));
    }

    const [ruleContext, secretRows] = await Promise.all([
      readCanonRuleContext(ctx.db, worldId),
      ctx.db.query('worldSecrets').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
    ]);
    const secrets = secretRows.flatMap((row) => {
      const content = (row.payload as { content?: unknown }).content;
      return typeof content === 'string' ? [{ secretId: row.secretId, content }] : [];
    });

    const report = evaluateContinuityWindow({
      worldId, fromWorldDay, toWorldDay, origin, ruleContext, secrets,
      eventsByDay, snapshotByDay, publicationsByDay,
      scanLimitReached: originTruncated || rows.length > SCAN_LIMIT,
    });
    return {
      definition: wireDefinition(CONTINUITY_EVALUATOR),
      report: wireReport(report),
      origin: { kind: origin.kind, ref: origin.ref, preWindowEventsRead },
    };
  },
});

/**
 * FR-M002 narrative metrics for one world over a window of world days (ART-88): the §16.2
 * repeated-scene ratio with its exact / near / template split, dialogue repetition, voice
 * distinctiveness, persona deviation and event novelty.
 *
 * ## Evidence reads
 *
 * Scene prose lives only in `sceneSimulationRuns.result` (a `v.any()` LLM-blob table). It is read
 * by `by_grouping_run` for each `(worldDay, timeSlot)` in the window — the grouping run id is
 * derived from the slot, so this is `days × 5` point-range reads and never a world-wide sweep. A
 * scene is joined to Canon through `metadata.sceneId` on its accepted events (FR-P004 stamps it
 * on every real proposal), and only joined scenes enter the denominator.
 *
 * The persona half needs the projection at the window's start; it comes from the same fold origin
 * `getContinuityQualityMetrics` uses, so the two evaluators agree on where the window began.
 */
export const getNarrativeQualityMetrics = query({
  args: {
    ...credentialArgs,
    worldId: v.string(),
    toWorldDay: v.optional(v.number()),
    windowDays: v.optional(v.number()),
  },
  returns: v.object({
    definition: definitionValidator,
    report: evaluationReportValidator,
    /** Scenes read, and how many of them Canon accepted, so the denominator is checkable. */
    scenes: v.object({ read: v.number(), accepted: v.number(), withheld: v.number() }),
  }),
  handler: async (ctx, args) => {
    await requireOperator(ctx, 'world.inspect', args);
    const { worldId } = args;

    const latest = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).order('desc').first();
    const toWorldDay = Math.max(0, Math.floor(args.toWorldDay ?? latest?.worldDay ?? 0));
    const windowDays = Math.min(Math.max(1, Math.floor(args.windowDays ?? DEFAULT_WINDOW_DAYS)), MAX_WINDOW_DAYS);
    const fromWorldDay = Math.max(0, toWorldDay - windowDays + 1);

    const rows = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).gte('worldDay', fromWorldDay).lte('worldDay', toWorldDay))
      .take(SCAN_LIMIT + 1);
    const events = rows.slice(0, SCAN_LIMIT).map(rowToAcceptedEvent)
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber);
    const acceptedSequenceByScene = new Map<string, number>();
    for (const event of events) {
      const sceneId = typeof event.metadata?.sceneId === 'string' ? event.metadata.sceneId : event.idempotencyKey.split(':event:')[0];
      const prior = acceptedSequenceByScene.get(sceneId);
      if (prior === undefined || event.sequenceNumber < prior) acceptedSequenceByScene.set(sceneId, event.sequenceNumber);
    }

    const scenes: NarrativeSceneEvidence[] = [];
    let sceneRowsRead = 0;
    for (let worldDay = fromWorldDay; worldDay <= toWorldDay; worldDay += 1) {
      for (const timeSlot of TIME_SLOTS) {
        const runs = await ctx.db.query('sceneSimulationRuns')
          .withIndex('by_grouping_run', (q) => q.eq('worldId', worldId).eq('groupingRunId', groupingRunId({ worldId, worldDay, timeSlot })))
          .take(SCAN_LIMIT + 1);
        sceneRowsRead += runs.length;
        for (const row of runs.slice(0, SCAN_LIMIT)) {
          const result = row.result as SceneSimulationResult;
          scenes.push({
            sceneId: row.sceneId,
            worldDay: result.scene.worldDay,
            timeSlot: result.scene.timeSlot,
            acceptedSequenceNumber: acceptedSequenceByScene.get(row.sceneId) ?? null,
            locationId: result.scene.locationId,
            participantIds: result.scene.participantIds,
            arcIds: result.scene.arcIds,
            sceneSummary: result.output.sceneSummary,
            keyActions: result.output.keyActions,
            dialogue: result.output.dialogueHighlights,
            publicSummaries: result.output.proposedEvents.map(({ publicSummary }) => publicSummary ?? ''),
            withheld: row.status === 'review_required',
          });
        }
      }
    }

    const [characters, locations, arcs, { origin }] = await Promise.all([
      ctx.db.query('worldCharacters').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
      ctx.db.query('worldLocations').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
      ctx.db.query('storyArcLifecycles').withIndex('by_world_and_arc', (q) => q.eq('worldId', worldId)).collect(),
      resolveFoldOrigin(ctx.db, worldId, fromWorldDay),
    ]);
    const personaAnchors: Record<string, PersonaAnchor> = Object.fromEntries(characters.flatMap((row) => {
      const anchor = personaAnchorFromSeed(row.characterId, row.payload);
      return anchor ? [[row.characterId, anchor] as const] : [];
    }));

    const report = evaluateNarrative({
      worldId, fromWorldDay, toWorldDay, scenes, events,
      identifiers: [worldId, ...characters.map(({ characterId }) => characterId), ...locations.map(({ locationId }) => locationId), ...arcs.map(({ arcId }) => arcId)],
      personaAnchors,
      originProjection: origin.projection,
      scanLimitReached: rows.length > SCAN_LIMIT || sceneRowsRead > SCAN_LIMIT,
    });
    const accepted = scenes.filter((scene) => !scene.withheld && scene.acceptedSequenceNumber !== null).length;
    return {
      definition: wireDefinition(NARRATIVE_EVALUATOR),
      report: wireReport(report),
      scenes: { read: scenes.length, accepted, withheld: scenes.filter(({ withheld }) => withheld).length },
    };
  },
});

/**
 * FR-M002 arc / recap / spoiler metrics for one world over a window of world days (ART-89).
 *
 * ## Where each number comes from
 *
 *  - **Coverage denominator** — high-importance accepted events, read from `canonEvents` by
 *    `by_world_and_day` and classified by `storyArcEventClassifications`. Never from the episodes:
 *    `buildDailyEpisode` refuses to store an episode that omits a high-importance event, so a ratio
 *    over stored episodes reads 100% by construction. See `convex/quality/storyQuality.ts`.
 *  - **Coverage numerator** — the events cited by published contents whose PERSISTED FR-G004
 *    verdict (`episodeCoverageReports.releasable`) is true. A refused episode covers nothing.
 *  - **Exclusions** — `coverageExclusions`, the operator's explicit reasons (ART-89).
 *  - **Arcs** — lifecycles, their projection revisions and their resolution decisions.
 *
 * Reads are index-scoped to the world and the window and bounded by `SCAN_LIMIT`, and a truncated
 * read is reported as `coverage.scanLimitReached` rather than quietly measured.
 */
export const getStoryQualityMetrics = query({
  args: {
    ...credentialArgs,
    worldId: v.string(),
    toWorldDay: v.optional(v.number()),
    windowDays: v.optional(v.number()),
  },
  returns: v.object({
    definition: definitionValidator,
    report: evaluationReportValidator,
    thresholds: v.object({ highImportance: v.number(), stagnationWorldDays: v.number() }),
  }),
  handler: async (ctx, args) => {
    await requireOperator(ctx, 'world.inspect', args);
    const { worldId } = args;

    const latest = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).order('desc').first();
    const toWorldDay = Math.max(0, Math.floor(args.toWorldDay ?? latest?.worldDay ?? 0));
    const windowDays = Math.min(Math.max(1, Math.floor(args.windowDays ?? DEFAULT_WINDOW_DAYS)), MAX_WINDOW_DAYS);
    const fromWorldDay = Math.max(0, toWorldDay - windowDays + 1);

    const eventRows = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).gte('worldDay', fromWorldDay).lte('worldDay', toWorldDay))
      .take(SCAN_LIMIT + 1);
    const classificationRows = await ctx.db.query('storyArcEventClassifications')
      .withIndex('by_world', (q) => q.eq('worldId', worldId)).take(SCAN_LIMIT + 1);
    const importanceBySequence = new Map<number, number>(classificationRows.slice(0, SCAN_LIMIT).map((row) => [
      row.sourceEventSequenceNumber,
      (row.memberships as Array<{ importance: number }>).reduce((max, membership) => Math.max(max, membership.importance), 0),
    ]));
    const events: StoryEventEvidence[] = eventRows.slice(0, SCAN_LIMIT).map((row) => ({
      eventId: deriveEventId(worldId, row.sequenceNumber),
      worldDay: row.worldDay,
      importance: importanceBySequence.get(row.sequenceNumber) ?? 0,
    }));

    const reportRows = await ctx.db.query('episodeCoverageReports')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).gte('worldDay', fromWorldDay).lte('worldDay', toWorldDay))
      .take(SCAN_LIMIT + 1);
    const publications: PublishedContentEvidence[] = reportRows.slice(0, SCAN_LIMIT).map((row) => {
      const report = row.report as { findings?: Array<{ code: string; category: string }>; citedEventIds?: string[]; coveredEventIds?: string[] } | null;
      const findings = report?.findings ?? [];
      return {
        contentRef: row.contentRef,
        worldDay: row.worldDay,
        releasable: row.releasable,
        findingCodes: [...row.findingCodes],
        spoilerFindingCodes: findings.filter(({ category }) => category === 'spoiler').map(({ code }) => code),
        // The verdict records which high-importance events the candidate actually covered; that is
        // the set a coverage numerator may count, not everything the candidate happened to cite.
        citedEventIds: report?.coveredEventIds ?? [],
        errorCode: row.errorCode ?? null,
      };
    });

    const exclusionRows = await ctx.db.query('coverageExclusions')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).gte('worldDay', fromWorldDay).lte('worldDay', toWorldDay))
      .take(SCAN_LIMIT + 1);
    const exclusions: CoverageExclusionEvidence[] = exclusionRows.slice(0, SCAN_LIMIT).map((row) => ({
      eventId: row.eventId, worldDay: row.worldDay, reason: row.reason, operatorId: row.operatorId,
    }));

    const [lifecycles, projections, decisions] = await Promise.all([
      ctx.db.query('storyArcLifecycles').withIndex('by_world_and_arc', (q) => q.eq('worldId', worldId)).take(SCAN_LIMIT + 1),
      ctx.db.query('storyArcProjectionEvents').withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', worldId)).take(SCAN_LIMIT + 1),
      ctx.db.query('storyArcResolutionDecisions').withIndex('by_world_and_arc', (q) => q.eq('worldId', worldId)).take(SCAN_LIMIT + 1),
    ]);
    const arcs: ArcEvidence[] = lifecycles.slice(0, SCAN_LIMIT).map((lifecycle) => {
      const own = projections.filter((row) => row.arcId === lifecycle.arcId);
      const lastProgressWorldDay = own.reduce((highest, row) => Math.max(highest, row.worldDay), 0);
      const terminal = lifecycle.status === 'resolved' || lifecycle.status === 'archived';
      const decision = decisions
        .filter((row) => row.arcId === lifecycle.arcId)
        .map((row) => row.decision as { outcome?: string | null; consequences?: unknown[]; resultingStatus?: string })
        .filter((row) => row.resultingStatus === 'resolved' || row.resultingStatus === 'archived')
        .at(-1);
      return {
        arcId: lifecycle.arcId,
        status: lifecycle.status,
        active: isActiveArcStatus(lifecycle.status),
        lastProgressWorldDay,
        revisionsInWindow: own.filter((row) => row.worldDay >= fromWorldDay && row.worldDay <= toWorldDay).length,
        reachedTerminal: terminal,
        terminalOutcomeRecorded: (decision?.outcome ?? '').trim().length > 0,
        terminalConsequenceCount: decision?.consequences?.length ?? 0,
      };
    });

    const report = evaluateStoryQuality({
      worldId, fromWorldDay, toWorldDay,
      highImportanceThreshold: HIGH_IMPORTANCE_THRESHOLD,
      stagnationThresholdWorldDays: ARC_STAGNATION_WORLD_DAYS,
      events, publications, exclusions, arcs,
      scanLimitReached: eventRows.length > SCAN_LIMIT || classificationRows.length > SCAN_LIMIT
        || reportRows.length > SCAN_LIMIT || exclusionRows.length > SCAN_LIMIT
        || lifecycles.length > SCAN_LIMIT || projections.length > SCAN_LIMIT || decisions.length > SCAN_LIMIT,
    });
    return {
      definition: wireDefinition(STORY_QUALITY_EVALUATOR),
      report: wireReport(report),
      thresholds: { highImportance: HIGH_IMPORTANCE_THRESHOLD, stagnationWorldDays: ARC_STAGNATION_WORLD_DAYS },
    };
  },
});

/**
 * Declare, in words, why a high-importance Accepted Event is not in the public record (ART-89).
 *
 * ## Why `safety.override` and not a new capability
 *
 * Minting a capability is a decision about the operator role model, and this repository reuses
 * rather than mints unless the thing governed is genuinely different (ART-47, ART-58). The nearest
 * existing capability is `safety.override`: both are an operator overruling an automated gate about
 * what the public record contains, and both are append-only ledgers rather than edits.
 *
 * It is also the SAFE direction of reuse. `safety.override` is `admin` — 「the highest-consequence
 * publication decision in the system」 — and declaring an exclusion is strictly smaller than
 * releasing content a classifier withheld. Reusing a more privileged capability for a less
 * consequential action cannot grant anyone a power they did not already have; the reverse would.
 *
 * ## It is not a Canon write
 *
 * The event stays accepted. The row records a reason, and the coverage metric reports the excluded
 * count and the reason beside the rate rather than folding it into the numerator.
 */
export const declareRecapExclusion = mutation({
  args: {
    ...credentialArgs,
    worldId: v.string(),
    eventId: v.string(),
    reason: v.string(),
    now: v.optional(v.number()),
  },
  returns: v.object({
    eventId: v.string(), worldDay: v.number(), deduplicated: v.boolean(), operatorId: v.string(),
  }),
  handler: async (ctx, args) => {
    const principal = await requireOperator(ctx, 'safety.override', args);
    const at = operatorNow(args.now);

    // The event must be accepted: an exclusion naming an event Canon never accepted excuses
    // nothing, and would put the exclusion set outside the denominator it reduces. An event id is
    // `<worldId>#event#<sequence>` (`deriveEventId`), so the sequence is read back out of the id
    // and the row is a point lookup on `by_world_and_sequence` — then the id is DERIVED again from
    // the row and compared, so a malformed id cannot resolve to a real event by accident.
    const suffix = args.eventId.startsWith(`${args.worldId}#event#`)
      ? args.eventId.slice(`${args.worldId}#event#`.length) : '';
    const sequenceNumber = /^\d+$/.test(suffix) ? Number(suffix) : -1;
    const row = sequenceNumber < 0 ? null : await ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId).eq('sequenceNumber', sequenceNumber))
      .unique();
    if (!row || deriveEventId(args.worldId, row.sequenceNumber) !== args.eventId) {
      throw new CoverageExclusionError('COVERAGE_EXCLUSION_SOURCE_NOT_ACCEPTED',
        'an exclusion may only name an accepted event of this world');
    }

    const record = buildCoverageExclusion({
      worldId: args.worldId, worldDay: row.worldDay, eventId: args.eventId,
      reason: args.reason, operatorId: principal.operatorId, createdAt: at,
    });
    const prior = await ctx.db.query('coverageExclusions')
      .withIndex('by_world_and_event', (q) => q.eq('worldId', args.worldId).eq('eventId', args.eventId))
      .unique();
    if (prior) {
      reconcileCoverageExclusion(prior as CoverageExclusionRecord, record);
      await recordAudit(ctx, {
        principal, worldId: args.worldId, capability: 'safety.override', target: args.eventId,
        reason: record.reason, outcome: 'no_op', resultCode: 'COVERAGE_EXCLUSION_DEDUPLICATED', at,
      });
      return { eventId: args.eventId, worldDay: prior.worldDay, deduplicated: true, operatorId: principal.operatorId };
    }
    await ctx.db.insert('coverageExclusions', record);
    await recordAudit(ctx, {
      principal, worldId: args.worldId, capability: 'safety.override', target: args.eventId,
      reason: record.reason, outcome: 'applied', resultCode: 'COVERAGE_EXCLUSION_DECLARED', at,
    });
    return { eventId: args.eventId, worldDay: record.worldDay, deduplicated: false, operatorId: principal.operatorId };
  },
});

const reasonDimensionValidator = v.array(v.object({ code: v.string(), count: v.number() }));

/**
 * FR-M002 operational metrics for one world over a window of world days (ART-90): Canon Rejection
 * Rate, Safety Withhold Rate and §16.2's structured-output success rate, each with its own reason
 * dimensions.
 *
 * ## Where each number comes from, and why not from somewhere else
 *
 *  - **Rejections** — `canonValidationOutcomes`, written per proposal by both validation stages
 *    (ART-90). Not `worldDayRuns` (patched per attempt), not `scheduledSlots.errorCode` (cleared on
 *    retry), not `worldDayCheckpoints` (one code per stage, however many proposals it judged).
 *  - **Structured output** — `llmTraces`, one row per authoring attempt. Not `sceneSimulationRuns`:
 *    a scene that exhausted its attempts writes no row there, so a rate over it reads 100% by
 *    construction.
 *  - **Safety** — the classification stored with each scene result, which is the verdict the commit
 *    path itself acted on.
 *
 * Every unit is deduplicated on an identity a retried slot re-derives, so retries and duplicate
 * runs cannot inflate a rate.
 */
export const getOperationalQualityMetrics = query({
  args: {
    ...credentialArgs,
    worldId: v.string(),
    toWorldDay: v.optional(v.number()),
    windowDays: v.optional(v.number()),
  },
  returns: v.object({
    definition: definitionValidator,
    report: evaluationReportValidator,
    breakdown: v.object({
      rejectionReasons: reasonDimensionValidator,
      withholdReasons: reasonDimensionValidator,
      structuredOutputReasons: reasonDimensionValidator,
      providerFailureReasons: reasonDimensionValidator,
      models: reasonDimensionValidator,
    }),
  }),
  handler: async (ctx, args) => {
    await requireOperator(ctx, 'world.inspect', args);
    const { worldId } = args;

    const latest = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).order('desc').first();
    const toWorldDay = Math.max(0, Math.floor(args.toWorldDay ?? latest?.worldDay ?? 0));
    const windowDays = Math.min(Math.max(1, Math.floor(args.windowDays ?? DEFAULT_WINDOW_DAYS)), MAX_WINDOW_DAYS);
    const fromWorldDay = Math.max(0, toWorldDay - windowDays + 1);

    const validationRows = await ctx.db.query('canonValidationOutcomes')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).gte('worldDay', fromWorldDay).lte('worldDay', toWorldDay))
      .take(SCAN_LIMIT + 1);
    const validations: ProposalValidationEvidence[] = validationRows.slice(0, SCAN_LIMIT).map((row) => ({
      worldDay: row.worldDay, idempotencyKey: row.idempotencyKey, sceneId: row.sceneId,
      stage: row.stage, outcome: row.outcome, errorCode: row.errorCode,
    }));

    const traceRows = await ctx.db.query('llmTraces')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).gte('worldDay', fromWorldDay).lte('worldDay', toWorldDay))
      .take(SCAN_LIMIT + 1);
    const attempts: AuthoringAttemptEvidence[] = traceRows.slice(0, SCAN_LIMIT).map((row) => ({
      worldDay: row.worldDay,
      sceneId: row.sceneId ?? row.runId,
      attemptId: row.traceId,
      // The trace's two fields say which of the three outcomes this attempt had; `not_run` means
      // there was no response to validate, which is what the structure rate excludes.
      outcome: row.validationResult === 'passed' ? 'parsed'
        : row.validationResult === 'rejected' ? 'output_rejected' : 'provider_failed',
      errorCode: null,
      model: row.model,
      transportRetries: row.retryCount,
    }));

    // Scenes are read per (day, slot) on the grouping-run index, never as a sweep of the
    // `v.any()` scene table — the same bound `getNarrativeQualityMetrics` uses.
    const scenes: SceneSafetyEvidence[] = [];
    let sceneRowsRead = 0;
    for (let worldDay = fromWorldDay; worldDay <= toWorldDay; worldDay += 1) {
      for (const timeSlot of TIME_SLOTS) {
        const runs = await ctx.db.query('sceneSimulationRuns')
          .withIndex('by_grouping_run', (q) => q.eq('worldId', worldId).eq('groupingRunId', groupingRunId({ worldId, worldDay, timeSlot })))
          .take(SCAN_LIMIT + 1);
        sceneRowsRead += runs.length;
        for (const row of runs.slice(0, SCAN_LIMIT)) {
          const result = row.result as SceneSimulationResult;
          scenes.push({
            worldDay,
            sceneId: row.sceneId,
            label: result.safety?.label ?? null,
            reasonCodes: result.safety?.reasonCodes ?? [],
          });
        }
      }
    }

    const { report, breakdown } = evaluateOperationalQuality({
      worldId, fromWorldDay, toWorldDay, validations, attempts, scenes,
      scanLimitReached: validationRows.length > SCAN_LIMIT || traceRows.length > SCAN_LIMIT || sceneRowsRead > SCAN_LIMIT,
    });
    return {
      definition: wireDefinition(OPERATIONAL_QUALITY_EVALUATOR),
      report: wireReport(report),
      breakdown: {
        rejectionReasons: [...breakdown.rejectionReasons],
        withholdReasons: [...breakdown.withholdReasons],
        structuredOutputReasons: [...breakdown.structuredOutputReasons],
        providerFailureReasons: [...breakdown.providerFailureReasons],
        models: [...breakdown.models],
      },
    };
  },
});
