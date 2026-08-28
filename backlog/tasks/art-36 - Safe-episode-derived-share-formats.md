---
id: ART-36
title: Safe episode-derived share formats
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-28 18:43'
labels:
  - prd-1.0
  - epic-i
milestone: m-0
dependencies:
  - ART-34
  - ART-66
  - ART-51
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-G005

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Generate local news, social copy, share-card copy, and next-day teasers linked to their source episode.

Scope
Generate local news, social copy, share-card copy, and next-day teasers linked to their source episode.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-34, ART-66, ART-51

Schema Impact
Episode, recap, machine-summary, coverage, or derived-content records named by the task, each linked to accepted source events.

API Impact
Editorial generation/validation interfaces and publication-candidate outputs; no direct Canon mutation.

Security Impact
Spoilers and unsafe content are withheld through field visibility and publication gates.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Tests verify provenance, canon isolation, and publication gating.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-G005: 衍生內容不得產生新 Canon。
- [x] #2 FR-G005: 必須標記來源 Episode。
- [x] #3 FR-G005: 不適當內容不得自動外部發布。
- [x] #4 Automated tests provide evidence for every mapped FR-G005 acceptance criterion, including rejection and failure paths.
- [x] #5 PRD traceability links FR-G005 to doc-1 and the merged implementation evidence.
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Verification

- `npm run check` on the branch merged with `origin/main`: exit 0, **191 suites, 3069 passed, 5 skipped**.
- `npm run e2e` run alone: **82 passed**.
- Focused: `npx jest convex/editorial/derived/shareFormats.test.ts convex/editorial/derived/shareFormats.boundary.test.ts convex/editorial/shareFormatFunctions.test.ts`; policy via `npm run check:architecture` (20 modules) and `npm run test:architecture`.

Nine fault injections run and reverted, each failing for the right reason: writing to
`canonEvents` from the derived module (2 boundary errors); importing `canon/model` (boundary
error); removing `derivedContent` from `forbiddenModules` (caught by the policy-pin test, because
`check:architecture` still prints "valid" — that is the whole danger); validating provenance
against the Episode's own ids, i.e. ART-46's exact tautology; ignoring the safety label (6 tests);
making `publish` non-admin; suppressing omission reports (3 tests); adding `fetch(` to the wiring;
dropping the source-Episode identity check.

## AC#1 — enforced by the build, not by absence

Four layers, three of which fail the build. `derivedContent` (roots `convex/editorial/derived`)
may depend on `safety` and `shared` only and is in `canonWriteBoundary.forbiddenModules`, so
naming any write symbol under it fails `check:architecture`, and importing Canon fails it too.
`ShareSourceEpisode` is `readonly` all the way down — this caught a real bug during the build,
`tsc` rejecting a `keyScenes.push(...)`. A behavioural companion seeds a real
`InMemoryCanonStore`, runs derive→validate→classify→gate, and compares the accepted-event log
byte-for-byte, because the first three catch a NAME while that one catches an EFFECT.

`derivedContent` is also in `REQUIRED_MODULES` in `check-boundaries.mjs`: a module that stopped
existing would take its own enforcement with it while every test still passed. A test pins the
policy entry, because the guard cannot guard itself.

The derivation had to be a NEW DIRECTORY rather than a file in `editorial`: `editorial`
legitimately writes to the database (`episodeFunctions.ts` uses `internalMutation`), so it can
never join `forbiddenModules`. Longest-root matching keeps the rest of `editorial` unaffected.

## AC#3 — structural, and no transport was fabricated

No external publication path exists in this deployment: every outbound `fetch` in `convex/` is an
LLM provider call, `convex/http.ts` holds only an inbound webhook, and `httpAction` is banned
repo-wide by `publicFunctionSurface.forbiddenRegistrations`. Rather than invent an integration to
have something to gate, the gate sits at the publication-candidate boundary.

`decideShareRelease` returns `blocked` or `manual_release_required` — there is NO released
variant, so the best reachable outcome is copy an administrator takes by hand and adding a
transport later means editing that union. Blocked results carry `formats: null` and blocked rows
persist no copy, so a row's existence cannot be mistaken for permission to use it. Second layer:
derived copy rides FR-K004 as `episode_share`, inheriting the admin-only `publish` rule instead of
restating it; the pipeline creates records as `system` and is refused.

The transport sweep test carries its own non-vacuity guard — it asserts the file set is non-empty
and contains both named files BEFORE sweeping for `fetch`, `httpAction`, `XMLHttpRequest`,
`ConvexHttpClient`, `ctx.scheduler` (a deferred call is still a call) and `runAction`, then walks
the import closure. A sweep over nothing passes for the wrong reason, which is the failure mode a
"nothing was published" test is most likely to have.

