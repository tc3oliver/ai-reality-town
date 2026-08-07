/**
 * Visual Replay — the text-free playback payload (FR-O013 / ART-121, PRD 2.0 §10.4/§14.7).
 *
 * A viewer arriving between Canon slots sees a world where nothing recently happened. This
 * module builds the thing that fixes that: an ordered, self-contained description of the
 * last one to three important completed scenes, from data that has already been accepted and
 * already been published. It generates nothing. There is no provider here, no clock, no
 * randomness and no Canon import, the same three properties its pure siblings
 * (`publicDynamicProjection.ts`, `activeScenePresentation.ts`, `runtimeSnapshot.ts`) hold.
 *
 * ## Two decisions worth stating plainly
 *
 * **1. A replay is never a live motion.** The obvious implementation — publish
 * `motionType: 'replay'` units into `PublicDynamicProjection.characters` — is disqualified
 * three times over. That contract enforces exactly one motion per character and a replay
 * needs several per character over time; it uses absolute timestamps and a replay's timing is
 * relative to a per-viewer playback start; and putting historical positions into the array a
 * client draws as "now" is precisely the RISK2-009 failure this feature exists to avoid. So
 * what is stored here is *relative* (`durationMs`, never `startedAt`), and the client
 * synthesises `PublicCharacterMotion`-shaped units locally and feeds them through the
 * existing renderer. See `docs/visual-replay.md`.
 *
 * **2. No step stores text (AC#10).** A `dialogue` or `eventCard` step carries an ADDRESS —
 * a `publicSummaryId`/`publicExcerptId` plus the `publicationVersion` that was current when
 * the replay was built — and the text is resolved at read time against the live publication
 * record (`visualReplayFunctions.ts`). A stored copy would survive a withhold: the editorial
 * pipeline could retract an episode and this payload would keep serving the retracted
 * sentence until something rebuilt it. An address cannot, because a version that no longer
 * matches simply resolves to nothing. That absence is the whole mechanism FR-P004 / ART-132
 * builds its invalidation on; this task ships the shape and the version gate, not the
 * invalidation itself.
 *
 * `dialogue` steps are declared and never produced. The published dialogue-excerpt store they
 * would address is FR-O004 / ART-123's to build, and declaring the step now means that task
 * widens a contract rather than redefining one — the same "declared but dormant" pattern this
 * codebase already used for `motionType: 'replay'` itself.
 */

import {
  groupSceneEvents,
  narrationForEvents,
  resolveSceneSpatials,
  type PublishedKeyScene,
  type SceneArcMembership,
  type SceneEventLike,
  type SceneGroup,
} from './activeScenePresentation';
import { PUBLIC_DYNAMIC_FORBIDDEN_FIELDS } from './publicDynamicProjection';
import { travelDurationMs } from '../visualRuntime/motion';
import { bootstrapAnchor } from '../visualRuntime/seedBootstrap';
import type { VisualRuntimeInput } from '../visualRuntime/visualSyncPlanner';

/** Bumped when a stored field is added, removed or reinterpreted. */
export const VISUAL_REPLAY_SCHEMA_VERSION = 1;

export const VISUAL_REPLAY_MODEL_KIND = 'visualReplay' as const;

/** PRD 2.0 §9.1.4: one to three recent important scenes, roughly 20–60 seconds each. */
export const REPLAY_MIN_SCENES = 1;
export const REPLAY_MAX_SCENES = 3;
export const REPLAY_SCENE_MIN_MS = 20_000;
export const REPLAY_SCENE_MAX_MS = 60_000;

/** How long one event card is on screen. Long enough to read a sentence, short enough to sit through. */
export const REPLAY_EVENT_CARD_MS = 4_000;

export const REPLAY_STEP_TYPES = ['move', 'wait', 'dialogue', 'eventCard'] as const;
export type ReplayStepType = (typeof REPLAY_STEP_TYPES)[number];

/**
 * What a text reference addresses.
 *
 * `episodeScene` — a key scene of a `ready` daily episode, governed by the `publicationRecords`
 * row for `episode:<worldId>:<worldDay>`, so it inherits the withhold/supersede lifecycle for
 * free. `canonEventSummary` — an accepted event's own `publicSummary`. `publicExcerpt` —
 * reserved for ART-123's dialogue store; never produced here.
 */
export const REPLAY_TEXT_REF_KINDS = ['episodeScene', 'canonEventSummary', 'publicExcerpt'] as const;
export type ReplayTextRefKind = (typeof REPLAY_TEXT_REF_KINDS)[number];

/**
 * Publication statuses that make an episode's text eligible to be referenced.
 *
 * `withheld` and `superseded` are deliberately absent, and so is every pre-approval state:
 * a reference is only emitted for text that has already cleared editorial safety.
 */
export const REPLAY_PUBLISHED_RECORD_STATUSES: readonly string[] = ['ready', 'published'];

