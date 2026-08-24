/**
 * The guard that pays for widening `clientWorldReadOnly` (ART-120 / FR-O011 AC#2).
 *
 * `architecture/module-boundaries.json` now lets `src/components/world/` depend on
 * `visualRuntime`, so the browser can re-derive ambient drift with the Visual Runtime's own
 * seeded primitives instead of a second, divergent copy of the PRNG. That widening is worth
 * making and is also the most dangerous edit in this task, because `visualRuntime` is not
 * uniformly safe to ship:
 *
 * - `convex/visualRuntime/mistwoodRuntime.ts` imports `convex/visual/mistwoodLocationBindings.ts`
 * - which imports `convex/canon/mistwoodSeed.ts`
 * - which carries `privateProfile`, `privateGoal`, `fear` and `secretContents` for all twelve
 *   residents.
 *
 * The boundary checker compares declared module roots, so it cannot tell those three files
 * apart from the three safe leaves. This test does: it walks the real import graph out of the
 * client's ambient module and asserts the whole closure, file by file. A future edit that
 * imports one more thing from `visualRuntime` fails here, whether or not anyone remembered
 * this document.
 *
 * Shaped after `convex/visualRuntime/visualRuntime.purity.test.ts`, which does the same job in
 * the other direction.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const ENTRY = 'src/components/world/ambientMotion.ts';

/** The only three files in `convex/visualRuntime` the client may reach, at any depth. */
const PERMITTED_RUNTIME_FILES: readonly string[] = [
  'convex/visualRuntime/ambientAnchor.ts',
  'convex/visualRuntime/motion.ts',
  'convex/visualRuntime/seededRandom.ts',
];

/**
 * Nothing reachable from the client's ambient code may live here. `convex/visual/` is on the
 * list even though `locationVisualBinding.ts` is itself harmless: its sibling
 * `mistwoodLocationBindings.ts` is the seed's doorway, and a directory-level rule cannot be
 * satisfied by accident the way a file-level exception can.
 */
const FORBIDDEN_ROOTS = [
  'convex/canon/',
  'convex/simulation/',
  'convex/knowledge/',
  'convex/story/',
  'convex/editorial/',
  'convex/operations/',
  'convex/util/',
];

/** The seed itself, named so the failure message says what was actually at stake. */
const CANON_SEED = 'convex/canon/mistwoodSeed.ts';

