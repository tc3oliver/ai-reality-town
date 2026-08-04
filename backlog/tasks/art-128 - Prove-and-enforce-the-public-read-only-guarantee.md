---
id: ART-128
title: Prove and enforce the public read-only guarantee
status: To Do
assignee: []
created_date: '2026-08-04 15:59'
updated_date: '2026-08-04 16:02'
labels:
  - prd-2.0
  - v2-j
  - epic-o
dependencies:
  - ART-113
  - ART-115
priority: critical
type: feature
ordinal: 128000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O009 (PRD 2.0 §12 Epic O, §18.1, RISK2-002)

**Problem / Context:** The central promise of PRD 2.0 is that public viewing changes nothing and costs nothing. PRD 2.0 §18.1 sets viewer-triggered LLM calls and successful public mutations to exactly zero, and §22 makes this a release gate. UI-level hiding is explicitly insufficient.

**Goal:** Server-enforced and test-proven guarantee that no public viewing path can mutate the world or trigger generation.

**Scope:**
- Server-side authorization rejecting every character-control payload on public endpoints.
- Assert no human player creation, no heartbeat, no world start/resume from public paths.
- Assert public viewing adds no LLM trace.
- Security tests attempting forged characterId, worldId and runtimeSequence.
- Prove UI hiding is not the only protection.

**Out of Scope:** Retiring the engine (owned separately); observability counters (FR-Q001).

**Dependencies:** FR-N002 read-only shell; FR-N003 public dynamic projection.

**Schema Impact:** None.

**API Impact:** Public API explicitly refuses control payloads.

**Security Impact:** This is the primary security gate for PRD 2.0.

**Test Requirements:** A dedicated security suite covering unauthorized mutation attempts, private-data read attempts (dialogue, memory, secrets, prompts, traces), and identifier forgery — all asserted rejected server-side.

**Validation Commands:**
- `npm run check`
- Security suite must show zero successful mutations and zero added LLM traces.

**Documentation Impact:** Public read-only guarantee audit record.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /live executes only read queries even when unauthenticated
- [ ] #2 Public viewing never creates a human player
- [ ] #3 Public viewing never sends a heartbeat
- [ ] #4 Public viewing never starts or resumes a world
- [ ] #5 Public viewing adds no LLM trace
- [ ] #6 Security tests intercept and reject all unauthorized mutation attempts
- [ ] #7 Public APIs reject character control payloads server-side, not only by hiding UI
- [ ] #8 Forged characterId, worldId and runtimeSequence values are rejected
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
