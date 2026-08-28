---
id: ART-44
title: Scoped relationship graph experience
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-28 17:03'
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
- [x] #1 FR-I007: Relationship graph defaults to current-arc core characters, one-hop relationships, and relationships changed in the last seven days.
- [x] #2 FR-I007: Graph supports date switching, relationship-type filtering, character summaries, and change reasons.
- [x] #3 The default graph never renders all characters/relationships and remains within the 30-node limit.
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Verification

- `npm run check` on the branch merged with `origin/main`: exit 0, **188 suites, 3022 passed, 5 skipped**.
- `npm run e2e` run alone (it is not part of `check`): **82 passed**.
- Focused: `npx jest convex/publicRead/relationshipGraphProjection.test.ts convex/publicRead/relationshipGraphProjectionFunctions.test.ts convex/publicRead/relationshipArcProjection.test.ts src/components/public/relationshipGraphRoute.test.ts`.

Fault injections run and reverted, each failing for the right reason: removing the 30-node cap
(6 fail); widening the window to 8 days (3 fail); removing the `groupPublicRelationships` private
filter (4 fail); neutering `assertNoPrivateRelationship` (2 fail); reverting the ART-95
accumulation (6 fail across 2 suites); removing the clamp (2 fail).

## Why the graph reads Canon rather than the published relationship model

A reviewer will ask, so it is recorded here. The published `RelationshipChange` carries three of
six deltas and no world day, so FR-I007's seven-day window and six-dimension type filter are
IMPOSSIBLE on it — this is not a preference. It also makes the graph correct independently of the
ART-95 repair below, which is why the two are separately reviewable.

Canon's own accumulated `RelationshipState` is deliberately NOT used either. That fold mixes
private changes in with public ones, so re-folding public-only history is what stops a private
change from moving a public level. The filter is `!== 'public'` and Canon's reducer defaults
absent visibility to private, so the channel fails closed at both ends. A pair whose only history
is private does not appear at all — not at zero, which would itself disclose that something
private happened.

## Why the scoping is server-side

Relationship projections are one `modelRef` per pair and no published model enumerates the pairs,
so a client cannot discover its own edges. A client-only graph is impossible, not merely inferior.
It is also the only place the NFR-002 30-node bound and the private-relationship exclusion are
guarantees rather than hopes.

## Why nodes carry no character text

Nodes carry structure only. Character text is subject to retroactive withhold, and a past day's
graph is never rebuilt — so a summary baked into the payload would freeze at publication and a
day-5 scene withheld on day 9 would stay readable on day 5's graph permanently. The view reads
`character:<id>` live per node instead, which is rebuilt whenever the character changes.

A trailing rebuild window was considered and REJECTED: a withhold can be arbitrarily retroactive,
so a window of N days widens the hole rather than closing it, and would ship a safety claim that
holds for N days and then silently stops.

## AC#2's 「關係類型篩選」 was defined, not silently chosen

No relationship `type` field exists in the data model. The rule adopted is: the dominant
dimension, ties broken on a fixed order, `neutral` when all six are zero. Documented in three
places. The payload also publishes `RELATIONSHIP_GRAPH_NODE_ORDERING`, so the page explains the
ordering rule it was actually subject to rather than restating a guess, with a real fallback when
the token is unrecognised.

## The ART-95 defect fixed here (user-approved scope addition)

`relationshipArcProjectionFunctions.ts` REASSIGNED rather than accumulated, publishing the last
public event's DELTA as the current LEVEL: +5,+5,+5 published 5; +50 then -1 published -1. The
types already named the distinction (`RelationshipChange.trustDelta` vs
`RelationshipProjection.trust`).

No existing test pinned the wrong behaviour, and that is the point: the pure builder was always
handed levels and could not tell it was being handed deltas, and there was no wiring test at all.
The defect lived on the one seam nothing looked at — which is why this task adds
`relationshipGraphProjectionFunctions.test.ts` that calls the real handler rather than
re-implementing it, as the two harness ports do.

`BOUNDED` only coerced non-finite values to zero while its name and the docblock above
`buildRelationshipProjection` both claimed the dimensions were bounded. It now clamps to Canon's
own `[-100, 100]`, and it coerces BEFORE clamping — so an unreadable value publishes 0 rather
than maximum trust, which would have been the strongest possible claim about a relationship made
on the strength of a garbage number.

## Review findings closed before merge

Three HIGH: a docblock in three sites claiming the graph is "derived from other published read
models" when it reads Canon and has zero such call sites (the placement was right, the second
stated reason invented — and it contradicted this task's own ART-95 independence argument); the
retroactive-withhold gap above; and the untested wiring layer. Four MEDIUM including a
tautological edge arm in the bound assertion (`n + (m - n) === m`, which no change to the edge
filter could make fire) and a `buildTextEquivalent` that was computed, tested and documented as
ART-94's baseline but never rendered.

## Public surface

No new public function. The page reads through the existing `getPublishedReadModel` with a new
`modelRef`, so `publicReadOnlyGuarantee.test.ts`, `architecture/module-boundaries.json` and
`fixtureConvexClient.ts` are untouched and `readModelFunctions.ts` gains one line. Every guard
file has zero deletions.

## Not absorbed

ART-43 AC#1 (character page primary relationships) may now be satisfiable, since this is the
first client consumer of relationship data. Mentioned, not built toward and not checked — it is
ART-43's box. ART-94 retains the cross-surface P1 accessibility EVIDENCE pass over graph and
timeline together; the a11y baseline ships here because this task's own Test Requirements line
names accessibility.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the scoped relationship graph (FR-I007) as a new server-built published read model: current-arc core characters, one hop out, relationships changed in the last seven world days, capped at NFR-002's thirty nodes with a deterministic ordering and an explicit omitted-count rather than a silent cut. Server-side is forced rather than preferred, because relationship projections are one modelRef per pair and nothing enumerates the pairs, so a client cannot discover its own edges. It reads Canon rather than the published relationship model, whose payload carries three of six deltas and no world day; it also avoids Canon's own accumulated state, because that fold mixes private changes in with public ones. Nodes carry no character text at all, since a past day's graph is never rebuilt and a baked summary could not honour a retroactive withhold; the view reads character:<id> live instead. Also fixes a confirmed defect in merged ART-95 code that this graph would otherwise have rendered: the projection reassigned rather than accumulated, publishing the last event's delta as the current level, and BOUNDED claimed to bound while only coercing non-finite values. No existing test pinned the wrong behaviour because the pure builder could not tell levels from deltas and the wiring layer had no test, which this task adds. Verified on the branch merged with origin/main: npm run check exit 0 with 188 suites and 3022 tests passing, npm run e2e 82 passed run alone, and six fault injections each failing for the right reason. Three HIGH and four MEDIUM review findings closed before merge. PR #211.
<!-- SECTION:FINAL_SUMMARY:END -->
