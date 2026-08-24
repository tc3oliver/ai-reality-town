/**
 * The benchmark's scenario knob cannot reach production (FR-Q005 / ART-136).
 *
 * `fixtureIsolation.test.ts` pins that the whole fixture is reachable through exactly one
 * import behind one build-time literal. This adds the specific guard that knob needs: it reads
 * a global, and a global read on the SHIPPED side of that gate would be a runtime switch into
 * test behaviour. Inside `src/e2e/` it is not — that module does not exist in a production
 * bundle at all — so the property worth asserting is precisely "no shipped file imports it".
 */

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

import { FIXTURE_SCENARIOS, FIXTURE_SCENARIO_GLOBAL, fixtureScenario } from './fixtureScenario';

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    if (!['.ts', '.tsx'].includes(extname(entry.name))) return [];
    return entry.name.includes('.test.') ? [] : [path];
  });
}

describe('containment', () => {
  test('no shipped file imports the scenario knob', () => {
    const shipped = sourceFiles('src').filter((path) => !path.startsWith('src/e2e/'));
    const importers = shipped.filter((path) =>
      readFileSync(join(ROOT, path), 'utf8').includes('fixtureScenario'),
    );
    expect(importers).toEqual([]);
  });

  test('the knob is not a second gate: the fixture gate is still the env literal', () => {
    // The danger would be `fixtureScenario()` growing into a way to TURN THE FIXTURE ON. It
    // selects among fixture worlds; it never decides whether the fixture is in use.
    // Comments stripped first, so prose ABOUT the gate is never mistaken for the gate — the
    // same precaution `liveResponsiveLayout.dom.test.tsx` takes when reading the stylesheet.
    const source = readFileSync(join(ROOT, 'src/e2e/fixtureScenario.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(source).not.toContain('VITE_E2E_FIXTURE');
    expect(source).not.toContain('e2eFixtureEnabled');
  });
});

describe('resolution', () => {
  const globals = globalThis as Record<string, unknown>;
  afterEach(() => {
    delete globals[FIXTURE_SCENARIO_GLOBAL];
  });

  test('an unset knob measures the ordinary page', () => {
    // The honest default. Anything else would let a benchmark that forgot to set the scenario
    // report degraded-mode figures as if they were normal ones.
    expect(fixtureScenario()).toBe('stream');
  });

  test.each(FIXTURE_SCENARIOS)('%s is selectable', (scenario) => {
    globals[FIXTURE_SCENARIO_GLOBAL] = scenario;
    expect(fixtureScenario()).toBe(scenario);
  });

  test('an unrecognised value falls back to the ordinary page rather than throwing', () => {
    globals[FIXTURE_SCENARIO_GLOBAL] = 'not-a-scenario';
    expect(fixtureScenario()).toBe('stream');
    globals[FIXTURE_SCENARIO_GLOBAL] = { mode: 'stream' };
    expect(fixtureScenario()).toBe('stream');
  });
});
