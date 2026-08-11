---
id: ART-124
title: Build the public character card
status: Done
assignee:
  - '@claude'
created_date: '2026-08-04 15:59'
updated_date: '2026-08-11 10:34'
labels:
  - prd-2.0
  - v2-f
  - epic-o
dependencies:
  - ART-118
  - ART-111
priority: high
type: feature
ordinal: 124000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O006 (PRD 2.0 §12 Epic O)

**Problem / Context:** Clicking a character is the primary path from "who is that" to narrative understanding, and is a direct private-data exposure risk.

**Goal:** A public character card showing identity, current public status and narrative context, with private fields structurally excluded.

**Scope (shown):** name and sprite/portrait, occupation and public background, current public location or movement state, public emotional/activity state, public goal, active story arc membership, recent major events, link to the character page.

**Scope (never shown):** private goal, undisclosed secrets, private memories, prompts or model output, operator annotations.

**Out of Scope:** The character page itself (PRD 1.0 FR-I005, already delivered); relationship graph (ART-44).

**Dependencies:** FR-O001 live map; FR-N004 character visual bindings.

**Schema Impact:** None.

**API Impact:** Consumes the public projection and existing public character projection.

**Security Impact:** High — requires explicit negative tests for every forbidden field.

**Test Requirements:** Negative tests asserting private goal, secrets, memories, prompts and operator notes cannot appear; visual identity consistency test across map, card and Episode.

**Validation Commands:**
- `npm run check`
- Browser E2E: clicking a character opens its card.

**Documentation Impact:** Public character card field contract.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Clicking a character opens a card with name, sprite or portrait, occupation and public background
- [x] #2 The card shows current public location or movement state and public activity state
- [x] #3 The card shows the public goal, active story arc and recent major events
- [x] #4 The card links to the character page
- [x] #5 Private goal, undisclosed secrets, private memories, prompts and operator annotations are never shown
- [x] #6 The character visual identity matches the map and Episode surfaces
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
Scope note: during research, discovered that character public fields (publicGoal, publicProfile, personality, values, fear, behaviorRules, occupation) are LLM-writable post-world-creation via the generic fact_created / character_state_changed state changes in the whole-scene-simulation path, and are NEVER covered by ART-132's post-generation safety classification (which only scans a scene's narrative publicSummary text, not fact_created values) nor by any projection-level safety gate. User approved folding a fix for this into ART-124 rather than deferring it.

