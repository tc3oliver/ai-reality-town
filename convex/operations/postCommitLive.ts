/**
 * Live post-commit cognition + editorial stage handlers (PRD §12 stages 11–21, FR-E/F/G).
 *
 * This module wires the already-tested pure capabilities into ONE runnable chain that
 * runs immediately after ART-97 commits an Accepted Event:
 *
 *   read-model projection → knowledge → subjective memory → relationships →
 *   story-arc classification + lifecycle + count control (FR-F001…FR-F005) →
 *   daily episode assembly → recap pyramid → safety gate → editorial publication and
 *   public read-model rebuild → daily canon snapshot → durable metrics hook.
 *
 * It deliberately re-uses, and never re-implements, {@link parseArcEventClassification},
 * the arc lifecycle/portfolio/resolution rules, the daily-episode builder, the recap
 * builder, the publication lifecycle, and every `rebuild*` public-read projection. What
 * is new here is only (a) deriving each capability's input from the accepted event and
 * the current world state and (b) sequencing them behind the resumable orchestrator in
 * {@link ./postCommitOrchestration.ts}.
 *
 * Pure module: no Convex imports, no clock, no randomness. Every identifier is derived
 * from (worldId, sequenceNumber), so re-running or resuming a run regenerates the same
 * run/classification/recap identifiers, which is what makes a retry idempotent at each
 * capability's own idempotency boundary.
 *
 * The Convex entry point that binds these handlers to a deployment lives in
 * {@link ./postCommitLiveFunctions.ts}. Stages 1–10 (director → scene → canon commit)
 * are the separate world-day pipeline in `convex/simulation/worldDayLive.ts`.
 */

import type { AcceptedEvent } from '../canon/model';
import {
  MAX_EVENT_ARC_MEMBERSHIPS,
  MAX_PRIMARY_ARC_MEMBERSHIPS,
  NEW_ARC_MINIMUM_IMPORTANCE,
  parseArcEventClassification,
} from '../story/classification';
import { ALLOWED_ARC_TRANSITIONS, isActiveArcStatus } from '../story/lifecycle';
import {
  MAX_MAJOR_ACTIVE_ARCS,
  MAX_MAJOR_CORE_CHARACTERS,
  MAX_MINOR_ACTIVE_ARCS,
  type ArcOverflowRemediation,
  type ArcPortfolioDecision,
  type ArcPortfolioEntry,
  type ArcTier,
} from '../story/portfolio';
import type {
  ArcEventClassification,
  ArcEventMembership,
  ArcEventRole,
  ArcProjectionFields,
  StoryArcStatus,
} from '../story/model';
import {
  describePostCommitError,
  PostCommitOrchestrationError,
  type PostCommitMetricsHook,
  type PostCommitStage,
  type PostCommitStageHandlers,
  type StageContext,
  type StageMetricsEntry,
} from './postCommitOrchestration';

// --- tuning constants (all deterministic, all derived from PRD arc rules) ---

/** Importance at or above which a newly created arc is admitted as a major arc. */
export const MAJOR_ARC_IMPORTANCE = 0.75;
/** A dramatic question needs at least two parties, so solo events never open an arc. */
export const NEW_ARC_MIN_PARTICIPANTS = 2;
/** Primary-membership importance an event needs before it may advance an arc's lifecycle. */
export const ARC_TRANSITION_MIN_IMPORTANCE = 0.7;
/** Pacing: an arc advances at most one lifecycle step per world day (FR-F002 pacing). */
export const ARC_TRANSITION_MIN_WORLD_DAY_GAP = 1;
/** Upper bound on facts retained on an arc projection. */
export const MAX_ARC_ESSENTIAL_FACTS = 10;

// --- port ------------------------------------------------------------------

export type PostCommitSource = {
  worldId: string;
  sourceEventId: string;
  sourceEventSequenceNumber: number;
  worldDay: number;
};

/** One story arc as the live deployment currently holds it. */
export type LiveArcState = {
  arcId: string;
  status: StoryArcStatus;
  /** Latest revision of the arc's append-only projection stream. */
  projectionRevision: number;
  fields: ArcProjectionFields;
  /** Portfolio tier, or null when the arc was never admitted to the portfolio. */
  tier: ArcTier | null;
  /** World day of the accepted event that caused the arc's last lifecycle transition. */
  lastTransitionWorldDay: number;
};

