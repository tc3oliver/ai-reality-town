/**
 * The benchmark's sprite load probe (ART-173 / FR-Q005 / ART-136 AC#6).
 *
 * Two claims, and they need different evidence.
 *
 * **That the probe applies the load it says it does** — the right number of characters, all of
 * them bound to a real sprite key, all of them still walking for the whole sample window. That is
 * arithmetic over pure functions and is settled here. It matters because the failure mode is
 * silent: a probe that drew twelve sprites while claiming forty would publish a flattering frame
 * rate against a load that never existed, and the figure would look exactly like a pass.
 *
 * **That the probe never ships** — a second Vite input, added only under the E2E build's own
 * literal. That is settled by reading the config and `package.json`, the same way
 * `fixtureIsolation.test.ts` settles the transport gate, because a claim about what is in the
 * production bundle cannot be made from inside the module that must not be in it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { mistwoodCharacterSpriteKeys } from '../../data/mistwoodCharacters';
import { mistwoodWorldMap } from '../../data/mistwood';
import { composeReadOnlyWorldViewModel } from '../components/world/worldViewModel';
import {
  MAX_PROBE_CHARACTERS,
  PROBE_CHARACTER_COUNTS,
  PROBE_COUNT_PARAM,
  probeCharacterCount,
  probeCharacterId,
  probeMotions,
  probeSpriteKeys,
} from './spriteLoadWorld';

const ROOT = process.cwd();
const NOW = 1_700_000_000_000;

describe('the probe reads the count it was asked for, and refuses to be surprising', () => {
  it('takes the count from the query string', () => {
    expect(probeCharacterCount(`?${PROBE_COUNT_PARAM}=40`)).toBe(40);
    expect(probeCharacterCount(`?${PROBE_COUNT_PARAM}=20`)).toBe(20);
  });

  it('falls back to the real roster size for anything it cannot use', () => {
    // Total by construction. A probe that threw mid-run, or silently drew one sprite, would each
    // be worse than measuring the ordinary case: the first loses the whole benchmark, the second
    // publishes a figure against a load nobody applied.
    for (const search of ['', '?other=3', '?characters=', '?characters=abc', '?characters=-4', '?characters=0', '?characters=1.5']) {
      expect(probeCharacterCount(search)).toBe(12);
    }
  });

  it('caps the count, so a mistyped URL cannot ask for ten thousand sprites', () => {
    expect(probeCharacterCount(`?${PROBE_COUNT_PARAM}=100000`)).toBe(MAX_PROBE_CHARACTERS);
    expect(MAX_PROBE_CHARACTERS).toBeGreaterThanOrEqual(Math.max(...PROBE_CHARACTER_COUNTS));
  });
});

describe('the load is really applied', () => {
  it.each(PROBE_CHARACTER_COUNTS)('draws exactly %i characters, none of them dropped', (count) => {
    /**
     * The assertion this whole file exists for. `composeReadOnlyWorldViewModel` DROPS any
     * character missing from `spriteKeys` — FR-N004 AC#6 wants an unbound character rejected
     * rather than silently reskinned — so this runs the real composer over the real map and
     * counts what survives.
     *
     * Twelve would be the number if the synthetic sprite map were wrong, and twelve is also the
     * honest answer for the live page, which is exactly why a probe that quietly produced it
     * would be indistinguishable from a working one by frame rate alone.
     */
    const viewModel = composeReadOnlyWorldViewModel({
      map: mistwoodWorldMap,
      motions: probeMotions({
        count, mapWidth: mistwoodWorldMap.width, mapHeight: mistwoodWorldMap.height, nowMs: NOW,
      }),
      spriteKeys: probeSpriteKeys(count, mistwoodCharacterSpriteKeys),
      nowMs: NOW,
    });
    expect(viewModel.characters).toHaveLength(count);
    expect(count).toBeGreaterThan(Object.keys(mistwoodCharacterSpriteKeys).length);
  });

  it('reuses the real sprite keys rather than inventing sheets', () => {
    // Minting synthetic sheets would have measured a texture-cache miss rate no viewer will ever
    // see, and adding sheets to `MISTWOOD_CHARACTER_VISUALS` is the thing this design exists to
    // avoid: it would change what Mistwood IS to make a number appear.
    const real = new Set(Object.values(mistwoodCharacterSpriteKeys));
    const probe = probeSpriteKeys(40, mistwoodCharacterSpriteKeys);
    expect(Object.keys(probe)).toHaveLength(40);
    for (const key of Object.values(probe)) expect(real.has(key)).toBe(true);
    // Round-robin, so every sheet is exercised rather than forty copies of one.
    expect(new Set(Object.values(probe)).size).toBe(real.size);
  });

  it('names nothing that could be mistaken for a resident', () => {
    const probe = probeSpriteKeys(40, mistwoodCharacterSpriteKeys);
    const residents = new Set(Object.keys(mistwoodCharacterSpriteKeys));
    for (const characterId of Object.keys(probe)) {
      expect(characterId).toMatch(/^probe-\d\d$/u);
      expect(residents.has(characterId)).toBe(false);
    }
    expect(probeCharacterId(7)).toBe('probe-07');
  });

  it('keeps every character walking for longer than any sample window', () => {
    /**
     * The threshold is about sustained ANIMATION. An idle sprite is one texture and a static
     * transform, and forty of those would report a frame rate the renderer never has to produce —
     * a pass earned by measuring the wrong thing.
     *
     * `FPS_SAMPLE_MS` is four seconds; the walks run for ten minutes, so nothing arrives mid-
     * measure and turns into an idle halfway through the sample.
     */
    const motions = probeMotions({
      count: 40, mapWidth: mistwoodWorldMap.width, mapHeight: mistwoodWorldMap.height, nowMs: NOW,
    });
    for (const motion of motions) {
      expect(motion.animationState).toBe('walking');
      expect(motion.arriveAt - NOW).toBeGreaterThan(60_000);
      // ...and it is genuinely going somewhere. A walk whose destination equals its origin
      // interpolates to a standstill and animates nothing.
      expect({ x: motion.from.x, y: motion.from.y }).not.toEqual({ x: motion.to.x, y: motion.to.y });
    }
    // Both facings are exercised, so the figure is not measured against one walk cycle.
    expect(new Set(motions.map((motion) => motion.direction)).size).toBeGreaterThan(1);
  });

  it('spreads the cast over the map, inside its bounds', () => {
    // Forty sprites stacked at one point would let the renderer cull or overdraw its way to a
    // figure that does not generalise.
    const motions = probeMotions({
      count: 40, mapWidth: mistwoodWorldMap.width, mapHeight: mistwoodWorldMap.height, nowMs: NOW,
    });
    const points = new Set(motions.map((motion) => `${motion.from.x},${motion.from.y}`));
    expect(points.size).toBe(40);
    for (const motion of motions) {
      for (const point of [motion.from, motion.to]) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(mistwoodWorldMap.width);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(mistwoodWorldMap.height);
      }
    }
  });
});

