---
id: ART-171
title: Give the FR-K004 publication lifecycle an operator entry point
status: Done
assignee:
  - '@claude'
created_date: '2026-09-09 17:18'
updated_date: '2026-09-09 18:22'
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
- [x] #1 An authenticated administrator can advance an Episode publication record through the FR-K004 admin-only actions, and an operator who is not an administrator cannot
- [x] #2 The command records the same audit trail (actor, reason, timestamp, version delta) the lifecycle already requires, and performs zero Canon writes
- [x] #3 A released or withheld Episode recomputes every public read model whose contents depend on publication status, in the same transaction
- [x] #4 A fault injection proves the administrator gate: removing the authorization check turns a named test red
- [x] #5 Once an Episode is released, a character page shows the FR-I005 viewer-known secret its events revealed — proven end to end, not by unit test alone
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
1. Reuse, do not reimplement. `advancePublication` (internalMutation) already applies the pure lifecycle, enforces `assertAuthorized`'s admin-only rule, appends the audit event and honours ART-162's publication gate. The new operator command calls it through `ctx.runMutation` rather than restating any of that.
2. New admin-only capability `publication.decide` in `operatorAuthorization.ts`, beside `safety.override` — which is admin for the reason its own comment gives, that it is a publication decision.
3. New `convex/operations/publicationControlFunctions.ts`, modelled on `safetyOverrideFunctions.ts`: authorize FIRST, require a reason, address the Episode by world day, apply the transition, refresh the public surface in the SAME transaction, audit after the refresh so the record carries whether it reached anything.
4. Close the gap the new capability opens. `rebuildEpisodeProjection` reads only `dailyEpisodes.status`; it has never read the publication record. That is consistent TODAY only because the sole path to `withheld` is the pipeline's own, which fires exactly when the episode row is not `ready` and the rebuild is skipped. Giving an administrator an independent `withhold` breaks that coupling, so the episode read model must honour the record — otherwise the command would expose a withhold that withholds nothing.
5. Architectural change, done in one commit: `publicFunctionSurface` in `architecture/module-boundaries.json`, plus the exhaustive pinned lists in `publicReadOnlyGuarantee.test.ts` and `readOnlyWorldSurface.test.ts`.
6. Evidence: injections on the authorization gate, the reason requirement, the admin-only lifecycle rule, the publication gate, and the episode read model's new publication dependency. Plus an integration test driving publish → read-model refresh → `composeCharacterViewModel`, so AC#5's viewer-known secret is proven through the real handlers rather than by unit test alone.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was actually missing

Not a UI. `advancePublication` was reachable only from `postCommitLiveFunctions.ts`, and that call site types the action as `validate | begin_safety_review | pass_safety_review | withhold` — the four a SYSTEM actor may take. `assertAuthorized` has always reserved the other four for an administrator. So the administrator half of FR-K004 had no caller at all: no record in any world has ever been released, and the `withhold` an administrator is supposed to be able to apply had never been applied by one.

## The gap the new capability OPENED, and why it is in scope

`rebuildEpisodeProjection` read only `dailyEpisodes.status` — a SAFETY decision — and never looked at the publication record FR-K004 says governs visibility. That was consistent right up to this task, and only by accident: the sole path to `withheld` was the pipeline's own, which fires exactly when the episode row is not `ready` and the rebuild is skipped. An INDEPENDENT administrator withhold breaks the coupling, and without the fix the command would have shipped a withhold that the next accepted event undid. That is not scope creep; it is the correctness requirement the new capability creates, and it has its own named test.

## Decisions worth keeping

