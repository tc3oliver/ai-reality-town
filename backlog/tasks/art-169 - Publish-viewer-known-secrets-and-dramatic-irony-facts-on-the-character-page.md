---
id: ART-169
title: Publish viewer-known secrets and dramatic-irony facts on the character page
status: Done
assignee:
  - '@claude'
created_date: '2026-09-09 11:44'
updated_date: '2026-09-09 17:39'
labels:
  - prd-1.0
  - epic-i
dependencies: []
priority: medium
ordinal: 169000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FR-I005's last two public fields have no published source anywhere in the deployment, which is why ART-43 AC#1 could not be checked and why ART-151 delivered eight of ten fields rather than ten.

觀眾已知秘密: a secret becomes viewer-known when the event that reveals it is published. The knowledge ledger knows which secrets exist and convex/publicRead knows which events are published, but nothing joins them and no read model carries a secret's revealed status. The failure mode is publishing an UNREVEALED secret, which FR-I005's 不得公開 list forbids explicitly, so the projection must prove the revealing event is published before it names the secret.

角色不知道但觀眾知道的資訊: dramatic irony is the difference between what a viewer can see published and what a given character's knowledge ledger holds. Both halves exist; nothing computes the difference and it has never been published in any form.

See docs/public-character-page.md §4 for the assessment ART-151 recorded. Blocks ART-43 AC#1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A published read model carries, per character, the secrets a viewer already knows, each traceable to the published event that revealed it
- [x] #2 A published read model carries, per character, the facts the viewer can see and the character's knowledge ledger does not hold
- [x] #3 A fault injection proves an unrevealed secret cannot reach either payload: removing the published-event check turns a named test red
- [x] #4 The character page renders both fields, and ART-43 AC#1 is then checked with evidence
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
1. Audit first. Findings that shape the design:
   - `worldSecrets` is a SEED table (`{id, content, initialKnowerCharacterIds}`); no event creates or edits a secret, and no state-change type reveals one.
   - The repository ALREADY has a rule for "an event made this secret public": `sourcedByCitedEvent` in `convex/quality/continuity.ts` — a `fact_created` change with public visibility whose string value contains the secret content. Reuse it; do not write a second one. It moves to `convex/shared/secretText.ts` so `quality` and `publicRead` share one definition (`publicRead` may not depend on `quality`).
   - Publication is per EPISODE (`publicationRecords.contentRef = episode:<worldId>:<worldDay>`), not per event. An event is published when it is cited by a `dailyEpisodes.sourceEventIds` whose CURRENT publication record is `published`.
   - `publish` is admin-only (`ADMIN_ONLY_ACTIONS`) and the pipeline's port type excludes it, so nothing in this deployment can publish an episode. Implement the strict rule anyway (it can only under-report, never leak) and raise the reachability gap as its own task.