/** Everything the stage handlers need to read once per stage, in one shape. */
export type PostCommitWorldState = {
  event: AcceptedEvent;
  arcs: LiveArcState[];
  /** Every character ID this world knows, so derived references stay valid. */
  characterIds: string[];
  /** World days whose slots are finished, ascending: the episode-eligible set. */
  completedWorldDays: number[];
  /** World days that already carry a daily-episode row. */
  episodeWorldDays: number[];
  /** First accepted sequence number of the event's world day. */
  worldDayFirstSequenceNumber: number;
  /** Highest accepted world day in canon right now. */
  latestWorldDay: number;
  /** Last accepted sequence number already covered, per `recapTargetKey`. */
  recapCursors: Record<string, number>;
};

export type RecapRequest = {
  snapshotId: string;
  recapType: 'episode' | 'viewer_context';
  targetId: string;
  fromSequenceNumber: number;
  toSequenceNumber: number;
};

export type EpisodeOutcome = { status: string; episodeNumber: number; deduplicated: boolean };

/**
 * Data-access port for one live post-commit run. The Convex adapter binds this to
 * `ctx.db` and the existing internal capability mutations; tests bind it to in-memory
 * stores. Every method is an EXISTING capability — nothing here re-implements logic.
 */
export interface PostCommitLivePort {
  loadWorldState(source: PostCommitSource): Promise<PostCommitWorldState>;
  /** ART-I005 world/character read-model rebuilds. */
  rebuildWorldProjection(worldId: string): Promise<string>;
  rebuildCharacterProjection(worldId: string, characterId: string): Promise<string>;
  /** ART-24/25 authorized knowledge ledger for one character (operations requester). */
  loadCharacterKnowledge(worldId: string, characterId: string): Promise<ReadonlyArray<{ knowledgeId: string; sourceEventId: string }>>;
  /** ART-26 subjective memory for one character (operations requester). */
  loadCharacterMemories(worldId: string, characterId: string): Promise<ReadonlyArray<{ memoryId: string; sourceEventId: string }>>;
  /** ART-I006 relationship read-model rebuild; null when the pair has no public relationship. */
  rebuildRelationshipProjection(worldId: string, sourceCharacterId: string, targetCharacterId: string): Promise<string | null>;
  /** ART-29 classification write boundary (validates provenance, creates a new arc's lifecycle + projection). */
  recordArcClassification(classification: ArcEventClassification): Promise<{ created: boolean }>;
  /** ART-30 portfolio admission boundary (count control). */
  admitArcToPortfolio(worldId: string, candidate: ArcPortfolioEntry, remediation: ArcOverflowRemediation): Promise<ArcPortfolioDecision>;
  /** Keep the portfolio snapshot aligned with the authoritative lifecycle + projection. */
  syncArcPortfolioEntry(worldId: string, arcId: string, sourceEventId: string): Promise<boolean>;
  /** ART-29 lifecycle transition boundary (FR-F002 legal transitions only). */
  transitionArcLifecycle(input: {
    worldId: string; arcId: string; expectedStatus: StoryArcStatus; toStatus: StoryArcStatus;
    sourceEventId: string; sourceEventSequenceNumber: number; reason: string;
  }): Promise<{ status: StoryArcStatus }>;
  /** ART-29 arc projection append boundary. */
  updateArcProjection(input: {
    worldId: string; arcId: string; fields: ArcProjectionFields;
    sourceEventId: string; sourceEventSequenceNumber: number; expectedRevision: number;
  }): Promise<{ revision: number }>;
  /** ART-31 stagnation detection. */
  refreshStagnationPrompts(worldId: string, currentWorldDay: number): Promise<number>;
  /** ART-33 daily episode assembly (idempotent per world day). */
  generateEpisode(worldId: string, worldDay: number, episodeNumber: number): Promise<EpisodeOutcome>;
  /** ART-34 incremental recap generation. */
  generateRecap(worldId: string, request: RecapRequest): Promise<{ snapshotId: string; deduplicated: boolean }>;
  /** ART-33 episode row, carrying the safety classification decided at generation time. */
  loadEpisodeStatus(worldId: string, worldDay: number): Promise<{ status: string; safetyClassificationId: string | null; hasEpisode: boolean } | null>;
  /** ART-51 publication lifecycle. */
  createPublication(worldId: string, contentRef: string, summary: string | null): Promise<{ status: string }>;
  advancePublication(worldId: string, contentRef: string, action: 'validate' | 'begin_safety_review' | 'pass_safety_review' | 'withhold'): Promise<{ status: string }>;
  /** ART-67 recommended entry reassessment for major active arcs. */
  reassessArcEntries(worldId: string): Promise<string[]>;
  /** ART-I003/I004 episode + timeline read-model rebuilds. */
  rebuildEpisodeProjection(worldId: string, worldDay: number): Promise<string>;
  rebuildEpisodeIndexProjection(worldId: string): Promise<string>;
  rebuildTimelineProjection(worldId: string): Promise<string>;
  /** ART-I006 arc read model and ART-38 arc primer. */
  rebuildArcReadModel(worldId: string, arcId: string): Promise<string>;
  rebuildArcPrimer(worldId: string, arcId: string): Promise<string>;
  /** ART-I002 live projection and FR-H001 onboarding summary. */
  rebuildLiveProjection(worldId: string): Promise<string>;
  rebuildOnboardingSummary(worldId: string): Promise<string>;
  /** ART-22 daily canon snapshot (idempotent per world day). */
  persistDailySnapshot(worldId: string, worldDay: number): Promise<{ snapshotId: string; deduplicated: boolean }>;
  /** Durable per-stage timings recorded by the run store, plus the recording clock. */
  loadStageMetrics(runId: string): Promise<{ stages: StageMetricsEntry[]; recordedAt: number }>;
}

