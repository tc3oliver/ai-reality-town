/**
 * Which world state the fixture should serve (FR-Q005 / ART-136).
 *
 * ## Why a knob at all
 *
 * NFR2-002 asks for performance figures in four states: normal stream, delayed stream,
 * snapshot, and degraded. Two of them are reachable from the browser alone — `stream` is the
 * default and `degraded` is produced by denying WebGL, which the benchmark does by overriding
 * `getContext` before any application code runs. The other two are facts about what the SERVER
 * returned, and no amount of browser manipulation can produce them.
 *
 * ## Why this is not a production test hook
 *
 * It reads a global, which is exactly the kind of runtime escape `fixtureIsolation.test.ts`
 * refuses in `fixtureConvexClient.ts` — and the reason it refuses there is specific: that file
 * holds the GATE, and a gate Vite cannot constant-fold survives into the production bundle.
 * This file is not a gate. It lives inside `src/e2e/`, which the whole of production reaches
 * through exactly one import, inside one branch, on one build-time literal. When
 * `VITE_E2E_FIXTURE` is not `'1'` that branch folds away and nothing here is reachable — or
 * even present.
 *
 * `fixtureScenario.test.ts` pins that this module is imported only from within `src/e2e/`, so
 * the knob cannot acquire a second caller on the shipped side of the gate.
 *
 * Default is `stream`: a benchmark that forgot to set the scenario measures the ordinary page,
 * which is the honest failure mode. Anything else would let a mis-set knob silently report
 * degraded-mode figures as normal ones.
 */

export const FIXTURE_SCENARIOS = ['stream', 'delayed', 'snapshot'] as const;
export type FixtureScenario = (typeof FIXTURE_SCENARIOS)[number];

/**
 * The global the benchmark sets through `page.addInitScript`.
 *
 * Namespaced by task number, like `__ART137__`, so a reader can find what put it there.
 */
export const FIXTURE_SCENARIO_GLOBAL = '__ART136_SCENARIO__';

/** The scenario in force, defaulting to `stream` for anything unrecognised. */
export function fixtureScenario(): FixtureScenario {
  const declared = (globalThis as Record<string, unknown>)[FIXTURE_SCENARIO_GLOBAL];
  return (FIXTURE_SCENARIOS as readonly string[]).includes(declared as string)
    ? (declared as FixtureScenario)
    // Total by construction: an unknown value measures the normal page rather than throwing
    // mid-benchmark or, worse, quietly measuring some other state.
    : 'stream';
}