2. New pure module `convex/publicRead/viewerKnowledgeProjection.ts`: `buildViewerKnowledgeProjection` over (secrets, publishedEventIds, publicationRefByEventId, canon facts, the character's known factIds). Caps + reported omission counts; never reads `projection.rumors` or private facts at all, so rumor belief and objective truth cannot leak structurally.
3. New read-model kind `viewerKnowledge`, ref `viewerKnowledge:<characterId>`, registered in `readModel.ts`, `publicRead/schema.ts`, `readModelFunctions.ts`; ref builder in `convex/shared/viewerKnowledgeRef.ts` so the E2E fixture cannot drift from the server.
4. Wiring `convex/publicRead/viewerKnowledgeProjectionFunctions.ts`: ONE world-level read of the bounded newest published days (`by_world_and_status` desc take N) + their episodes + their days' events (for the safety-withhold check), then a pure per-character build. Two entry points over one helper: `rebuildViewerKnowledgeProjections({worldId, characterIds})` for the pipeline and `refreshViewerKnowledgeProjections({worldId})` for the safety path, whose targets come from the read-model store.
5. Pipeline: call it LAST in stage 19, downstream of `rebuildLiveProjection`/`rebuildOnboardingSummary` (that stage is not failure-isolated). Add it to `refreshPublicTextModels` so every safety override recomputes it.
6. Client: `characterRoute.ts` gains the two view-model fields; `CharacterPage.tsx` renders two sections; `src/e2e/fixtureWorld.ts` registers the new ref through the shared builder.
7. Evidence: eight fault injections (unrevealed secret leak, ready-treated-as-published, withheld revealing event, known fact in irony, private fact in irony, superseded fact in payload, page does not render, read model has no production caller), each turning a NAMED test red. Then `npm run check`, `npm run e2e`, and the focused suites.
8. Docs: `docs/public-character-page.md` §4 becomes the delivered record; PRD closure matrix updated in the same commit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What the audit found before any code was written

- `worldSecrets` is SEED data (`{secretId, content, initialKnowerCharacterIds}`), written once by `importWorld`. No event creates a secret, no state change reveals one, nothing carries a revealed flag. ART-169 deliberately adds none: a secret is a JOIN, not a stored fact.
- The rule for "an event made this secret public" ALREADY existed, twice — `sourcedByCitedEvent` in `convex/quality/continuity.ts` and the Episode gate in `convex/editorial/episode.ts`. The needle primitive now lives in `convex/shared/secretText.ts` and `continuity` calls it, so the leak detector and the character page cannot drift into disagreeing about which strings count. The three callers keep their own VISIBILITY policies, which genuinely differ and are stated where they are applied.
- Publication is per EPISODE (`publicationRecords.contentRef = episode:<world>:<day>`), never per event. An event is released when a `dailyEpisodes` row citing it has a current publication record at `published`.

## The finding that shapes the result

FR-K004 reserves `publish` for an administrator, `advancePublication`'s only caller types the action as `validate | begin_safety_review | pass_safety_review | withhold`, and no operator command invokes it. **Nothing in the deployment can release an Episode.** So both fields are correctly EMPTY in Mistwood today.

That is the right behaviour for the rule — admitting `ready` would make essentially every secret in the world public, because `ready` is where the pipeline stops — and it is not a limitation of this projection. It is a reachability gap in FR-K004, raised as ART-171 rather than recorded here as a caveat.

## Decisions worth keeping

- **A kind of its own**, not two fields on `character:<id>`. It is the only public payload whose contents depend on the editorial publication lifecycle, so it changes on a trigger no other model shares, and a defect in it must not be able to take a character's name and location off the page.
- **One mutation for many characters.** The world-level inputs are identical per character; a per-character port method would have multiplied the read budget by the number of characters an event named. `postCommitLiveFunctions.readMeasurement.test.ts`'s "canon reads do not grow with accepted-event count" still passes with the new stage in place.
- **The Scene-provenance sweep is skipped when nothing is withheld.** It can only ever REMOVE rows, so the empty withheld set is the one case where skipping changes no answer. Asserted as a read-count DIFFERENCE, because the Canon projection reads `canonEvents` itself.
- **Two visibility policies, on purpose.** A fact is publishable as irony at `public` or `canon` (what the read models already publish); it REVEALS a secret only at `public` (continuity's rule). A `canon` fact quoting an unrevealed secret is therefore possible — it is dropped and counted in `redactedRowCount`.
- **`sanitizeForPublic` had to be given one exception.** `/secret/i` silently deleted `viewerKnownSecrets` on the way into the row: built, stripped, served empty. Fixed with a per-kind allowlist rather than a rename, because the filter matches key NAMES and a payload can always dodge it by not naming what it carries. Applied on the READ side too — sanitising only on write would have stored the field correctly and served it stripped.

## Injections that did NOT bite, and what changed

The first version of the "the pipeline calls this" evidence was a source scan for the function name. Removing the stage call left the name behind in the port interface declaration in the same file, so the scan passed against a pipeline that had stopped calling it. Replaced with a behavioural assertion in `postCommitLive.test.ts` over the published `modelRefs` — including that the viewer-knowledge refs come AFTER `live:<world>`, which is the ordering the un-isolated stage requires. The same weak pattern was removed for the safety half; `safetyOverrideFunctions.test.ts` already pins that list exhaustively by running the handler.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
FR-I005's last two public fields now have a published source: `viewerKnowledge:<characterId>`, joining `worldSecrets` × Canon's public facts × the editorial publication lifecycle × the safety gate. No new store of truth was added — a secret is a JOIN, and the rule for 「does this text quote this secret」 moved to `convex/shared/secretText.ts` so the leak detector in `quality/continuity.ts` and the character page cannot drift apart.

A secret is viewer-known exactly when a PUBLIC Canon fact quotes it, the event that created that fact was cited by an Episode whose CURRENT publication record is `published`, and that event's Scene is not withheld. Dramatic irony is the same published facts minus the fact ids the character's ledger holds; the builder has no rumor input at all.

**Both fields are empty in Mistwood today, and that is correct.** FR-K004 reserves `publish` for an administrator and nothing in the deployment can invoke it, so every Episode stops at `ready`. Confirmed against the live deployment: all 3 current `publicationRecords` are `ready`, none `published`. That is a reachability gap in FR-K004, raised as ART-171, not a caveat on this projection.

AC#1 — `viewerKnowledgeProjection.test.ts` 「reports a secret a PUBLISHED event said out loud, traceable to that event」; `…Functions.test.ts` 「joins the world secret to the published event that revealed it」.
AC#2 — 「reports a published public fact the character does not hold」 and 「drops the fact the moment the character learns it」.
AC#3 — nine injections, each turning a NAMED test red (table in PR #266). Dropping the published-event check reddens 14 tests; admitting `ready` reddens 7.
AC#4 — `e2e/characterViewerKnowledge.spec.ts`, 10 tests on desktop + mobile: both sections render from the read model, each row links to the day that published it, the empty case says so, and the page is axe-clean. `publicPages.a11y.test.tsx` adds three markup cases.

ART-43's AC#1 is now checkable: all ten FR-I005 fields have a published source and the page renders every one (`docs/public-character-page.md` §1).

One injection did not bite first time and was replaced rather than reported: the 「pipeline calls this」 evidence was a source scan, and the port interface declaration in the same file kept the function name alive after the call site was deleted. It is now an assertion over stage 19's published `modelRefs`, including their order relative to `live:<world>`.

Also fixed: `sanitizeForPublic`'s `/secret/i` pattern silently deleted `viewerKnownSecrets` on the way into the row — built, stripped, served empty. Now a per-kind allowlist, applied on read as well as write, with a test that every other kind still strips those same keys.

Verification: `npm run check` exit 0 (4348 passed, 31 skipped, 250 suites); `npm run e2e` 124 passed; PR #266 merged with all three CI checks green.
<!-- SECTION:FINAL_SUMMARY:END -->
