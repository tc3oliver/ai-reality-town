import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  extractClientReachableRegistrations,
  extractImports,
  loadPolicy,
  moduleForPath,
  validateCanonWriteBoundarySource,
  validateImport,
  validatePolicy,
  validateForbiddenHttpActions,
  validatePublicFunctionSurface,
  validateReadOnlyClientSource,
  validateViewerWritePolicy,
  validateViewerWriteSources,
  validateAnalyticsWritePolicy,
  validateAnalyticsWriteSources,
} from './check-boundaries.mjs';

const policy = loadPolicy();

test('policy declares every required PRD module', () => {
  assert.deepEqual(validatePolicy(policy), []);
  assert.equal(moduleForPath('convex/recaps/model.ts', policy), 'editorial');
  assert.equal(moduleForPath('convex/canon/model.ts', policy), 'canon');
});

test('allowed dependency direction passes', () => {
  assert.deepEqual(validateImport({ sourcePath: 'convex/story/model.ts', specifier: '../shared/ids', policy }), []);
});

test('presentation cannot import simulation', () => {
  assert.match(
    validateImport({ sourcePath: 'convex/publicRead/query.ts', specifier: '../simulation/workflow', policy })[0],
    /publicRead may not depend on simulation/,
  );
});

test('canon cannot depend on projections', () => {
  assert.match(
    validateImport({ sourcePath: 'convex/canon/reducer.ts', specifier: '../story/model', policy })[0],
    /canon may not depend on story/,
  );
});

test('visual binding may read Canon but Canon may not read map geometry', () => {
  assert.equal(moduleForPath('convex/visual/locationVisualBinding.ts', policy), 'visual');
  assert.deepEqual(
    validateImport({
      sourcePath: 'convex/visual/mistwoodLocationBindings.ts',
      specifier: '../canon/mistwoodSeed',
      policy,
    }),
    [],
  );
  assert.match(
    validateImport({
      sourcePath: 'convex/canon/reducer.ts',
      specifier: '../visual/locationVisualBinding',
      policy,
    })[0],
    /canon may not depend on visual/,
  );
});

test('visual runtime may read visual bindings but not Canon', () => {
  assert.equal(moduleForPath('convex/visualRuntime/visualSyncPlanner.ts', policy), 'visualRuntime');
  assert.deepEqual(
    validateImport({
      sourcePath: 'convex/visualRuntime/visualSyncPlanner.ts',
      specifier: '../visual/locationVisualBinding',
      policy,
    }),
    [],
  );
  assert.match(
    validateImport({
      sourcePath: 'convex/visualRuntime/visualSyncPlanner.ts',
      specifier: '../canon/model',
      policy,
    })[0],
    /visualRuntime may not depend on canon/,
  );
});

test('a module outside the Canon write boundary cannot import a Canon write path', () => {
  const errors = validateImport({
    sourcePath: 'convex/visualRuntime/visualSyncPlanner.ts',
    specifier: '../canon/commit',
    policy,
  });
  assert.match(errors.join('\n'), /may not import Canon write path convex\/canon\/commit\.ts/);
  assert.match(
    validateImport({
      sourcePath: 'src/components/public/LiveView.tsx',
      specifier: '../../../convex/canon/characterSeed',
      policy,
    }).join('\n'),
    /may not import Canon write path convex\/canon\/characterSeed\.ts/,
  );
});

test('Canon write boundary rejects write symbols at the source level', () => {
  assert.match(
    validateCanonWriteBoundarySource({
      sourcePath: 'convex/visualRuntime/visualSyncPlanner.ts',
      source: 'export const publish = internalMutation({});',
      policy,
    })[0],
    /may not reference 'internalMutation'/,
  );
  // The dots in a symbol are literal, not a regex wildcard.
  assert.match(
    validateCanonWriteBoundarySource({
      sourcePath: 'convex/visualRuntime/visualSyncPlanner.ts',
      source: 'await ctx.db.insert("positions", unit);',
      policy,
    })[0],
    /may not reference 'ctx\.db\.insert'/,
  );
  assert.deepEqual(
    validateCanonWriteBoundarySource({
      sourcePath: 'convex/visualRuntime/visualSyncPlanner.ts',
      source: 'const at = ctxAdbAinsert;',
      policy,
    }),
    [],
  );
  assert.deepEqual(
    validateCanonWriteBoundarySource({
      sourcePath: 'convex/visualRuntime/visualSyncPlanner.ts',
      source: 'export function planCharacterTrajectories(input) { return input; }',
      policy,
    }),
    [],
  );
  // Canon itself is inside the boundary and is none of this rule's business.
  assert.deepEqual(
    validateCanonWriteBoundarySource({
      sourcePath: 'convex/canon/commit.ts',
      source: 'await ctx.db.insert("canonEvents", event);',
      policy,
    }),
    [],
  );
});

