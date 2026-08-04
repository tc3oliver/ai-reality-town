---
id: ART-108
title: Audit and enforce visual asset licensing and attribution
status: To Do
assignee: []
created_date: '2026-08-04 15:57'
updated_date: '2026-08-04 16:00'
labels:
  - prd-2.0
  - v2-a
  - epic-n
dependencies:
  - ART-107
priority: high
type: feature
ordinal: 108000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-N008 (PRD 2.0 §12 Epic N)

**Problem / Context:** The public Dynamic Viewing MVP ships inherited third-party pixel-art tilesets, spritesheets, fonts and audio. PRD 2.0 §22 makes complete licence and attribution records a public-release acceptance criterion. No licence inventory or release-time check exists today.

**Goal:** Establish a verified licence record for every asset that reaches the public build, plus an automated check that prevents releasing without it.

**Scope:**
- Enumerate every image, audio, font and map asset reachable from the public bundle.
- Record the licence, source and required attribution text for each.
- Add product-visible or documented attribution where the licence requires it.
- Add a CI or release check asserting required licence files exist.
- Flag and quarantine any asset with no clear provenance.

**Out of Scope:** Introducing new external assets (PRD 2.0 §6 forbids it in v1); palette-variant art work (owned by FR-N004).

**Dependencies:** FR-N001 audit (asset inventory).

**Schema Impact:** None.

**API Impact:** None.

**Security Impact:** None directly; reduces legal/compliance risk on public release.

**Test Requirements:** An automated check (CI step or test) asserting the presence of required licence/attribution files, failing when absent.

**Validation Commands:**
- `npm run check`
- The new licence check command must fail when a required licence file is removed.

**Documentation Impact:** New or updated asset licence register; attribution surface in product or docs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every asset reachable from the public bundle has a recorded licence source
- [ ] #2 Required attribution is preserved in the product or documentation
- [ ] #3 No asset with unclear provenance remains in the public build
- [ ] #4 An automated CI or release check verifies required licence files exist and fails when one is missing
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
