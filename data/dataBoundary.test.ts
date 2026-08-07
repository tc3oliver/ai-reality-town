/**
 * `data/` is shared by both sides, so nothing private may pass through it
 * (ART-119 / FR-O002, guarding the ART-128 / FR-O009 read-only guarantee).
 *
 * `data/` is owned by no module in `architecture/module-boundaries.json` --
 * `moduleForPath` returns `null` for it -- which is deliberate and is what lets
 * `convex/visual/mistwoodLocationBindings.ts` and `src/components/world/` read
 * the same tilemap without either depending on the other. But two consequences
 * follow, and they are the reason this file exists:
 *
 * 1. The module-boundary graph does not constrain what `data/` imports, so
 *    nothing stops a file here from reaching into `convex/canon` -- and
 *    `convex/canon/mistwoodSeed.ts` carries `privateProfile`, `privateGoal`,
 *    `fear` and `secretContents` for all twelve residents. Because the client
 *    imports `data/`, such an import would put private character data one Rollup
 *    decision away from every viewer's bundle.
 * 2. `readOnlyClientBoundary` scans `src`, not `data`, so the write-API sweep
 *    that covers every client file stops at this directory's edge.
 *
 * Widening the policy files instead of writing this test was considered and
 * rejected: `data/mistwood.test.ts` legitimately imports the seed to prove the
 * tilemap matches Canon's location graph, so a blanket policy ban would have to
 * carry a test-file exemption -- which is the kind of exemption that grows. A
 * product test can simply say "non-test files only", which is the real rule.
 *
 * ART-119 moved the sprite catalogue, the palette engine and the public
 * character roster here, which is what made the gap worth closing now.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const ROOT = process.cwd();
const DATA_ROOT = 'data';

/** Backend modules whose contents must never be reachable from a shared file. */
const FORBIDDEN_IMPORT_ROOTS = [
  'convex/canon',
  'convex/visual',
  'convex/publicRead',
  'convex/simulation',
  'convex/knowledge',
  'convex/story',
  'convex/editorial',
  'convex/operations',
  'convex/visualRuntime',
];

/**
 * Kept in sync by hand with `readOnlyClientBoundary.forbiddenSymbols` in
 * `architecture/module-boundaries.json`. No file under `data/` carries an
 * exemption, so the list is used whole -- including `ConvexReactClient`, which
 * is exempt for exactly one file in `src` and for nothing here.
 */
const FORBIDDEN_SYMBOLS = [
  'useMutation',
  'useAction',
  'useConvex',
  'ConvexHttpClient',
  'ConvexReactClient',
  'ConvexClient',
  'BaseConvexClient',
  'useSendInput',
  'useWorldHeartbeat',
  'useServerGame',
  'insertInput',
  'sendWorldInput',
];

function filesUnder(dir: string, includeTests: boolean): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(path, includeTests);
    if (!['.ts', '.tsx'].includes(extname(entry.name))) return [];
    if (!includeTests && entry.name.includes('.test.')) return [];
    return [path];
  });
}

function read(paths: string[]) {
  return paths.map((path) => {
    const source = readFileSync(join(ROOT, path), 'utf8');
    return {
      path,
      source,
      // Comments stripped, so prose *about* a forbidden symbol is never mistaken
      // for a use of one -- these modules' doc blocks name several on purpose,
      // explaining why they are absent. Same treatment `liveMapSurface.test.ts`
      // gives the route module.
      code: source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
    };
  });
}

const shipped = read(filesUnder(DATA_ROOT, false));
const everything = read(filesUnder(DATA_ROOT, true));

/** Module specifiers a file imports or re-exports, normalised against `data/`. */
function importedModules(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

describe('the data/ boundary', () => {
  test('covers the files ART-119 moved here', () => {
    const paths = shipped.map((file) => file.path);
    expect(paths).toContain('data/mistwood.ts');
    expect(paths).toContain('data/mistwoodCharacters.ts');
    expect(paths).toContain('data/spritePalette.ts');
    expect(paths).toContain('data/spritesheets/catalogue.ts');
    expect(paths.length).toBeGreaterThan(4);
  });

  test('no shipped file imports a backend module', () => {
    // The disqualifying case: `convex/visual/mistwoodVisualBindings.ts` imports
    // `convex/canon/mistwoodSeed.ts`, so *any* path from a client bundle into
    // `convex/visual` is also a path to every resident's private profile, goal,
    // fear and secrets. `data/` is a client dependency, so it must not open one.
    const offenders = shipped.flatMap((file) =>
      importedModules(file.source)
        .filter((specifier) =>
          FORBIDDEN_IMPORT_ROOTS.some((root) => specifier.replace(/^(\.\.\/)+/, '').startsWith(root)),
        )
        .map((specifier) => `${file.path}: ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  test('no shipped file reaches outside data/ at all, except for a type', () => {
    // Stronger and simpler than enumerating forbidden roots: a shared layer that
    // imports nothing but its own siblings cannot acquire a private dependency
    // by someone adding a new backend module. `convex/aiTown/worldMap` is the one
    // exception -- a pure `type` import of the tilemap contract, erased at
    // compile time, so it puts no runtime edge in the bundle.
    const offenders = shipped.flatMap((file) =>
      importedModules(file.source)
        .filter((specifier) => specifier.startsWith('..'))
        .filter((specifier) => !specifier.endsWith('convex/aiTown/worldMap'))
        .map((specifier) => `${file.path}: ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  test('the one permitted outward import is type-only', () => {
    for (const file of shipped) {
      for (const line of file.source.split('\n')) {
        if (!/from\s+['"]\.\..*convex\//.test(line)) continue;
        expect(line).toMatch(/^import\s+type\b/);
      }
    }
  });

  test('names no write API', () => {
    // `readOnlyClientBoundary` scans `src`, not `data`, so this directory would
    // otherwise be the one part of the client bundle nothing swept.
    const offenders = shipped.flatMap((file) =>
      FORBIDDEN_SYMBOLS.filter((symbol) => new RegExp(`\\b${symbol}\\b`).test(file.code)).map(
        (symbol) => `${file.path}: ${symbol}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  test('names no private Canon field', () => {
    // The field names `PUBLIC_DYNAMIC_FORBIDDEN_FIELDS` refuses to publish. A
    // shared file that so much as mentions one is either carrying it or about to.
    const privateFields = [
      'privateProfile',
      'privateGoal',
      'secretContents',
      'rawModelOutput',
      'adminNotes',
      'apiKey',
      'credential',
    ];
    const offenders = shipped.flatMap((file) =>
      privateFields
        .filter((field) => new RegExp(`\\b${field}\\b`).test(file.code))
        .map((field) => `${file.path}: ${field}`),
    );
    expect(offenders).toEqual([]);
  });

  test('a test file may import the seed, and that is the only reason tests are excluded', () => {
    // `data/mistwood.test.ts` pins the tilemap against Canon's location graph and
    // `data/mistwoodCharacters.test.ts` pins the roster against the authored
    // bindings. Both need the backend and neither ships. If no test ever imported
    // one, the shipped/test split above would be pointless -- so assert the split
    // is load-bearing rather than decorative.
    const testFiles = everything.filter((file) => file.path.includes('.test.'));
    const importers = testFiles.filter((file) =>
      importedModules(file.source).some((specifier) => specifier.includes('convex/')),
    );
    expect(importers.length).toBeGreaterThan(0);
  });
});
