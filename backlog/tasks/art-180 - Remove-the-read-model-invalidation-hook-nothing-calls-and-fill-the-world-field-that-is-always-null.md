---
id: ART-180
title: >-
  Remove the read-model invalidation hook nothing calls, and fill the world
  field that is always null
status: Done
assignee: []
created_date: '2026-09-11 19:17'
updated_date: '2026-09-11 19:36'
labels: []
dependencies: []
ordinal: 178000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two places where `convex/publicRead` advertises more than it does. Both were found by a whole-repository reachability audit, both are small, and both are the kind of claim that reads as a capability until someone tries to use it.

**1. A registered internal mutation with zero callers.** `invalidateReadModelVersion` (`convex/publicRead/readModelFunctions.ts`) has no caller anywhere in the repository, and its helper `invalidateReadModel` (`convex/publicRead/readModel.ts`) is reached only from tests. It was built as a hook for FR-P004 invalidation: `docs/prd-2.0-requirement-matrix.md`'s FR-O013 row says the separate `visualReplay` read-model kind gives ART-132「一個現成的 `invalidateReadModel` 掛鉤」, and `docs/visual-replay.md` lists it in the ART-132 handoff. ART-132 then shipped something else — read-time `publicationVersion` + servable-status gating — and that is what `docs/prd-2.0-closure-record.md` row 31 actually cites as evidence. So the hook is not "not wired yet"; it is the design that lost, still being described as the one that will be used.

Consequence beyond the dead code: `invalidateReadModel` is the only thing that could ever leave a last-known-good row standing while the current version is unservable, so `serveReadModel`'s `servedFrom: "fallback"` result is not produced by any production path. (`withdrawReadModel`, which IS called in production, deliberately demotes the fallbacks too — FR-K004's withhold is not a statement about a version.) The availability guarantee row 20 cites is NOT affected: it rests on `AC#7: stays available when a later projection write fails (LKG keeps serving)`, which asserts `servedFrom: "current"` and exercises the real mechanism, a mutation that rolls back.

**2. A public field that is always null.** `worldSourceFrom` and `worldSourceFromProjection` (`convex/publicRead/worldCharacterProjectionFunctions.ts:112,170`) publish `createdAt: null` unconditionally, while the same handler has already read `worldSchedules` — a row whose schema requires `createdAt: v.number()` — and narrowed it to `{ mode, status }`, discarding the value. `updatedAt` beside it is populated. The world read model is genuinely consumed (the homepage reads `world:<worldId>`), so this is a published field with a source that is fetched and thrown away, not an unused model.

`worldSchedules.createdAt` is the right source rather than the first accepted event's `acceptedAt`, and that is probably why it was left null: the ART-100 resumed path sees only a trailing window of events, so the first event is not available on both paths. The schedule row is.

Out of scope: narrowing `writePublishedReadModel`'s status union, and the unconsumed `relationship:<pairKey>` model kind. Both are separate judgements.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No registered Convex function and no exported helper remains for read-model invalidation, and a test fails if one returns without a caller
- [x] #2 Every document that describes `invalidateReadModel` as the FR-P004 invalidation mechanism instead describes the read-time version gate that shipped
- [x] #3 The published world read model carries the world schedule's `createdAt` on both the full-replay and the resumed-projection path, and the two paths agree
- [x] #4 A fault injection proves each: restoring the invalidation export turns a named test red, and hard-coding `createdAt` back to null turns a named test red
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
1. Delete `invalidateReadModelVersion` (`convex/publicRead/readModelFunctions.ts`) and
   `invalidateReadModel` (`convex/publicRead/readModel.ts`). Rework the three test sites that use
   it — `readModel.test.ts`, `publicDynamicProjection.test.ts`, `failureIntegration.test.ts` —
   which use it to manufacture an unservable current version. Each has to either move to a
   mechanism production actually has (`withdrawReadModel`, a rolled-back write) or say plainly
   that it is asserting the pure selection rule rather than a production path.
2. Add a pin in `readModel.test.ts`: the read-model function module exports no invalidation entry
   point, and every production commit call site passes `status: 'published'`. The second half is
   what makes the first half more than a spelling rule.
3. Correct `docs/visual-replay.md`'s ART-132 handoff entry and `docs/prd-2.0-requirement-matrix.md`'s
   FR-O013 row to describe the read-time `publicationVersion` + servable-status gate that shipped.
4. Populate `createdAt` from the schedule row in `worldSourceFrom` and `worldSourceFromProjection`,
   widening the `schedule` parameter from `{ mode, status }` to carry it. Both paths, one source.
5. Test that the two paths agree on `createdAt` for the same world, and that it is the schedule's
   value rather than an event timestamp.
6. Fault injections: restore the invalidation export; hard-code `createdAt: null`.
7. `npm run check`, `npm run e2e`.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## The invalidation hook

`invalidateReadModelVersion` was a registered internal mutation with **no caller anywhere in the
repository**, and `invalidateReadModel` was reached only from three test files. Both are deleted.

Two documents told a reader it was the mechanism FR-P004 invalidation would use —
`docs/prd-2.0-requirement-matrix.md`'s FR-O013 row (「給 ART-132 一個現成的 `invalidateReadModel`
掛鉤」) and `docs/visual-replay.md`'s ART-132 handoff list. ART-132 shipped read-time
`publicationVersion` + servable-status gating instead, which needs no rebuild and no new version,
and that is what `docs/prd-2.0-closure-record.md` row 31 actually cites. So this was not "not
wired yet"; it was the design that lost, still described as the one that would be used. Both
documents now say so, naming the old claim rather than quietly replacing it.

