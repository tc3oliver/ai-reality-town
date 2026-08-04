---
id: ART-138
title: Run the Dynamic Viewing MVP public release gate
status: To Do
assignee: []
created_date: '2026-08-04 16:00'
updated_date: '2026-08-04 16:13'
labels:
  - prd-2.0
  - v2-k
  - release-gate
dependencies:
  - ART-99
  - ART-137
  - ART-128
  - ART-136
  - ART-135
  - ART-132
  - ART-133
  - ART-108
priority: critical
type: feature
ordinal: 138000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** PRD 2.0 §22 (all twenty-eight acceptance criteria)

**Problem / Context:** PRD 2.0 §26 forbids claiming MVP completion until every §22 criterion has objective evidence, and §22.28 explicitly forbids declaring product completion on the basis of backend completion alone. PRD 1.0 closure was declared this way, which is the failure this gate exists to prevent.

**Goal:** A single auditable gate producing evidence for all twenty-eight PRD 2.0 §22 acceptance criteria, and updating the closure record.

**Scope:**
- Verify each of the twenty-eight §22 criteria with cited evidence.
- Confirm ART-99 is fixed with a fixed-seed regression test.
- Confirm twelve character bindings and eight location bindings.
- Confirm zero successful public mutations and zero viewer-triggered LLM calls.
- Confirm desktop and mobile E2E pass.
- Confirm asset licence and attribution completeness.
- Update the requirement matrix and produce a PRD 2.0 closure record.
- Confirm regression on affected PRD 1.0 P0 capability.

**Out of Scope:** Any new feature work. This task only verifies and records.

**Dependencies:** ART-99 and every PRD 2.0 P0 task.

**Schema Impact:** None.

**API Impact:** None.

**Security Impact:** Includes the public authorization audit sign-off.

**Test Requirements:** No new tests; aggregates and cites existing evidence.

**Validation Commands:**
- `npm run check`
- Full E2E, security and performance suites.

**Documentation Impact:** PRD 2.0 closure record; update `docs/prd-2.0-requirement-matrix.md`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All twenty-eight PRD 2.0 section 22 acceptance criteria have cited objective evidence
- [ ] #2 ART-99 is fixed and covered by a fixed-seed regression test
- [ ] #3 Twelve character bindings and eight location bindings are verified complete
- [ ] #4 Successful public mutations are zero and viewer-triggered LLM calls are zero
- [ ] #5 Desktop and mobile browser E2E pass
- [ ] #6 Asset licence and attribution records are complete
- [ ] #7 Affected PRD 1.0 P0 capability shows no regression
- [ ] #8 Typecheck, lint, tests, build and CI all pass
- [ ] #9 The requirement matrix and closure record are updated and no longer claim product completion from backend completion alone
- [ ] #10 The public acceptance environment has the Mistwood world seeded and its slot scheduler producing accepted events, so the twelve-character requirement is verified against real canon rather than fixtures only
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
