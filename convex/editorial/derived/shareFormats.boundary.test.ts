/**
 * What episode-derived share formats can reach (FR-G005 / ART-36, AC#1 and AC#3).
 *
 * Both of those acceptance criteria are NEGATIVES — derived content produces no new Canon, and
 * inappropriate content is not published externally on its own — and a behavioural test cannot
 * settle a negative. It can only show that the calls it happened to make did neither. So this
 * file settles them the way `visualReplay.boundary.test.ts` and `personaDeviation.boundary.test.ts`
 * settle theirs: the shipped files are read, the real import graph is walked, and every route the
 * violation would have to travel is looked for by name.
 *
 * There are three claims, and they fail for three different reasons on purpose:
 *
 * 1. The derivation module's import closure contains no writer and no generator (AC#1).
 * 2. `architecture/module-boundaries.json` still lists `derivedContent` under the Canon write
 *    boundary (AC#1). Without this, deleting one line from the policy would turn the build-time
 *    guarantee off while `npm run check:architecture` kept printing "valid".
 * 3. No file on the share pipeline can transmit anything anywhere (AC#3).
 *
 * On claim 3 and what it does NOT say: this deployment has no external publication transport at
 * all — no social API client, no outbound webhook, and `publicFunctionSurface.forbiddenRegistrations`
 * bans `httpAction` repo-wide, so nothing can receive a push either.
 * `docs/prd-1.0-closure-matrix.md` records the same finding against PRD §6's non-goal. This test
 * therefore does not claim that a gate was consulted before sending; it claims there is nothing
 * to send with, and pins that so adding one becomes a visible change rather than a quiet one.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const ROOT = process.cwd();

/** The pure derivation module — the file FR-G005 AC#1 is really about. */
const DERIVATION = 'convex/editorial/derived/shareFormats.ts';
/** Its Convex wiring — the most capable file on the share pipeline. */
const WIRING = 'convex/editorial/shareFormatFunctions.ts';

/**
 * Where a Canon write or a generation call would have to live.
 *
 * `simulation` is listed because that is where a provider call lives, and derived copy that
 * could reach one would be generating rather than reframing. `operations` because the operator
 * commands are there, and `observability` because a trace writer is still a writer.
 */
const FORBIDDEN_ROOTS = [
  'convex/simulation/',
  'convex/observability/',
  'convex/operations/',
  'convex/publicRead/',
  'convex/viewer/',
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

/**
 * Every way a file could hand text to something outside this deployment.
 *
 * `fetch` and the HTTP clients are the obvious ones. `httpAction` is here because an inbound
 * endpoint is the other half of an integration. `scheduler` is here because a deferred call is
 * still a call, and "the transport runs later" is exactly how an automatic publish would be
 * argued to be something else.
 */
const TRANSPORT_SYMBOLS = [
  'fetch(',
  'httpAction',
  'XMLHttpRequest',
  'ConvexHttpClient',
  'ctx.scheduler',
  'runAction',
];

function executableSource(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
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
    if (existsSync(join(ROOT, candidate))) return candidate;
  }
  return null;
}

/** Every file reachable from `entry`. `valueOnly` walks the graph a bundler would walk. */
/**
 * Files this one calls through a STRING function reference rather than an import.
 *
 * `internalFunctionRef('editorial/publicationLifecycleFunctions:createEpisodePublication')` is the
 * repo's idiom for a cross-module Convex call, and it is invisible to an import-graph walk BY
 * CONSTRUCTION: the only compile-time edge left is `import type`, which a value-only walk skips.
 *
 * That is not a detail. Without this, `publicationLifecycleFunctions.ts` — the one file the share
 * wiring actually invokes at runtime — sat in neither sweep: absent from the closure because the
 * edge is type-only, and absent from `pipelineFiles` because it contains no `shareFormat`
 * substring. A transport added to it passed every test here.
 */
