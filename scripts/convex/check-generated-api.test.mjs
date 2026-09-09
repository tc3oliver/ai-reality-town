/**
 * The generated-api check must fail on the drift it exists to catch (ART-153).
 *
 * The interesting cases are the SKIP RULES. This check reimplements the Convex CLI's `entryPoints()`
 * enumeration, because `npx convex codegen` contacts a deployment and AC#3 forbids that — so the
 * risk it carries is that a rule is copied wrongly and the check then agrees with a file that
 * `convex dev` would rewrite. Each rule is pinned separately here, against a fixture tree, so a
 * wrong one fails legibly rather than showing up as an unexplained diff months later.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  aliasFor,
  convexModules,
  declaredModules,
  fullApiEntries,
  GENERATED_API_PATH,
  hasTopLevelImportOrExport,
  isConvexModule,
  renderGeneratedApi,
  runCheck,
} from './check-generated-api.mjs';

/**
 * Writes `files` (paths relative to a fake `convex/`) into a fresh temp directory.
 *
 * An empty string means "an ordinary module" and is given a top-level export, because since
 * ART-170 a `.ts` file with no top-level import or export is not an entry point at all. Fixtures
 * that wrote genuinely empty files were asserting the wrong thing the moment that rule landed —
 * they described a file the CLI skips while claiming it was a module.
 */
function fixtureTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'convex-api-'));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents === '' ? 'export const placeholder = 1;\n' : contents);
  }
  return root;
}

test('a module is a JS/TS file that survives every skip rule', () => {
  assert.equal(isConvexModule('canon/commit.ts'), true);
  assert.equal(isConvexModule('http.ts'), true);
  assert.equal(isConvexModule('simulation/providers/openAICompatible.ts'), true);
});

test('schema files are skipped AT ANY DEPTH, not only at the root', () => {
  // This one rule explains why every `*/schema.ts` is legitimately absent from the checked-in file
  // — which looked like drift until the CLI's own source was read.
  assert.equal(isConvexModule('schema.ts'), false);
  assert.equal(isConvexModule('canon/schema.ts'), false);
  assert.equal(isConvexModule('viewer/schema.js'), false);
  // A file merely NAMED like one is not: the rule is on the basename.
  assert.equal(isConvexModule('canon/schemaHelpers.ts'), true);
});

test('a basename with more than one dot is skipped — which is what excludes tests and configs', () => {
  assert.equal(isConvexModule('canon/commit.test.ts'), false);
  assert.equal(isConvexModule('publicRead/liveState.a11y.test.tsx'), false);
  assert.equal(isConvexModule('auth.config.ts'), false);
  assert.equal(isConvexModule('canon/commit.ts'), true);
});

test('generated output, dotfiles, tempfiles, spaces and non-JS files are skipped', () => {
  assert.equal(isConvexModule('_generated/api.ts'), false);
  assert.equal(isConvexModule('canon/.hidden.ts'), false);
  assert.equal(isConvexModule('canon/#tempfile.ts'), false);
  assert.equal(isConvexModule('canon/two words.ts'), false);
  assert.equal(isConvexModule('canon/README.md'), false);
  assert.equal(isConvexModule('canon/notes.txt'), false);
});

test('the walk finds exactly the modules, sorted, with extensions stripped', () => {
  const root = fixtureTree({
    'canon/commit.ts': '',
    'canon/schema.ts': '',
    'canon/commit.test.ts': '',
    'aiTown/agent.ts': '',
    '_generated/api.d.ts': '',
    'auth.config.ts': '',
    'http.ts': '',
  });
  assert.deepEqual(convexModules(root), ['aiTown/agent', 'canon/commit', 'http']);
});

test('a nested component directory is skipped whole', () => {
  const root = fixtureTree({
    'canon/commit.ts': '',
    'widget/convex.config.ts': '',
    'widget/inner.ts': '',
  });
  // The component owns its own generated api; enumerating its modules here would declare them
  // twice.
  assert.deepEqual(convexModules(root), ['canon/commit']);
});

test('a file under the reserved _deps directory is an error, not a skip', () => {
  const root = fixtureTree({ '_deps/vendored.ts': '' });
  assert.throws(() => convexModules(root), /_deps/);
});

test('the alias is the path with separators replaced', () => {
  assert.equal(aliasFor('simulation/providers/openAICompatible'), 'simulation_providers_openAICompatible');
  assert.equal(aliasFor('http'), 'http');
});

test('rendering and parsing round-trip', () => {
  const modules = ['aiTown/agent', 'canon/commit', 'http'];
  assert.deepEqual(declaredModules(renderGeneratedApi(modules)), modules);
});

test('a missing module fails, naming it', () => {
  const root = fixtureTree({ 'canon/commit.ts': '', 'canon/queries.ts': '' });
  const generated = fixtureTree({ 'api.d.ts': renderGeneratedApi(['canon/commit']) });
  const { errors, missing } = runCheck(root, join(generated, 'api.d.ts'));
  assert.deepEqual(missing, ['canon/queries']);
  assert.match(errors[0], /"canon\/queries" is a Convex module but is not declared/);
});

