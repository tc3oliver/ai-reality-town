---
id: ART-154
title: >-
  Proposal review queries still accept the shared ops token after a Clerk
  cutover
status: To Do
assignee: []
created_date: '2026-09-06 02:39'
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
- [ ] #1 requireReviewer resolves allowTokenFallback from the same environment inputs the ops console uses, in one shared helper rather than a second copy
- [ ] #2 With CLERK_JWT_ISSUER_DOMAIN set and SIMULATION_OPS_ALLOW_TOKEN_FALLBACK unset, listProposedEventReviews and reviewProposedEvent reject a request whose only credential is the shared token
- [ ] #3 A test fails if either query regains a token-only success path under that configuration
- [ ] #4 Every remaining call site of authorizeOperator is checked for the same omission and the audit doc records the result
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [ ] #2 Relevant automated tests are added or updated
- [ ] #3 Typecheck passes
- [ ] #4 Lint passes
- [ ] #5 Relevant tests pass
- [ ] #6 Build passes when applicable
- [ ] #7 No known regression is introduced
- [ ] #8 No secret or credential is committed
- [ ] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [ ] #11 Implementation notes are complete
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->
