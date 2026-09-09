---
id: ART-171
title: Give the FR-K004 publication lifecycle an operator entry point
status: To Do
assignee: []
created_date: '2026-09-09 17:18'
labels:
  - prd-1.0
  - epic-k
dependencies: []
priority: high
ordinal: 171000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FR-K004 reserves the administrator-only lifecycle actions, and `assertAuthorized` enforces that. Nothing in the deployment can invoke any of them.

`advancePublication` (`convex/editorial/publicationLifecycleFunctions.ts`) is an internalMutation whose only caller is `postCommitLiveFunctions.ts`, and that call site is typed `validate | begin_safety_review | pass_safety_review | withhold` — the four a system actor may take. So the automated pipeline walks every Episode to `ready` and stops, and no Episode in any world has ever reached the released state.

Found while delivering ART-169. Consequences visible today:

- FR-I005 觀眾已知秘密 and 角色不知道但觀眾知道的資訊 are correctly empty on every character page, because a secret is only viewer-known once a released Episode revealed the event that said it. The join is right; there is nothing for it to join to.
- The administrator-only entries in `PUBLICATION_TRANSITIONS`, `PUBLICATION_SUPPRESSED` on that path, and `regeneratePublication` have zero production callers.
- ART-138 cannot produce release evidence for the FR-K004 administrator gate, because the gate has no caller to exercise.

Scope: an operator-gated command that advances a publication record, on the ART-48 console surface where every other operator command lives, plus the read-model refresh a transition has to trigger (`refreshViewerKnowledgeProjections` at minimum — the character page is the surface it changes). Adding a public function is an architectural change: `publicFunctionSurface` in `architecture/module-boundaries.json` and the exhaustive lists in `publicReadOnlyGuarantee.test.ts` / `readOnlyWorldSurface.test.ts` must be updated in the same commit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An authenticated administrator can advance an Episode publication record through the FR-K004 admin-only actions, and an operator who is not an administrator cannot
- [ ] #2 The command records the same audit trail (actor, reason, timestamp, version delta) the lifecycle already requires, and performs zero Canon writes
- [ ] #3 A released or withheld Episode recomputes every public read model whose contents depend on publication status, in the same transaction
- [ ] #4 A fault injection proves the administrator gate: removing the authorization check turns a named test red
- [ ] #5 Once an Episode is released, a character page shows the FR-I005 viewer-known secret its events revealed — proven end to end, not by unit test alone
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
