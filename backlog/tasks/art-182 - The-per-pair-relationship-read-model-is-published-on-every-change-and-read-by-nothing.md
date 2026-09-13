---
id: ART-182
title: >-
  The per-pair relationship read model is published on every change and read by
  nothing
status: Done
assignee:
  - '@tc3oliver'
created_date: '2026-09-11 20:02'
updated_date: '2026-09-13 04:42'
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
- [x] #1 The PRD question is answered in writing, citing the clause, before anything is changed
- [x] #2 Either the per-pair model has a reader, or it is no longer published and the read-model kind list, the schema union and the generated API agree with that
- [x] #3 The FR-I007 graph and the character page are unchanged in what they render
- [x] #4 A fault injection proves whichever side was chosen
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
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. AC#1 — answer the PRD question in writing before touching code. FR-I006 (the clause both modules' docblocks cite) is the *Story Arc* page and names no relationship field at all. The relationship clauses are FR-I005 (character page 「主要關係」) and FR-I007 (scoped graph: current-arc core characters, one-hop, last-7-day changes, 「不得預設渲染全部角色與全部關係」, NFR-002's <=30 nodes). PRD 13.3 defines Relationship as a product-layer ENTITY, under a section that says 「實際資料庫 Schema 由技術設計決定」. So the PRD requires the projection shape and the page content; it does not require a per-pair PUBLIC read model. The gap is the publication.
2. PRD 12 stage 14 「Update Relationships」 stays, and so does the 'relationship' stage literal in operations/schema.ts. The state update is already the deterministic reducer's (convex/canon/reducer.ts:273 folds relationship_changed into projection.relationships + relationshipHistory), replayed at stage 11. Stage 14 becomes what stages 12 and 13 already are — a record of what the commit did (the pairs it moved) — instead of the only one of the three that also publishes.
3. Delete the publication: rebuildRelationshipProjection (internalMutation), the PostCommitLivePort method, its internalFunctionRef, the longRunHarness and postCommitLive.test doubles, and buildRelationshipProjection / RelationshipProjection / RELATIONSHIP_MODEL_KIND / pairKey once unused. KEEP accumulatePublicRelationshipDimensions and RELATIONSHIP_DIMENSIONS — the FR-I007 graph builder reuses them.
4. Close the anonymous surface. getPublishedReadModel is gated 'anonymous' and takes (worldId, modelKind, modelRef), so every pair was fetchable by anyone who could guess a pairKey, unscoped and unbounded, while the shipped surface for the same data is deliberately scoped. Remove 'relationship' from READ_MODEL_KINDS: modelKindValidator is derived from it, so the query rejects the kind at the arg validator, and assertTarget throws for any legacy row.
5. KEEP v.literal('relationship') in publicRead/schema.ts. Existing deployment rows carry modelKind: 'relationship' and Convex validates existing documents on deploy, so deleting the storage literal would fail the owner's next deploy — a migration, not a cleanup. Retire it in the storage union with a named comment and pin the split: live kinds == schema union minus exactly the retired set.
6. Tests and fault injections (AC#4): no module publishes the retired kind; READ_MODEL_KINDS omits it while the storage union retains it; stage 14 reports the moved pairs and writes nothing; the FR-I007 graph and the character page render the same (AC#3).
7. Docs: prd-1.0-closure-matrix FR-I006/FR-I007 rows, prd-2.0-requirement-matrix, docs/scoped-relationship-graph.md. Then npm run check + npm run e2e.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## The PRD answer (AC#1), written before any code changed

FR-I006 — the clause both `relationshipArcProjection.ts` and its Functions module cited in their headers — is the **Story Arc page**. It lists Title, Premise, Current Question, Status, Core Characters, Essential Backstory, Inciting Event, Latest Turning Point, Recommended Entry, Related Episodes, Known Clues, Unresolved Questions and Outcome. It names no relationship field at all, so it cannot be the clause that requires a per-pair public model.

The clauses that do describe a public surface for relationships are:

- **FR-I005** (P0, character page): 「主要關係」 is one of ten page fields. `src/components/public/characterRoute.ts` serves it from the FR-I007 graph and records why.
- **FR-I007** (P1, 關係圖): 「預設只顯示 當前 Arc 核心人物／一階關係／最近七日有變化的關係」 and 「不得預設渲染全部角色與全部關係」. Served by `relationshipGraph:<worldId>:<worldDay>`, bounded at 30 nodes by NFR-002.
- **§13.3** defines a Relationship ENTITY — id, worldId, source, target, six dimensions, visibility, lastUpdatedEventId — under a §13 preamble that says 「以下為產品層必要 Entity，實際資料庫 Schema 由技術設計決定」.

So the PRD requires the **projection shape and the page content**, not a published model per pair. **The gap is the publication**, which is the branch AC#2 offers second.

One finding the task description did not have. `getPublishedReadModel` is gated `anonymous` in `architecture/module-boundaries.json` and takes `(worldId, modelKind, modelRef)`. Character ids are public, and `pairKey` is the two of them sorted — so while the kind was live, any visitor could fetch any pair by guessing, with none of the scoping FR-I007 puts on the graph that serves the same data. That makes this more than dead write cost: it was an unaudited parallel path to data the PRD deliberately scopes.

## Why PRD §12 stage 14 survives the deletion

§12 lists twenty-one stages and the fourteenth is 「Update Relationships」. That stage is NOT the publication: `convex/canon/reducer.ts:273` folds every `relationship_changed` into `projection.relationships` and `relationshipHistory` deterministically, and stage 11 replays it. The pipeline's stage 14 was the only one of stages 12/13/14 that also wrote something; it now has the same shape as its two neighbours — it reports what the accepted event did (`pairKeys`) and writes nothing. The stage keeps its name, its checkpoint literal in `operations/schema.ts`, and its place in the order.

## Why the stored schema literal stays

Removing `v.literal('relationship')` from `convex/publicRead/schema.ts` would be the obvious cleanup and would **break the owner's next deploy**: rows written before this change carry that `modelKind`, and Convex validates existing documents against the schema on deploy. So the kind leaves the LIVE vocabulary (`READ_MODEL_KINDS`, and with it the anonymous query's arg validator and `assertTarget`) and stays in the STORED one, listed in `RETIRED_READ_MODEL_KINDS` with a test pinning both halves. Legacy rows are inert, not served.

