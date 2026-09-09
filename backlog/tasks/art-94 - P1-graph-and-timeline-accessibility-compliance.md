---
id: ART-94
title: P1 graph and timeline accessibility compliance
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 16:25'
updated_date: '2026-09-09 14:30'
labels:
  - prd-1.0
  - epic-k
milestone: m-0
dependencies:
  - ART-44
  - ART-87
  - ART-93
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 94000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
NFR-009 for P1 relationship graph and timeline

Problem / Context
P1 graph and timeline accessibility must not block the P0 public-test gate when those P1 views are incomplete.

Goal
Verify keyboard, non-graph alternatives, contrast, reduced motion, and mobile interaction for relationship graph and world timeline.

Scope
Accessibility verification for ART-44 and ART-87 only.

Out of Scope
P0 public experiences owned by ART-93 and production deployment.

Dependencies
ART-44, ART-87, ART-93

Schema Impact
No product schema; owns accessibility test evidence for the P1 views.

API Impact
Consumes public read APIs only and adds no mutation endpoint.

Security Impact
Alternative views obey the same server-side visibility rules as graph/timeline views.

Validation Commands
npm run check; run automated accessibility checks and documented keyboard/manual review.

Test Requirements
Evidence covers graph and timeline controls, alternatives, filters, focus order, contrast, motion, and touch targets.

Documentation Impact
Update accessibility and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Relationship graph is keyboard operable and has an equivalent accessible list/table view.
- [x] #2 Timeline filters and Episode links are keyboard and screen-reader accessible.
- [x] #3 Both views meet contrast, reduced-motion, mobile touch-target, and focus requirements.
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
- [x] #13 Changes are committed and pushed
- [x] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read NFR-009 verbatim and inventory what the two P1 views already have.
2. Find why the timeline had no a11y coverage at all: it has no presentational export, so the jsdom suite structurally cannot render it.
3. Extract TimelineBody and fix the concrete defects that absence had hidden.
4. Put both P1 views through the same expectAccessible gate the P0 pages pass, plus the keyboard and touch-target lists they were missing from.
5. Add a browser suite for the three NFR-009 bullets jsdom cannot speak to: real Tab, real reduced-motion, measured touch targets.
6. Fault injections, npm run check, npm run e2e, docs/accessibility.md §7.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed after PR merged; npm run check and npm run e2e green on the merged branch.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The relationship graph was already built to ART-93's accessibility floor; what it lacked was anything HOLDING it there, since it was in neither the keyboard nor the touch-target list. The timeline had no coverage at all, and the reason was itself the first defect: no presentational export, so the jsdom suite (which renders through renderToStaticMarkup) structurally could not render it. Extracting TimelineBody exposed five real defects — no lang='zh-Hant' (a screen reader announced Traditional Chinese in the document's declared English), the back link inside <main>, English aria-labels on a Chinese page with no visible headings, identical link text on every row, and opacity instead of the measured contrast token. A new browser suite covers the three NFR-009 bullets jsdom cannot speak to (real Tab with a visible ring, real reduced-motion, measured 44px targets at 390px) and found a sixth the markup suite could not: an <option></option> for any event with no arc, which axe does not flag. The first fix for that was worse than the defect — it called .trim() on a payload field that arrives as undefined and blanked the whole page — and both cases are now pinned. Verified: 6 injections, one turning 6 named tests red at once; npm run check exit 0 (4201 passed, 244 suites); npm run e2e 114 passed (88 + 26 new); docs/accessibility.md §7; PR #258 merged.
<!-- SECTION:FINAL_SUMMARY:END -->
