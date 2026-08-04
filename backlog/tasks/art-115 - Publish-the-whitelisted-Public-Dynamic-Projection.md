---
id: ART-115
title: Publish the whitelisted Public Dynamic Projection
status: To Do
assignee: []
created_date: '2026-08-04 15:58'
updated_date: '2026-08-04 16:01'
labels:
  - prd-2.0
  - v2-d
  - epic-n
dependencies:
  - ART-114
priority: high
type: feature
ordinal: 115000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-N003 (PRD 2.0 §12 Epic N, §10.4)

**Problem / Context:** Public clients must never read full runtime state. PRD 2.0 requires a field-whitelisted projection carrying exactly what rendering and public narration need, expressed as `PublicCharacterMotion`.

**Goal:** A public, read-only, schema-validated projection that publishes motion and active-scene state and leaks nothing private.

**Scope:**
- Root payload: `worldId`, `runtimeVersion`, `snapshotSequence`, `updatedAt`, `worldStatus`, `characters[]`, `activeScenes[]`.
- Per-character `PublicCharacterMotion` exactly as specified in PRD 2.0 §10.4, including `motionType` of canon | ambient | idle | replay.
- Runtime schema validation on every field.
- Read path with no write side effect.
- Failure handling that retains the last valid published version.
- Extends the existing `convex/publicRead/liveState.ts` projection rather than replacing it.

**Out of Scope:** Snapshot lifecycle and staleness classification (FR-N007); replay payloads (FR-O013); incremental update strategy (ART-100 / FR-Q003).

**Dependencies:** FR-N010 Visual Runtime.

**Schema Impact:** New public projection payload (PRD 2.0 §14.4); reuses the existing public read-model infrastructure.

**API Impact:** New public read query; additive.

**Security Impact:** Primary private-data boundary — must exclude memories, secrets, prompts, full dialogue and admin data. Requires dedicated leakage tests.

**Test Requirements:** Field-whitelist contract tests, schema validation tests, a leakage test asserting no private field can appear, and a test asserting reads cause no mutation.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Public dynamic projection contract documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The projection publishes the PRD 2.0 section 10.4 PublicCharacterMotion shape
- [ ] #2 No private memory, secret, prompt, full dialogue or admin data is returned
- [ ] #3 No runtime field beyond what public rendering requires is returned
- [ ] #4 Every field is covered by runtime schema validation
- [ ] #5 Reading the projection causes no write side effect
- [ ] #6 A failed update retains the last valid published version
- [ ] #7 motionType lets the client distinguish canon, ambient, idle and replay motion
- [ ] #8 The projection is independently testable for authorization and data leakage
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
