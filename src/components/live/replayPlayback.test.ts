/**
 * Replay playback (FR-O013 / ART-121 AC#2, #6, #7, #8).
 *
 * The state machine is the load-bearing part of "never loops or repeats automatically", so it
 * is tested exhaustively rather than by example: every input is applied to every state, and
 * the property asserted is that only one of them can produce `playing`.
 */

import { mistwoodCharacterSpriteKeys } from '../../../data/mistwoodCharacters';
import { mistwoodWorldMap } from '../../../data/mistwood';
import { composeReadOnlyWorldViewModel } from '../world/worldViewModel';
import type { PublicCharacterMotion } from '../world/worldViewModel';
import type { VisualReplay } from '../../../convex/publicRead/visualReplay';
import {
  IDLE_REPLAY_PLAYBACK,
  REPLAY_PHASES,
  advanceReplay,
  beginReplay,
  replayFacing,
  replayFrame,
  skipReplay,
  type ReplayPlaybackState,
} from './replayPlayback';

const START = 1_700_000_000_000;

/**
 * Two scenes, hand-built rather than derived, so the offsets under test are readable: the
 * first runs 0–20s with a 5s walk then a 4s card, the second 20–45s.
 */
const REPLAY: VisualReplay = {
  schemaVersion: 1,
  replayId: 'replay:mistwood:42',
  worldId: 'mistwood',
  worldDay: 3,
  timeSlot: 'evening',
  sourceEventIds: ['e1', 'e2'],
  scenes: [
    {
      sceneId: '3:morning:mistwood-hall',
      worldDay: 3,
      timeSlot: 'morning',
      locationId: 'mistwood-hall',
      sourceEventIds: ['e1'],
      participants: [
        { characterId: 'he-jun', startPosition: { x: 4, y: 4 }, endPosition: { x: 4, y: 4 } },
        { characterId: 'wu-zhen', startPosition: { x: 2, y: 8 }, endPosition: { x: 10, y: 8 } },
      ],
      steps: [
        { type: 'move', characterId: 'wu-zhen', to: { x: 10, y: 8 }, durationMs: 5_000 },
        { type: 'eventCard', refKind: 'episodeScene', publicSummaryId: 'episode:mistwood:3#scene:0', publicationVersion: 2, durationMs: 4_000 },
        { type: 'wait', durationMs: 11_000 },
      ],
      durationMs: 20_000,
    },
    {
      sceneId: '3:evening:mistwood-inn',
      worldDay: 3,
      timeSlot: 'evening',
      locationId: 'mistwood-inn',
      sourceEventIds: ['e2'],
      participants: [
        { characterId: 'wu-zhen', startPosition: { x: 10, y: 8 }, endPosition: { x: 16, y: 2 } },
      ],
      steps: [
        { type: 'move', characterId: 'wu-zhen', to: { x: 16, y: 2 }, durationMs: 6_000 },
        { type: 'eventCard', refKind: 'canonEventSummary', publicSummaryId: 'canonEvent:e2', publicationVersion: 1, durationMs: 4_000 },
        { type: 'wait', durationMs: 15_000 },
      ],
      durationMs: 25_000,
    },
  ],
  totalDurationMs: 45_000,
};

const PLAYING: ReplayPlaybackState = beginReplay(REPLAY, START);
const FINISHED: ReplayPlaybackState = skipReplay(PLAYING);

const LIVE_MOTIONS: readonly PublicCharacterMotion[] = [
  {
    characterId: 'wu-zhen',
    semanticLocationId: 'mistwood-square',
    motionType: 'canon',
    motionSequence: 9,
    from: { x: 1, y: 1 },
    to: { x: 1, y: 1 },
    startedAt: START,
    arriveAt: START,
    animationState: 'idle',
    direction: 'down',
  },
];

function viewModel(motions: readonly PublicCharacterMotion[], nowMs: number) {
  return composeReadOnlyWorldViewModel({
    map: mistwoodWorldMap,
    motions,
    spriteKeys: mistwoodCharacterSpriteKeys,
    nowMs,
  });
}