test('provider packages are isolated to adapter roots', () => {
  assert.match(
    validateImport({ sourcePath: 'convex/story/classifier.ts', specifier: 'openai', policy })[0],
    /only allowed inside an adapter root/,
  );
  assert.deepEqual(
    validateImport({ sourcePath: 'convex/simulation/providers/openaiCompatible.ts', specifier: 'openai', policy }),
    [],
  );
  assert.match(
    validateImport({
      sourcePath: 'convex/simulation/workflow.ts',
      specifier: './providers/openaiCompatible',
      policy,
    })[0],
    /provider adapters may only be imported from within an adapter root/,
  );
});

test('read-only client components cannot reach simulation or canon', () => {
  assert.match(
    validateImport({
      sourcePath: 'src/components/world/ReadOnlyWorld.tsx',
      specifier: '../../../convex/simulation/workflow',
      policy,
    })[0],
    /clientWorldReadOnly may not depend on simulation/,
  );
  assert.match(
    validateImport({
      sourcePath: 'src/components/public/LiveView.tsx',
      specifier: '../../../convex/canon/model',
      policy,
    })[0],
    /clientPublic may not depend on canon/,
  );
  assert.deepEqual(
    validateImport({
      sourcePath: 'src/components/public/publicReadModelRef.ts',
      specifier: '../../../convex/publicRead/readModelFunctions',
      policy,
    }),
    [],
  );
});

test('read-only client surface rejects world-write symbols and allows reads', () => {
  assert.match(
    validateReadOnlyClientSource({
      sourcePath: 'src/components/world/ReadOnlyWorld.tsx',
      source: "import { useMutation } from 'convex/react';",
      policy,
    })[0],
    /may not reference world-write API 'useMutation'/,
  );
  assert.deepEqual(
    validateReadOnlyClientSource({
      sourcePath: 'src/components/public/LiveView.tsx',
      source: "import { useQuery } from 'convex/react';",
      policy,
    }),
    [],
  );
  // Files outside the declared roots are none of this rule's business.
  assert.deepEqual(
    validateReadOnlyClientSource({
      sourcePath: 'convex/operations/console.ts',
      source: 'const send = useMutation;',
      policy,
    }),
    [],
  );
});

/** Build a throwaway repo root so the surface scan can be driven against known files. */
function fixtureRoot(files) {
  const root = mkdtempSync(join(tmpdir(), 'boundary-surface-'));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return root;
}

const surfacePolicy = (allowed) => ({
  publicFunctionSurface: { scanRoots: ['convex'], forbiddenRegistrations: ['httpAction'], allowed },
});

test('the live policy declares exactly the repo\'s client-reachable surface', () => {
  assert.deepEqual(validatePublicFunctionSurface(), []);
  // Every declared public mutation is an operator control -- or one of the TWO viewer writes,
  // which `viewerWriteBoundary` fences separately: ART-45's daily ballot (FR-J001) and ART-39's
  // viewer progress record (FR-H004, PRD §13.12). Anonymous writes remain impossible: the gate is
  // spelled `viewer`, and it costs a second declaration plus a cap that has to be raised on
  // purpose. The list is exhaustive rather than counted, so a third write cannot arrive by
  // replacing one of these.
  //
  // ART-47 (§15) added `telemetry`, and the two lists below are asserted SEPARATELY on purpose.
  // Telemetry mutates no world state, so it must not be able to spend the world-mutation
  // allowance -- and the world writes must not be able to hide inside the telemetry one. A
  // single combined list would have permitted both.
  const writes = policy.publicFunctionSurface.allowed.filter((entry) => entry.kind !== 'query');
  for (const entry of writes) {
    assert.ok(
      ['operator', 'viewer', 'telemetry'].includes(entry.gate),
      `${entry.name} must be operator-, viewer- or telemetry-gated`,
    );
  }
  assert.deepEqual(
    writes.filter((entry) => entry.gate === 'telemetry').map((entry) => `${entry.path}:${entry.name}`),
    ['convex/analytics/ingestFunctions.ts:recordAnalyticsEvents'],
  );
  assert.deepEqual(
    writes.filter((entry) => entry.gate === 'viewer').map((entry) => `${entry.path}:${entry.name}`),
    [
      'convex/viewer/environmentVoteFunctions.ts:submitEnvironmentVote',
      'convex/viewer/viewerProgressFunctions.ts:recordViewerProgress',
    ],
  );
});

