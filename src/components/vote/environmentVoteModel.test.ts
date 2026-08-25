/**
 * FR-J001 / ART-45 — the ballot panel's render model.
 *
 * The component is a render layer and the write hook is four lines, so this is where the panel's
 * behaviour is actually settled: what it says, which control it offers, and what a viewer is
 * told when the server refuses them.
 */

import {
  composeEnvironmentVoteViewModel,
  GENERIC_REFUSAL_TEXT,
  refusalText,
  VOTE_DISCLAIMER,
  type EnvironmentVoteBallot,
} from './environmentVoteModel';
import { VOTE_REJECTION_CODES } from '../../../convex/viewer/environmentVote';

const CUTOFF = 1_000;

const ballot: EnvironmentVoteBallot = {
  worldId: 'mistwood',
  worldDay: 7,
  targetWorldDay: 8,
  cutoffAt: CUTOFF,
  candidates: [
    { candidateId: 'power_outage', title: '停電', description: '鎮上的電力在今天中斷。', votes: 3 },
    { candidateId: 'heavy_storm', title: '暴雨', description: '一場暴雨籠罩整個小鎮。', votes: 1 },
  ],
  totalVotes: 4,
};

const compose = (
  overrides: Partial<Parameters<typeof composeEnvironmentVoteViewModel>[0]> = {},
) => composeEnvironmentVoteViewModel({ ballot, interaction: { kind: 'idle' }, now: 0, ...overrides });

describe('the ballot panel', () => {
  test('with no open round it reports voting closed and offers nothing', () => {
    const vm = compose({ ballot: null });
    expect(vm.available).toBe(false);
    expect(vm.status).toBe('投票尚未開放。');
    expect(vm.options).toEqual([]);
    // The UX-005 promise is rendered even with no ballot, so the section never states the
    // feature exists without also stating its limits.
    expect(vm.disclaimer).toBe(VOTE_DISCLAIMER);
  });

  test('an open round names the day a winner would affect', () => {
    const vm = compose();
    expect(vm.available).toBe(true);
    expect(vm.status).toContain('第 8 天');
    expect(vm.affectsWorldDay).toBe(8);
    expect(vm.options.map((option) => option.selectable)).toEqual([true, true]);
  });

  test('vote shares are whole percentages of the round total', () => {
    expect(compose().options.map((option) => option.sharePercent)).toEqual([75, 25]);
  });

  test('an empty round reports zero share rather than dividing by zero', () => {
    const empty = { ...ballot, totalVotes: 0, candidates: ballot.candidates.map((c) => ({ ...c, votes: 0 })) };
    expect(compose({ ballot: empty }).options.map((option) => option.sharePercent)).toEqual([0, 0]);
  });

  test('after the cutoff the result is still shown, but nothing is selectable', () => {
    // A viewer arriving a minute late should see what was decided, not an empty section.
    const vm = compose({ now: CUTOFF });
    expect(vm.available).toBe(false);
    expect(vm.status).toContain('已截止');
    expect(vm.options.map((option) => option.selectable)).toEqual([false, false]);
    expect(vm.options.map((option) => option.votes)).toEqual([3, 1]);
  });

  test('a device that has voted sees its choice marked and no further controls', () => {
    const vm = compose({ interaction: { kind: 'accepted', candidateId: 'heavy_storm' } });
    expect(vm.options.map((option) => option.chosen)).toEqual([false, true]);
    expect(vm.options.every((option) => !option.selectable)).toBe(true);
    expect(vm.message).toBe('已收到你的投票。');
  });

  test('controls are withdrawn while a submission is in flight', () => {
    const vm = compose({ interaction: { kind: 'submitting' } });
    expect(vm.options.every((option) => !option.selectable)).toBe(true);
    expect(vm.message).toBe('送出中…');
  });

  test('every server refusal code has viewer-facing text', () => {
    // Read from the server's own union rather than restated, so a new refusal cannot ship
    // without an explanation. This is the assertion that keeps the two files honest.
    for (const code of VOTE_REJECTION_CODES) {
      expect(refusalText(code)).not.toBe(GENERIC_REFUSAL_TEXT);
      expect(refusalText(code).length).toBeGreaterThan(0);
    }
  });

  test('an unrecognised or absent code degrades to a generic sentence', () => {
    // Never render the code. A stranger's submission must not be able to put a machine token
    // in front of a viewer, and a build that has not heard of a refusal must not print
    // `undefined`.
    expect(refusalText('VOTE_SOMETHING_NEW')).toBe(GENERIC_REFUSAL_TEXT);
    expect(refusalText(null)).toBe(GENERIC_REFUSAL_TEXT);
    expect(compose({ interaction: { kind: 'refused', code: null } }).message).toBe(GENERIC_REFUSAL_TEXT);
  });

  test('a refusal never echoes anything the viewer submitted', () => {
    const vm = compose({ interaction: { kind: 'refused', code: 'VOTE_INPUT_REJECTED' } });
    expect(vm.message).toBe('這次送出的內容沒有通過安全檢查。');
    expect(JSON.stringify(vm)).not.toContain('VOTE_INPUT_REJECTED');
  });
});
