/**
 * Live world-day slot execution — the FR-C001…FR-C005 stage handlers (PRD §12 steps 1–10).
 *
 * This module wires the already-tested pure capabilities into ONE runnable chain:
 *
 *   world state → Director Plan (FR-C002) → Character Intents (FR-C003) →
 *   Scene grouping (FR-C004) → Whole-scene simulation (FR-C005) →
 *   structural validation → Canon validation → Canon commit.
 *
 * It deliberately re-uses, and never re-implements, {@link parseAndValidateDirectorPlan},
 * {@link validateCharacterIntent}, {@link groupCharacterIntents}, {@link simulateWholeScene},
 * {@link validateEventStructure}, {@link validateCanon} and {@link commitProposedEvent}.
 * What is new here is only (a) building each capability's input from real world state and
 * (b) the deterministic, zero-cost stand-in that plays the "author" role until the real
 * provider adapter (ART-72) is swapped in — see {@link ./fakeSceneNarrator.ts}.
 *
 * Pure module: no Convex imports, no clock, no randomness. Every identifier is derived
 * from (worldId, worldDay, timeSlot), so re-running or resuming a slot regenerates the
 * same Run IDs and the same Proposed Event idempotency keys — which is what makes a retry
 * idempotent at the Canon commit boundary (FR-C001 AC#3/#4).
 *
 * The Convex entry point that binds these handlers to a deployment lives in
 * {@link ./worldDayLiveFunctions.ts}. Stages 11–21 (projection, cognition, episodes,
 * publication) are the separate post-commit pipeline in `convex/operations`.
 */

import {
  emptyProjection,
  type AcceptedEvent,
  type CanonRuleContext,
  type ProposedEvent,
  type StateChange,
  type WorldProjection,
} from '../canon/model';
import { commitProposedEvent, type CanonCommitStore, type CommitResult } from '../canon/commit';
import { TIME_SLOTS, type TimeSlot } from '../canon/eventTypes';
import { replayWorldEvents } from '../canon/replay';
import { validateCanon, validateEventStructure } from '../canon/validators';
import { CanonError } from '../shared/errors';
import { CANON_SCHEMA_VERSION } from '../shared/constants';
import {
  findEnvironmentVoteCandidate,
  VIEWER_VOTE_IDEMPOTENCY_PREFIX,
} from '../shared/environmentVoteCatalog';
import {
  DIRECTOR_PACING_STAGES,
  MAX_MAJOR_SCENES_PER_SLOT,
  parseAndValidateDirectorPlan,
  type DirectorArcContext,
  type DirectorPacingStage,
  type DirectorPlan,
  type DirectorPlanContext,
  type DirectorSceneCandidate,
} from './director';
import {
  validateCharacterIntent,
  type CharacterIntent,
  type CharacterIntentContext,
  type IntentValidationResult,
} from './characterIntent';
import {
  groupCharacterIntents,
  MAX_MAJOR_SCENE_PARTICIPANTS,
  type SceneGroupingInput,
  type SceneGroupingResult,
} from './sceneGrouping';
import { simulateWholeScene, type SceneSimulationResult } from './sceneSimulation';
import type { LanguageModelProvider } from './provider';
import { FakeWholeSceneProvider } from './fakeSceneNarrator';
import {
  WorldDayOrchestrationError,
  type StageContext,
  type WorldDayStage,
  type WorldDayStageHandlers,
} from './worldDayOrchestration';

/** Upper bound on participants the Director puts in one planned scene. */
export const MAX_PLANNED_SCENE_PARTICIPANTS = 4;
/** Bounded cognition slices handed to one character (FR-C003 inputs stay traceable). */
export const MAX_INTENT_CONTEXT_ITEMS = 5;

/**
 * Slots a character may go unseen before the Director must give them a scene.
 *
 * FR-C002 already ranks characters by `slotsSinceMajorAppearance`; past this point that
 * ranking stops being a preference and becomes a reservation. One full world day is the
 * natural unit: a resident nobody has seen since yesterday is neglected, whether or not
 * anyone happens to be standing next to them.
 */
export const MAX_SLOTS_WITHOUT_APPEARANCE = TIME_SLOTS.length;

/**
 * Planned scenes per slot that may relocate their character.
 *
 * Kept at one so a relocated character merging into the residents' scene at their
 * destination can never push that scene past {@link MAX_MAJOR_SCENE_PARTICIPANTS}
 * ({@link MAX_PLANNED_SCENE_PARTICIPANTS} + 1 = 5 ≤ 6) and lose it to the FR-C004
 * participant limit.
 */
export const MAX_TRAVEL_SCENES_PER_SLOT = 1;

/** State change type a travel scene declares, and the arrival it commits. */
const TRAVEL_STATE_CHANGE = 'character_location_changed';

export type WorldDaySlotIdentity = { worldId: string; worldDay: number; timeSlot: TimeSlot };

export type LiveArc = {
  arcId: string;
  currentQuestion: string;
  status: DirectorArcContext['status'];
  /** Accepted event the arc's current revision traces to (FR-C003 AC#1). */
  sourceEventId: string;
};

export type LiveCharacter = {
  characterId: string;
  personaSummary: string;
  currentGoal: string;
  emotionalState: string;
  currentLocationId: string;
  reachableLocationIds: string[];
  slotsSinceMajorAppearance: number;
  knowledge: Array<{ knowledgeId: string; belief: string; sourceEventId: string }>;
  memories: Array<{ memoryId: string; content: string; sourceEventId: string; retrievalScore: number }>;
  assets: Array<{ assetId: string; sourceEventId: string }>;
};

