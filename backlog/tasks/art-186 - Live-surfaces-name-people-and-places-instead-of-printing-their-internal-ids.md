---
id: ART-186
title: Live surfaces name people and places instead of printing their internal ids
status: Done
assignee: []
created_date: '2026-09-15 14:10'
updated_date: '2026-09-15 14:52'
labels: []
dependencies: []
priority: high
ordinal: 184000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The live map's camera chrome labels every character button with the raw slug — 聚焦角色 renders he-jun, zhao-ming, pei-lan, and the card button beside it announces 「查看 he-jun 的角色卡」. src/components/world/cameraModel.ts:248 sets label: motion.characterId, and because the static floor plan (rung 3 of the degradation ladder) and its roster both take their names from those same focus targets, one line puts slugs on three surfaces at once.

The text live view is worse, because it is the NFR-009 accessible equivalent of the map and is therefore the surface a viewer reaches when they cannot use the graphical one. It renders 「he-jun 位於 未知位置」: the id where a name belongs, and a false claim beside it. The location half is a separate root cause — convex/publicRead/liveFold.ts folds locations from EMPTY over location_state_changed alone ("Never seeded"), so a seeded Mistwood location that no event has ever described is absent from the published payload and liveRoute.ts:144 falls through to 未知位置. The world knows where the character is, the id is published, and the animated map draws them there using the authored footprints in data/mistwood.ts — only the text alternative claims not to know.

The same omission runs through the rest of the live chrome: CharacterCard prints 「與 zhao-ming 交談中」 and lists an arc as arc-mill-audit, and ActiveScenePanel prints 登場角色 and 相關故事線 as id lists.

Every name needed is already published and already read by the page. ART-183 added displayName to each entry of liveState.characters, liveStateFunctions.ts:906 fills it through loadDisplayNames, and LiveMapPage already reads live:<worldId> for other reasons. The authored location names are in mistwoodLocationFootprints, which the map is already drawing from. Nothing here needs a new read, a new public function or a schema change.

Scope: src/components/world/cameraModel.ts, src/components/live/LiveMapPage.tsx, CharacterCard.tsx, ActiveScenePanel.tsx, characterCardModel.ts, activeSceneModel.ts, src/components/public/LiveView.tsx and liveRoute.ts.

Out of scope: the static public pages (their own task), enum labels (their own task), and the language the Mistwood seed is authored in, which is a product decision.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The live map's 聚焦角色 buttons and their 角色卡 accessible names render a character's display name, not their id
- [ ] #2 The static floor plan's roster and its SVG name labels render display names, inheriting them from the same focus targets so the two surfaces cannot disagree
- [ ] #3 The text live view renders a character's display name in 角色位置, 登場角色 and the conversation line, and an arc's title in 相關故事線
- [ ] #4 A character standing in a seeded location that no event has described is shown that location's authored name, not 未知位置 and not its id
- [ ] #5 A character or location for which no name is resolvable still renders its id rather than a blank, and a NAMED test pins that fallback
- [ ] #6 Deterministic tests reproduce the id-labelled state from a fixture and fail by name when the resolution is removed
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
One table, five surfaces.

`src/components/public/worldNames.ts` builds three maps — characters, locations, arcs — from the `liveState` payload the pages already read, and `named()` is the only way to read one, so the id fallback is written once rather than five times. It lives under `components/public/` because `clientLive` may depend on `clientPublic` and not the reverse; `components/world/` may reach neither, which is why `focusTargetsFrom` takes the character table as a parameter instead of importing one.

That parameter is the highest-leverage line in the change. `cameraModel.ts:248` set `label: motion.characterId`, and `composeStaticMap` takes its names FROM those targets rather than from a second table — so one line labelled the camera chrome, the floor plan's SVG and the floor plan's roster at once, and fixing it fixes all three by construction.

## The location half is not a projection bug

`convex/publicRead/liveFold.ts` folds locations from empty over `location_state_changed` and calls the result "Never seeded". ART-100 AC#3 requires the incremental fold to stay byte-identical to a full replay, and CLAUDE.md section 9 records that `convex/publicRead` replays from empty to keep seed data out of public read models. Both still hold and neither is changed. What was wrong is that the TEXT view claimed not to know something the GRAPHICAL view was drawing: the map places everyone against `mistwoodLocationFootprints`, which is in the client bundle and on screen, while `liveRoute.ts:144` rendered 未知位置 for the same character at the same moment. The footprints are now the second source for locations, and specifically second — a location Canon has re-described overrides its authored default.

`未知位置` is now reachable only when the payload names no location at all for that character, which is pinned by its own test.

## Two docblocks corrected rather than replaced

`conversationPartnerIds` said "Ids, because the projection publishes no display names — the same thing the camera controls and the scene panel show, so the three surfaces name people identically." The reasoning was sound; its premise stopped being true at ART-183, which added `displayName` to every entry of `liveState.characters`. The field is now `conversationPartnerNames` and the docblock says plainly that the old claim no longer holds. Same treatment for the scene panel's participant and arc fields.

## Fault injection — six, five bit, one did not

1. `cameraModel` label back to the id — failed 'labels every character focus target with a name' AND 'gives the floor plan the SAME names'. Two surfaces from one line, which is the property the test exists to show.
2. `liveRoute` location lookup back to the published map with the unknown fallback — DID NOT BITE, 18/18 passed. The injection was not faithful: `names.locations` already carried the authored entries, so the lookup still succeeded. Reported rather than counted.
3. Authored footprint source removed from `composeWorldNames` — failed 'names a seeded location the published payload omits entirely'.
4. `put()` allowed to keep `name === id` — failed 'drops an entry whose name is just the id'.
5. Scene panel participants back to ids — failed 'names its participants' AND 'agrees with the map panel word for word'.
6. The exact pre-ART-186 location behaviour, both halves together (no authored source AND the unknown fallback) — failed 'never says 未知位置 about a character whose location the payload publishes' with `Received: "未知位置"`, the live symptom verbatim. This is the injection #2 should have been.

The E2E fixture now carries `displayName` on every liveState character. Without it the browser suite would have exercised only the id fallback, which is the state the task was about.
<!-- SECTION:NOTES:END -->
