/**
 * The public status vocabulary (FR-P003 / ART-131 AC#3, AC#7).
 *
 * Pure-model half of the claim. What a browser does with these descriptors — the border-style per
 * state, the greyscale survival, the visually-hidden announcement — is asserted on rendered markup
 * in `publicPages.a11y.test.tsx`; this file is about the vocabulary itself being total, distinct
 * and in step with the server verdict it names.
 */

import { readFileSync } from 'node:fs';

import {
  PUBLIC_FRESHNESS_STATES,
  freshnessDescriptor,
  worldClockDescriptors,
} from './publicStatusBadge';

describe('the freshness vocabulary', () => {
  test('covers every state the server can actually return', () => {
    // The list is RESTATED in `src/` rather than imported, because the client may not depend on
    // the Convex read modules. A restatement that drifts is worse than no restatement: the badge
    // would silently render nothing for a state the server had started returning. Read as source
    // text rather than imported so this pin costs no dependency of its own.
    const source = readFileSync(
      new URL('../../../convex/publicRead/runtimeSnapshot.ts', import.meta.url),
      'utf8',
    );
    const declaration = source.match(/export const RUNTIME_FRESHNESS = \[([^\]]*)\]/);
    expect(declaration).not.toBeNull();
    const server = [...(declaration as RegExpMatchArray)[1].matchAll(/'([a-z_]+)'/g)].map(
      (match) => match[1],
    );
    expect(server.length).toBeGreaterThan(0);
    expect([...PUBLIC_FRESHNESS_STATES].sort()).toEqual([...server].sort());
  });

  test('every state is distinguishable by label alone, and by glyph alone', () => {
    // AC#7. Three signals, and two of them are checked here: if either collapsed to a shared
    // value, a viewer would be left with colour and border-style only.
    const descriptors = PUBLIC_FRESHNESS_STATES.map((state) => freshnessDescriptor(state)!);
    expect(descriptors.every((descriptor) => descriptor !== null)).toBe(true);
    expect(new Set(descriptors.map((d) => d.label)).size).toBe(descriptors.length);
    expect(new Set(descriptors.map((d) => d.glyph)).size).toBe(descriptors.length);
    // The third signal is the key the stylesheet turns into a border-style.
    expect(new Set(descriptors.map((d) => d.state)).size).toBe(descriptors.length);
  });

  test('every state announces itself as a sentence, not as a fragment', () => {
    for (const state of PUBLIC_FRESHNESS_STATES) {
      const descriptor = freshnessDescriptor(state)!;
      expect(descriptor.announcement.length).toBeGreaterThan(descriptor.label.length);
      expect(descriptor.announcement.endsWith('。')).toBe(true);
    }
  });

  test('`stale` says the state is unknown rather than claiming the world stopped', () => {
    // The honest distinction the four-state vocabulary exists for. A stale snapshot means the
    // capture path has not confirmed anything for hours, so reporting it as `paused` would assert
    // something about the world that nothing currently knows.
    const stale = freshnessDescriptor('stale')!;
    const paused = freshnessDescriptor('paused')!;
    expect(stale.announcement).toContain('無法確認');
    expect(paused.announcement).toContain('暫停');
    expect(stale.announcement).not.toBe(paused.announcement);
    // ...and neither implies the world has ended.
    for (const descriptor of [stale, paused]) expect(descriptor.announcement).not.toContain('結束');
  });

  test('an unknown, absent or malformed state renders no badge rather than a wrong one', () => {
    for (const input of [null, undefined, '', 'offline', 'LIVE', 'ended']) {
      expect(freshnessDescriptor(input as string | null | undefined)).toBeNull();
    }
    // A future server state therefore degrades to silence, which is the only safe direction: a
    // badge that says the wrong thing about whether a world is running is worse than no badge.
  });
});

describe('the world clock chips', () => {
  test('render the day and the slot, in that order', () => {
    const chips = worldClockDescriptors(7, 'evening');
    expect(chips.map((chip) => chip.label)).toEqual(['第 7 天', 'evening']);
    // Metadata, not state: nothing keys a border-style off them.
    expect(chips.every((chip) => chip.state === null)).toBe(true);
    expect(new Set(chips.map((chip) => chip.glyph)).size).toBe(2);
  });

  test('accept the string day the homepage view model already produces', () => {
    // `homeRoute.ts` stringifies the day; the live projection hands over a number. Normalising
    // here keeps it a presentation concern rather than forcing either view model to change.
    expect(worldClockDescriptors('7', 'evening').map((chip) => chip.label)).toEqual([
      '第 7 天',
      'evening',
    ]);
  });

  test('omit a chip whose value is unknown rather than rendering a placeholder', () => {
    // `homeRoute.ts` substitutes an em dash where the world clock is not published. 「第 — 天」
    // says less than no chip at all.
    expect(worldClockDescriptors('—', '—')).toEqual([]);
    expect(worldClockDescriptors(null, null)).toEqual([]);
    expect(worldClockDescriptors(undefined, undefined)).toEqual([]);
    // Half-known stays half-rendered rather than being dropped whole.
    expect(worldClockDescriptors(7, '—').map((chip) => chip.label)).toEqual(['第 7 天']);
    expect(worldClockDescriptors('—', 'evening').map((chip) => chip.label)).toEqual(['evening']);
  });

  test('a non-finite day is treated as unknown', () => {
    expect(worldClockDescriptors(Number.NaN, 'evening').map((chip) => chip.label)).toEqual([
      'evening',
    ]);
    expect(worldClockDescriptors(Number.POSITIVE_INFINITY, null)).toEqual([]);
  });
});
