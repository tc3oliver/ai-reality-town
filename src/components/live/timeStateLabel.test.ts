/**
 * Honest time-state labelling (FR-O014 / ART-121 AC#9).
 *
 * `composeTimeStateBadges` is pure, so the "not by colour alone" claim is checkable directly on
 * its output: every badge names a distinct label, a distinct glyph and belongs to a distinct
 * `state` (which `TimeStateBanner.tsx` turns into `data-time-state`) with no DOM required.
 */

import { TIME_STATES, composeTimeStateBadges, type TimeStateBadge } from './timeStateLabel';

function distinct<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

describe('AC#9 — live-only state', () => {
  test('with no replay, exactly the "now" badge is present', () => {
    const badges = composeTimeStateBadges({ replay: null, worldDay: 4, timeSlot: 'evening' });
    expect(badges).toHaveLength(1);
    expect(badges[0].state).toBe('now');
    expect(badges[0].label).toBe('現在');
    expect(badges[0].detail).toContain('4');
    expect(badges[0].detail).toContain('evening');
  });

  test('unknown world time is admitted, not fabricated', () => {
    const badges = composeTimeStateBadges({ replay: null });
    expect(badges[0].detail).not.toBe('');
    expect(badges[0].announcement.length).toBeGreaterThan(0);
  });
});

describe('AC#9 — during playback, all three states are shown together', () => {
  const badges = composeTimeStateBadges({
    replay: { worldDay: 2, timeSlot: 'morning', sceneIndex: 0, sceneCount: 3 },
    worldDay: 4,
    timeSlot: 'evening',
  });

  test('exactly replay, earlier and now, in that order', () => {
    expect(badges.map((badge) => badge.state)).toEqual(['replay', 'earlier', 'now']);
  });

  test('the recording day/slot and the world day/slot are never conflated', () => {
    const earlier = badges.find((badge) => badge.state === 'earlier')!;
    const now = badges.find((badge) => badge.state === 'now')!;
    expect(earlier.detail).toContain('2');
    expect(earlier.detail).toContain('morning');
    expect(now.detail).toContain('4');
    expect(now.detail).toContain('evening');
    expect(earlier.detail).not.toBe(now.detail);
  });

  test('the replay badge names which scene is playing', () => {
    const replay = badges.find((badge) => badge.state === 'replay')!;
    expect(replay.detail).toContain('1');
    expect(replay.detail).toContain('3');
  });
});

describe('AC#9 — not by colour alone', () => {
  const allStates: TimeStateBadge[] = composeTimeStateBadges({
    replay: { worldDay: 2, timeSlot: 'morning', sceneIndex: 1, sceneCount: 2 },
    worldDay: 4,
    timeSlot: 'evening',
  });

  test('covers every declared time state exactly once', () => {
    expect(allStates.map((badge) => badge.state).sort()).toEqual([...TIME_STATES].sort());
  });

  test('every badge carries non-empty label, glyph, detail and announcement', () => {
    for (const badge of allStates) {
      expect(badge.label.length).toBeGreaterThan(0);
      expect(badge.glyph.length).toBeGreaterThan(0);
      expect(badge.detail.length).toBeGreaterThan(0);
      expect(badge.announcement.length).toBeGreaterThan(0);
    }
  });

  test('labels and glyphs are mutually distinct — text and shape both carry the distinction', () => {
    expect(distinct(allStates.map((badge) => badge.label))).toBe(true);
    expect(distinct(allStates.map((badge) => badge.glyph))).toBe(true);
  });

  test('stripped of everything but label text, the three rows are still distinguishable', () => {
    // Simulates "remove all styling" — the only signal left is `label`, joined as a stylesheet
    // would render it: plain text nodes with no colour, no glyph, no attribute.
    const strippedText = allStates.map((badge) => badge.label);
    expect(distinct(strippedText)).toBe(true);
    expect(strippedText.every((label) => label.length > 0)).toBe(true);
  });

  test('the announcement is a full sentence, not a repeat of the label', () => {
    for (const badge of allStates) {
      expect(badge.announcement).not.toBe(badge.label);
      expect(badge.announcement.length).toBeGreaterThan(badge.label.length);
    }
  });

  test('the replay announcement says plainly that this is a recording, not the present', () => {
    const replay = allStates.find((badge) => badge.state === 'replay')!;
    expect(replay.announcement).toContain('不是現在發生的事');
  });
});
