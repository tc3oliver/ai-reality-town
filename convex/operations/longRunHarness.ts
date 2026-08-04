/**
 * NFR-007 / PRD Section 19.3 — deterministic long-run simulation harness.
 *
 * Drives the REAL live pipeline for N consecutive world days and returns one
 * machine-readable {@link LongRunFindings} record. Nothing here is meant to be read by
 * eye: every PRD Section 19.3 question is answered by a typed field a test asserts on.
 *
 *   per world day, per time slot:
 *     executeWorldDay            (ART-97 stages 1–10: director → intent → scene →
 *                                 structural + canon validation → canon commit)
 *     executePostCommitPipeline  (ART-98 stages 11–21: cognition → arc → episode →
 *                                 recap → safety → publication → snapshot → metrics)
 *       for every newly accepted event, in canon order
 *
 * Fixed seed. There is no RNG anywhere in the driven path: the fixture is the Mistwood
 * production seed and every Run ID, idempotency key and generator choice is derived from
 * `(worldId, worldDay, timeSlot)`. The seed is therefore the tuple in {@link LongRunSeed},
 * and reproducibility is proven rather than asserted — {@link LongRunFindings.digest} is a
 * canonical digest of the whole run, so two runs of the same seed must produce the same
 * string.
 *
 * Zero cost, no network, no credentials: scene authoring goes through ART-4's deterministic
 * {@link FakeWholeSceneProvider}, exactly the provider `createWorldDayStageHandlers`
 * defaults to.
 *
 * Pure module: no Convex imports, no node builtins, no clock, no randomness — so the
 * harness itself cannot be the source of a non-reproducible result.
 *
 * It lives in `convex/operations` because `architecture/module-boundaries.json` is the only
 * module allowed to depend on simulation, story, editorial/recaps, publicRead and safety at
 * once; `convex/simulation` may not, and the harness must check episodes, recaps and read
 * models.
 */

import { TIME_SLOTS, type TimeSlot } from '../canon/eventTypes';
import { InMemoryCanonStore } from '../canon/inMemoryStore';
import { emptyProjection, type AcceptedEvent, type CanonRuleContext, type ProposedEvent, type WorldProjection } from '../canon/model';
import { mistwoodCharacterSeed, mistwoodWorldConfiguration, MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { replayWorldEvents } from '../canon/replay';
import { validateCanon, validateEventStructure } from '../canon/validators';
import { authorizeKnowledgeRead } from '../knowledge/authorization';
import { authorizeMemoryRead } from '../knowledge/memoryAuthorization';
import { FAKE_SCENE_MODEL } from '../simulation/fakeSceneNarrator';
import type { SceneSimulationResult } from '../simulation/sceneSimulation';
import {
  buildLiveWorldSnapshot,
  createWorldDayStageHandlers,
  worldDayRunId,
  type LiveArc,
  type WorldDayLivePort,
  type WorldDaySlotIdentity,
} from '../simulation/worldDayLive';
import {
  executeWorldDay,
  type RunFailure as WorldDayRunFailure,
  type WorldDayCheckpoint,
  type WorldDayRun,
  type WorldDayRunInput,
  type WorldDayRunStore,
  type WorldDayStage,
} from '../simulation/worldDayOrchestration';
import { buildDailyEpisode, dailyEpisodePublicText, validateDailyEpisode, MIN_EPISODE_SCENES, type DailyEpisode, type EpisodeSourceEvent } from '../editorial/episode';
import { createPublicationRecord, transitionPublication, type PublicationRecord } from '../editorial/publicationLifecycle';
import {
  deriveRelationshipChangeId,
  relationshipChangeMagnitude,
  validateRecapCoverage,
  type CoverageFinding,
  type CoverageSourceEvent,
} from '../recaps/coverageValidation';
import { buildRecapSnapshot, type RecapSnapshot } from '../recaps/model';
import { classifyPostGeneration } from '../safety/postGeneration';
import { createArcLifecycle, isActiveArcStatus, transitionArcLifecycle } from '../story/lifecycle';
import { applyArcPortfolioControl, MAX_MAJOR_ACTIVE_ARCS, type ArcPortfolioEntry } from '../story/portfolio';
import { replayArcProjection } from '../story/projection';
import { detectArcStagnation, ARC_STAGNATION_WORLD_DAYS } from '../story/resolution';
import { recommendArcEntry } from '../story/entryRecommendation';
import type { ArcEventClassification, ArcLifecycleRecord, ArcProjectionEvent } from '../story/model';
import { buildEpisodeIndex, EPISODE_INDEX_MODEL_KIND } from '../publicRead/episodeIndexProjection';
import {
  buildEpisodeProjection,
  buildTimelineProjection,
  EPISODE_MODEL_KIND,
  TIMELINE_MODEL_KIND,
  type TimelineEntryInput,
} from '../publicRead/episodeTimelineProjection';
import { buildArcProjection, ARC_MODEL_KIND } from '../publicRead/relationshipArcProjection';
import { buildLiveProjection, LIVE_MODEL_KIND, liveSourceEventIds } from '../publicRead/liveState';
import {
  commitReadModelVersion,
  SERVABLE_STATUS,
  type PublishedReadModel,
  type PublicReadStore,
  type ReadModelKind,
  type StoredReadModel,
} from '../publicRead/readModel';
import {
  executePostCommitPipeline,
  POST_COMMIT_STAGES,
  type PostCommitCheckpoint,
  type PostCommitRun,
  type PostCommitRunInput,
  type PostCommitRunStore,
  type PostCommitStage,
  type RunFailure,
} from './postCommitOrchestration';
import {
  createPostCommitStageHandlers,
  postCommitRunId,
  recapTargetKey,
  type LiveArcState,
  type PostCommitLivePort,
  type PostCommitSource,
  type PostCommitWorldState,
} from './postCommitLive';

// --- seed -------------------------------------------------------------------

export const LONG_RUN_WORLD_ID = MISTWOOD_PUBLIC_WORLD_ID;
/** Identity of the fixed fixture the harness seeds; bump when the seed content changes. */
export const LONG_RUN_FIXTURE_ID = 'mistwood-production-seed-v1';

/**
 * The complete, fixed seed of a long run. Two runs sharing this tuple must produce byte
 * identical findings — there is no other input to the driven path.
 */
export type LongRunSeed = {
  worldId: string;
  fixtureId: string;
  /** Scene author. Always the deterministic no-cost provider; never a network adapter. */
  providerModel: string;
  startWorldDay: number;
  worldDays: number;
  timeSlotsPerWorldDay: number;
};

/**
 * Slots a character may go without appearing in a committed scene before the run is
 * considered to have starved them.
 *
 * Derived from the Director's own input, not invented: `slotsSinceMajorAppearance`
 * (`convex/simulation/worldDayLive.ts`) is the field FR-C002 planning ranks characters by,
 * and `MAX_MAJOR_SCENES_PER_SLOT` (3 scenes) × `MAX_PLANNED_SCENE_PARTICIPANTS` (4) means a
 * slot can seat every one of the 12 seeded Mistwood characters. Two full world days is
 * therefore a generous ceiling: any character unseen longer than that is a real starvation
 * signal from the live Director, not fixture noise.
 */
export const MAX_SLOTS_WITHOUT_APPEARANCE = 2 * TIME_SLOTS.length;

// --- findings ---------------------------------------------------------------

export type SlotOutcome = {
  worldDay: number;
  timeSlot: TimeSlot;
  status: WorldDayRun['status'];
  attemptCount: number;
  committedEventIds: string[];
  failureStage: string | null;
  errorCode: string | null;
};

/** A Canon rule or structure violation that reached (or escaped) the accepted log. */
export type CanonConflictFinding = {
  /** `world_day_run` | `post_commit_run` | `accepted_event_revalidation` | `sequence` | `idempotency`. */
  source: string;
  subjectId: string;
  code: string;
  detail: string;
};

export type ReplayFindings = {
  acceptedEvents: number;
  /** Digest of the projection replayed from the accepted log after the run. */
  replayedDigest: string;
  /** Digest of the projection the pipeline itself carried at its last slot. */
  liveDigest: string;
  equal: boolean;
  /** Digest of a second, independent replay of the same log (replay purity). */
  secondReplayDigest: string;
  deterministic: boolean;
};

export type ArcFindings = {
  totalArcs: number;
  maxActiveMajorArcs: number;
  minActiveMajorArcs: number;
  /** Active major arc count sampled at the end of every world day (Section 16.2). */
  activeMajorByWorldDay: number[];
  /**
   * Major arcs the portfolio still carries (everything except `resolved`/`archived`), at
   * the same checkpoints. Reported next to {@link activeMajorByWorldDay} because
   * `isActiveArcStatus` deliberately excludes `emerging`: an arc opened but not yet
   * activated is in the portfolio and counts against FR-F003, yet is not "active".
   */
  unresolvedMajorByWorldDay: number[];
  /** Lifecycle-status census sampled at the same checkpoints, so a dip is explainable. */
  arcStatusByWorldDay: Array<Record<string, number>>;
  /** Checkpoints with no active-family major arc at all — the world had no live question. */
  worldDaysWithoutActiveMajorArc: number[];
  activeMajorLimit: number;
  overLimitWorldDays: number[];
  /** Arcs whose projection never advanced past its initial revision. */
  arcsWithoutProgress: string[];
  /** ART-31 prompts still open at the end of the run: an arc ran unresolved too long. */
  stagnantArcs: Array<{ arcId: string; stagnantWorldDays: number; status: string }>;
  stagnationThresholdWorldDays: number;
  /** FR-F002 transitions the portfolio deferred instead of breaking a limit. */
  deferredTransitions: number;
  resolvedArcs: string[];
};

export type AppearanceFindings = {
  characterIds: string[];
  /** Highest `slotsSinceMajorAppearance` any character reached during planning. */
  maxSlotsSinceMajorAppearance: number;
  threshold: number;
  violations: Array<{ characterId: string; slotsSinceMajorAppearance: number; worldDay: number; timeSlot: TimeSlot }>;
  /** Characters that never took part in a committed scene. */
  neverAppeared: string[];
};

export type RepetitionFindings = {
  scenes: number;
  distinctContentDigests: number;
  /** Exact-duplicate content groups: same digest produced by 2+ different scenes. */
  duplicateGroups: Array<{ digest: string; sceneIds: string[] }>;
  duplicateScenes: number;
  duplicateRate: number;
  method: string;
};

export type RecapCoverageFindings = {
  completedWorldDays: number;
  episodes: number;
  /** World days that finished but produced no episode at all. */
  worldDaysWithoutEpisode: number[];
  /** Episodes assembled with null/blank content — the silently-empty case. */
  emptyEpisodes: number[];
  worldDaysWithoutAcceptedEvent: number[];
  recapSnapshots: number;
  recapTypes: string[];
  /** FR-G004 (ART-35) coverage/spoiler findings per episode; empty means clean. */
  coverageFindings: Array<{ worldDay: number; findings: CoverageFinding[] }>;
};

export type TokenFindings = {
  /**
   * Honest scope: the run is authored by the ART-4 fake provider, which consumes no real
   * tokens — its counts are derived from payload length. These fields therefore check that
   * the accounting channel is wired and sane, NOT that spend is normal. Real cost-anomaly
   * detection needs the ART-72 provider adapter and is deliberately not simulated here.
   */
  note: string;
  providers: string[];
  models: string[];
  traces: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  retries: number;
  /** Traces with a missing, non-finite, or negative token count. */
  anomalies: Array<{ sceneId: string; reason: string }>;
  realProviderSpendChecked: boolean;
};

export type SafetyFindings = {
  scenesSimulated: number;
  /** Scenes with no post-generation classification: safety was skipped. */
  scenesWithoutClassification: string[];
  policyVersions: number[];
  labels: string[];
  withheldSceneIds: string[];
  /** Committed events whose authoring scene was never classified, or was withheld. */
  eventsBypassingSafety: string[];
  episodes: number;
  episodesWithoutClassification: number[];
};

export type LongRunFindings = {
  schemaVersion: 1;
  seed: LongRunSeed;
  slots: SlotOutcome[];
  slotsExecuted: number;
  slotsCompleted: number;
  /** Section 16.2 world-day completion rate; 1 means every slot of every day completed. */
  completionRate: number;
  acceptedEvents: number;
  canonConflicts: CanonConflictFinding[];
  replay: ReplayFindings;
  arcs: ArcFindings;
  appearance: AppearanceFindings;
  repetition: RepetitionFindings;
  recapCoverage: RecapCoverageFindings;
  tokens: TokenFindings;
  safety: SafetyFindings;
  /** Canonical digest of every field above except itself. Equal seeds ⇒ equal digest. */
  digest: string;
};

// --- deterministic digest ----------------------------------------------------

/** Key-ordered JSON so a digest never depends on property insertion order. */
function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}