1. Character card UI (src/components/live/CharacterCard.tsx + pure composeCharacterCardViewModel): identity (name, sprite/portrait via existing useSpriteAssets()/resolveVariantSpriteAsset(), occupation, publicProfile) from the existing character:<id> read model; location/activity from the PublicCharacterMotion already loaded by LiveMapPage.tsx (no new query for this part); public goal from the character projection; active story arc from activeScenes[].arcIds/.participantCharacterIds already in the dynamic projection (scoped to "active", matches AC#3, avoids new backend surface); recent major events via the timeline:<worldId> read model filtered client-side by characterId (mirrors CharacterPage.tsx's existing pattern); link to the character page (#character/<worldId>/<characterId>).

2. Open affordance: DOM-based only -- Pixi canvas click handlers are structurally forbidden (enforced by readOnlyWorldSurface.test.ts + architecture/module-boundaries.json). Extend CameraControls.tsx's existing per-character focus-target button list (or add a sibling list) to also open the card via new selectedCharacterId state in LiveMapView.tsx. Card renders as a block-stacked section (not absolutely positioned over the canvas) with a visible close control.

3. Negative tests mirroring characterRoute.test.ts's poisoned-input pattern: forbidden keys/values (privateGoal, knowledge, memory, prompt, rawModelOutput, adminNotes) never survive into the card view model even from a poisoned source. Update liveMapSurface.test.ts's hardcoded query-name/count assertions for any new named useQuery added to LiveMapPage.tsx.

4. Safety-filtering extension (reuses ART-132 infra, no new schema tables):
   a. convex/simulation/sceneSimulation.ts finalizeWholeSceneOutput/publicText(): extend the text scanned by classifyPostGeneration to also include the string value of any fact_created / character_state_changed state change in output.proposedEvents[].stateChanges that is public-visible (visibility public|canon) and targets subjectType 'character', so a scene's existing single classification also covers the character-fact text it proposes.
   b. convex/publicRead/worldCharacterProjectionFunctions.ts rebuildCharacterProjection: for each fact_created/character_state_changed canon event contributing to source, resolve metadata.sceneId (already stamped on every proposed event by ART-132's withSceneProvenance) and look up the effective safety label via ART-132's existing getEffectiveSafetyLabels/readWithheldSceneLabels helpers; exclude a withheld/human-review-required field from the projection (fall back to prior known-good value, or omit) rather than publishing it.
   c. Tests: a withheld fact_created value does not appear in the character projection or card; an override via ART-132's overridePostGenerationSafetyLabel retroactively removes it.

5. Docs: update docs/dynamic-safety-filtering.md noting the gate now also covers character-fact text, not just scene text.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Review round 1 (code-reviewer + security-reviewer) — 7 findings fixed.

HIGH #1 (both reviewers): withheld scene text leaked through the card's recent-major-events list. `rebuildTimelineProjection` had no safety gate at all — it copied `publicSummary` straight off the Canon rows — and this task is what routed that projection onto the live map. Now runs the same bounded `readWithheldSceneLabels` sweep and REUSES `sceneEventRows` + `withheldEventIds` imported from `liveStateFunctions.ts` rather than re-implementing them, so the timeline and the dynamic surface cannot disagree about which events are refused. A refused entry is kept and loses only its `publicSummary` (matching `redactWithheldSummaries`); dropping the row would silently renumber a public history, and `publicSummary: null` was already handled by both consumers. Fixes the same pre-existing gap on CharacterPage.tsx for free. New handler-level suite `episodeTimelineProjectionFunctions.test.ts` (7 tests) asserts on the PUBLISHED PAYLOAD, incl. the retroactive-override path and redaction-by-event-id.

HIGH #2: the widened classifier scan over-reached. `CHARACTER_STATE_FIELD_MAP` publishes only 5 of 7 `CHARACTER_STATE_FIELDS`, but `characterFactTexts()` scanned all of them. Since a `withhold` sets `reviewStatus: 'required'` and drops the WHOLE scene from Canon, a false positive on a never-published field would have destroyed that scene's unrelated location changes, relationship updates and memories. Scan is now filtered to `PUBLIC_TEXT_CHARACTER_STATE_FIELDS` (health/emotion/finance/occupation), declared in `canon/eventTypes.ts` because it is the only module both `simulation` and `publicRead` may depend on; `worldCharacterProjection.test.ts` pins it against `CHARACTER_STATE_FIELD_MAP` so the two sides cannot drift. Note `organization_memberships` is validated by Canon as an array of references so it cannot carry prose at all; `availability` is the live risk and is now excluded.

MEDIUM #3: the new gate could resurrect a deactivated character. `active` is projected but asserts existence, not prose — gating it skipped the deactivation, left the field at its prior `true`, and contradicted `excludedCharacterIds` (which reads the same change on the motion path with no safety input). `EXISTENCE_CHARACTER_STATE_FIELDS` is now carved out of the gate, same as `character_life_changed`. Two regression tests, both directions.

MEDIUM #4: the card showed 'loading' forever for a never-built projection. `CharacterCardStatus` is now `loading | unavailable | ready`, mirroring CharacterPage.tsx's `undefined` (in flight) vs `null` (served, no model) distinction. `unavailable` still renders the half that needs no projection — location, movement, activity, portrait — plus the character-page link, which is when a viewer most needs it.

MEDIUM #5: focus management. The card renders below its trigger, so opening it was silent for keyboard/AT users. Card is now `tabIndex={-1}` and takes focus on mount keyed on `characterId`; an `sr-only role=status aria-live=polite` line names whose card is open (covers switching card-to-card in place); `LiveMapView` captures `document.activeElement` on open and restores it on close rather than dropping focus on `<body>`.

LOW #6: `characterSourceFrom`'s `withheldSceneIds` no longer defaults — a default would be a fail-open one, and forgetting it is the exact bug it exists to prevent. Now a compile error.

LOW #7: `forbiddenKeysInCharacterCard` doc corrected to describe it as test tooling, matching how `characterRoute.ts`'s `forbiddenKeysInViewModel` is already used. Documented why it is not a render-path guard: throwing there blanks the map for every viewer, and not throwing renders the leak anyway — neither beats making the leak impossible by construction, which building from named fields already does.

Documented, not fixed (pre-existing, outside ART-124's consumers): `relationshipArcProjectionFunctions.ts` and `onboardingSummaryFunctions.ts` publish character-derived text ungated, and `worldCharacterProjection.ts`'s `publicFacts` (non-character subjects) are outside the classifier scan. Also recorded: `overridePostGenerationSafetyLabel` refreshes only `rebuildLiveProjection`, so the character and timeline projections pick up a new verdict on their next rebuild rather than inside the override transaction — fanning out per-character would make an admin mutation's cost scale with the cast. All three noted in docs/dynamic-safety-filtering.md §4a for a future task.

Verification: npm run check EXIT=0 — 140 suites, 2130 passed, 5 skipped (pre-existing ART60_LONG_RUN gates), build clean.

Review round 2 — focus management had no behavioural coverage; added.

New `src/components/live/characterCardFocus.dom.test.tsx` (4 tests): mounts `LiveMapView` via `react-dom/client`, dispatches a real click on the per-character '角色卡' trigger, asserts `document.activeElement` IS the card section, closes it, and asserts focus returned to the exact trigger element. Also covers `tabIndex === -1` on the mounted node and the polite live region for a card-to-card switch with no close in between.

This is the first test in the repo that mounts a component and dispatches an event, so the rationale is recorded in `jest.config.ts`'s project doc: the `a11y` project renders through `renderToStaticMarkup`, which runs no effect and delivers no event, so it can prove the card is focusable but never that focus moves — which is exactly where this bug would live, since the card renders BELOW its trigger. The rest of the `dom` project still calls components as functions; mounting is reserved for assertions genuinely about post-interaction browser behaviour.

Mounting the live map in jsdom needs no stubs, and that is a property of the components rather than luck: `useReducedMotion` returns false without `matchMedia`, and `useElementSize` returns a no-op without `ResizeObserver`, so the measured size stays 0 and `ReadOnlyWorld` (Pixi/WebGL) never mounts. `HTMLCanvasElement.prototype.getContext` is stubbed to null — not a workaround but the exact degradation `resolveVariantSpriteAsset` documents — so jsdom's 16 'not implemented' errors cannot bury a real failure. Async sprite resolution is settled inside `act` so no state update lands mid-assertion.

Both halves mutation-checked: deleting `cardRef.current?.focus()` fails only the open test; deleting `trigger?.focus()` fails only the close test. Neither assertion is vacuous.

Verification: npm run check EXIT=0 — 141 suites, 2134 passed, 5 skipped (pre-existing ART60_LONG_RUN gates), build clean.

PR #185 opened and auto-merge enabled (merge + delete-branch on green CI): https://github.com/tc3oliver/ai-reality-town/pull/185
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented FR-O006: a public CharacterCard on the live map, opened via a DOM button in CameraControls (Pixi canvas clicks remain structurally forbidden), showing name/sprite/occupation/background/location/activity/public goal/active arc/recent events with a link to the character page. AC#5's forbidden-field exclusion is enforced by an explicit-allowlist view model (never spreads its source) with both key-absence and literal-string-absence negative tests, mirroring the existing CharacterPage pattern. AC#6 visual identity is guaranteed by construction: card and map resolve sprites through the identical useSpriteAssets()/resolveVariantSpriteAsset() path, verified against the map's actual resolved spriteKey rather than a pinned constant.

Scope extension (user-approved after discovery): character biographical fields (publicGoal, publicProfile, personality, values, fear, behaviorRules, occupation) were LLM-writable via fact_created/character_state_changed canon events but had never been covered by ART-132's post-generation safety classification or any projection-level gate. Closed this by widening classifyPostGeneration's scanned text to include character-fact values (scoped to only the fields that actually reach the public projection, after a review found the initial version over-scanning never-public fields and risking false-positive whole-scene rejection), and adding a withheld-label gate to worldCharacterProjectionFunctions.ts reusing ART-132's existing bounded readWithheldSceneLabels helper -- no new schema.

Two independent review passes (code-reviewer, security-reviewer) both independently found the same top issue from different angles: the timeline read model feeding the card's "recent major events" had no safety gate at all, despite ART-132/this task's own new gate existing elsewhere -- fixed by extending the same withheld-label check to episodeTimelineProjectionFunctions.ts (also closes the same pre-existing gap on the PRD 1.0 character page's recent-events list). Six other findings (classifier over-scan destroying whole scenes on never-public-field false positives, active-field resurrection after a withheld scene, card stuck loading forever on an unbuilt projection, missing focus management on card open/close, a fail-open default parameter, a test-only function mislabeled as a runtime guard) were all fixed and independently re-verified, including a mutation-tested behavioral DOM test proving the focus-management fix actually works (deleting either focus call fails the corresponding test).

Known, documented limitations (not fixed, out of this task's scope): relationshipArcProjectionFunctions.ts, onboardingSummaryFunctions.ts, and non-character publicFacts remain ungated by the same safety mechanism (pre-existing gaps, not introduced here); the override mutation refreshes the live dynamic-surface projection immediately but character/timeline projections pick up a new verdict on their next natural rebuild, not instantly.

npm run check green: 141 suites, 2134 passed, 5 pre-existing/unrelated skips, build succeeds.
<!-- SECTION:FINAL_SUMMARY:END -->
