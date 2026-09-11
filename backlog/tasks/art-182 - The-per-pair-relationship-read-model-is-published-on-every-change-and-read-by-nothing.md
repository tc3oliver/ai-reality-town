---
id: ART-182
title: >-
  The per-pair relationship read model is published on every change and read by
  nothing
status: To Do
assignee: []
created_date: '2026-09-11 20:02'
labels: []
dependencies: []
type: chore
ordinal: 180000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ART-40 publishes a `relationship` read model per character pair — `relationshipArcProjectionFunctions.ts:113` commits `modelRef: `relationship:${payload.pairKey}`` on every relationship change — and **no code reads it**. `RELATIONSHIP_MODEL_KIND` has exactly three references in the repository: its own declaration, the import, and that one write.

The surface a viewer actually gets is the FR-I007 scoped graph (`relationshipGraph`), and the code says in three places that it deliberately does NOT read this model:

- `relationshipGraphProjection.ts:20` — 「Why the input is CANON, not the published `relationship:<pairKey>` model」
- `relationshipGraphProjection.ts:11` — no published model enumerates the pairs, so a client could not discover them even if it wanted to
- `src/components/public/characterRoute.ts:432` — 「Reads the graph rather than the per-pair `relationship:<pairKey>` models」

So this is not「published for a consumer that has not shipped yet」. Two consumers shipped and both reasoned their way past it. What remains is a per-event write cost — one `commitReadModelVersion`, its hash, its version allocation and its row — on a path CLAUDE.md §9 specifically warns about, plus a public surface nobody audits because nobody reads it.

What the task has to settle, and it is a judgement rather than a defect fix: whether FR-I006 requires a per-pair PUBLIC model at all, or only the public projection shape (which `relationshipArcProjection.ts` would keep, since the graph builder reuses its dimension rules). If the PRD requires the model, the gap is the missing reader; if it requires only the projection, the gap is the publication. Read `backlog/docs/prd/` before deciding, and do not delete a published model kind because it is currently unread — `visualReplay` and `voteConsequence` are also single-consumer kinds and are not this.

Out of scope: the `relationshipGraph` kind, and the `arc` kind published by the same module (which IS read).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The PRD question is answered in writing, citing the clause, before anything is changed
- [ ] #2 Either the per-pair model has a reader, or it is no longer published and the read-model kind list, the schema union and the generated API agree with that
- [ ] #3 The FR-I007 graph and the character page are unchanged in what they render
- [ ] #4 A fault injection proves whichever side was chosen
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
