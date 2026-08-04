---
id: ART-117
title: Synchronize Canon location changes into runtime movement with zone arrival
status: To Do
assignee: []
created_date: '2026-08-04 15:58'
updated_date: '2026-08-04 16:01'
labels:
  - prd-2.0
  - v2-e
  - epic-n
dependencies:
  - ART-115
priority: high
type: feature
ordinal: 117000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-N006 (PRD 2.0 §12 Epic N)

**Problem / Context:** Canon states semantic facts ("Lin Yingxue is at the clinic") while the runtime needs a journey. Publishing the Canon fact immediately would contradict a sprite still walking; publishing only on arrival would lag. PRD 2.0 §10.5 requires an explicit in-transit phase and forbids a character appearing in two public places.

**Goal:** An idempotent synchronization path turning accepted Canon location changes into runtime movement, with an honest movement phase and zone-based arrival confirmation.

**Scope:**
- Detect visual-relevant state changes from accepted events.
- Create idempotent runtime sync commands keyed so retries never duplicate.
- Movement phase state machine: in-transit renders "heading to X"; only zone arrival renders "at X".
- Persist `RuntimeSyncRecord` with status, timestamps, error code and retry count.
- Stable error codes and drift metrics.

**Out of Scope:** Trajectory planning (FR-N010); client-side interpolation (FR-O002); operator drift tooling (FR-Q002).

**Dependencies:** FR-N003 public dynamic projection.

**Schema Impact:** New `RuntimeSyncRecord` table (PRD 2.0 §14.5).

**API Impact:** Movement phase surfaced through the public projection.

**Security Impact:** Runtime failure must never write back incorrect Canon; the sync path is strictly Canon-read / runtime-write.

**Test Requirements:** Integration tests for location change to correct zone arrival, in-transit then arrived labelling, idempotent retry, runtime failure leaving Canon unmodified, and no dual-location publication.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Canon/runtime synchronization and drift-handling documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Canon location change is converted into a valid runtime destination
- [ ] #2 The UI shows an in-transit state while the character is moving
- [ ] #3 The character is only shown as located at the target after zone arrival is confirmed
- [ ] #4 Runtime failure never writes incorrect Canon
- [ ] #5 Retries never create duplicate Canon events
- [ ] #6 A character is never published at two locations simultaneously
- [ ] #7 Sync errors carry stable error codes and observable metrics
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
