---
id: ART-105
title: Re-enable operator login UI for Clerk activation
status: Done
assignee:
  - '@oliver'
created_date: '2026-08-04 13:43'
updated_date: '2026-08-04 14:26'
labels: []
dependencies: []
priority: high
ordinal: 105000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Re-enable the commented-out Clerk login UI in src/App.tsx (UserButton/LoginButton, lines 15-17 and 97-105) so an operator can sign in from the browser and obtain their Clerk 'subject' claim. This subject value must be registered in the SIMULATION_OPS_OPERATORS deployment env var (see docs/agent/OPERATOR-AUTH.md) to actually authorize any operator for the H-1 identity-based console (ART-104). Without this UI there is no way for a human to sign in and discover their subject.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Uncommenting restores compile-clean UserButton (signed-in) / LoginButton (signed-out) in App.tsx top-right corner
- [x] #2 npm run dev renders a working sign-in button when VITE_CLERK_PUBLISHABLE_KEY is set, and renders nothing extra (today's behavior) when it is unset
- [x] #3 After signing in, describeOperatorSession (or an equivalent authenticated call) is confirmed reachable so the operator's Clerk subject can be read and copied into SIMULATION_OPS_OPERATORS
- [x] #4 npm run check passes
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All acceptance criteria are satisfied
- [ ] #2 Relevant automated tests are added or updated
- [x] #3 Typecheck passes
- [x] #4 Lint passes
- [x] #5 Relevant tests pass
- [x] #6 Build passes when applicable
- [x] #7 No known regression is introduced
- [x] #8 No secret or credential is committed
- [ ] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Uncomment the Clerk UserButton/LoginButton block in src/App.tsx (lines 15-17 import, 97-105 JSX). No new code - restoring what ConvexClientProvider.tsx already conditionally supports (ClerkProvider mounts only when VITE_CLERK_PUBLISHABLE_KEY is set). Verify npm run check passes. Manually verify npm run dev renders the button.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Uncommented the Clerk UserButton/LoginButton block in src/App.tsx (import lines 15-17, JSX block ~97-105, and the Unauthenticated 'Log in to join the town' hint). No new code - ConvexClientProvider.tsx already conditionally mounts ClerkProvider when VITE_CLERK_PUBLISHABLE_KEY is set. Verified: npm run check passes (typecheck/lint/test/build clean). Manually verified in browser via npm run dev at localhost:5173/ai-town - login button renders top-right, confirmed by user.

AC#3 verified end-to-end via ego-browser automation: signed in with real Google OAuth through Clerk, obtained a convex-templated JWT, and called describeOperatorSession directly against the Convex deployment. Result: {operatorId: ops-oliver, role: admin, source: identity} - confirms the H-1 identity path (ART-104) is fully live, not just code-complete. Registered SIMULATION_OPS_OPERATORS with the operator's bare Clerk sub claim (user_3HSAziv8kJ637CjV178Zh4EnKm8) - NOT the issuer|sub format initially guessed; resolveOperatorPrincipal in operatorAuthorization.ts tries identity.subject (the bare sub) before falling back to tokenIdentifier. Three activation blockers found and fixed along the way, none of them code bugs: (1) Clerk app had no JWT template named 'convex' - user created one in the Clerk dashboard; (2) the template existed but had no 'aud' claim, so the issued token's aud never matched applicationID: 'convex' in auth.config.ts, silently failing Convex's identity check - user added {"aud": "convex"} to the template's custom claims; (3) SIMULATION_OPS_OPERATORS was first set with an issuer|sub-style subject that does not match what resolveOperatorPrincipal actually reads - corrected to the bare sub. Recommend folding these three gotchas into docs/agent/OPERATOR-AUTH.md as a follow-up (not done here - out of this task's scope).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Re-enabled the Clerk login UI in src/App.tsx (UserButton/LoginButton, plus the join-town hint) that had been commented out. Verified via npm run check (typecheck/lint/test/build clean) and end-to-end in a real browser: signed in via Google through Clerk, confirmed UserButton renders with the correct avatar, and called describeOperatorSession which returned {operatorId: ops-oliver, role: admin, source: identity} - proving the H-1 identity-based operator path (ART-104) is fully activated, not just code-complete. Along the way, fixed three Clerk/Convex activation gaps that are not code bugs: missing 'convex' JWT template, missing 'aud' claim on that template, and an incorrect subject format when registering SIMULATION_OPS_OPERATORS (must be the bare Clerk sub, not issuer|sub).
<!-- SECTION:FINAL_SUMMARY:END -->