test('registrations are found through whatever name they are exported under', () => {
  assert.deepEqual(
    extractClientReachableRegistrations(
      "export const a = query({});\nconst b = mutation({});\nexport default b;\nexport default action({});",
    ),
    [{ name: 'a', kind: 'query' }, { name: 'b', kind: 'mutation' }, { name: 'default', kind: 'action' }],
  );
  // The internal helpers are a different surface and are none of this rule's business.
  assert.deepEqual(
    extractClientReachableRegistrations(
      'export const a = internalQuery({});\nexport const b = internalMutation({});\nexport const c = internalAction({});',
    ),
    [],
  );
});

test('an undeclared public mutation fails the build', () => {
  const root = fixtureRoot({ 'convex/init.ts': 'const init = mutation({});\nexport default init;' });
  assert.match(
    validatePublicFunctionSurface(root, surfacePolicy([])).join('\n'),
    /convex\/init\.ts: client-reachable mutation 'init' is not declared in publicFunctionSurface/,
  );
});

test('a declared public function passes', () => {
  const root = fixtureRoot({ 'convex/ops.ts': 'export const pauseWorld = mutation({});' });
  assert.deepEqual(
    validatePublicFunctionSurface(
      root,
      surfacePolicy([{ path: 'convex/ops.ts', name: 'pauseWorld', kind: 'mutation', gate: 'operator' }]),
    ),
    [],
  );
});

test('an httpAction is rejected outright, declared or not', () => {
  const root = fixtureRoot({ 'convex/http.ts': 'export const hook = httpAction(async () => {});' });
  assert.match(
    validatePublicFunctionSurface(root, surfacePolicy([])).join('\n'),
    /'hook' registers a forbidden httpAction/,
  );
  assert.match(
    validatePublicFunctionSurface(
      root,
      surfacePolicy([{ path: 'convex/http.ts', name: 'hook', kind: 'action', gate: 'operator' }]),
    ).join('\n'),
    /'hook' registers a forbidden httpAction/,
  );
});

test('an httpAction bound inline inside http.route() is caught, though it names no variable', () => {
  // The idiomatic Convex spelling, and the exact shape of the unauthenticated webhook
  // FR-O009 deleted. It assigns to nothing, so the registration-extraction regex cannot
  // see it -- which is why the ban is enforced a second time, on the identifier alone.
  const inline = [
    "import { httpRouter } from 'convex/server';",
    'const http = httpRouter();',
    "http.route({ path: '/hook', method: 'POST', handler: httpAction(async (ctx, req) => { await ctx.runMutation(api.x.y, {}); }) });",
    'export default http;',
  ].join('\n');
  assert.deepEqual(extractClientReachableRegistrations(inline), []);
  const root = fixtureRoot({ 'convex/http.ts': inline });
  assert.deepEqual(validatePublicFunctionSurface(root, surfacePolicy([])), []);
  assert.match(
    validateForbiddenHttpActions(root, surfacePolicy([])).join('\n'),
    /convex\/http\.ts: 'httpAction' is forbidden anywhere under a scanned root/,
  );
});