function fnv1a(value: string, offsetBasis: number): number {
  let hash = offsetBasis;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * 128-bit FNV-1a content digest, built from four independently salted 32-bit passes.
 *
 * A pure-JS digest rather than `node:crypto` so this module stays importable from the
 * Convex runtime and carries no node builtin; four passes keep the collision probability
 * over a run's few hundred scenes far below any level that could mask a real duplicate.
 */
export function contentDigest(value: unknown): string {
  const text = canonicalJson(value);
  return [2166136261, 84696351, 40389, 2654435761]
    .map((basis, salt) => fnv1a(`${salt} ${text}`, basis).toString(16).padStart(8, '0'))
    .join('');
}

const projectionDigest = (projection: WorldProjection): string => contentDigest(projection);

// --- fixture ----------------------------------------------------------------

const activeLocations = mistwoodWorldConfiguration.locations.filter(({ active }) => active);

/** Canon rule context for the fixed Mistwood fixture (identical to the ART-97/98 tests). */
function mistwoodRuleContext(): CanonRuleContext {
  return {
    worldId: LONG_RUN_WORLD_ID,
    rules: mistwoodWorldConfiguration.immutableRules,
    characterIds: mistwoodCharacterSeed.characters.map(({ id }) => id),
    locationIds: activeLocations.map(({ id }) => id),
    itemIds: mistwoodCharacterSeed.assets.map(({ id }) => id),
    organizationIds: mistwoodWorldConfiguration.organizations.map(({ id }) => id),
    initialCharacterAlive: Object.fromEntries(mistwoodCharacterSeed.characters.map(({ id }) => [id, true])),
    initialItemOwners: Object.fromEntries(mistwoodCharacterSeed.assets.map(({ id, ownerCharacterId }) => [id, ownerCharacterId])),
    locationConnections: Object.fromEntries(activeLocations.map(({ id, connectedLocationIds }) => [id, connectedLocationIds])),
  };
}

function seededCanonStore(): InMemoryCanonStore {
  const store = new InMemoryCanonStore();
  store.setCanonRuleContext(mistwoodRuleContext());
  return store;
}

// --- durable run stores ------------------------------------------------------

class MemoryWorldDayRunStore implements WorldDayRunStore {
  private readonly runs = new Map<string, WorldDayRun>();
  private readonly checkpoints: WorldDayCheckpoint[] = [];
  loadRun(runId: string): Promise<WorldDayRun | null> {
    const run = this.runs.get(runId);
    return Promise.resolve(run ? structuredClone(run) : null);
  }
  createRun(input: WorldDayRunInput): Promise<WorldDayRun> {
    const run: WorldDayRun = { ...input, status: 'running', attemptCount: 1 };
    this.runs.set(input.runId, run);
    return Promise.resolve(structuredClone(run));
  }
  listCheckpoints(runId: string): Promise<WorldDayCheckpoint[]> {
    return Promise.resolve(structuredClone(this.checkpoints.filter((row) => row.runId === runId)));
  }
  startCheckpoint(runId: string, stage: WorldDayStage, attempt: number): Promise<void> {
    this.checkpoints.push({ runId, stage, attempt, status: 'running' });
    return Promise.resolve();
  }
  completeCheckpoint(runId: string, stage: WorldDayStage, attempt: number, artifact: unknown): Promise<void> {
    Object.assign(this.find(runId, stage, attempt), { status: 'completed', artifact: structuredClone(artifact) });
    return Promise.resolve();
  }
  failCheckpoint(runId: string, stage: WorldDayStage, attempt: number, error: WorldDayRunFailure): Promise<void> {
    Object.assign(this.find(runId, stage, attempt), { status: 'failed', errorCode: error.code, errorMessage: error.message });
    return Promise.resolve();
  }
  resumeRun(runId: string, attempt: number): Promise<void> {
    Object.assign(this.required(runId), { status: 'running', attemptCount: attempt });
    return Promise.resolve();
  }
  failRun(runId: string, stage: WorldDayStage, error: WorldDayRunFailure): Promise<void> {
    Object.assign(this.required(runId), { status: 'failed', failureStage: stage, errorCode: error.code, errorMessage: error.message });
    return Promise.resolve();
  }
  completeRun(runId: string, committedEventIds: string[]): Promise<void> {
    Object.assign(this.required(runId), { status: 'completed', committedEventIds });
    return Promise.resolve();
  }
  private required(runId: string): WorldDayRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error('missing run');
    return run;
  }
  private find(runId: string, stage: WorldDayStage, attempt: number): WorldDayCheckpoint {
    const row = this.checkpoints.find((candidate) =>
      candidate.runId === runId && candidate.stage === stage && candidate.attempt === attempt);
    if (!row) throw new Error('missing checkpoint');
    return row;
  }
}