test('a module that no longer exists fails, naming it', () => {
  // The real drift ART-153 found in both directions: 34 missing AND `simulation/queries` declared
  // for a file that had been deleted.
  const root = fixtureTree({ 'canon/commit.ts': '' });
  const generated = fixtureTree({ 'api.d.ts': renderGeneratedApi(['canon/commit', 'canon/deleted']) });
  const { errors, extra } = runCheck(root, join(generated, 'api.d.ts'));
  assert.deepEqual(extra, ['canon/deleted']);
  assert.match(errors[0], /"canon\/deleted" is declared .* but is not a module/);
});

test('the right modules in the wrong order fails, because `convex dev` would rewrite it', () => {
  const root = fixtureTree({ 'canon/commit.ts': '', 'aiTown/agent.ts': '' });
  const generated = fixtureTree({ 'api.d.ts': renderGeneratedApi(['canon/commit', 'aiTown/agent']) });
  const { errors, missing, extra } = runCheck(root, join(generated, 'api.d.ts'));
  assert.deepEqual([...missing, ...extra], []);
  assert.match(errors[0], /not in sorted order/);
});

test('an empty tree fails instead of passing vacuously', () => {
  const root = fixtureTree({ 'README.md': '' });
  const generated = fixtureTree({ 'api.d.ts': renderGeneratedApi([]) });
  const { errors } = runCheck(root, join(generated, 'api.d.ts'));
  // A walk that matched nothing would agree with any file at all. That is how a check like this
  // usually fails, so it is the one case asserted about the checker rather than the repository.
  assert.match(errors[0], /no Convex modules found/);
});

test('the repository agrees with its own generated api', () => {
  const { errors, expected } = runCheck();
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.ok(expected.length > 200, `expected the real tree to hold its modules, found ${expected.length}`);
});

/**
 * The file states its module list TWICE, and the two halves can disagree.
 *
 * These three cases exist because two injections against an imports-only check passed cleanly: a
 * stale entry added to `fullApi` alone, and the `fullApi` entries reordered. Both would have left a
 * file `convex dev` rewrites, and `fullApi` is the half that decides the shape of `api` — so the
 * imports-only check was reading the less important one.
 */
test('a `fullApi` entry with no import fails', () => {
  const root = fixtureTree({ 'canon/commit.ts': '' });
  const drifted = renderGeneratedApi(['canon/commit'])
    .replace('  "canon/commit": typeof canon_commit;',
      '  "canon/commit": typeof canon_commit;\n  "canon/deleted": typeof canon_commit;');
  const generated = fixtureTree({ 'api.d.ts': drifted });
  const { errors } = runCheck(root, join(generated, 'api.d.ts'));
  assert.ok(errors.some((error) => /"canon\/deleted" is in the generated api's `fullApi` block but is not imported/.test(error)),
    errors.join('\n'));
});

test('an import with no `fullApi` entry fails', () => {
  const root = fixtureTree({ 'canon/commit.ts': '', 'canon/queries.ts': '' });
  const drifted = renderGeneratedApi(['canon/commit', 'canon/queries'])
    .replace('  "canon/queries": typeof canon_queries;\n', '');
  const generated = fixtureTree({ 'api.d.ts': drifted });
  const { errors } = runCheck(root, join(generated, 'api.d.ts'));
  assert.ok(errors.some((error) => /"canon\/queries" is imported .* but missing from its `fullApi` block/.test(error)),
    errors.join('\n'));
});

test('the two halves listing the same modules in different orders fails', () => {
  const root = fixtureTree({ 'canon/commit.ts': '', 'canon/queries.ts': '' });
  const drifted = renderGeneratedApi(['canon/commit', 'canon/queries']).replace(
    '  "canon/commit": typeof canon_commit;\n  "canon/queries": typeof canon_queries;',
    '  "canon/queries": typeof canon_queries;\n  "canon/commit": typeof canon_commit;');
  const generated = fixtureTree({ 'api.d.ts': drifted });
  const { errors } = runCheck(root, join(generated, 'api.d.ts'));
  assert.ok(errors.some((error) => /different orders/.test(error)), errors.join('\n'));
});

test('both halves of the real file agree with each other', () => {
  const source = readFileSync(GENERATED_API_PATH, 'utf8');
  const imports = declaredModules(source);
  assert.deepEqual(fullApiEntries(source), imports);
  assert.ok(imports.length > 200, `expected the real file to declare its modules, found ${imports.length}`);
});

test('a TS entry point with no top-level import or export is skipped (ART-170)', () => {
  // The one rule that needs the file's CONTENTS. It matches nothing in this repository today, which
  // is exactly why it was easy to omit — and omitting it would make the check demand a module
  // `convex dev` excludes.
  assert.equal(hasTopLevelImportOrExport('export const x = 1;\n'), true);
  assert.equal(hasTopLevelImportOrExport("import { y } from './y';\n"), true);
  assert.equal(hasTopLevelImportOrExport('// just a note\nconst x = 1;\n'), false);

  const root = fixtureTree({
    'canon/commit.ts': 'export const commit = 1;\n',
    'canon/inert.ts': '// no top-level import or export\nconst x = 1;\n',
    // A `.js` entry point is NOT subject to the rule; only `.ts`/`.tsx` are.
    'canon/plain.js': 'const y = 2;\n',
  });
  assert.deepEqual(convexModules(root), ['canon/commit', 'canon/plain']);
});
