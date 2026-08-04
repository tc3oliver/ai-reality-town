---
id: ART-43
title: Privacy-safe public character pages
status: In Progress
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-04 02:00'
labels:
  - prd-1.0
  - epic-k
milestone: m-0
dependencies:
  - ART-40
  - ART-84
  - ART-70
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-I005

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Deliver public character pages with all allowed profile, state, relationship, event, arc, and dramatic-irony fields while server-side controls exclude private memories, hidden secrets, prompts, raw output, and admin notes.

Scope
Deliver public character pages with all allowed profile, state, relationship, event, arc, and dramatic-irony fields while server-side controls exclude private memories, hidden secrets, prompts, raw output, and admin notes.

Out of Scope
Adjacent PRD requirements assigned to separate tasks, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-40, ART-84, ART-70

Schema Impact
No Canon mutation schema; owns published read-model records, query DTOs, cache/version metadata, or UI state explicitly named by the task.

API Impact
Read-only public query contracts and internal projection writers; UI never calls providers.

Security Impact
Server-side field allowlists, publication status, accessibility, and secret/privacy boundaries apply to every public view.

Validation Commands
npm run check; run the focused test command added by this task and record its exact invocation in implementation notes.

Test Requirements
Automated tests cover every mapped PRD acceptance condition, negative case, and failure boundary.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-I005: Character page exposes name/image, age/occupation, public background, current state, public goal, primary relationships, recent major events, arcs, viewer-known secrets, and dramatic-irony facts.
- [x] #2 FR-I005: Character page never exposes unrevealed Canon secrets, complete private memories, prompts, raw model output, or administrator notes.
- [x] #3 Server-side field allowlists and authorization tests enforce the public/private boundary.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [x] #2 Relevant automated tests are added or updated
- [x] #3 Typecheck passes
- [x] #4 Lint passes
- [x] #5 Relevant tests pass
- [x] #6 Build passes when applicable
- [x] #7 No known regression is introduced
- [x] #8 No secret or credential is committed
- [ ] #9 Documentation is updated
- [x] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [x] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
ART-43 public character page (FR-I005). Route #character/<worldId>/<characterId> (world-scoped, like #episode; needs worldId for the read). Mirror homepage pattern: pure characterRoute.ts + test + CharacterPage.tsx + App mount.

DATA: character / character:<characterId> -> CharacterProjection (name, age, occupation, publicProfile, personality, values, publicGoal, health/emotional/financial state, alive/active) + optional timeline / timeline:<worldId> filtered to this character (recent major events).

AC mapping:
- AC#1: render identity card (name/age/occupation/public background/current state/public goal) from the projection + recent major events from timeline (graceful omit for fields not in the read model: image/relationships/arcs/viewer-secrets/dramatic-irony -> honest absent states).
- AC#2/#3 PRIVACY (the core): composeCharacterViewModel carries ONLY allowlisted fields; a defense-in-depth guard + test asserts forbidden keys (privateProfile, knowledge, memory, prompt, rawModelOutput, adminNotes) NEVER appear in the view model even if the input payload contained them. Server-side allowlist is ART-84 (buildCharacterProjection) + sanitizeForPublic; this is the page-layer guard.

Reads via getPublishedReadModel (no generation). VALIDATE: npm run check; privacy guard test is the AC#2/#3 evidence.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation: src/components/public/characterRoute.ts (pure parseCharacterRoute + composeCharacterViewModel + forbiddenKeysInViewModel) + characterRoute.test.ts (7 cases) + CharacterPage.tsx (thin render layer), mounted at #character/<worldId>/<characterId> in App.tsx.

PRIVACY (AC#2/#3 — the core): the view model is constructed from NAMED allowlisted fields only; it never spreads/copies the input payload. Headline test smuggles privateProfile, privateGoal, knowledge, memory, prompt, rawModelOutput, adminNotes, secret, token into the payload and asserts forbiddenKeysInViewModel(vm) === [] AND that none of the forbidden VALUES appear in the serialised model. This is page-layer defence-in-depth on top of the server-side allowlist (ART-84 buildCharacterProjection excludes forbidden fields) + sanitizeForPublic re-sanitisation on read (ART-40).

DATA: character/character:<id> projection + timeline/timeline:<worldId> filtered to this character for recent major events. Reads via getPublishedReadModel — no generation on read.

AC#1 SCOPE CAVEAT (why not checked): the published character projection carries name/age/occupation/publicProfile/publicGoal/personality/values/health-emotional-financial state — all rendered — plus recent major events from the timeline. It does NOT yet carry: character image, primary relationships, arc memberships, viewer-known secrets, or dramatic-irony facts. Those need projection-side work (relationship projection exists per-pair as relationship:<pairKey> but there is no per-character relationship index; no image/secret/irony fields exist in any published model). Page renders honest absent states for them rather than faking data. Follow-up task needed to extend the character projection before AC#1 can be fully satisfied.

Focused test: NODE_OPTIONS=--experimental-vm-modules npx jest --testPathPattern=characterRoute -> 7 passed, 7 total. Full: npm run check -> exit 0 (architecture 11 modules + typecheck + lint + full jest + vite build).
<!-- SECTION:NOTES:END -->
