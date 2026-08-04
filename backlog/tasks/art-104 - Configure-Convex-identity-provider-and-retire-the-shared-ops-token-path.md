---
id: ART-104
title: Configure Convex identity provider and retire the shared ops-token path
status: In Progress
assignee:
  - '@oliver'
created_date: '2026-08-04 10:36'
updated_date: '2026-08-04 12:38'
labels: []
dependencies: []
ordinal: 104000
---

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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Audit H-1. Configure Clerk as Convex identity provider and retire the shared ops-token. (1) convex/auth.config.ts: Clerk provider active only when CLERK_JWT_ISSUER_DOMAIN set. (2) operatorAuthorization: allowTokenFallback flag on resolveOperatorPrincipal/authorizeOperator (default true, back-compat). (3) opsConsoleFunctions.requireOperator: token branch closes when CLERK_JWT_ISSUER_DOMAIN set (escape hatch SIMULATION_OPS_ALLOW_TOKEN_FALLBACK=1). (4) ConvexClientProvider: ClerkProvider gated on VITE_CLERK_PUBLISHABLE_KEY; bumped @clerk/clerk-react to ^5 (Convex peer range) to resolve type skew. (5) docs/agent/OPERATOR-AUTH.md runbook. Tests: operatorAuthorization.test.ts +3 (gate behaviour + requireOperator structural). Activation by user via env vars (no lockout before keys set).
<!-- SECTION:PLAN:END -->