- **The lifecycle is not reimplemented.** The command calls `advancePublication` through `ctx.runMutation`, so the transition table, the admin-only rule, the audit event and ART-162's publication gate all stay in one place. What the command owns is what the lifecycle cannot see: authorization against the operator REGISTRY, the `operatorAuditLog` row, and the public surface.
- **`regenerate` is deliberately not exposed.** It supersedes the current record and mints a fresh `generated` one — a content operation behind a control labelled "publish" would let an administrator reset a day's editorial history by accident.
- **`withdrawReadModel`, not `invalidateReadModel`.** The two are one word apart at the call site and mean opposite things. `invalidate` says "this version is bad" and keeps serving the last known good one, which is right for a failed rebuild; a FR-K004 withhold says "this content may not be shown", and falling back would serve an older copy of exactly the content being withheld. The new function demotes the fallbacks too, non-destructively.
- **The argument is `decision`, not `action`.** `publicReadOnlyGuarantee.test.ts` forbids any public function from DECLARING a player-control argument, and `action` is on that list. The test caught it; renaming was the right answer, because an exception would have widened a security pin to accommodate a word.
- **One list of publication statuses.** `REPLAY_PUBLISHED_RECORD_STATUSES` was a second copy of `['ready','published']`; both now read `VIEWER_SERVABLE_PUBLICATION_STATUSES` in `editorial/publicationLifecycle.ts`. Deliberately NOT merged with `ELIGIBLE_EPISODE_STATUSES`, which reads a different column whose values happen to share two tokens — merging them would couple a safety decision to an editorial one because their strings collide.

## Live reading that motivated this

Read from the running deployment with bounded queries: all three current `publicationRecords` in `mistwood` are `ready`, none `published`; 12 character read models are current; 83 accepted events across world days 0–4 name all twelve seeded characters and all eight locations.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
FR-K004's administrator half now has a caller. `decideEpisodePublication` is a public mutation on the ART-48 console surface, gated by a new admin-only `publication.decide` capability, requiring a reason, and writing one `operatorAuditLog` row in its own transaction. The lifecycle itself is untouched: the command calls the existing `advancePublication` through `ctx.runMutation`, so the transition table, the admin-only rule, the audit event and ART-162's gate stay in one place.

Before this, the four administrator actions had no caller at all — `advancePublication`'s only call site types the action as the four a SYSTEM actor may take — so every Episode in every world walked to `ready` and stopped. Confirmed against the running deployment: all three current `publicationRecords` in `mistwood` are `ready`, none released, and 74 of 74 scene runs were authored by `fake-whole-scene-v1`.

The new capability opened a gap that had been harmless until now, and it is closed in the same commit: `rebuildEpisodeProjection` read only `dailyEpisodes.status` — a SAFETY decision — and never consulted the publication record. Without that fix the command would have shipped a withhold that the very next accepted event undid.

AC#1 — `refuses an operator who is not an administrator`, `reserves the FR-K004 publication decision for an administrator`, `refuses an unauthenticated caller and an empty registry alike`.
AC#2 — `audits the decision with the operator, the content and the resulting status`; `passes the operator through as the lifecycle actor, never a hard-coded one`. No Canon table is named anywhere on this path.
AC#3 — `refreshes EVERY cached public surface, and the Episode read model, in one transaction`, asserting the exhaustive ORDERED dispatch list; plus `does not let the next accepted event republish a withheld Episode`.
AC#4 — seven injections, each turning a named test red (table in PR #268). Two earlier attempts produced `Tests: 0 total` — a type error in the injection rather than a defect — and were replaced with injections that compile.
AC#5 — proven through the REAL handlers over one shared table set: the transition, then `rebuildEpisodeProjection`, then `refreshViewerKnowledgeProjections`, with the resulting payload fed to `composeCharacterViewModel`. The secret reaches the character page on release and disappears again on withhold.

`withdrawReadModel` is new and deliberately distinct from `invalidateReadModel`: one says "this version is bad" and keeps serving the last known good one, the other says "this content may not be shown" and demotes the fallbacks too.

Verification: `npm run check` exit 0 (4369 passed, 31 skipped, 251 suites); `npm run e2e` 124 passed; PR #268 merged with all three CI checks green.
<!-- SECTION:FINAL_SUMMARY:END -->
