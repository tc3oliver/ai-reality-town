/**
 * Continuous navigation's return leg (FR-P002 / ART-130 AC#5).
 *
 * Everything here is pure, which is why the precedence rule was lifted out of `LiveMapPage` in
 * the first place: a rule that lives inline in a component gets tested through a renderer or not
 * at all, and this one has four branches that all matter.
 */

import type { StorageLike } from './replaySession';
import {
  readRememberedCamera,
  rememberCamera,
  resolveLiveEntry,
} from './liveViewSession';
import { characterTargetId, liveMapHref, locationTargetId } from './liveMapRoute';

const WORLD = 'mistwood';

/** A storage a test fully controls, including one that throws the way a blocked browser does. */
function fakeStorage(initial: Record<string, string> = {}, throws = false): StorageLike {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      if (throws) throw new Error('blocked');
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      if (throws) throw new Error('quota');
      map.set(key, value);
    },
  };
}

describe('remembering the camera', () => {
  test('round-trips what the viewer was looking at', () => {
    const storage = fakeStorage();
    const camera = { focusId: locationTargetId('mistwood-mill'), follow: false, zoomStep: 2 };
    rememberCamera(WORLD, camera, storage);
    expect(readRememberedCamera(WORLD, storage)).toEqual(camera);
  });

  test('is scoped per world, so two worlds in one tab do not overwrite each other', () => {
    const storage = fakeStorage();
    rememberCamera('a', { focusId: characterTargetId('x'), follow: false, zoomStep: 1 }, storage);
    rememberCamera('b', { focusId: characterTargetId('y'), follow: true, zoomStep: 0 }, storage);
    expect(readRememberedCamera('a', storage)?.focusId).toBe(characterTargetId('x'));
    expect(readRememberedCamera('b', storage)?.focusId).toBe(characterTargetId('y'));
  });

  test('fails OPEN on every storage failure, unlike the replay mark', () => {
    // The two session modules fail in opposite directions on purpose. `replaySession` fails
    // closed because its failure mode is auto-playing repeatedly; this one's failure mode is
    // merely arriving at the town view, which is the ordinary first-visit experience.
    expect(readRememberedCamera(WORLD, null)).toBeNull();
    expect(readRememberedCamera(WORLD, fakeStorage({}, true))).toBeNull();
    // ...and writing to a storage that throws is silent rather than taking the page down.
    expect(() =>
      rememberCamera(WORLD, { focusId: null, follow: true, zoomStep: 0 }, fakeStorage({}, true)),
    ).not.toThrow();
    expect(() => rememberCamera(WORLD, { focusId: null, follow: true, zoomStep: 0 }, null)).not.toThrow();
  });

  test('is total over anything a hand edit or an older deploy could leave behind', () => {
    const key = `ai-reality-town:live:camera:${WORLD}`;
    for (const raw of [
      '', 'not json', 'null', '"a string"', '42', '[]',
      '{}',                                        // no fields
      '{"focusId":1,"follow":true,"zoomStep":0}',  // wrong focus type
      '{"focusId":null,"follow":"yes","zoomStep":0}', // wrong follow type
      '{"focusId":null,"follow":true}',            // missing zoom
      '{"focusId":null,"follow":true,"zoomStep":"2"}',
      '{"focusId":null,"follow":true,"zoomStep":null}',
    ]) {
      expect(readRememberedCamera(WORLD, fakeStorage({ [key]: raw }))).toBeNull();
    }
    // NaN and Infinity survive JSON as `null`, which the type check above already rejects.
    expect(readRememberedCamera(WORLD, fakeStorage({ [key]: '{"focusId":null,"follow":true,"zoomStep":1e999}' })))
      .toBeNull();
  });

  test('bounds a stored zoom rather than handing it to the camera', () => {
    const key = `ai-reality-town:live:camera:${WORLD}`;
    const huge = fakeStorage({ [key]: '{"focusId":null,"follow":false,"zoomStep":1000000}' });
    expect(readRememberedCamera(WORLD, huge)?.zoomStep).toBe(8);
    const tiny = fakeStorage({ [key]: '{"focusId":null,"follow":false,"zoomStep":-1000000}' });
    expect(readRememberedCamera(WORLD, tiny)?.zoomStep).toBe(-8);
  });

  test('an empty focus id normalises to the town view rather than to a target named ""', () => {
    const key = `ai-reality-town:live:camera:${WORLD}`;
    expect(readRememberedCamera(WORLD, fakeStorage({ [key]: '{"focusId":"","follow":false,"zoomStep":0}' })))
      .toEqual({ focusId: null, follow: false, zoomStep: 0 });
  });
});

