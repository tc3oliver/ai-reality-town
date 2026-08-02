---
name: prd-to-backlog
description: Use when a product PRD exists (docs/product/PRD.md) but its requirements have not yet been converted into a complete Backlog.md milestone and task graph. Decomposes the PRD into independently acceptance-testable tasks with a dependency graph; do not modify product code until the graph is complete.
---

# prd-to-backlog

Convert the PRD into a complete, dependency-ordered Backlog.md task graph. Do **not**
modify product code until the graph is complete.

## Steps

1. Read the PRD (`docs/product/PRD.md`).
2. Build requirement traceability (each PRD requirement → one or more tasks).
3. Create a Backlog milestone for the delivery unit.
4. Create tasks that are each **independently acceptance-testable** (clear goal, scope,
   out-of-scope, acceptance criteria). Use the Backlog CLI, not manual edits.
5. Build the dependency graph (`--depends-on`) so order is explicit.
6. Check for gaps, cycles, duplicates, and mis-sized tasks — merge trivially small ones and
   split over-large ones. Prefer fewer, meaningful, reviewable tasks over many tiny ones.
7. Do **not** wait for human approval during decomposition.
8. Only after the graph is complete, select the first **Ready** task and invoke
   `/autonomous-task-loop`.

## Notes

- One task ↔ one branch ↔ one PR.
- Tasks must reference PRD requirement IDs for traceability.
- See `docs/agent/AUTONOMOUS-DEVELOPMENT.md`.
