/**
 * Proof that no camera or navigation operation can send a command (ART-118, FR-O001 AC#4).
 *
 * `src/components/live/` is the one client module that deliberately carries
 * click handlers: pan, zoom, focus, auto-follow and return-to-town all have to
 * be operable, and putting them here rather than on the canvas is what keeps
 * `src/components/world/` structurally handler-free (see
 * `readOnlyWorldSurface.test.ts`). That makes this the module where "a viewer's
 * camera cannot reach the world" needs its own proof.
 *
 * A behavioural test cannot prove the absence of a request -- it can only show
 * that the interactions it happened to exercise made none. So the proof is
 * structural: every shipped file in the module is read, and the API surface any
 * write or request would have to travel through is looked for by name. A future
 * control that fetches something fails this whether or not anyone wrote a test
 * for it.
 *
 * Two other gates cover the same claim from different directions, on purpose:
 * `architecture/module-boundaries.json` already applies `readOnlyClientBoundary`
 * to the whole of `src` (so the write symbols are refused at build time), and
 * `clientLive`'s declared dependencies stop this module reaching Canon,
 * Simulation, Story or Operations at all. This suite is the product-side
 * evidence, and additionally covers the affordance-level rules the boundary
 * policy has no opinion about.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const ROOT = process.cwd();
const LIVE_ROOT = 'src/components/live';

/** Every shipped (non-test) source file in the module. */
function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    if (!['.ts', '.tsx'].includes(extname(entry.name))) return [];
    return entry.name.includes('.test.') ? [] : [path];
  });
}

const surface = sourceFiles(LIVE_ROOT).map((path) => ({
  path,
  source: readFileSync(join(ROOT, path), 'utf8'),
}));

function fileNamed(name: string): string {
  const file = surface.find((entry) => entry.path.endsWith(`/${name}`));
  expect(file).toBeDefined();
  return file!.source;
}

/**
 * Kept in sync by hand with `readOnlyClientBoundary.forbiddenSymbols` in
 * `architecture/module-boundaries.json`. No file in this module carries an
 * exemption, so the list is used whole.
 */
const WRITE_APIS = [
  'useMutation',
  'useAction',
  'useConvex',
  'ConvexHttpClient',
  'ConvexReactClient',
  'ConvexClient',
  'BaseConvexClient',
  'useSendInput',
  'useWorldHeartbeat',
  'useServerGame',
  'insertInput',
  'sendWorldInput',
];

/** Anything that could put a byte on the wire, whatever it claims to be doing. */
const REQUEST_APIS = [
  'fetch',
  'XMLHttpRequest',
  'sendBeacon',
  'WebSocket',
  'EventSource',
  'useQuery',
  'useMutation',
  'useAction',
];