test('the identifier ban is blunt: any httpAction call shape is a violation, and only that', () => {
  const cases = {
    'convex/a.ts': 'export const hook = httpAction(async () => {});',
    'convex/b.ts': 'const routes = [{ handler: httpAction(async () => {}) }];',
    'convex/c.ts': 'export default httpAction (async () => {});',
  };
  for (const [path, source] of Object.entries(cases)) {
    assert.match(
      validateForbiddenHttpActions(fixtureRoot({ [path]: source }), surfacePolicy([])).join('\n'),
      new RegExp(`${path.replace('.', '\\.')}: 'httpAction' is forbidden`),
      path,
    );
  }
  // Prose about `httpAction` is not a registration -- convex/http.ts documents the ban.
  assert.deepEqual(
    validateForbiddenHttpActions(
      fixtureRoot({ 'convex/http.ts': '/** No `httpAction` may be added here. */\nexport default httpRouter();' }),
      surfacePolicy([]),
    ),
    [],
  );
});

test('the live repository registers no httpAction in any shape', () => {
  assert.deepEqual(validateForbiddenHttpActions(), []);
});

test('a registration in any extension the Convex bundler accepts is scanned', () => {
  // Convex accepts .js .mjs .cjs .jsx .ts .tsx .mts .cts as entry points. A file the
  // scanner skipped would deploy a public function that no gate had ever seen.
  for (const name of ['ops.cjs', 'ops.mts', 'ops.cts', 'ops.jsx', 'ops.mjs']) {
    const root = fixtureRoot({ [`convex/${name}`]: 'export const sneak = mutation({});' });
    assert.match(
      validatePublicFunctionSurface(root, surfacePolicy([])).join('\n'),
      new RegExp(`convex/${name.replace('.', '\\.')}: client-reachable mutation 'sneak' is not declared`),
      name,
    );
  }
  // A test file is still not part of the deployed surface.
  assert.deepEqual(
    validatePublicFunctionSurface(
      fixtureRoot({ 'convex/ops.test.ts': 'export const sneak = mutation({});' }),
      surfacePolicy([]),
    ),
    [],
  );
});

test('a stale allowlist entry fails the build too', () => {
  const root = fixtureRoot({ 'convex/ops.ts': 'export const stillHere = query({});' });
  assert.match(
    validatePublicFunctionSurface(
      root,
      surfacePolicy([
        { path: 'convex/ops.ts', name: 'stillHere', kind: 'query', gate: 'operator' },
        { path: 'convex/music.ts', name: 'getBackgroundMusic', kind: 'query', gate: 'anonymous' },
      ]),
    ).join('\n'),
    /declares query convex\/music\.ts:getBackgroundMusic, which no longer exists/,
  );
});

test('a declaration whose kind drifted from the registration fails the build', () => {
  const root = fixtureRoot({ 'convex/ops.ts': 'export const pauseWorld = mutation({});' });
  assert.match(
    validatePublicFunctionSurface(
      root,
      surfacePolicy([{ path: 'convex/ops.ts', name: 'pauseWorld', kind: 'query', gate: 'operator' }]),
    ).join('\n'),
    /is declared as a query but registers a mutation/,
  );
});

test('policy validation rejects an anonymous public mutation', () => {
  const broken = structuredClone(policy);
  broken.publicFunctionSurface.allowed.push({
    path: 'convex/operations/opsConsoleFunctions.ts', name: 'joinWorld', kind: 'mutation', gate: 'anonymous',
  });
  assert.match(validatePolicy(broken).join('\n'), /public mutation .*joinWorld must be operator-gated/);
});

test('the read-only boundary now covers the whole shipped client', () => {
  // ART-128 / FR-O009 GAP 3: the app shell and the shared buttons used to sit outside
  // the boundary, so a write could be added to the shipped bundle without tripping it.
  for (const path of ['src/App.tsx', 'src/main.tsx', 'src/components/buttons/Button.tsx']) {
    assert.match(
      validateReadOnlyClientSource({ sourcePath: path, source: 'const send = useMutation(ref);', policy })[0],
      /may not reference world-write API 'useMutation'/,
    );
  }
  // The dev-only level editor is a separate Vite root and is not shipped.
  assert.deepEqual(
    validateReadOnlyClientSource({ sourcePath: 'src/editor/le.js', source: 'const x = useMutation;', policy }),
    [],
  );
});