/**
 * The `publicationVersion` of a `canonEventSummary` reference, always 1.
 *
 * Accepted Canon events are append-only and never edited in place (CLAUDE.md §6), so an
 * event's `publicSummary` is immutable by construction and a monotonic version has nothing
 * to count. Documented as a partial-lifecycle limitation rather than hidden: there is today
 * no way to withhold an individual event summary, and building one is ART-132's call to make
 * if it ever needs it. See `docs/visual-replay.md`.
 */
export const CANON_EVENT_SUMMARY_VERSION = 1;

export type ReplayPoint = { x: number; y: number };

/** Where one character stood before and after the scene. Tile coordinates, as everywhere else. */
export type ReplayParticipant = {
  characterId: string;
  startPosition: ReplayPoint;
  endPosition: ReplayPoint;
};

/**
 * A walk, expressed as a duration rather than a window.
 *
 * There is no `startedAt` and no `arriveAt` anywhere in this payload, and that omission is
 * the contract: playback begins when a viewer's browser begins it, so an absolute instant
 * stored here would be a claim about a moment that has not happened yet.
 */
export type ReplayMoveStep = {
  type: 'move';
  characterId: string;
  to: ReplayPoint;
  durationMs: number;
};

/** Padding, so a very short scene still reads as a scene rather than a flicker. */
export type ReplayWaitStep = { type: 'wait'; durationMs: number };

/**
 * Declared, never produced by this task. FR-O004 / ART-123 owns the published excerpt store
 * this addresses; `buildVisualReplay` emitting one would be a bug, and a test asserts it does
 * not.
 */
export type ReplayDialogueStep = {
  type: 'dialogue';
  characterId: string;
  refKind: 'publicExcerpt';
  publicExcerptId: string;
  publicationVersion: number;
  durationMs: number;
};

/** An address, never a sentence. See the module header. */
export type ReplayEventCardStep = {
  type: 'eventCard';
  refKind: 'episodeScene' | 'canonEventSummary';
  publicSummaryId: string;
  publicationVersion: number;
  durationMs: number;
};

export type ReplayStep = ReplayMoveStep | ReplayWaitStep | ReplayDialogueStep | ReplayEventCardStep;

export type ReplayScene = {
  /** `${worldDay}:${timeSlot}:${locationId}` — the same id ART-122 publishes for the same scene. */
  sceneId: string;
  worldDay: number;
  timeSlot: string;
  locationId: string;
  sourceEventIds: string[];
  participants: ReplayParticipant[];
  steps: ReplayStep[];
  /** Always the sum of the steps' durations, and always inside [MIN, MAX]. */
  durationMs: number;
};

export type VisualReplay = {
  schemaVersion: typeof VISUAL_REPLAY_SCHEMA_VERSION;
  /**
   * `replay:<worldId>:<highest replayed sequence number>`.
   *
   * Deterministic, and it changes exactly when a newly completed Canon slot becomes
   * replayable — which is what makes the client's "auto-play at most once per session"
   * bookkeeping (AC#5) key off something meaningful rather than off a random token.
   */
  replayId: string;
  worldId: string;
  /** The Canon day and slot of the LAST scene replayed, so the banner can name where playback ends. */
  worldDay: number;
  timeSlot: string;
  sourceEventIds: string[];
  scenes: ReplayScene[];
  totalDurationMs: number;
};

export const REPLAY_ROOT_FIELDS = [
  'schemaVersion', 'replayId', 'worldId', 'worldDay', 'timeSlot',
  'sourceEventIds', 'scenes', 'totalDurationMs',
] as const;

export const REPLAY_SCENE_FIELDS = [
  'sceneId', 'worldDay', 'timeSlot', 'locationId',
  'sourceEventIds', 'participants', 'steps', 'durationMs',
] as const;

export const REPLAY_PARTICIPANT_FIELDS = ['characterId', 'startPosition', 'endPosition'] as const;

export const REPLAY_MOVE_STEP_FIELDS = ['type', 'characterId', 'to', 'durationMs'] as const;
export const REPLAY_WAIT_STEP_FIELDS = ['type', 'durationMs'] as const;
export const REPLAY_DIALOGUE_STEP_FIELDS = [
  'type', 'characterId', 'refKind', 'publicExcerptId', 'publicationVersion', 'durationMs',
] as const;
export const REPLAY_EVENT_CARD_STEP_FIELDS = [
  'type', 'refKind', 'publicSummaryId', 'publicationVersion', 'durationMs',
] as const;

/**
 * Field names that must never appear at any depth of a built replay.
 *
 * The first group is the point of AC#10: every name a free-text copy would plausibly be
 * stored under. The rest is `PUBLIC_DYNAMIC_FORBIDDEN_FIELDS` whole, because a payload
 * derived from the same accepted events is exposed to the same leakage surface and keeping
 * two lists in sync by hand is how one of them ends up shorter.
 */
