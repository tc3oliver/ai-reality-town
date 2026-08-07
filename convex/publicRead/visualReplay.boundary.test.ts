/**
 * What the replay builder can reach (FR-O013 / ART-121 AC#3/#4).
 *
 * AC#4 says a replay triggers no LLM call, no re-simulation and no Canon change. The strongest
 * form of that claim is not "it does not do those things" but "it cannot": there is no path
 * from this module to anything that could. The boundary checker compares declared module
 * roots, which is coarser than it needs to be here — `publicRead` is legitimately allowed to
 * depend on `editorial` and `visualRuntime`, and those directories are not uniformly safe.
 * So this walks the real import graph, file by file, and pins the closure.
 *
 * Shaped after `src/components/world/ambientMotion.boundary.test.ts`, which does the same job
 * for the client's ambient module.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const ENTRY = 'convex/publicRead/visualReplay.ts';

/**
 * Where a generation path would have to live. `safety` and `observability` are on the list
 * with `simulation` because a replay that could reach the safety classifier or the trace
 * writer would be a public read path with a write and a decision in it.
 */
const FORBIDDEN_ROOTS = [
  'convex/simulation/',
  'convex/safety/',
  'convex/observability/',
  'convex/operations/',
  'convex/_generated/',
];

/** Canon's write surface, named individually because `convex/canon/` also holds pure model code. */
const CANON_WRITE_PATHS = [
  'convex/canon/commit.ts',
  'convex/canon/characterSeed.ts',
  'convex/canon/worldConfig.ts',
  'convex/canon/snapshotOperations.ts',
  'convex/canon/snapshotManager.ts',
  'convex/canon/inMemoryStore.ts',
  'convex/canon/tensionReadiness.ts',
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
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every file reachable from `entry`. `valueOnly` walks the graph a bundler would walk. */
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

describe('FR-O013 AC#4 — the replay builder cannot reach a generator or a writer', () => {
  const executed = closureOf(ENTRY, true);
  const closure = closureOf(ENTRY, false);

  it('reaches nothing under simulation, safety, observability, operations or _generated', () => {
    for (const file of closure) {
      for (const forbidden of FORBIDDEN_ROOTS) {
        expect({ file, forbidden, inside: file.startsWith(forbidden) }).toEqual({
          file,
          forbidden,
          inside: false,
        });
      }
    }
  });

  it('reaches no Canon write path', () => {
    for (const writePath of CANON_WRITE_PATHS) expect(closure).not.toContain(writePath);
  });

  it('pins the executed closure, so a new dependency is a deliberate decision', () => {
    // The three direct imports are `activeScenePresentation.ts` (ART-122's scene partition,
    // which is why this module has no grouping code of its own), `motion.ts` (the walk speed)
    // and `seedBootstrap.ts` (the deterministic anchor). The rest arrive through
    // `publicDynamicProjection.ts`, whose own closure already reaches the trajectory planner
    // and the collision grid. Every one of them is a pure function over its arguments.
    expect(executed).toEqual([
      'convex/publicRead/activeScenePresentation.ts',
      'convex/publicRead/publicDynamicProjection.ts',
      'convex/visual/locationVisualBinding.ts',
      'convex/visualRuntime/ambientAnchor.ts',
      'convex/visualRuntime/motion.ts',
      'convex/visualRuntime/pathPlanner.ts',
      'convex/visualRuntime/seedBootstrap.ts',
      'convex/visualRuntime/seededRandom.ts',
      'convex/visualRuntime/visualSyncPlanner.ts',
      'convex/visualRuntime/walkableGrid.ts',
    ]);
  });

  it('never reaches the Mistwood map runtime, and so never reaches the Canon seed', () => {
    // The disqualifying path, named: `mistwoodRuntime.ts -> mistwoodLocationBindings.ts ->
    // mistwoodSeed.ts` is three hops from a resident's `privateProfile` to this payload. The
    // bindings are handed in as an argument precisely so this module never takes that edge.
    expect(closure).not.toContain('convex/visualRuntime/mistwoodRuntime.ts');
    expect(closure).not.toContain('convex/visual/mistwoodLocationBindings.ts');
    expect(closure).not.toContain('convex/canon/mistwoodSeed.ts');
    const privateFields = ['privateProfile', 'privateGoal', 'secretContents', 'rawModelOutput'];
    const offenders = [ENTRY, ...executed]
      // The denylist itself lives in `publicDynamicProjection.ts`, and naming a forbidden
      // field is that module's whole job.
      .filter((file) => file !== 'convex/publicRead/publicDynamicProjection.ts')
      .flatMap((file) => {
        const code = executableSource(file);
        return privateFields.filter((field) => new RegExp(`\\b${field}\\b`).test(code)).map((field) => `${file}: ${field}`);
      });
    expect(offenders).toEqual([]);
  });

  it('names no provider package and no Convex runtime import', () => {
    const specifiers = [ENTRY, ...closure].flatMap((file) =>
      importsOf(executableSource(file)).map((entry) => entry.specifier));
    for (const specifier of specifiers) {
      expect(/^(openai|@anthropic-ai|@google|convex\/)/.test(specifier)).toBe(false);
    }
  });
});