test('the live map module is inside every client boundary it needs to be', () => {
  // ART-118 / FR-O001 AC#4. `src/components/live/` is the one client module with
  // click handlers, so it is also the one where "a camera operation cannot write"
  // has to be enforced rather than reviewed.
  assert.equal(moduleForPath('src/components/live/CameraControls.tsx', policy), 'clientLive');
  // The pure route module is its own owner, so the public pages can link through
  // it without `clientPublic` having to depend on the whole live map.
  assert.equal(moduleForPath('src/components/live/liveMapRoute.ts', policy), 'clientLiveRoute');
  assert.deepEqual(
    validateImport({
      sourcePath: 'src/components/public/helpRoute.ts',
      specifier: '../live/liveMapRoute',
      policy,
    }),
    [],
  );
  // ...and not through anything else in the live module.
  assert.match(
    validateImport({
      sourcePath: 'src/components/public/Homepage.tsx',
      specifier: '../live/LiveMapPage',
      policy,
    })[0],
    /clientPublic may not depend on clientLive/,
  );
  // The camera cannot reach the simulation, Canon, or a write API.
  assert.match(
    validateImport({
      sourcePath: 'src/components/live/LiveMapPage.tsx',
      specifier: '../../../convex/simulation/workflow',
      policy,
    })[0],
    /clientLive may not depend on simulation/,
  );
  assert.match(
    validateReadOnlyClientSource({
      sourcePath: 'src/components/live/CameraControls.tsx',
      source: 'const focus = useMutation(ref);',
      policy,
    })[0],
    /may not reference world-write API 'useMutation'/,
  );
  // The pure route module may depend on nothing at all.
  assert.match(
    validateImport({
      sourcePath: 'src/components/live/liveMapRoute.ts',
      specifier: '../public/PublicPageFrame',
      policy,
    })[0],
    /clientLiveRoute may not depend on clientPublic/,
  );
  // Reading the published projection is exactly what it is allowed to do.
  assert.deepEqual(
    validateImport({
      sourcePath: 'src/components/live/publicDynamicRef.ts',
      specifier: '../../../convex/publicRead/liveStateFunctions',
      policy,
    }),
    [],
  );
});

test('the client provider may construct a client but still may not write', () => {
  const provider = 'src/components/ConvexClientProvider.tsx';
  assert.deepEqual(
    validateReadOnlyClientSource({
      sourcePath: provider,
      source: "const client = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);",
      policy,
    }),
    [],
  );
  // The exemption is scoped to client construction; issuing a write is still refused.
  assert.match(
    validateReadOnlyClientSource({ sourcePath: provider, source: 'const send = useMutation(ref);', policy })[0],
    /may not reference world-write API 'useMutation'/,
  );
  // And no other file may construct one.
  assert.match(
    validateReadOnlyClientSource({ sourcePath: 'src/App.tsx', source: 'new ConvexReactClient(url);', policy })[0],
    /may not reference world-write API 'ConvexReactClient'/,
  );
});

test('static, type, re-export, and dynamic imports are discovered', () => {
  assert.deepEqual(extractImports("import type { A } from './a'; export { B } from './b'; import('./c')"), ['./a', './b', './c']);
});

// --- the viewer write gate (ART-45 / FR-J001) --------------------------------
//
// PRD 1.0 §5.1 G11 requires a daily viewer ballot; PRD 2.0 §22.16 requires that public VIEWING
// never mutates. Both hold only if the second is proven per surface rather than by a blanket ban
// on anonymous writes. These tests are what gives "per surface" teeth: they show the gate admits
// exactly one thing, that every way of widening it fails, and that everything the blanket ban
// used to protect is still protected by the same check.

test('the live policy passes every viewer-write rule', () => {
  assert.deepEqual(validateViewerWritePolicy(policy), []);
  assert.deepEqual(validateViewerWriteSources(), []);
});

test('a viewer gate without a viewerWriteBoundary declaration fails', () => {
  // Two declarations in two places, on purpose. Opening a viewer write must not be one word.
  const broken = structuredClone(policy);
  broken.publicFunctionSurface.allowed.push({
    path: 'convex/viewer/environmentVoteFunctions.ts', name: 'submitAnythingElse', kind: 'mutation', gate: 'viewer',
  });
  assert.match(
    validatePolicy(broken).join('\n'),
    /submitAnythingElse is not declared in viewerWriteBoundary\.allowed/,
  );
});

