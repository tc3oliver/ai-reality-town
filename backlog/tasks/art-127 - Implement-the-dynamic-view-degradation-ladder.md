---
id: ART-127
title: Implement the dynamic view degradation ladder
status: To Do
assignee: []
created_date: '2026-08-04 15:59'
updated_date: '2026-08-04 16:02'
labels:
  - prd-2.0
  - v2-j
  - epic-o
dependencies:
  - ART-116
  - ART-118
priority: high
type: feature
ordinal: 127000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O010 (PRD 2.0 §12 Epic O)

**Problem / Context:** WebGL failure, stream loss or renderer error must never leave the viewer with a blank page or, worse, trigger retries into the generation pipeline.

**Goal:** A four-level degradation ladder that always leaves the world comprehensible and never escalates cost.

**Scope:**
- Ladder: normal runtime stream, then last valid runtime snapshot, then static map with last known positions, then informational location/character/scene view.
- Clear last-updated time and status labelling at every level.
- Automatic recovery to a higher level when conditions allow.
- Renderer failure must never retry an LLM call.

**Out of Scope:** Model outage degradation for the generation pipeline (ART-91, kept separate per PRD 2.0 §13).

**Dependencies:** FR-N007 runtime snapshot; FR-O001 live map.

**Schema Impact:** None.

**API Impact:** Exposes degradation level to the client.

**Security Impact:** None.

**Test Requirements:** Tests for each ladder level, automatic recovery, and an assertion that renderer failure produces no LLM retry.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Degradation ladder documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Degradation follows stream, then last valid snapshot, then static map with last known positions, then informational view
- [ ] #2 Degradation does not affect Episode, arc or historical content
- [ ] #3 Last updated time and current status are clearly labelled at every level
- [ ] #4 Renderer failure never triggers an LLM retry
- [ ] #5 The view automatically returns to a higher level once conditions recover
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