function stringRefTargets(source: string): string[] {
  return [...source.matchAll(/internalFunctionRef<[^>]*>\(\s*'([^':]+):/g)]
    .map((match) => `convex/${match[1]}.ts`)
    .filter((path) => existsSync(join(ROOT, path)));
}

function closureOf(entry: string, valueOnly: boolean): string[] {
  const visited = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    const source = executableSource(file);
    const targets = importsOf(source)
      .filter(({ typeOnly }) => !(valueOnly && typeOnly))
      .map(({ specifier }) => resolveImport(file, specifier))
      // Runtime edges the import graph cannot see. Walked identically once resolved, so anything
      // reached only through a string ref is swept exactly like an imported dependency.
      .concat(stringRefTargets(source));
    for (const target of targets) {
      if (target === null || visited.has(target)) continue;
      visited.add(target);
      queue.push(target);
    }
  }
  visited.delete(entry);
  return [...visited].sort();
}

function sourceFiles(directory: string): string[] {
  return readdirSync(join(ROOT, directory)).flatMap((entry) => {
    const relative = `${directory}/${entry}`;
    if (statSync(join(ROOT, relative)).isDirectory()) return sourceFiles(relative);
    return /\.tsx?$/.test(entry) && !/\.test\./.test(entry) ? [relative] : [];
  });
}

const policy = JSON.parse(readFileSync(join(ROOT, 'architecture/module-boundaries.json'), 'utf8')) as {
  modules: Record<string, { roots: string[]; mayDependOn: string[] }>;
  canonWriteBoundary: { forbiddenModules: string[]; forbiddenSymbols: string[] };
  publicFunctionSurface: { forbiddenRegistrations: string[]; allowed: { path: string; name: string }[] };
};

describe('FR-G005 AC#1 — the derivation cannot reach a writer or a generator', () => {
  const closure = closureOf(DERIVATION, false);

  it('reaches only pure safety and shared helpers', () => {
    // Pinned exhaustively rather than counted: a new dependency has to be argued for here, and
    // the two it has are the EXISTING post-generation gate (so AC#3 reuses it rather than
    // forming a second opinion) and the shared truncation helper.
    expect(closure).toEqual([
      'convex/safety/postGeneration.ts',
      'convex/safety/preGeneration.ts',
      'convex/shared/publicText.ts',
    ]);
  });

  it('reaches nothing under simulation, observability, operations, publicRead or viewer', () => {
    for (const file of closure) {
      for (const forbidden of FORBIDDEN_ROOTS) {
        expect({ file, forbidden, inside: file.startsWith(forbidden) })
          .toEqual({ file, forbidden, inside: false });
      }
    }
  });

  it('reaches no Canon file at all, write path or model', () => {
    for (const writePath of CANON_WRITE_PATHS) expect(closure).not.toContain(writePath);
    expect(closure.filter((file) => file.startsWith('convex/canon/'))).toEqual([]);
    // Not even the generated Convex API, which is what a write would have to be registered on.
    expect(closure.filter((file) => file.includes('/_generated/'))).toEqual([]);
  });

  it('keeps the build-time guarantee wired up in policy', () => {
    // The behavioural evidence above is a companion, not the guarantee. This is the guarantee:
    // if `derivedContent` leaves this list, `check:architecture` stops sweeping the module for
    // write symbols and goes on reporting success. Deleting one line from a JSON file should
    // not be able to do that quietly.
    expect(policy.canonWriteBoundary.forbiddenModules).toContain('derivedContent');
    expect(policy.modules.derivedContent.roots).toEqual(['convex/editorial/derived']);
    // And the module may not depend on canon, so it cannot even name the accepted-event model.
    expect(policy.modules.derivedContent.mayDependOn).toEqual(['safety', 'shared']);
    // The symbols the sweep looks for still include the ones that matter.
    for (const symbol of ['internalMutation', 'ctx.db.insert', 'ctx.db.patch', 'commitProposedEvent']) {
      expect(policy.canonWriteBoundary.forbiddenSymbols).toContain(symbol);
    }
  });

  it('names no write symbol itself, which is what the build check enforces', () => {
    const source = readFileSync(join(ROOT, DERIVATION), 'utf8');
    for (const symbol of policy.canonWriteBoundary.forbiddenSymbols) {
      expect({ symbol, present: source.includes(symbol) }).toEqual({ symbol, present: false });
    }
  });
});