class MemoryPostCommitRunStore implements PostCommitRunStore {
  private readonly runs = new Map<string, PostCommitRun>();
  readonly checkpoints: PostCommitCheckpoint[] = [];
  loadRun(runId: string): Promise<PostCommitRun | null> {
    const run = this.runs.get(runId);
    return Promise.resolve(run ? structuredClone(run) : null);
  }
  createRun(input: PostCommitRunInput): Promise<PostCommitRun> {
    const run: PostCommitRun = { ...input, status: 'running', attemptCount: 1 };
    this.runs.set(input.runId, run);
    return Promise.resolve(structuredClone(run));
  }
  listCheckpoints(runId: string): Promise<PostCommitCheckpoint[]> {
    return Promise.resolve(structuredClone(this.checkpoints.filter((row) => row.runId === runId)));
  }
  startCheckpoint(runId: string, stage: PostCommitStage, attempt: number): Promise<void> {
    this.checkpoints.push({ runId, stage, attempt, status: 'running' });
    return Promise.resolve();
  }
  completeCheckpoint(runId: string, stage: PostCommitStage, attempt: number, artifact: unknown): Promise<void> {
    Object.assign(this.find(runId, stage, attempt), { status: 'completed', artifact: structuredClone(artifact) });
    return Promise.resolve();
  }
  failCheckpoint(runId: string, stage: PostCommitStage, attempt: number, error: RunFailure): Promise<void> {
    Object.assign(this.find(runId, stage, attempt), { status: 'failed', errorCode: error.code, errorMessage: error.message });
    return Promise.resolve();
  }
  resumeRun(runId: string, attempt: number): Promise<void> {
    Object.assign(this.required(runId), { status: 'running', attemptCount: attempt });
    return Promise.resolve();
  }
  failRun(runId: string, stage: PostCommitStage, error: RunFailure): Promise<void> {
    Object.assign(this.required(runId), { status: 'failed', failureStage: stage, errorCode: error.code, errorMessage: error.message });
    return Promise.resolve();
  }
  completeRun(runId: string, metricsTraceId: string): Promise<void> {
    Object.assign(this.required(runId), { status: 'completed', metricsTraceId });
    return Promise.resolve();
  }
  private required(runId: string): PostCommitRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error('missing run');
    return run;
  }
  private find(runId: string, stage: PostCommitStage, attempt: number): PostCommitCheckpoint {
    const row = this.checkpoints.find((candidate) =>
      candidate.runId === runId && candidate.stage === stage && candidate.attempt === attempt);
    if (!row) throw new Error('missing checkpoint');
    return row;
  }
}

