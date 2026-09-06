---
id: ART-154
title: >-
  Proposal review queries still accept the shared ops token after a Clerk
  cutover
status: Done
assignee:
  - '@claude'
created_date: '2026-09-06 02:39'
updated_date: '2026-09-06 02:48'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 154000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ART-62 re-audit finding H-1 (Still Open). `convex/operations/opsConsoleFunctions.ts:98-99` computes `allowTokenFallback = SIMULATION_OPS_ALLOW_TOKEN_FALLBACK === "1" || !CLERK_JWT_ISSUER_DOMAIN` and passes it to `authorizeOperator`, so the shared static token stops being accepted once an identity provider is configured. `convex/operations/proposalReviewFunctions.ts` `requireReviewer` (around :64-75) omits the field entirely, and `authorizeOperator` defaults `input.allowTokenFallback ?? true` (`convex/operations/operatorAuthorization.ts:419`). The two public queries that use it — `listProposedEventReviews` and `reviewProposedEvent` — therefore keep honouring the shared token permanently, and they return raw model output, model traces and safety labels. Verified against the current Convex deployment environment on 2026-09-06: `CLERK_JWT_ISSUER_DOMAIN` is set and `SIMULATION_OPS_ALLOW_TOKEN_FALLBACK` is not, i.e. this is the exact configuration under which the two code paths disagree. The docstring on `requireReviewer` claims the gate is "identical to the console gate", which is what let the divergence survive review. See docs/security-audit-art-62.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 requireReviewer resolves allowTokenFallback from the same environment inputs the ops console uses, in one shared helper rather than a second copy
- [x] #2 With CLERK_JWT_ISSUER_DOMAIN set and SIMULATION_OPS_ALLOW_TOKEN_FALLBACK unset, listProposedEventReviews and reviewProposedEvent reject a request whose only credential is the shared token
- [x] #3 A test fails if either query regains a token-only success path under that configuration
- [x] #4 Every remaining call site of authorizeOperator is checked for the same omission and the audit doc records the result
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All acceptance criteria are satisfied
- [x] #2 Relevant automated tests are added or updated
- [x] #3 Typecheck passes
- [x] #4 Lint passes
- [x] #5 Relevant tests pass
- [x] #6 Build passes when applicable
- [x] #7 No known regression is introduced
- [x] #8 No secret or credential is committed
- [x] #9 Documentation is updated
- [x] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [x] #13 Changes are committed and pushed
- [x] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Confirm the defect against current main and against the live deployment configuration, not against the audit report.
2. Delete the second gate rather than repair it: `requireReviewer` delegates to `opsConsoleFunctions.requireOperator`, which is already exported precisely so additional console surfaces reuse it. Import the shared `credentialArgs` too, so the two surfaces cannot drift on the argument shape either.
3. Correct the module docstring, which asserted the authorization was ART-48s "verbatim" and "unchanged" while the code kept its own copy — the false claim is what let the divergence survive review.
4. Prove the fix through the REGISTERED QUERIES, not through the pure policy module. The existing coverage called `authorizeOperator` directly and so could never see a missing argument at a call site it did not use.
5. Add a structural guard: `authorizeOperator` may be called from exactly one production file. Considered and rejected making `allowTokenFallback` a required parameter — that would force the deployment env into unit tests of the pure policy, where the default is correct.
6. Fault-inject the original defect and require the right tests to turn red.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implemented 2026-09-06

Deleted the second gate rather than repairing it. `requireReviewer` is now a one-line delegation to `opsConsoleFunctions.requireOperator`, and `credentialArgs` is imported from the same module so the two surfaces cannot drift on argument shape either. `authorizeOperator` and `parseOperatorRegistry` are no longer imported by `proposalReviewFunctions.ts` at all.

The module header claimed the authorization was ART-48s "verbatim" and "unchanged" while the code kept its own copy. That claim is what let the divergence survive review, so it was replaced with an account of the actual defect rather than quietly deleted.

