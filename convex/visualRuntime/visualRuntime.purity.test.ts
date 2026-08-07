import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

/**
 * FR-N010 AC#2 and AC#3: the Visual Runtime must contain no LLM call path and no Canon write
 * path. Both are stated structurally rather than by review, because "nobody added an import"
 * is not a property a reviewer can keep true across a year of edits.
 *
 * Three independent checks, because each catches what the others miss:
 *
 * 1. An exact per-file import allowlist. Adding *any* dependency to this module fails here
 *    first, so the decision to widen the boundary has to be deliberate.
 * 2. A forbidden-token scan of the source text, which catches a write reached through a
 *    namespace or a string rather than a direct import.
 * 3. A transitive walk of the planner's real import graph, which is the only one of the three
 *    that proves nothing *reachable* from the entry point touches Canon. The repository
 *    boundary checker cannot do this: it only compares declared module roots, and
 *    `convex/util` is owned by no module, so an import into it would pass unnoticed.
 */

const ROOT = 'convex/visualRuntime';

/** Every non-test file in the module, with the complete set of imports it may declare. */
const IMPORT_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  'motion.ts': [],
  'seededRandom.ts': [],
  'ambientAnchor.ts': ['../visual/locationVisualBinding', './seededRandom'],
  'walkableGrid.ts': ['./motion'],
  'pathPlanner.ts': ['./motion', './walkableGrid'],
  'seedBootstrap.ts': ['../visual/locationVisualBinding', './ambientAnchor', './motion'],
  'visualSyncPlanner.ts': [
    '../visual/locationVisualBinding',
    './ambientAnchor',
    './motion',
    './pathPlanner',
    './seedBootstrap',
    './seededRandom',
    './walkableGrid',
  ],
  // The single leaf allowed to know a concrete map exists. Nothing else may import it, which
  // is what keeps the planner's own closure free of the Canon seed these bindings read.
  'mistwoodRuntime.ts': [
    '../../data/mistwood',
    '../visual/locationVisualBinding',
    '../visual/mistwoodLocationBindings',
    './walkableGrid',
  ],
  'fixtures.ts': ['./mistwoodRuntime', './seedBootstrap', './visualSyncPlanner'],
};

/**
 * Tokens that would each mean the runtime had grown a Canon write path, an LLM call path or a
 * dependency on generated Convex code.
 */
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /convex\/_generated/,
  /internalMutation/,
  /\bmutation\s*\(/,
  /\bctx\.db\b/,
  /insert\(['"]canonEvents/,
  /commitProposedEvent/,
  /reduceWorldEvent/,
  /util\/llm/,
  /simulation\/providers/,
  /openai/,
  /anthropic/,
  /generative-ai/,
  /\bfetch\s*\(/,
];

/** Directories nothing reachable from the planner may live in. */
const FORBIDDEN_ROOTS = ['convex/canon/', 'convex/util/', 'convex/simulation/providers/'];

function executableSource(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function importsOf(source: string): readonly string[] {
  const pattern =
    /(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  return [...source.matchAll(pattern)].map((match) => match[1] ?? match[2]);
}

function resolveImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = normalize(join(dirname(fromFile), specifier)).split('\\').join('/');
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

describe('FR-N010 AC#2/AC#3 Visual Runtime purity', () => {
  it.each(Object.keys(IMPORT_ALLOWLIST))('declares only allowed imports in %s', (file) => {
    const imports = [...new Set(importsOf(executableSource(join(ROOT, file))))].sort();
    expect(imports).toEqual([...IMPORT_ALLOWLIST[file]].sort());
  });

  it.each(Object.keys(IMPORT_ALLOWLIST))('names no write, provider or generated symbol in %s', (file) => {
    const source = executableSource(join(ROOT, file));
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect({ file, pattern: pattern.source, matched: pattern.test(source) }).toEqual({
        file,
        pattern: pattern.source,
        matched: false,
      });
    }
  });

  it.each(Object.keys(IMPORT_ALLOWLIST))('reads no clock, environment or randomness in %s', (file) => {
    const source = executableSource(join(ROOT, file));
    for (const pattern of [
      /\bDate(?:\.now|\s*\()/,
      /\bperformance\.now\s*\(/,
      /\bMath\.random\s*\(/,
      /\bprocess\.env\b/,
      /\bcrypto\.getRandomValues\s*\(/,
    ]) {
      expect(source).not.toMatch(pattern);
    }
  });

  it('reaches nothing under Canon, util or a provider adapter from the planner entry point', () => {
    const entry = join(ROOT, 'visualSyncPlanner.ts');
    const visited = new Set<string>([entry]);
    const queue = [entry];
    const unresolved: string[] = [];

    while (queue.length > 0) {
      const file = queue.shift() as string;
      for (const specifier of importsOf(executableSource(file))) {
        if (!specifier.startsWith('.')) {
          unresolved.push(`${file} -> ${specifier}`);
          continue;
        }
        const target = resolveImport(file, specifier);
        expect({ file, specifier, resolved: target !== null }).toEqual({
          file,
          specifier,
          resolved: true,
        });
        if (target && !visited.has(target)) {
          visited.add(target);
          queue.push(target);
        }
      }
    }

    // A bare specifier is a package import; the runtime must have none at all.
    expect(unresolved).toEqual([]);
    for (const file of visited) {
      for (const forbidden of FORBIDDEN_ROOTS) {
        expect({ file, forbidden, inside: file.startsWith(forbidden) }).toEqual({
          file,
          forbidden,
          inside: false,
        });
      }
    }
    // The closure is small on purpose; a surprise growth in it should be noticed.
    expect([...visited].sort()).toEqual([
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
});