class MemoryReadStore implements PublicReadStore {
  readonly rows: StoredReadModel[] = [];
  private counter = 0;
  loadTargetVersions(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<readonly StoredReadModel[]> {
    return Promise.resolve(this.rows.filter((row) =>
      row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef));
  }
  findCurrent(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<StoredReadModel | null> {
    return Promise.resolve(this.rows.find((row) =>
      row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isCurrent) ?? null);
  }
  loadLastKnownGood(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<readonly StoredReadModel[]> {
    return Promise.resolve(this.rows.filter((row) =>
      row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isLastKnownGood));
  }
  insertVersion(record: PublishedReadModel): Promise<string> {
    this.counter += 1;
    const id = `id-${this.counter}`;
    this.rows.push({ ...record, id });
    return Promise.resolve(id);
  }
  markCurrent(rowId: string, patch: Parameters<PublicReadStore['markCurrent']>[1]): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === rowId);
    if (!row) throw new Error('ROW_NOT_FOUND');
    row.isCurrent = patch.isCurrent;
    row.isLastKnownGood = patch.isLastKnownGood;
    row.status = patch.status;
    return Promise.resolve();
  }
}

// --- observed state ----------------------------------------------------------

type ArcRecord = { lifecycle: ArcLifecycleRecord; projections: ArcProjectionEvent[] };
type EpisodeRecord = { status: string; episodeNumber: number; episode?: DailyEpisode; safetyClassificationId: string | null };

const OPERATOR = { type: 'operations' as const, operatorId: 'art-60-harness' };
const ACTOR = { type: 'system' as const, id: 'art-60-harness' };

/** Everything the harness observes while the live pipeline runs. */
type Observations = {
  simulations: SceneSimulationResult[];
  plannedAppearance: Array<{ characterId: string; slotsSinceMajorAppearance: number; worldDay: number; timeSlot: TimeSlot }>;
};

// --- world-day port ----------------------------------------------------------

/**
 * In-memory {@link WorldDayLivePort} over the fixed Mistwood seed. It records every
 * simulated scene (safety verdict and provider trace included) and every Director planning
 * input, which is what makes the safety, repetition, token and appearance checks
 * observations of the live run rather than a re-derivation.
 */
function createWorldDayPort(
  store: InMemoryCanonStore,
  observations: Observations,
  activeArcsOf: () => LiveArc[],
): WorldDayLivePort {
  return {
    canonStore: store,
    async loadWorldSnapshot(slot: WorldDaySlotIdentity) {
      const acceptedEvents = await store.loadAcceptedEvents(slot.worldId);
      const snapshot = buildLiveWorldSnapshot({
        slot,
        acceptedEvents,
        projection: replayWorldEvents(emptyProjection(slot.worldId), acceptedEvents),
        characters: mistwoodCharacterSeed.characters.map(({ id, publicProfile, publicGoal, initialLocationId }) =>
          ({ characterId: id, personaSummary: publicProfile, currentGoal: publicGoal, initialLocationId })),
        locationConnections: Object.fromEntries(activeLocations.map(({ id, connectedLocationIds }) => [id, connectedLocationIds])),
        seedKnowledge: mistwoodCharacterSeed.knowledge.map(({ id, characterId, content }) =>
          ({ characterId, knowledgeId: id, belief: content })),
        seedAssets: mistwoodCharacterSeed.assets.map(({ id, ownerCharacterId }) => ({ characterId: ownerCharacterId, assetId: id })),
        secretIds: mistwoodCharacterSeed.secrets.map(({ id }) => id),
        activeArcs: activeArcsOf(),
      });
      for (const character of snapshot.characters) {
        observations.plannedAppearance.push({
          characterId: character.characterId,
          slotsSinceMajorAppearance: character.slotsSinceMajorAppearance,
          worldDay: slot.worldDay,
          timeSlot: slot.timeSlot,
        });
      }
      return snapshot;
    },
    loadScheduledEnvironmentEvents: () => Promise.resolve([]),
    persistDirectorPlan: () => Promise.resolve(),
    persistCharacterIntent: () => Promise.resolve(),
    persistGroupedScenes: () => Promise.resolve(),
    persistSceneSimulation: (_groupingRunId, result) => {
      observations.simulations.push(result);
      return Promise.resolve();
    },
  };
}

// --- post-commit port --------------------------------------------------------

/**
 * In-memory {@link PostCommitLivePort} that runs the REAL downstream capabilities: arc
 * classification/portfolio/lifecycle/projection/stagnation, the daily-episode builder and
 * its safety classifier, the recap builder, the publication lifecycle, and the public
 * read-model builders published through `commitReadModelVersion`.
 *
 * It mirrors the port ART-98's own integration test binds, so the long run exercises the
 * same downstream contracts that task verified for a single day.
 */
function createPostCommitHarness(canon: InMemoryCanonStore, readStore: MemoryReadStore) {
  const arcs = new Map<string, ArcRecord>();
  const classifications = new Map<number, ArcEventClassification>();
  const portfolio: ArcPortfolioEntry[] = [];
  const episodes = new Map<number, EpisodeRecord>();
  const recaps: RecapSnapshot[] = [];
  const publications = new Map<string, PublicationRecord>();
  const stagnationPrompts: Array<{ arcId: string; stagnantWorldDays: number; status: string }> = [];
  let now = 10_000;

  const events = (): AcceptedEvent[] => canon.committedEvents();
  const arcProjectionData = (arcId: string) => {
    const record = arcs.get(arcId);
    if (!record) throw new Error(`unknown arc ${arcId}`);
    return replayArcProjection(record.projections, record.lifecycle.status);
  };
  const publish = async (modelKind: ReadModelKind, modelRef: string, payload: unknown, sourceEventIds: string[]) => {
    now += 1;
    await commitReadModelVersion(readStore, {
      worldId: LONG_RUN_WORLD_ID, modelKind, modelRef, payload: payload as never,
      sourceEventIds, status: SERVABLE_STATUS, now,
    });
    return modelRef;
  };
  const membershipsBySequence = () => new Map(
    [...classifications.values()].map((entry) => [entry.sourceEventSequenceNumber, entry.memberships]),
  );
  const importanceBySequence = () => new Map(
    [...classifications.values()].map((entry) => [
      entry.sourceEventSequenceNumber,
      entry.memberships.reduce((max, membership) => Math.max(max, membership.importance), 0),
    ]),
  );
  const episodeRefs = () => [...episodes.entries()]
    .filter(([, row]) => row.episode)
    .map(([worldDay, row]) => ({ episodeNumber: row.episodeNumber, worldDay, sourceEventIds: row.episode!.sourceEventIds }));

  const port: PostCommitLivePort = {
    loadWorldState(source: PostCommitSource): Promise<PostCommitWorldState> {
      const all = events();
      const event = all.find(({ sequenceNumber }) => sequenceNumber === source.sourceEventSequenceNumber);
      if (!event) throw new Error('POST_COMMIT_SOURCE_NOT_ACCEPTED');
      const days = [...new Set(all.map(({ worldDay }) => worldDay))].sort((left, right) => left - right);
      const latestWorldDay = days[days.length - 1];
      const completed = days.filter((day) => day < latestWorldDay
        || all.some((candidate) => candidate.worldDay === day && candidate.timeSlot === TIME_SLOTS[TIME_SLOTS.length - 1]));
      const recapCursors: Record<string, number> = {};
      for (const snapshot of recaps) {
        const key = recapTargetKey(snapshot.recapType, snapshot.targetId);
        recapCursors[key] = Math.max(recapCursors[key] ?? -1, snapshot.sourceToSequenceNumber);
      }
      return Promise.resolve({
        event,
        arcs: [...arcs.values()].map((record): LiveArcState => ({
          arcId: record.lifecycle.arcId,
          status: record.lifecycle.status,
          projectionRevision: record.projections.length - 1,
          fields: record.projections[record.projections.length - 1].fields,
          tier: portfolio.find(({ projection }) => projection.arcId === record.lifecycle.arcId)?.tier ?? null,
          lastTransitionWorldDay: record.lifecycle.transitions.reduce((highest, transition) => Math.max(
            highest,
            all.find(({ sequenceNumber }) => sequenceNumber === transition.sourceEventSequenceNumber)?.worldDay ?? 0,
          ), 0),
        })),
        characterIds: mistwoodCharacterSeed.characters.map(({ id }) => id),
        completedWorldDays: completed,
        episodeWorldDays: [...episodes.keys()],
        worldDayFirstSequenceNumber: all.filter(({ worldDay }) => worldDay === event.worldDay)
          .reduce((lowest, candidate) => Math.min(lowest, candidate.sequenceNumber), event.sequenceNumber),
        latestWorldDay,
        recapCursors,
      });
    },

    rebuildWorldProjection: (worldId) => Promise.resolve(`world:${worldId}`),
    rebuildCharacterProjection: (_worldId, characterId) => Promise.resolve(`character:${characterId}`),

    loadCharacterKnowledge(worldId, characterId) {
      const projection = replayWorldEvents(emptyProjection(worldId), events());
      return Promise.resolve(authorizeKnowledgeRead(projection.characterKnowledge, characterId, OPERATOR));
    },
    loadCharacterMemories(worldId, characterId) {
      const projection = replayWorldEvents(emptyProjection(worldId), events());
      return Promise.resolve(authorizeMemoryRead(projection.characterMemories, characterId, OPERATOR));
    },
    rebuildRelationshipProjection: (_worldId, source, target) =>
      Promise.resolve(`relationship:${[source, target].sort().join('|')}`),

    recordArcClassification(classification) {
      if (classifications.has(classification.sourceEventSequenceNumber)) return Promise.resolve({ created: false });
      classifications.set(classification.sourceEventSequenceNumber, classification);
      const proposal = classification.newArc;
      if (proposal) {
        const source = events().find(({ sequenceNumber }) => sequenceNumber === classification.sourceEventSequenceNumber)!;
        const membership = classification.memberships.find(({ arcId }) => arcId === proposal.arcId)!;
        arcs.set(proposal.arcId, {
          lifecycle: createArcLifecycle(LONG_RUN_WORLD_ID, proposal.arcId, {
            sourceEventId: classification.sourceEventId,
            sourceEventSequenceNumber: classification.sourceEventSequenceNumber,
            reason: 'accepted event classified as inciting incident',
            changedAt: source.acceptedAt,
          }),
          projections: [{
            schemaVersion: 1, worldId: LONG_RUN_WORLD_ID, arcId: proposal.arcId, revision: 0, kind: 'initialized',
            fields: {
              title: proposal.title, premise: proposal.premise, currentQuestion: proposal.currentQuestion,
              coreCharacterIds: proposal.coreCharacterIds, incitingEventId: classification.sourceEventId,
              latestTurningPointEventId: null, essentialFactIds: [], unresolvedQuestions: [proposal.currentQuestion],
              resolvedQuestions: [], recommendedEntryEventId: null, heatScore: Math.round(membership.importance * 100),
            },
            sourceEventId: classification.sourceEventId,
            sourceEventSequenceNumber: classification.sourceEventSequenceNumber,
            worldDay: source.worldDay, timeSlot: source.timeSlot,
          }],
        });
      }
      return Promise.resolve({ created: true });
    },

    admitArcToPortfolio(_worldId, candidate, remediation) {
      const { entries, decision } = applyArcPortfolioControl(portfolio, candidate, remediation);
      portfolio.splice(0, portfolio.length, ...entries);
      return Promise.resolve(decision);
    },

    syncArcPortfolioEntry(_worldId, arcId) {
      const entry = portfolio.find(({ projection }) => projection.arcId === arcId);
      if (!entry || !arcs.has(arcId)) return Promise.resolve(false);
      entry.projection = arcProjectionData(arcId);
      return Promise.resolve(true);
    },

    transitionArcLifecycle(input) {
      const record = arcs.get(input.arcId);
      if (!record) throw new Error(`unknown arc ${input.arcId}`);
      record.lifecycle = transitionArcLifecycle(record.lifecycle, { ...input, changedAt: now });
      return Promise.resolve({ status: record.lifecycle.status });
    },

    updateArcProjection(input) {
      const record = arcs.get(input.arcId);
      if (!record) throw new Error(`unknown arc ${input.arcId}`);
      if (record.projections.length - 1 !== input.expectedRevision) throw new Error('ARC_PROJECTION_SEQUENCE_CONFLICT');
      const source = events().find(({ sequenceNumber }) => sequenceNumber === input.sourceEventSequenceNumber)!;
      const revision = record.projections.length;
      record.projections.push({
        schemaVersion: 1, worldId: LONG_RUN_WORLD_ID, arcId: input.arcId, revision, kind: 'updated', fields: input.fields,
        sourceEventId: input.sourceEventId, sourceEventSequenceNumber: input.sourceEventSequenceNumber,
        worldDay: source.worldDay, timeSlot: source.timeSlot,
      });
      return Promise.resolve({ revision });
    },

    // ART-31 driven live: every prompt raised during the run is retained so the harness can
    // report an arc that outlived ARC_STAGNATION_WORLD_DAYS without being resolved.
    refreshStagnationPrompts(_worldId, currentWorldDay) {
      let raised = 0;
      for (const entry of portfolio) {
        const prompt = detectArcStagnation(entry.projection, entry.tier, currentWorldDay);
        if (!prompt) continue;
        raised += 1;
        stagnationPrompts.push({ arcId: prompt.arcId, stagnantWorldDays: prompt.stagnantWorldDays, status: prompt.status });
      }
      return Promise.resolve(raised);
    },

    generateEpisode(worldId, worldDay, episodeNumber) {
      const prior = episodes.get(worldDay);
      if (prior) return Promise.resolve({ status: prior.status, episodeNumber: prior.episodeNumber, deduplicated: true });
      const memberships = membershipsBySequence();
      const questions = new Map([...arcs.keys()].map((arcId) => [arcId, arcProjectionData(arcId).currentQuestion]));
      const sources = episodeSourceEvents(events(), worldDay, memberships, classifications, questions);
      const episode = validateDailyEpisode(
        buildDailyEpisode(worldId, worldDay, episodeNumber, sources), sources,
        mistwoodCharacterSeed.secrets.map(({ content }) => content),
      );
      const safety = classifyPostGeneration({
        classificationId: `episode:${worldId}:${worldDay}`, worldId, sourceId: `episode:${episodeNumber}`,
        kind: 'public_artifact', text: dailyEpisodePublicText(episode), coreFactIds: episode.sourceEventIds,
      });
      const safe = safety.label === 'allow' || safety.label === 'allow_with_warning';
      const status = safe ? 'ready' : 'withheld';
      episodes.set(worldDay, { status, episodeNumber, episode: safe ? episode : undefined, safetyClassificationId: safety.classificationId });
      return Promise.resolve({ status, episodeNumber, deduplicated: false });
    },

    generateRecap(worldId, request) {
      const existing = recaps.find(({ id }) => id === request.snapshotId);
      if (existing) return Promise.resolve({ snapshotId: existing.id, deduplicated: true });
      const prior = recaps.filter(({ recapType, targetId }) =>
        recapType === request.recapType && targetId === request.targetId).at(-1) ?? null;
      const snapshot = buildRecapSnapshot({
        id: request.snapshotId, worldId, recapType: request.recapType, targetId: request.targetId, prior,
        acceptedEvents: events().filter(({ sequenceNumber }) =>
          sequenceNumber >= request.fromSequenceNumber && sequenceNumber <= request.toSequenceNumber),
        mode: 'incremental', generatedAt: now,
      });
      recaps.push(snapshot);
      return Promise.resolve({ snapshotId: snapshot.id, deduplicated: false });
    },

    loadEpisodeStatus(_worldId, worldDay) {
      const row = episodes.get(worldDay);
      return Promise.resolve(row
        ? { status: row.status, safetyClassificationId: row.safetyClassificationId, hasEpisode: Boolean(row.episode) }
        : null);
    },

    createPublication(worldId, contentRef, summary) {
      const existing = publications.get(contentRef);
      if (existing) return Promise.resolve({ status: existing.status });
      const record = createPublicationRecord({
        publicationId: `pub:${contentRef}:1`, worldId, contentKind: 'episode', contentRef,
        summary, actor: ACTOR, reason: 'long-run harness', at: now,
      });
      publications.set(contentRef, record);
      return Promise.resolve({ status: record.status });
    },

    advancePublication(_worldId, contentRef, action) {
      const record = publications.get(contentRef);
      if (!record) throw new Error('PUBLICATION_NOT_FOUND');
      const next = transitionPublication(record, action, ACTOR, 'long-run harness', now);
      publications.set(contentRef, next);
      return Promise.resolve({ status: next.status });
    },

    reassessArcEntries(worldId) {
      const reassessed: string[] = [];
      const worldEpisodes = episodeRefs();
      const latestSequenceNumber = events().at(-1)?.sequenceNumber ?? 0;
      for (const entry of portfolio) {
        if (entry.tier !== 'major' || !isActiveArcStatus(entry.projection.status)) continue;
        recommendArcEntry({
          worldId, arcId: entry.projection.arcId, projection: entry.projection,
          arcEpisodes: worldEpisodes.filter(({ worldDay }) => episodes.get(worldDay)?.episode?.arcIds.includes(entry.projection.arcId)),
          worldEpisodes, latestSequenceNumber,
        });
        reassessed.push(entry.projection.arcId);
      }
      return Promise.resolve(reassessed);
    },

    rebuildEpisodeProjection(worldId, worldDay) {
      const row = episodes.get(worldDay);
      if (!row?.episode) throw new Error('EPISODE_NOT_ELIGIBLE');
      const payload = buildEpisodeProjection({ worldId, episode: row.episode, status: row.status });
      return publish(EPISODE_MODEL_KIND, `episode:${worldDay}`, payload, payload.sourceEventIds);
    },

    rebuildEpisodeIndexProjection(worldId) {
      const payload = buildEpisodeIndex({
        worldId,
        episodes: [...episodes.values()].filter(({ episode }) => episode).map((row) => ({
          worldDay: row.episode!.worldDay, episodeNumber: row.episode!.episodeNumber, title: row.episode!.title,
          headline: row.episode!.headline, status: row.status, arcIds: row.episode!.arcIds,
          characterIds: row.episode!.characterIds, sourceEventIds: row.episode!.sourceEventIds,
        })),
        recommendedEntryWorldDays: new Set<number>(),
        turningPointEventIds: new Set([...arcs.keys()]
          .map((arcId) => arcProjectionData(arcId).latestTurningPointEventId)
          .filter((id): id is string => id !== null)),
      });
      return publish(EPISODE_INDEX_MODEL_KIND, `episodes:${worldId}`, payload, payload.episodes.map(({ worldDay }) => `day:${worldDay}`));
    },

    rebuildTimelineProjection(worldId) {
      const memberships = membershipsBySequence();
      const importance = importanceBySequence();
      const entries: TimelineEntryInput[] = events().map((event) => ({
        eventId: event.eventId, worldDay: event.worldDay, timeSlot: event.timeSlot, eventType: event.eventType,
        publicSummary: event.publicSummary ?? null, importance: importance.get(event.sequenceNumber) ?? 0,
        arcIds: (memberships.get(event.sequenceNumber) ?? []).map(({ arcId }) => arcId),
        characterIds: [...event.participantIds],
        episodeNumber: episodes.get(event.worldDay)?.episodeNumber ?? null,
      }));
      const payload = buildTimelineProjection({ worldId, entries });
      return publish(TIMELINE_MODEL_KIND, `timeline:${worldId}`, payload, payload.entries.map(({ eventId }) => eventId));
    },

    rebuildArcReadModel(worldId, arcId) {
      const projection = arcProjectionData(arcId);
      const payload = buildArcProjection({
        worldId,
        arc: {
          arcId, title: projection.title, premise: projection.premise, currentQuestion: projection.currentQuestion,
          status: projection.status, coreCharacterIds: projection.coreCharacterIds,
          incitingEventId: projection.incitingEventId, latestTurningPointEventId: projection.latestTurningPointEventId,
          unresolvedQuestions: projection.unresolvedQuestions,
        },
        essentialBackstory: [], recommendedEntry: null,
        relatedEpisodes: episodeRefs().filter(({ worldDay }) => episodes.get(worldDay)?.episode?.arcIds.includes(arcId))
          .map(({ episodeNumber, worldDay }) => ({ episodeNumber, worldDay })),
        knownClues: [], outcome: null,
      });
      return publish(ARC_MODEL_KIND, `arc:${arcId}`, payload, [projection.incitingEventId]);
    },

    rebuildArcPrimer: (_worldId, arcId) => Promise.resolve(`primer:${arcId}`),

    rebuildLiveProjection(worldId) {
      const payload = buildLiveProjection({
        worldId, acceptedEvents: events(),
        arcs: [...arcs.keys()].map((arcId) => {
          const projection = arcProjectionData(arcId);
          return { arcId, title: projection.title, currentQuestion: projection.currentQuestion, status: projection.status };
        }),
        publishedEpisode: null,
      });
      return publish(LIVE_MODEL_KIND, `live:${worldId}`, payload, liveSourceEventIds(payload));
    },

    rebuildOnboardingSummary: (worldId) => Promise.resolve(`onboarding:${worldId}`),

    // ART-99: a world seeded through importWorld cannot take a daily snapshot, so the
    // harness stands in for the snapshot store rather than asserting a known-broken path.
    persistDailySnapshot: (_worldId, worldDay) => Promise.resolve({ snapshotId: `snapshot:${worldDay}`, deduplicated: false }),

    loadStageMetrics: () => Promise.resolve({
      stages: POST_COMMIT_STAGES.map((stage) => ({ stage, status: 'completed' as const, durationMs: 0 })),
      recordedAt: now,
    }),
  };

  const activeArcsForDirector = (): LiveArc[] => [...arcs.values()]
    .filter(({ lifecycle }) => isActiveArcStatus(lifecycle.status))
    .map(({ lifecycle, projections }) => {
      const latest = projections[projections.length - 1];
      return {
        arcId: lifecycle.arcId,
        currentQuestion: latest.fields.currentQuestion,
        status: lifecycle.status as LiveArc['status'],
        sourceEventId: latest.sourceEventId,
      };
    })
    .sort((left, right) => left.arcId.localeCompare(right.arcId));

  /**
   * Active MAJOR arcs right now, read from the authoritative lifecycle record joined to the
   * portfolio tier. The portfolio's own projection copy is only refreshed when an event
   * touches that arc, so counting it directly would report a stale status.
   */
  const isMajor = (arcId: string): boolean =>
    portfolio.find(({ projection }) => projection.arcId === arcId)?.tier === 'major';
  const activeMajorArcIds = (): string[] => [...arcs.values()]
    .filter(({ lifecycle }) => isActiveArcStatus(lifecycle.status) && isMajor(lifecycle.arcId))
    .map(({ lifecycle }) => lifecycle.arcId).sort();
  /** Major arcs still carried by the portfolio, `emerging` included. */
  const unresolvedMajorArcIds = (): string[] => [...arcs.values()]
    .filter(({ lifecycle }) => lifecycle.status !== 'resolved' && lifecycle.status !== 'archived'
      && isMajor(lifecycle.arcId))
    .map(({ lifecycle }) => lifecycle.arcId).sort();

  const arcStatusCounts = (): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const { lifecycle } of arcs.values()) counts[lifecycle.status] = (counts[lifecycle.status] ?? 0) + 1;
    return counts;
  };

  return {
    port, arcs, portfolio, episodes, recaps, classifications, stagnationPrompts,
    activeArcsForDirector, activeMajorArcIds, unresolvedMajorArcIds, arcStatusCounts,
  };
}

