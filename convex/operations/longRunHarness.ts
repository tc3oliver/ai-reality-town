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
import { personaAnchorFromSeed } from '../canon/personaDeviation';
import { replayWorldEvents } from '../canon/replay';
import { cloneProjection, type CanonSnapshot } from '../canon/snapshots';
import {
  createDailySnapshot, resolveWorldBaseline,
  type RecoveryAudit, type RecoveryHead, type SnapshotKind, type SnapshotRecoveryStore, type StoredCanonSnapshot,
} from '../canon/snapshotManager';
import { buildWorldImportPlan } from '../canon/worldConfig';
import { evaluateContinuityWindow, type PublicationEvidence, type SnapshotEvidence } from '../quality/continuity';
import type { EvaluationReport } from '../quality/evaluator';
import { evaluateNarrative, type NarrativeSceneEvidence } from '../quality/narrative';
import {
  evaluateOperationalQuality,
  type AuthoringAttemptEvidence, type OperationalQualityBreakdown,
  type ProposalValidationEvidence, type SceneSafetyEvidence,
} from '../quality/operationalQuality';
import {
  evaluateStoryQuality,
  type ArcEvidence, type PublishedContentEvidence, type StoryEventEvidence,
} from '../quality/storyQuality';
import type { AuthoringAttemptDraft } from '../simulation/worldDayLive';
import type { ProposalValidationDraft } from '../simulation/validationOutcome';
import { HIGH_IMPORTANCE_THRESHOLD } from '../editorial/episode';
import { validateCanon, validateEventStructure } from '../canon/validators';
import { authorizeKnowledgeRead } from '../knowledge/authorization';
import { authorizeMemoryRead } from '../knowledge/memoryAuthorization';
import { FAKE_SCENE_MODEL, FakeWholeSceneProvider } from '../simulation/fakeSceneNarrator';
import type { LanguageModelProvider } from '../simulation/provider';
import type { SceneSimulationResult } from '../simulation/sceneSimulation';
import {
  advanceDegradation,
  effectivePolicy,
  initialDegradationState,
  policyFor,
  resumeFromPause,
  shouldProbeProvider,
  type DegradationState,
  type DegradationTransition,
  type LevelPolicy,
} from '../simulation/degradation';
import { deriveRulesOnlyEvents } from '../simulation/rulesOnlyAuthor';
import { commitProposedEvent } from '../canon/commit';
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
import { deriveGatedShareFormats } from '../editorial/derived/shareFormats';
import { createPublicationRecord, transitionPublication, type PublicationRecord } from '../editorial/publicationLifecycle';
import {
  deriveRelationshipChangeId,
  relationshipChangeMagnitude,
  validateRecapCoverage,
  type CoverageFinding,
  type CoverageReport,
  type CoverageSourceEvent,
} from '../recaps/coverageValidation';
import { buildRecapSnapshot, type RecapSnapshot } from '../recaps/model';
import { classifyPostGeneration, isPubliclyShowable } from '../safety/postGeneration';
import { createArcLifecycle, isActiveArcStatus, transitionArcLifecycle } from '../story/lifecycle';
import { createArcResolutionDecision, type ArcResolutionDecision } from '../story/resolution';
import { initialArcHeat, type ArcHeatScore } from '../story/heat';
import { deriveConsequenceSummaries, type ConsequenceSummary } from '../story/consequenceSummary';
import { applyArcPortfolioControl, MAX_MAJOR_ACTIVE_ARCS,
  MAX_MINOR_ACTIVE_ARCS, type ArcPortfolioEntry } from '../story/portfolio';
import { replayArcProjection } from '../story/projection';
import { composeRecaps, type RecapComposition } from '../recaps/recapComposition';
import { episodeCandidate, toCoverageSource } from '../recaps/coverageValidationFunctions';
import { buildDeepRecap, buildMachineSummary, validateRecapFormats, type RecapFormats } from '../recaps/recapFormats';
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
import {
  buildVoteConsequenceProjection,
  VOTE_CONSEQUENCE_MODEL_KIND,
} from '../publicRead/voteConsequenceProjection';
import { voteConsequenceModelRef } from '../shared/environmentVoteCatalog';
import {
  buildRelationshipGraphProjection,
  groupPublicRelationships,
  RELATIONSHIP_GRAPH_MODEL_KIND,
} from '../publicRead/relationshipGraphProjection';
import {
  buildViewerKnowledgeProjection,
  VIEWER_KNOWLEDGE_MODEL_KIND,
} from '../publicRead/viewerKnowledgeProjection';
import { relationshipGraphModelRef } from '../shared/relationshipGraphRef';
import { viewerKnowledgeModelRef } from '../shared/viewerKnowledgeRef';
import { isViewerServablePublicationStatus } from '../editorial/publicationLifecycle';
import { CLEARED_RUN_FAILURE } from '../shared/runRecord';
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
  episodeContentRef,
  postCommitRunId,
  recapCursorOf,
  recapTargetKey,
  type LiveArcState,
  type PostCommitLivePort,
  type PostCommitSource,
  type PostCommitWorldState,
} from './postCommitLive';
import {
  resolveEffectiveModuleConfig,
  type ConfigurableModule,
} from '../shared/moduleModelConfig';
import {
  summarizeResourceUsage,
  TOKEN_BUDGET_POLICY_DEFAULTS,
  type ResourceUsageReport,
  type TokenBudgetPolicy,
} from '../shared/tokenBudget';
import {
  InMemoryBudgetAccountant,
  type WorldDayBudgetPort,
} from '../simulation/sceneBudget';

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
  /** ART-163 — the minor half of FR-F003, sampled at the same checkpoints. */
  activeMinorByWorldDay: number[];
  maxActiveMinorArcs: number;
  activeMinorLimit: number;
  minorOverLimitWorldDays: number[];
  /** Arcs whose projection ever recorded a turning point: the shape of a story progressing. */
  arcsWithTurningPoint: string[];
  /** Arcs that reached `resolving`, `resolved` or `archived`: the shape of one closing. */
  arcsReachingResolution: string[];
  /** Every resolution decision the pipeline recorded, in order. */
  resolutions: Array<{
    arcId: string; action: string; resultingStatus: string; resultingTier: string;
    terminal: boolean; consequenceCount: number;
  }>;
  /**
   * Terminal resolutions carrying no outcome or no consequence. Structurally impossible while
   * every resolution goes through `createArcResolutionDecision`, and reported anyway: this is the
   * exact defect ART-163 closed, and a finding that can only ever read zero is the cheapest way to
   * notice if the routing is ever bypassed again.
   */
  terminalResolutionsWithoutEvidence: string[];
  /** Consequence summaries applied, by scope — FR-F005's character/world summary input. */
  consequenceSummaryCount: number;
  consequenceSummarySubjects: string[];
  /** Arcs that held an active slot for longer than the stagnation threshold at any checkpoint. */
  arcsHoldingActiveSlotWhileStagnant: string[];
  /**
   * Arcs whose live portfolio snapshot disagrees with a fresh replay of their projection stream.
   * The arc-state analogue of {@link ReplayFindings.equal}, which covers only canon.
   */
  arcsWhereLiveAndReplayDisagree: string[];
};

export type AppearanceFindings = {
  characterIds: string[];
  /** Highest `slotsSinceMajorAppearance` any character reached during planning. */
  maxSlotsSinceMajorAppearance: number;
  threshold: number;
  violations: Array<{ characterId: string; slotsSinceMajorAppearance: number; worldDay: number; timeSlot: TimeSlot }>;
  /** Characters that never took part in a committed scene. */
  neverAppeared: string[];
  /**
   * Committed `character_location_changed` state changes. A world where this stays zero is a
   * world where a character the seed places alone can never reach anyone (ART-101), so it is
   * measured next to the appearance numbers it explains.
   */
  relocations: number;
  /** Characters a committed scene relocated at least once. */
  relocatedCharacterIds: string[];
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
  /**
   * World days whose FR-G003 recap formats the real composer REFUSED, with the code (ART-88).
   *
   * Invisible until ART-88: a refusal was recorded in the harness's own map and reported nowhere,
   * so an author change that made six days in seven unrecappable left every assertion green.
   */
  recapFormatFailures: Array<{ worldDay: number; errorCode: string }>;
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
  /**
   * FR-M003 / §16.3 resource measurement (ART-59 AC#3/#4/#5), over the whole run.
   *
   * Built from the accountant that ENFORCED the run, so the numbers describe the metered
   * pipeline. Two of the five §16.3 metrics can be `null` here with a stated reason — a share
   * over an empty sample is not zero — and the assertions in `longRunHarness.test.ts` are written
   * against a non-empty denominator so they can actually fail.
   */
  resources: ResourceUsageReport;
  safety: SafetyFindings;
  /**
   * FR-M002 Continuity Score and the five §16.2 Canon targets (ART-58), computed by the same
   * `convex/quality/continuity.ts` evaluator the operator query runs, over this run's evidence.
   */
  continuity: EvaluationReport;
  /**
   * FR-M002 narrative metrics (ART-88): the §16.2 repeated-scene ratio over ACCEPTED scenes, with
   * its exact / near / template split, dialogue repetition, voice distinctiveness, persona
   * deviation and event novelty — from `convex/quality/narrative.ts`, the evaluator the operator
   * query runs.
   */
  narrative: EvaluationReport;
  /**
   * FR-M002 arc / recap / spoiler metrics (ART-89): §16.2 高重要度摘要覆蓋率 over the accepted
   * events Canon holds (never over the episodes, which cannot omit one), spoiler violations from
   * the persisted FR-G004 verdicts, and arc progress / stagnation / resolution evidence.
   */
  storyQuality: EvaluationReport;
  /**
   * FR-M002 operational metrics (ART-90): Canon Rejection Rate, Safety Withhold Rate and §16.2's
   * structured-output success rate, computed from the run's own per-proposal verdicts and
   * per-attempt traces — the same evidence the deployment writes, deduplicated on the same keys.
   */
  operationalQuality: EvaluationReport;
  /** ART-90 reason dimensions: stable codes and their counts, never messages or payloads. */
  operationalBreakdown: OperationalQualityBreakdown;
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
    .map((basis, salt) => fnv1a(`${salt}\u0000${text}`, basis).toString(16).padStart(8, '0'))
    .join('');
}

const projectionDigest = (projection: WorldProjection): string => contentDigest(projection);

// --- fixture ----------------------------------------------------------------

const activeLocations = mistwoodWorldConfiguration.locations.filter(({ active }) => active);