// --- deterministic identifiers ---------------------------------------------

export const postCommitRunId = (worldId: string, sequenceNumber: number): string =>
  `postcommit:${worldId}:${sequenceNumber}`;
export const derivedArcId = (worldId: string, sequenceNumber: number): string =>
  `arc:${worldId}:${sequenceNumber}`;
export const episodeContentRef = (worldId: string, worldDay: number): string =>
  `episode:${worldId}:${worldDay}`;
export const recapTargetKey = (recapType: string, targetId: string): string => `${recapType}:${targetId}`;

// --- derivations ------------------------------------------------------------

/**
 * Story weight of one accepted event, from what the event itself contains: how many
 * characters it involves, how much world state it changed, and whether it produced
 * public copy. Deterministic and bounded to 0…1 so it can feed FR-F001 directly.
 */
export function arcEventImportance(event: AcceptedEvent): number {
  const participants = Math.min(event.participantIds.length, 3);
  const changes = Math.min(event.stateChanges.length, 4);
  const published = event.publicSummary && event.publicSummary.trim().length > 0 ? 0.05 : 0;
  const raw = 0.35 + participants * 0.1 + changes * 0.05 + published;
  return Math.min(1, Math.round(raw * 100) / 100);
}

/** The role an event plays for an arc already in a given lifecycle status. */
export const ARC_ROLE_BY_STATUS: Readonly<Record<StoryArcStatus, ArcEventRole>> = {
  emerging: 'development',
  active: 'escalation',
  escalating: 'turning_point',
  climax: 'climax',
  resolving: 'resolution',
  resolved: 'aftermath',
  archived: 'aftermath',
};

/** The next lifecycle status for an arc, taken from the FR-F002 legal-transition table. */
export function arcTransitionTarget(status: StoryArcStatus): StoryArcStatus | null {
  return ALLOWED_ARC_TRANSITIONS[status][0] ?? null;
}

/** Public fact IDs an accepted event created, in the shared `<eventId>:fact:<index>` form. */
export function publicFactIds(event: AcceptedEvent): string[] {
  return event.stateChanges.flatMap((change, index) =>
    change.type === 'fact_created' && (change.visibility === 'public' || change.visibility === 'canon')
      ? [`${event.eventId}:fact:${index}`]
      : []);
}

/** Character pairs whose PUBLIC relationship this event changed. */
export function publicRelationshipPairs(event: AcceptedEvent): Array<[string, string]> {
  const pairs = new Map<string, [string, string]>();
  for (const change of event.stateChanges) {
    if (change.type === 'relationship_changed' && change.visibility === 'public') {
      const key = [change.sourceCharacterId, change.targetCharacterId].sort().join('|');
      if (!pairs.has(key)) pairs.set(key, [change.sourceCharacterId, change.targetCharacterId]);
    }
  }
  return [...pairs.values()].sort((left, right) => left.join('|').localeCompare(right.join('|')));
}