function executableSource(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/**
 * Every module specifier a file imports, tagged by whether the edge survives compilation.
 *
 * The distinction is the whole point. A `import type { … }` is erased by TypeScript, so it
 * puts nothing in the bundle; a value import is a real edge Rollup will follow. Both matter,
 * for different reasons — a value edge into the seed would ship private data, and a type edge
 * into it would mean someone had decided that was a reasonable shape to reach for — so both
 * are walked, and asserted separately.
 */
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

/**
 * Every file reachable from `entry`, excluding `entry` itself.
 *
 * `valueOnly` walks the graph the bundler will walk; the full walk additionally follows
 * type-only edges, so a file that is merely *named* in a type position is still accounted for.
 */
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

describe('FR-O011 AC#2 — the ambient client boundary', () => {
  const bundled = closureOf(ENTRY, true);
  const closure = closureOf(ENTRY, false);

  it('bundles exactly three files from the Visual Runtime, and they are the three leaves', () => {
    // The widening this test pays for, stated exactly: three leaves, no map runtime, no
    // bindings module. Anything else appearing here is a decision, not an accident.
    expect(bundled).toEqual([...PERMITTED_RUNTIME_FILES].sort());
  });

  it('never reaches the map runtime, and so never reaches the Canon seed', () => {
    // The disqualifying path, stated by name: `mistwoodRuntime.ts -> mistwoodLocationBindings.ts
    // -> mistwoodSeed.ts` is three hops from a private profile to a public bundle.
    expect(closure).not.toContain('convex/visualRuntime/mistwoodRuntime.ts');
    expect(closure).not.toContain('convex/visual/mistwoodLocationBindings.ts');
    expect(closure).not.toContain(CANON_SEED);
  });

  it('reaches nothing under Canon, Simulation, Story, Operations or util', () => {
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

  it('pins the bundled closure, so any new dependency is a deliberate decision', () => {
    expect(bundled).toEqual([
      'convex/visualRuntime/ambientAnchor.ts',
      'convex/visualRuntime/motion.ts',
      'convex/visualRuntime/seededRandom.ts',
    ]);
  });

  it('names only the published motion contract even in type position', () => {
    // The type-only edges, pinned too. `publicDynamicProjection.ts` is the published contract
    // this module consumes and `locationVisualBinding.ts` supplies `ZonePoint`; both are
    // erased at compile time, and neither imports the Canon seed.
    expect(closure.filter((file) => !bundled.includes(file))).toEqual([
      // FR-O004 / ART-123. Reached only because `publicDynamicProjection` now derives
      // conversation state; the edge back is a `import type` and erases. Named deliberately,
      // which is what this pin is for — and the module imports nothing but that same type, so
      // it cannot be a route to the Canon seed. The bundled list above is unchanged.
      'convex/publicRead/conversationState.ts',
      'convex/publicRead/publicDynamicProjection.ts',
      'convex/visual/locationVisualBinding.ts',
      'convex/visualRuntime/pathPlanner.ts',
      'convex/visualRuntime/seedBootstrap.ts',
      'convex/visualRuntime/visualSyncPlanner.ts',
      'convex/visualRuntime/walkableGrid.ts',
    ]);
  });

  it('names no private Canon field anywhere in the bundle', () => {
    // Belt and braces: even if some future file joined the bundle legitimately, it must not
    // be one that so much as mentions the fields `PUBLIC_DYNAMIC_FORBIDDEN_FIELDS` refuses.
    // Scoped to the bundled closure, because the *denylist itself* lives in
    // `publicDynamicProjection.ts` and naming a forbidden field is that module's whole job.
    const privateFields = ['privateProfile', 'privateGoal', 'secretContents', 'rawModelOutput'];
    const offenders = [ENTRY, ...bundled].flatMap((file) => {
      const code = executableSource(file);
      return privateFields
        .filter((field) => new RegExp(`\\b${field}\\b`).test(code))
        .map((field) => `${file}: ${field}`);
    });
    expect(offenders).toEqual([]);
  });

  it('reads no clock and no randomness of its own', () => {
    // The whole determinism claim (AC#4/#5) rests on `nowMs` being an argument. A `Date.now()`
    // in here would make two viewers disagree by however long their round trips differed.
    const source = executableSource(ENTRY);
    for (const pattern of [/\bDate(?:\.now|\s*\()/, /\bMath\.random\s*\(/, /\bperformance\.now\s*\(/]) {
      expect(source).not.toMatch(pattern);
    }
  });

  it('cannot start a conversation or write anything (AC#2/AC#3)', () => {
    // AC#3 asks that ambient movement never begin a conversation. There is no conversation
    // mechanism anywhere in this closure to begin one with — the a16z chat engine was retired
    // in ART-112 — so the criterion is met by absence, and this is what asserts the absence.
    const forbidden = [
      /\buseMutation\b/, /\buseAction\b/, /\buseQuery\b/, /\bctx\.db\b/, /\bfetch\s*\(/,
      /\binsertInput\b/, /\bstartConversation\b/, /\bconversations?\b/i, /\bsendMessage\b/,
      /\bmessages\b/i, /\bmemor(y|ies)\b/i, /\brelationship/i,
    ];
    const offenders = [ENTRY, ...bundled].flatMap((file) => {
      const code = executableSource(file);
      return forbidden
        .filter((pattern) => pattern.test(code))
        .map((pattern) => `${file}: ${pattern.source}`);
    });
    expect(offenders).toEqual([]);
  });
});
