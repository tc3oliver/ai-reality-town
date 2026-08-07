/**
 * Visual Replay playback (FR-O013 / ART-121, client half).
 *
 * The backend stores a replay as *relative* durations; this module turns them into the
 * absolute `PublicCharacterMotion` windows the existing renderer already consumes. That is
 * the whole trick: there is no second rendering path for replay. `composeReadOnlyWorldViewModel`
 * interpolates these synthesised units exactly as it interpolates live ones, ART-120's
 * ambient drift already refuses to overlay a `replay` motion, and the sprite layer never
 * learns that history is what it is drawing.
 *
 * ## No timers
 *
 * Nothing here schedules anything. Playback advances because `nowMs` — the existing
 * `useMotionClock` rAF tick — is re-evaluated against cumulative scene offsets. A replay
 * therefore costs the animation frames the map was already spending, and
 * `liveMapSurface.test.ts`'s "mounts no polling timer" assertion stays true.
 *
 * ## The one transition that matters (AC#7)
 *
 * `advanceReplay` can move `playing → finished` and nothing else. It can never move
 * `finished → playing`, which is what "never loops or repeats automatically" means as a
 * property rather than as a promise: the only function that produces `playing` is
 * {@link beginReplay}, and the only callers of that are the once-per-session auto-play effect
 * and the viewer pressing a button.
 */

import type { VisualReplay, ReplayScene, ReplayStep } from '../../../convex/publicRead/visualReplay';
import type {
  PublicCharacterMotion,
  PublicDirection,
  PublicPoint,
} from '../world/worldViewModel';

export const REPLAY_PHASES = ['idle', 'playing', 'finished'] as const;
export type ReplayPhase = (typeof REPLAY_PHASES)[number];

export type ReplayPlaybackState = {
  readonly phase: ReplayPhase;
  /** Which replay this state belongs to; a new one invalidates a playback in flight. */
  readonly replayId: string | null;
  /** The viewer's local instant playback began at. Never a value the server supplied. */
  readonly playbackStartMs: number;
};

export const IDLE_REPLAY_PLAYBACK: ReplayPlaybackState = {
  phase: 'idle',
  replayId: null,
  playbackStartMs: 0,
};

/** Where the event card currently on screen points. Text is the caller's to resolve. */
export type ReplaySummaryRef = {
  readonly publicSummaryId: string;
  readonly publicationVersion: number;
};

export type ReplayFrame = {
  readonly replayId: string;
  readonly sceneIndex: number;
  readonly sceneId: string;
  readonly locationId: string;
  readonly worldDay: number;
  readonly timeSlot: string;
  readonly elapsedMs: number;
  readonly totalDurationMs: number;
  readonly motions: PublicCharacterMotion[];
  readonly summaryRef: ReplaySummaryRef | null;
};

/**
 * Four facings from a displacement.
 *
 * Deliberately local rather than imported from `convex/visualRuntime/motion.ts`'s
 * `deriveDirection`: `clientLive` may not depend on `visualRuntime`
 * (`architecture/module-boundaries.json`), because that module's neighbours reach the Canon
 * seed's private character data. Four cases is a small enough rule to state twice; eight
 * would not have been.
 */
