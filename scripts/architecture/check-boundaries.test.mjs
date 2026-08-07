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
  // Every declared public mutation is an operator control, never an anonymous one.
  for (const entry of policy.publicFunctionSurface.allowed) {
    if (entry.kind !== 'query') assert.equal(entry.gate, 'operator', `${entry.name} must be operator-gated`);
  }
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