/** Derive the ART-33 episode source rows for one world day (the ART-98 derivation). */
function episodeSourceEvents(
  all: readonly AcceptedEvent[],
  worldDay: number,
  memberships: Map<number, ArcEventClassification['memberships']>,
  classifications: Map<number, ArcEventClassification>,
  questions: Map<string, string>,
): EpisodeSourceEvent[] {
  return all.filter((event) => event.worldDay === worldDay).map((event) => {
    const entries = memberships.get(event.sequenceNumber) ?? [];
    return {
      eventId: event.eventId,
      publicSummary: event.publicSummary ?? null,
      participantIds: [...event.participantIds],
      arcIds: entries.map(({ arcId }) => arcId),
      importance: entries.reduce((max, entry) => Math.max(max, entry.importance), 0),
      publicFactIds: event.stateChanges.flatMap((change, index) =>
        change.type === 'fact_created' && change.visibility === 'public' ? [`${event.eventId}:fact:${index}`] : []),
      publicRelationshipChanges: event.stateChanges.flatMap((change) => change.type === 'relationship_changed'
        && change.visibility === 'public'
        ? [`Relationship changed between ${change.sourceCharacterId} and ${change.targetCharacterId}.`] : []),
      newQuestions: classifications.get(event.sequenceNumber)?.newArc
        ? [classifications.get(event.sequenceNumber)!.newArc!.currentQuestion] : [],
      resolvedQuestions: entries.filter(({ role }) => role === 'resolution')
        .flatMap(({ arcId }) => (questions.get(arcId) ? [questions.get(arcId) as string] : [])),
    };
  });
}