/** Everything stage 1 loads. Contains only data the Director/characters may legitimately see. */
export type LiveWorldSnapshot = {
  worldId: string;
  lastSequenceNumber: number;
  characters: LiveCharacter[];
  activeArcs: LiveArc[];
  recentMajorEventIds: string[];
  environmentFactIds: string[];
  viewerInterventionEventIds: string[];
  /** Canon secrets the scene must not disclose (FR-C002 "不得洩漏的資訊"). */
  protectedFactIds: string[];
  repetitionScore: number;
};

/**
 * Data-access port for one live world-day slot. The Convex adapter binds this to `ctx.db`
 * and the existing internal persistence mutations; tests bind it to in-memory stores.
 */
export interface WorldDayLivePort {
  loadWorldSnapshot(slot: WorldDaySlotIdentity): Promise<LiveWorldSnapshot>;
  /** Environment events already scheduled for this slot (viewer injection, FR-J001). */
  loadScheduledEnvironmentEvents(slot: WorldDaySlotIdentity): Promise<ProposedEvent[]>;
  /**
   * Record that a scheduled environment event reached Canon (FR-J001 AC#4).
   *
   * Keyed on the proposal's `idempotencyKey` rather than on a row id, because that is the only
   * identifier the two sides share: the queue is written by `viewer`, and `simulation` may not
   * depend on it. Called only after the commit succeeds, so the queue records what Canon
   * actually accepted rather than what was offered — which is the distinction FR-J002 will
   * need, and the one a "mark it sent" design would have lost.
   */
  markScheduledEnvironmentEventApplied(idempotencyKey: string, eventId: string): Promise<void>;
  persistDirectorPlan(context: DirectorPlanContext, plan: DirectorPlan): Promise<void>;
  persistCharacterIntent(context: CharacterIntentContext, intent: CharacterIntent): Promise<void>;
  persistGroupedScenes(input: SceneGroupingInput, result: SceneGroupingResult): Promise<void>;
  persistSceneSimulation(groupingRunId: string, result: SceneSimulationResult): Promise<void>;
  /** Canon repository shared with the commit pipeline; never bypassed. */
  canonStore: CanonCommitStore;
}

// --- deterministic identifiers ---------------------------------------------

/**
 * Turn a queued viewer-vote intervention into a Proposed World Event (FR-J001 AC#4).
 *
 * Pure, and exported so the Convex adapter and the injection test build the same event from the
 * same code — a test that reconstructed the proposal itself would prove only that two authors
 * agreed, not that Canon receives what the ballot elected.
 *
 * Three properties are load-bearing:
 *
 *  - The sentence comes from `convex/shared/environmentVoteCatalog.ts`, i.e. from reviewed
 *    repository source. The queued row supplies an id and nothing else, so no text a viewer
 *    submitted can reach Canon even by winning.
 *  - `proposedBy` is `system`. The world proposes; the vote only chose which sanctioned option.
 *    Recording a viewer as the author would assert an authority this design does not grant.
 *  - The result is a PROPOSAL. It goes through `validateEventStructure` and `validateCanon` like
 *    any other, so a winner that contradicts the world is refused (AC#5).
 *
 * Returns `null` for an id with no catalog entry — a catalog edited after a vote closed leaves
 * the world unchanged rather than proposing an event whose text no longer exists.
 */
export function buildViewerVoteProposal(
  intervention: { worldId: string; candidateId: string; idempotencyKey: string; worldDay: number; votes: number },
  slot: WorldDaySlotIdentity,
): ProposedEvent | null {
  const candidate = findEnvironmentVoteCandidate(intervention.candidateId);
  if (candidate === null) return null;
  return {
    schemaVersion: CANON_SCHEMA_VERSION,
    worldId: intervention.worldId,
    idempotencyKey: intervention.idempotencyKey,
    proposedBy: { type: 'system', id: 'viewer_vote' },
    worldDay: slot.worldDay,
    timeSlot: slot.timeSlot,
    eventType: 'world_event',
    participantIds: [],
    causedByEventIds: [],
    publicSummary: candidate.publicSummary,
    stateChanges: [{
      type: 'fact_created',
      subjectType: 'world',
      subjectId: intervention.worldId,
      predicate: candidate.predicate,
      value: candidate.value,
      visibility: 'public',
    }],
    metadata: {
      source: 'viewer_vote',
      candidateId: intervention.candidateId,
      roundWorldDay: intervention.worldDay,
      votes: intervention.votes,
    },
  };
}

export const slotOrdinal = ({ worldDay, timeSlot }: WorldDaySlotIdentity): number =>
  worldDay * TIME_SLOTS.length + TIME_SLOTS.indexOf(timeSlot);
const slotSuffix = ({ worldId, worldDay, timeSlot }: WorldDaySlotIdentity): string =>
  `${worldId}:${worldDay}:${timeSlot}`;

export const worldDayRunId = (slot: WorldDaySlotIdentity): string => `worldday:${slotSuffix(slot)}`;
export const directorRunId = (slot: WorldDaySlotIdentity): string => `director:${slotSuffix(slot)}`;
export const groupingRunId = (slot: WorldDaySlotIdentity): string => `grouping:${slotSuffix(slot)}`;
export const characterIntentRunId = (slot: WorldDaySlotIdentity, characterId: string): string =>
  `intent:${slotSuffix(slot)}:${characterId}`;

