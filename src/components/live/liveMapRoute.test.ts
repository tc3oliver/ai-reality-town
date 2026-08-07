/**
 * Live route resolution (ART-118, FR-O001 AC#8).
 *
 * AC#8 has two halves: the PRD 2.0 path must resolve, and the legacy hash must
 * redirect to it *without losing the world identifier*. The second half is the
 * one a blanket rewrite quietly breaks, so it is asserted target-by-target here
 * rather than as "a redirect happens".
 *
 * Pure jest (no jsdom): the module under test imports nothing at all.
 */

import {
  liveMapHref,
  normalizeBase,
  parseLegacyLiveHash,
  parseLiveMapPath,
  redirectForLegacyHash,
  textLiveHref,
} from './liveMapRoute';

/** What Vite exposes as `import.meta.env.BASE_URL` for `base: '/ai-town'`. */
const BASE = '/ai-town/';

describe('normalizeBase', () => {
  test.each([
    ['/ai-town/', '/ai-town'],
    ['/ai-town', '/ai-town'],
    ['ai-town/', '/ai-town'],
    ['/', ''],
    ['', ''],
    ['./', ''],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeBase(input)).toBe(expected);
  });
});

describe('parseLiveMapPath', () => {
  test('resolves the map route under the deployment base', () => {
    expect(parseLiveMapPath('/ai-town/live/mistwood', BASE)).toEqual({
      worldId: 'mistwood',
      view: 'map',
    });
  });

  test('resolves the text sibling', () => {
    expect(parseLiveMapPath('/ai-town/live/mistwood/text', BASE)).toEqual({
      worldId: 'mistwood',
      view: 'text',
    });
  });

  test('tolerates a trailing slash on either route', () => {
    expect(parseLiveMapPath('/ai-town/live/mistwood/', BASE)?.view).toBe('map');
    expect(parseLiveMapPath('/ai-town/live/mistwood/text/', BASE)?.view).toBe('text');
  });

  test('decodes an encoded world identifier', () => {
    expect(parseLiveMapPath('/ai-town/live/two%20words', BASE)?.worldId).toBe('two words');
  });

  test('works with no base at all', () => {
    expect(parseLiveMapPath('/live/mistwood', '/')).toEqual({ worldId: 'mistwood', view: 'map' });
    expect(parseLiveMapPath('/live/mistwood/text', '')).toEqual({
      worldId: 'mistwood',
      view: 'text',
    });
  });

  test('returns null for anything else, so the hash routes still get their turn', () => {
    expect(parseLiveMapPath('/ai-town/', BASE)).toBeNull();
    expect(parseLiveMapPath('/ai-town/live', BASE)).toBeNull();
    expect(parseLiveMapPath('/ai-town/live/', BASE)).toBeNull();
    expect(parseLiveMapPath('/ai-town/live/mistwood/text/extra', BASE)).toBeNull();
    expect(parseLiveMapPath('/ai-town/episodes/mistwood', BASE)).toBeNull();
    // Outside the deployment base entirely.
    expect(parseLiveMapPath('/somewhere-else/live/mistwood', BASE)).toBeNull();
    // A prefix that merely starts with the base string is not under it.
    expect(parseLiveMapPath('/ai-townhouse/live/mistwood', BASE)).toBeNull();
  });
});

describe('href builders', () => {
  test('produce the canonical routes', () => {
    expect(liveMapHref('mistwood', BASE)).toBe('/ai-town/live/mistwood');
    expect(textLiveHref('mistwood', BASE)).toBe('/ai-town/live/mistwood/text');
    expect(liveMapHref('mistwood', '/')).toBe('/live/mistwood');
  });

  test('round-trip a world identifier that needs encoding', () => {
    const href = liveMapHref('two words', BASE);
    expect(href).toBe('/ai-town/live/two%20words');
    expect(parseLiveMapPath(href, BASE)?.worldId).toBe('two words');
  });
});

describe('the legacy hash still works (AC#8)', () => {
  test('parses the retired #live/<worldId> entry point', () => {
    expect(parseLegacyLiveHash('#live/mistwood')).toEqual({ worldId: 'mistwood' });
    expect(parseLegacyLiveHash('live/mistwood')).toEqual({ worldId: 'mistwood' });
    expect(parseLegacyLiveHash('#live/two%20words')).toEqual({ worldId: 'two words' });
  });

  test('rejects a bare or unrelated hash', () => {
    expect(parseLegacyLiveHash('#live')).toBeNull();
    expect(parseLegacyLiveHash('#live/')).toBeNull();
    expect(parseLegacyLiveHash('#home/mistwood')).toBeNull();
    expect(parseLegacyLiveHash('')).toBeNull();
  });

  test('redirects to the map with the world identifier intact', () => {
    expect(redirectForLegacyHash('#live/mistwood', BASE)).toBe('/ai-town/live/mistwood');
    expect(redirectForLegacyHash('#live/two%20words', BASE)).toBe('/ai-town/live/two%20words');
    // The redirect target is itself a route this app resolves -- a redirect to a
    // 404 would satisfy "a redirect happens" and still lose the viewer.
    const target = redirectForLegacyHash('#live/mistwood', BASE)!;
    expect(parseLiveMapPath(target, BASE)).toEqual({ worldId: 'mistwood', view: 'map' });
  });

  test('leaves every other hash route alone', () => {
    for (const hash of ['#home/mistwood', '#episodes/mistwood', '#help', '#arc/mistwood/a', '']) {
      expect(redirectForLegacyHash(hash, BASE)).toBeNull();
    }
  });
});
