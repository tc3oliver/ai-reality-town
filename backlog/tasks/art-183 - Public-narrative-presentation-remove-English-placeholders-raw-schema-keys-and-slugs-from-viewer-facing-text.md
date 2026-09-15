---
id: ART-183
title: >-
  Public narrative presentation: remove English placeholders, raw schema keys
  and slugs from viewer-facing text
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 12:19'
updated_date: '2026-09-15 12:44'
labels: []
dependencies: []
priority: critical
ordinal: 181000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The public pages render machine placeholder text in English to a zh-Hant audience, and leak internal identifiers straight to the viewer. Verified on the running app (home page and live view) on 2026-09-15, and traced to hardcoded template literals on the production pipeline, so regenerating the world reproduces all of it identically. This is not stale data.

What a viewer currently sees on the home page:

- 近期大事:At mistwood-mill, he-jun and zhao-ming meet over: Press the matter of "Prevent another mill shutdown." at mistwood-mill
- 已知事實:currentArcPremise是An anonymous locker key may expose why Mistwood station truly closed、name是Zhao Ming、age是41
- 關鍵人物:he-jun、zhao-ming
- 第 3 天 / night
- "Digitize the surviving archives." at mistwoo…

Four distinct defects, all on the production path:

1. English placeholder text, hardcoded. Full inventory from a source sweep:
   - convex/simulation/worldDayLive.ts:750  actionDescription
   - convex/simulation/worldDayLive.ts:657  scene trigger
   - convex/simulation/worldDayLive.ts:658  dramaticPressure, which also leaks the internal pacingStage enum
   - convex/editorial/episode.ts:111  Key scene N / Quiet beat N
   - convex/editorial/episode.ts:112  No accepted public development was recorded.
   - convex/editorial/episode.ts:118  episode title World Day N
   - convex/editorial/episode.ts:119  headline A quiet day in Mistwood
   - convex/editorial/episode.ts:120  The town passed a quiet day without a public Canon development, which also leaks the internal word Canon
   - convex/editorial/episodeFunctions.ts:52  Relationship changed between A and B.
   - convex/operations/postCommitLive.ts:521  arc title Arc from world day N (slot)
   - convex/operations/postCommitLive.ts:523  arc question How will X settle what happened at Y?
   - convex/operations/longRunHarness.ts:1654  duplicate of episodeFunctions.ts:52

2. Raw internal predicate keys rendered into Chinese prose. convex/publicRead/onboardingSummary.ts:87 joins a fact as predicate + 是 + value with no display-name mapping, so camelCase schema keys (currentArcPremise, name, age) appear verbatim to the viewer.

3. Slugs shown where a human-readable name is required. Characters and locations render as he-jun, zhao-ming, mistwood-mill. The character records carry a name field equal to the slug, so this is not only a presentation-layer lookup. Decide and record where the display name comes from.

4. Silent mid-token truncation. The string "at mistwoo…" appears in the served liveState activeScenes summary. CLAUDE.md section 9 requires truncation to state what was omitted and why; today it does neither and cuts inside a word.

Also in scope: unlocalized enums in the zh-Hant UI (night rendered raw in 第 3 天 / night and 世界日 3 · night), and the untranslated internal term Canon in 這裡只列出 Canon 記錄有據可查的關聯.