## Fault injections (AC#4)

Seven, each expected to make a NAMED test fail. All seven bit.

| # | Injection | Named failure |
| --- | --- | --- |
| 1 | `'relationship'` back in `READ_MODEL_KINDS` | `retiredReadModelKinds`: *is retired, and is not live*; *refuses to serve a legacy row…*; `viewerKnowledgeProjection`: *is registered in all three places…* |
| 2 | `v.literal('relationship')` deleted from the stored union (the deploy-breaking 'cleanup') | *is still a literal in the stored union, so existing rows deploy*; + the three-places test |
| 3 | `modelKind: 'relationship'` added to a publication call | *names it in no publication call anywhere under convex/* |
| 4 | kind restored to the anonymous query's arg validator only | *is not nameable by the anonymous query…*; + the three-places test |
| 5 | stage 14 returns `{ pairKeys: [] }` | `postCommitLive`: *turns live-committed events into cognition, arcs, episodes, recaps and servable read models* |
| 6 | stage 14 drops the `visibility === 'public'` filter | `postCommitLive`: *ignores non-public relationship changes* |
| 7 | `'relationship'` removed from `POST_COMMIT_STAGES` | *keeps stage 14 「Update Relationships」 in the post-commit pipeline* |

**Injection 7 did not bite on the first attempt, and the way it failed is worth recording.** The assertion named the stage at its own type, so deleting the stage made the SUITE fail to compile — reported as `Tests: 0 total`, which is indistinguishable from a clean pass in a filtered summary (CLAUDE.md §9). The assertion was widened to `readonly string[]` so a stage leaving the pipeline fails a named test instead of the loader; re-run, it does.

**A process note.** Injections 1 and 2 were first run with `git checkout <file>` as the restore step, which reverted the task's own unstaged edits to those files and made injection 2's result meaningless (`Tests: 0 total`, from the import that no longer existed). The work was re-applied, staged, and every later injection restored with `git checkout-index -f`. Injection 2's table row above is the re-run.

## Verification

- `npm run check` — exit 0. 259 suites, **4528 passed / 31 skipped** (baseline before this task: 4525; +7 new in `retiredReadModelKinds.test.ts`, net of the per-pair payload tests removed with their subject). Build clean.
- `npm run e2e` — **124 passed**, which is AC#3: the FR-I007 graph and the character page render exactly what they did.
- `npm run check:architecture` — 20 modules valid. `check:closure-matrix` / `check:closure-record` — both pass.
- No file was added to or deleted from `convex/` other than a `*.test.ts`, which `check:generated-api` excludes, so no `codegen:api` run was required.

**The first `npm run e2e` of this task failed 24 desktop specs at 1ms each — not this change.** Playwright's chromium-headless-shell binary was missing from the local cache (`chromium_headless_shell-1234`). `npx playwright install chromium`, then 124 passed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Retired the per-pair `relationship:<pairKey>` read model: it was published on every relationship change and read by nothing, and the PRD does not ask for it. FR-I006 — the clause the publishing module cited — is the Story Arc page and names no relationship field; the relationship clauses are FR-I005 (「主要關係」, served from the graph) and FR-I007 (the scoped graph), and §13.3 defines Relationship as a product-layer ENTITY under a section that leaves the schema to technical design. So the gap was the publication, not a missing reader.

Deleted `rebuildRelationshipProjection`, `buildRelationshipProjection`, the payload types and the port method; kept `accumulatePublicRelationshipDimensions` and `RELATIONSHIP_DIMENSIONS`, which the FR-I007 graph builder reuses. PRD §12 stage 14 「Update Relationships」 stays a stage — the update it names is the deterministic reducer's, replayed at stage 11 — and now reports the pairs the event moved, the same shape stages 12 and 13 have.

Two things the task description did not contain. `getPublishedReadModel` is gated `anonymous`, so while the kind was live any visitor who could guess a pairKey could fetch any pair, unscoped — this was an unaudited parallel path to data FR-I007 deliberately scopes, not only dead write cost. And the obvious cleanup would have broken the owner's next deploy: existing rows carry `modelKind: 'relationship'` and Convex validates existing documents, so the kind leaves the LIVE vocabulary and stays in the STORED one, split as `READ_MODEL_KINDS` vs `RETIRED_READ_MODEL_KINDS` and pinned in both directions.

Verified: `npm run check` exit 0 (4528 passed / 31 skipped, build clean); `npm run e2e` 124 passed, which is AC#3; seven fault injections each failing a named test, including one that had to be rewritten because it first failed as a compile error (`Tests: 0 total`) rather than as a test.
<!-- SECTION:FINAL_SUMMARY:END -->
