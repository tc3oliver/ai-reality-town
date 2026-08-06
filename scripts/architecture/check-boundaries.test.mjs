import assert from 'node:assert/strict';
import test from 'node:test';
import { extractImports, loadPolicy, moduleForPath, validateImport, validatePolicy } from './check-boundaries.mjs';

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

test('static, type, re-export, and dynamic imports are discovered', () => {
  assert.deepEqual(extractImports("import type { A } from './a'; export { B } from './b'; import('./c')"), ['./a', './b', './c']);
});
