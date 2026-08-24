/**
 * Editorial → live map links (FR-P002 / ART-130 AC#2, AC#3).
 *
 * The direction FR-P002 says was missing. Episode → character and arc → character already
 * existed as links to the *pages*; what nothing answered was "where are they right now", which
 * is the map.
 *
 * Every assertion here is a ROUND TRIP against the consumer rather than a comparison with a
 * literal string. A test that expected `/live/mistwood?focus=character%3Ahe-jun` would keep
 * passing after someone changed the camera's prefix, while every real link silently stopped
 * resolving and dropped viewers at an unfocused map — which is a working page, and therefore a
 * failure nobody would notice.
 */

import {
  characterIdFromFocusTargetId,
  characterTargetId,
  locationTargetId,
  parseLiveMapFocus,
  sceneTargetId,
} from '../live/liveMapRoute';
import {
  characterMapHrefWithBase,
  locationMapHrefWithBase,
  sceneMapHrefWithBase,
} from './liveMapLinks';

const WORLD = 'mistwood';
const BASE = '/ai-town/';

function focusOf(href: string) {
  const index = href.indexOf('?');
  expect(index).toBeGreaterThan(-1);
  return parseLiveMapFocus(href.slice(index));
}

describe('a character link (AC#2)', () => {
  const href = characterMapHrefWithBase(WORLD, 'he-jun', BASE);

  test('points at the live map for the right world', () => {
    expect(href.startsWith(`/ai-town/live/${WORLD}?`)).toBe(true);
  });

  test('round-trips back to the same character', () => {
    const focus = focusOf(href);
    expect(focus).not.toBeNull();
    expect(characterIdFromFocusTargetId(focus!.targetId)).toBe('he-jun');
  });

  test('asks for the card as well as the camera', () => {
    // "Where is this person" and "what are they doing" are one question; the camera alone
    // answers half of it and leaves the viewer to hunt for the other half.
    expect(focusOf(href)!.openCard).toBe(true);
  });

  test('survives an id that needs escaping', () => {
    // Character ids are Canon-derived strings, not a curated enum. One containing `&` or `=`
    // would otherwise inject a second query parameter.
    for (const id of ['a b', 'a&card=0', 'a=b', 'a/b', '角色']) {
      const focus = focusOf(characterMapHrefWithBase(WORLD, id, BASE));
      expect(characterIdFromFocusTargetId(focus!.targetId)).toBe(id);
      expect(focus!.openCard).toBe(true);
    }
  });
});

describe('location and scene links (AC#3)', () => {
  test('a location link round-trips and opens no card', () => {
    const focus = focusOf(locationMapHrefWithBase(WORLD, 'mistwood-mill', BASE));
    expect(focus!.targetId).toBe(locationTargetId('mistwood-mill'));
    expect(focus!.openCard).toBe(false);
  });

  test('a scene link round-trips, including the colons a scene id contains', () => {
    // Scene ids look like `7:evening:mistwood-mill`, so this is the case a naive builder breaks.
    const sceneId = '7:evening:mistwood-mill';
    const focus = focusOf(sceneMapHrefWithBase(WORLD, sceneId, BASE));
    expect(focus!.targetId).toBe(sceneTargetId(sceneId));
    expect(focus!.openCard).toBe(false);
  });
});

describe('the namespace has exactly one owner', () => {
  test('links are built with the camera’s own constructors, not a second copy of the prefix', () => {
    // If `characterTargetId` ever changes, this follows it; a hand-written `character:${id}` in
    // `components/public` would not, and nothing would fail. That is why the constructors live
    // in `liveMapRoute` — the one module `clientPublic`, `clientLive` and `clientWorldReadOnly`
    // may all depend on, because it depends on nothing itself.
    expect(focusOf(characterMapHrefWithBase(WORLD, 'x', BASE))!.targetId)
      .toBe(characterTargetId('x'));
    expect(focusOf(locationMapHrefWithBase(WORLD, 'x', BASE))!.targetId)
      .toBe(locationTargetId('x'));
    expect(focusOf(sceneMapHrefWithBase(WORLD, 'x', BASE))!.targetId).toBe(sceneTargetId('x'));
  });

  test('the three kinds are distinguishable from each other', () => {
    const kinds = ['x'].flatMap(() => [
      characterTargetId('x'),
      locationTargetId('x'),
      sceneTargetId('x'),
    ]);
    expect(new Set(kinds).size).toBe(3);
    // ...and only the character one is read back as a character, so a location link can never
    // open a character card for a location id.
    expect(characterIdFromFocusTargetId(locationTargetId('x'))).toBeNull();
    expect(characterIdFromFocusTargetId(sceneTargetId('x'))).toBeNull();
  });

  test('the base prefix is honoured, so links work under the deployed path', () => {
    expect(characterMapHrefWithBase(WORLD, 'x', '/ai-town/').startsWith('/ai-town/live/')).toBe(true);
    expect(characterMapHrefWithBase(WORLD, 'x', '/').startsWith('/live/')).toBe(true);
    expect(characterMapHrefWithBase(WORLD, 'x', '').startsWith('/live/')).toBe(true);
  });
});