export const REPLAY_FORBIDDEN_FIELDS: readonly string[] = [
  ...new Set([
    'text', 'summary', 'title', 'content', 'excerpt', 'dialogue', 'body', 'caption',
    ...PUBLIC_DYNAMIC_FORBIDDEN_FIELDS,
  ]),
];

export type VisualReplayErrorCode =
  | 'VISUAL_REPLAY_INVALID_SHAPE'
  | 'VISUAL_REPLAY_UNKNOWN_FIELD'
  | 'VISUAL_REPLAY_FORBIDDEN_FIELD'
  | 'VISUAL_REPLAY_INVALID_VALUE';

export class VisualReplayError extends Error {
  constructor(readonly code: VisualReplayErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'VisualReplayError';
  }
}

// --- addresses ---------------------------------------------------------------

/**
 * `episode:<worldId>:<worldDay>#scene:<index>`.
 *
 * The prefix before `#` is verbatim `episodeContentRef` from the post-commit pipeline, which
 * is the key `publicationRecords` is already indexed by — so the read-time resolver looks up
 * the very row the editorial lifecycle maintains, rather than a parallel identifier this
 * module invented and would have to keep in sync.
 */
export function episodeSceneSummaryId(worldId: string, worldDay: number, sceneIndex: number): string {
  return `episode:${worldId}:${worldDay}#scene:${sceneIndex}`;
}

export function episodeContentRefOf(worldId: string, worldDay: number): string {
  return `episode:${worldId}:${worldDay}`;
}

export function canonEventSummaryId(eventId: string): string {
  return `canonEvent:${eventId}`;
}

export type ParsedEpisodeSceneRef = { contentRef: string; worldDay: number; sceneIndex: number };

/** Total: an address this module did not mint yields `null` rather than a partial parse. */
export function parseEpisodeSceneSummaryId(publicSummaryId: string): ParsedEpisodeSceneRef | null {
  const match = /^(episode:.+:(\d+))#scene:(\d+)$/.exec(publicSummaryId);
  if (!match) return null;
  return { contentRef: match[1], worldDay: Number(match[2]), sceneIndex: Number(match[3]) };
}

export function parseCanonEventSummaryId(publicSummaryId: string): string | null {
  const match = /^canonEvent:(.+)$/.exec(publicSummaryId);
  return match ? match[1] : null;
}

// --- inputs ------------------------------------------------------------------

/**
 * A state change as the replay reads it.
 *
 * One field wider than ART-122's `SceneStateChangeLike` — `characterId` — because tracing
 * where a participant stood before and after a scene needs to know whose move it was. Still
 * structurally assignable to it, so `groupSceneEvents` and `resolveSceneSpatials` take these
 * events unchanged.
 */
export type ReplayStateChangeLike = {
  readonly type: string;
  readonly characterId?: string;
  readonly toLocationId?: string;
};

export type ReplayEventLike = Omit<SceneEventLike, 'stateChanges'> & {
  readonly stateChanges: readonly ReplayStateChangeLike[];
};

/** A daily episode's published key scenes, per world day. */
export type ReplayEpisodeInput = {
  readonly worldDay: number;
  readonly status: string;
  readonly keyScenes: readonly PublishedKeyScene[];
};

/** The current `publicationRecords` row for one `contentRef`. */
export type ReplayPublicationRecord = {
  readonly version: number;
  readonly status: string;
};

export type BuildVisualReplayInput = {
  readonly worldId: string;
  readonly acceptedEvents: readonly ReplayEventLike[];
  readonly arcMemberships: readonly SceneArcMembership[];
  /** Characters the map already refuses to draw — the dead and the deactivated. */
  readonly excludedCharacterIds: ReadonlySet<string>;
  /** The map's location bindings; a participant standing in an unbound location is dropped. */
  readonly runtime: Pick<VisualRuntimeInput, 'bindings'>;
  readonly episodes: readonly ReplayEpisodeInput[];
  readonly publicationRecords: ReadonlyMap<string, ReplayPublicationRecord>;
};

const LOCATION_CHANGE = 'character_location_changed';

// --- derivation --------------------------------------------------------------

function importanceBySequence(memberships: readonly SceneArcMembership[]): Map<number, number> {
  const bySequence = new Map<number, number>();
  for (const membership of memberships) {
    if (typeof membership.importance !== 'number' || !Number.isFinite(membership.importance)) continue;
    const prior = bySequence.get(membership.sourceEventSequenceNumber);
    if (prior === undefined || membership.importance > prior) {
      bySequence.set(membership.sourceEventSequenceNumber, membership.importance);
    }
  }
  return bySequence;
}

function sceneIdOf(group: SceneGroup): string {
  return `${group.worldDay}:${group.timeSlot}:${group.locationId}`;
}

function minSequenceOf(group: SceneGroup): number {
  return group.events.reduce((lowest, event) => Math.min(lowest, event.sequenceNumber), Number.POSITIVE_INFINITY);
}

