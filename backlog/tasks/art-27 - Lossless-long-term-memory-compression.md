---
id: ART-27
title: Lossless long-term memory compression
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-25 12:50'
labels:
  - prd-1.0
  - epic-g
milestone: m-0
dependencies:
  - ART-26
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-E004

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Compress old memories into impressions, beliefs, relationship summaries, arc understanding, and location experience without changing canon or deleting source memories.

Scope
Compress old memories into impressions, beliefs, relationship summaries, arc understanding, and location experience without changing canon or deleting source memories.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-26

Schema Impact
Character Knowledge, Memory, compression, retrieval-trace, or rumor-chain records named by the task.

API Impact
Authorized cognition queries and event-derived update interfaces; no cross-character unrestricted access.

Security Impact
Private knowledge/memory is least-privilege, source-proven, and excluded from public output.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Tests cover recall parity, source retention, canon isolation, and failure recovery.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-E004: 原始 Event 仍保留。
- [x] #2 FR-E004: 壓縮不得改變 Canon。
- [x] #3 FR-E004: 壓縮後角色仍能回想高重要度事件。
- [x] #4 FR-E004: 壓縮失敗不得刪除原始記憶。
- [x] #5 Automated tests provide evidence for every mapped FR-E004 acceptance criterion, including rejection and failure paths.
- [x] #6 PRD traceability links FR-E004 to doc-1 and the merged implementation evidence.
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
1. Establish the lossless contract before coding: compression is a PURE, non-writing projection over the Accepted-Event-derived memory list, so 'lossless' is defined as (a) provenance-total — the union of every digest's sourceMemoryIds equals the input memory id set exactly, (b) round-trippable — expandCompressedMemories(compress(m), m) returns the input records verbatim, and (c) recall-preserving — retrieval over the compressed corpus returns every retained memory the uncompressed corpus would have returned, at the same or better rank. Each is a machine-checked property, not prose.
2. Add convex/knowledge/memoryCompression.ts: a pure deterministic reducer producing the five FR-E004 digest kinds (long-term impression, stable belief, relationship summary, arc understanding, location experience) from a character's memories plus a least-privilege per-event context (participants, location, arc ids) supplied by the caller. No clock, no randomness, no Convex, no writes. Retention rule keeps recent memories and every memory at or above HIGH_IMPORTANCE_RETENTION verbatim; only old low-importance memories are folded into digests only.
3. Add expandCompressedMemories + compressedRetrievalCorpus so a digest is an INDEX over Canon, never a replacement for it, and reject malformed input (unknown/duplicate/unused event context, bad horizon, cross-character request) via CanonError before any output is produced.
4. Expose an authorization-first internalQuery in convex/knowledge/memoryQueries.ts that replays canon events, authorizes the requester against the memory owner, narrows event contexts to exactly the events the character remembers, and returns the digest. Internal only; no public read path and no LLM call.
5. Tests: memoryCompression.test.ts for behaviour and every failure path (AC#4 asserts a failed compression mutates nothing, with deep-frozen inputs), and memoryCompression.lossless.test.ts for the three lossless properties including an exhaustive recall-parity sweep over every limit 1..MAX_RETRIEVED_MEMORIES against the real FR-E003 retriever (AC#3). Prove non-vacuity by fault injection and record the injected-failure counts.
6. Docs: docs/long-term-memory-compression.md stating precisely what is lossless, what is lossy, and why; update the FR-E004 and RISK-003 rows in docs/prd-1.0-closure-matrix.md.
7. Gates: npm run check (architecture, asset licenses, typecheck, lint, jest, build), then PR with auto-merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented FR-E004 as a pure, non-writing projection over the Accepted-Event-derived memory list rather than as a rewrite-and-delete job.

Design decisions (full rationale in docs/long-term-memory-compression.md):
- Compression is an INDEX over Canon, not a replacement. `characterMemories` is replayed from the append-only event log, so there is nothing to delete; AC#1 and AC#4 become structural rather than disciplinary. `memoryCompression.boundary.test.ts` walks the real import graph and pins that the module's entire value-import closure is `convex/shared/errors.ts` — no Canon write path, no Convex runtime, no provider package, no mutation/action/scheduler surface.
- 'Lossless' is defined as three machine-checked properties, not prose: (1) exact partition — retained ids and the union of digest sourceMemoryIds are disjoint and cover the input exactly; (2) round trip — expandCompressedMemories(compress(m), m) === m verbatim; (3) recall preservation — retrieval over the compressed corpus returns every retained memory the uncompressed corpus would have returned, at the same or better rank. Property 3 is a theorem (every FR-E003 factor scores one memory independently, ties break on stable id, so dropping candidates can only promote a survivor) and is checked exhaustively against the REAL retriever over 4 queries x limits 1..12.
- The lossy dimension is asserted, not hidden: an old low-importance memory leaves the retrieval corpus. A dedicated test finds exactly those memories and proves each is still cited by a digest and still recoverable through the expansion. Without it the suite would pass against a compression that compressed nothing.
- Digest `summary` is a deterministic template. An LLM summarizer would mean a provider producing cognition state instead of proposing an event, and would make properties 1 and 3 uncheckable.
- Arc/location/participant facts arrive as a caller-supplied, exactly-narrowed event context, because `knowledge` may not depend on `story` (architecture/module-boundaries.json). A surplus context is rejected rather than ignored — least privilege checkable at the boundary.
- Retention: importance >= HIGH_IMPORTANCE_RETENTION (0.7) OR age < horizonDays. World time only, never Date.now(). Compression is a fixed point, so a scheduled pass cannot keep folding the same history.

Focused verification: NODE_OPTIONS=--experimental-vm-modules npx jest --selectProjects unit --testPathPattern 'memoryCompression' -> 3 suites, 32 tests, all passing.

Fault injection (non-vacuity evidence; source backed up by file copy and restored, never via git checkout). Six independent defects injected into memoryCompression.ts, each caught:
1. Drop one memory while folding -> 2 failed (impression-totality + exact-partition).
2. Remove the high-importance clause from the retention rule -> 3 failed (AC#3 survival, AC#3 recall sweep, retention behaviour).
3. Return retained records aliased instead of copied -> 1 failed (AC#2 no-mutation, deep-frozen input).
4. Skip the missing-event-context guard -> 1 failed (UNKNOWN_EVENT_REFERENCE rejection).
5. Drop digest sources from expandCompressedMemories -> 4 failed (round trip, recoverability-of-loss, expansion-derived statistics, corpus-completeness rejection).
6. Import convex/canon/commit.ts into the module -> 3 failed in the boundary suite (Canon write path, pinned closure, no Convex runtime import). Note: npm run check:architecture still passed for this one, which is exactly why the file-level boundary suite exists — the declared-roots checker allows knowledge -> canon.

Full gate: npm run check -> check:architecture, test:architecture, check:asset-licenses, test:asset-licenses, typecheck, lint, jest (168 suites, 2598 passed, 5 skipped, 2603 total), build — all green. The 5 skips are the pre-existing ART60_LONG_RUN env-gated 30-day cases, untouched by this task.

Deliberately NOT done: no scheduler/cron wiring and no simulation-side caller — the task scope is the compression capability and its evidence, and adding an automatic pass would be new behaviour outside the ACs. convex/_generated/api.d.ts was not regenerated: no Convex deployment is configured in this checkout, CI does not run codegen, and the same is true of the pure modules merged in ART-123. docs/public-test-acceptance-art-63.md was left unedited: it is a dated historical release record, and its claim that ART-27 is not on the public path remains true (the new query is internalQuery only).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered FR-E004 and closed the RISK-003 history-compression gap: a character's old memories fold into the five PRD digest kinds (long-term impression, stable belief, relationship summary, arc understanding, location experience) while the Accepted Event log, Canon, and every source memory are untouched.

The load-bearing decision is that compression is an INDEX over Canon, not a replacement for it. `characterMemories` is a replay of the append-only event log, so `compressCharacterMemories` is a pure function that writes nothing — AC#1 (原始 Event 仍保留) and AC#4 (壓縮失敗不得刪除原始記憶) hold structurally rather than by discipline, and memoryCompression.boundary.test.ts proves it by walking the real import graph (single value import: convex/shared/errors.ts; no Canon write path, no Convex runtime, no provider, no mutation/action/scheduler).

'Lossless' is a machine-checked property, not a promise. memoryCompression.lossless.test.ts fixes three: exact partition of the corpus (AC#1), verbatim round trip through expandCompressedMemories (AC#1), and recall preservation against the REAL FR-E003 retriever across four disagreeing queries at every limit 1-12 (AC#3, which follows because every memory at or above HIGH_IMPORTANCE_RETENTION is retained regardless of age). The one lossy dimension — an old, low-importance memory leaves the retrieval corpus — is asserted rather than merely described: the suite locates those memories and proves each remains cited by a digest and recoverable through the expansion.

Verification. npm run check green end to end: architecture boundaries, architecture tests, asset licenses, typecheck, lint, Jest 168 suites / 2598 passed / 5 pre-existing env-gated skips / 2603 total, and build. Focused suite: 3 suites, 32 tests. Non-vacuity proven by six independent fault injections into memoryCompression.ts (dropped fold, removed importance retention, aliased records, skipped context guard, truncated expansion, forbidden Canon-write import), each restored from a file backup and each caught by 1-4 tests. Injection 6 additionally showed why the file-level boundary suite exists: npm run check:architecture stayed green, because the declared-roots checker legitimately allows knowledge -> canon.
<!-- SECTION:FINAL_SUMMARY:END -->
