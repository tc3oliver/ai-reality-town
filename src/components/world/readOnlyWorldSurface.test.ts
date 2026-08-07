/**
 * Proof that public viewing has no write path (ART-113, FR-N002 AC#2/#3/#4/#5/#7).
 *
 * A behavioural test cannot prove the *absence* of a mutation: it can only show
 * that the paths it happened to exercise did not write. So the proof is
 * structural instead -- every shipped source file on the public surface is read
 * and checked for the API surface a write would have to travel through. If a
 * future change adds one, this fails whether or not anyone wrote a test for
 * the new feature.
 *
 * `architecture/module-boundaries.json` carries the same rule for the build
 * gate (`npm run check:architecture`); this suite is the product-side
 * acceptance evidence and additionally covers the affordances -- click
 * handlers, control buttons, the non-map fallback route -- that the boundary
 * policy has no opinion about.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

import {
  liveMapHref,
  parseLiveMapPath,
  redirectForLegacyHash,
  textLiveHref,
} from '../live/liveMapRoute';
import { composeHelpViewModel } from '../public/helpRoute';

const ROOT = process.cwd();
/** What Vite exposes as `import.meta.env.BASE_URL` for `base: '/ai-town'`. */
const BASE = '/ai-town/';
/**
 * ART-128 (FR-O009) widened this from the two component directories to the whole of
 * `src`, matching `readOnlyClientBoundary` in the boundary policy. Checking only the
 * pages a visitor is shown proved the wrong thing: the app shell, the client provider
 * and the shared buttons all ship in the same bundle and were never checked.
 * `src/editor` is the dev-only level editor -- a separate Vite root, not shipped.
 */
const READ_ONLY_ROOTS = ['src'];
const EXCLUDED_ROOTS = ['src/editor'];

/** Every shipped (non-test) source file under a read-only root. */
function sourceFiles(dir: string): string[] {
  if (EXCLUDED_ROOTS.includes(dir)) return [];
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    if (!['.ts', '.tsx'].includes(extname(entry.name))) return [];
    return entry.name.includes('.test.') ? [] : [path];
  });
}

const surface = READ_ONLY_ROOTS.flatMap(sourceFiles).map((path) => ({
  path,
  source: readFileSync(join(ROOT, path), 'utf8'),
}));

const worldModule = surface.filter((file) => file.path.startsWith('src/components/world/'));