/** Canon rule context for the fixed Mistwood fixture (identical to the ART-97/98 tests). */
export function mistwoodRuleContext(): CanonRuleContext {
  return {
    worldId: LONG_RUN_WORLD_ID,
    rules: mistwoodWorldConfiguration.immutableRules,
    characterIds: mistwoodCharacterSeed.characters.map(({ id }) => id),
    locationIds: activeLocations.map(({ id }) => id),
    itemIds: mistwoodCharacterSeed.assets.map(({ id }) => id),
    organizationIds: mistwoodWorldConfiguration.organizations.map(({ id }) => id),
    initialCharacterAlive: Object.fromEntries(mistwoodCharacterSeed.characters.map(({ id }) => [id, true])),
    initialItemOwners: Object.fromEntries(mistwoodCharacterSeed.assets.map(({ id, ownerCharacterId }) => [id, ownerCharacterId])),
    initialCharacterLocations: Object.fromEntries(mistwoodCharacterSeed.characters.map(({ id, initialLocationId }) => [id, initialLocationId])),
    // FR-B003 persona anchors, from the same seed rows production reads them from (ART-58). They
    // were omitted until now, which left `assessPersonaDeviations` with nothing to assess for the
    // whole run — absent-means-inert — so the 30-day evidence never exercised the persona gate.
    characterPersonas: Object.fromEntries(mistwoodCharacterSeed.characters.flatMap((character) => {
      const anchor = personaAnchorFromSeed(character.id, character);
      return anchor ? [[character.id, anchor] as const] : [];
    })),
    locationConnections: Object.fromEntries(activeLocations.map(({ id, connectedLocationIds }) => [id, connectedLocationIds])),
  };
}

/**
 * The seeded Mistwood Canon store: rule context AND the `initial` snapshot `importWorld` writes.
 *
 * The snapshot was missing until ART-58. Without it every commit in the run validated against
 * `emptyProjection`, where `validateCanon` skips the unknown-destination, inactive-destination and
 * capacity checks because `projection.locations` is empty — the exact trap CLAUDE.md §9 records —
 * so the 30-day evidence was measuring a weaker Canon than production enforces. The plan is built
 * by the same `buildWorldImportPlan` the deployment's `importWorld` uses, at `createdAt: 0`.
 */
export function seededCanonStore(): InMemoryCanonStore {
  const store = new InMemoryCanonStore();
  store.setCanonRuleContext(mistwoodRuleContext());
  store.setInitialSnapshot(buildWorldImportPlan(mistwoodWorldConfiguration, 0).initialSnapshot);
  return store;
}

/**
 * The world's baseline projection, as `commitProposedEvent` and `createDailySnapshot` resolve it.
 * Every replay in this harness starts here, never at `emptyProjection`.
 */
export function seededBaseline(store: InMemoryCanonStore, worldId: string) {
  return store.loadInitialSnapshot(worldId).then((initial) => resolveWorldBaseline(worldId, initial));
}

/**
 * A {@link SnapshotRecoveryStore} over the harness's Canon store (ART-58).
 *
 * The daily snapshot stage used to be stubbed here with a comment citing ART-99 — which was Done
 * long before this harness last changed, so the stub was a stage the 30-day evidence silently
 * skipped. This binds the REAL `createDailySnapshot`: accepted events come from the Canon store,
 * the `initial` snapshot is the seeded one, and daily snapshots accumulate in memory where the
 * continuity evaluator can read them as evidence.
 */
export class CanonBackedSnapshotStore implements SnapshotRecoveryStore {
  private readonly snapshots: StoredCanonSnapshot[] = [];
  private head: RecoveryHead | null = null;
  readonly audit: RecoveryAudit[] = [];

  constructor(private readonly canon: InMemoryCanonStore) {}

  /** Every daily snapshot the run persisted, ascending by world day. */
  dailySnapshots(): StoredCanonSnapshot[] {
    return this.snapshots.filter((snapshot) => snapshot.kind === 'daily')
      .sort((left, right) => left.worldDay - right.worldDay);
  }
  loadAcceptedEvents(worldId: string): Promise<AcceptedEvent[]> { return this.canon.loadAcceptedEvents(worldId); }
  findDailySnapshot(worldId: string, worldDay: number): Promise<StoredCanonSnapshot | null> {
    return Promise.resolve(this.snapshots.find((s) => s.worldId === worldId && s.worldDay === worldDay && s.kind === 'daily') ?? null);
  }
  loadLatestSnapshot(worldId: string, throughWorldDay: number): Promise<StoredCanonSnapshot | null> {
    return Promise.resolve(this.snapshots.filter((s) => s.worldId === worldId && s.worldDay <= throughWorldDay)
      .sort((a, b) => b.lastSequenceNumber - a.lastSequenceNumber)[0] ?? null);
  }
  loadSnapshot(worldId: string, snapshotId: string): Promise<StoredCanonSnapshot | null> {
    return Promise.resolve(this.snapshots.find((s) => s.worldId === worldId && s.snapshotId === snapshotId) ?? null);
  }
  async loadInitialSnapshot(worldId: string): Promise<StoredCanonSnapshot | null> {
    const initial = await this.canon.loadInitialSnapshot(worldId);
    return initial ? { ...initial, snapshotId: 'snapshot:initial', kind: 'initial' } : null;
  }
  saveSnapshot(snapshot: CanonSnapshot, kind: SnapshotKind): Promise<StoredCanonSnapshot> {
    const stored: StoredCanonSnapshot = { ...structuredClone(snapshot), kind, snapshotId: `snapshot:${kind}:${snapshot.worldDay}` };
    this.snapshots.push(stored);
    return Promise.resolve(stored);
  }
  loadRecoveryHead(): Promise<RecoveryHead | null> { return Promise.resolve(this.head); }
  replaceRecoveryHead(_worldId: string, head: RecoveryHead | null): Promise<void> { this.head = head; return Promise.resolve(); }
  appendRecoveryAudit(entry: RecoveryAudit): Promise<void> { this.audit.push(entry); return Promise.resolve(); }
}

// --- durable run stores ------------------------------------------------------

