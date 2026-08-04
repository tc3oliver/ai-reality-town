/**
 * Viewer spoiler-mode compatibility tests (ART-70, FR-H005 AC#3).
 *
 * Proves the three future spoiler perspectives can be filtered from current
 * public-read content using ONLY the fields the data model already carries
 * (`visibility` + `worldDay`) plus a watched-episode set — i.e. no destructive
 * migration is required (AC#1/#3). MVP does not implement the UI (AC#2); these
 * tests assert the data contract, not behavior.
 *
 * Pure jest (no Convex/DOM): the module under test is pure.
 */

import {
  filterBySpoilerMode,
  isSpoilerMode,
  isVisibleUnderMode,
  SPOILER_MODES,
  type SpoilerFilterable,
} from './spoilerMode';

const pub = (worldDay: number | null): SpoilerFilterable => ({ visibility: 'public', worldDay });
const priv = (worldDay: number | null): SpoilerFilterable => ({ visibility: 'private', worldDay });

describe('spoiler-mode taxonomy (FR-H005)', () => {
  it('declares exactly the three PRD spoiler modes', () => {
    expect(SPOILER_MODES).toEqual(['full', 'publicOnly', 'watchedOnly']);
  });
  it('validates spoiler modes', () => {
    expect(isSpoilerMode('full')).toBe(true);
    expect(isSpoilerMode('publicOnly')).toBe(true);
    expect(isSpoilerMode('watchedOnly')).toBe(true);
    expect(isSpoilerMode('spoilers-off')).toBe(false);
  });
});

describe('isVisibleUnderMode', () => {
  it('full reveals private content (Full Viewer Perspective)', () => {
    expect(isVisibleUnderMode(priv(1), 'full', new Set())).toBe(true);
    expect(isVisibleUnderMode(pub(1), 'full', new Set())).toBe(true);
  });

  it('publicOnly hides private content but shows all public episodes (AC#3)', () => {
    expect(isVisibleUnderMode(priv(1), 'publicOnly', new Set())).toBe(false);
    expect(isVisibleUnderMode(pub(1), 'publicOnly', new Set())).toBe(true);
    expect(isVisibleUnderMode(pub(99), 'publicOnly', new Set())).toBe(true);
  });

  it('watchedOnly scopes public content to watched episodes (AC#3)', () => {
    const watched = new Set([1, 2]);
    expect(isVisibleUnderMode(pub(1), 'watchedOnly', watched)).toBe(true);
    expect(isVisibleUnderMode(pub(3), 'watchedOnly', watched)).toBe(false);
    // Private content never leaks, even if its episode was watched.
    expect(isVisibleUnderMode(priv(1), 'watchedOnly', watched)).toBe(false);
  });

  it('watchedOnly treats world-level (non-episode) context as visible once the viewer has entered the world', () => {
    expect(isVisibleUnderMode(pub(null), 'watchedOnly', new Set([1]))).toBe(true);
    expect(isVisibleUnderMode(pub(null), 'watchedOnly', new Set())).toBe(false);
  });
});

describe('filterBySpoilerMode (compatibility proof)', () => {
  const items: SpoilerFilterable[] = [
    pub(1), priv(1), pub(2), priv(2), pub(3),
  ];

  it('full keeps every item (incl. private) with no watched set needed', () => {
    expect(filterBySpoilerMode(items, 'full', new Set())).toHaveLength(5);
  });

  it('publicOnly keeps the 3 public items without needing watched data', () => {
    const result = filterBySpoilerMode(items, 'publicOnly', new Set());
    expect(result).toHaveLength(3);
    expect(result.every((item) => item.visibility === 'public')).toBe(true);
  });

  it('watchedOnly keeps only public items from watched episodes', () => {
    const result = filterBySpoilerMode(items, 'watchedOnly', new Set([1]));
    expect(result.map((item) => item.worldDay)).toEqual([1]);
  });

  it('uses ONLY visibility + worldDay + watched set — no other field is required', () => {
    // The filterable items above carry exactly { visibility, worldDay } and nothing
    // else; all three modes filter them correctly, proving the model needs no
    // additional field to support P2 spoiler modes.
    for (const mode of SPOILER_MODES) {
      const result = filterBySpoilerMode(items, mode, new Set([1, 2]));
      for (const item of result) {
        expect(Object.keys(item).sort()).toEqual(['visibility', 'worldDay']);
      }
    }
  });
});
