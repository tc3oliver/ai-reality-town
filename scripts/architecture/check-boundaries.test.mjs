import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractImports,
  loadPolicy,
  moduleForPath,
  validateImport,
  validatePolicy,
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

test('static, type, re-export, and dynamic imports are discovered', () => {
  assert.deepEqual(extractImports("import type { A } from './a'; export { B } from './b'; import('./c')"), ['./a', './b', './c']);
});
