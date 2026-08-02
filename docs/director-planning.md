# Constrained Director planning

ART-19 implements PRD FR-C002 and the Section 10.1 scene bound.

Each Director Run receives a versioned context containing active Story Arcs, unresolved
questions, recent Accepted Event references, character goals/current locations/absence,
viewer interventions, environment facts, repetition score, and pacing stage. A plan is
scoped to exactly one world day and time slot and contains zero to three major scene
candidates.

Scene candidates contain a trigger, dramatic pressure, location, participants, possible
Arc links, protected facts, and expected state-change types. The runtime parser rejects
unknown fields, including any provider attempt to prescribe a final outcome or dialogue.
It also rejects characters planned in two simultaneous scenes, characters unavailable at
the scene location, unknown active Arc references, and mismatched Director Run/time data.

Validated contexts and plans are persisted idempotently by `directorRunId` behind internal
Convex mutations and queries. They are proposals for later intent/scene work and cannot
write Canon state.

Focused verification:

```bash
npm test -- --runTestsByPath convex/simulation/director.test.ts
```
