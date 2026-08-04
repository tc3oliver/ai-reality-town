# Recoverable world-day orchestration

ART-23 implements PRD Section 12 stages 1–10 as one ordered, recoverable pre-commit workflow. It stops at Accepted Event commit; projection updates, cognition, Story Arc classification, editorial generation, publication, snapshots, and metrics belong to later tasks.

This document describes the stage sequencer itself. The live handlers that bind it to a deployment — and the entry point that executes a queued world time slot — are documented in `docs/world-day-execution.md` (ART-97).

## Ordered stages

`WORLD_DAY_STAGES` is the canonical order:

1. load world state
2. apply scheduled environment events
3. load active Story Arcs
4. generate the daily Director Plan
5. generate character intents
6. group intents into scenes
7. simulate scenes
8. validate structured output
9. validate Canon
10. atomically and idempotently commit Accepted Events

Every stage receives only the immutable artifacts of its completed predecessors. The runtime persists a `running` checkpoint before invoking a stage and then records either its completed artifact or stable error. A failed or interrupted run resumes at the first incomplete stage; it cannot skip a predecessor. Completed runs are terminal and repeated execution returns their existing event references without invoking handlers again.

## Persistence and retry contract

`worldDayRuns` stores identity, attempt count, status, exact failure stage/code, and committed event IDs. `worldDayCheckpoints` stores one row per stage attempt. Failed attempts remain available after retry, so operations can distinguish a new attempt from a mutation of history. The internal-only create, checkpoint, run-update, and inspection functions provide the durable adapter boundary.

The stage-10 handler is a single atomic commit boundary. It must use the Canon commit transaction and return unique `committedEventIds`; malformed evidence fails the run. Structural and Canon validation are separate prior stages, so either rejection prevents the commit handler from running. A commit transaction failure records stage 10 and must roll back the complete candidate batch. Canon idempotency keys make a safe retry return existing Accepted Events rather than append duplicates.

## Verification

The focused suite injects a failure at every stage, proves stages execute in order, proves validation failures perform no Canon write, preserves checkpoint attempts across safe resume, verifies completed-run and run-ID idempotency, demonstrates atomic batch rollback, and rejects invalid commit evidence.