describe('AC#2 — playback ends by returning to the current ambient state', () => {
  it('produces no frame once the replay has run its length', () => {
    expect(replayFrame(REPLAY, PLAYING, START + 44_999)).not.toBeNull();
    expect(replayFrame(REPLAY, PLAYING, START + 45_000)).toBeNull();
    expect(replayFrame(REPLAY, PLAYING, START + 10_000_000)).toBeNull();
  });

  it('transitions to finished at exactly the total duration, and stays there', () => {
    expect(advanceReplay(REPLAY, PLAYING, START + 44_999).phase).toBe('playing');
    expect(advanceReplay(REPLAY, PLAYING, START + 45_000).phase).toBe('finished');
    expect(advanceReplay(REPLAY, PLAYING, START + 999_999).phase).toBe('finished');
  });

  it('returns the identical state object while nothing changes, so no render is forced', () => {
    // What lets the auto-advance effect run on every animation frame without re-rendering.
    expect(advanceReplay(REPLAY, PLAYING, START + 1)).toBe(PLAYING);
    expect(advanceReplay(REPLAY, FINISHED, START + 1)).toBe(FINISHED);
    expect(advanceReplay(REPLAY, IDLE_REPLAY_PLAYBACK, START + 1)).toBe(IDLE_REPLAY_PLAYBACK);
  });

  it('leaves the composed world exactly as the live projection had it, once finished', () => {
    const nowMs = START + 50_000;
    const afterReplay = replayFrame(REPLAY, PLAYING, nowMs);
    expect(afterReplay).toBeNull();
    // The caller falls back to the live motions, and the result is the pre-replay view model
    // byte for byte: there is no teardown step that could get this wrong.
    const live = viewModel(LIVE_MOTIONS, nowMs);
    const substituted = viewModel(afterReplay ? afterReplay.motions : LIVE_MOTIONS, nowMs);
    expect(JSON.stringify(substituted)).toBe(JSON.stringify(live));
  });
});

describe('AC#7 — nothing but an explicit begin can leave the finished state', () => {
  it('exhausts every (state, input) pair: only beginReplay produces playing', () => {
    const states: ReplayPlaybackState[] = [
      IDLE_REPLAY_PLAYBACK,
      PLAYING,
      FINISHED,
      { phase: 'playing', replayId: 'replay:mistwood:1', playbackStartMs: START },
    ];
    const instants = [START - 10_000, START, START + 1, START + 22_000, START + 45_000, START + 10_000_000];

    for (const state of states) {
      for (const nowMs of instants) {
        // Advancing never resurrects a finished or idle playback, at any instant.
        for (const replay of [REPLAY, null]) {
          const advanced = advanceReplay(replay, state, nowMs);
          if (state.phase !== 'playing') expect(advanced.phase).toBe(state.phase);
          else expect(['playing', 'finished']).toContain(advanced.phase);
          if (state.phase === 'finished') expect(advanced.phase).not.toBe('playing');
        }
        // Skipping only ever ends.
        expect(skipReplay(state).phase).toBe('finished');
        // And begin is the one door back in.
        expect(beginReplay(REPLAY, nowMs).phase).toBe('playing');
      }
    }
    expect(REPLAY_PHASES).toEqual(['idle', 'playing', 'finished']);
  });

  it('never wraps: advancing far past the end produces no frame and no restart', () => {
    let state = PLAYING;
    for (let tick = 0; tick <= 200; tick += 1) {
      state = advanceReplay(REPLAY, state, START + tick * 1_000);
    }
    expect(state.phase).toBe('finished');
    expect(replayFrame(REPLAY, state, START)).toBeNull();
  });

  it('ends a playback whose replay has been superseded rather than animating a stale one', () => {
    const superseded = { ...REPLAY, replayId: 'replay:mistwood:99' };
    expect(advanceReplay(superseded, PLAYING, START + 1).phase).toBe('finished');
    expect(replayFrame(superseded, PLAYING, START + 1)).toBeNull();
    expect(advanceReplay(null, PLAYING, START + 1).phase).toBe('finished');
  });
});

describe('AC#6 — a viewer can ask for a replay again', () => {
  it('restarts from a finished state with a fresh start instant', () => {
    const restarted = beginReplay(REPLAY, START + 900_000);
    expect(restarted.phase).toBe('playing');
    expect(restarted.playbackStartMs).toBe(START + 900_000);
    // And it plays from the beginning, not from wherever the last one stopped.
    expect(replayFrame(REPLAY, restarted, START + 900_000)?.sceneIndex).toBe(0);
    expect(replayFrame(REPLAY, restarted, START + 900_000)?.elapsedMs).toBe(0);
  });
});

describe('AC#8 — skippable at any point', () => {
  it('reaches finished from every scene and every offset within it', () => {
    for (let elapsed = 0; elapsed < REPLAY.totalDurationMs; elapsed += 500) {
      const mid = advanceReplay(REPLAY, PLAYING, START + elapsed);
      expect(mid.phase).toBe('playing');
      const skipped = skipReplay(mid);
      expect(skipped.phase).toBe('finished');
      // Skipping reaches the current state immediately: no frame, so the caller is already
      // back on the live projection on the very next render.
      expect(replayFrame(REPLAY, skipped, START + elapsed)).toBeNull();
    }
  });
});

