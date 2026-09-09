/**
 * The one definition of what a resumable run record says about a FAILED attempt (ART-150).
 *
 * Both stage orchestrators — `simulation/worldDayOrchestration` for PRD §12 stages 1–10 and
 * `operations/postCommitOrchestration` for stages 11–21 — persist a run through an injected store,
 * and both run records carry `failureStage`, `errorCode` and `errorMessage`. Those three describe
 * ONE attempt. `status` describes the run. A record that says `completed` and still names an error
 * code answers the same question twice, and the operations surface reads the wrong answer: a
 * successful run becomes indistinguishable from a failed one, and any failure rate built on it
 * over-counts.
 *
 * The orchestrators cannot enforce this themselves — they delegate the write and return what
 * `loadRun` gives back — so it is a term of the STORE contract, and this module is where that term
 * is written down. `resumeRun` opens a new attempt and must clear the previous attempt's failure;
 * `completeRun` must not leave one standing.
 *
 * The Convex adapters satisfy it implicitly: `db.patch` REMOVES a field patched to `undefined`, and
 * their patch helpers name all three fields on every call. Every hand-written in-memory store uses
 * `Object.assign`, which has no such rule, so each one has to spread this constant to say the same
 * thing. Before ART-150 four of the five implementations did not, which is why the long-run
 * harness's completed slots reported error codes the deployment would have cleared.
 */

/**
 * Spread into a store's `resumeRun` / `completeRun` patch to retire the previous attempt's failure.
 *
 * Typed as the optional fields both run records share rather than as a broader record, so a store
 * that spreads it into the wrong object fails to typecheck instead of silently deleting nothing.
 */
export const CLEARED_RUN_FAILURE: {
  readonly failureStage: undefined;
  readonly errorCode: undefined;
  readonly errorMessage: undefined;
} = { failureStage: undefined, errorCode: undefined, errorMessage: undefined };

/**
 * Whether a run record contradicts itself: a non-failed run that still names a failure.
 *
 * Exported for the operations surface and for the store-conformance tests, so "the record is
 * self-consistent" is a checkable claim rather than an argument about which patch calls run in
 * which order.
 */
export function runRecordCarriesStaleFailure(run: {
  status: string;
  failureStage?: string;
  errorCode?: string;
  errorMessage?: string;
}): boolean {
  if (run.status === 'failed') return false;
  return run.failureStage !== undefined || run.errorCode !== undefined || run.errorMessage !== undefined;
}