/**
 * Which completed scenes to replay, most important first, then re-ordered to run forwards.
 *
 * The current slot is excluded before anything else is considered, and that exclusion is what
 * makes RISK2-009 a data-selection property rather than a labelling promise: a scene that is
 * still under way is simply not in the set a replay can be built from, so no amount of
 * relabelling on the client could present live activity as history or the reverse.
 */
export function selectReplayGroups(
  groups: readonly SceneGroup[],
  latest: { worldDay: number; timeSlot: string },
  importance: ReadonlyMap<number, number>,
): SceneGroup[] {
  const completed = groups.filter(
    (group) => !(group.worldDay === latest.worldDay && group.timeSlot === latest.timeSlot),
  );
  const scoreOf = (group: SceneGroup): number =>
    group.events.reduce((best, event) => Math.max(best, importance.get(event.sequenceNumber) ?? 0), 0);

  return [...completed]
    .sort((left, right) =>
      scoreOf(right) - scoreOf(left)
      || right.maxSequenceNumber - left.maxSequenceNumber
      || sceneIdOf(left).localeCompare(sceneIdOf(right)))
    .slice(0, REPLAY_MAX_SCENES)
    // Chronological, because a replay is a story being retold and a viewer reads forwards.
    // Importance decided WHICH scenes; it has no business deciding the order they happened in.
    .sort((left, right) => minSequenceOf(left) - minSequenceOf(right));
}

type LocationFold = {
  /** Each character's location immediately before the scene's first event. */
  readonly before: ReadonlyMap<string, string>;
  /** Each character's location immediately after the scene's last event. */
  readonly after: ReadonlyMap<string, string>;
};

/**
 * Replay the world's location facts twice: up to the instant before the scene, and through
 * it. Folded from the whole accepted history rather than from the scene's own events, because
 * a participant who was already standing in the room named no `character_location_changed`
 * inside the scene at all — their position comes from wherever they last arrived.
 */
function foldLocations(
  events: readonly ReplayEventLike[],
  firstSequence: number,
  lastSequence: number,
): LocationFold {
  const before = new Map<string, string>();
  const after = new Map<string, string>();
  for (const event of [...events].sort((left, right) => left.sequenceNumber - right.sequenceNumber)) {
    if (event.sequenceNumber > lastSequence) break;
    for (const change of event.stateChanges) {
      if (change.type !== LOCATION_CHANGE) continue;
      const { characterId, toLocationId } = change;
      if (!characterId || !toLocationId) continue;
      if (event.sequenceNumber < firstSequence) before.set(characterId, toLocationId);
      after.set(characterId, toLocationId);
    }
  }
  // A character who never moved before the scene has no `before` entry; the scene's own
  // arrival is still the honest answer to "where did this walk end", so `after` stands alone
  // and `resolveParticipants` decides whether a start position can be recovered at all.
  return { before, after };
}

function anchorFor(
  bindings: Pick<VisualRuntimeInput, 'bindings'>['bindings'],
  locationId: string,
  characterId: string,
): ReplayPoint | null {
  const binding = bindings.find((candidate) => candidate.locationId === locationId);
  if (!binding) return null;
  const anchor = bootstrapAnchor(binding, characterId);
  return { x: anchor.x, y: anchor.y };
}

/**
 * Where each participant stood, or nothing.
 *
 * A participant whose pre-scene location is unknown, or whose location has no visual binding,
 * is DROPPED. Placing them at the scene's own location instead would be the map asserting a
 * position Canon never recorded — the same refusal `visualSyncPlanner` makes for an unbound
 * location, and for the same reason.
 */
export function resolveReplayParticipants(args: {
  readonly characterIds: readonly string[];
  readonly fold: LocationFold;
  readonly bindings: Pick<VisualRuntimeInput, 'bindings'>['bindings'];
}): ReplayParticipant[] {
  const participants: ReplayParticipant[] = [];
  for (const characterId of args.characterIds) {
    const startLocation = args.fold.before.get(characterId);
    const endLocation = args.fold.after.get(characterId) ?? startLocation;
    if (startLocation === undefined || endLocation === undefined) continue;
    const startPosition = anchorFor(args.bindings, startLocation, characterId);
    const endPosition = anchorFor(args.bindings, endLocation, characterId);
    if (!startPosition || !endPosition) continue;
    participants.push({ characterId, startPosition, endPosition });
  }
  return participants.sort((left, right) => left.characterId.localeCompare(right.characterId));
}

function distanceTiles(from: ReplayPoint, to: ReplayPoint): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/**
 * The text reference for one event, or nothing.
 *
 * Episode narration wins when it exists: it is the text an editor wrote and the safety pass
 * approved, and it is versioned, so a later withhold reaches it. An event's own
 * `publicSummary` is the fallback for the four slots a day no episode narrates.
 */
