---
id: ART-71
title: Authenticated viewer follows and progress
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 15:43'
updated_date: '2026-09-09 14:30'
labels:
  - prd-1.0
  - epic-l
milestone: m-1
dependencies:
  - ART-39
  - ART-70
  - ART-47
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: low
type: feature
ordinal: 71000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-J003

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Implement the P2 authenticated ability to follow characters/arcs, persist cross-device progress, and view personalized return recaps.

Scope
Implement the P2 authenticated ability to follow characters/arcs, persist cross-device progress, and view personalized return recaps.

Out of Scope
Adjacent PRD requirements, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-39, ART-70, ART-47

Schema Impact
Viewer Intervention, vote, consequence, analytics, or authenticated progress schemas explicitly named by the task.

API Impact
Untrusted viewer command/ingestion interfaces and privacy-safe read/aggregate queries.

Security Impact
Rate limits, authorization, injection defenses, data minimization, and no direct character control are mandatory.

Validation Commands
npm run check; run the focused test command added by this task and record its exact invocation in implementation notes.

Test Requirements
Automated tests cover every acceptance criterion and all stated negative or failure cases.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-J003: Authenticated viewers can follow characters and Story Arcs.
- [x] #2 FR-J003: Viewing progress persists across devices.
- [x] #3 FR-J003: Personalized return recap uses followed characters/arcs and saved progress.
- [x] #4 Authorization prevents one viewer from reading or modifying another viewer’s progress.
- [x] #5 Following a character or Story Arc emits the corresponding privacy-safe character_followed or story_arc_followed analytics event through ART-47 without exposing private progress data.
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
1. Establish whether the auth substrate exists: ART-104 configured Clerk, and ART-39 left an unreachable 'auth' viewer-key namespace for exactly this task.
2. Write the authenticated key and the merge as pure functions; the merge is where FR-H004 AC#7's three words each become a property.
3. Add as few viewer-write surfaces as the requirement allows — fold the authenticated read and write into the existing endpoints, which is safer as well as smaller.
4. Raise the write cap deliberately, in all four places the policy requires to agree.
5. Fault injections at both layers; state the evidence boundary (no live Clerk credential) rather than simulating one.
6. npm run check, npm run e2e, closure matrix, docs/authenticated-viewer-progress.md.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed after PR merged; npm run check and npm run e2e green on the merged branch.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
ART-39 delivered the anonymous half and refused to simulate this one, because 「已登入進度」 was a provably empty set; ART-104 configured the identity provider and VIEWER_KEY_NAMESPACES has carried an unreachable 'auth' namespace since ART-39 for exactly this task. Delivered as ONE new write surface, not three: getViewerProgress and recordViewerProgress now prefer a VERIFIED identity over the presented token — folding rather than adding is smaller and safer, since two endpoints would let a signed-in client reach the anonymous row by calling the wrong one. Only the merge is new, because FR-H004 AC#7 requires it to be explicit rather than a side effect of signing in. No handler accepts a subject; the key comes from ctx.auth.getUserIdentity() and is stored as a digest. The merge is AC#7's three words as three properties: 明確 (its own operation), 經授權 (both a verified identity and the device token), 無損 (a union whose position takes the further of the two, with everything the caps cannot keep RETURNED — mergeWasLossless is computed, not asserted). The device row is left untouched, so a merge that went wrong has lost nothing. viewerWriteBoundary.maxViewerMutations moved 2 to 3, declared in the four places the policy requires to agree; no new client root. Verified: 7 injections each turning named tests red, with two attempts recorded as rejected (one changed nothing observable, one failed to compile). npm run check exit 0 (4251 passed, 247 suites); npm run e2e 114 passed. NOT proven: Convex's JWT verification — no live Clerk credential exists here, and that code is Convex's; docs/authenticated-viewer-progress.md §6 states the boundary. PR #261 merged.
<!-- SECTION:FINAL_SUMMARY:END -->