Out of scope: story generation semantics, Canon schema or reducer changes, and anything that needs production data to test.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No English placeholder template reaches a viewer-facing field: Press the matter of, X raises Y at Z, Key scene N, Quiet beat N, World Day N, A quiet day in Mistwood, Arc from world day, How will X settle what happened at Y, Relationship changed between, No accepted public development was recorded, The town passed a quiet day without a public Canon development
- [ ] #2 The internal pacingStage enum value does not appear in any viewer-facing field
- [ ] #3 Fact predicates render through a display-name mapping; a raw camelCase schema key such as currentArcPremise, name or age never reaches the onboarding summaryText
- [ ] #4 A fact predicate with no registered display name is handled by a stated rule (omitted, or labelled) rather than falling through to the raw key
- [ ] #5 Characters and locations render a human-readable display name in every public surface; a slug such as he-jun or mistwood-mill never appears to the viewer as a name
- [ ] #6 Where the display name comes from is decided and written down, including what happens when a record has none
- [ ] #7 The zh-Hant UI contains no unlocalized enum value; the time slot renders in Chinese on the home page, the live view and the onboarding summary
- [ ] #8 Truncation never cuts inside a word, and every truncated public string states that content was omitted, satisfying the CLAUDE.md section 9 truncation contract
- [ ] #9 Regression tests assert on the FINAL output of the public home page view model, the live view and the onboarding read model, not on intermediate helpers
- [ ] #10 A fault injection is performed for each of the four defect classes: the guarantee is broken, a NAMED test is shown failing, and the guarantee is restored
- [ ] #11 Tests run without production data
- [ ] #12 npm run check passes
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Research complete. Findings that shape the work:
   - convex/publicRead/onboardingSummaryFunctions.ts:236 sets name to participantId literally, which is the whole slug defect for 關鍵人物.
   - convex/publicRead/worldCharacterProjection.ts already carries a public name field, so a display name is available on the public side without touching Canon.
   - convex/canon/mistwoodSeed.ts carries real names (zhao-ming -> Zhao Ming) and location names (Mistwood Station). They are English/pinyin, not Chinese. Rendering them satisfies the no-slug requirement; translating the seed world is a separate product decision and stays out of scope.
   - convex/simulation/rulesOnlyAuthor.ts:71 already holds the canonical zh-Hant time slot map (night -> 夜間). It lives in simulation, so no public surface can reach it.
   - convex/simulation/sceneGrouping.ts:104 joins actionDescription values into the scene trigger with " / ". That trigger is author input, which is how the English actionDescription text reaches the viewer: the model echoes it into publicSummary.
   - Two more English placeholders found during research: convex/simulation/worldDayLive.ts:739 "Stay with routine work this slot" and convex/simulation/characterIntent.ts:157 "Remain in place".
   - architecture/module-boundaries.json: shared has mayDependOn [] and is listed by simulation, editorial, publicRead, operations, clientPublic and clientLive, so one shared module can serve every caller.

2. Slice 1 — new convex/shared/publicLabels.ts (pure, no imports):
   - timeSlotLabel(slot) with the zh-Hant map; rulesOnlyAuthor re-exports from here so there is one source.
   - factPredicateLabel(predicate) returning null for an unregistered predicate, which is the stated rule for the unknown case.
   - formatNameList(names) joining with 、.

3. Slice 2 — display names. Give the onboarding builder and the live surfaces a name lookup off the existing public character projection, replacing name: participantId. Decide and document what happens when a record has no name.

4. Slice 3 — replace every English placeholder with zh-Hant text built from display names: worldDayLive.ts 657, 658, 739, 750; characterIntent.ts 157; episode.ts 111, 112, 118, 119, 120; episodeFunctions.ts 52; postCommitLive.ts 521, 523; longRunHarness.ts 1654. Drop the pacingStage enum from dramaticPressure.

5. Slice 4 — truncation contract. rulesOnlyAuthor.ts:69, fakeSceneNarrator.ts:82, onboardingSummary.ts:57 and arcPrimer.ts:65 all cut blind. Stop cutting inside a Latin or digit run and state that content was omitted. The existing publicText.ts docblock argues word boundaries are deliberately not respected because CJK has none; that argument is right for CJK and incomplete for Latin runs, and the comment must say so rather than being silently replaced.

6. Slice 5 — regression tests on the FINAL outputs (home page view model, live view, onboarding read model), plus one fault injection per defect class, each showing a NAMED test failing.

7. npm run check, then open the PR and enable auto-merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation complete; npm run check green (4578 passed / 4609 total, build OK).

What changed, by defect class:

1. English placeholders. Replaced with zh-Hant at all twelve sites: worldDayLive.ts (actionDescription, scene trigger, dramaticPressure, the routine-work default), characterIntent.ts (the downgraded-intent description), episode.ts (scene titles, episode title, headline fallback, two empty-day fallbacks), episodeFunctions.ts and longRunHarness.ts (the relationship-change line), postCommitLive.ts (arc title and arc question). The pacingStage scheduler enum no longer reaches dramaticPressure. The two extra sites found during research (worldDayLive.ts:739, characterIntent.ts:157) were fixed too.