export function resolveEventCardStep(args: {
  readonly worldId: string;
  readonly event: ReplayEventLike;
  readonly episodes: readonly ReplayEpisodeInput[];
  readonly publicationRecords: ReadonlyMap<string, ReplayPublicationRecord>;
}): ReplayEventCardStep | null {
  const { worldId, event, episodes, publicationRecords } = args;
  const episode = episodes.find((candidate) => candidate.worldDay === event.worldDay);
  if (episode && episode.status === 'ready') {
    const keyScene = narrationForEvents(new Set([event.eventId]), episode.keyScenes);
    const sceneIndex = keyScene ? episode.keyScenes.indexOf(keyScene) : -1;
    if (sceneIndex >= 0) {
      const record = publicationRecords.get(episodeContentRefOf(worldId, event.worldDay));
      if (record && REPLAY_PUBLISHED_RECORD_STATUSES.includes(record.status)) {
        return {
          type: 'eventCard',
          refKind: 'episodeScene',
          publicSummaryId: episodeSceneSummaryId(worldId, event.worldDay, sceneIndex),
          publicationVersion: record.version,
          durationMs: REPLAY_EVENT_CARD_MS,
        };
      }
    }
  }
  if (typeof event.publicSummary === 'string' && event.publicSummary.trim().length > 0) {
    return {
      type: 'eventCard',
      refKind: 'canonEventSummary',
      publicSummaryId: canonEventSummaryId(event.eventId),
      publicationVersion: CANON_EVENT_SUMMARY_VERSION,
      durationMs: REPLAY_EVENT_CARD_MS,
    };
  }
  return null;
}

function totalDuration(steps: readonly ReplayStep[]): number {
  return steps.reduce((sum, step) => sum + step.durationMs, 0);
}

/**
 * Make a scene last between 20 and 60 seconds without dropping any of it.
 *
 * Too short is padded with a `wait`. Too long is compressed by scaling every remaining step
 * proportionally — trailing waits go first, since padding is the one thing that carries no
 * content, but an `eventCard` is never dropped: a replay that silently omitted a scene's
 * only published sentence would be a worse failure than one that reads a little quickly.
 * The residual from integer rounding lands on the last step, so the parts always sum to the
 * whole and the client never has to reconcile two answers.
 */
export function fitSceneDuration(steps: readonly ReplayStep[]): ReplayStep[] {
  const total = totalDuration(steps);
  if (total >= REPLAY_SCENE_MIN_MS && total <= REPLAY_SCENE_MAX_MS) return [...steps];

  if (total < REPLAY_SCENE_MIN_MS) {
    return [...steps, { type: 'wait', durationMs: REPLAY_SCENE_MIN_MS - total }];
  }

  const withoutTrailingWaits = [...steps];
  while (withoutTrailingWaits.length > 0 && withoutTrailingWaits[withoutTrailingWaits.length - 1].type === 'wait') {
    withoutTrailingWaits.pop();
  }
  const trimmed = totalDuration(withoutTrailingWaits);
  if (trimmed >= REPLAY_SCENE_MIN_MS && trimmed <= REPLAY_SCENE_MAX_MS) return withoutTrailingWaits;
  if (trimmed < REPLAY_SCENE_MIN_MS) {
    return [...withoutTrailingWaits, { type: 'wait', durationMs: REPLAY_SCENE_MIN_MS - trimmed }];
  }

  const scaled = withoutTrailingWaits.map((step) => ({
    ...step,
    durationMs: Math.max(1, Math.floor((step.durationMs * REPLAY_SCENE_MAX_MS) / trimmed)),
  }));
  const residual = REPLAY_SCENE_MAX_MS - totalDuration(scaled);
  if (residual > 0 && scaled.length > 0) {
    const last = scaled[scaled.length - 1];
    scaled[scaled.length - 1] = { ...last, durationMs: last.durationMs + residual };
  }
  return scaled;
}

/**
 * Build the replay payload for a world, or `null` when there is nothing honest to replay.
 *
 * `null` rather than an empty replay or a thrown error: PRD 2.0's failure handling for this
 * feature is "skip straight to the ambient state", and a world whose only activity is the
 * slot currently under way genuinely has no completed scene to show. The caller commits
 * nothing in that case, and the client renders the live map exactly as it did before.
 */