describe('the live map surface (FR-O001 AC#4)', () => {
  test('covers the page, the camera chrome and the fallback', () => {
    const paths = surface.map((file) => file.path);
    expect(paths).toContain(`${LIVE_ROOT}/LiveMapPage.tsx`);
    expect(paths).toContain(`${LIVE_ROOT}/LiveMapView.tsx`);
    expect(paths).toContain(`${LIVE_ROOT}/CameraControls.tsx`);
    expect(paths).toContain(`${LIVE_ROOT}/LiveMapFallback.tsx`);
    expect(paths).toContain(`${LIVE_ROOT}/liveMapRoute.ts`);
    // ART-119 (FR-O002) put a sixty-times-a-second clock and an image decoder in
    // this module. Both are the kind of thing that grows a network call, so they
    // are named here to make it explicit that the sweeps below cover them.
    expect(paths).toContain(`${LIVE_ROOT}/useMotionClock.ts`);
    expect(paths).toContain(`${LIVE_ROOT}/spriteAssets.ts`);
    expect(paths).toContain(`${LIVE_ROOT}/useSpriteAssets.ts`);
    // ART-121 (FR-O013) added replay playback, a session tracker that touches browser
    // storage, and the controls that drive them. Named here so the sweeps below visibly
    // cover them rather than covering them by accident of directory listing.
    expect(paths).toContain(`${LIVE_ROOT}/replayPlayback.ts`);
    expect(paths).toContain(`${LIVE_ROOT}/replaySession.ts`);
    expect(paths).toContain(`${LIVE_ROOT}/ReplayControls.tsx`);
    expect(paths).toContain(`${LIVE_ROOT}/TimeStateBanner.tsx`);
    expect(paths).toContain(`${LIVE_ROOT}/timeStateLabel.ts`);
  });

  test('the replay chrome is a local state change too (FR-O013 AC#6/#8)', () => {
    // ART-121 added a third interactive surface to this module. Same proof CameraControls
    // and ActiveScenePanel carry: skipping a replay or asking for another is a `useState`
    // setter one component up, and watching history must never be able to make the world
    // produce more of it.
    const controls = fileNamed('ReplayControls.tsx');
    expect(REQUEST_APIS.filter((api) => new RegExp(`\\b${api}\\b`).test(controls))).toEqual([]);
    expect(controls).not.toMatch(/\bhref\s*=/);
    for (const label of ['跳過重播', '重播今日事件']) expect(controls).toContain(label);
  });

  test('the replay session tracker uses sessionStorage only, and never the network', () => {
    // `localStorage` would outlive the viewing session AC#5 is about and suppress a replay
    // the viewer never saw. Asserted on the code with comments stripped, since the module
    // header explains the rejection and therefore names the rejected API.
    const session = fileNamed('replaySession.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(REQUEST_APIS.filter((api) => new RegExp(`\\b${api}\\b`).test(session))).toEqual([]);
    expect(session).not.toMatch(/\blocalStorage\b/);
    expect(session).toContain('sessionStorage');
  });

  test('the replay playback machine is pure: no React, no clock, no network', () => {
    const playback = fileNamed('replayPlayback.ts');
    expect(REQUEST_APIS.filter((api) => new RegExp(`\\b${api}\\b`).test(playback))).toEqual([]);
    expect(playback).not.toContain('Date.now');
    expect(playback).not.toContain("from 'react'");
    // No timer of its own: playback advances because the existing rAF clock re-evaluates it.
    expect(playback).not.toMatch(/\b(setTimeout|setInterval|requestAnimationFrame)\b/);
  });

  test('the animation clock reads a clock and nothing else', () => {
    // The heart of FR-O002's half of AC#4: the map now animates continuously, and
    // that must not turn watching into polling. `motionClock.dom.test.tsx`
    // asserts the same at runtime over sixty frames.
    const clock = fileNamed('useMotionClock.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const api of [...REQUEST_APIS, 'convex']) {
      expect(clock).not.toMatch(new RegExp(`\\b${api}\\b`, 'i'));
    }
    // The one thing it may read.
    expect(clock).toContain('Date.now()');
  });

  test('the sprite loader decodes a bundled asset rather than requesting one', () => {
    const loader = fileNamed('spriteAssets.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const api of REQUEST_APIS) {
      expect(loader).not.toMatch(new RegExp(`\\b${api}\\b`));
    }
    // The texture is a build-time constant from `data/`, so its URL cannot be
    // steered anywhere by a viewer or by world state.
    expect(loader).toContain('CHARACTER_TEXTURE_URL');
  });

  test('the sprite roster comes from data/, never from convex/visual', () => {
    // The disqualifying case, stated as a test. `convex/visual/mistwoodVisualBindings.ts`
    // imports `convex/canon/mistwoodSeed.ts`, which carries `privateProfile`,
    // `privateGoal`, `fear` and `secretContents` for all twelve residents. An
    // import of `visual` from here would put every one of them a bundler decision
    // away from the browser -- which is why `clientLive.mayDependOn` does not list
    // `visual` and must not be widened to.
    // Comments stripped: `LiveMapPage.tsx`'s doc block explains this rule and so
    // names the modules it forbids, the same way `liveMapRoute.ts`'s does below.
    const offenders = surface.flatMap((file) =>
      ['convex/visual', 'convex/canon', 'mistwoodSeed', 'mistwoodVisualBindings']
        .filter((module) =>
          file.source
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '')
            .includes(module),
        )
        .map((module) => `${file.path}: ${module}`),
    );
    expect(offenders).toEqual([]);
    expect(fileNamed('LiveMapPage.tsx')).toContain("from '../../../data/mistwoodCharacters'");
  });

  test('reaches no mutation, action or world-input API anywhere', () => {
    const offenders = surface.flatMap((file) =>
      WRITE_APIS.filter((api) => new RegExp(`\\b${api}\\b`).test(file.source)).map(
        (api) => `${file.path}: ${api}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  test('offers no join, move, chat, interact, accept, reject or leave affordance', () => {
    const retiredActions = [
      'InteractButton',
      'FreezeButton',
      'startConversation',
      'acceptInvite',
      'rejectInvite',
      'leaveConversation',
      'joinWorld',
      'leaveWorld',
      'moveTo',
    ];
    const offenders = surface.flatMap((file) =>
      retiredActions
        .filter((action) => new RegExp(`\\b${action}\\b`).test(file.source))
        .map((action) => `${file.path}: ${action}`),
    );
    expect(offenders).toEqual([]);
  });

  test('every camera control is a local state change: the chrome can issue no request', () => {
    // The heart of AC#4. `CameraControls.tsx` holds every button a viewer can
    // press on the live map, and it names no way to talk to anything: each
    // handler calls `onModeChange`, which is a `useState` setter one component
    // up. Panning, zooming, focusing and toggling auto-follow therefore cannot
    // produce network traffic of any kind, let alone a control command.
    const controls = fileNamed('CameraControls.tsx');
    const offenders = REQUEST_APIS.filter((api) => new RegExp(`\\b${api}\\b`).test(controls));
    expect(offenders).toEqual([]);
    // ...and its only outward-facing prop is the state setter.
    expect(controls).toContain('onModeChange');
    expect(controls).not.toMatch(/\bhref\s*=/);
  });

  test('the active scene panel can issue no request either (FR-O003 / ART-122 AC#3)', () => {
    // ART-122 added a second interactive surface to this module, so it needs the same proof
    // CameraControls carries: focusing a scene is a `useState` setter one component up, and
    // looking at a scene must never be able to make the world produce one.
    const panel = fileNamed('ActiveScenePanel.tsx');
    expect(REQUEST_APIS.filter((api) => new RegExp(`\\b${api}\\b`).test(panel))).toEqual([]);
    expect(panel).toContain('onModeChange');
    // Unlike CameraControls it does carry an `href` — the Episode deep link AC#5 asks for.
    // That is an ordinary same-origin navigation, not a request this page issues.
    expect(panel).toMatch(/href=\{scene\.episodeHref\}/);
  });

  test('the scene panel model is pure: no React, no clock, no network', () => {
    const model = fileNamed('activeSceneModel.ts');
    expect(REQUEST_APIS.filter((api) => new RegExp(`\\b${api}\\b`).test(model))).toEqual([]);
    expect(model).not.toContain('Date.now');
    expect(model).not.toContain('from \'react\'');
  });

  test('reading is confined to the page, and to two named public queries', () => {
    const page = fileNamed('LiveMapPage.tsx');
    expect(page).toContain('useQuery');
    // Both reads are named explicitly rather than counted loosely: the count is what stops a
    // third read appearing, and the names are what stop one of these two being swapped for
    // something else while the count stays right. ART-121 (FR-O013) added the replay read as
    // a second query on purpose — it is failure-isolated from the projection, so folding it
    // into that payload would let a replay-build failure blank the live map.
    expect(page).toContain('getPublicDynamicProjectionRef');
    expect(page).toContain('getPublicVisualReplayRef');
    expect(page.match(/\buseQuery\(/g)).toHaveLength(2);

    // No other file in the module reads anything at all.
    const readers = surface
      .filter((file) => !file.path.endsWith('/LiveMapPage.tsx'))
      .flatMap((file) =>
        REQUEST_APIS.filter((api) => new RegExp(`\\b${api}\\b`).test(file.source)).map(
          (api) => `${file.path}: ${api}`,
        ),
      );
    expect(readers).toEqual([]);
  });

  test('mounts no polling timer, so watching the map schedules no backend work', () => {
    for (const file of surface) {
      expect(file.source).not.toMatch(/\bsetInterval\b/);
      expect(file.source).not.toMatch(/heartbeat\s*\(/i);
    }
  });

  test('the canvas itself stays mute: no pointer handler is added to the renderer', () => {
    // The controls are DOM buttons *beside* the canvas. If a future change moved
    // them onto it, this module would start passing a handler into
    // `components/world/`, which is the one thing that module forbids.
    const view = fileNamed('LiveMapView.tsx');
    const readOnlyWorldProps = /<ReadOnlyWorld([\s\S]*?)\/>/.exec(view)?.[1] ?? '';
    expect(readOnlyWorldProps.length).toBeGreaterThan(0);
    expect(readOnlyWorldProps).not.toMatch(/\bon[A-Z]/);
    expect(readOnlyWorldProps).not.toMatch(/\b(pointer|click|tap|mouse)/i);
  });

  test('the route module is pure, so both the map and the public pages can link through it', () => {
    // Comments are stripped so prose *about* the browser globals is never
    // mistaken for a use of them -- the module's doc block names both.
    const route = fileNamed('liveMapRoute.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(route).not.toMatch(/^import\b/m);
    // `import.meta.env` is inlined by Vite and invisible to Jest; the base path
    // is a parameter precisely so this module stays testable.
    expect(route).not.toContain('import.meta');
    expect(route).not.toContain('window.');
    expect(route).not.toContain('document.');
  });
});