### Why the existing tests could never have caught this

`proposalReview.test.ts` covers review authorization — and covers it by calling `authorizeOperator` directly, supplying `registry` and `capability` by hand. The pure policy was never wrong. The WIRING was, and a test that constructs the policy call itself cannot see an argument missing from a call site it does not use. `proposalReviewGate.test.ts` therefore drives the registered `query` exports through `_handler`, with `process.env` set to the deployments real configuration.

### The structural guard, and what was rejected

`allowTokenFallback` is optional on `authorizeOperator` and defaults to `true`, so every direct caller is one forgotten line from a permanently open token path. Making the parameter REQUIRED was considered and rejected: it would force the deployment env into unit tests of the pure policy, where the default is correct and the env is out of scope. The narrower fix is to constrain who may call it — the test now pins that exactly one production file under `convex/` calls `authorizeOperator`, and names it. A third surface repeating this mistake fails the build.

AC#4 is answered by that same test: there were exactly two production call sites, `opsConsoleFunctions.ts:100` and `proposalReviewFunctions.ts:69`. The second was the defect. There is now one.

### Verification

- `npm test -- --runTestsByPath convex/operations/proposalReviewGate.test.ts` — 10/10 pass.
- FAULT INJECTION: restoring the original `requireReviewer` body turned exactly 3 tests red — both behavioural denials and the call-site guard — while the 7 that should be insensitive stayed green. Restored, all green.
- Related suites together (gate + proposalReview + opsConsole + operatorAuthorization): 157/157.
- `npm run check`: 204 suites, 3303 passed, 6 skipped, build green. Baseline before this change was 203 suites / 3293 passed, i.e. the delta is exactly this files 10 tests and nothing else moved.

### Environment half, recorded because it changes the severity

`npx convex env list` on 2026-09-06 shows `CLERK_JWT_ISSUER_DOMAIN` set and `SIMULATION_OPS_ALLOW_TOKEN_FALLBACK` unset. That is precisely the configuration under which the two gates disagreed, so this was a live defect and not a latent one. It also closes sub-questions (a) and (b) of audit finding H-1.

NOT closed, and deliberately not claimed: whether `operatorToken` appears in Convex function logs (H-1(c)). That needs a live deployment log, and the deployment is currently disabled for exceeding free-plan limits.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed the review surfaces private copy of the operations-console authorization gate, which called `authorizeOperator` without `allowTokenFallback` and so kept honouring the shared static ops token after a Clerk cutover — on two PUBLIC queries that return raw model output, model traces and safety labels. `requireReviewer` now delegates to `opsConsoleFunctions.requireOperator`, the wrapper that derives that flag from `CLERK_JWT_ISSUER_DOMAIN` / `SIMULATION_OPS_ALLOW_TOKEN_FALLBACK`.

This was a live defect, not a latent one: `npx convex env list` confirms the deployment has the issuer domain set and the escape hatch unset — exactly the configuration under which the two gates disagreed.

Because the parameter is optional and defaults to open, fixing the call site alone would leave the next surface one forgotten line from the same bug. `proposalReviewGate.test.ts` therefore also pins the call graph: exactly one production file under `convex/` may call `authorizeOperator`, and it is the env-reading wrapper.

Verified by fault injection rather than inspection — restoring the original body turned exactly the two behavioural denials and the call-site guard red, and left the seven insensitive tests green. `npm run check` is green at 204 suites / 3303 passed / 6 skipped, up from 203 / 3293, a delta of exactly this files 10 tests.

Also corrected the module header, which asserted the authorization was ART-48s "verbatim" and "unchanged" — the false claim that let the divergence survive review — and updated docs/security-audit-art-62.md, moving H-1 from STILL OPEN to RESOLVED except sub-question (c), which stays ENVIRONMENT BLOCKED: whether the token appears in Convex function logs needs a live log, and the deployment is disabled for exceeding free-plan limits.
<!-- SECTION:FINAL_SUMMARY:END -->