export function buildVisualReplay(input: BuildVisualReplayInput): VisualReplay | null {
  if (input.worldId.trim().length === 0) {
    throw new VisualReplayError('VISUAL_REPLAY_INVALID_SHAPE', 'worldId must be non-empty');
  }

  const ordered = [...input.acceptedEvents].sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  const latest = ordered.at(-1);
  if (!latest) return null;

  const importance = importanceBySequence(input.arcMemberships);
  const selected = selectReplayGroups(groupSceneEvents(ordered), latest, importance);
  if (selected.length < REPLAY_MIN_SCENES) return null;

  const arcIdsBySequence = new Map<number, readonly string[]>(
    input.arcMemberships.map((membership) => [membership.sourceEventSequenceNumber, membership.arcIds]),
  );

  const scenes: ReplayScene[] = selected.map((group) => {
    const spatials = resolveSceneSpatials(group.events, {
      arcIdsBySequence,
      excludedCharacterIds: input.excludedCharacterIds,
    });
    const firstSequence = minSequenceOf(group);
    const fold = foldLocations(ordered, firstSequence, group.maxSequenceNumber);
    const participants = resolveReplayParticipants({
      characterIds: spatials.participantCharacterIds,
      fold,
      bindings: input.runtime.bindings,
    });

    // A participant whose start and end anchors round to the same walk duration produces no
    // step at all rather than a zero-length one: standing still is what actually happened.
    const moves: ReplayStep[] = participants
      .map((participant) => ({
        type: 'move' as const,
        characterId: participant.characterId,
        to: participant.endPosition,
        durationMs: travelDurationMs(distanceTiles(participant.startPosition, participant.endPosition)),
      }))
      .filter((step) => step.durationMs > 0);

    const cards: ReplayStep[] = [...group.events]
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
      .flatMap((event) => {
        const step = resolveEventCardStep({
          worldId: input.worldId,
          event,
          episodes: input.episodes,
          publicationRecords: input.publicationRecords,
        });
        return step ? [step] : [];
      });

    const steps = fitSceneDuration([...moves, ...cards]);
    return {
      sceneId: sceneIdOf(group),
      worldDay: group.worldDay,
      timeSlot: group.timeSlot,
      locationId: group.locationId,
      sourceEventIds: spatials.sourceEventIds,
      participants,
      steps,
      durationMs: totalDuration(steps),
    };
  });

  const lastScene = scenes[scenes.length - 1];
  const lastSequence = selected.reduce((highest, group) => Math.max(highest, group.maxSequenceNumber), 0);
  const replay: VisualReplay = {
    schemaVersion: VISUAL_REPLAY_SCHEMA_VERSION,
    replayId: `replay:${input.worldId}:${lastSequence}`,
    worldId: input.worldId,
    worldDay: lastScene.worldDay,
    timeSlot: lastScene.timeSlot,
    sourceEventIds: [...new Set(scenes.flatMap((scene) => scene.sourceEventIds))].sort((left, right) =>
      left.localeCompare(right)),
    scenes,
    totalDurationMs: scenes.reduce((sum, scene) => sum + scene.durationMs, 0),
  };
  assertVisualReplay(replay);
  return replay;
}

// --- validation --------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const field of allowed) {
    if (!(field in value)) {
      throw new VisualReplayError('VISUAL_REPLAY_INVALID_SHAPE', `${path} is missing required field ${field}`);
    }
  }
  const permitted = new Set<string>(allowed);
  for (const key of Object.keys(value)) {
    if (!permitted.has(key)) {
      throw new VisualReplayError(
        'VISUAL_REPLAY_UNKNOWN_FIELD',
        `${path} carries field ${key}, which the replay contract does not publish`,
      );
    }
  }
}

function assertNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new VisualReplayError('VISUAL_REPLAY_INVALID_VALUE', `${path} must be a non-empty string`);
  }
  return value;
}

function assertFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new VisualReplayError('VISUAL_REPLAY_INVALID_VALUE', `${path} must be a finite number`);
  }
  return value;
}

function assertPositiveInteger(value: unknown, path: string): number {
  const number = assertFiniteNumber(value, path);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new VisualReplayError('VISUAL_REPLAY_INVALID_VALUE', `${path} must be a positive integer`);
  }
  return number;
}

function assertPoint(value: unknown, path: string): void {
  if (!isPlainObject(value)) {
    throw new VisualReplayError('VISUAL_REPLAY_INVALID_SHAPE', `${path} must be an object`);
  }
  assertExactFields(value, ['x', 'y'], path);
  assertFiniteNumber(value.x, `${path}.x`);
  assertFiniteNumber(value.y, `${path}.y`);
}

