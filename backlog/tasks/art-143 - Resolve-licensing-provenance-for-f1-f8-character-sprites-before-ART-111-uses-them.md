---
id: ART-143
title: >-
  Resolve licensing/provenance for f1-f8 character sprites before ART-111 uses
  them
status: To Do
assignee: []
created_date: '2026-08-05 06:50'
labels:
  - prd-2.0
  - v2-b
  - epic-n
dependencies: []
priority: high
ordinal: 143000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ART-108's asset-licence audit (assets/asset-licenses.json) found that public/assets/32x32folk.png and data/spritesheets/f1.ts through f8.ts have unresolved provenance and are marked 'quarantined' — no verifiable OpenGameArt/dafont/itch source could be matched to the actual texture, so they are excluded from the CI-enforced public-bundle allowlist (PUBLIC_BUNDLE_PATHS in scripts/assets/check-asset-licenses.mjs). ART-111 (Character Visual Binding) assumes these eight sprites are usable as-is for eight of the twelve Mistwood characters. That assumption is currently false: the asset-licence CI gate will reject any change that wires a quarantined asset into the public bundle. This task must resolve the provenance (find and verify a matching real source with an acceptable licence) or replace/re-source the sprites through an in-scope means, and then flip their status to approved in assets/asset-licenses.json with verified evidence, before ART-111's binding work can ship a public-facing character sprite.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 public/assets/32x32folk.png and data/spritesheets/f1.ts-f8.ts each have a verified source, author and licence recorded in assets/asset-licenses.json
- [ ] #2 Their status in assets/asset-licenses.json is 'approved' (or they are replaced by assets that are), with redistribution and modification permissions confirmed from primary evidence, not inferred from filename or prior attribution text
- [ ] #3 npm run check:asset-licenses passes with these sprites included in PUBLIC_BUNDLE_PATHS
- [ ] #4 No quarantined asset is added to the public bundle to unblock this task
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
