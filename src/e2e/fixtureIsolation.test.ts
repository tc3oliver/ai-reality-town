/**
 * The fixture cannot reach a production bundle (FR-Q006 / ART-137).
 *
 * A test harness that shipped would be a far worse defect than any this suite was written to
 * catch: a public deployment serving invented characters, or worse, silently refusing every write
 * the operator console needs. So the containment is asserted structurally rather than assumed.
 *
 * Structural rather than "build it and grep the bundle": a jest test that ran `vite build` would
 * add minutes to every run to check a property that is decided by two lines of source. Those two
 * lines are what is pinned here — one entry point, one env gate, and no other importer.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    if (!['.ts', '.tsx'].includes(extname(entry.name))) return [];
    return entry.name.includes('.test.') ? [] : [path];
  });
}

describe('the E2E fixture is reachable from exactly one place, behind one flag', () => {
  const shipped = sourceFiles('src').filter((path) => !path.startsWith('src/e2e/'));

  test('only ConvexClientProvider imports it', () => {
    const importers = shipped.filter((path) =>
      /from '[^']*\/e2e\/[^']+'/.test(readFileSync(join(ROOT, path), 'utf8')),
    );
    // One entry point. A second would be a second place the fixture could switch itself on.
    expect(importers).toEqual(['src/components/ConvexClientProvider.tsx']);
  });

  test('that import is gated on the build flag, and the flag is the only way in', () => {
    const provider = readFileSync(join(ROOT, 'src/components/ConvexClientProvider.tsx'), 'utf8');
    // The fixture client is constructed only inside the gate's true branch. Asserted as source
    // text because that is the shape Vite's constant folding can actually eliminate: a runtime
    // check on a value it cannot fold would leave the fixture in the bundle, unreachable but
    // present.
    expect(provider).toMatch(/e2eFixtureEnabled\(\)\s*\n?\s*\?\s*\(?createFixtureConvexClient/);
    expect(provider).toContain('new ConvexReactClient(convexUrl()');
  });

  test('the gate is an exact match on a build-time env literal', () => {
    const source = readFileSync(join(ROOT, 'src/e2e/fixtureConvexClient.ts'), 'utf8');
    // `import.meta.env.VITE_E2E_FIXTURE` is replaced at build time, so an ordinary build folds
    // this to `false`. A check on `window` or `location` would not fold and the branch would
    // survive into production.
    expect(source).toMatch(/import\.meta\.env\?\.VITE_E2E_FIXTURE === '1'/);
    for (const escape of ['window.location', 'document.cookie', 'localStorage', 'navigator']) {
      expect(source).not.toContain(escape);
    }
  });

  test('the E2E build script is the only thing that sets the flag', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const setters = Object.entries(pkg.scripts)
      .filter(([, command]) => command.includes('VITE_E2E_FIXTURE'))
      .map(([name]) => name);
    expect(setters).toEqual(['build:e2e']);
    // ...and that script writes to its own output directory, so it can never overwrite `dist`.
    expect(pkg.scripts['build:e2e']).toContain('--outDir dist-e2e');
    expect(pkg.scripts.build).not.toContain('VITE_E2E_FIXTURE');
  });
});