describe('the synthesised frame', () => {
  it('walks a participant along the step window and parks the others', () => {
    const midWalk = replayFrame(REPLAY, PLAYING, START + 2_500);
    expect(midWalk?.sceneIndex).toBe(0);
    const walking = midWalk?.motions.find((motion) => motion.characterId === 'wu-zhen');
    expect(walking).toMatchObject({
      motionType: 'replay',
      semanticLocationId: 'mistwood-hall',
      animationState: 'walking',
      from: { x: 2, y: 8 },
      to: { x: 10, y: 8 },
      startedAt: START,
      arriveAt: START + 5_000,
      direction: 'right',
    });
    const standing = midWalk?.motions.find((motion) => motion.characterId === 'he-jun');
    expect(standing).toMatchObject({ animationState: 'idle', from: { x: 4, y: 4 }, to: { x: 4, y: 4 } });
  });

  it('stops animating a walk once its window has passed', () => {
    const afterWalk = replayFrame(REPLAY, PLAYING, START + 9_000);
    const settled = afterWalk?.motions.find((motion) => motion.characterId === 'wu-zhen');
    expect(settled?.animationState).toBe('idle');
    // The renderer interpolates the same window and clamps, so the character stands at `to`.
    const composed = viewModel(afterWalk?.motions ?? [], START + 9_000);
    const drawn = composed.characters.find((character) => character.characterId === 'wu-zhen');
    expect(drawn?.isMoving).toBe(false);
    expect(drawn?.x).toBe(10 * mistwoodWorldMap.tileDim);
  });

  it('names the card on screen and nothing while a wait is running', () => {
    // 0–5s is the walk, 5–9s the card, 9–20s the wait.
    expect(replayFrame(REPLAY, PLAYING, START + 1_000)?.summaryRef).toBeNull();
    expect(replayFrame(REPLAY, PLAYING, START + 6_000)?.summaryRef).toEqual({
      publicSummaryId: 'episode:mistwood:3#scene:0',
      publicationVersion: 2,
    });
    expect(replayFrame(REPLAY, PLAYING, START + 15_000)?.summaryRef).toBeNull();
  });

  it('crosses into the second scene at its offset and renames the location', () => {
    expect(replayFrame(REPLAY, PLAYING, START + 19_999)?.sceneIndex).toBe(0);
    const second = replayFrame(REPLAY, PLAYING, START + 20_000);
    expect(second?.sceneIndex).toBe(1);
    expect(second?.locationId).toBe('mistwood-inn');
    expect(second?.timeSlot).toBe('evening');
    // Strictly increasing per character across the replay, so `latestMotionPerCharacter`
    // cannot pick a unit from a scene that has already played.
    expect(second?.motions[0].motionSequence).toBeGreaterThan(
      replayFrame(REPLAY, PLAYING, START + 1_000)!.motions[0].motionSequence,
    );
  });

  it('never publishes a motion type the renderer would treat as live', () => {
    for (let elapsed = 0; elapsed < REPLAY.totalDurationMs; elapsed += 250) {
      const frame = replayFrame(REPLAY, PLAYING, START + elapsed);
      for (const motion of frame?.motions ?? []) expect(motion.motionType).toBe('replay');
    }
  });

  it('is total: a malformed instant or a mismatched state yields null', () => {
    for (const nowMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(replayFrame(REPLAY, PLAYING, nowMs)).toBeNull();
    }
    expect(replayFrame(REPLAY, IDLE_REPLAY_PLAYBACK, START + 1_000)).toBeNull();
    expect(replayFrame(null, PLAYING, START + 1_000)).toBeNull();
    // Before the start instant the replay is at its very beginning, never negative.
    expect(replayFrame(REPLAY, PLAYING, START - 5_000)?.elapsedMs).toBe(0);
  });

  it('faces the direction it is walking, and the camera when it is not', () => {
    expect(replayFacing({ x: 0, y: 0 }, { x: 5, y: 1 })).toBe('right');
    expect(replayFacing({ x: 5, y: 0 }, { x: 0, y: 1 })).toBe('left');
    expect(replayFacing({ x: 0, y: 0 }, { x: 1, y: 5 })).toBe('down');
    expect(replayFacing({ x: 0, y: 5 }, { x: 1, y: 0 })).toBe('up');
    expect(replayFacing({ x: 3, y: 3 }, { x: 3, y: 3 })).toBe('down');
  });
});