**What the deletion exposed, and what it did not.** `invalidateReadModel` was the only thing that
could leave a last-known-good row standing while the current version was unservable, so
`serveReadModel`'s `servedFrom: 'last_known_good'` has no production producer. That is now stated
in `selectServedVersion`'s docblock instead of the old text, which described the branch as the
thing protecting production. What actually delivers「existing public content stays readable when a
rebuild fails」is a Convex mutation that throws committing nothing — the prior version is still
CURRENT — and that is what `AC#7: stays available when a later projection write fails (LKG keeps
serving)` exercises, asserting `servedFrom: 'current'`. The release-gate row that cites it (PRD 2.0
closure record row 20) is unaffected, which I checked before deleting anything.

The branch is kept rather than removed: it costs one `find` and is the correct behaviour the day a
non-`published` commit exists. It is also now correct in a way it was not — it requires the
fallback row to be servable, instead of trusting a flag another function maintains. No current
writer produces a last-known-good row that is withheld, but serving one would put withheld content
back on the public surface.

**Three test files had to change**, and each says what it lost. `publicDynamicProjection.test.ts`
and `failureIntegration.test.ts` each opened with a test that invalidated the current version and
asserted the fallback served — demonstrating a recovery no deployment could perform, the second of
them in a file whose whole subject is real failure. Both now assert the mechanism production has.
`readModel.test.ts`'s `invalidateReadModel` describe became
`selectServedVersion (AC#1/#5 — the last-known-good rule)`, labelled in its docblock as a property
of the pure selector rather than of a production path — a downgrade in what is proven, stated
rather than glossed.

The new `the read-model surface has no invalidation entry point` block has two halves and the
second is the load-bearing one: asserting a name is absent would be satisfied by renaming it.
Asserting that every `*Functions.ts` under `convex/publicRead` commits `status: 'published'` — read
off the call sites, not transcribed — is what makes an invalidation function unreachable if one
returns without a caller, because there would be no unservable current version for it to act on.

## The world's `createdAt`

`worldSourceFrom` and `worldSourceFromProjection` published `createdAt: null` unconditionally while
the handler had already read the world's `worldSchedules` row — whose schema requires
`createdAt: v.number()` — and narrowed it to `{ mode, status }`, discarding the value. `updatedAt`
beside it was populated. The world read model is genuinely consumed: the homepage reads
`world:<worldId>`.

The schedule row is the right source rather than `events[0].acceptedAt`, and that is probably why
it was left null: since ART-100 the resumed path reads a trailing window plus a snapshot, so the
first event does not exist there. The schedule row exists on both paths, which is what lets the two
`worldSource*` builders — separate functions with the same contract, the classic shape for one of
them keeping a stale rule — agree.

## Fault injections — four, all of which bit

1. An `invalidateReadModelVersion` export restored in `readModelFunctions.ts` →
   `exports no invalidation function from the pure module or the function module` red.
2. `liveStateFunctions.ts` committing `status: 'withheld'` instead of `'published'` →
   `commits every production read-model version as published, so nothing is left unservable` red.
3. `createdAt` hard-coded back to `null` on BOTH world paths →
   `publishes the schedule row's createdAt rather than null` and
   `agrees across the full-replay and the snapshot-resumed path` red.
4. `createdAt` reverted on the RESUMED path only → the same agreement test red, and so was the
   pre-existing `publishes an identical payload whether or not a snapshot exists`, which is
   independent evidence that the two-path equality is really pinned.

All restored; 58 tests green across the two files.

## Verification

`npm run check` exit 0 — 257 suites, 4504 passed / 31 skipped, build clean. `npm run e2e` 124
passed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Two places where `convex/publicRead` advertised more than it did, both found by a whole-repository
reachability audit.

**A registered internal mutation with zero callers.** `invalidateReadModelVersion` and its helper
`invalidateReadModel` are deleted. Nothing called them; two documents described the hook as the
mechanism ART-132 would use for FR-P004 invalidation, and ART-132 shipped read-time
`publicationVersion` + servable-status gating instead — which is what the PRD 2.0 closure record
actually cites. Both documents now name the old claim and correct it rather than quietly replacing
it. Deleting it exposed that `serveReadModel`'s `servedFrom: 'last_known_good'` has no production
producer, which `selectServedVersion`'s docblock now says instead of claiming the branch protects
production; the availability guarantee is delivered by a Convex mutation that throws committing
nothing, and the closure-record row that cites it was checked and is unaffected. The branch is kept
and tightened: it now requires the fallback row to be servable rather than trusting a flag.

**A published field that was always null.** The world read model's `createdAt` is now the world
schedule's `createdAt`, on both the full-replay and the snapshot-resumed rebuild path. The handler
had already read the row — whose schema requires the field — and discarded everything but `mode`
and `status`.

**Verification.** `npm run check` exit 0 — 257 suites, 4504 passed / 31 skipped, build clean.
`npm run e2e` 124 passed.

**Four fault injections, every one of which turned a named test red**: restoring the invalidation
export; a production commit with `status: 'withheld'`; `createdAt` reverted to null on both paths;
and `createdAt` reverted on the resumed path alone, which also turned the pre-existing two-path
equality test red. All restored, 58 tests green.
<!-- SECTION:FINAL_SUMMARY:END -->
