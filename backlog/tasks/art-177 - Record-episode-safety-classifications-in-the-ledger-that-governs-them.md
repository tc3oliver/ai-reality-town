---
id: ART-177
title: Record episode safety classifications in the ledger that governs them
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-09 21:35'
updated_date: '2026-09-09 22:09'
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
- [x] #1 Generating an Episode records its safety classification in postGenerationSafetyClassifications, so the id stored on the episode row resolves
- [x] #2 An operator can override an episode-level safety decision end to end, and the override changes what the public surface serves
- [x] #3 The episode classification is written through the conflict-checked path, so a reused id carrying different content is refused rather than duplicated
- [x] #4 The publish/withhold predicate has one definition, and the episode decision calls it rather than restating it
- [x] #5 A fault injection proves each: removing the ledger write, or widening the predicate at one site only, turns a named test red
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
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Recording the row was not enough, and stopping there would have been worse

The obvious fix — insert the classification — makes `overridePostGenerationSafetyLabel` succeed. It does not make the override DO anything: `dailyEpisodes.status` is the generation-time verdict and is never rewritten, so both episode read models would have gone on serving the Episode. That is a control that reports success and changes nothing, which is the exact failure the override command guards against on its own path by re-reading the ledger before returning. So the read models resolve the EFFECTIVE label.

The result is three independent decisions, any one of which takes an Episode off the surface: the classifier at generation, an operator override afterwards, and an administrator's publication withhold (ART-171/174/176). Each is tested alone, so none can silently stand in for another.

## The injection that did not bite, and what it exposed

Narrowing `isPubliclyShowable` to `label === 'allow'` left EVERY suite in the repository green. Consolidating its three hand-written copies into one call site made that function the place a change to the publish line takes effect — and nothing pinned it. Rather than report three-for-three, I added a test over all four labels, exhaustive against `POST_GENERATION_LABELS` so a fifth label cannot default to showable. Both directions then bite.

## Two files that did not exist

`convex/editorial/episodeFunctions.test.ts` — the handler that decides an Episode's safety status and writes its row had never been run by a test; `episode.test.ts` covers only the pure builder. That is how the missing ledger write survived. And the end-to-end override cases in `publicationControlFunctions.test.ts`, because "the ledger row exists" and "the viewer stops seeing it" are different claims.

One test in the new file was initially a second copy of the `ready` case: my "the classifier refuses it" fixture used violent zh-Hant prose that the classifier does not match. The precondition assertion caught it. The fixture now uses text `CATEGORY_PATTERNS.EXTREME_VIOLENCE_DETAIL` really matches, and the case says out loud that the classifier's patterns are English — a limitation of the classifier, worth seeing stated beside a zh-Hant world.

## Evidence

Six injections, each turning a named test red: the ledger write removed (6 tests), the index reading the frozen status (1), the episode read model reading the frozen status (1), the predicate narrowed to `allow` (2), and the predicate widened to admit `human_review_required` (2). `npm run check` exit 0 — 4415 passed, 31 skipped, 253 suites. `npm run e2e` — 124 passed.
<!-- SECTION:NOTES:END -->