describe('the probe cannot reach a shipped build', () => {
  it('is a second Vite input, added only under the E2E build literal', () => {
    const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    // A separate INPUT rather than a route: Vite builds `index.html` alone unless told otherwise,
    // so `bench.html` sitting in the repository root is not enough to ship it — this list is.
    expect(config).toMatch(/VITE_E2E_FIXTURE === '1'/);
    expect(config).toMatch(/isE2eBuild\s*\?\s*\{\s*bench:/);
  });

  it('is set by exactly one script, and that script writes to its own directory', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const setters = Object.entries(pkg.scripts)
      .filter(([, command]) => command.includes('VITE_E2E_FIXTURE'))
      .map(([name]) => name);
    expect(setters).toEqual(['build:e2e']);
    expect(pkg.scripts.build).not.toContain('VITE_E2E_FIXTURE');
  });

  it('gives no production module a benchmark branch', () => {
    /**
     * ART-173 AC#3. The three ways to drive the live page above twelve were all bad: invent
     * twenty-eight visual bindings (a world that does not exist, which ART-107 §8 forbids), give
     * the page an overridable sprite map (a benchmark seam in the shipped renderer), or mount the
     * renderer directly. This is the third, and the assertion below is what keeps it the third.
     */
    for (const path of [
      'src/App.tsx',
      'src/main.tsx',
      'src/components/live/LiveMapPage.tsx',
      'src/components/world/worldViewModel.ts',
      'data/mistwoodCharacters.ts',
    ]) {
      const source = readFileSync(join(ROOT, path), 'utf8');
      expect(source).not.toContain('spriteLoadWorld');
      expect(source).not.toContain('benchEntry');
      expect(source).not.toContain('bench.html');
    }
  });

  it('is its own module, and the production-reachable fixture may not depend on it', () => {
    /**
     * The probe mounts `ReadOnlyWorld` and the live page's two hooks, which `clientE2EFixture` is
     * forbidden to reach — and forbidden for a reason worth restating: `clientProvider`, a
     * production module, MAY depend on `clientE2EFixture` (that is how the fixture transport is
     * swapped in under the build literal). Widening `clientE2EFixture` to reach the renderer would
     * therefore have made the renderer reachable from the shipped provider by policy.
     *
     * So the probe is a separate module with the longer roots — `check-boundaries.mjs` resolves a
     * file to its longest matching root — and the assertion below is the guarantee: nothing the
     * provider can reach is allowed to name this module.
     */
    const policy = JSON.parse(readFileSync(join(ROOT, 'architecture/module-boundaries.json'), 'utf8')) as {
      modules: Record<string, { roots: string[]; mayDependOn: string[] }>;
    };
    expect(policy.modules.clientBenchProbe.roots.slice().sort()).toEqual([
      'src/e2e/benchEntry.tsx',
      'src/e2e/spriteLoadWorld.ts',
    ]);
    expect(policy.modules.clientProvider.mayDependOn).toContain('clientE2EFixture');
    expect(policy.modules.clientE2EFixture.mayDependOn).not.toContain('clientBenchProbe');
    expect(policy.modules.clientProvider.mayDependOn).not.toContain('clientBenchProbe');
    // ...and no other module may either. The probe is a leaf: things it reaches, nothing reaches it.
    for (const [name, definition] of Object.entries(policy.modules)) {
      if (name === 'clientBenchProbe') continue;
      expect({ name, reachesProbe: definition.mayDependOn.includes('clientBenchProbe') })
        .toEqual({ name, reachesProbe: false });
    }
  });

  it('is reached only from within src/e2e and the benchmark itself', () => {
    // The same rule `fixtureScenario.test.ts` applies to the scenario knob: the probe must not
    // acquire a caller on the shipped side of the gate.
    const bench = readFileSync(join(ROOT, 'bench/dynamicView.bench.ts'), 'utf8');
    expect(bench).toContain("from '../src/e2e/spriteLoadWorld'");
    const entry = readFileSync(join(ROOT, 'src/e2e/benchEntry.tsx'), 'utf8');
    expect(entry).toContain("from './spriteLoadWorld'");
  });
});