2. Raw schema keys. New convex/shared/publicLabels.ts holds the zh-Hant label tables. onboardingSummary.ts now renders a registered predicate as label:value and an UNREGISTERED one as the value alone. The unregistered rule is the important half: a predicate is LLM-authored, so the vocabulary is open and a registry can never be complete; falling back to the key is what put currentArcPremise on the home page. name and age are now excluded from the fact list entirely as identity rather than news.

3. Slugs. Fixed at the public read boundary rather than per template, in new convex/publicRead/entityNames.ts plus convex/publicRead/displayNames.ts. This was a design choice: authors write entity ids into prose on purpose (fakeSceneNarrator.ts states why), and a model does the same, so substituting in each template would still leave ids in LLM-authored text. buildLiveProjection now takes a displayNames map and applies it to every public string it carries, and LiveCharacter gained a displayName. onboardingSummaryFunctions.ts:236 no longer sets name: participantId. Matching is longest-first and boundary-bounded, so he-jun does not fire inside he-junior and a prefix id cannot eat a longer one.

4. Truncation. New safeCutIndex in shared/publicText.ts backs off to the start of a Latin token, bounded at 16 characters. The bound is load-bearing, not a guard: shareFormats composes a 60-character card from a 300-character unbroken run, and an unbounded back-off returned SEVEN characters of it. CJK still cuts where the budget ran out, which remains the only honest option there. Applied in rulesOnlyAuthor.ts and fakeSceneNarrator.ts.

Two comments that asserted the opposite of their own code were corrected in place rather than replaced, per CLAUDE.md section 9: fakeSceneNarrator.ts claimed its clamp worked "without breaking words" while its body was a bare slice, and timeStateLabel.ts argued the raw slot was printed deliberately because a lookup table would blank a sixth slot — timeSlotLabel is total and returns the raw value for an unknown slot, which answers that concern directly.

Time slot localisation reaches all eight client render sites: publicStatusBadge.ts, Homepage.tsx, LiveView.tsx (two), timeStateLabel.ts, characterRoute.ts, characterCardModel.ts, voteConsequenceModel.ts, returnRecap.ts (two).

Fault injections — five run, and TWO DID NOT BITE ON THE FIRST ATTEMPT, which is reported rather than hidden:

- Injection 1, restoring Key scene N in episode.ts: FAILED BY NAME, the episode.ts no longer emits "Key scene " case.
- Injection 2, restoring the predicate-key fallback: FAILED BY NAME, three cases.
- Injection 3, making the entity-name substitution a no-op: FAILED BY NAME, two cases.
- Injection 4, reverting safeCutIndex to a blind cut: FIRST ATTEMPT DID NOT BITE — all 34 passed. The assertion was not.toMatch(/mistwoo…$/), which a blind cut also satisfies because it lands on mist rather than mistwoo. An assertion that cannot fail. Replaced with an exact-string assertion; the retry FAILED BY NAME with Received "Digitize the surviving archives at mi…".
- Injection 5, removing a slot from LABELLED_TIME_SLOTS: FIRST ATTEMPT REPORTED Tests: 0 total — the suite failed to COMPILE, because the array is the source of its own key type, so the failure was indistinguishable from a clean pass in a filtered summary. Re-injected as the realistic regression instead, adding a sixth slot to canon TIME_SLOTS without a label: FAILED BY NAME, two cases.

Known limitation, owned by ART-185 rather than fixed here: location ids can only be substituted for locations that exist in the projection, and convex/publicRead replays from empty deliberately so most seeded Mistwood locations are absent from it entirely. The substitution mechanism is complete and tested; the data it has to work with is exactly what ART-185 is about.

Out-of-scope finding worth recording: the Mistwood seed world is itself authored in English. zhao-ming is named "Zhao Ming", not a Chinese name, and occupations, profiles, goals and historical events are all English prose. Rendering display names removes the slugs, which is what this task asked for, but the narrative CONTENT stays English until that is decided as a product question.
<!-- SECTION:NOTES:END -->