/** Characters whose cognition or public projection this event can have moved. */
export function affectedCharacterIds(event: AcceptedEvent): string[] {
  const ids = new Set<string>(event.participantIds);
  for (const change of event.stateChanges) {
    if ('characterId' in change && typeof change.characterId === 'string') ids.add(change.characterId);
    if (change.type === 'relationship_changed') {
      ids.add(change.sourceCharacterId);
      ids.add(change.targetCharacterId);
    }
    if (change.type === 'fact_created' && change.subjectType === 'character') ids.add(change.subjectId);
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
}

/** Arcs the event may legitimately belong to: open arcs that share a core character. */
function candidateArcs(event: AcceptedEvent, arcs: readonly LiveArcState[]): LiveArcState[] {
  const participants = new Set(event.participantIds);
  return arcs
    .filter((arc) => arc.status === 'emerging' || isActiveArcStatus(arc.status))
    .filter((arc) => arc.fields.coreCharacterIds.some((characterId) => participants.has(characterId)))
    .sort((left, right) => right.fields.heatScore - left.fields.heatScore || left.arcId.localeCompare(right.arcId))
    .slice(0, MAX_EVENT_ARC_MEMBERSHIPS);
}

/**
 * Derive the FR-F001 arc classification CANDIDATE for one accepted event, then hand it to
 * the already-tested {@link parseArcEventClassification} so the membership, primary and
 * new-arc rules are enforced by the story layer rather than restated here.
 *
 * Returns null when the event belongs to no arc and is not weighty enough to open one —
 * not every accepted event is arc material, and the classification schema requires at
 * least one membership.
 */
export function deriveArcClassification(
  event: AcceptedEvent,
  arcs: readonly LiveArcState[],
): ArcEventClassification | null {
  const importance = arcEventImportance(event);
  const matched = candidateArcs(event, arcs);
  if (matched.length > 0) {
    const memberships: ArcEventMembership[] = matched.map((arc, index) => ({
      arcId: arc.arcId,
      primary: index < MAX_PRIMARY_ARC_MEMBERSHIPS,
      importance,
      role: ARC_ROLE_BY_STATUS[arc.status],
      coreCharacterIdsAdded: [],
      coreCharacterIdsRemoved: [],
    }));
    return parseArcEventClassification({
      schemaVersion: 1, worldId: event.worldId, sourceEventId: event.eventId,
      sourceEventSequenceNumber: event.sequenceNumber, memberships, newArc: null,
    });
  }
  if (importance < NEW_ARC_MINIMUM_IMPORTANCE || event.participantIds.length < NEW_ARC_MIN_PARTICIPANTS) return null;
  const arcId = derivedArcId(event.worldId, event.sequenceNumber);
  const coreCharacterIds = [...event.participantIds].sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_MAJOR_CORE_CHARACTERS);
  const premise = event.publicSummary?.trim() || `${coreCharacterIds.join(' and ')} were drawn into an unresolved matter.`;
  return parseArcEventClassification({
    schemaVersion: 1, worldId: event.worldId, sourceEventId: event.eventId,
    sourceEventSequenceNumber: event.sequenceNumber,
    memberships: [{
      arcId, primary: true, importance, role: 'inciting_incident',
      coreCharacterIdsAdded: coreCharacterIds, coreCharacterIdsRemoved: [],
    }],
    newArc: {
      arcId,
      title: `Arc from world day ${event.worldDay} (${event.timeSlot})`,
      premise,
      currentQuestion: `How will ${coreCharacterIds[0]} settle what happened at ${event.locationId}?`,
      coreCharacterIds,
    },
  });
}

/** Portfolio candidate for a newly classified arc (FR-F003 count control input). */
export function newArcPortfolioEntry(
  event: AcceptedEvent,
  classification: ArcEventClassification,
): ArcPortfolioEntry {
  const proposal = classification.newArc;
  if (!proposal) throw new PostCommitOrchestrationError('ARC_CANDIDATE_MISSING', 'classification has no new arc');
  const membership = classification.memberships.find(({ arcId }) => arcId === proposal.arcId);
  const importance = membership?.importance ?? 0;
  return {
    projection: {
      schemaVersion: 1, worldId: event.worldId, arcId: proposal.arcId,
      title: proposal.title, premise: proposal.premise, currentQuestion: proposal.currentQuestion,
      status: 'emerging', coreCharacterIds: [...proposal.coreCharacterIds],
      incitingEventId: event.eventId, latestTurningPointEventId: null,
      essentialFactIds: [], unresolvedQuestions: [proposal.currentQuestion], resolvedQuestions: [],
      recommendedEntryEventId: null, heatScore: Math.round(importance * 100),
      lastProgressTime: { worldDay: event.worldDay, timeSlot: event.timeSlot, sourceEventId: event.eventId },
      revision: 0,
    },
    tier: importance >= MAJOR_ARC_IMPORTANCE ? 'major' : 'minor',
    priority: Math.round(importance * 100),
    published: true,
    sourceEventIds: [event.eventId],
  };
}

/**
 * FR-F003 overflow remediation choice. A major candidate that cannot fit the major pool
 * is downgraded while the minor pool has room, and rejected otherwise; a minor candidate
 * that cannot fit is rejected. The decision itself is made by the already-tested
 * {@link applyArcPortfolioControl} behind {@link PostCommitLivePort.admitArcToPortfolio}.
 */