export class MemoryWorldDayRunStore implements WorldDayRunStore {
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
    // ART-150: a new attempt owns the failure fields, so the previous attempt's are cleared here
    // rather than left to be overwritten by a failure that may not come. `Object.assign` cannot do
    // that implicitly the way the Convex adapter's `db.patch` does — see {@link CLEARED_RUN_FAILURE}.
    Object.assign(this.required(runId), { status: 'running', attemptCount: attempt, ...CLEARED_RUN_FAILURE });
    return Promise.resolve();
  }
  failRun(runId: string, stage: WorldDayStage, error: WorldDayRunFailure): Promise<void> {
    Object.assign(this.required(runId), { status: 'failed', failureStage: stage, errorCode: error.code, errorMessage: error.message });
    return Promise.resolve();
  }
  completeRun(runId: string, committedEventIds: string[]): Promise<void> {
    Object.assign(this.required(runId), { status: 'completed', committedEventIds, ...CLEARED_RUN_FAILURE });
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

export class MemoryPostCommitRunStore implements PostCommitRunStore {
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
    Object.assign(this.required(runId), { status: 'running', attemptCount: attempt, ...CLEARED_RUN_FAILURE });
    return Promise.resolve();
  }
  failRun(runId: string, stage: PostCommitStage, error: RunFailure): Promise<void> {
    Object.assign(this.required(runId), { status: 'failed', failureStage: stage, errorCode: error.code, errorMessage: error.message });
    return Promise.resolve();
  }
  completeRun(runId: string, metricsTraceId: string): Promise<void> {
    Object.assign(this.required(runId), { status: 'completed', metricsTraceId, ...CLEARED_RUN_FAILURE });
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

/**
 * The in-memory public read store.
 *
 * ## Why it is indexed rather than filtered (ART-73)
 *
 * Every read here used to filter the whole row array, so each read model rebuild cost
 * O(all published versions in the world) — and the pipeline rebuilds seven read models per
 * accepted event, so the harness's own cost grew quadratically with the run. That is a FIXTURE
 * artifact and not a property of the deployment: production reads by
 * `by_target_and_version`, which is scoped to `(worldId, modelKind, modelRef)`
 * (`readModelFunctions.ts`), so it touches one target's versions and no others.
 *
 * The map below is that index, with identical semantics: same rows, same order, same answers.
 * `rows` stays as the flat view the assertions read. Without it a 90-day run spends most of its
 * time scanning arrays the deployment would never scan, which would make the run a measurement of
 * this class rather than of the pipeline.
 */
export class MemoryReadStore implements PublicReadStore {
  /** ART-162: this fixture is not exercising the publication gate, so it publishes. */
  publicationEnabled(): Promise<boolean> { return Promise.resolve(true); }

  readonly rows: StoredReadModel[] = [];
  private readonly byTarget = new Map<string, StoredReadModel[]>();
  private readonly byId = new Map<string, StoredReadModel>();
  private counter = 0;

  private static key(worldId: string, modelKind: ReadModelKind, modelRef: string): string {
    return `${worldId}|${modelKind}|${modelRef}`;
  }

  private target(worldId: string, modelKind: ReadModelKind, modelRef: string): StoredReadModel[] {
    return this.byTarget.get(MemoryReadStore.key(worldId, modelKind, modelRef)) ?? [];
  }

  loadTargetVersions(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<readonly StoredReadModel[]> {
    return Promise.resolve(this.target(worldId, modelKind, modelRef));
  }
  findCurrent(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<StoredReadModel | null> {
    return Promise.resolve(this.target(worldId, modelKind, modelRef).find((row) => row.isCurrent) ?? null);
  }
  loadLastKnownGood(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<readonly StoredReadModel[]> {
    return Promise.resolve(this.target(worldId, modelKind, modelRef).filter((row) => row.isLastKnownGood));
  }
  insertVersion(record: PublishedReadModel): Promise<string> {
    this.counter += 1;
    const id = `id-${this.counter}`;
    const row = { ...record, id };
    this.rows.push(row);
    this.byId.set(id, row);
    const key = MemoryReadStore.key(record.worldId, record.modelKind, record.modelRef);
    const target = this.byTarget.get(key);
    if (target) target.push(row);
    else this.byTarget.set(key, [row]);
    return Promise.resolve(id);
  }
  markCurrent(rowId: string, patch: Parameters<PublicReadStore['markCurrent']>[1]): Promise<void> {
    const row = this.byId.get(rowId);
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
export type Observations = {
  simulations: SceneSimulationResult[];
  plannedAppearance: Array<{ characterId: string; slotsSinceMajorAppearance: number; worldDay: number; timeSlot: TimeSlot }>;
  /**
   * FR-M002 / ART-90. Every Canon validation verdict and every authoring attempt the run produced,
   * deduplicated on the same derived keys the deployment's tables are keyed on — so a long run's
   * rejection and structured-output rates are computed from the evidence an operator would read
   * rather than from a parallel count kept beside it.
   */
  validations: Map<string, ProposalValidationDraft>;
  attempts: Map<string, AuthoringAttemptDraft>;
};

// --- world-day port ----------------------------------------------------------

/**
 * In-memory {@link WorldDayLivePort} over the fixed Mistwood seed. It records every
 * simulated scene (safety verdict and provider trace included) and every Director planning
 * input, which is what makes the safety, repetition, token and appearance checks
 * observations of the live run rather than a re-derivation.
 */
/** A mutable rung, so one bound port can author a world that moves down the ladder mid-run. */
export type AuthoringPolicyBox = { current: LevelPolicy };

export function createWorldDayPort(
  store: InMemoryCanonStore,
  observations: Observations,
  activeArcsOf: () => LiveArc[],
  budget: WorldDayBudgetPort,
  authoringPolicy: AuthoringPolicyBox = { current: policyFor('normal') },
): WorldDayLivePort {
  return {
    canonStore: store,
    // FR-M003 / ART-59. The run is ENFORCED by the same pure accountant production uses, not
    // merely observed alongside it, so the §16.3 numbers this harness reports are measurements of
    // a metered run rather than of an unmetered one with a report bolted on.
    budget,
    // FR-K005 / ART-52: the harness runs an UNCONFIGURED world, so the port returns the
    // documented defaults -- which are the pre-ART-52 hardcoded values.
    // ART-161: no configured limit, so authoring stays sequential — the behaviour these
    // fixtures were written against.
    loadConcurrencyLimit: () => Promise.resolve(null),
    loadModuleConfig: (_worldId: string, module: ConfigurableModule) =>
      Promise.resolve(resolveEffectiveModuleConfig(module, null)),
    /**
     * FR-M004 (ART-165). `normal` unless a caller sets one: `runLongRunSimulation` measures an
     * undegraded world, and `runDegradationLadderDays` sets the rung's policy before each slot so
     * rungs 2 and 3 are exercised by the same code the deployment runs rather than described.
     */
    loadAuthoringPolicy: () => Promise.resolve(authoringPolicy.current),
    async loadWorldSnapshot(slot: WorldDaySlotIdentity) {
      const acceptedEvents = await store.loadAcceptedEvents(slot.worldId);
      // From the seeded baseline, as the deployment's `loadWorldSnapshot` does — not from empty.
      const baseline = await seededBaseline(store, slot.worldId);
      const snapshot = buildLiveWorldSnapshot({
        slot,
        acceptedEvents,
        projection: replayWorldEvents(cloneProjection(baseline.projection),
          acceptedEvents.filter((event) => event.sequenceNumber > baseline.lastSequenceNumber)),
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
    // The ninety-day harness runs no ballot, so its environment queue is genuinely empty and
    // nothing is ever marked applied. FR-J001's own coverage is `environmentVoteInjection.test.ts`.
    loadScheduledEnvironmentEvents: () => Promise.resolve([]),
    markScheduledEnvironmentEventApplied: () => Promise.resolve(),
    persistDirectorPlan: () => Promise.resolve(),
    persistCharacterIntent: () => Promise.resolve(),
    persistGroupedScenes: () => Promise.resolve(),
    persistSceneSimulation: (_groupingRunId, result) => {
      observations.simulations.push(result);
      return Promise.resolve();
    },
    // The long run drives every slot to completion, so no slot is ever retried and there is never
    // a stored result to reuse. Returning null keeps the harness measuring freshly authored
    // scenes, which is what its token and repetition observations are about.
    loadPersistedSceneSimulation: () => Promise.resolve(null),
    recordProposalValidations: (outcomes) => {
      for (const outcome of outcomes) {
        const key = `${outcome.worldId}|${outcome.idempotencyKey}|${outcome.stage}`;
        if (!observations.validations.has(key)) observations.validations.set(key, outcome);
      }
      return Promise.resolve();
    },
    recordAuthoringAttempt: (attempt) => {
      const key = `${attempt.simulationRunId}:attempt:${attempt.attempt}`;
      if (!observations.attempts.has(key)) observations.attempts.set(key, attempt);
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
export function createPostCommitHarness(canon: InMemoryCanonStore, readStore: MemoryReadStore, snapshots: SnapshotRecoveryStore = new CanonBackedSnapshotStore(canon)) {
  const arcs = new Map<string, ArcRecord>();
  const classifications = new Map<number, ArcEventClassification>();
  const portfolio: ArcPortfolioEntry[] = [];
  const episodes = new Map<number, EpisodeRecord>();
  const recaps: RecapSnapshot[] = [];
  const publications = new Map<string, PublicationRecord>();
  const shareFormats = new Map<number, { status: string; reasonCodes: string[] }>();
  const stagnationPrompts: Array<{ arcId: string; stagnantWorldDays: number; status: string }> = [];
  /**
   * FR-F006 / ART-32. The heat the pipeline last scored each arc at, keyed by arc.
   *
   * Recorded rather than recomputed, for the reason `validations` and `attempts` are on the
   * world-day side: a report that re-derives what it is reporting on cannot catch the pipeline
   * scoring something else.
   */
  const arcHeat = new Map<string, ArcHeatScore>();
  const recapFormats = new Map<number, { status: 'ready' | 'failed'; episodeNumber: number; deduplicated: boolean; errorCode?: string }>();
  const storedRecapFormats = new Map<number, { formats: RecapFormats; composition: RecapComposition }>();
  /**
   * The FULL FR-G004 verdict per world day, not just its boolean (ART-89).
   *
   * It held `{ releasable, findingCodes }` and was written and never read. The story-quality
   * evaluator needs the report itself: which high-importance events a releasable candidate
   * actually covered, and which findings were spoiler-category rather than coverage-category.
   */
  const coverageReports = new Map<number, { releasable: boolean; findingCodes: string[]; report: CoverageReport | null }>();
  const resolutionDecisions: ArcResolutionDecision[] = [];
  const consequenceSummaries = new Map<string, ConsequenceSummary>();
  let now = 10_000;

  const events = (): AcceptedEvent[] => canon.committedEvents();
  /**
   * The world projection, memoised on the length of the accepted log (ART-73).
   *
   * `loadCharacterKnowledge` and `loadCharacterMemories` each replayed the WHOLE log, and the
   * knowledge and memory stages call them once per character — so a twelve-character world paid
   * twenty-four full replays per accepted event, and the run's cost grew with the cube of its
   * length. Production pays none of that: it reads through `readProjectionViaSnapshot`, which
   * resumes from the newest daily snapshot.
   *
   * Keying the cache on the log's LENGTH is exact rather than approximate: Canon is append-only,
   * so two calls at the same length are two calls against the same log. This is a fixture cost
   * fix and changes no answer — `longRunHarness.test.ts` asserts the same report digest before and
   * after, which is what makes that claim checkable rather than asserted.
   */
  let projectionCache: { worldId: string; length: number; projection: WorldProjection } | null = null;
  const worldProjection = (worldId: string): WorldProjection => {
    const all = events();
    // Keyed on the world as well as the log length. The fixture is single-world today, so the
    // world half of the key can never miss — which is exactly why it would be easy to leave out
    // and expensive to discover missing.
    if (projectionCache?.length === all.length && projectionCache.worldId === worldId) {
      return projectionCache.projection;
    }
    const projection = replayWorldEvents(emptyProjection(worldId), all);
    projectionCache = { worldId, length: all.length, projection };
    return projection;
  };
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
      // ART-89: a day is over when the world has moved past it. The old rule admitted the latest
      // day the moment its night slot began, so its Episode was assembled from a partial slot and
      // the rest of that slot reached no Episode, recap or publication — see
      // `completedWorldDaysOf`, whose docblock records what that cost.
      const completed = days.filter((day) => day < latestWorldDay);
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
          // ART-163: the newest projection revision's world day is the arc's last real progress.
          lastProgressWorldDay: record.projections[record.projections.length - 1].worldDay,
          // The harness drives no analytics ingest, so it CANNOT observe viewer interaction. Null
          // rather than zero: the heat scorer renormalises around an unmeasured signal instead of
          // scoring every harness arc as one nobody is watching (ART-32).
          viewerInteractionCount: null,
        })),
        characterIds: mistwoodCharacterSeed.characters.map(({ id }) => id),
        completedWorldDays: completed,
        latestWorldDayFinalSlotStarted: all.some((candidate) =>
          candidate.worldDay === latestWorldDay && candidate.timeSlot === TIME_SLOTS[TIME_SLOTS.length - 1]),
        episodeWorldDays: [...episodes.keys()],
        worldDayFirstSequenceNumber: all.filter(({ worldDay }) => worldDay === event.worldDay)
          .reduce((lowest, candidate) => Math.min(lowest, candidate.sequenceNumber), event.sequenceNumber),
        timeSlotFirstSequenceNumber: all
          .filter(({ worldDay, timeSlot }) => worldDay === event.worldDay && timeSlot === event.timeSlot)
          .reduce((lowest, candidate) => Math.min(lowest, candidate.sequenceNumber), event.sequenceNumber),
        seasonFirstSequenceNumber: all.filter(({ worldDay }) => worldDay === event.worldDay)
          .reduce((lowest, candidate) => Math.min(lowest, candidate.sequenceNumber), event.sequenceNumber),
        latestWorldDay,
      });
    },

    rebuildWorldProjection: (worldId) => Promise.resolve(`world:${worldId}`),
    rebuildCharacterProjection: (_worldId, characterId) => Promise.resolve(`character:${characterId}`),

    loadCharacterKnowledge(worldId, characterId) {
      const projection = worldProjection(worldId);
      return Promise.resolve(authorizeKnowledgeRead(projection.characterKnowledge, characterId, OPERATOR));
    },
    loadCharacterMemories(worldId, characterId) {
      const projection = worldProjection(worldId);
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
              resolvedQuestions: [], recommendedEntryEventId: null,
              // The same composite the deployment writes at creation (ART-170). A harness that
              // seeded a different score would report a world the pipeline would not produce.
              heatScore: initialArcHeat({
                worldId: LONG_RUN_WORLD_ID, arcId: proposal.arcId, status: 'emerging',
                worldDay: source.worldDay, eventImportance: membership.importance,
                sourceEventId: classification.sourceEventId, coreCharacterIds: proposal.coreCharacterIds,
                eventParticipantIds: source.participantIds, unresolvedQuestionCount: 1,
              }).score,
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

    /**
     * The harness records what the pipeline scored, so its own reports can assert on heat without
     * recomputing it — recomputing would test the test rather than the pipeline.
     */
    recordArcHeat(heat) {
      arcHeat.set(heat.arcId, heat);
      return Promise.resolve();
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

    /**
     * ART-163. The same decision boundary the deployment binds, in memory.
     *
     * `createArcResolutionDecision` is called for real rather than stubbed: the whole point of
     * routing resolutions through a decision is that a terminal status is refused without an
     * outcome and consequences, and a harness that skipped the check would report a 30-day run as
     * clean while the deployment threw on its first resolution.
     */
    recordArcResolution(_worldId, decision) {
      const recorded = createArcResolutionDecision(decision);
      const prior = resolutionDecisions.find(({ decisionId }) => decisionId === recorded.decisionId);
      if (prior) return Promise.resolve(prior);
      resolutionDecisions.push(recorded);
      const entry = portfolio.find(({ projection }) => projection.arcId === recorded.arcId);
      if (entry) entry.tier = recorded.resultingTier;
      return Promise.resolve(recorded);
    },

    applyArcConsequences(_worldId, decisionId) {
      const decision = resolutionDecisions.find((entry) => entry.decisionId === decisionId);
      if (!decision) throw new Error(`unknown resolution decision ${decisionId}`);
      const resolutionEvent = events().find(({ eventId }) => eventId === decision.sourceEventId);
      if (!resolutionEvent) throw new Error('CONSEQUENCE_SOURCE_NOT_ACCEPTED');
      for (const summary of deriveConsequenceSummaries(decision, [resolutionEvent])) {
        consequenceSummaries.set(summary.summaryId, summary);
      }
      return Promise.resolve({
        applied: deriveConsequenceSummaries(decision, [resolutionEvent]).length,
      });
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
      // The one definition, imported rather than restated (ART-177). A harness that decided the
      // publish/withhold line for itself would report a different episode-withhold rate from the
      // deployment the moment the line moved.
      const safe = isPubliclyShowable(safety.label);
      const status = safe ? 'ready' : 'withheld';
      episodes.set(worldDay, { status, episodeNumber, episode: safe ? episode : undefined, safetyClassificationId: safety.classificationId });
      return Promise.resolve({ status, episodeNumber, deduplicated: false });
    },

    // FR-G005 / ART-36. Real derivation and real gate, so a long run reports how often the
    // outreach copy was refused rather than assuming it never is.
    generateShareFormats(worldId, worldDay) {
      const prior = shareFormats.get(worldDay);
      if (prior) return Promise.resolve(prior);
      const row = episodes.get(worldDay);
      if (!row) return Promise.resolve({ status: 'absent', reasonCodes: [] });
      if (row.status !== 'ready' || !row.episode) {
        const blocked = { status: 'blocked', reasonCodes: ['SHARE_SOURCE_EPISODE_NOT_READY'] };
        shareFormats.set(worldDay, blocked);
        return Promise.resolve(blocked);
      }
      const { decision } = deriveGatedShareFormats({
        episode: row.episode,
        acceptedSourceEventIds: events().filter((event) => event.worldDay === worldDay).map(({ eventId }) => eventId),
        sourceEpisodeStatus: row.status,
      });
      const result = { status: decision.outcome, reasonCodes: [...decision.reasonCodes] };
      shareFormats.set(worldDay, result);
      return Promise.resolve(result);
    },

    generateRecap(worldId, request) {
      const existing = recaps.find(({ id }) => id === request.snapshotId);
      if (existing) return Promise.resolve({ snapshotId: existing.id, deduplicated: true });
      const prior = recaps.filter(({ recapType, targetId }) =>
        recapType === request.recapType && targetId === request.targetId).at(-1) ?? null;
      const inRange = ({ sequenceNumber }: { sequenceNumber: number }): boolean =>
        sequenceNumber >= request.fromSequenceNumber && sequenceNumber <= request.toSequenceNumber;
      /**
       * ART-164. The `arc` tier is SELECTIVE: its sources are the events that moved that arc's
       * projection, taken from the arc's own revision list exactly as the deployment reads them
       * from `storyArcProjectionEvents`. Summarising the whole range instead would make an arc
       * summary a world summary wearing an arc's name.
       */
      if (request.arcId !== undefined) {
        const moved = new Set((arcs.get(request.arcId)?.projections ?? [])
          .map(({ sourceEventSequenceNumber }) => sourceEventSequenceNumber)
          .filter((sequenceNumber) => inRange({ sequenceNumber })));
        const acceptedEvents = events().filter(({ sequenceNumber }) => moved.has(sequenceNumber));
        // Membership without progress is ordinary; nothing is written and the cursor stays put.
        if (acceptedEvents.length === 0) return Promise.resolve({ snapshotId: null, deduplicated: false });
        const snapshot = buildRecapSnapshot({
          id: request.snapshotId, worldId, recapType: request.recapType, targetId: request.targetId, prior,
          acceptedEvents, mode: 'incremental', generatedAt: now,
          sourceScope: {
            fromSequenceNumber: request.fromSequenceNumber, toSequenceNumber: request.toSequenceNumber,
          },
        });
        recaps.push(snapshot);
        return Promise.resolve({ snapshotId: snapshot.id, deduplicated: false });
      }
      const snapshot = buildRecapSnapshot({
        id: request.snapshotId, worldId, recapType: request.recapType, targetId: request.targetId, prior,
        acceptedEvents: events().filter(inRange),
        mode: 'incremental', generatedAt: now,
      });
      recaps.push(snapshot);
      return Promise.resolve({ snapshotId: snapshot.id, deduplicated: false });
    },

    loadRecapCursors(_worldId, targets) {
      const cursors: Record<string, number> = {};
      for (const { recapType, targetId } of targets) {
        const latest = recaps.filter((snapshot) =>
          snapshot.recapType === recapType && snapshot.targetId === targetId).at(-1);
        if (latest) {
          cursors[recapTargetKey(recapType, targetId)] = recapCursorOf(latest);
        }
      }
      return Promise.resolve(cursors);
    },

    /**
     * ART-164. The REAL composer and the REAL length validation, in memory.
     *
     * A double that returned `ready` without composing would let the 30-day gate report four
     * recap formats per episode while the deployment refused every one of them on the Quick
     * Recap's 80 中文字 floor.
     */
    generateRecapFormats(_worldId, worldDay) {
      const prior = recapFormats.get(worldDay);
      if (prior) return Promise.resolve({ ...prior, deduplicated: true });
      const episodeRow = episodes.get(worldDay);
      if (!episodeRow?.episode) {
        const outcome = { status: 'failed' as const, episodeNumber: episodeRow?.episodeNumber ?? 0, deduplicated: false, errorCode: 'RECAP_EPISODE_NOT_PUBLISHABLE' };
        recapFormats.set(worldDay, outcome);
        return Promise.resolve(outcome);
      }
      const dayEvents = events().filter((event) => event.worldDay === worldDay);
      try {
        const composed = composeRecaps(episodeRow.episode, dayEvents);
        const formats = validateRecapFormats({
          schemaVersion: 1, quickRecap: composed.quickRecap, standardRecap: composed.standardRecap,
          deepRecap: buildDeepRecap(dayEvents),
          machineSummary: buildMachineSummary(dayEvents, {
            newQuestions: [...episodeRow.episode.newQuestions],
            resolvedQuestions: [...episodeRow.episode.resolvedQuestions],
            storyArcProgress: episodeRow.episode.arcIds.map((arcId) => ({
              arcId, progress: `第 ${episodeRow.episodeNumber} 集推進了這條故事線。`,
            })),
          }),
          sourceEventIds: composed.sourceEventIds,
        }, dayEvents);
        storedRecapFormats.set(worldDay, { formats, composition: composed.composition });
        const outcome = { status: 'ready' as const, episodeNumber: episodeRow.episodeNumber, deduplicated: false };
        recapFormats.set(worldDay, outcome);
        return Promise.resolve(outcome);
      } catch (error) {
        const errorCode = (error as { code?: string }).code ?? 'RECAP_FORMAT_GENERATION_FAILED';
        const outcome = { status: 'failed' as const, episodeNumber: episodeRow.episodeNumber, deduplicated: false, errorCode };
        recapFormats.set(worldDay, outcome);
        return Promise.resolve(outcome);
      }
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

    /**
     * ART-164. The REAL FR-G004 gate over in-memory state.
     *
     * `validateRecapCoverage`, `episodeCandidate` and `toCoverageSource` are the same functions
     * the deployment runs; a double that returned `releasable: true` would let the 30-day gate
     * report zero spoiler violations for a pipeline that never checked for one.
     */
    runCoverageGate(_worldId, worldDay, contentRef) {
      const episodeRow = episodes.get(worldDay);
      if (!episodeRow?.episode) {
        coverageReports.set(worldDay, { releasable: false, findingCodes: ['COVERAGE_INVALID_SHAPE'], report: null });
        return Promise.resolve({ releasable: false, findingCodes: ['COVERAGE_INVALID_SHAPE'] });
      }
      const memberships = membershipsBySequence();
      const turningPoints = new Map<string, string[]>();
      for (const entry of classifications.values()) {
        turningPoints.set(entry.sourceEventId, entry.memberships
          .filter(({ role }) => role === 'turning_point').map(({ arcId }) => arcId));
      }
      const sources = events().map((event) => toCoverageSource(
        event,
        (memberships.get(event.sequenceNumber) ?? []).reduce((max, m) => Math.max(max, m.importance), 0),
        turningPoints.get(event.eventId) ?? [],
      ));
      const report = validateRecapCoverage(
        episodeCandidate(LONG_RUN_WORLD_ID, contentRef, episodeRow.episode, sources), sources, [],
      );
      const findingCodes = [...new Set(report.findings.map(({ code }) => code))];
      coverageReports.set(worldDay, { releasable: report.releasable, findingCodes, report });
      return Promise.resolve({ releasable: report.releasable, findingCodes });
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
        /**
         * ART-174. Derived from the harness's OWN publication records, not stubbed to empty.
         * A harness that passed an empty set would model an index no administrator decision can
         * reach — which is the class of harness/production drift the long run exists to catch.
         */
        withheldWorldDays: new Set<number>([...episodes.keys()].filter((worldDay) => {
          const status = publications.get(episodeContentRef(worldId, worldDay))?.status;
          return status !== undefined && !isViewerServablePublicationStatus(status);
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

    /**
     * FR-J002 / ART-46, through the real builder. The long run commits no viewer-vote event, so
     * the payload comes out with a null trigger and four empty buckets — which is the shape the
     * pipeline has to be able to publish on every ordinary commit, and therefore the shape a
     * multi-day run should be exercising.
     */
    rebuildVoteConsequenceProjection(worldId, targetWorldDay) {
      const payload = buildVoteConsequenceProjection({
        worldId,
        targetWorldDay,
        events: events().map((event) => ({
          eventId: event.eventId, sequenceNumber: event.sequenceNumber, worldDay: event.worldDay,
          timeSlot: event.timeSlot, eventType: event.eventType, idempotencyKey: event.idempotencyKey,
          causedByEventIds: [...event.causedByEventIds], publicSummary: event.publicSummary ?? null,
          publicationStatus: 'published' as const, sceneId: null,
        })),
        // Derived from the canon store, the way the real wiring derives it from `canonEvents`.
        acceptedEventIds: events().map((event) => event.eventId),
        appliedEventIds: [],
        contextInterventionEventIdsByScene: {},
      });
      return publish(
        VOTE_CONSEQUENCE_MODEL_KIND,
        voteConsequenceModelRef(worldId, targetWorldDay),
        payload,
        payload.sourceEventIds,
      );
    },

    /**
     * FR-I007 / ART-44, through the real builder and the real published rows.
     *
     * Over a multi-day run this is the one read model that exercises the seven-day window with a
     * window that actually moves: by day 9 the day-1 changes have aged out of it, which no
     * single-commit harness can show.
     */
    rebuildRelationshipGraphProjection(worldId, targetWorldDay) {
      const projection = worldProjection(worldId);
      const payload = buildRelationshipGraphProjection({
        worldId,
        targetWorldDay,
        arcs: [...arcs.keys()].map((arcId) => {
          const arc = arcProjectionData(arcId);
          return {
            arcId, title: arc.title, status: arc.status, coreCharacterIds: arc.coreCharacterIds,
          };
        }),
        relationships: groupPublicRelationships(
          Object.values(projection.relationshipHistory).flat(),
        ),
      });
      return publish(
        RELATIONSHIP_GRAPH_MODEL_KIND,
        relationshipGraphModelRef(worldId, targetWorldDay),
        payload,
        payload.sourceEventIds,
      );
    },

    /**
     * FR-I005 / ART-169, over the REAL builder — not a stub that returns refs.
     *
     * The harness has every input the deployment joins: the seeded secrets, the accepted events'
     * facts and knowledge ledger, the Episodes with their `sourceEventIds`, and the publication
     * records the pipeline actually walked. Running the same function over them is what makes the
     * long run able to say something about this field at all.
     *
     * What it says today is that `viewerKnownSecrets` is EMPTY for the whole run, and that is the
     * finding rather than a defect in this binding: FR-K004 reserves `publish` for an
     * administrator, the harness has no administrator, so every Episode stops at `ready` exactly
     * as it does in the deployment. A binding that had quietly treated `ready` as released would
     * have reported the opposite and looked healthier.
     */
    async rebuildViewerKnowledgeProjections(worldId, characterIds) {
      const projection = worldProjection(worldId);
      const citedEvents = episodeRefs().flatMap(({ worldDay, sourceEventIds }) => {
        const publicationRef = episodeContentRef(worldId, worldDay);
        const publicationStatus = publications.get(publicationRef)?.status ?? 'absent';
        return sourceEventIds.map((eventId) => ({
          eventId, worldDay, publicationRef, publicationStatus, sceneId: null,
        }));
      });
      const secrets = mistwoodCharacterSeed.secrets.map(({ id, content, initialKnowerCharacterIds }) => ({
        secretId: id, content, holderCharacterIds: initialKnowerCharacterIds,
      }));
      const refs: string[] = [];
      for (const characterId of [...new Set(characterIds)].sort((left, right) => left.localeCompare(right))) {
        const { projection: payload } = buildViewerKnowledgeProjection({
          worldId,
          characterId,
          secrets,
          facts: projection.facts,
          citedEvents,
          // The harness has no operator override path, so nothing is withheld by a Scene
          // decision. An Episode the safety classifier refused is still excluded, through its
          // publication record's `withheld` status above.
          withheldSceneIds: new Set<string>(),
          characterKnownFactIds: new Set(
            (projection.characterKnowledge[characterId] ?? []).map((record) => record.factId)),
        });
        refs.push(await publish(
          VIEWER_KNOWLEDGE_MODEL_KIND,
          viewerKnowledgeModelRef(characterId),
          payload,
          payload.viewerKnownSecrets.map((secret) => secret.revealingEventId),
        ));
      }
      return refs;
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

    // The REAL ART-22/ART-99 daily snapshot over the harness's Canon (ART-58). The previous
    // stub cited ART-99 as "known-broken"; ART-99 had been Done for some time, so the stub was a
    // stage the evidence skipped. `createDailySnapshot` also asserts the previous snapshot against
    // a full replay, so a reducer regression now fails a run here as it would in production.
    persistDailySnapshot: async (worldId, worldDay) => {
      const { snapshot, deduplicated } = await createDailySnapshot(snapshots, worldId, worldDay, now);
      return { snapshotId: snapshot.snapshotId, deduplicated };
    },

    // ART-91: the deterministic run is never degraded, so nothing is deferred. The rung-5
    // behaviour itself is exercised in `degradation.test.ts` and `postCommitLive.test.ts`.
    defersSummaries: () => Promise.resolve(false),

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

  /** ART-163: the minor half of FR-F003's count control, which had no checkpoint at all. */
  const activeMinorArcIds = (): string[] => [...arcs.values()]
    .filter(({ lifecycle }) => isActiveArcStatus(lifecycle.status) && !isMajor(lifecycle.arcId))
    .map(({ lifecycle }) => lifecycle.arcId).sort();

  const arcStatusCounts = (): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const { lifecycle } of arcs.values()) counts[lifecycle.status] = (counts[lifecycle.status] ?? 0) + 1;
    return counts;
  };

  return {
    port, arcs, portfolio, episodes, recaps, classifications, stagnationPrompts, recapFormats, storedRecapFormats, arcHeat,
    resolutionDecisions, consequenceSummaries, snapshots, coverageReports,
    activeArcsForDirector, activeMajorArcIds, activeMinorArcIds, unresolvedMajorArcIds, arcStatusCounts,
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
export function revalidateAcceptedLog(
  events: readonly AcceptedEvent[],
  ruleContext: CanonRuleContext,
  /**
   * The seeded baseline (ART-58). This replayed from `emptyProjection` until ART-58, which left
   * `destination` undefined for every seed location and let the inactive-destination and capacity
   * checks pass vacuously — an assertion that partly could not fail.
   */
  baseline: WorldProjection,
): CanonConflictFinding[] {
  const findings: CanonConflictFinding[] = [];
  const seenKeys = new Set<string>();
  let projection = cloneProjection(baseline);
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

// --- reusable in-memory fixture --------------------------------------------

/**
 * A fully wired in-memory long-run fixture over the fixed Mistwood seed: the canon
 * store, the public read store, the real downstream post-commit harness, the run
 * stores, and the two stage-handler chains — bound to one scene-authoring provider.
 *
 * `runLongRunSimulation` uses this with the default deterministic provider; ART-74's
 * failure-injection suite reuses it with a flaky provider so the same real pipeline is
 * driven under injected faults instead of through a parallel re-implementation.
 */
export type LongRunFixture = {
  canon: InMemoryCanonStore;
  readStore: MemoryReadStore;
  harness: ReturnType<typeof createPostCommitHarness>;
  observations: Observations;
  worldDayRunStore: MemoryWorldDayRunStore;
  postCommitRunStore: MemoryPostCommitRunStore;
  worldDayHandlers: ReturnType<typeof createWorldDayStageHandlers>;
  postCommitHandlers: ReturnType<typeof createPostCommitStageHandlers>;
  /** FR-M003 / ART-59. The accountant that enforced the run and holds its ledger and counters. */
  budget: InMemoryBudgetAccountant;
  /** ART-58. The daily snapshots the run persisted, as replay evidence. */
  snapshots: CanonBackedSnapshotStore;
  /**
   * ART-165. The stage-1 port, so a caller driving the FR-M004 ladder can read the same world
   * snapshot the Director plans against — which is what a rules-only slot derives its events from.
   */
  worldDayPort: WorldDayLivePort;
  /**
   * ART-165. The rung the bound port authors under. `runDegradationLadderDays` writes it before each
   * slot, so a degraded slot is reduced by the deployment's own `degradedPlan` rather than described.
   */
  authoringPolicy: AuthoringPolicyBox;
};

export function createLongRunFixture(
  provider: LanguageModelProvider = new FakeWholeSceneProvider(),
  /**
   * ART-59 budget policy the run is enforced under.
   *
   * Defaults to {@link TOKEN_BUDGET_POLICY_DEFAULTS} — every limit unlimited — because the
   * baseline run has to prove the UNCONFIGURED world is unaffected: NFR-007's whole point is that
   * the fixed seed's findings describe the pipeline, and a harness that ran under a budget nobody
   * configured would be measuring the budget instead. The enforcement tests pass a configured
   * policy here to drive the same real pipeline against a real limit.
   */
  policy: TokenBudgetPolicy = TOKEN_BUDGET_POLICY_DEFAULTS,
  /**
   * ART-52's per-module cap, overridable so the DELEGATION can be driven end to end.
   *
   * Defaults to reading `resolveEffectiveModuleConfig`, which is what the harness's unconfigured
   * world resolves to; a test that wants to prove the per-module limit binds supplies the number
   * an operator would have configured, rather than a second copy of the limit inside the policy.
   */
  moduleDailyTokenBudget: (module: ConfigurableModule) => number | null =
  (module) => resolveEffectiveModuleConfig(module, null).dailyTokenBudget,
): LongRunFixture {
  const canon = seededCanonStore();
  const readStore = new MemoryReadStore();
  const snapshots = new CanonBackedSnapshotStore(canon);
  const harness = createPostCommitHarness(canon, readStore, snapshots);
  const observations: Observations = {
    simulations: [], plannedAppearance: [], validations: new Map(), attempts: new Map(),
  };
  const worldDayRunStore = new MemoryWorldDayRunStore();
  const postCommitRunStore = new MemoryPostCommitRunStore();
  const budget = new InMemoryBudgetAccountant(FAKE_SCENE_MODEL, policy, moduleDailyTokenBudget);
  const authoringPolicy: AuthoringPolicyBox = { current: policyFor('normal') };
  const worldDayPort = createWorldDayPort(
    canon, observations, harness.activeArcsForDirector, budget, authoringPolicy);
  const worldDayHandlers = createWorldDayStageHandlers(worldDayPort, provider);
  const postCommitHandlers = createPostCommitStageHandlers(harness.port);
  return {
    canon, readStore, harness, observations, worldDayRunStore, postCommitRunStore,
    worldDayHandlers, postCommitHandlers, budget, snapshots, worldDayPort, authoringPolicy,
  };
}

// --- the FR-M004 ladder, driven against the real pipeline (ART-165) ----------

/**
 * One slot as the ladder saw it.
 *
 * `usedProvider` is separate from `status` on purpose: a rules-only slot completes without ever
 * calling a model, and conflating "the slot finished" with "the model works" is the defect ART-165
 * exists to fix.
 */
export type LadderSlotOutcome = {
  worldDay: number;
  timeSlot: TimeSlot;
  /** Which claim of this slot produced the outcome. A retried slot repeats with the next number. */
  attempt: number;
  /** The rung the world was on when the slot was admitted. */
  level: DegradationState['level'];
  /** Whether this slot was a provider probe taken at a rung that does not normally call one. */
  probe: boolean;
  usedProvider: boolean;
  /** `refused` means the ladder did not admit the slot at all — rung 6. */
  status: 'completed' | 'failed' | 'refused';
  errorCode: string | null;
  committedEventIds: string[];
};

export type LadderRunResult = {
  outcomes: LadderSlotOutcome[];
  transitions: DegradationTransition[];
  state: DegradationState;
  /** The next slot world time is standing on. A stalled world ends where it started. */
  worldDay: number;
  timeSlot: TimeSlot;
  /** World days this call actually advanced through. Fewer than asked when the world stalled. */
  worldDaysAdvanced: number;
};

export type LadderRunInput = {
  /** World days to advance through. Reached only if the world is not stalled on a failing slot. */
  worldDays: number;
  startWorldDay?: number;
  /** The slot within `startWorldDay` to begin on, so a stalled world can be resumed where it stopped. */
  startTimeSlot?: TimeSlot;
  /** Carry a world's rung across calls, so an outage and its recovery can be driven separately. */
  state?: DegradationState;
  /**
   * Driver ticks this call may spend, whether or not they advance world time.
   *
   * A failing slot is retried rather than skipped — see the loop — so a world under a provider
   * outage consumes ticks without moving. Defaults to one per slot of `worldDays`, which is what a
   * healthy world needs; a scenario that expects stalling passes its own budget.
   */
  maxTicks?: number;
  /**
   * Called when the ladder refuses to admit a slot. Returning true performs the operator resume
   * that rung 6 documents as its only way out; returning false leaves the world paused.
   */
  onPaused?: (state: DegradationState) => boolean;
};

/**
 * Drive `worldDays` world days the way the LIVE driver does, with the ladder in the loop.
 *
 * `runLongRunSimulation` runs every slot at `normal` and reports quality. This runs the same
 * fixture — the same Canon store, the same stage handlers, the same post-commit pipeline — with
 * the FR-M004 decision consulted before each slot and fed the outcome afterwards, which is the
 * shape of `driveOneWorld` in `convex/simulation/providers/liveWorldDayActions.ts`.
 *
 * ## One tick is one claim, and a failing slot is RETRIED (ART-167)
 *
 * This is the part that matters most, and the part the first version got wrong. `driveOneWorld`
 * stops on the first slot that did not complete; an authoring failure deliberately leaves the row
 * `running` rather than `failed`, which is the path every outage takes; and `claimLiveSlot` consults
 * the running row before anything queued and hands the SAME row back once its lease lapses, with
 * `attemptCount + 1`. So a world under a provider outage does not skip to the next slot — it retries
 * one slot, and world time does not move until that slot completes.
 *
 * The first version of this driver iterated `worldDay × timeSlot` unconditionally. Every signal it
 * produced therefore carried a fresh key, the ladder's exactly-once branch was never taken anywhere
 * in the harness, and the deployment took it on every retry — which is exactly how ART-165 shipped a
 * ladder that could not escalate at all while two gates that rest on this driver stayed green.
 *
 * So the loop is over TICKS, not over slots. World time advances only when a slot completes; a
 * failing slot is retried with the next attempt number; and a paused world consumes ticks without
 * moving, because that is what a world whose claim is refused does.
 *
 * ## What it models, and what it does not
 *
 * It models what the ladder decides — whether a slot is ADMITTED, what its outcome says, and which
 * attempt said it. It does not model rung 3's plan truncation, because the harness builds its
 * authoring plan inside `executeWorldDay` where there is nothing to intercept; `degradedPlan` is a
 * pure function over a plan and is covered directly in `degradation.test.ts`. Saying so here is
 * better than a driver that silently measures less than it appears to.
 *
 * The rules-only rung goes through `deriveRulesOnlyEvents` → `validateEventStructure` →
 * `commitProposedEvent`, exactly as `runRulesOnlySlot` does, so a rung built as a bypass would
 * fail here rather than pass.
 */
export async function runDegradationLadderDays(
  fixture: LongRunFixture,
  input: LadderRunInput,
): Promise<LadderRunResult> {
  const startWorldDay = input.startWorldDay ?? 0;
  const endWorldDay = startWorldDay + input.worldDays;
  let state = input.state ?? initialDegradationState(LONG_RUN_WORLD_ID);
  const outcomes: LadderSlotOutcome[] = [];
  const transitions: DegradationTransition[] = [];
  let processed = fixture.canon.committedEvents().length;
  let clock = 1;

  let worldDay = startWorldDay;
  let slotIndex = TIME_SLOTS.indexOf(input.startTimeSlot ?? TIME_SLOTS[0]);
  if (slotIndex < 0) throw new Error('LADDER_RUN_UNKNOWN_TIME_SLOT');
  // `claimLiveSlot` increments `attemptCount` on every claim, so the first claim of a slot is 1.
  let attempt = 0;
  const maxTicks = input.maxTicks ?? input.worldDays * TIME_SLOTS.length;

  for (let tick = 0; tick < maxTicks && worldDay < endWorldDay; tick += 1) {
    clock += 1;
    const timeSlot = TIME_SLOTS[slotIndex];
    const slot: WorldDaySlotIdentity = { worldId: LONG_RUN_WORLD_ID, worldDay, timeSlot };
    attempt += 1;

    // Rung 6, checked BEFORE anything is claimed, exactly as `prepareQueuedWorldDaySlot` does.
    if (!policyFor(state.level).admitsSimulation) {
      if (input.onPaused?.(state) === true) {
        const resumed = resumeFromPause(state, clock, 'operator:long-run');
        state = resumed.state;
        if (resumed.transition) transitions.push(resumed.transition);
      } else {
        // The tick is spent and world time does not move: a refused claim leaves the slot exactly
        // where it was, which is what a paused world means.
        outcomes.push({
          worldDay, timeSlot, attempt, level: state.level, probe: false, usedProvider: false,
          status: 'refused', errorCode: 'WORLD_DEGRADATION_PAUSED', committedEventIds: [],
        });
        continue;
      }
    }

    // `effectivePolicy`, not `policyFor`: one slot in every SLOTS_BETWEEN_PROVIDER_PROBES is the
    // probe that lets a no-provider world find out the outage ended (ART-165).
    const probe = shouldProbeProvider(state);
    const policy = effectivePolicy(state);
    const level = state.level;
    // The port authors under this rung, so `fewer_scenes` really does truncate the plan and
    // `compatible_model` really does swap the model — in the harness as in the deployment.
    fixture.authoringPolicy.current = policy;
    let status: 'completed' | 'failed';
    let errorCode: string | null = null;
    let committedEventIds: string[] = [];
    let usedProvider: boolean;

    if (policy.rulesOnly) {
      const settled = await commitRulesOnlySlot(
        fixture, slot, level === 'deferred_summaries' ? 'deferred_summaries' : 'rules_only');
      status = settled.errorCode === null ? 'completed' : 'failed';
      errorCode = settled.errorCode;
      committedEventIds = settled.committedEventIds;
      // No model was called, and that is the whole content of this rung.
      usedProvider = false;
    } else {
      const scenesBefore = fixture.observations.simulations.length;
      const run = await executeWorldDay(
        { runId: worldDayRunId(slot), ...slot }, fixture.worldDayRunStore, fixture.worldDayHandlers,
      );
      status = run.status === 'completed' ? 'completed' : 'failed';
      errorCode = run.errorCode ?? null;
      committedEventIds = run.committedEventIds ?? [];
      /**
       * Whether the slot REACHED the provider, not whether its rung permits one (ART-167).
       *
       * `driveOneWorld` reports `usedProvider: true` only from the branch that authored, and
       * `false` for every slot that settled without authoring — a Director that planned nothing, a
       * stage that decided the slot earlier, scenes already persisted. Deriving it from the rung's
       * policy instead made a healthy world recover a rung here that it would not recover there.
       *
       * A failed authoring counts: the provider was asked and refused, which is exactly the
       * evidence the ladder is built on.
       *
       * On THIS seed the two readings never disagree — every slot the Director plans at a
       * provider-using rung authors at least one scene — so this is an alignment with the driver
       * rather than a measured difference, and an injection that reverts it turns no test red. It is
       * kept because the gate's value is that it runs what the deployment runs, and a fixture that
       * agrees only by luck stops agreeing the moment the Director plans an empty slot.
       */
      usedProvider = fixture.observations.simulations.length > scenesBefore || status === 'failed';
    }

    // Stages 11–21 for everything this slot accepted, so the world the next slot plans against
    // is the one the pipeline actually produced.
    const accepted = fixture.canon.committedEvents();
    for (const event of accepted.slice(processed)) {
      await executePostCommitPipeline({
        runId: postCommitRunId(LONG_RUN_WORLD_ID, event.sequenceNumber), worldId: LONG_RUN_WORLD_ID,
        sourceEventId: event.eventId, sourceEventSequenceNumber: event.sequenceNumber,
        worldDay: event.worldDay,
      }, fixture.postCommitRunStore, fixture.postCommitHandlers, event.traceId);
    }
    processed = accepted.length;

    outcomes.push({
      worldDay, timeSlot, attempt, level, probe, usedProvider, status, errorCode, committedEventIds,
    });

    const decision = advanceDegradation(state, {
      worldId: LONG_RUN_WORLD_ID, worldDay, timeSlot, attempt,
      authored: status === 'completed', usedProvider, errorCode, at: clock,
    });
    state = decision.state;
    if (decision.transition) transitions.push(decision.transition);

    // World time moves only on a slot that settled. A failed slot is the SAME slot next tick, with
    // the next attempt number — which is what `claimLiveSlot` hands the driver back.
    if (status === 'completed') {
      attempt = 0;
      slotIndex += 1;
      if (slotIndex === TIME_SLOTS.length) {
        slotIndex = 0;
        worldDay += 1;
      }
    }
  }

  return {
    outcomes, transitions, state,
    worldDay, timeSlot: TIME_SLOTS[slotIndex],
    worldDaysAdvanced: worldDay - startWorldDay,
  };
}

/**
 * Rung 4/5's slot: deterministic proposals, through the same structural gate and the same commit.
 *
 * Mirrors `runRulesOnlySlot`. Placements come from the world SNAPSHOT rather than from
 * `projection.characterLocations`, because Canon records a location CHANGE — where the seed put a
 * character lives in the snapshot, and a rules-only author fed from the projection would propose
 * nothing on a world where nobody had moved yet.
 */
async function commitRulesOnlySlot(
  fixture: LongRunFixture,
  slot: WorldDaySlotIdentity,
  /** The rung, stamped on the events exactly as `runRulesOnlySlot` stamps it. */
  degradationLevel: 'rules_only' | 'deferred_summaries',
): Promise<{ errorCode: string | null; committedEventIds: string[] }> {
  const snapshot = await fixture.worldDayPort.loadWorldSnapshot(slot);
  const proposals = deriveRulesOnlyEvents({
    worldId: slot.worldId,
    worldDay: slot.worldDay,
    timeSlot: slot.timeSlot,
    directorRunId: `director:${worldDayRunId(slot)}`,
    placements: snapshot.characters.map(({ characterId, currentLocationId }) =>
      ({ characterId, locationId: currentLocationId })),
    degradationLevel,
  });

  const committedEventIds: string[] = [];
  for (const proposed of proposals) {
    const structural = validateEventStructure(proposed);
    if (structural) return { errorCode: structural.code, committedEventIds };
    try {
      const result = await commitProposedEvent(fixture.canon, { proposed, traceId: worldDayRunId(slot) });
      committedEventIds.push(result.eventId);
    } catch (error) {
      return {
        errorCode: error instanceof Error && 'error' in error
          ? String((error as { error: { code?: string } }).error.code ?? 'RULES_ONLY_COMMIT_FAILED')
          : 'RULES_ONLY_COMMIT_FAILED',
        committedEventIds,
      };
    }
  }
  return { errorCode: null, committedEventIds };
}

// --- the run -----------------------------------------------------------------

/**
 * The authored prose a run produced, handed to ART-92's human-review sampler.
 *
 * {@link LongRunFindings} is deliberately machine-only — a reviewer cannot read a content
 * digest — so this is the one channel that carries real text out of a run. It is emitted
 * after the run has finished and is NOT an input to {@link LongRunFindings.digest}, so it
 * cannot influence the run or its reproducibility.
 */
export type LongRunContentSample = {
  scenes: readonly SceneSimulationResult[];
  episodes: ReadonlyArray<{
    worldDay: number;
    episodeNumber: number;
    status: string;
    /** Absent when the episode was withheld by safety or never assembled. */
    episode: DailyEpisode | undefined;
    safetyClassificationId: string | null;
  }>;
};

export type LongRunInput = {
  worldDays: number;
  startWorldDay?: number;
  /**
   * ART-92 review seam. Called exactly once, after the run completes, with the run's
   * authored content. Read-only by contract: the harness ignores anything it returns.
   */
  onContentSample?: (sample: LongRunContentSample) => void;
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

  const { canon, harness, observations, worldDayRunStore, postCommitRunStore,
    worldDayHandlers, postCommitHandlers, budget, snapshots } = createLongRunFixture();
  const baseline = await seededBaseline(canon, LONG_RUN_WORLD_ID);
  const replayFromBaseline = (events: readonly AcceptedEvent[]): WorldProjection =>
    replayWorldEvents(cloneProjection(baseline.projection),
      events.filter((event) => event.sequenceNumber > baseline.lastSequenceNumber));

  const slots: SlotOutcome[] = [];
  const canonConflicts: CanonConflictFinding[] = [];
  const activeMajorByWorldDay: number[] = [];
  const activeMinorByWorldDay: number[] = [];
  const stagnantWhileActive = new Set<string>();
  const unresolvedMajorByWorldDay: number[] = [];
  const arcStatusByWorldDay: Array<Record<string, number>> = [];
  const arcsResolvedDuringRun = new Set<string>();
  let processedEvents = 0;
  /**
   * The projection the run CARRIES, folded incrementally as each slot commits (ART-58).
   *
   * Until ART-58 `liveDigest` was a full replay of the accepted log recomputed every slot, and
   * `replay.equal` compared it with a second full replay of the same log at the end — the same
   * computation over the same list, an assertion that could not fail. Now one side is the
   * step-by-step fold a running world performs and the other is the one-shot replay a recovery
   * performs; they agree only if the reducer is a pure function of `(projection, event)`.
   */
  let liveProjection = replayFromBaseline([]);
  let liveDigest = projectionDigest(liveProjection);

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
      liveProjection = replayWorldEvents(liveProjection, accepted.slice(processedEvents));
      processedEvents = accepted.length;
      liveDigest = projectionDigest(liveProjection);
    }

    // Section 16.2 checkpoint: how many major arcs are active at the end of this world day.
    activeMajorByWorldDay.push(harness.activeMajorArcIds().length);
    activeMinorByWorldDay.push(harness.activeMinorArcIds().length);
    // ART-163: an arc still holding an active slot after the stagnation threshold is the failure
    // the remediation ladder exists to prevent, so it is sampled per world day rather than only
    // at the end — a slot held for ten days and then released would otherwise leave no trace.
    for (const entry of harness.portfolio) {
      if (detectArcStagnation(entry.projection, entry.tier, worldDay)) stagnantWhileActive.add(entry.projection.arcId);
    }
    unresolvedMajorByWorldDay.push(harness.unresolvedMajorArcIds().length);
    arcStatusByWorldDay.push(harness.arcStatusCounts());
    for (const { lifecycle } of harness.arcs.values()) {
      if (lifecycle.status === 'resolved' || lifecycle.status === 'archived') arcsResolvedDuringRun.add(lifecycle.arcId);
    }
  }

  const acceptedEvents = canon.committedEvents();
  const finalWorldDay = startWorldDay + worldDays - 1;

  // --- canon conflicts ------------------------------------------------------
  canonConflicts.push(...revalidateAcceptedLog(acceptedEvents, mistwoodRuleContext(), baseline.projection));

  // --- replay consistency (ART-17) -----------------------------------------
  const replayed = replayFromBaseline(acceptedEvents);
  const replayedAgain = replayFromBaseline(structuredClone(acceptedEvents));
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
    activeMinorByWorldDay,
    maxActiveMinorArcs: activeMinorByWorldDay.length === 0 ? 0 : Math.max(...activeMinorByWorldDay),
    activeMinorLimit: MAX_MINOR_ACTIVE_ARCS,
    minorOverLimitWorldDays: activeMinorByWorldDay.flatMap((count, index) =>
      count > MAX_MINOR_ACTIVE_ARCS ? [startWorldDay + index] : []),
    arcsWithTurningPoint: [...harness.arcs.entries()]
      .filter(([, record]) => record.projections.some(({ fields }) => fields.latestTurningPointEventId !== null))
      .map(([arcId]) => arcId).sort(),
    arcsReachingResolution: [...harness.arcs.entries()]
      .filter(([, record]) => record.lifecycle.transitions.some(({ toStatus }) =>
        toStatus === 'resolving' || toStatus === 'resolved' || toStatus === 'archived'))
      .map(([arcId]) => arcId).sort(),
    resolutions: harness.resolutionDecisions.map((decision) => ({
      arcId: decision.arcId, action: decision.action,
      resultingStatus: decision.resultingStatus, resultingTier: decision.resultingTier,
      terminal: decision.resultingStatus === 'resolved' || decision.resultingStatus === 'archived',
      consequenceCount: decision.consequences.length,
    })),
    terminalResolutionsWithoutEvidence: harness.resolutionDecisions
      .filter((decision) => (decision.resultingStatus === 'resolved' || decision.resultingStatus === 'archived')
        && ((decision.outcome ?? '').trim().length === 0 || decision.consequences.length === 0))
      .map((decision) => decision.decisionId).sort(),
    consequenceSummaryCount: harness.consequenceSummaries.size,
    consequenceSummarySubjects: [...new Set([...harness.consequenceSummaries.values()]
      .map((summary) => `${summary.scope}:${summary.subjectId}`))].sort(),
    arcsHoldingActiveSlotWhileStagnant: [...stagnantWhileActive].sort(),
    // ART-163 live-vs-replay equality for ARC state, the analogue of `replay.equal` for canon:
    // the portfolio entry each arc carried while the pipeline ran must equal a fresh replay of
    // its projection stream against its lifecycle status.
    arcsWhereLiveAndReplayDisagree: harness.portfolio.flatMap((entry) => {
      const record = harness.arcs.get(entry.projection.arcId);
      if (!record) return [entry.projection.arcId];
      const replayedArc = replayArcProjection(record.projections, record.lifecycle.status);
      return JSON.stringify(replayedArc) === JSON.stringify(entry.projection) ? [] : [entry.projection.arcId];
    }).sort(),
  };

  // --- character appearance -------------------------------------------------
  const appeared = new Set(acceptedEvents.flatMap(({ participantIds }) => participantIds));
  const characterIds = mistwoodCharacterSeed.characters.map(({ id }) => id);
  const relocated = acceptedEvents.flatMap(({ stateChanges }) => stateChanges
    .filter((change) => change.type === 'character_location_changed')
    .map((change) => (change.type === 'character_location_changed' ? change.characterId : '')));
  const appearance: AppearanceFindings = {
    characterIds,
    maxSlotsSinceMajorAppearance: observations.plannedAppearance
      .reduce((max, row) => Math.max(max, row.slotsSinceMajorAppearance), 0),
    threshold: MAX_SLOTS_WITHOUT_APPEARANCE,
    violations: observations.plannedAppearance
      .filter(({ slotsSinceMajorAppearance }) => slotsSinceMajorAppearance > MAX_SLOTS_WITHOUT_APPEARANCE),
    neverAppeared: characterIds.filter((characterId) => !appeared.has(characterId)),
    relocations: relocated.length,
    relocatedCharacterIds: [...new Set(relocated)].sort((left, right) => left.localeCompare(right)),
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
  // ART-89: the same rule the pipeline uses — a day is over when the world has moved past it.
  const latestAcceptedWorldDay = acceptedEvents.reduce((highest, event) => Math.max(highest, event.worldDay), 0);
  const completedWorldDays = [...new Set(acceptedEvents.map(({ worldDay }) => worldDay))]
    .filter((day) => day < latestAcceptedWorldDay)
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
    recapFormatFailures: [...harness.recapFormats.entries()]
      .filter(([, outcome]) => outcome.status === 'failed')
      .map(([worldDay, outcome]) => ({ worldDay, errorCode: outcome.errorCode ?? 'RECAP_FORMAT_GENERATION_FAILED' }))
      .sort((left, right) => left.worldDay - right.worldDay),
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
    models: [...new Set(traces.map(({ trace }) => trace.resolvedModel ?? trace.requestedModel))].sort(),
    traces: traces.length,
    totalInputTokens: traces.reduce((total, { trace }) => total + trace.inputTokens, 0),
    totalOutputTokens: traces.reduce((total, { trace }) => total + trace.outputTokens, 0),
    retries: traces.reduce((total, { trace }) => total + trace.retryCount, 0),
    anomalies: tokenAnomalies,
    realProviderSpendChecked: false,
  };

  // --- FR-M003 / §16.3 resource measurement (ART-59) ------------------------
  //
  // Built from the accountant's OWN records, not re-derived from `observations.simulations`.
  // That distinction is the point: a report computed from the same list the token findings above
  // are computed from could only ever agree with itself, and would say nothing about whether the
  // enforcement path saw the same calls. These counters were written by `settleReservation` on
  // the live path, one settlement per provider attempt.
  const resources = summarizeResourceUsage({
    worldId: LONG_RUN_WORLD_ID,
    policy: TOKEN_BUDGET_POLICY_DEFAULTS,
    counters: budget.allCounters,
    ledger: budget.ledger,
  });

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

  // --- FR-M002 continuity (ART-58) ------------------------------------------
  //
  // The SAME evaluator the operator query runs, over the run's own evidence: the accepted log
  // folded from the seeded baseline, the daily snapshots the real snapshot stage persisted, and
  // the public texts the editorial stages produced. Not a re-statement of `canonConflicts` and
  // `replay` above — those are the harness's own checks, and agreement between two independent
  // computations is the evidence; disagreement is a finding.
  const eventsByDay = new Map<number, AcceptedEvent[]>();
  for (const event of acceptedEvents) eventsByDay.set(event.worldDay, [...(eventsByDay.get(event.worldDay) ?? []), event]);
  const snapshotByDay = new Map<number, SnapshotEvidence>(snapshots.dailySnapshots().map((snapshot) => [
    snapshot.worldDay, { ref: snapshot.snapshotId, lastSequenceNumber: snapshot.lastSequenceNumber, projectionHash: snapshot.projectionHash },
  ]));
  const publicationsByDay = new Map<number, PublicationEvidence[]>();
  for (const [worldDay, row] of harness.episodes.entries()) {
    if (!row.episode) continue;
    publicationsByDay.set(worldDay, [{
      ref: `episode:${LONG_RUN_WORLD_ID}:${worldDay}`, text: dailyEpisodePublicText(row.episode), citedEventIds: row.episode.sourceEventIds,
    }]);
  }
  for (const [worldDay, stored] of harness.storedRecapFormats.entries()) {
    publicationsByDay.set(worldDay, [...(publicationsByDay.get(worldDay) ?? []), {
      ref: `recap_formats:${LONG_RUN_WORLD_ID}:${worldDay}`,
      text: [stored.formats.quickRecap, stored.formats.standardRecap, stored.formats.deepRecap].join(' '),
      citedEventIds: stored.formats.sourceEventIds,
    }]);
  }
  const continuity = evaluateContinuityWindow({
    worldId: LONG_RUN_WORLD_ID, fromWorldDay: startWorldDay, toWorldDay: finalWorldDay,
    origin: { kind: 'initial_snapshot', ref: 'snapshot:initial', projection: baseline.projection, lastSequenceNumber: baseline.lastSequenceNumber },
    ruleContext: mistwoodRuleContext(),
    secrets: mistwoodCharacterSeed.secrets.map(({ id, content }) => ({ secretId: id, content })),
    eventsByDay, snapshotByDay, publicationsByDay, scanLimitReached: false,
  });

  // --- FR-M002 narrative (ART-88) -------------------------------------------
  //
  // Scenes are joined to Canon through `metadata.sceneId` (FR-P004 stamps it on every real
  // proposal) with the idempotency-key prefix as the fallback the safety check already uses. A
  // scene with no accepted event is not in the denominator, and says so.
  const acceptedSequenceByScene = new Map<string, number>();
  for (const event of acceptedEvents) {
    const sceneId = typeof event.metadata?.sceneId === 'string' ? event.metadata.sceneId : event.idempotencyKey.split(':event:')[0];
    const prior = acceptedSequenceByScene.get(sceneId);
    if (prior === undefined || event.sequenceNumber < prior) acceptedSequenceByScene.set(sceneId, event.sequenceNumber);
  }
  const narrativeScenes: NarrativeSceneEvidence[] = observations.simulations.map((result) => ({
    sceneId: result.scene.sceneId,
    worldDay: result.scene.worldDay,
    timeSlot: result.scene.timeSlot,
    acceptedSequenceNumber: acceptedSequenceByScene.get(result.scene.sceneId) ?? null,
    locationId: result.scene.locationId,
    participantIds: result.scene.participantIds,
    arcIds: result.scene.arcIds,
    sceneSummary: result.output.sceneSummary,
    keyActions: result.output.keyActions,
    dialogue: result.output.dialogueHighlights,
    publicSummaries: result.output.proposedEvents.map(({ publicSummary }) => publicSummary ?? ''),
    withheld: result.reviewStatus === 'required',
  }));
  const narrative = evaluateNarrative({
    worldId: LONG_RUN_WORLD_ID, fromWorldDay: startWorldDay, toWorldDay: finalWorldDay,
    scenes: narrativeScenes, events: acceptedEvents,
    identifiers: [
      LONG_RUN_WORLD_ID,
      ...characterIds,
      ...mistwoodWorldConfiguration.locations.map(({ id }) => id),
      ...[...harness.arcs.keys()],
    ],
    personaAnchors: mistwoodRuleContext().characterPersonas ?? {},
    originProjection: baseline.projection,
    scanLimitReached: false,
  });

  // --- FR-M002 arc / recap / spoiler (ART-89) --------------------------------
  //
  // The coverage denominator is read from the ACCEPTED log and the arc classifications the run
  // recorded, never from the episodes: `buildDailyEpisode` refuses to store an episode that omits
  // a high-importance event, so a ratio over stored episodes could not fail.
  const storyEvents: StoryEventEvidence[] = acceptedEvents.map((event) => ({
    eventId: event.eventId,
    worldDay: event.worldDay,
    importance: importanceBySequence.get(event.sequenceNumber) ?? 0,
  }));
  const storyPublications: PublishedContentEvidence[] = [...harness.episodes.entries()]
    .sort((left, right) => left[0] - right[0])
    .flatMap(([worldDay, row]) => {
      const verdict = harness.coverageReports.get(worldDay);
      if (!verdict) return [];
      const report = verdict.report;
      return [{
        contentRef: episodeContentRef(LONG_RUN_WORLD_ID, worldDay),
        worldDay,
        releasable: verdict.releasable,
        findingCodes: verdict.findingCodes,
        spoilerFindingCodes: (report?.findings ?? []).filter((finding) => finding.category === 'spoiler').map((finding) => finding.code),
        citedEventIds: report?.coveredEventIds ?? [],
        errorCode: row.episode ? null : 'EPISODE_NOT_PUBLISHABLE',
      }];
    });
  const storyArcs: ArcEvidence[] = [...harness.arcs.entries()].map(([arcId, record]) => {
    const decision = harness.resolutionDecisions
      .filter((entry) => entry.arcId === arcId
        && (entry.resultingStatus === 'resolved' || entry.resultingStatus === 'archived'))
      .at(-1);
    return {
      arcId,
      status: record.lifecycle.status,
      active: isActiveArcStatus(record.lifecycle.status),
      lastProgressWorldDay: record.projections.reduce((highest, projection) => Math.max(highest, projection.worldDay), 0),
      viewerInteractionCount: null,
      revisionsInWindow: record.projections.filter((projection) =>
        projection.worldDay >= startWorldDay && projection.worldDay <= finalWorldDay).length,
      reachedTerminal: record.lifecycle.status === 'resolved' || record.lifecycle.status === 'archived',
      terminalOutcomeRecorded: (decision?.outcome ?? '').trim().length > 0,
      terminalConsequenceCount: decision?.consequences.length ?? 0,
    };
  });
  const storyQuality = evaluateStoryQuality({
    worldId: LONG_RUN_WORLD_ID, fromWorldDay: startWorldDay, toWorldDay: finalWorldDay,
    highImportanceThreshold: HIGH_IMPORTANCE_THRESHOLD,
    stagnationThresholdWorldDays: ARC_STAGNATION_WORLD_DAYS,
    events: storyEvents, publications: storyPublications,
    // The deterministic run has no operator, so it declares no exclusions: its coverage rate is
    // the unassisted one, which is the honest baseline for §16.2.
    exclusions: [],
    // The newest day's Episode is due on the next day's first commit, so its events are not yet
    // answerable — excluded with a reason rather than counted as uncovered, the same rule ART-47's
    // retention cohorts use for a cohort that has not aged far enough to answer.
    pendingWorldDays: [latestAcceptedWorldDay],
    arcs: storyArcs, scanLimitReached: false,
  });

  // --- FR-M002 operational quality (ART-90) ----------------------------------
  const operationalValidations: ProposalValidationEvidence[] = [...observations.validations.values()]
    .map(({ worldDay, idempotencyKey, sceneId, stage, outcome, errorCode }) =>
      ({ worldDay, idempotencyKey, sceneId, stage, outcome, errorCode }));
  const operationalAttempts: AuthoringAttemptEvidence[] = [...observations.attempts.values()].map((attempt) => ({
    worldDay: attempt.worldDay,
    sceneId: attempt.sceneId,
    attemptId: `${attempt.simulationRunId}:attempt:${attempt.attempt}`,
    outcome: attempt.outcome,
    errorCode: attempt.errorCode,
    model: attempt.resolvedModel ?? attempt.requestedModel,
    transportRetries: attempt.transportRetries,
  }));
  const operationalScenes: SceneSafetyEvidence[] = observations.simulations.map((result) => ({
    worldDay: result.scene.worldDay,
    sceneId: result.scene.sceneId,
    label: result.safety?.label ?? null,
    reasonCodes: result.safety?.reasonCodes ?? [],
  }));
  const operational = evaluateOperationalQuality({
    worldId: LONG_RUN_WORLD_ID, fromWorldDay: startWorldDay, toWorldDay: finalWorldDay,
    validations: operationalValidations, attempts: operationalAttempts, scenes: operationalScenes,
    scanLimitReached: false,
  });

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
    resources,
    safety,
    continuity,
    narrative,
    storyQuality,
    operationalQuality: operational.report,
    operationalBreakdown: operational.breakdown,
  };
  // ART-92 review seam: content only, after the fact, outside the digest.
  input.onContentSample?.({
    scenes: observations.simulations,
    episodes: [...harness.episodes.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([worldDay, row]) => ({
        worldDay,
        episodeNumber: row.episodeNumber,
        status: row.status,
        episode: row.episode,
        safetyClassificationId: row.safetyClassificationId,
      })),
  });

  return { ...findings, digest: contentDigest(findings) };
}