The safety gate is the EXISTING one: `classifyPostGeneration` read through `isPubliclyShowable`,
with no text pattern-matching and no category list of its own; a test pins that both publishable
labels are allowed, so a stricter twin would fail. The derived text does get its own
classification run under its own `sourceId`, because it is different text from the Episode's —
reusing the Episode's verdict would claim a gate ran over characters it never saw.

## AC#2 — the repo's idiom, and the tautology avoided

`acceptedSourceEventIds` is read from `canonEvents` via `by_world_and_day` and derived with
`deriveEventId` (`shareFormatFunctions.ts:141-145`) — never taken off the Episode object the copy
came from. That is ART-46's shipped failure mode, applied preemptively here rather than found in
review. The read is day-scoped, not a whole-world `.collect()`.

`sourceEventIds` and the `episode:<worldId>:<worldDay>` contentRef match the existing idiom
exactly, so an operator holding a share format finds the Episode's publication record with no
second identifier scheme. 地方新聞's headline deliberately carries no event ids, because
`buildDailyEpisode` never records which event produced it and attributing it would be a guess —
which is what keeps the omission-coverage rule non-vacuous.

Caps are counted in CHARACTERS, not 中文字 — a considered deviation from FR-G003, whose bands
govern text the pipeline WRITES while these govern text it QUOTES. A CJK-only count would let a
900-character Latin summary pass a "150 中文字" cap and overflow the card it was sized for.

## Why a share-format task touched the publication lifecycle and post-commit pipeline

`PublicationContentKind` widened to `'episode' | 'episode_share'`, and `createEpisodePublication`
gained an OPTIONAL `contentKind` defaulting to `'episode'` — optional so the existing FR-K004 call
site keeps its exact meaning, and defaulted rather than inferred from `contentRef` because a
naming convention is not something a caller should be able to get wrong silently. No transition
graph, authorization rule or signature changed. A separate kind rather than a second field on the
Episode's record because the two are decided separately: an Episode can be published while its
社群短文 is still under review, and one record cannot hold two statuses.

In `postCommitLive.ts`, one new port method in stage 19, deliberately NOT a twelfth
`POST_COMMIT_STAGES` entry — that array is pinned and resumable, and a new stage would change the
checkpoint contract for a feature with no independent retry boundary. Called AFTER the Episode's
own publication record, and UNCONDITIONALLY including on withheld days: the generator re-reads the
Episode row and refuses a non-ready one itself, so running it records the REFUSAL where an
operator can see it. Skipping the call would leave the day silently absent from the derived table,
which reads identically to "not generated yet". `deriveGatedShareFormats` exists so the three port
implementations cannot drift on ORDER — provenance is checked before classification, and
classification before anything decides releasability.

## Documented rather than fixed

- No public read surface serves the copy (`internalQuery` only). Adding one would trip the
  exhaustive `publicFunctionRef` pin. FR-G005 asks the formats be generated and not auto-published;
  it does not ask that viewers see them.
- Regeneration is not wired; a day's copy is derived once.
- 地方新聞 can omit scenes entirely on a busy day with long summaries. The omission report names
  every event that did not fit, so the shortfall is visible rather than silent.
- Pre-existing and NOT silently "fixed": the closure matrix's aggregate counts do not match a
  cell-by-cell tally (92 P0 delivered / 10 deferred vs the summary's 98 / 22). The document's own
  convention was followed rather than recounting an unaudited table. Someone should decide whether
  that table needs a proper recount.

## Merge note

Merging `origin/main` conflicted in `postCommitLive.ts` stage 19, where ART-44's relationship-graph
rebuild and this task's share-format call both landed. Both were kept. An e2e run taken before the
conflict was resolved reported green and was void; it was re-run on the clean tree.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the four FR-G005 outreach formats derived from an Episode, with AC#1 enforced by the build rather than by the absence of offending code: the derivation lives in a new derivedContent module permitted to depend only on safety and shared, listed in canonWriteBoundary.forbiddenModules so naming any write symbol or importing Canon fails check:architecture, and listed in REQUIRED_MODULES so deleting the module cannot silently take its own enforcement with it. AC#3 is structural rather than procedural: decideShareRelease has no released variant, so the best reachable outcome is copy an administrator takes by hand, blocked rows persist no copy, and derived content rides FR-K004 as its own content kind to inherit the admin-only publish rule instead of restating it. No external publication path exists in this deployment and none was fabricated to have something to gate; the transport sweep asserts its own file set is non-empty before sweeping, because a sweep over nothing passes for the wrong reason. AC#2 reads the accepted set from the canon log by index rather than off the Episode object, which is ART-46's shipped tautology avoided preemptively, and every event a length cap removed is named in an omission report. Verified on the branch merged with origin/main: npm run check exit 0 with 191 suites and 3069 tests passing, npm run e2e 82 passed run alone, and nine fault injections each failing for the right reason. PR #212.
<!-- SECTION:FINAL_SUMMARY:END -->