function assertStep(value: unknown, path: string): void {
  if (!isPlainObject(value)) {
    throw new VisualReplayError('VISUAL_REPLAY_INVALID_SHAPE', `${path} must be an object`);
  }
  const type = value.type;
  if (typeof type !== 'string' || !(REPLAY_STEP_TYPES as readonly string[]).includes(type)) {
    throw new VisualReplayError(
      'VISUAL_REPLAY_INVALID_VALUE',
      `${path}.type must be one of ${REPLAY_STEP_TYPES.join(' | ')}`,
    );
  }
  const durationMs = assertPositiveInteger(value.durationMs, `${path}.durationMs`);
  if (durationMs > REPLAY_SCENE_MAX_MS) {
    throw new VisualReplayError('VISUAL_REPLAY_INVALID_VALUE', `${path}.durationMs exceeds a scene's maximum`);
  }
  if (type === 'move') {
    assertExactFields(value, REPLAY_MOVE_STEP_FIELDS, path);
    assertNonEmptyString(value.characterId, `${path}.characterId`);
    assertPoint(value.to, `${path}.to`);
    return;
  }
  if (type === 'wait') {
    assertExactFields(value, REPLAY_WAIT_STEP_FIELDS, path);
    return;
  }
  if (type === 'dialogue') {
    assertExactFields(value, REPLAY_DIALOGUE_STEP_FIELDS, path);
    assertNonEmptyString(value.characterId, `${path}.characterId`);
    if (value.refKind !== 'publicExcerpt') {
      throw new VisualReplayError('VISUAL_REPLAY_INVALID_VALUE', `${path}.refKind must be publicExcerpt`);
    }
    assertNonEmptyString(value.publicExcerptId, `${path}.publicExcerptId`);
    assertPositiveInteger(value.publicationVersion, `${path}.publicationVersion`);
    return;
  }
  assertExactFields(value, REPLAY_EVENT_CARD_STEP_FIELDS, path);
  if (value.refKind !== 'episodeScene' && value.refKind !== 'canonEventSummary') {
    throw new VisualReplayError(
      'VISUAL_REPLAY_INVALID_VALUE',
      `${path}.refKind must be episodeScene or canonEventSummary`,
    );
  }
  assertNonEmptyString(value.publicSummaryId, `${path}.publicSummaryId`);
  assertPositiveInteger(value.publicationVersion, `${path}.publicationVersion`);
}

function assertUniqueIds(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw new VisualReplayError('VISUAL_REPLAY_INVALID_SHAPE', `${path} must be an array`);
  }
  const ids = value.map((entry, index) => assertNonEmptyString(entry, `${path}[${index}]`));
  if (new Set(ids).size !== ids.length) {
    throw new VisualReplayError('VISUAL_REPLAY_INVALID_VALUE', `${path} must be free of duplicates`);
  }
}

function assertSortedUniqueIds(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw new VisualReplayError('VISUAL_REPLAY_INVALID_SHAPE', `${path} must be an array`);
  }
  const ids = value.map((entry, index) => assertNonEmptyString(entry, `${path}[${index}]`));
  for (let index = 1; index < ids.length; index += 1) {
    if (ids[index - 1].localeCompare(ids[index]) >= 0) {
      throw new VisualReplayError('VISUAL_REPLAY_INVALID_VALUE', `${path} must be sorted and free of duplicates`);
    }
  }
}

/**
 * Refuse a forbidden field wherever it hides.
 *
 * Separate from the per-node allowlists, and not redundant with them: an allowlist proves
 * that the shapes this module *knows about* carry nothing extra, and this proves it for the
 * whole tree including any node a future edit adds without extending a list.
 */
function assertNoForbiddenFields(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenFields(entry, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (REPLAY_FORBIDDEN_FIELDS.includes(key)) {
      throw new VisualReplayError(
        'VISUAL_REPLAY_FORBIDDEN_FIELD',
        `${path}.${key} is a field a replay must never carry`,
      );
    }
    assertNoForbiddenFields(entry, `${path}.${key}`);
  }
}

function assertScene(value: unknown, path: string): void {
  if (!isPlainObject(value)) {
    throw new VisualReplayError('VISUAL_REPLAY_INVALID_SHAPE', `${path} must be an object`);
  }
  assertExactFields(value, REPLAY_SCENE_FIELDS, path);
  assertNonEmptyString(value.sceneId, `${path}.sceneId`);
  assertFiniteNumber(value.worldDay, `${path}.worldDay`);
  assertNonEmptyString(value.timeSlot, `${path}.timeSlot`);
  assertNonEmptyString(value.locationId, `${path}.locationId`);
  // Sequence order, not alphabetical: a scene's events are listed in the order they happened,
  // which is the order a replay reads them in. Uniqueness is still required, because a
  // repeated id would show the same card twice.
  assertUniqueIds(value.sourceEventIds, `${path}.sourceEventIds`);

  if (!Array.isArray(value.participants)) {
    throw new VisualReplayError('VISUAL_REPLAY_INVALID_SHAPE', `${path}.participants must be an array`);
  }
  value.participants.forEach((participant, index) => {
    const participantPath = `${path}.participants[${index}]`;
    if (!isPlainObject(participant)) {
      throw new VisualReplayError('VISUAL_REPLAY_INVALID_SHAPE', `${participantPath} must be an object`);
    }
    assertExactFields(participant, REPLAY_PARTICIPANT_FIELDS, participantPath);
    assertNonEmptyString(participant.characterId, `${participantPath}.characterId`);
    assertPoint(participant.startPosition, `${participantPath}.startPosition`);
    assertPoint(participant.endPosition, `${participantPath}.endPosition`);
  });

  if (!Array.isArray(value.steps)) {
    throw new VisualReplayError('VISUAL_REPLAY_INVALID_SHAPE', `${path}.steps must be an array`);
  }
  value.steps.forEach((step, index) => assertStep(step, `${path}.steps[${index}]`));

  const durationMs = assertPositiveInteger(value.durationMs, `${path}.durationMs`);
  const summed = (value.steps as ReplayStep[]).reduce((sum, step) => sum + step.durationMs, 0);
  if (durationMs !== summed) {
    throw new VisualReplayError(
      'VISUAL_REPLAY_INVALID_VALUE',
      `${path}.durationMs must equal the sum of its steps`,
    );
  }
  if (durationMs < REPLAY_SCENE_MIN_MS || durationMs > REPLAY_SCENE_MAX_MS) {
    throw new VisualReplayError(
      'VISUAL_REPLAY_INVALID_VALUE',
      `${path}.durationMs must be within ${REPLAY_SCENE_MIN_MS}–${REPLAY_SCENE_MAX_MS}ms`,
    );
  }
}