test('one more viewer mutation than the cap allows is refused even when fully declared', () => {
  // ART-39 raised the cap from 1 to 2, which is what makes this test worth restating rather than
  // deleting: the property under test is not the NUMBER, it is that the cap binds. It is read off
  // the live policy so a future raise cannot make this pass by making it vacuous.
  const broken = structuredClone(policy);
  const cap = broken.viewerWriteBoundary.maxViewerMutations;
  const declared = broken.publicFunctionSurface.allowed
    .filter((entry) => entry.gate === 'viewer' && entry.kind === 'mutation').length;
  assert.equal(declared, cap, 'the live policy should sit exactly at its own cap');
  broken.publicFunctionSurface.allowed.push({
    path: 'convex/viewer/environmentVoteFunctions.ts', name: 'submitAnythingElse', kind: 'mutation', gate: 'viewer',
  });
  broken.viewerWriteBoundary.allowed.push({
    path: 'convex/viewer/environmentVoteFunctions.ts', name: 'submitAnythingElse',
  });
  assert.match(
    validateViewerWritePolicy(broken).join('\n'),
    new RegExp(`${cap + 1} viewer-gated mutations are declared; the boundary caps them at ${cap}`),
  );
});

test('a viewer write outside convex/viewer is refused', () => {
  // The forbidden-symbol sweep only covers the declared roots, and every other module may reach
  // Canon, the read model or the simulation. A viewer write there would be fenced by nothing.
  const broken = structuredClone(policy);
  broken.publicFunctionSurface.allowed.push({
    path: 'convex/publicRead/readModelFunctions.ts', name: 'submitSomething', kind: 'mutation', gate: 'viewer',
  });
  broken.viewerWriteBoundary.allowed.push({
    path: 'convex/publicRead/readModelFunctions.ts', name: 'submitSomething',
  });
  assert.match(validateViewerWritePolicy(broken).join('\n'), /must live under a viewerWriteBoundary root/);
});

test('a viewer-gated action is refused outright', () => {
  // An action can reach the network and a provider. "Public reads never trigger LLM generation"
  // would stop being enforceable if a viewer could reach one.
  const broken = structuredClone(policy);
  broken.publicFunctionSurface.allowed.push({
    path: 'convex/viewer/environmentVoteFunctions.ts', name: 'runSomething', kind: 'action', gate: 'viewer',
  });
  assert.match(validateViewerWritePolicy(broken).join('\n'), /may not be an action/);
});

test('the viewer module cannot acquire its own Canon write path', () => {
  const root = mkdtempSync(join(tmpdir(), 'viewer-write-'));
  mkdirSync(join(root, 'convex/viewer'), { recursive: true });
  writeFileSync(
    join(root, 'convex/viewer/environmentVoteFunctions.ts'),
    "import { commitProposedEvent } from '../canon/commit';\nclassifyViewerInput; evaluateVoteSubmission;\n",
  );
  assert.match(
    validateViewerWriteSources(root, policy).join('\n'),
    /may not reference Canon-write symbol 'commitProposedEvent'/,
  );
});

test('a viewer write that drops its safety gate fails on ABSENCE', () => {
  // The only rule here that fails because something is MISSING. A denylist cannot see "we
  // forgot the rate limiter", and that is exactly the abuse-resistance regression worth
  // catching before it ships.
  const root = mkdtempSync(join(tmpdir(), 'viewer-unsafe-'));
  mkdirSync(join(root, 'convex/viewer'), { recursive: true });
  writeFileSync(join(root, 'convex/viewer/environmentVoteFunctions.ts'), 'export const submit = () => 1;\n');
  const errors = validateViewerWriteSources(root, policy).join('\n');
  assert.match(errors, /required safety symbol 'classifyViewerInput'/);
  assert.match(errors, /required safety symbol 'evaluateVoteSubmission'/);
});

test('a write-API exemption may only be granted inside the declared vote client root', () => {
  // The client half. `/live`, the world renderer and every public page keep the exact guarantee
  // they had before ART-45, because an exemption for them cannot even be written down.
  const broken = structuredClone(policy);
  broken.readOnlyClientBoundary.exemptFiles.push({
    path: 'src/components/live/LiveMapPage.tsx', symbols: ['useMutation'],
  });
  assert.match(
    validateViewerWritePolicy(broken).join('\n'),
    /LiveMapPage\.tsx: 'useMutation' may only be exempted under a viewerWriteBoundary or analyticsWriteBoundary clientRoot/,
  );
});

