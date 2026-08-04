---
id: ART-116
title: 'Persist public runtime snapshots with live, delayed, paused and stale states'
status: To Do
assignee: []
created_date: '2026-08-04 15:58'
updated_date: '2026-08-04 16:01'
labels:
  - prd-2.0
  - v2-d
  - epic-n
dependencies:
  - ART-115
priority: high
type: feature
ordinal: 116000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-N007 (PRD 2.0 §12 Epic N)

**Problem / Context:** Simulation runs only five slots per real day and can be paused or fail. Without a durable last-valid snapshot the public view would go blank, and without honest staleness labelling it would silently imply live updates.

**Goal:** A sequenced, timestamped public runtime snapshot readable with no simulation running, plus an explicit freshness classification the client can display.

**Scope:**
- Persist `PublicRuntimeSnapshot` with `snapshotSequence`, `status`, `createdAt`, `sourceRuntimeSequence`, character and active-scene states.
- Readable while no simulation is executing.
- Classify freshness as Live, Delayed, Paused or Stale and expose it publicly.
- Guarantee sequence never regresses after reconnect.
- Snapshot failure must not affect the Canon event store.

**Out of Scope:** Renderer degradation ladder (FR-O010); operator pause controls (FR-Q002).

**Dependencies:** FR-N003 public dynamic projection.

**Schema Impact:** New `PublicRuntimeSnapshot` table (PRD 2.0 §14.3).

**API Impact:** Public read surface exposes snapshot sequence, timestamp and freshness status.

**Security Impact:** Snapshot contents inherit the FR-N003 whitelist; no additional exposure permitted.

**Test Requirements:** Snapshot selection tests, sequence monotonicity across reconnect, readability with no simulation running, and proof that snapshot failure leaves the Canon event store intact.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Snapshot and freshness semantics documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Snapshots carry a sequence number and timestamp
- [ ] #2 A snapshot is readable when no simulation is executing
- [ ] #3 The client can tell whether data is Live, Delayed, Paused or Stale
- [ ] #4 A stale snapshot is never presented as continuously updating
- [ ] #5 Snapshot failure does not affect the Canon event store
- [ ] #6 Sequence never regresses after a client reconnect
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
