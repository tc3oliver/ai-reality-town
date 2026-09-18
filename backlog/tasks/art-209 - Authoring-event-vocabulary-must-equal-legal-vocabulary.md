---
id: ART-209
title: Authoring event vocabulary must equal legal vocabulary
status: Done
assignee: []
created_date: '2026-09-18 17:51'
updated_date: '2026-09-18 18:02'
labels: []
dependencies: []
ordinal: 206000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A live slot failed with `[INVALID_EVENT_SHAPE] remediation events must be proposed by an administrator`.

The scene author's request schema (`WHOLE_SCENE_JSON_SCHEMA` in `convex/simulation/sceneSimulation.ts`) declares
`eventType: enumOf(EVENT_TYPES)`, and `EVENT_TYPES` includes `correction`, `compensation` and `retcon`.
`validateEventStructure` refuses all three unless `proposedBy.type === "admin"` AND `causedByEventIds` is
non-empty — and since ART-203 the request does not offer `causedByEventIds` at all. A scene author therefore
cannot legally use any of the three, while the schema hands the model all three as valid choices.

The same defect sits one field away: `proposedBy: { type: enumOf(PROPOSED_BY_TYPES) }` offers `admin`, which is
the authority that unlocks remediation. The authoring surface offers a role the author does not hold.

This is the ART-206 principle at the event-type level: a request that offers and forbids the same thing is
asking to be misread, and prose in the prompt is weaker than structure. The rule is

    sceneAuthorExposedEventTypes  is a subset of  sceneAuthorAuthorizedEventTypes

and it must hold by construction, not by a second hand-maintained enum that can drift from the validator.

This is a repository defect. Until it is closed, a qualification failure on this code cannot be attributed to
model capability.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The scene author request schema exposes no event type the structural validator refuses to that author, and no proposedBy type that grants authority the author does not hold
- [x] #2 The exposed vocabulary is DERIVED from one authorization policy table, not from a second hand-written enum; the remediation set and the validator read the same table
- [x] #3 A complete matrix of every EVENT_TYPES member is recorded (schema exposes / prompt describes / scene author authorized / structural validator accepts / Canon validator accepts / remediation-or-operator-only / system-only)
- [x] #4 A contract test derives the exposed set by walking the real WHOLE_SCENE_JSON_SCHEMA and the authorized set by probing the real validateEventStructure, and asserts the subset relation without either side reading the constant under test
- [x] #5 An out-of-vocabulary event type or proposedBy type in a model answer is refused at parse with a feedback-carrying code, so the narrowing is enforced at runtime and not only advertised in the schema
- [x] #6 Fault injection: restoring a remediation event type, or admin, to the scene author schema makes a named test fail
- [x] #7 No validator is relaxed, no remediation authorization is widened, and no retry budget changes
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
1. Build the matrix. For every EVENT_TYPES member, probe the REAL validateEventStructure with a
   minimal otherwise-valid event under each PROPOSED_BY_TYPES value, with and without causal ids,
   and record what each combination needs. Write the matrix into the task notes and the docs.