describe('read-only public surface', () => {
  test('covers the renderer and every public page', () => {
    const paths = surface.map((file) => file.path);
    expect(paths).toContain('src/components/world/ReadOnlyWorld.tsx');
    expect(paths).toContain('src/components/world/PixiStaticMap.tsx');
    expect(paths).toContain('src/components/world/Character.tsx');
    expect(paths).toContain('src/components/public/LiveView.tsx');
    // ART-119 (FR-O002) added the animated character layer. Named explicitly so
    // the sweeps below are known to reach it, rather than only reaching it by
    // accident of the directory walk.
    expect(paths).toContain('src/components/world/CharacterStateIndicator.tsx');
    expect(paths).toContain('src/components/world/characterAnimation.ts');
    expect(paths).toContain('src/components/world/renderQuality.ts');
    expect(paths).toContain('src/components/world/spriteSheetCache.ts');
    expect(paths).toContain('src/components/live/useMotionClock.ts');
    expect(paths).toContain('src/components/live/spriteAssets.ts');
    expect(paths).toContain('src/components/live/useSpriteAssets.ts');
  });

  test('the animated character layer is still structurally uninvokable', () => {
    // ART-113's proof rested on there being nothing in the character subtree that
    // could take a pointer event. ART-119 added three nodes to that subtree, so
    // the property is re-asserted against them by name.
    const animated = worldModule.filter((file) =>
      ['Character.tsx', 'CharacterStateIndicator.tsx'].some((name) => file.path.endsWith(name)),
    );
    expect(animated).toHaveLength(2);
    for (const file of animated) {
      expect(file.source).toContain('eventMode="none"');
      expect(file.source).not.toMatch(/\bon[A-Z]\w*\s*=\s*\{/);
    }
  });

  test('the sprite cache and the animation clock reach no texture by network call', () => {
    // Decoding a bundled image is local work. Fetching one would be a request the
    // renderer makes on its own initiative, which is the thing FR-O009 forbids.
    const loaders = surface.filter((file) =>
      ['spriteSheetCache.ts', 'spriteAssets.ts', 'useSpriteAssets.ts', 'useMotionClock.ts'].some(
        (name) => file.path.endsWith(name),
      ),
    );
    expect(loaders).toHaveLength(4);
    for (const file of loaders) {
      const code = file.source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const api of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon']) {
        expect(code).not.toMatch(new RegExp(`\\b${api}\\b`));
      }
    }
  });

  test('reaches no mutation, action or world-input API', () => {
    // Convex's write entry points, plus the retired a16z input helpers. A
    // mutation cannot be issued from the browser without one of these.
    //
    // Kept in sync by hand with `readOnlyClientBoundary.forbiddenSymbols` in
    // `architecture/module-boundaries.json`, minus `ConvexReactClient`: the policy
    // exempts that one symbol for `ConvexClientProvider.tsx`, and this list carries
    // no exemption machinery. `ConvexClient`/`BaseConvexClient` are the non-React
    // `convex/browser` clients -- they expose `.mutation()`/`.action()` directly, so
    // the React hooks above do not cover them.
    const writeApis = [
      'useMutation',
      'useAction',
      'useConvex',
      'ConvexHttpClient',
      'ConvexClient',
      'BaseConvexClient',
      'useSendInput',
      'useWorldHeartbeat',
      'useServerGame',
      'insertInput',
      'sendWorldInput',
    ];
    const offenders = surface.flatMap((file) =>
      writeApis
        .filter((api) => new RegExp(`\\b${api}\\b`).test(file.source))
        .map((api) => `${file.path}: ${api}`),
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

  test('renders no interactive canvas: clicks cannot reach a handler', () => {
    // Pixi delivers pointer events only to display objects that opt in. The
    // renderer opts every one of them out, so a map or sprite click has
    // nowhere to go -- it cannot set a destination it has no handler for.
    const characterSource = worldModule.find((file) => file.path.endsWith('Character.tsx'))!.source;
    const mapSource = worldModule.find((file) => file.path.endsWith('PixiStaticMap.tsx'))!.source;
    expect(characterSource).toContain('eventMode="none"');
    expect(mapSource).toContain("container.eventMode = 'none'");

    // Bindings, not prose: the comments explaining *why* these are gone name
    // the retired APIs on purpose.
    for (const file of worldModule) {
      expect(file.source).not.toMatch(/\bpointerdown\s*[:=]/);
      expect(file.source).not.toMatch(/\bonClick\s*[:=]/);
      expect(file.source).not.toMatch(/\binteractive\s*=\s*\{?true/);
    }
  });

  test('mounts no heartbeat or polling timer', () => {
    for (const file of worldModule) {
      expect(file.source).not.toMatch(/\bsetInterval\b/);
      expect(file.source).not.toMatch(/heartbeat\s*\(/i);
    }
  });

  test('keeps the text Live View reachable as the non-map fallback', () => {
    // NFR-009 AC#3 / ART-113 AC#10: the accessible equivalent of the map must
    // stay routable and linked while the renderer is refactored, so ART-135
    // extends a working baseline instead of filling a gap.
    //
    // ART-118 (FR-O001 AC#8) moved it from `#live/<worldId>` to
    // `<base>/live/<worldId>/text`, the map route's sibling. The assertions are
    // re-pointed rather than dropped, and the legacy hash gains its own test
    // below -- the guarantee gets stronger, not weaker.
    const app = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
    expect(app).toContain('parseLiveMapPath');
    expect(app).toMatch(/liveRoute\.view === 'text'/);
    expect(app).toContain('<LiveView worldId=');

    const homepage = readFileSync(join(ROOT, 'src/components/public/Homepage.tsx'), 'utf8');
    expect(homepage).toContain('vm.textLiveHref');
    expect(composeHelpViewModel({ worldId: 'mistwood', base: BASE }).textLiveHref).toBe(
      textLiveHref('mistwood', BASE),
    );
  });

  test('the retired hash route still lands a viewer on the live world', () => {
    // FR-O001 AC#8. Every link ever shared, bookmarked or printed used
    // `#live/<worldId>`; the route may move, but those must not break, and the
    // world identifier must survive the move.
    const app = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
    expect(app).toContain('redirectForLegacyHash');
    expect(app).toContain('window.location.replace');

    const target = redirectForLegacyHash('#live/mistwood', BASE);
    expect(target).toBe(liveMapHref('mistwood', BASE));
    expect(parseLiveMapPath(target!, BASE)).toEqual({ worldId: 'mistwood', view: 'map' });
    // Unrelated hashes are untouched, so the redirect cannot swallow another route.
    expect(redirectForLegacyHash('#episodes/mistwood', BASE)).toBeNull();
  });
});