// --- checks ------------------------------------------------------------------

/** An accepted event stripped back to the proposal it was validated as. */
function acceptedAsProposed(event: AcceptedEvent): ProposedEvent {
  return {
    schemaVersion: event.schemaVersion, worldId: event.worldId, idempotencyKey: event.idempotencyKey,
    proposedBy: event.proposedBy, worldDay: event.worldDay, timeSlot: event.timeSlot, eventType: event.eventType,
    locationId: event.locationId, participantIds: [...event.participantIds],
    causedByEventIds: [...event.causedByEventIds], publicSummary: event.publicSummary,
    stateChanges: structuredClone(event.stateChanges),
  };
}

/**
 * Independently re-validate the accepted log.
 *
 * A failed run reports its own stage and error code, but a validation error that was
 * *swallowed* would leave no trace there — so the harness re-runs `validateEventStructure`
 * and `validateCanon` over every accepted event against the projection as it stood
 * immediately before that event, plus the append-only invariants (dense sequence numbers,
 * unique idempotency keys). Any finding here means Canon accepted something it should not
 * have.
 */
function revalidateAcceptedLog(events: readonly AcceptedEvent[], ruleContext: CanonRuleContext): CanonConflictFinding[] {
  const findings: CanonConflictFinding[] = [];
  const seenKeys = new Set<string>();
  let projection = emptyProjection(LONG_RUN_WORLD_ID);
  events.forEach((event, index) => {
    if (event.sequenceNumber !== index) {
      findings.push({
        source: 'sequence', subjectId: event.eventId, code: 'SEQUENCE_NOT_DENSE',
        detail: `event at position ${index} carries sequence number ${event.sequenceNumber}`,
      });
    }
    if (seenKeys.has(event.idempotencyKey)) {
      findings.push({
        source: 'idempotency', subjectId: event.eventId, code: 'DUPLICATE_IDEMPOTENCY_KEY',
        detail: `idempotency key ${event.idempotencyKey} was accepted twice`,
      });
    }
    seenKeys.add(event.idempotencyKey);
    const proposed = acceptedAsProposed(event);
    const structural = validateEventStructure(proposed);
    if (structural) {
      findings.push({
        source: 'accepted_event_revalidation', subjectId: event.eventId, code: structural.code, detail: structural.message,
      });
    }
    const canon = validateCanon(proposed, projection, {
      ...ruleContext,
      knownEventIds: events.slice(0, index).map(({ eventId }) => eventId),
    });
    if (canon) {
      findings.push({
        source: 'accepted_event_revalidation', subjectId: event.eventId, code: canon.code, detail: canon.message,
      });
    }
    projection = replayWorldEvents(projection, [event]);
  });
  return findings;
}

/**
 * Content digest of one simulated scene, used for the repetition check.
 *
 * Method: a 128-bit FNV-1a digest ({@link contentDigest}) over the canonical JSON of the
 * scene's authored prose only — summary, key actions, dialogue lines and the Proposed
 * Event public summaries. Scene IDs, run IDs, world day and time slot are deliberately
 * EXCLUDED, because they are unique by construction and would make every scene trivially
 * distinct. Two scenes sharing a digest therefore told the audience the same thing.
 */
export function sceneContentDigest(result: SceneSimulationResult): string {
  return contentDigest({
    sceneSummary: result.output.sceneSummary,
    keyActions: result.output.keyActions.map(({ characterId, action }) => [characterId, action]),
    dialogue: result.output.dialogueHighlights.map(({ characterId, text }) => [characterId, text]),
    publicSummaries: result.output.proposedEvents.map(({ publicSummary }) => publicSummary ?? ''),
  });
}

/** FR-G004 coverage sources for one world day, derived from the accepted log (ART-35). */
function coverageSources(
  events: readonly AcceptedEvent[],
  importance: Map<number, number>,
  turningPoints: Map<string, string[]>,
): CoverageSourceEvent[] {
  return events.map((event) => ({
    eventId: event.eventId,
    worldDay: event.worldDay,
    importance: importance.get(event.sequenceNumber) ?? 0,
    turningPointArcIds: turningPoints.get(event.eventId) ?? [],
    relationshipChanges: event.stateChanges.flatMap((change, index) => change.type === 'relationship_changed'
      ? [{
        changeId: deriveRelationshipChangeId(event.eventId, index),
        sourceCharacterId: change.sourceCharacterId,
        targetCharacterId: change.targetCharacterId,
        magnitude: relationshipChangeMagnitude(change),
        visibility: change.visibility === 'public' ? ('public' as const) : ('private' as const),
      }]
      : []),
    publicFactIds: event.stateChanges.flatMap((change, index) =>
      change.type === 'fact_created' && change.visibility === 'public' ? [`${event.eventId}:fact:${index}`] : []),
    privateFactIds: event.stateChanges.flatMap((change, index) =>
      change.type === 'fact_created' && change.visibility !== 'public' ? [`${event.eventId}:fact:${index}`] : []),
  }));
}