/** Stable, order-independent fingerprint used for repeatable deterministic choices. */
function fingerprint(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export const pacingStageForSlot = (slot: WorldDaySlotIdentity): DirectorPacingStage =>
  DIRECTOR_PACING_STAGES[slotOrdinal(slot) % DIRECTOR_PACING_STAGES.length];

// --- stage 1: world snapshot ------------------------------------------------

/** How many recent accepted events feed the Director's recency and repetition inputs. */
export const RECENT_EVENT_WINDOW = 10;

/** Seed + projection inputs a deployment (or a test fixture) supplies for one slot. */
export type WorldSnapshotSources = {
  slot: WorldDaySlotIdentity;
  acceptedEvents: readonly AcceptedEvent[];
  projection: WorldProjection;
  characters: ReadonlyArray<{
    characterId: string;
    personaSummary: string;
    currentGoal: string;
    /** Seed placement used until Canon has placed the character itself. */
    initialLocationId: string | null;
  }>;
  locationConnections: Readonly<Record<string, readonly string[]>>;
  seedKnowledge: ReadonlyArray<{ characterId: string; knowledgeId: string; belief: string }>;
  seedAssets: ReadonlyArray<{ characterId: string; assetId: string }>;
  /** Canon secrets the Director marks as non-disclosable in every planned scene. */
  secretIds: readonly string[];
  activeArcs: readonly LiveArc[];
};

/** Share of the recent window taken by its single most common event type (0…1). */
export function repetitionScore(eventTypes: readonly string[]): number {
  if (eventTypes.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const eventType of eventTypes) counts.set(eventType, (counts.get(eventType) ?? 0) + 1);
  return Math.max(...counts.values()) / eventTypes.length;
}

/**
 * Build the stage-1 world snapshot. Only data the Director and the characters may
 * legitimately see is included; Canon secrets appear as opaque protected IDs, never as
 * content, and one character's cognition never leaks into another's slice (FR-C003).
 */
export function buildLiveWorldSnapshot(sources: WorldSnapshotSources): LiveWorldSnapshot {
  const { slot, projection } = sources;
  const currentOrdinal = slotOrdinal(slot);
  const lastAppearance = new Map<string, number>();
  for (const event of sources.acceptedEvents) {
    const ordinal = slotOrdinal({ ...slot, worldDay: event.worldDay, timeSlot: event.timeSlot });
    for (const characterId of event.participantIds) {
      lastAppearance.set(characterId, Math.max(lastAppearance.get(characterId) ?? ordinal, ordinal));
    }
  }
  const recent = sources.acceptedEvents.slice(-RECENT_EVENT_WINDOW);
  const characters: LiveCharacter[] = [];
  for (const seed of sources.characters) {
    const currentLocationId = projection.characterLocations[seed.characterId] ?? seed.initialLocationId;
    // A character Canon has never placed cannot be planned into a located scene.
    if (!currentLocationId) continue;
    const ownedSeedAssets = sources.seedAssets.filter(({ characterId, assetId }) =>
      characterId === seed.characterId
      // Mirrors the intent authorization set: a seed asset counts only until Canon moves it.
      && (projection.itemOwners[assetId] === undefined || projection.itemOwners[assetId] === seed.characterId));
    const seedAssetIds = new Set(ownedSeedAssets.map(({ assetId }) => assetId));
    const lastOrdinal = lastAppearance.get(seed.characterId);
    characters.push({
      characterId: seed.characterId,
      personaSummary: seed.personaSummary,
      currentGoal: seed.currentGoal,
      emotionalState: projection.characterStates[seed.characterId]?.emotion ?? 'steady',
      currentLocationId,
      reachableLocationIds: [...(projection.locations[currentLocationId]?.connectedLocationIds
        ?? sources.locationConnections[currentLocationId] ?? [])],
      slotsSinceMajorAppearance: lastOrdinal === undefined ? currentOrdinal + 1 : Math.max(0, currentOrdinal - lastOrdinal),
      knowledge: [
        ...sources.seedKnowledge.filter(({ characterId }) => characterId === seed.characterId)
          .map(({ knowledgeId, belief }) => ({ knowledgeId, belief, sourceEventId: `seed:${knowledgeId}` })),
        ...(projection.characterKnowledge[seed.characterId] ?? []).map((entry) => ({
          knowledgeId: entry.knowledgeId, belief: String(entry.beliefValue), sourceEventId: entry.sourceEventId,
        })),
      ],
      memories: (projection.characterMemories[seed.characterId] ?? []).map((entry) => ({
        memoryId: entry.memoryId, content: entry.content, sourceEventId: entry.sourceEventId,
        retrievalScore: Math.min(1, Math.max(0, entry.importance)),
      })),
      assets: [
        ...ownedSeedAssets.map(({ assetId }) => ({ assetId, sourceEventId: `seed:${assetId}` })),
        ...Object.entries(projection.itemOwners)
          .filter(([assetId, owner]) => owner === seed.characterId && !seedAssetIds.has(assetId))
          .map(([assetId]) => ({ assetId, sourceEventId: `canon:${assetId}` })),
      ],
    });
  }
  return {
    worldId: slot.worldId,
    lastSequenceNumber: projection.lastSequenceNumber,
    characters: characters.sort((left, right) => left.characterId.localeCompare(right.characterId)),
    activeArcs: [...sources.activeArcs].sort((left, right) => left.arcId.localeCompare(right.arcId)),
    recentMajorEventIds: recent.map(({ eventId }) => eventId),
    environmentFactIds: Object.keys(projection.worldEnvironment).sort((left, right) => left.localeCompare(right)),
    // FR-J001: which accepted events the daily vote put there. Derived from the accepted
    // record's own `idempotencyKey` prefix rather than from a side table, so the attribution
    // survives replay and cannot disagree with Canon. Scoped to the recent window for the same
    // reason `recentMajorEventIds` is — the Director is being told what is CURRENTLY true of
    // the world, and a blackout six days ago is history, not context.
    viewerInterventionEventIds: recent
      .filter((event) => event.idempotencyKey.startsWith(VIEWER_VOTE_IDEMPOTENCY_PREFIX))
      .map(({ eventId }) => eventId),
    protectedFactIds: [...new Set(sources.secretIds)].sort((left, right) => left.localeCompare(right)),
    repetitionScore: repetitionScore(recent.map(({ eventType }) => eventType)),
  };
}

// --- stage 4: Director Plan (FR-C002) --------------------------------------

export function buildDirectorPlanContext(
  slot: WorldDaySlotIdentity,
  snapshot: LiveWorldSnapshot,
): DirectorPlanContext {
  return {
    schemaVersion: 1,
    directorRunId: directorRunId(slot),
    worldId: slot.worldId,
    worldDay: slot.worldDay,
    timeSlot: slot.timeSlot,
    activeArcs: snapshot.activeArcs.map(({ arcId, currentQuestion, status }) => ({ arcId, currentQuestion, status })),
    unresolvedQuestions: [...new Set(snapshot.activeArcs.map(({ currentQuestion }) => currentQuestion))],
    recentMajorEventIds: [...new Set(snapshot.recentMajorEventIds)],
    characters: snapshot.characters.map(({ characterId, currentGoal, currentLocationId, slotsSinceMajorAppearance }) =>
      ({ characterId, currentGoal, currentLocationId, slotsSinceMajorAppearance })),
    viewerInterventionEventIds: [...new Set(snapshot.viewerInterventionEventIds)],
    environmentFactIds: [...new Set(snapshot.environmentFactIds)],
    repetitionScore: snapshot.repetitionScore,
    pacingStage: pacingStageForSlot(slot),
  };
}

/** A location and the characters standing in it, most neglected first. */
type LocationGroup = { locationId: string; members: DirectorPlanContext['characters'] };

/** Group the slot's characters by where they currently are, neglect-first within a location. */
function groupByLocation(context: DirectorPlanContext): LocationGroup[] {
  const byLocation = new Map<string, DirectorPlanContext['characters']>();
  for (const character of context.characters) {
    byLocation.set(character.currentLocationId, [...(byLocation.get(character.currentLocationId) ?? []), character]);
  }
  return [...byLocation.entries()]
    .map(([locationId, members]) => ({
      locationId,
      members: [...members].sort((left, right) =>
        right.slotsSinceMajorAppearance - left.slotsSinceMajorAppearance
        || left.characterId.localeCompare(right.characterId)),
    }))
    .sort((left, right) => left.locationId.localeCompare(right.locationId));
}

/**
 * Where a character standing alone should go this slot, or `null` when travelling would
 * not help. The destination is the connected location currently holding the most other
 * characters (ties by location ID), which is exactly the move that makes an isolated
 * character castable in a multi-character scene from the next slot onwards.
 *
 * Derived only from the stage-1 snapshot, so the Director stage and the intent stage
 * independently agree on it without widening the closed FR-C002 plan schema.
 */
export function travelDestinationFor(characterId: string, snapshot: LiveWorldSnapshot): string | null {
  const character = snapshot.characters.find((candidate) => candidate.characterId === characterId);
  if (!character) return null;
  const occupancy = new Map<string, number>();
  for (const other of snapshot.characters) {
    if (other.characterId === characterId) continue;
    occupancy.set(other.currentLocationId, (occupancy.get(other.currentLocationId) ?? 0) + 1);
  }
  const reachable = [...new Set(character.reachableLocationIds)]
    .filter((locationId) => locationId !== character.currentLocationId && (occupancy.get(locationId) ?? 0) > 0)
    .sort((left, right) =>
      (occupancy.get(right) ?? 0) - (occupancy.get(left) ?? 0) || left.localeCompare(right));
  return reachable[0] ?? null;
}

/**
 * A scene the Director planned for a single character who is expected to travel out of it.
 * The plan schema is closed, so the travel is declared through the one field that can carry
 * it — `expectedStateChangeTypes` — rather than by adding a field FR-C002 would reject.
 */
export const isTravelScene = (scene: DirectorSceneCandidate): boolean =>
  scene.participantIds.length === 1 && scene.expectedStateChangeTypes.includes(TRAVEL_STATE_CHANGE);

/**
 * Deterministic Director Plan candidate.
 *
 * It proposes WHERE pressure should land and WHO is present — never an outcome
 * (FR-C002 AC#1); the plan schema structurally has no outcome field. Co-located
 * characters are grouped so no scene can create a location conflict, each character is
 * used at most once so no time conflict is possible (AC#2), every scene carries the
 * Director Run ID (AC#3), and the slot is capped at {@link MAX_MAJOR_SCENES_PER_SLOT} (AC#4).
 *
 * Selection is neglect-first, then rotating. Multi-character locations rotate by slot so
 * consecutive slots do not repeat the same cast, but ANY location — including one holding a
 * single character — jumps that queue once its most neglected member has gone longer than
 * {@link MAX_SLOTS_WITHOUT_APPEARANCE} unseen. Without that reservation a character the seed
 * places alone is never castable: preferring multi-character locations is a stable
 * preference, so on a seed where some location always holds two people the solo fallback
 * never fires and the isolated character starves for the whole run (ART-60 / ART-101).
 *
 * A neglected solo character who can reach an occupied location is planned as a TRAVEL
 * scene: the scene still sits at the character's own location, because FR-C002 requires
 * every participant to already be there, and it declares {@link TRAVEL_STATE_CHANGE} so the
 * intent stage knows to send them on. At most {@link MAX_TRAVEL_SCENES_PER_SLOT} of them.
 */
export function generateDirectorPlanCandidate(
  slot: WorldDaySlotIdentity,
  snapshot: LiveWorldSnapshot,
  context: DirectorPlanContext,
): DirectorPlan {
  const ranked = groupByLocation(context);
  // Rotate over the locations that can hold a multi-character scene, as before.
  const rotationPool = ranked.filter(({ members }) => members.length > 1);
  const pool = rotationPool.length > 0 ? rotationPool : ranked;
  const offset = pool.length === 0 ? 0 : slotOrdinal(slot) % pool.length;
  const rotated = pool.map((_, step) => pool[(offset + step) % pool.length]);
  // Neglected locations jump the rotation, most neglected first.
  const neglected = ranked
    .filter(({ members }) => members[0].slotsSinceMajorAppearance > MAX_SLOTS_WITHOUT_APPEARANCE)
    .sort((left, right) =>
      right.members[0].slotsSinceMajorAppearance - left.members[0].slotsSinceMajorAppearance
      || left.locationId.localeCompare(right.locationId));
  const candidates: LocationGroup[] = [];
  for (const group of [...neglected, ...rotated]) {
    if (candidates.length >= MAX_MAJOR_SCENES_PER_SLOT) break;
    if (!candidates.some(({ locationId }) => locationId === group.locationId)) candidates.push(group);
  }

  const arcIds = snapshot.activeArcs.map(({ arcId }) => arcId).slice(0, MAX_MAJOR_SCENES_PER_SLOT);
  const protectedFactIds = [...new Set(snapshot.protectedFactIds)].slice(0, MAX_MAJOR_SCENES_PER_SLOT);

  const scenes: DirectorSceneCandidate[] = [];
  let travelScenes = 0;
  for (const group of candidates) {
    const participants = group.members.slice(0, Math.min(MAX_PLANNED_SCENE_PARTICIPANTS, MAX_MAJOR_SCENE_PARTICIPANTS));
    const lead = participants[0];
    const question = snapshot.activeArcs[0]?.currentQuestion ?? 'What does this town owe its own record?';
    const travels = participants.length === 1
      && travelScenes < MAX_TRAVEL_SCENES_PER_SLOT
      && travelDestinationFor(lead.characterId, snapshot) !== null;
    if (travels) travelScenes += 1;
    scenes.push({
      sceneId: `${context.directorRunId}:scene:${scenes.length + 1}`,
      directorRunId: context.directorRunId,
      worldDay: slot.worldDay,
      timeSlot: slot.timeSlot,
      locationId: group.locationId,
      participantIds: participants.map(({ characterId }) => characterId),
      trigger: `${lead.characterId} raises "${lead.currentGoal}" at ${group.locationId}.`,
      dramaticPressure: `${question} Waiting longer costs ${lead.characterId} standing (${context.pacingStage}).`,
      arcIds,
      protectedFactIds,
      // Declared honestly: a one-character scene has no relationship to change, and a
      // travel scene is expected to move its character.
      expectedStateChangeTypes: participants.length > 1
        ? ['relationship_changed', 'character_memory_formed', 'fact_created']
        : travels
          ? ['character_memory_formed', 'fact_created', TRAVEL_STATE_CHANGE]
          : ['character_memory_formed', 'fact_created'],
    });
  }
  return {
    schemaVersion: 1,
    directorRunId: context.directorRunId,
    worldId: slot.worldId,
    worldDay: slot.worldDay,
    timeSlot: slot.timeSlot,
    scenes,
  };
}

// --- stage 5: Character Intents (FR-C003) ----------------------------------

const sourced = (characterId: string, kind: string) => ({ sourceId: `${kind}:${characterId}`, sourceEventId: null });

export function buildCharacterIntentContext(
  slot: WorldDaySlotIdentity,
  character: LiveCharacter,
  arcs: LiveArc[],
): CharacterIntentContext {
  return {
    schemaVersion: 1,
    intentRunId: characterIntentRunId(slot, character.characterId),
    directorRunId: directorRunId(slot),
    worldId: slot.worldId,
    worldDay: slot.worldDay,
    timeSlot: slot.timeSlot,
    characterId: character.characterId,
    persona: { summary: character.personaSummary, source: sourced(character.characterId, 'persona') },
    currentGoal: { value: character.currentGoal, source: sourced(character.characterId, 'goal') },
    emotionalState: { value: character.emotionalState, source: sourced(character.characterId, 'emotion') },
    currentLocationId: character.currentLocationId,
    reachableLocationIds: character.reachableLocationIds.filter((id) => id !== character.currentLocationId),
    knowledge: character.knowledge.slice(0, MAX_INTENT_CONTEXT_ITEMS),
    memories: character.memories.slice(0, MAX_INTENT_CONTEXT_ITEMS),
    assets: character.assets.slice(0, MAX_INTENT_CONTEXT_ITEMS),
    activeArcs: arcs.map(({ arcId, currentQuestion, sourceEventId }) => ({ arcId, currentQuestion, sourceEventId })),
  };
}

/**
 * Deterministic intent for one character.
 *
 * A character the Director placed in a scene attempts an action there and addresses one
 * other participant, which is what lets FR-C004 merge the scene back together. Everyone
 * else produces a structured `wait` intent carrying its downgrade reason, so every
 * character in the slot stays traceable without inflating the major-scene count.
 * The intent only ever references cognition present in its own context, and it can never
 * mutate the world: it is data validated by {@link validateCharacterIntent} (AC#2/#3).
 */
export function generateCharacterIntent(
  context: CharacterIntentContext,
  placement: { locationId: string; targetCharacterId: string | null } | null,
): CharacterIntent {
  const seed = fingerprint(context.intentRunId);
  const base = {
    schemaVersion: 1 as const,
    intentId: `${context.intentRunId}:intent`,
    intentRunId: context.intentRunId,
    directorRunId: context.directorRunId,
    characterId: context.characterId,
    knowledgeIds: context.knowledge.slice(0, 2).map(({ knowledgeId }) => knowledgeId),
    memoryIds: context.memories.slice(0, 2).map(({ memoryId }) => memoryId),
    assetIds: context.assets.slice(0, 1).map(({ assetId }) => assetId),
    arcIds: context.activeArcs.map(({ arcId }) => arcId),
  };
  if (!placement) {
    return {
      ...base,
      action: 'wait',
      actionDescription: 'Stay with routine work this slot',
      targetCharacterId: null,
      desiredLocationId: context.currentLocationId,
      rationale: `${context.characterId} has no planned scene this slot.`,
      urgency: 0,
      downgradeReason: 'INTENT_NOT_SCHEDULED_THIS_SLOT',
    };
  }
  return {
    ...base,
    action: 'attempt',
    actionDescription: `Press the matter of "${context.currentGoal.value}" at ${placement.locationId}`,
    targetCharacterId: placement.targetCharacterId,
    desiredLocationId: placement.locationId,
    rationale: `${context.characterId} is ${context.emotionalState.value} and cannot let "${context.currentGoal.value}" wait.`,
    urgency: ((seed % 5) + 5) / 10,
    downgradeReason: null,
  };
}

// --- arrivals ---------------------------------------------------------------

/**
 * Record the arrival a Scene implies when one of its participants is not yet standing where
 * the Scene takes place.
 *
 * The author never sees the world projection, so it cannot state the movement precondition
 * FR-C002/Canon require (`fromLocationId` must equal the character's current location). The
 * orchestrator can, from the same stage-1 snapshot the Director planned against, so it
 * states it here. This is not authored content and not a Canon write: the arrival is
 * appended to a PROPOSED event that still passes through {@link validateEventStructure},
 * {@link validateCanon} (connectivity, capacity, one move per slot, participant membership)
 * and {@link commitProposedEvent} exactly like every other proposal (ADR-0001).
 */
export function withArrivalStateChanges(
  result: SceneSimulationResult,
  snapshot: LiveWorldSnapshot,
): SceneSimulationResult {
  const origins = new Map(snapshot.characters.map(({ characterId, currentLocationId }) => [characterId, currentLocationId]));
  const [first, ...rest] = result.output.proposedEvents;
  if (!first) return result;
  const arrivals: StateChange[] = result.scene.participantIds
    .filter((characterId) => {
      const from = origins.get(characterId);
      return from !== undefined && from !== result.scene.locationId;
    })
    .map((characterId) => ({
      type: 'character_location_changed' as const,
      characterId,
      fromLocationId: origins.get(characterId) as string,
      toLocationId: result.scene.locationId,
    }));
  if (arrivals.length === 0) return result;
  return {
    ...result,
    output: {
      ...result.output,
      // The arrival precedes what happens once everyone is in the room.
      proposedEvents: [{ ...first, stateChanges: [...arrivals, ...first.stateChanges] }, ...rest],
    },
  };
}

// --- scene provenance -------------------------------------------------------

/**
 * Stamp the Scene a proposal came from onto the proposal itself (FR-P004 / ART-132).
 *
 * A Scene's public text is classified once, at generation time, by
 * `postGenerationSafetyClassifications` keyed on the Scene id. The events that Scene produced
 * carry no link back to it, so the public projection had no way to ask "may this text still be
 * shown". This is the LAST point where a {@link SceneSimulationResult}'s scene and its proposed
 * events are co-located — `validate_structured_output` immediately flattens the proposals and
 * drops the scene — so the link is recorded here, in `metadata`, which Canon carries verbatim
 * and never interprets.
 *
 * `metadata` and not a new top-level field: the Canon event contract is fixed by FR-B001 and a
 * new column would have to be back-filled onto every accepted event ever committed, whereas an
 * absent `metadata.sceneId` already has a defined meaning downstream (unclassified, shown).
 */
export function withSceneProvenance(result: SceneSimulationResult): SceneSimulationResult {
  return {
    ...result,
    output: {
      ...result.output,
      proposedEvents: result.output.proposedEvents.map((proposed) => ({
        ...proposed,
        metadata: { ...proposed.metadata, sceneId: result.scene.sceneId },
      })),
    },
  };
}

// --- stage artifacts --------------------------------------------------------

export type WorldStateArtifact = { snapshot: LiveWorldSnapshot };
export type EnvironmentArtifact = { appliedEventIds: string[]; environmentFactIds: string[] };
export type ActiveArcsArtifact = { activeArcs: LiveArc[] };
export type DirectorPlanArtifact = { context: DirectorPlanContext; plan: DirectorPlan };
export type IntentsArtifact = { intents: IntentValidationResult[]; acceptedCount: number; deferredCount: number };
export type GroupingArtifact = { groupingRunId: string; result: SceneGroupingResult };
export type SimulationArtifact = { results: SceneSimulationResult[]; withheldSceneIds: string[] };
export type StructuralArtifact = { proposedEvents: ProposedEvent[] };
export type CanonArtifact = { validatedIdempotencyKeys: string[] };
export type CommitArtifact = { committedEventIds: string[]; deduplicatedEventIds: string[] };

function artifact<T>(context: StageContext, stage: WorldDayStage): T {
  const value = context.artifacts[stage];
  if (value === undefined) {
    throw new WorldDayOrchestrationError('STAGE_ARTIFACT_MISSING', `stage ${stage} produced no artifact`);
  }
  return value as T;
}

function slotOf(context: StageContext): WorldDaySlotIdentity {
  const timeSlot = TIME_SLOTS.find((candidate) => candidate === context.timeSlot);
  if (!timeSlot) throw new WorldDayOrchestrationError('RUN_INPUT_INVALID', 'run time slot is not a world time slot');
  return { worldId: context.worldId, worldDay: context.worldDay, timeSlot };
}

async function canonRuleContext(store: CanonCommitStore, worldId: string) {
  const events = await store.loadAcceptedEvents(worldId);
  const persisted = await store.loadCanonRuleContext(worldId);
  const ruleContext: CanonRuleContext = {
    ...(persisted ?? { worldId, rules: [] }),
    knownEventIds: events.map(({ eventId }) => eventId),
  };
  return { projection: replayWorldEvents(emptyProjection(worldId), events), ruleContext };
}

// --- stage handlers ---------------------------------------------------------

/**
 * Build the ten PRD §12 stage handlers for {@link executeWorldDay}. Every stage is a thin
 * adapter over an already-tested capability; a stage that throws leaves Canon untouched
 * because nothing is written before {@link commitProposedEvent} runs in the final stage.
 *
 * Scene authoring goes through the vendor-neutral {@link LanguageModelProvider} port and
 * defaults to the deterministic, zero-cost {@link FakeWholeSceneProvider}. A real adapter
 * (ART-72) is injected here instead; provider construction stays inside the adapter root
 * that the architecture boundary reserves for it.
 */
export function createWorldDayStageHandlers(
  port: WorldDayLivePort,
  provider: LanguageModelProvider = new FakeWholeSceneProvider(),
): WorldDayStageHandlers {
  return {
    load_world_state: async (context): Promise<WorldStateArtifact> => ({
      snapshot: await port.loadWorldSnapshot(slotOf(context)),
    }),

    // Viewer-injected environment events (FR-J001) are proposals like any other: they are
    // committed through the same Canon pipeline, with the same structural and Canon
    // validation, before planning reads the world. A vote therefore buys a proposal, never an
    // outcome — a winning event that would contradict the world is refused exactly as a
    // Director proposal would be.
    apply_scheduled_environment_events: async (context): Promise<EnvironmentArtifact> => {
      const slot = slotOf(context);
      const { snapshot } = artifact<WorldStateArtifact>(context, 'load_world_state');
      const scheduled = await port.loadScheduledEnvironmentEvents(slot);
      const appliedEventIds: string[] = [];
      for (const proposed of scheduled) {
        const structural = validateEventStructure(proposed);
        if (structural) throw new CanonError(structural);
        const result = await commitProposedEvent(port.canonStore, { proposed, traceId: worldDayRunId(slot) });
        appliedEventIds.push(result.eventId);
        // After the commit, so the queue records what Canon accepted. A commit that threw
        // leaves the intervention queued and the slot retryable, which is the behaviour the
        // resumable orchestrator already relies on everywhere else.
        await port.markScheduledEnvironmentEventApplied(proposed.idempotencyKey, result.eventId);
      }
      return { appliedEventIds, environmentFactIds: snapshot.environmentFactIds };
    },

    load_active_story_arcs: (context): Promise<ActiveArcsArtifact> => {
      const { snapshot } = artifact<WorldStateArtifact>(context, 'load_world_state');
      return Promise.resolve({ activeArcs: snapshot.activeArcs });
    },

    generate_daily_director_plan: async (context): Promise<DirectorPlanArtifact> => {
      const slot = slotOf(context);
      const { snapshot } = artifact<WorldStateArtifact>(context, 'load_world_state');
      const planContext = buildDirectorPlanContext(slot, snapshot);
      // The candidate is untrusted until FR-C002 validation accepts it.
      const plan = parseAndValidateDirectorPlan(
        generateDirectorPlanCandidate(slot, snapshot, planContext),
        planContext,
      );
      await port.persistDirectorPlan(planContext, plan);
      return { context: planContext, plan };
    },

    generate_character_intents: async (context): Promise<IntentsArtifact> => {
      const slot = slotOf(context);
      const { snapshot } = artifact<WorldStateArtifact>(context, 'load_world_state');
      const { plan } = artifact<DirectorPlanArtifact>(context, 'generate_daily_director_plan');
      const placements = new Map<string, { locationId: string; targetCharacterId: string | null }>();
      for (const scene of plan.scenes) {
        // A travel scene sends its character on; the destination is re-derived from the same
        // snapshot the Director planned against, so both stages agree without the plan
        // carrying a field FR-C002 does not define.
        const destination = isTravelScene(scene) ? travelDestinationFor(scene.participantIds[0], snapshot) : null;
        scene.participantIds.forEach((characterId, index) => {
          const next = scene.participantIds[(index + 1) % scene.participantIds.length];
          placements.set(characterId, {
            locationId: destination ?? scene.locationId,
            targetCharacterId: next === characterId ? null : next,
          });
        });
      }
      const planArcIds = new Set(plan.scenes.flatMap(({ arcIds }) => arcIds));
      const intents: IntentValidationResult[] = [];
      for (const character of snapshot.characters) {
        const intentContext = buildCharacterIntentContext(
          slot,
          character,
          snapshot.activeArcs.filter(({ arcId }) => planArcIds.has(arcId)),
        );
        const intent = generateCharacterIntent(intentContext, placements.get(character.characterId) ?? null);
        // FR-C003 AC#4: an unauthorized or unreachable intent is rejected or degraded here.
        intents.push(validateCharacterIntent(intent, intentContext));
        await port.persistCharacterIntent(intentContext, intent);
      }
      return {
        intents,
        acceptedCount: intents.filter(({ disposition, intent }) => disposition === 'accepted' && intent.action === 'attempt').length,
        deferredCount: intents.filter(({ disposition, intent }) => disposition === 'downgraded' || intent.action === 'wait').length,
      };
    },

    group_intents_into_scenes: async (context): Promise<GroupingArtifact> => {
      const slot = slotOf(context);
      const { intents } = artifact<IntentsArtifact>(context, 'generate_character_intents');
      const input: SceneGroupingInput = {
        schemaVersion: 1,
        groupingRunId: groupingRunId(slot),
        directorRunId: directorRunId(slot),
        worldId: slot.worldId,
        worldDay: slot.worldDay,
        timeSlot: slot.timeSlot,
        intents,
      };
      const result = groupCharacterIntents(input);
      await port.persistGroupedScenes(input, result);
      return { groupingRunId: input.groupingRunId, result };
    },

    simulate_scenes: async (context): Promise<SimulationArtifact> => {
      const grouping = artifact<GroupingArtifact>(context, 'group_intents_into_scenes');
      const { snapshot } = artifact<WorldStateArtifact>(context, 'load_world_state');
      const results: SceneSimulationResult[] = [];
      const withheldSceneIds: string[] = [];
      for (const scene of grouping.result.scenes) {
        const result = await simulateWholeScene(provider, `${scene.sceneId}:simulation`, scene);
        await port.persistSceneSimulation(grouping.groupingRunId, result);
        // FR-C005 AC#5: high-risk output goes to safety review instead of Canon.
        if (result.reviewStatus === 'required') withheldSceneIds.push(scene.sceneId);
        // FR-P004 AC#1: every event committed from here carries the Scene whose safety
        // classification governs whether its text may be shown.
        else results.push(withSceneProvenance(withArrivalStateChanges(result, snapshot)));
      }
      return { results, withheldSceneIds };
    },

    validate_structured_output: (context): Promise<StructuralArtifact> => {
      const { results } = artifact<SimulationArtifact>(context, 'simulate_scenes');
      const proposedEvents = results.flatMap(({ output }) => output.proposedEvents);
      for (const proposed of proposedEvents) {
        const structural = validateEventStructure(proposed);
        if (structural) throw new CanonError(structural);
      }
      const keys = proposedEvents.map(({ idempotencyKey }) => idempotencyKey);
      if (new Set(keys).size !== keys.length) {
        throw new WorldDayOrchestrationError('PROPOSAL_KEY_CONFLICT', 'slot proposals must have unique idempotency keys');
      }
      return Promise.resolve({ proposedEvents });
    },

    validate_canon: async (context): Promise<CanonArtifact> => {
      const { proposedEvents } = artifact<StructuralArtifact>(context, 'validate_structured_output');
      const { projection, ruleContext } = await canonRuleContext(port.canonStore, context.worldId);
      for (const proposed of proposedEvents) {
        const error = validateCanon(proposed, projection, ruleContext);
        if (error) throw new CanonError(error);
      }
      return { validatedIdempotencyKeys: proposedEvents.map(({ idempotencyKey }) => idempotencyKey) };
    },

    commit_accepted_events: async (context): Promise<CommitArtifact> => {
      const slot = slotOf(context);
      const { proposedEvents } = artifact<StructuralArtifact>(context, 'validate_structured_output');
      const committedEventIds: string[] = [];
      const deduplicatedEventIds: string[] = [];
      for (const proposed of proposedEvents) {
        const result: CommitResult = await commitProposedEvent(port.canonStore, {
          proposed,
          traceId: worldDayRunId(slot),
        });
        committedEventIds.push(result.eventId);
        if (result.deduplicated) deduplicatedEventIds.push(result.eventId);
      }
      return { committedEventIds, deduplicatedEventIds };
    },
  };
}