export function overflowRemediation(tier: ArcTier, activeMinorCount: number): ArcOverflowRemediation {
  if (tier === 'major' && activeMinorCount < MAX_MINOR_ACTIVE_ARCS) return { type: 'downgrade' };
  return { type: 'reject' };
}

/** Arc projection fields after an event, or null when nothing changed. */
export function nextArcProjectionFields(
  current: ArcProjectionFields,
  event: AcceptedEvent,
  membership: ArcEventMembership,
): ArcProjectionFields | null {
  const marksTurningPoint = membership.role === 'turning_point' || membership.role === 'climax' || membership.role === 'resolution';
  const resolves = membership.role === 'resolution';
  const facts = [...new Set([...current.essentialFactIds, ...publicFactIds(event)])].slice(0, MAX_ARC_ESSENTIAL_FACTS);
  const resolvedQuestions = resolves
    ? [...new Set([...current.resolvedQuestions, current.currentQuestion])]
    : current.resolvedQuestions;
  const unresolvedQuestions = resolves
    ? current.unresolvedQuestions.filter((question) => !resolvedQuestions.includes(question))
    : current.unresolvedQuestions;
  const next: ArcProjectionFields = {
    ...current,
    latestTurningPointEventId: marksTurningPoint ? event.eventId : current.latestTurningPointEventId,
    essentialFactIds: facts,
    resolvedQuestions,
    unresolvedQuestions,
    heatScore: Math.round(membership.importance * 100),
  };
  return JSON.stringify(next) === JSON.stringify(current) ? null : next;
}

/**
 * Episode number for a completed world day: its 1-based position in the world's completed
 * days. Accepted history is append-only and days complete in order, so the number a day
 * receives never changes.
 */
export function episodeNumberFor(completedWorldDays: readonly number[], worldDay: number): number | null {
  const index = [...completedWorldDays].sort((left, right) => left - right).indexOf(worldDay);
  return index < 0 ? null : index + 1;
}

/** Recap requests for this commit: the day-level episode recap and the world-level context recap. */
export function deriveRecapRequests(state: PostCommitWorldState): RecapRequest[] {
  const { event } = state;
  const to = event.sequenceNumber;
  const targets: Array<{ recapType: RecapRequest['recapType']; targetId: string; start: number }> = [
    { recapType: 'episode', targetId: `day:${event.worldDay}`, start: state.worldDayFirstSequenceNumber },
    { recapType: 'viewer_context', targetId: event.worldId, start: 0 },
  ];
  return targets.flatMap(({ recapType, targetId, start }) => {
    const cursor = state.recapCursors[recapTargetKey(recapType, targetId)];
    const from = cursor === undefined ? start : cursor + 1;
    if (from > to) return [];
    return [{
      snapshotId: `recap:${event.worldId}:${recapType}:${targetId}:${to}`,
      recapType, targetId, fromSequenceNumber: from, toSequenceNumber: to,
    }];
  });
}

// --- stage artifacts --------------------------------------------------------

export type ProjectionArtifact = { characterIds: string[]; modelRefs: string[] };
export type KnowledgeArtifact = { entries: Array<{ characterId: string; knowledgeCount: number; newKnowledgeIds: string[] }> };
export type MemoryArtifact = { entries: Array<{ characterId: string; memoryCount: number; newMemoryIds: string[] }> };
export type RelationshipArtifact = { modelRefs: string[] };
export type ArcTransitionRecord = { arcId: string; fromStatus: StoryArcStatus; toStatus: StoryArcStatus };
export type ArcArtifact = {
  classifiedArcIds: string[];
  createdArcId: string | null;
  portfolioDecision: ArcPortfolioDecision | null;
  transitions: ArcTransitionRecord[];
  deferredTransitions: Array<{ arcId: string; toStatus: StoryArcStatus; reason: string }>;
  projectionRevisions: Array<{ arcId: string; revision: number }>;
  stagnationPromptCount: number;
};
export type EpisodeArtifact = { episodes: Array<{ worldDay: number } & EpisodeOutcome> };
export type RecapArtifact = { snapshots: Array<{ targetId: string; snapshotId: string; deduplicated: boolean }> };
export type SafetyArtifact = {
  worldDay: number;
  episodeStatus: string | null;
  safetyClassificationId: string | null;
  publishable: boolean;
};
export type PublicationArtifact = {
  contentRef: string | null;
  publicationStatus: string | null;
  reassessedArcIds: string[];
  modelRefs: string[];
};
export type SnapshotArtifact = {
  worldDay: number | null;
  snapshotId: string | null;
  deduplicated: boolean;
  /** Non-null when the daily snapshot could not be taken; see the `snapshot` stage handler. */
  errorCode: string | null;
  errorMessage: string | null;
};