// --- the run -----------------------------------------------------------------

export type LongRunInput = {
  worldDays: number;
  startWorldDay?: number;
};

/**
 * Run `worldDays` consecutive world days of the live pipeline against the fixed seed and
 * return the machine-readable findings.
 *
 * Throws only when the harness itself is misconfigured; a pipeline failure is reported as
 * a finding, never as a thrown error, so a failing run still yields a full report.
 */
export async function runLongRunSimulation(input: LongRunInput): Promise<LongRunFindings> {
  const { worldDays } = input;
  const startWorldDay = input.startWorldDay ?? 0;
  if (!Number.isSafeInteger(worldDays) || worldDays < 1) throw new Error('LONG_RUN_INVALID_WORLD_DAYS');

  const canon = seededCanonStore();
  const readStore = new MemoryReadStore();
  const harness = createPostCommitHarness(canon, readStore);
  const observations: Observations = { simulations: [], plannedAppearance: [] };
  const worldDayRunStore = new MemoryWorldDayRunStore();
  const postCommitRunStore = new MemoryPostCommitRunStore();
  const worldDayHandlers = createWorldDayStageHandlers(
    createWorldDayPort(canon, observations, harness.activeArcsForDirector),
  );
  const postCommitHandlers = createPostCommitStageHandlers(harness.port);

  const slots: SlotOutcome[] = [];
  const canonConflicts: CanonConflictFinding[] = [];
  const activeMajorByWorldDay: number[] = [];
  const unresolvedMajorByWorldDay: number[] = [];
  const arcStatusByWorldDay: Array<Record<string, number>> = [];
  const arcsResolvedDuringRun = new Set<string>();
  let processedEvents = 0;
  let liveDigest = projectionDigest(emptyProjection(LONG_RUN_WORLD_ID));

  for (let offset = 0; offset < worldDays; offset += 1) {
    const worldDay = startWorldDay + offset;
    for (const timeSlot of TIME_SLOTS) {
      const slot: WorldDaySlotIdentity = { worldId: LONG_RUN_WORLD_ID, worldDay, timeSlot };
      const run = await executeWorldDay({ runId: worldDayRunId(slot), ...slot }, worldDayRunStore, worldDayHandlers);
      slots.push({
        worldDay, timeSlot, status: run.status, attemptCount: run.attemptCount,
        committedEventIds: run.committedEventIds ?? [],
        failureStage: run.failureStage ?? null, errorCode: run.errorCode ?? null,
      });
      if (run.status !== 'completed') {
        canonConflicts.push({
          source: 'world_day_run', subjectId: worldDayRunId(slot),
          code: run.errorCode ?? 'WORLD_DAY_RUN_FAILED',
          detail: `${run.failureStage ?? 'unknown stage'}: ${run.errorMessage ?? 'no message'}`,
        });
      }

      // Stages 11–21 for every newly accepted event, in canon order.
      const accepted = canon.committedEvents();
      for (const event of accepted.slice(processedEvents)) {
        const postCommitInput: PostCommitRunInput = {
          runId: postCommitRunId(LONG_RUN_WORLD_ID, event.sequenceNumber), worldId: LONG_RUN_WORLD_ID,
          sourceEventId: event.eventId, sourceEventSequenceNumber: event.sequenceNumber, worldDay: event.worldDay,
        };
        const postRun = await executePostCommitPipeline(postCommitInput, postCommitRunStore, postCommitHandlers, event.traceId);
        if (postRun.status !== 'completed') {
          canonConflicts.push({
            source: 'post_commit_run', subjectId: postCommitInput.runId,
            code: postRun.errorCode ?? 'POST_COMMIT_RUN_FAILED',
            detail: `${postRun.failureStage ?? 'unknown stage'}: ${postRun.errorMessage ?? 'no message'}`,
          });
        }
      }
      processedEvents = accepted.length;
      liveDigest = projectionDigest(replayWorldEvents(emptyProjection(LONG_RUN_WORLD_ID), accepted));
    }

    // Section 16.2 checkpoint: how many major arcs are active at the end of this world day.
    activeMajorByWorldDay.push(harness.activeMajorArcIds().length);
    unresolvedMajorByWorldDay.push(harness.unresolvedMajorArcIds().length);
    arcStatusByWorldDay.push(harness.arcStatusCounts());
    for (const { lifecycle } of harness.arcs.values()) {
      if (lifecycle.status === 'resolved' || lifecycle.status === 'archived') arcsResolvedDuringRun.add(lifecycle.arcId);
    }
  }

  const acceptedEvents = canon.committedEvents();
  const finalWorldDay = startWorldDay + worldDays - 1;

  // --- canon conflicts ------------------------------------------------------
  canonConflicts.push(...revalidateAcceptedLog(acceptedEvents, mistwoodRuleContext()));

  // --- replay consistency (ART-17) -----------------------------------------
  const replayed = replayWorldEvents(emptyProjection(LONG_RUN_WORLD_ID), acceptedEvents);
  const replayedAgain = replayWorldEvents(emptyProjection(LONG_RUN_WORLD_ID), structuredClone(acceptedEvents));
  const replayedDigest = projectionDigest(replayed);
  const secondReplayDigest = projectionDigest(replayedAgain);
  const replay: ReplayFindings = {
    acceptedEvents: acceptedEvents.length,
    replayedDigest,
    liveDigest,
    equal: replayedDigest === liveDigest,
    secondReplayDigest,
    deterministic: replayedDigest === secondReplayDigest,
  };

  // --- arcs (FR-F003/FR-F004, ART-31) --------------------------------------
  const stagnantArcs = harness.portfolio.flatMap((entry) => {
    const prompt = detectArcStagnation(entry.projection, entry.tier, finalWorldDay);
    return prompt ? [{ arcId: prompt.arcId, stagnantWorldDays: prompt.stagnantWorldDays, status: prompt.status }] : [];
  });
  const deferredTransitions = postCommitRunStore.checkpoints
    .filter((row) => row.stage === 'arc' && row.status === 'completed')
    .reduce((total, row) => total + ((row.artifact as { deferredTransitions?: unknown[] })?.deferredTransitions?.length ?? 0), 0);
  const arcs: ArcFindings = {
    totalArcs: harness.arcs.size,
    maxActiveMajorArcs: activeMajorByWorldDay.length === 0 ? 0 : Math.max(...activeMajorByWorldDay),
    minActiveMajorArcs: activeMajorByWorldDay.length === 0 ? 0 : Math.min(...activeMajorByWorldDay),
    activeMajorByWorldDay,
    unresolvedMajorByWorldDay,
    arcStatusByWorldDay,
    worldDaysWithoutActiveMajorArc: activeMajorByWorldDay.flatMap((count, index) =>
      count === 0 ? [startWorldDay + index] : []),
    activeMajorLimit: MAX_MAJOR_ACTIVE_ARCS,
    overLimitWorldDays: activeMajorByWorldDay.flatMap((count, index) =>
      count > MAX_MAJOR_ACTIVE_ARCS ? [startWorldDay + index] : []),
    arcsWithoutProgress: [...harness.arcs.entries()]
      .filter(([, record]) => record.projections.length <= 1 && record.lifecycle.transitions.length <= 1)
      .map(([arcId]) => arcId),
    stagnantArcs,
    stagnationThresholdWorldDays: ARC_STAGNATION_WORLD_DAYS,
    deferredTransitions,
    resolvedArcs: [...arcsResolvedDuringRun].sort(),
  };

  // --- character appearance -------------------------------------------------
  const appeared = new Set(acceptedEvents.flatMap(({ participantIds }) => participantIds));
  const characterIds = mistwoodCharacterSeed.characters.map(({ id }) => id);
  const appearance: AppearanceFindings = {
    characterIds,
    maxSlotsSinceMajorAppearance: observations.plannedAppearance
      .reduce((max, row) => Math.max(max, row.slotsSinceMajorAppearance), 0),
    threshold: MAX_SLOTS_WITHOUT_APPEARANCE,
    violations: observations.plannedAppearance
      .filter(({ slotsSinceMajorAppearance }) => slotsSinceMajorAppearance > MAX_SLOTS_WITHOUT_APPEARANCE),
    neverAppeared: characterIds.filter((characterId) => !appeared.has(characterId)),
  };

  // --- repetition -----------------------------------------------------------
  const digestsBySceneId = new Map<string, string[]>();
  for (const result of observations.simulations) {
    const digest = sceneContentDigest(result);
    digestsBySceneId.set(digest, [...(digestsBySceneId.get(digest) ?? []), result.scene.sceneId]);
  }
  const duplicateGroups = [...digestsBySceneId.entries()]
    .filter(([, sceneIds]) => sceneIds.length > 1)
    .map(([digest, sceneIds]) => ({ digest, sceneIds }))
    .sort((left, right) => left.digest.localeCompare(right.digest));
  const duplicateScenes = duplicateGroups.reduce((total, { sceneIds }) => total + sceneIds.length - 1, 0);
  const repetition: RepetitionFindings = {
    scenes: observations.simulations.length,
    distinctContentDigests: digestsBySceneId.size,
    duplicateGroups,
    duplicateScenes,
    duplicateRate: observations.simulations.length === 0 ? 0 : duplicateScenes / observations.simulations.length,
    method: '128-bit FNV-1a digest over canonical JSON of scene summary, key actions, dialogue and Proposed Event public summaries; identifiers excluded',
  };

  // --- recap coverage -------------------------------------------------------
  const daysWithEvents = new Set(acceptedEvents.map(({ worldDay }) => worldDay));
  const completedWorldDays = [...new Set(acceptedEvents.map(({ worldDay }) => worldDay))]
    .filter((day) => acceptedEvents.some((event) => event.worldDay === day && event.timeSlot === TIME_SLOTS[TIME_SLOTS.length - 1]))
    .sort((left, right) => left - right);
  const importanceBySequence = new Map([...harness.classifications.values()].map((entry) => [
    entry.sourceEventSequenceNumber,
    entry.memberships.reduce((max, membership) => Math.max(max, membership.importance), 0),
  ]));
  const turningPoints = new Map<string, string[]>();
  for (const entry of harness.classifications.values()) {
    const arcIds = entry.memberships.filter(({ role }) => role === 'turning_point').map(({ arcId }) => arcId);
    if (arcIds.length > 0) turningPoints.set(entry.sourceEventId, arcIds);
  }
  const sources = coverageSources(acceptedEvents, importanceBySequence, turningPoints);
  const secretValues = mistwoodCharacterSeed.secrets.map(({ content }) => content);
  const coverageFindings: RecapCoverageFindings['coverageFindings'] = [];
  const emptyEpisodes: number[] = [];
  for (const [worldDay, row] of [...harness.episodes.entries()].sort((left, right) => left[0] - right[0])) {
    const episode = row.episode;
    if (!episode || episode.title.trim().length === 0 || episode.headline.trim().length === 0
        || episode.oneLineSummary.trim().length === 0 || episode.keyScenes.length < MIN_EPISODE_SCENES
        || episode.sourceEventIds.length === 0) {
      emptyEpisodes.push(worldDay);
      continue;
    }
    const report = validateRecapCoverage({
      worldId: LONG_RUN_WORLD_ID,
      contentRef: `episode:${worldDay}`,
      worldDay,
      coverageFromWorldDay: worldDay,
      citedEventIds: episode.sourceEventIds,
      mentionedRelationshipChangeIds: sources.filter(({ worldDay: day }) => day === worldDay)
        .flatMap(({ relationshipChanges }) => relationshipChanges.map(({ changeId }) => changeId)),
      mentionedFactIds: episode.keyScenes.flatMap(({ publicFactIds }) => publicFactIds),
      declaredExclusions: [],
      text: dailyEpisodePublicText(episode),
    }, sources, secretValues);
    if (!report.releasable) coverageFindings.push({ worldDay, findings: report.findings });
  }
  const recapCoverage: RecapCoverageFindings = {
    completedWorldDays: completedWorldDays.length,
    episodes: harness.episodes.size,
    worldDaysWithoutEpisode: completedWorldDays.filter((day) => !harness.episodes.has(day)),
    emptyEpisodes,
    worldDaysWithoutAcceptedEvent: Array.from({ length: worldDays }, (_, index) => startWorldDay + index)
      .filter((day) => !daysWithEvents.has(day)),
    recapSnapshots: harness.recaps.length,
    recapTypes: [...new Set(harness.recaps.map(({ recapType }) => recapType))].sort(),
    coverageFindings,
  };

  // --- token accounting -----------------------------------------------------
  const traces = observations.simulations.map(({ scene, trace }) => ({ sceneId: scene.sceneId, trace }));
  const tokenAnomalies = traces.flatMap(({ sceneId, trace }) => {
    const reasons: string[] = [];
    for (const [field, value] of [['inputTokens', trace.inputTokens], ['outputTokens', trace.outputTokens]] as const) {
      if (!Number.isFinite(value)) reasons.push(`${field} is not finite`);
      else if (value < 0) reasons.push(`${field} is negative`);
      else if (value === 0) reasons.push(`${field} is zero`);
    }
    if (!Number.isFinite(trace.retryCount) || trace.retryCount < 0) reasons.push('retryCount is invalid');
    return reasons.map((reason) => ({ sceneId, reason }));
  });
  const tokens: TokenFindings = {
    note: 'Authored by the ART-4 fake whole-scene provider: no real tokens are consumed and its counts are derived from payload length. These checks prove the accounting channel is wired and internally sane; real spend-anomaly detection requires the ART-72 provider adapter and is deliberately not simulated.',
    providers: [...new Set(traces.map(({ trace }) => trace.provider))].sort(),
    models: [...new Set(traces.map(({ trace }) => trace.model))].sort(),
    traces: traces.length,
    totalInputTokens: traces.reduce((total, { trace }) => total + trace.inputTokens, 0),
    totalOutputTokens: traces.reduce((total, { trace }) => total + trace.outputTokens, 0),
    retries: traces.reduce((total, { trace }) => total + trace.retryCount, 0),
    anomalies: tokenAnomalies,
    realProviderSpendChecked: false,
  };

  // --- safety (ART-54/55 path) ---------------------------------------------
  const classifiedScenes = new Map(observations.simulations.map((result) => [result.scene.sceneId, result]));
  const withheldSceneIds = observations.simulations
    .filter(({ reviewStatus }) => reviewStatus === 'required').map(({ scene }) => scene.sceneId);
  const eventsBypassingSafety = acceptedEvents.flatMap((event) => {
    // Every scene proposal keys its events as `<sceneId>:event:<n>` (fakeSceneNarrator).
    const sceneId = event.idempotencyKey.split(':event:')[0];
    const result = classifiedScenes.get(sceneId);
    if (!result) return [`${event.eventId} (no classified scene ${sceneId})`];
    if (result.reviewStatus === 'required') return [`${event.eventId} (scene withheld for review but committed)`];
    return [];
  });
  const safety: SafetyFindings = {
    scenesSimulated: observations.simulations.length,
    scenesWithoutClassification: observations.simulations
      .filter(({ safety: classification }) => !classification || classification.classificationId.trim().length === 0)
      .map(({ scene }) => scene.sceneId),
    policyVersions: [...new Set(observations.simulations.map(({ safety: classification }) => classification.policyVersion))].sort(),
    labels: [...new Set(observations.simulations.map(({ safety: classification }) => classification.label))].sort(),
    withheldSceneIds,
    eventsBypassingSafety,
    episodes: harness.episodes.size,
    episodesWithoutClassification: [...harness.episodes.entries()]
      .filter(([, row]) => !row.safetyClassificationId).map(([worldDay]) => worldDay),
  };

  const slotsCompleted = slots.filter(({ status }) => status === 'completed').length;
  const seed: LongRunSeed = {
    worldId: LONG_RUN_WORLD_ID,
    fixtureId: LONG_RUN_FIXTURE_ID,
    providerModel: FAKE_SCENE_MODEL,
    startWorldDay,
    worldDays,
    timeSlotsPerWorldDay: TIME_SLOTS.length,
  };
  const findings: Omit<LongRunFindings, 'digest'> = {
    schemaVersion: 1,
    seed,
    slots,
    slotsExecuted: slots.length,
    slotsCompleted,
    completionRate: slots.length === 0 ? 0 : slotsCompleted / slots.length,
    acceptedEvents: acceptedEvents.length,
    canonConflicts,
    replay,
    arcs,
    appearance,
    repetition,
    recapCoverage,
    tokens,
    safety,
  };
  return { ...findings, digest: contentDigest(findings) };
}