test('the telemetry client root does not widen the world-write exemption', () => {
  // ART-47 admitted a second family of client roots, and the risk it introduced is that the
  // check became an OR over a longer list -- which is exactly how a guard stops guarding. So:
  // a file under the TELEMETRY root is accepted, and every surface that was refused before is
  // still refused, and removing the telemetry boundary makes its own file fail too.
  const withTelemetry = structuredClone(policy);
  withTelemetry.readOnlyClientBoundary.exemptFiles = [{
    path: 'src/components/analytics/useAnalyticsIngest.ts', symbols: ['useMutation'],
  }];
  assert.deepEqual(
    validateViewerWritePolicy(withTelemetry).filter((error) => error.includes('useAnalyticsIngest')),
    [],
  );
  // The discriminating half. Without the telemetry boundary the same file is refused, so the
  // acceptance above is granted BY that boundary rather than by the check having gone slack.
  const withoutTelemetry = structuredClone(withTelemetry);
  delete withoutTelemetry.analyticsWriteBoundary;
  assert.match(validateViewerWritePolicy(withoutTelemetry).join('\n'), /useAnalyticsIngest\.ts: 'useMutation'/);
});

test('telemetry and world mutation cannot share a client root', () => {
  // 「viewer telemetry 與 world mutation 架構上分離」 is only true while no single file can hold
  // both exemptions. A policy that pointed both boundaries at one directory would read as if
  // the separation existed while granting one file the union of two arguments.
  const overlapping = structuredClone(policy);
  overlapping.analyticsWriteBoundary.clientRoots = ['src/components/vote'];
  assert.match(
    validateAnalyticsWritePolicy(overlapping).join('\n'),
    /overlaps a viewerWriteBoundary clientRoot/,
  );
  // Nesting counts as overlap in both directions: a subdirectory of the vote root would be
  // covered by the vote exemption too.
  overlapping.analyticsWriteBoundary.clientRoots = ['src/components/vote/telemetry'];
  assert.match(validateAnalyticsWritePolicy(overlapping).join('\n'), /overlaps/);
  assert.deepEqual(validateAnalyticsWritePolicy(policy), []);
});

test('a second telemetry mutation is refused, and one outside the module is too', () => {
  const twoWrites = structuredClone(policy);
  twoWrites.publicFunctionSurface.allowed.push({
    path: 'convex/analytics/ingestFunctions.ts', name: 'recordMoreAnalytics',
    kind: 'mutation', gate: 'telemetry',
  });
  twoWrites.analyticsWriteBoundary.allowed.push({
    path: 'convex/analytics/ingestFunctions.ts', name: 'recordMoreAnalytics',
  });
  assert.match(validateAnalyticsWritePolicy(twoWrites).join('\n'), /caps them at 1/);

  // Outside `convex/analytics` the forbidden-symbol sweep would never see it, so declaring it
  // there is refused rather than merely discouraged.
  const elsewhere = structuredClone(policy);
  elsewhere.publicFunctionSurface.allowed.push({
    path: 'convex/viewer/viewerProgressFunctions.ts', name: 'recordTelemetry',
    kind: 'mutation', gate: 'telemetry',
  });
  elsewhere.analyticsWriteBoundary.allowed.push({
    path: 'convex/viewer/viewerProgressFunctions.ts', name: 'recordTelemetry',
  });
  assert.match(
    validateAnalyticsWritePolicy(elsewhere).join('\n'),
    /must live under an analyticsWriteBoundary root/,
  );

  // And naming the gate is not enough on its own: it must be declared in BOTH places, which is
  // the same two-edits-in-two-places rule the viewer gate has.
  const undeclared = structuredClone(policy);
  undeclared.publicFunctionSurface.allowed.push({
    path: 'convex/analytics/ingestFunctions.ts', name: 'recordSomethingElse',
    kind: 'mutation', gate: 'telemetry',
  });
  assert.match(
    validatePolicy(undeclared).join('\n'),
    /is not declared in analyticsWriteBoundary\.allowed/,
  );
});