export function replayFacing(from: PublicPoint, to: PublicPoint): PublicDirection {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return 'down';
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** Begin (or restart) playback. The only function in this module that produces `playing`. */
export function beginReplay(replay: VisualReplay, nowMs: number): ReplayPlaybackState {
  return { phase: 'playing', replayId: replay.replayId, playbackStartMs: nowMs };
}

/** AC#8: skippable at any time, from any point, without waiting for anything. */
export function skipReplay(state: ReplayPlaybackState): ReplayPlaybackState {
  if (state.phase === 'finished') return state;
  return { ...state, phase: 'finished' };
}

/**
 * Advance the clock's verdict on whether playback is still running.
 *
 * Returns the SAME object when nothing changes, so a caller can pass it straight to a React
 * state setter on every animation frame and re-render only on the one frame that ends
 * playback.
 */
export function advanceReplay(
  replay: VisualReplay | null,
  state: ReplayPlaybackState,
  nowMs: number,
): ReplayPlaybackState {
  if (state.phase !== 'playing') return state;
  // The replay this playback belongs to is gone or has been superseded by a newer one. Ending
  // is the only honest option: continuing would animate a history the payload no longer says.
  if (!replay || replay.replayId !== state.replayId) return { ...state, phase: 'finished' };
  if (!Number.isFinite(nowMs)) return state;
  if (nowMs - state.playbackStartMs < replay.totalDurationMs) return state;
  return { ...state, phase: 'finished' };
}

type LocatedScene = {
  readonly scene: ReplayScene;
  readonly index: number;
  /** Milliseconds from the start of the whole replay to the start of this scene. */
  readonly offsetMs: number;
};

function locateScene(replay: VisualReplay, elapsedMs: number): LocatedScene | null {
  let offsetMs = 0;
  for (let index = 0; index < replay.scenes.length; index += 1) {
    const scene = replay.scenes[index];
    if (elapsedMs < offsetMs + scene.durationMs) return { scene, index, offsetMs };
    offsetMs += scene.durationMs;
  }
  return null;
}

function summaryRefOf(step: ReplayStep): ReplaySummaryRef | null {
  if (step.type === 'eventCard') {
    return { publicSummaryId: step.publicSummaryId, publicationVersion: step.publicationVersion };
  }
  if (step.type === 'dialogue') {
    return { publicSummaryId: step.publicExcerptId, publicationVersion: step.publicationVersion };
  }
  return null;
}

/**
 * The motions and the card to draw at `nowMs`, or `null` when nothing is playing.
 *
 * Total, and cheap enough to call once per animation frame: it walks at most three scenes and
 * their steps, allocates one motion per participant, and reads no state that is not passed in.
 * Returns `null` the instant playback passes its end, which is what makes the return to the
 * live ambient state (AC#2) automatic rather than a separate teardown step — the caller falls
 * back to the live projection's own characters and the map is exactly what it was before.
 */
export function replayFrame(
  replay: VisualReplay | null,
  state: ReplayPlaybackState,
  nowMs: number,
): ReplayFrame | null {
  if (!replay || state.phase !== 'playing' || state.replayId !== replay.replayId) return null;
  if (!Number.isFinite(nowMs)) return null;

  const elapsedMs = Math.max(0, nowMs - state.playbackStartMs);
  if (elapsedMs >= replay.totalDurationMs) return null;

  const located = locateScene(replay, elapsedMs);
  if (!located) return null;
  const { scene, index: sceneIndex, offsetMs } = located;
  const sceneStartMs = state.playbackStartMs + offsetMs;
  const elapsedInSceneMs = elapsedMs - offsetMs;

  // One pass over the steps: it decides both the card on screen and every walk's absolute
  // window. Splitting it in two would let the two disagree about where a step begins.
  const movesByCharacter = new Map<string, { to: PublicPoint; startedAt: number; arriveAt: number }>();
  let summaryRef: ReplaySummaryRef | null = null;
  let stepOffsetMs = 0;
  for (const step of scene.steps) {
    if (step.type === 'move') {
      movesByCharacter.set(step.characterId, {
        to: step.to,
        startedAt: sceneStartMs + stepOffsetMs,
        arriveAt: sceneStartMs + stepOffsetMs + step.durationMs,
      });
    }
    if (elapsedInSceneMs >= stepOffsetMs && elapsedInSceneMs < stepOffsetMs + step.durationMs) {
      summaryRef = summaryRefOf(step);
    }
    stepOffsetMs += step.durationMs;
  }

  const motions: PublicCharacterMotion[] = scene.participants.map((participant) => {
    const move = movesByCharacter.get(participant.characterId);
    const from = participant.startPosition;
    const to = move ? move.to : participant.startPosition;
    const startedAt = move ? move.startedAt : sceneStartMs;
    const arriveAt = move ? move.arriveAt : sceneStartMs;
    const walking = nowMs >= startedAt && nowMs < arriveAt;
    return {
      characterId: participant.characterId,
      // Canon's own name for where this scene happened, carried through rather than derived.
      semanticLocationId: scene.locationId,
      motionType: 'replay',
      // Strictly increasing across scenes, so `latestMotionPerCharacter` keeps the unit from
      // the scene actually playing even if a caller ever concatenated two frames.
      motionSequence: sceneIndex + 1,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      startedAt,
      arriveAt,
      animationState: walking ? 'walking' : 'idle',
      direction: walking ? replayFacing(from, to) : 'down',
    };
  });

  return {
    replayId: replay.replayId,
    sceneIndex,
    sceneId: scene.sceneId,
    locationId: scene.locationId,
    worldDay: scene.worldDay,
    timeSlot: scene.timeSlot,
    elapsedMs,
    totalDurationMs: replay.totalDurationMs,
    motions,
    summaryRef,
  };
}
