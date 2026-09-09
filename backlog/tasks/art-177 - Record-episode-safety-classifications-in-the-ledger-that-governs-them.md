---
id: ART-177
title: Record episode safety classifications in the ledger that governs them
status: To Do
assignee: []
created_date: '2026-09-09 21:35'
labels:
  - prd-1.0
  - epic-p
dependencies: []
priority: high
ordinal: 176000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by an ART-138 zero-caller audit, then confirmed by reading both sides.

`convex/editorial/episodeFunctions.ts` classifies each Episode with `classifyPostGeneration`, stores `safetyClassificationId: safety.classificationId` on the `dailyEpisodes` row — and **never inserts the classification anywhere**. Only two writers of `postGenerationSafetyClassifications` exist: `convex/safety/postGenerationFunctions.ts` and a bare `ctx.db.insert` in `convex/editorial/shareFormatFunctions.ts`. Neither runs for an Episode.

The consequence is not cosmetic. `overridePostGenerationSafetyLabel` (`convex/operations/safetyOverrideFunctions.ts`) looks the classification up by `by_world_and_classification` and throws `SAFETY_CLASSIFICATION_NOT_FOUND` when it is absent. **An operator can never override an episode-level safety decision** — the id stored on the row resolves to nothing. FR-P004 gives an operator that authority; the deployment does not.

Two adjacent findings from the same audit, fixed in the same change because they are the same subsystem:

- **`classifyAndRecordPostGeneration` has zero callers.** It is the dedup-and-conflict-checked writer, raising `SAFETY_CLASSIFICATION_CONFLICT` on a reused id carrying different content. `convex/safety/schema.ts` states that conflict check as a table invariant — and the one production writer bypasses it with a bare insert. A docblock asserting the opposite of shipped behaviour.
- **`isPubliclyShowable` is the named gate predicate with one caller.** `convex/editorial/episodeFunctions.ts` and `convex/operations/longRunHarness.ts` each write `label === "allow" || label === "allow_with_warning"` by hand. A fifth label, or moving `human_review_required` across the line, changes one site and leaves the episode publish decision deciding the old way. Both modules already `mayDependOn: ["safety"]`, so the import is legal today.

Out of scope: whether `shareFormatFunctions` should also route through the conflict-checked writer. Same class, different content kind, and it already writes the row — so it is a hardening, not a missing capability.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Generating an Episode records its safety classification in postGenerationSafetyClassifications, so the id stored on the episode row resolves
- [ ] #2 An operator can override an episode-level safety decision end to end, and the override changes what the public surface serves
- [ ] #3 The episode classification is written through the conflict-checked path, so a reused id carrying different content is refused rather than duplicated
- [ ] #4 The publish/withhold predicate has one definition, and the episode decision calls it rather than restating it
- [ ] #5 A fault injection proves each: removing the ledger write, or widening the predicate at one site only, turns a named test red
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