test('the telemetry module fails on ABSENCE of the shared sanitiser', () => {
  // The rule that cannot be expressed as a denylist. An ingest that never names the shared
  // sanitiser is one that trusts the client, and「我們忘記過濾了」leaves no trace to forbid.
  const root = mkdtempSync(join(tmpdir(), 'art47-'));
  mkdirSync(join(root, 'convex/analytics'), { recursive: true });
  writeFileSync(join(root, 'convex/analytics/ingestFunctions.ts'), 'export const record = () => 1;\n');
  const errors = validateAnalyticsWriteSources(root, policy).join('\n');
  assert.match(errors, /required symbol 'sanitizeAnalyticsPayload'/);
  assert.match(errors, /required symbol 'analyticsDedupeKey'/);
});

test('the telemetry module may not name a Canon writer or a forbidden payload field', () => {
  const root = mkdtempSync(join(tmpdir(), 'art47-'));
  mkdirSync(join(root, 'convex/analytics'), { recursive: true });
  writeFileSync(
    join(root, 'convex/analytics/ingestFunctions.ts'),
    'import { sanitizeAnalyticsPayload, analyticsDedupeKey } from \'../shared/analyticsContract\';\n'
    + 'export const record = (db) => db.insert(\'canonEvents\', {\n'
    + '  userAgent: navigator.userAgent,\n'
    + '  publicSummary: \'what happened\',\n'
    + '});\n',
  );
  const errors = validateAnalyticsWriteSources(root, policy).join('\n');
  assert.match(errors, /may not reference 'canonEvents'/);
  assert.match(errors, /'userAgent' may not appear as a telemetry field/);
  // Free-form narrative text is refused for the same reason a user agent is: §15 forbids it,
  // and the only durable way to keep it out is to make the field unwritable.
  assert.match(errors, /'publicSummary' may not appear as a telemetry field/);
});

test('prose about a forbidden field is not a forbidden field', () => {
  // The discriminating half of the sweep above. A docblock explaining why no user agent is
  // ever collected must not fail the check that keeps it so -- otherwise the only way to pass
  // is to stop writing down the reason, which is the opposite of what this repo wants.
  const root = mkdtempSync(join(tmpdir(), 'art47-'));
  mkdirSync(join(root, 'convex/analytics'), { recursive: true });
  writeFileSync(
    join(root, 'convex/analytics/ingestFunctions.ts'),
    '/** No userAgent, no ip and no publicSummary is ever stored here. */\n'
    + 'import { sanitizeAnalyticsPayload, analyticsDedupeKey } from \'../shared/analyticsContract\';\n'
    + 'export const record = () => [sanitizeAnalyticsPayload, analyticsDedupeKey];\n',
  );
  assert.deepEqual(validateAnalyticsWriteSources(root, policy), []);
});

test('the provider exemption is unaffected: construction is not a write', () => {
  // `ConvexReactClient` is not a write symbol, so the one pre-existing exemption is untouched
  // by the new rule -- and `useMutation` is still denied even there.
  assert.deepEqual(validateViewerWritePolicy(policy), []);
  assert.match(
    validateReadOnlyClientSource({
      sourcePath: 'src/components/ConvexClientProvider.tsx',
      source: 'const send = useMutation(ref);',
      policy,
    })[0],
    /may not reference world-write API 'useMutation'/,
  );
});

test('every client module except the vote root is still denied every write API', () => {
  for (const path of [
    'src/App.tsx',
    'src/components/public/Homepage.tsx',
    'src/components/live/LiveMapPage.tsx',
    'src/components/world/PixiStaticMap.tsx',
    'src/e2e/fixtureConvexClient.ts',
  ]) {
    assert.match(
      validateReadOnlyClientSource({ sourcePath: path, source: 'const send = useMutation(ref);', policy })[0],
      /may not reference world-write API 'useMutation'/,
      `${path} must still be denied`,
    );
  }
  // And the one exempted file is exempted for that symbol only.
  const votePath = 'src/components/vote/useEnvironmentVote.ts';
  assert.deepEqual(validateReadOnlyClientSource({ sourcePath: votePath, source: 'useMutation(ref);', policy }), []);
  assert.match(
    validateReadOnlyClientSource({ sourcePath: votePath, source: 'useAction(ref);', policy })[0],
    /may not reference world-write API 'useAction'/,
  );
});
