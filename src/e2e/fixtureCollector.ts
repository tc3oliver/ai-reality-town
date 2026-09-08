/**
 * Whether the fixture's analytics collector accepts or refuses (§15 / ART-47).
 *
 * ## Why this is a separate module and not a URL parameter
 *
 * The first version read `window.location`, inside `fixtureConvexClient.ts`, and
 * `fixtureIsolation.test.ts` refused it — correctly. That file holds the GATE, and the whole
 * reason its gate is a build-time literal is that Vite can constant-fold it away; a runtime escape
 * ANYWHERE in that file is a way the fixture could switch itself on in a production bundle.
 *
 * So this follows {@link ./fixtureScenario.ts} exactly: a global the spec sets through
 * `page.addInitScript`, in its own module inside `src/e2e/`, which the whole of production reaches
 * through one import inside one branch on one build-time literal. When `VITE_E2E_FIXTURE` is not
 * `'1'` that branch folds and nothing here is reachable — or even present.
 *
 * ## Why the fixture needs two collector states at all
 *
 * The transport behaves differently against each, and both are real:
 *
 *  - **Accepting.** Batches keep flowing, so a spec can read what a real interaction produced. This
 *    is the default, because a collector that refused everything would make only the page-open
 *    events observable — a rejected batch stays in flight and every retry re-sends it, so nothing
 *    queued afterwards is ever delivered.
 *  - **Refusing.** The failure case, and the one the product's rule is about: analytics failure must
 *    never reach a viewer. A run in which every batch is rejected is the strongest available test
 *    of it.
 *
 * Default is ACCEPT, for the reason `fixtureScenario` defaults to `stream`: a spec that forgot to
 * set the knob exercises the ordinary path, which is the honest failure mode.
 */

/** The global the spec sets. Namespaced by task number, like `__ART137__`. */
export const FIXTURE_COLLECTOR_GLOBAL = '__ART47_COLLECTOR__';

/** Whether this run's fixture collector should reject every batch. */
export function fixtureCollectorRefuses(): boolean {
  return (globalThis as Record<string, unknown>)[FIXTURE_COLLECTOR_GLOBAL] === 'refuse';
}
