/**
 * Every function path the post-commit pipeline dispatches names a real export (ART-178).
 *
 * `postCommitLiveFunctions.ts` binds every stage 11-21 capability through an untyped
 * `internalFunctionRef('module/path:name')` string — the safety gate, the publication transition,
 * and every read-model rebuild. Nothing checked that any of them resolved.
 *
 * The sibling live-world-day driver has had this guard since ART-159
 * (`convex/simulation/providers/liveWorldDayWiring.test.ts`), and the reason it gives applies
 * here with more force: a path that does not resolve deploys as a runtime
 * `Could not find function` on the first accepted event, long after CI. CLAUDE.md §9 says this
 * pipeline is not failure-isolated upstream of `rebuildLiveProjection` and
 * `rebuildOnboardingSummary`, so a bad path anywhere above them stops a safety withhold from
 * reaching the public surface.
 *
 * The TypeScript generic on `internalFunctionRef<typeof someExport>` proves the module has an
 * export of that name — it does not prove the STRING points at it. Renaming the export while
 * leaving the string, or moving the module, compiles cleanly. That gap is what this file closes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SOURCE_PATH = 'convex/operations/postCommitLiveFunctions.ts';

/** Every `internalFunctionRef('…')` literal in the module, in source order. */
function dispatchedPaths(): string[] {
  const source = readFileSync(join(ROOT, SOURCE_PATH), 'utf8');
  return [...source.matchAll(/internalFunctionRef<[^>]+>\(\s*\n?\s*'([^']+)'/gu)].map(([, path]) => path);
}

describe('the post-commit pipeline dispatches only to exports that exist', () => {
  const paths = dispatchedPaths();

  it('finds a substantial set of paths, so a broken scan cannot pass vacuously', () => {
    // The way this class of check usually fails: the regex stops matching, the list is empty, and
    // every assertion below is satisfied by having nothing to check.
    expect(paths.length).toBeGreaterThan(20);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it.each(dispatchedPaths())('%s is exported by the module it names', (path) => {
    const [modulePath, name] = path.split(':');
    expect(modulePath).toBeTruthy();
    expect(name).toBeTruthy();
    const source = readFileSync(join(ROOT, 'convex', `${modulePath}.ts`), 'utf8');
    // `internal` covers `internalQuery` / `internalMutation` / `internalAction`, which is what a
    // pipeline capability always is: none of these may be a public function.
    expect(source).toContain(`export const ${name} = internal`);
  });

  it('names no PUBLIC function, because a pipeline capability must not be client-reachable', () => {
    for (const path of paths) {
      const [modulePath, name] = path.split(':');
      const source = readFileSync(join(ROOT, 'convex', `${modulePath}.ts`), 'utf8');
      for (const kind of ['query', 'mutation', 'action']) {
        expect(source).not.toContain(`export const ${name} = ${kind}(`);
      }
    }
  });
});
