/**
 * What compression can reach (FR-E004 / ART-27 AC#1, AC#2, AC#4).
 *
 * AC#2 says compression must not change Canon and AC#1/AC#4 say it must not lose a source event
 * or a memory. `memoryCompression.test.ts` shows it does not; this shows it *cannot*, by walking
 * the real import graph and pinning the closure. The boundary checker in
 * `scripts/architecture/check-boundaries.mjs` compares declared module roots, which is coarser
 * than this needs: `knowledge` is legitimately allowed to depend on `canon`, and
 * `convex/canon/` holds the commit pipeline as well as the pure model.
 *
 * Shaped after `convex/publicRead/visualReplay.boundary.test.ts`, which does the same job for the
 * replay builder.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const ENTRY = 'convex/knowledge/memoryCompression.ts';

/** Where a write, a provider call or a scheduler would have to live. */
const FORBIDDEN_ROOTS = [
  'convex/simulation/',
  'convex/agent/',
  'convex/operations/',
  'convex/editorial/',
  'convex/observability/',
  'convex/_generated/',
];

/** Canon's write surface, named individually because `convex/canon/` also holds pure model code. */
const CANON_WRITE_PATHS = [
  'convex/canon/commit.ts',
  'convex/canon/inMemoryStore.ts',
  'convex/canon/snapshotOperations.ts',
  'convex/canon/snapshotManager.ts',
  'convex/canon/characterSeed.ts',
  'convex/canon/worldConfig.ts',
  'convex/canon/queries.ts',
  'convex/canon/schema.ts',
];

function executableSource(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function importsOf(source: string): readonly { specifier: string; typeOnly: boolean }[] {
  const pattern =
    /(?:import|export)\s+(type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  return [...source.matchAll(pattern)].map((match) => ({
    specifier: match[2] ?? match[3],
    typeOnly: match[1] !== undefined,
  }));
}

function resolveImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = normalize(join(dirname(fromFile), specifier)).split('\\').join('/');
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function closureOf(entry: string, valueOnly: boolean): string[] {
  const visited = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const { specifier, typeOnly } of importsOf(executableSource(file))) {
      if (valueOnly && typeOnly) continue;
      const target = resolveImport(file, specifier);
      if (target === null || visited.has(target)) continue;
      visited.add(target);
      queue.push(target);
    }
  }
  visited.delete(entry);
  return [...visited].sort();
}

describe('FR-E004 — compression cannot reach a writer or a provider', () => {
  const closure = closureOf(ENTRY, false);

  it('reaches nothing under simulation, agent, operations, editorial, observability or _generated', () => {
    for (const file of closure) {
      for (const forbidden of FORBIDDEN_ROOTS) {
        expect({ file, forbidden, inside: file.startsWith(forbidden) })
          .toEqual({ file, forbidden, inside: false });
      }
    }
  });

  it('AC#2: reaches no Canon write path, so no compression can alter Canon', () => {
    for (const writePath of CANON_WRITE_PATHS) expect(closure).not.toContain(writePath);
  });

  it('pins the executed closure, so a new dependency is a deliberate decision', () => {
    // One value import: the shared error codes. Everything else the module needs from Canon is a
    // type, which is the point — it reads a projection it is handed and holds no way to fetch,
    // store or replace one.
    expect(closureOf(ENTRY, true)).toEqual(['convex/shared/errors.ts']);
  });

  it('names no provider package and no Convex runtime import', () => {
    const specifiers = [ENTRY, ...closure].flatMap((file) =>
      importsOf(executableSource(file)).map((entry) => entry.specifier));
    for (const specifier of specifiers) {
      expect(/^(openai|@anthropic-ai|@google|convex\/|convex$)/.test(specifier)).toBe(false);
    }
  });

  it('declares no Convex function, so it has no callable write or schedule surface', () => {
    const source = executableSource(ENTRY);
    for (const surface of ['mutation', 'action', 'internalMutation', 'internalAction', 'scheduler']) {
      expect(new RegExp(`\\b${surface}\\b`).test(source)).toBe(false);
    }
  });
});
