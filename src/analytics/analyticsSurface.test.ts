/**
 * Analytics adds no network behaviour and no tracking surface (FR-Q007 / ART-140 AC#3).
 *
 * The claim that matters here is a NEGATIVE one, and a behavioural test cannot prove it — it
 * can only show that the interactions it happened to exercise sent nothing. So the proof is
 * structural, exactly as `liveMapSurface.test.ts` does for the live map: every shipped file in
 * the module is read, and every API a request, a timer or an identifier would have to travel
 * through is looked for by name. A future sink that fetched something fails this whether or not
 * anyone wrote a test for it.
 *
 * The two gates already covering `src` — `readOnlyClientBoundary`'s forbidden symbols and
 * `publicReadOnlyGuarantee.test.ts`'s enumeration of the client-reachable Convex surface —
 * remain the primary defence. This is the product-side evidence for the module ART-140 adds.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

import {
  ANALYTICS_CHARACTER_PREFIX,
  ANALYTICS_SCENE_PREFIX,
  ANALYTICS_TOWN_TARGET_ID,
} from './cameraEvents';
import {
  emitDynamicViewEvent,
  noopAnalyticsSink,
  resetAnalyticsSink,
  setAnalyticsSink,
} from './analyticsSink';
import { characterTargetId, sceneTargetId, TOWN_TARGET_ID } from '../components/live/liveMapRoute';
import type { DynamicViewEvent } from './dynamicViewEvents';

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    if (!['.ts', '.tsx'].includes(extname(entry.name))) return [];
    return entry.name.includes('.test.') ? [] : [path];
  });
}

const surface = sourceFiles('src/analytics').map((path) => ({
  path,
  source: readFileSync(join(ROOT, path), 'utf8'),
}));

describe('the module sends nothing and schedules nothing', () => {
  test('it has files, so the sweep below is not vacuous', () => {
    expect(surface.length).toBeGreaterThan(0);
  });

  test.each(['fetch', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'import('])(
    'no file reaches the network via %s',
    (api) => {
      const offenders = surface.filter((file) => file.source.includes(api)).map((f) => f.path);
      expect(offenders).toEqual([]);
    },
  );

  test.each(['useMutation', 'useAction', 'useConvex', 'ConvexReactClient', 'ConvexHttpClient'])(
    'no file can write to Convex via %s',
    (api) => {
      // A reporting mutation would not extend FR-O009's read-only guarantee, it would be a hole
      // in it — which is the reason the default sink discards rather than sends.
      expect(surface.filter((file) => file.source.includes(api))).toEqual([]);
    },
  );

  test.each(['setInterval', 'setTimeout', 'requestAnimationFrame'])(
    'no file schedules recurring work via %s',
    (api) => {
      // Watching the map must schedule no work it did not already schedule. A batching timer is
      // the obvious thing a sink grows, and it would arrive here first.
      const offenders = surface.filter((file) => new RegExp(`\\b${api}\\b`).test(file.source));
      expect(offenders.map((f) => f.path)).toEqual([]);
    },
  );

  test.each(['localStorage', 'sessionStorage', 'document.cookie', 'navigator.userAgent', 'crypto'])(
    'no file creates a viewer identifier via %s',
    (api) => {
      // AC#3: personal tracking must not widen. A generated id persisted anywhere IS a viewer
      // identifier however it is described, so the storage APIs are refused outright.
      expect(surface.filter((file) => file.source.includes(api)).map((f) => f.path)).toEqual([]);
    },
  );
});

describe('the emitter', () => {
  afterEach(resetAnalyticsSink);

  test('the shipped default discards', () => {
    // The delivered behaviour: shipping ART-140 changes no network behaviour at all, because
    // there is no compliant sink to change it to. ART-47 owns building one.
    expect(noopAnalyticsSink({ name: 'live_view_opened', payload: {} })).toBeUndefined();
  });

  test('an installed sink receives the event, sanitised', () => {
    const received: DynamicViewEvent[] = [];
    setAnalyticsSink((event) => received.push(event));
    emitDynamicViewEvent('live_character_selected', {
      worldId: 'mistwood',
      characterId: 'he-jun',
      privateGoal: 'never leaves this object',
    });
    expect(received).toEqual([
      { name: 'live_character_selected', payload: { worldId: 'mistwood', characterId: 'he-jun' } },
    ]);
  });

  test('sanitisation happens at the emitter, so no call site can bypass it', () => {
    // The structural half of AC#2. If sanitising were the caller's job it would be a discipline;
    // here it is the only path to a sink, and a sink ART-47 installs inherits it without having
    // to know it exists.
    const received: DynamicViewEvent[] = [];
    setAnalyticsSink((event) => received.push(event));
    emitDynamicViewEvent('live_view_opened', { secretContents: 'x', worldId: 'mistwood' });
    expect(received[0].payload).toEqual({ worldId: 'mistwood' });
  });

  test('an unknown event name is dropped rather than forwarded', () => {
    const received: DynamicViewEvent[] = [];
    setAnalyticsSink((event) => received.push(event));
    emitDynamicViewEvent('not_an_event', { worldId: 'mistwood' });
    expect(received).toEqual([]);
  });

  test('a sink that throws does not take the page down with it', () => {
    // Analytics is the least important thing on the page. A viewer losing the live map because
    // a telemetry call failed would be a far worse defect than a missing event — the same way
    // `liveViewSession` fails open for a remembered camera.
    setAnalyticsSink(() => {
      throw new Error('collector unreachable');
    });
    expect(() => emitDynamicViewEvent('live_view_opened', { worldId: 'mistwood' })).not.toThrow();
  });
});

describe('the camera namespace prefixes match the real ones', () => {
  test('the restated prefixes agree with `liveMapRoute`, which owns them', () => {
    // `clientAnalytics` depends on nothing, so the prefixes are restated rather than imported.
    // A restatement that drifted would emit nothing at all — silently, since a focus id that
    // matches no prefix is simply ignored — so it is pinned against the real constructors.
    expect(characterTargetId('he-jun')).toBe(`${ANALYTICS_CHARACTER_PREFIX}he-jun`);
    expect(sceneTargetId('7:evening:mistwood-mill'))
      .toBe(`${ANALYTICS_SCENE_PREFIX}7:evening:mistwood-mill`);
    expect(TOWN_TARGET_ID).toBe(ANALYTICS_TOWN_TARGET_ID);
  });
});
