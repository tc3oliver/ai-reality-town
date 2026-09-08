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

import { query } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import type { AcceptedEvent, WorldProjection } from '../canon/model';
import { emptyProjection } from '../canon/model';
import { readCanonRuleContext } from '../canon/ruleContextReader';
import { rowToAcceptedEvent } from '../canon/serialize';
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
import { credentialArgs, requireOperator } from './opsConsoleFunctions';

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