describe('how the live map opens (AC#5 precedence)', () => {
  const remembered = fakeStorage();
  beforeEach(() => {
    rememberCamera(WORLD, { focusId: locationTargetId('mistwood-mill'), follow: false, zoomStep: 3 }, remembered);
  });

  test('with neither a link nor a memory, it has no opinion at all', () => {
    expect(resolveLiveEntry({ search: '', worldId: WORLD, storage: fakeStorage() }))
      .toEqual({ mode: undefined, openCharacterId: null });
    // `undefined` rather than the town view: "no opinion" lets the map keep its own default,
    // whereas naming a mode here would make this module the second place that decides it.
  });

  test('a remembered camera is restored when no link asked for anything', () => {
    const entry = resolveLiveEntry({ search: '', worldId: WORLD, storage: remembered });
    expect(entry.mode).toEqual({ follow: false, focusId: locationTargetId('mistwood-mill'), zoomStep: 3 });
    // A card is never re-opened from memory: opening one is something a viewer does, and doing it
    // for them on every return is the page making a decision on their behalf.
    expect(entry.openCharacterId).toBeNull();
  });

  test('an explicit ?focus= WINS over the remembered camera', () => {
    // The rule that matters. A viewer who just clicked "在地圖上查看 何俊" is asking for 何俊 now;
    // restoring the mill they were watching an hour ago would ignore the thing they clicked.
    const entry = resolveLiveEntry({
      search: `?focus=${encodeURIComponent(characterTargetId('he-jun'))}&card=1`,
      worldId: WORLD,
      storage: remembered,
    });
    expect(entry.mode).toEqual({ follow: false, focusId: characterTargetId('he-jun'), zoomStep: 0 });
    expect(entry.openCharacterId).toBe('he-jun');
  });

  test('a linked focus switches auto-follow OFF', () => {
    // Otherwise the primary scene pulls the camera straight back off the linked target and the
    // link appears to do nothing — the same reason pressing a focus button clears `follow`.
    const entry = resolveLiveEntry({
      search: `?focus=${encodeURIComponent(locationTargetId('mistwood-hall'))}`,
      worldId: WORLD,
      storage: fakeStorage(),
    });
    expect(entry.mode?.follow).toBe(false);
  });

  test('a link without card=1 focuses the camera and opens nothing', () => {
    const entry = resolveLiveEntry({
      search: `?focus=${encodeURIComponent(characterTargetId('he-jun'))}`,
      worldId: WORLD,
      storage: fakeStorage(),
    });
    expect(entry.mode?.focusId).toBe(characterTargetId('he-jun'));
    expect(entry.openCharacterId).toBeNull();
  });

  test('card=1 on a non-character target opens no card rather than a broken one', () => {
    const entry = resolveLiveEntry({
      search: `?focus=${encodeURIComponent(locationTargetId('mistwood-mill'))}&card=1`,
      worldId: WORLD,
      storage: fakeStorage(),
    });
    expect(entry.mode?.focusId).toBe(locationTargetId('mistwood-mill'));
    expect(entry.openCharacterId).toBeNull();
  });

  test('a malformed link degrades to the memory, and then to nothing', () => {
    // A hand-edited URL, or one carrying a parameter from an older deploy, must leave a WORKING
    // page. It falls through to the remembered camera rather than being treated as a focus of "".
    for (const search of ['?', '?focus=', '?focus=%20', '?other=1']) {
      expect(resolveLiveEntry({ search, worldId: WORLD, storage: remembered }).mode?.focusId)
        .toBe(locationTargetId('mistwood-mill'));
      expect(resolveLiveEntry({ search, worldId: WORLD, storage: fakeStorage() }).mode).toBeUndefined();
    }
  });

  test('the href an editorial page builds is one this resolver reads back', () => {
    // Producer and consumer checked against each other rather than against a literal: a change to
    // either side that broke the round trip would otherwise leave every link silently unfocused.
    const href = liveMapHref(WORLD, '/ai-town/', {
      targetId: characterTargetId('he-jun'),
      openCard: true,
    });
    const search = href.slice(href.indexOf('?'));
    expect(resolveLiveEntry({ search, worldId: WORLD, storage: fakeStorage() })).toEqual({
      mode: { follow: false, focusId: characterTargetId('he-jun'), zoomStep: 0 },
      openCharacterId: 'he-jun',
    });
  });
});
