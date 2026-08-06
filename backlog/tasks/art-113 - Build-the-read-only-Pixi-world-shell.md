---
id: ART-113
title: Build the read-only Pixi world shell
status: In Progress
assignee:
  - '@oliver'
created_date: '2026-08-04 15:58'
updated_date: '2026-08-06 08:56'
labels:
  - prd-2.0
  - v2-c
  - epic-n
dependencies:
  - ART-112
  - ART-109
priority: high
type: feature
ordinal: 113000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-N002 (PRD 2.0 §12 Epic N)

**Problem / Context:** The inherited game client is interactive: it mounts a world heartbeat, offers player controls, and can send world input. The public Dynamic Viewing surface must reuse its rendering while being structurally incapable of writing to the world.

**Login/Interact retirement (absorbed from former ART-141):** Once the a16z engine retires (ART-112), `src/App.tsx`'s "Log in to join the town and the conversation!" copy and the Interact affordance promise a control capability that no longer exists. This task also removes/rewrites that public copy and the Interact button, while keeping the Clerk login entry point and operator authorization path (ART-105) intact — login remains valid for the operator console and future authenticated-viewer features (ART-71), it just stops promising in-world control.

**Accessibility fallback reuse (review finding):** `src/components/public/LiveView.tsx` is the existing text-only Live View. Rather than treating FR-Q004's non-map alternative view (ART-135) as new work built from scratch, this task should keep the existing text-based Live View reachable as a concrete non-map fallback path during the renderer refactor, so ART-135 has a working baseline to extend rather than an empty gap between removing the old page and shipping the new map.

**Goal:** A read-only renderer component tree that renders map and characters and has no write path, with a clear code boundary from the interactive game components, and an honest public surface that promises only watching and navigating.

**Scope:**
- Read-only renderer component tree reusing tilemap and sprite rendering.
- No world heartbeat mount.
- No join/move/chat/interact/accept/reject/leave calls.
- No player control buttons.
- Map clicks never set a character destination.
- Explicit module boundary separating read-only components from interactive ones, enforceable by the existing module-boundary tooling.
- Remove or rewrite public copy that promises joining, controlling or chatting with characters; remove the Interact affordance.
- Rewrite help content to describe watching, navigating, character cards, scenes, episodes and replay.
- Keep the Clerk login entry point and operator authorization path working; an authenticated viewer gains no world-control capability.
- Keep the existing text-based Live View (`src/components/public/LiveView.tsx`) reachable as the non-map accessibility fallback during and after this refactor, rather than removing it before ART-135 ships its replacement.

**Out of Scope:** Motion data production (FR-N010/FR-N003); live page composition (FR-O001); the end-to-end zero-mutation security proof (FR-O009); building ART-135's full non-map alternative view (this task only keeps the existing fallback reachable).

**Dependencies:** a16z engine retirement (ART-112); FR-N009 Mistwood map.

**Schema Impact:** None.

**API Impact:** Consumes only public read queries.

**Security Impact:** Structural removal of the client write surface; server-side enforcement remains owned by FR-O009. Confirms that authentication grants no world-write capability on the public surface.

**Test Requirements:** Tests asserting the read-only tree issues no mutation and mounts no heartbeat; module-boundary test asserting read-only components do not import interactive/write modules; tests asserting no join/interact/control affordance is reachable authenticated or unauthenticated, and that the operator authorization path still resolves; a test that the text-based Live View remains reachable as a fallback.

**Validation Commands:**
- `npm run check`
- Manual: sign in and confirm operator authorization still resolves while no world-control affordance appears.

**Documentation Impact:** Architecture note describing the read-only renderer boundary; update public experience documentation for the watch-only model.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The read-only renderer renders the Mistwood map and character sprites
- [ ] #2 No world heartbeat is mounted by the read-only tree
- [ ] #3 No join, move, chat, interact, accept, reject or leave action is reachable
- [ ] #4 No player control buttons are rendered
- [ ] #5 Map clicks cannot change any character destination
- [ ] #6 A clear enforced module boundary separates read-only components from interactive game components
- [ ] #7 An automated test proves public viewing produces no database mutation
- [ ] #8 Public copy no longer promises joining, controlling or chatting with characters, and the help content describes watching, navigating, character cards, scenes, episodes and replay
- [ ] #9 The Clerk login entry point and operator authorization path continue to work, and an authenticated viewer gains no world-control capability
- [ ] #10 The existing text-based Live View remains reachable as a non-map accessibility fallback during and after the renderer refactor, rather than being removed before ART-135 ships its replacement
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
1. Create the read-only renderer module `src/components/world/`: git mv PixiViewport/PixiStaticMap/Character into it, strip Character's onClick/pointerdown and the static map's interactive hitArea so map and sprite clicks cannot reach any handler (AC#4/#5).
2. Add pure `worldViewModel.ts`: PublicCharacterMotion-shaped input (PRD 2.0 §10.4) -> deterministic sprite placements interpolated from startedAt/arriveAt; unit-tested against `data/mistwood.ts` mistwoodWorldMap (AC#1).
3. Add `ReadOnlyWorld.tsx`: Stage -> Viewport -> PixiStaticMap -> Character[] built only from the view model, with no callback props, no convex mutation/action hooks and no heartbeat mount (AC#1/#2/#3).
4. Extend the existing module-boundary tooling: declare the read-only client modules in `architecture/module-boundaries.json` plus a `readOnlyClient` policy section (roots + forbidden write symbols), enforce it in `scripts/architecture/check-boundaries.mjs`, and cover it in `check-boundaries.test.mjs` (AC#6).
5. Add a jest test that scans every read-only client source file and proves no mutation/action/heartbeat/input API is reachable from the public viewing surface (AC#7).
6. Honest public copy: restore a Clerk operator-login entry point that renders only when VITE_CLERK_PUBLISHABLE_KEY is set (fixes the useConvexAuth throw ART-112 left behind) and promises no world control (AC#9); add a watch-only help page describing watching, navigating, character cards, scenes, episodes and replay, linked from the homepage, with no join/control/chat copy (AC#8).
7. Keep the text Live View reachable: homepage keeps its `#live/<worldId>` link and the help page points at it as the non-map fallback; a11y suite extended to cover the new help view (AC#10).
8. Docs + traceability: architecture note for the read-only renderer boundary, watch-only public experience doc, module-boundaries.md, current-state.md and the PRD 2.0 requirement matrix row for FR-N002.
9. Verify with npm run check (architecture, asset licenses, typecheck, lint, tests, build).
<!-- SECTION:PLAN:END -->
