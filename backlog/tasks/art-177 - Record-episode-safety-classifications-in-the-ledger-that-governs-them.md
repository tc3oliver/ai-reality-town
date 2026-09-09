---
id: ART-177
title: Record episode safety classifications in the ledger that governs them
status: Done
assignee: []
created_date: '2026-09-09 21:35'
updated_date: '2026-09-09 22:29'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
`generateAcceptedEventEpisode` classified each Episode, stored `safetyClassificationId` on the `dailyEpisodes` row, and inserted the classification nowhere. Every Episode in every world carried an id that resolved to nothing, and `overridePostGenerationSafetyLabel` — which looks it up by exactly that id — threw `SAFETY_CLASSIFICATION_NOT_FOUND` for all of them. FR-P004 gives an operator the authority to revise an episode-level safety decision; the deployment did not have it.

## Recording the row was not enough, and stopping there would have been worse

`dailyEpisodes.status` is the classifier's verdict at generation and is never rewritten — that immutability is the ledger design's point. So the read models could not see an override, and the operator would have got a control that reported success and changed nothing: precisely the failure `overridePostGenerationSafetyLabel` guards against on its own path by re-reading the ledger before returning.

`episode:<day>` and `episodes:<worldId>` therefore resolve the **effective** label. An Episode is off the public surface if any of three independent decisions says so — the classifier at generation, an operator override afterwards, or an administrator's publication withhold (ART-171/174/176). Each is tested alone, so none can silently stand in for another.

## Two adjacent findings, same subsystem

- **`recordPostGenerationClassification`** — the conflict check `convex/safety/schema.ts` states as a table *invariant* had zero callers, while the ledger's one production writer used a bare insert. An invariant only one entry point enforces is not one. It is now a plain function over `ctx.db` that both the mutation and the episode generator call.
- **`isPubliclyShowable`** — the named gate predicate had one production caller while three sites wrote `label === 'allow' || label === 'allow_with_warning'` by hand, one of them this very decision. Both remaining copies now call it.

`episodeSafetySourceId` gives the classification's `sourceId` one definition too — the generator mints it and two rebuilds ask about it, from three modules.

## The injection that did not bite, reported rather than counted

Narrowing `isPubliclyShowable` to `label === 'allow'` left **every suite in the repository green**. Consolidating its three copies made that function the place a change to the publish line takes effect, and nothing pinned it. Rather than report three-for-three, a test over all four labels was added, exhaustive against `POST_GENERATION_LABELS` so a fifth cannot default to showable. Both directions then bite.

One new test was also initially a second copy of the `ready` case: the "classifier refuses it" fixture used violent zh-Hant prose the classifier does not match. A precondition assertion caught it; the fixture now uses text `CATEGORY_PATTERNS.EXTREME_VIOLENCE_DETAIL` really matches, and says out loud that the classifier's patterns are English.

## Evidence

| Injection | Tests that went red |
| --- | --- |
| ledger write removed | all 6 in `episodeFunctions.test.ts` |
| index reads the frozen status | `withdraws the Episode and drops it from the index once an override refuses it` |
| episode read model reads the frozen status | same |
| predicate narrowed to `allow` | `shows allow and allow_with_warning` (+1) |
| predicate admits `human_review_required` | `withholds withhold and human_review_required` (+1) |

Two files that did not exist before this: `convex/editorial/episodeFunctions.test.ts` — the handler that decides an Episode's safety status had never been run by a test, which is how the missing ledger write survived — and the end-to-end override cases in `publicationControlFunctions.test.ts`, because "the ledger row exists" and "the viewer stops seeing it" are different claims.

Gate: `npm run check` — 4415 passed, 31 skipped, 253 suites. `npm run e2e` — 124 passed. Merged as PR #275.
<!-- SECTION:NOTES:END -->
