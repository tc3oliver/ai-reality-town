---
id: ART-44
title: Scoped relationship graph experience
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-28 13:42'
labels:
  - prd-1.0
  - epic-k
milestone: m-0
dependencies:
  - ART-40
  - ART-95
  - ART-10
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-I007; NFR-002 graph clause

Problem / Context
This task is a single reviewable PR within PRD 1.0 and owns only the capability stated below.

Goal
Deliver the scoped relationship graph with current-arc, one-hop, recent-change defaults and relationship exploration controls.

Scope
Deliver the scoped relationship graph with current-arc, one-hop, recent-change defaults and relationship exploration controls.

Out of Scope
World timeline, full-world default graph, relationship mutation, and production deployment.

Dependencies
ART-40, ART-95, ART-10

Schema Impact
No Canon mutation schema; owns published read-model records, query DTOs, cache/version metadata, or UI state explicitly named by the task.

API Impact
Read-only public query contracts and internal projection writers; UI never calls providers.

Security Impact
Server-side field allowlists, publication status, accessibility, and secret/privacy boundaries apply to every public view.

Validation Commands
npm run check; run the focused validation introduced by this task and record the exact command and result.

Test Requirements
UI tests cover defaults, filters, reasons, privacy, accessibility, and the 30-node default limit.

Documentation Impact
Update the relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-I007: Relationship graph defaults to current-arc core characters, one-hop relationships, and relationships changed in the last seven days.
- [ ] #2 FR-I007: Graph supports date switching, relationship-type filtering, character summaries, and change reasons.
- [ ] #3 The default graph never renders all characters/relationships and remains within the 30-node limit.
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
Revised after a second research pass re-verified against origin/main (d018c34). The first
version of this plan over-estimated the guard work and under-used what canon already holds.

1. Fix the ART-95 defect (user-approved scope addition).
   `relationshipArcProjectionFunctions.ts:62-67` REASSIGNS `latest` on every matching public
   change instead of accumulating, so the published CURRENT dimensions are the last event's
   DELTA, not levels (+5,+5,+5 publishes 5; +50 then -1 publishes -1). The types already name
   the distinction (`RelationshipChange.trustDelta` vs `RelationshipProjection.trust`), and
   `buildRelationshipProjection` cannot catch it because `BOUNDED` (`relationshipArcProjection.ts:94`)
   only coerces NaN/Infinity to 0 -- a delta is a valid number. Accumulate all six dimensions.
   Repair `BOUNDED`'s name and the docblock at `:100-104` claiming "Dimensions are bounded".
   Add a regression test proven by reverting the fix. If an existing test pins the wrong
   behaviour it is a wrong test: correct it and say so.

2. Build the graph from CANON, not from the published relationship model.
   Canon already holds everything the published payload lacks:
   `convex/canon/model.ts:231-246` RelationshipHistoryEntry carries sequenceNumber, worldDay,
   timeSlot, ALL SIX deltas, visibility, sourceEventId; `:220-228` RelationshipState carries the
   correctly accumulated levels; `:370` WorldProjection.relationships holds them per pair;
   `convex/canon/queries.ts:50` returns { relationships, history }. publicRead may depend on
   canon and already does (`liveStateFunctions.ts` imports replayWorldEvents from
   `../canon/replay`). Sourcing here makes the graph correct INDEPENDENTLY of step 1, gives the
   seven-day window a real worldDay, and supplies all six deltas -- the published
   `RelationshipChange` carries only three and no day at all. Record this reasoning in the
   implementation notes; a reviewer will otherwise ask why the existing model was not reused.

   New `convex/publicRead/relationshipGraphProjection.ts` (pure builder) +
   `relationshipGraphProjectionFunctions.ts` (rebuild + publish). Scoping per FR-I007: current-arc
   core characters (`arc:<id>`.coreCharacterIds, current arc from `live:<worldId>`.activeArcs),
   one-hop, changed within seven world days. Hard 30-node cap (NFR-002) enforced in the builder
   with a deterministic documented ordering and an explicit omitted-count -- never a silent cut.
   Register the kind at three sites: `readModel.ts:39-52`, `readModelFunctions.ts:30-34`,
   `publicRead/schema.ts:33-36` (ART-46's voteConsequence is the worked precedent in all three).
   Post-commit rebuild mirroring `postCommitLive.ts:524-534`, index-scoped reads only, placed so
   it cannot starve the safety-bearing rebuilds.

   Open call, to be justified in a docblock: world-scoped `relationshipGraph:<worldId>` vs per-day
   `relationshipGraph:<worldId>:<worldDay>` -- per-day makes date switching a ref change but
   multiplies published rows over a long-running world.

3. "Relationship type" does not exist as a field. AC#2's 關係類型篩選 must be defined over the six
   dimensions, and the definition documented. Another reason to source from canon, where all six
   are present.

4. Client: greenfield, no graph library in package.json and none to be added -- hand-rolled SVG.
   New pure route/view-model module + presentational `RelationshipGraphView({vm})` exported
   SEPARATELY from the useQuery default (the a11y suite renders via renderToStaticMarkup, so no
   effects run and no events fire -- layout must be a pure function). Template:
   `timelineRoute.ts` + `TimelineView.tsx`, and `CharacterPage.tsx:35` vs `:94` for the split.

5. Guard obligations are LIGHT, because the page reads through the EXISTING
   `getPublishedReadModel` via `publicReadModelRef.ts:12` with a new modelRef and adds NO new
   public function. `publicReadOnlyGuarantee.test.ts` needs no change (`:354-364` pins
   `publicFunctionRef` literals; importing the shared ref adds none). `module-boundaries.json`
   needs no change (`clientPublic` already covers `src/components/public`; the query is already
   an allowed anonymous entry). `fixtureConvexClient.ts` needs no change (`:65-66` already
   routes it). The ONE fixture edit is a branch in `fixtureWorld.ts:222-360`, needed only if an
   e2e spec renders the page. If a new public query becomes necessary, STOP -- that is a
   deliberate architectural change, not a line edit.

6. a11y ships IN this task (its own Test Requirements line names accessibility): keyboard-operable
   nodes, an equivalent list/table view as the honest non-visual equivalent, `.public-tap`
   controls, `aria-pressed` toggles (survives greyscale; colour alone does not), per-node and
   per-edge accessible names, one `<main>` with correct heading order. ART-94 owns the
   cross-surface EVIDENCE pass over graph + timeline, not the build.

7. Tests per AC with negatives and fault injection: >30 one-hop neighbours is capped and reports
   what it omitted; a private relationship never appears; changed-8-days-ago excluded while
   changed-7-days-ago is included; date switching moves the window.

8. Docs: new graph domain doc; `docs/accessibility.md:10-11` currently says the P1 graph is out of
   scope and must be updated; closure matrix `docs/prd-1.0-closure-matrix.md:203` (FR-I007) and
   `:275` (NFR-002 30-node clause).

Not absorbed: ART-43 AC#1 (character page primary relationships) may become satisfiable since this
is the first client consumer of relationship data -- mention it, do not check it, do not build
toward it.
<!-- SECTION:PLAN:END -->