/**
 * Validate a replay field by field. Called before publishing and again when serving, so a
 * payload persisted under an older contract cannot be handed to a client that only knows
 * the current one.
 */
export function assertVisualReplay(value: unknown): asserts value is VisualReplay {
  if (!isPlainObject(value)) {
    throw new VisualReplayError('VISUAL_REPLAY_INVALID_SHAPE', 'replay must be an object');
  }
  assertExactFields(value, REPLAY_ROOT_FIELDS, 'replay');
  if (value.schemaVersion !== VISUAL_REPLAY_SCHEMA_VERSION) {
    throw new VisualReplayError(
      'VISUAL_REPLAY_INVALID_VALUE',
      `replay.schemaVersion must be ${VISUAL_REPLAY_SCHEMA_VERSION}`,
    );
  }
  assertNonEmptyString(value.replayId, 'replay.replayId');
  assertNonEmptyString(value.worldId, 'replay.worldId');
  assertFiniteNumber(value.worldDay, 'replay.worldDay');
  assertNonEmptyString(value.timeSlot, 'replay.timeSlot');
  assertSortedUniqueIds(value.sourceEventIds, 'replay.sourceEventIds');

  if (!Array.isArray(value.scenes)) {
    throw new VisualReplayError('VISUAL_REPLAY_INVALID_SHAPE', 'replay.scenes must be an array');
  }
  if (value.scenes.length < REPLAY_MIN_SCENES || value.scenes.length > REPLAY_MAX_SCENES) {
    throw new VisualReplayError(
      'VISUAL_REPLAY_INVALID_VALUE',
      `replay.scenes must hold ${REPLAY_MIN_SCENES}–${REPLAY_MAX_SCENES} scenes`,
    );
  }
  value.scenes.forEach((scene, index) => assertScene(scene, `replay.scenes[${index}]`));

  const totalDurationMs = assertPositiveInteger(value.totalDurationMs, 'replay.totalDurationMs');
  const summed = (value.scenes as ReplayScene[]).reduce((sum, scene) => sum + scene.durationMs, 0);
  if (totalDurationMs !== summed) {
    throw new VisualReplayError(
      'VISUAL_REPLAY_INVALID_VALUE',
      'replay.totalDurationMs must equal the sum of its scenes',
    );
  }
  assertNoForbiddenFields(value, 'replay');
}

/**
 * Pull a replay out of a served payload and re-validate it. A payload written under an older
 * contract yields `null` rather than throwing: a replay nobody can read is a feature the
 * viewer simply does not get, not a reason for the live map to fail.
 */
export function selectVisualReplay(payload: unknown): VisualReplay | null {
  try {
    assertVisualReplay(payload);
    return payload;
  } catch {
    return null;
  }
}

export type ReplayTextReference = {
  readonly refKind: ReplayTextRefKind;
  readonly publicSummaryId: string;
  readonly publicationVersion: number;
};

/**
 * Every distinct text address a replay names, in a stable order.
 *
 * Pure and separate from the resolver so "which references does this replay make" can be
 * asserted without a database, which is how the AC#10 tests prove a withheld episode
 * resolves to nothing.
 */
export function replayTextReferences(replay: VisualReplay): ReplayTextReference[] {
  const seen = new Map<string, ReplayTextReference>();
  for (const scene of replay.scenes) {
    for (const step of scene.steps) {
      const reference: ReplayTextReference | null = step.type === 'eventCard'
        ? { refKind: step.refKind, publicSummaryId: step.publicSummaryId, publicationVersion: step.publicationVersion }
        : step.type === 'dialogue'
          ? { refKind: step.refKind, publicSummaryId: step.publicExcerptId, publicationVersion: step.publicationVersion }
          : null;
      if (!reference) continue;
      const key = `${reference.publicSummaryId}@${reference.publicationVersion}`;
      if (!seen.has(key)) seen.set(key, reference);
    }
  }
  return [...seen.values()].sort((left, right) =>
    left.publicSummaryId.localeCompare(right.publicSummaryId)
    || left.publicationVersion - right.publicationVersion);
}