function artifact<T>(context: StageContext, stage: PostCommitStage): T {
  const value = context.artifacts[stage];
  if (value === undefined) {
    throw new PostCommitOrchestrationError('STAGE_ARTIFACT_MISSING', `stage ${stage} produced no artifact`);
  }
  return value as T;
}

const sourceOf = (context: StageContext): PostCommitSource => ({
  worldId: context.worldId,
  sourceEventId: context.sourceEventId,
  sourceEventSequenceNumber: context.sourceEventSequenceNumber,
  worldDay: context.worldDay,
});

// --- stage handlers ---------------------------------------------------------

/**
 * Build the eleven PRD §12 stage handlers for {@link executePostCommitPipeline}. Every
 * stage is a thin adapter over an already-tested capability, so a stage that throws
 * leaves Canon untouched — nothing in this pipeline writes accepted events.
 */
export function createPostCommitStageHandlers(port: PostCommitLivePort): PostCommitStageHandlers {
  return {
    // Stage 11: refresh the world and character public read models from canon.
    projection: async (context): Promise<ProjectionArtifact> => {
      const state = await port.loadWorldState(sourceOf(context));
      const characterIds = affectedCharacterIds(state.event);
      const modelRefs = [await port.rebuildWorldProjection(context.worldId)];
      for (const characterId of characterIds) {
        modelRefs.push(await port.rebuildCharacterProjection(context.worldId, characterId));
      }
      return { characterIds, modelRefs };
    },

    // Stage 12: the knowledge ledger is a canon replay, so the commit IS the update; this
    // stage reads it back through the authorization boundary and records what the event added.
    knowledge: async (context): Promise<KnowledgeArtifact> => {
      const { characterIds } = artifact<ProjectionArtifact>(context, 'projection');
      const entries: KnowledgeArtifact['entries'] = [];
      for (const characterId of characterIds) {
        const records = await port.loadCharacterKnowledge(context.worldId, characterId);
        entries.push({
          characterId,
          knowledgeCount: records.length,
          newKnowledgeIds: records.filter((record) => record.sourceEventId === context.sourceEventId)
            .map(({ knowledgeId }) => knowledgeId),
        });
      }
      return { entries };
    },

    // Stage 13: same contract for subjective memory (FR-E002).
    memory: async (context): Promise<MemoryArtifact> => {
      const { characterIds } = artifact<ProjectionArtifact>(context, 'projection');
      const entries: MemoryArtifact['entries'] = [];
      for (const characterId of characterIds) {
        const records = await port.loadCharacterMemories(context.worldId, characterId);
        entries.push({
          characterId,
          memoryCount: records.length,
          newMemoryIds: records.filter((record) => record.sourceEventId === context.sourceEventId)
            .map(({ memoryId }) => memoryId),
        });
      }
      return { entries };
    },

    // Stage 14: rebuild the public relationship read model for every pair the event moved.
    relationship: async (context): Promise<RelationshipArtifact> => {
      const state = await port.loadWorldState(sourceOf(context));
      const modelRefs: string[] = [];
      for (const [sourceCharacterId, targetCharacterId] of publicRelationshipPairs(state.event)) {
        const modelRef = await port.rebuildRelationshipProjection(context.worldId, sourceCharacterId, targetCharacterId);
        if (modelRef) modelRefs.push(modelRef);
      }
      return { modelRefs };
    },

    // Stage 15: FR-F001…FR-F005 — classify the event into arcs, admit a new arc under the
    // count-control limits, advance legal lifecycle transitions, append the arc projection
    // revision, and refresh stagnation prompts.
    arc: async (context): Promise<ArcArtifact> => {
      const state = await port.loadWorldState(sourceOf(context));
      const empty: ArcArtifact = {
        classifiedArcIds: [], createdArcId: null, portfolioDecision: null, transitions: [],
        deferredTransitions: [], projectionRevisions: [], stagnationPromptCount: 0,
      };
      const classification = deriveArcClassification(state.event, state.arcs);
      if (!classification) {
        empty.stagnationPromptCount = await port.refreshStagnationPrompts(context.worldId, state.latestWorldDay);
        return empty;
      }
      await port.recordArcClassification(classification);

      const result: ArcArtifact = { ...empty, classifiedArcIds: classification.memberships.map(({ arcId }) => arcId) };
      const activeMinorCount = state.arcs.filter((arc) => arc.tier === 'minor' && isActiveArcStatus(arc.status)).length;
      if (classification.newArc) {
        const candidate = newArcPortfolioEntry(state.event, classification);
        result.createdArcId = classification.newArc.arcId;
        result.portfolioDecision = await port.admitArcToPortfolio(
          context.worldId, candidate, overflowRemediation(candidate.tier, activeMinorCount),
        );
        // A freshly created arc already carries its revision-0 projection and `emerging`
        // lifecycle from the classification boundary; nothing further to advance here.
        result.stagnationPromptCount = await port.refreshStagnationPrompts(context.worldId, state.latestWorldDay);
        return result;
      }

      const activeCounts: Record<ArcTier, number> = {
        major: state.arcs.filter((arc) => arc.tier === 'major' && isActiveArcStatus(arc.status)).length,
        minor: activeMinorCount,
      };
      for (const membership of classification.memberships) {
        const arc = state.arcs.find(({ arcId }) => arcId === membership.arcId);
        if (!arc) continue;
        const fields = nextArcProjectionFields(arc.fields, state.event, membership);
        if (fields) {
          const { revision } = await port.updateArcProjection({
            worldId: context.worldId, arcId: arc.arcId, fields,
            sourceEventId: context.sourceEventId, sourceEventSequenceNumber: context.sourceEventSequenceNumber,
            expectedRevision: arc.projectionRevision,
          });
          result.projectionRevisions.push({ arcId: arc.arcId, revision });
        }
        const toStatus = arcTransitionTarget(arc.status);
        const gap = state.event.worldDay - arc.lastTransitionWorldDay;
        if (!toStatus || !membership.primary || membership.importance < ARC_TRANSITION_MIN_IMPORTANCE) continue;
        if (gap < ARC_TRANSITION_MIN_WORLD_DAY_GAP) {
          result.deferredTransitions.push({ arcId: arc.arcId, toStatus, reason: 'ARC_TRANSITION_PACING' });
          continue;
        }
        // FR-F003: entering the active family is gated by the tier's active-arc limit.
        const tier: ArcTier = arc.tier ?? 'minor';
        const limit = tier === 'major' ? MAX_MAJOR_ACTIVE_ARCS : MAX_MINOR_ACTIVE_ARCS;
        const entersActiveFamily = !isActiveArcStatus(arc.status) && isActiveArcStatus(toStatus);
        if (entersActiveFamily && activeCounts[tier] >= limit) {
          result.deferredTransitions.push({ arcId: arc.arcId, toStatus, reason: 'ARC_ACTIVE_LIMIT_REACHED' });
          continue;
        }
        await port.transitionArcLifecycle({
          worldId: context.worldId, arcId: arc.arcId, expectedStatus: arc.status, toStatus,
          sourceEventId: context.sourceEventId, sourceEventSequenceNumber: context.sourceEventSequenceNumber,
          reason: `accepted event classified as ${membership.role}`,
        });
        if (entersActiveFamily) activeCounts[tier] += 1;
        result.transitions.push({ arcId: arc.arcId, fromStatus: arc.status, toStatus });
      }
      for (const arcId of result.classifiedArcIds) {
        await port.syncArcPortfolioEntry(context.worldId, arcId, context.sourceEventId);
      }
      result.stagnationPromptCount = await port.refreshStagnationPrompts(context.worldId, state.latestWorldDay);
      return result;
    },

    // Stage 16: assemble the daily episode for every completed world day that has none.
    episode: async (context): Promise<EpisodeArtifact> => {
      const state = await port.loadWorldState(sourceOf(context));
      const pending = state.completedWorldDays.filter((worldDay) => !state.episodeWorldDays.includes(worldDay));
      const episodes: EpisodeArtifact['episodes'] = [];
      for (const worldDay of [...pending].sort((left, right) => left - right)) {
        const episodeNumber = episodeNumberFor(state.completedWorldDays, worldDay);
        if (episodeNumber === null) continue;
        episodes.push({ worldDay, ...await port.generateEpisode(context.worldId, worldDay, episodeNumber) });
      }
      return { episodes };
    },

    // Stage 17: advance the recap pyramid (day-level episode recap, world-level context recap).
    recap: async (context): Promise<RecapArtifact> => {
      const state = await port.loadWorldState(sourceOf(context));
      const snapshots: RecapArtifact['snapshots'] = [];
      for (const request of deriveRecapRequests(state)) {
        const result = await port.generateRecap(context.worldId, request);
        snapshots.push({ targetId: request.targetId, ...result });
      }
      return { snapshots };
    },

    // Stage 18: the publication gate. Episode generation already ran the ART-52 post-generation
    // classifier and stored its verdict; this stage reads that verdict rather than re-running it.
    safety: async (context): Promise<SafetyArtifact> => {
      const { episodes } = artifact<EpisodeArtifact>(context, 'episode');
      const latest = [...episodes].sort((left, right) => right.worldDay - left.worldDay)[0];
      if (!latest) {
        return { worldDay: context.worldDay, episodeStatus: null, safetyClassificationId: null, publishable: false };
      }
      const row = await port.loadEpisodeStatus(context.worldId, latest.worldDay);
      return {
        worldDay: latest.worldDay,
        episodeStatus: row?.status ?? null,
        safetyClassificationId: row?.safetyClassificationId ?? null,
        publishable: row?.status === 'ready' && row.hasEpisode,
      };
    },

    // Stage 19: editorial release. The publication record advances as far as a SYSTEM actor
    // is authorized to take it (FR-K004 reserves `publish` for an administrator), and every
    // affected public read model is rebuilt so visitors see the new content without any
    // generation on the read path.
    publication: async (context): Promise<PublicationArtifact> => {
      const safety = artifact<SafetyArtifact>(context, 'safety');
      const arcs = artifact<ArcArtifact>(context, 'arc');
      let contentRef: string | null = null;
      let publicationStatus: string | null = null;
      if (safety.episodeStatus !== null) {
        contentRef = episodeContentRef(context.worldId, safety.worldDay);
        publicationStatus = (await port.createPublication(context.worldId, contentRef, null)).status;
        const actions = safety.publishable
          ? ['validate', 'begin_safety_review', 'pass_safety_review'] as const
          : ['validate', 'withhold'] as const;
        for (const action of actions) {
          if (publicationStatus === 'ready' || publicationStatus === 'withheld' || publicationStatus === 'published') break;
          publicationStatus = (await port.advancePublication(context.worldId, contentRef, action)).status;
        }
      }
      const reassessedArcIds = await port.reassessArcEntries(context.worldId);
      const modelRefs: string[] = [];
      if (safety.publishable) modelRefs.push(await port.rebuildEpisodeProjection(context.worldId, safety.worldDay));
      modelRefs.push(await port.rebuildEpisodeIndexProjection(context.worldId));
      modelRefs.push(await port.rebuildTimelineProjection(context.worldId));
      // Only the arcs THIS event moved are rebuilt: an untouched arc's read model is
      // already current, and rebuilding every active arc on every commit does not scale.
      const arcIds = [...new Set(arcs.classifiedArcIds)].sort((left, right) => left.localeCompare(right));
      for (const arcId of arcIds) {
        modelRefs.push(await port.rebuildArcReadModel(context.worldId, arcId));
        modelRefs.push(await port.rebuildArcPrimer(context.worldId, arcId));
      }
      modelRefs.push(await port.rebuildLiveProjection(context.worldId));
      modelRefs.push(await port.rebuildOnboardingSummary(context.worldId));
      return { contentRef, publicationStatus, reassessedArcIds, modelRefs };
    },

    // Stage 20: the daily canon snapshot, taken once a world day is finished and is still
    // the latest day in canon (the snapshot contract forbids snapshotting a past day).
    //
    // The snapshot is a canon RECOVERY artifact: it is not an input to any public read
    // model, so a snapshot failure is recorded on the artifact instead of aborting the
    // editorial release that already completed in stage 19. A world seeded through
    // `canon/worldConfig.ts:importWorld` currently cannot take a daily snapshot at all —
    // its `initial` snapshot holds seeded locations/organizations that are not derivable
    // from accepted events, which `assertSnapshotMatchesHistory` rejects. That mismatch
    // predates this pipeline (`persistDailySnapshot` fails standalone for such a world)
    // and is tracked separately; it must not stop the live daily cycle.
    snapshot: async (context): Promise<SnapshotArtifact> => {
      const state = await port.loadWorldState(sourceOf(context));
      const worldDay = state.latestWorldDay;
      if (!state.completedWorldDays.includes(worldDay)) {
        return { worldDay: null, snapshotId: null, deduplicated: false, errorCode: null, errorMessage: null };
      }
      try {
        const result = await port.persistDailySnapshot(context.worldId, worldDay);
        return { worldDay, ...result, errorCode: null, errorMessage: null };
      } catch (error) {
        const failure = describePostCommitError(error);
        return {
          worldDay, snapshotId: null, deduplicated: false,
          errorCode: failure.code, errorMessage: failure.message,
        };
      }
    },

    // Stage 21: the durable metrics hook, linked to the trace this run was started with.
    metrics: async (context): Promise<PostCommitMetricsHook> => {
      const { stages, recordedAt } = await port.loadStageMetrics(context.runId);
      return {
        schemaVersion: 1,
        runId: context.runId,
        worldId: context.worldId,
        traceId: context.traceId,
        sourceEventId: context.sourceEventId,
        stages,
        recordedAt,
      };
    },
  };
}