describe('FR-G005 AC#3 — no automatic external publication path exists', () => {
  /**
   * Every shipped file that knows what a share format is.
   *
   * Derived from the source tree rather than listed, so a NEW file joining the pipeline is
   * covered the day it is written instead of the day someone remembers this test.
   */
  const pipelineFiles = [...sourceFiles('convex/editorial'), ...sourceFiles('convex/operations')]
    .filter((path) => /shareFormat|ShareFormat|deriveGatedShareFormats/.test(readFileSync(join(ROOT, path), 'utf8')));

  it('covers a non-empty set of files, so the sweep below is not vacuous', () => {
    // Asserted because a sweep over nothing passes for the wrong reason -- which is the failure
    // mode a "nothing was published" test is most likely to have.
    expect(pipelineFiles).toContain(DERIVATION);
    expect(pipelineFiles).toContain(WIRING);
    expect(pipelineFiles.length).toBeGreaterThanOrEqual(4);
  });

  it('gives no file on the share pipeline a way to transmit anything', () => {
    for (const path of pipelineFiles) {
      const source = executableSource(path);
      for (const symbol of TRANSPORT_SYMBOLS) {
        expect({ path, symbol, present: source.includes(symbol) })
          .toEqual({ path, symbol, present: false });
      }
    }
  });

  it('leaves the wiring unable to reach a transport transitively either', () => {
    const closure = closureOf(WIRING, true);
    for (const file of closure) {
      if (file.includes('/_generated/')) continue;
      const source = executableSource(file);
      for (const symbol of TRANSPORT_SYMBOLS) {
        expect({ file, symbol, present: source.includes(symbol) })
          .toEqual({ file, symbol, present: false });
      }
    }
    // The provider adapters are where an outbound call actually lives in this repo. Named so the
    // claim above is specific rather than a hope.
    expect(closure).not.toContain('convex/util/llm.ts');
    expect(closure.filter((file) => file.startsWith('convex/simulation/providers/'))).toEqual([]);
  });

  it('follows the string function references too, not just the imports', () => {
    // The sweep above is only as wide as the walk. `internalFunctionRef` calls leave no value
    // import behind, so a walk that followed imports alone would silently exclude the one file the
    // wiring actually invokes -- and a transport added there would pass every test in this file.
    // Naming the file is what stops the walk regressing to imports-only without anyone noticing.
    expect(closureOf(WIRING, true)).toContain('convex/editorial/publicationLifecycleFunctions.ts');
  });

  it('registers no public function for derived content, and no HTTP endpoint anywhere', () => {
    // AC#3 is about EXTERNAL publication, and a public Convex query is the other way copy could
    // leave: anyone holding the deployment URL can call one without going through the client.
    // The exhaustive allowlist is the repo's existing pin; this asserts derived content is
    // absent from it, which is what keeps the copy operator-only until someone decides otherwise.
    expect(policy.publicFunctionSurface.forbiddenRegistrations).toContain('httpAction');
    const shareEntries = policy.publicFunctionSurface.allowed
      .filter((entry) => /share/i.test(entry.path) || /share/i.test(entry.name));
    expect(shareEntries).toEqual([]);
    const wiring = executableSource(WIRING);
    // Both registrations in the wiring are internal, which is what makes them unreachable from
    // outside the deployment. Checked on the source because the allowlist above cannot see a
    // function it was never told about.
    expect(wiring).toContain('internalQuery({');
    expect(wiring).not.toMatch(/=\s*query\s*\(/);
    expect(wiring).not.toMatch(/=\s*mutation\s*\(/);
    expect(wiring).not.toMatch(/=\s*action\s*\(/);
  });
});
