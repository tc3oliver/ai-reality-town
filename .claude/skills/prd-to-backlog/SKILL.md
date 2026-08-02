---
name: prd-to-backlog
description: Use when a product PRD exists (as a backlog doc entry under `backlog/docs/prd/`) but its requirements have not yet been converted into a complete Backlog.md milestone and task graph. Decomposes the PRD into independently acceptance-testable tasks with a dependency graph; do not modify product code until the graph is complete.
---

# prd-to-backlog

Convert the PRD into a complete, dependency-ordered Backlog.md task graph. Do **not**
modify product code until the graph is complete.

## Steps

1. Read the PRD: `npm run backlog -- doc list --plain` then `npm run backlog -- doc view <docId>`.
2. Create a milestone for this PRD version: `npm run backlog -- milestone create "<PRD title>"`.
3. Build requirement traceability (each PRD requirement → one or more tasks).
4. Create tasks that are each **independently acceptance-testable** (clear goal, scope,
   out-of-scope, acceptance criteria). Use the Backlog CLI, not manual edits.
5. Assign tasks to the milestone (`-m <milestoneId>`) and build the dependency graph
   (`--depends-on`) so order is explicit.
6. Check for gaps, cycles, duplicates, and mis-sized tasks — merge trivially small ones
   and split over-large ones. Prefer fewer, meaningful, reviewable tasks over many tiny ones.
7. Do **not** wait for human approval during decomposition.
8. Only after the graph is complete, select the first **Ready** task and invoke
   `/autonomous-task-loop`.

## PRD versioning

- Each PRD version is a separate `backlog doc` under `backlog/docs/prd/`.
- Naming: `PRD: <topic> v<N>` (e.g. `PRD: Mistwood v1`, `PRD: Mistwood v2`).
- Each version gets its own milestone; tasks from v1 and v2 are fully isolated.
- A new version implies the previous version's milestone is complete (or superseded).
- Old versions are never edited — they remain as historical records in the backlog.
