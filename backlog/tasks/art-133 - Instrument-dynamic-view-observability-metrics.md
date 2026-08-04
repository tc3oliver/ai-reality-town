---
id: ART-133
title: Instrument dynamic view observability metrics
status: To Do
assignee: []
created_date: '2026-08-04 15:59'
updated_date: '2026-08-04 16:02'
labels:
  - prd-2.0
  - v2-i
  - epic-q
dependencies:
  - ART-115
  - ART-116
priority: high
type: feature
ordinal: 133000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-Q001 (PRD 2.0 §12 Epic Q)

**Problem / Context:** PRD 2.0 §18.1 sets hard zeros for viewer-triggered LLM calls, successful public mutations and unhandled drift. Without instrumentation these cannot be asserted operationally, only in tests.

**Goal:** Operational visibility over the dynamic layer, with the zero-tolerance counters explicitly tracked.

**Scope:** runtime projection update latency, snapshot age, active viewer count, renderer error rate, Canon/runtime location mismatch, missing character binding, missing location binding, public mutation attempts, viewer-triggered LLM call count, degradation mode usage, replay play and skip counts.

**Out of Scope:** Product analytics events (ART-47); operator controls (FR-Q002).

**Dependencies:** FR-N003 public dynamic projection; FR-N007 runtime snapshot.

**Schema Impact:** Metric records for the dynamic layer.

**API Impact:** Operator-facing read surface.

**Security Impact:** Metrics must record no private character data.

**Test Requirements:** Tests asserting the zero counters behave correctly, that mismatches are attributable to character, location and sequence, and that no private data is recorded.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Dynamic view observability reference.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All metrics listed in PRD 2.0 FR-Q001 are recorded
- [ ] #2 Viewer-triggered LLM call count is zero
- [ ] #3 Public mutation attempts are rejected and recorded
- [ ] #4 Mismatches can be attributed to a specific character, location and sequence
- [ ] #5 No private character data is recorded in metrics
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