2. One policy table, in canon/eventTypes.ts. `EVENT_TYPE_AUTHORITY` maps every EventType to the
   authority proposing it requires (`narrative` | `remediation`), declared `as const satisfies
   Record<EventType, EventTypeAuthority>` so TypeScript makes it exhaustive. Derive from it:
     - `RemediationEventType` (mapped type, so the union is the table's and not a copy)
     - `REMEDIATION_EVENT_TYPES` (what validators.ts already reads)
     - `SCENE_AUTHOR_EVENT_TYPES`  = the narrative ones
     - `SCENE_AUTHOR_PROPOSED_BY_TYPES` = PROPOSED_BY_TYPES minus the privileged authority
   Deleting the hand-written REMEDIATION_EVENT_TYPES tuple is the point: one source, not two.

3. Narrow the request. `eventType: enumOf(SCENE_AUTHOR_EVENT_TYPES)` and
   `proposedBy.type: enumOf(SCENE_AUTHOR_PROPOSED_BY_TYPES)`. The schema is serialized into the
   prompt verbatim, so the prompt narrows with it.

4. Enforce at runtime, not only in the schema. The gateway does not enforce the schema (ART-141),
   so parseWholeSceneOutput must refuse an out-of-vocabulary eventType or proposedBy.type with
   SCENE_OUTPUT_INVALID and a path, and canonFeedback must carry an instruction for it so the
   retry is told what to do.

5. Contract test, no shared constant on either side. Exposed set = walk WHOLE_SCENE_JSON_SCHEMA.
   Authorized set = probe validateEventStructure. Assert exposed is a subset of authorized. A
   validator must not be handed its own input, so neither side may read SCENE_AUTHOR_EVENT_TYPES.

6. Fault injection: put `retcon` back in the exposed enum, and `admin` back in the proposedBy enum,
   and confirm each makes a NAMED test fail. Then restore.

7. npm run check, PR, auto-merge, deploy acceptance (npx convex dev --once), one live slot.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause and fix

  The whole-scene request declared `eventType: enumOf(EVENT_TYPES)` and
  `proposedBy.type: enumOf(PROPOSED_BY_TYPES)`. Four of those values are not the scene author's to
  use: `correction`, `compensation`, `retcon`, and the `admin` authority that unlocks them.

  Matrix (probed against the real `validateEventStructure`, `causedByEventIds: []`):

    conversation movement relationship_change discovery rumor world_event   accepted from
                                                                            system/director/character
    correction compensation retcon                                          refused unless
                                                                            proposedBy.type = admin
                                                                            AND causal ids non-empty

  `admin` + `retcon` + cited ids is the only accepting combination, and a scene author has none of
  the three: ART-203 removed `causedByEventIds` from the request and the parser fills it with [].

  One table now answers it. `EVENT_TYPE_AUTHORITY` in `convex/canon/eventTypes.ts` maps every
  EventType to `narrative | remediation`, `as const satisfies Record<EventType, EventTypeAuthority>`
  so TypeScript enforces exhaustiveness. `RemediationEventType` is a MAPPED TYPE over it, so the
  hand-written tuple is gone and the union is the table. `SCENE_AUTHOR_EVENT_TYPES` and
  `SCENE_AUTHOR_PROPOSED_BY_TYPES` are its complement; `validators.ts` compares against
  `REMEDIATION_PROPOSED_BY_TYPE` rather than a bare literal.

  Enforced at parse, not only in the schema. ART-141 established the gateway accepts strict mode and
  does not enforce it. `assertSceneAuthorVocabulary` runs BEFORE normalization, because a remediation
  type would otherwise be refused first by `validateEventStructure` with a rule about administrators
  (dead code for the case it was written for), and because an `admin`-proposed `conversation` is
  structurally ACCEPTED and has no downstream backstop at all.

Fault injection (five, all restored)

  1. `retcon: narrative` in the authority table
     -> "refuses a remediation event type, naming the field rather than the administrator rule" FAILS.
     Correctly only that one: when the authority table moves, the validator moves with it and the
     schema is then genuinely consistent.
  2. `enumOf([...SCENE_AUTHOR_EVENT_TYPES, retcon])` in the request only -> 5 FAIL, headed by
     "offers no event type the validator refuses to this author".
  3. `enumOf([...SCENE_AUTHOR_PROPOSED_BY_TYPES, admin])` -> 3 FAIL, headed by
     "offers no proposer that grants authority beyond that vocabulary".
  4. `assertSceneAuthorVocabulary` call deleted -> the three parse-enforcement cases FAIL.
  5. ART-209 pattern removed from PARSER_INSTRUCTIONS ->
     "turns the refusal into an instruction the next attempt can act on" FAILS.

Gate

  npm run check exits 0: 280 suites, 4927 tests (baseline 279 / 4914; +1 suite, +13 tests).
  `npm run codegen:api` was needed once — pre-existing drift from an earlier `npx convex dev --once`.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The scene author's request offered four values it may not use: the three FR-K003 remediation
event types and the `admin` authority that unlocks them. A live slot spent an attempt on
`[INVALID_EVENT_SHAPE] remediation events must be proposed by an administrator`.

`EVENT_TYPE_AUTHORITY` is now the one table that answers who may propose what, made exhaustive over
`EventType` by `as const satisfies`. `RemediationEventType` is a mapped type over it rather than a
hand-written tuple, and the two scene-author vocabularies are its complement, so exposed-is-a-subset-
of-authorized holds by construction. `validators.ts` compares against `REMEDIATION_PROPOSED_BY_TYPE`,
so the rule granting the authority and the rule deciding what may be offered are one fact.

Because the gateway accepts strict mode without enforcing it (ART-141), `assertSceneAuthorVocabulary`
refuses an out-of-vocabulary answer at parse, before normalization, and the refusal carries an
instruction the retry can act on.

Verified by `convex/simulation/authoringVocabularyContract.test.ts`, which builds the exposed set by
walking the real `WHOLE_SCENE_JSON_SCHEMA` and the authorized set by probing the real
`validateEventStructure`, so neither side reads the constant under test; and by five fault injections
that each fail a named case (recorded in the notes). `npm run check` exits 0 at 280 suites / 4927
tests. No validator was relaxed and no retry budget changed.
<!-- SECTION:FINAL_SUMMARY:END -->
