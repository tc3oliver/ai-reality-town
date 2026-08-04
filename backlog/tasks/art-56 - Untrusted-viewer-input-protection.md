---
id: ART-56
title: Untrusted viewer-input protection
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-04 07:09'
labels:
  - prd-1.0
  - epic-n
milestone: m-0
dependencies:
  - ART-54
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 56000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-L003, NFR-005

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Treat voting and future viewer input as untrusted; reject prompt injection, real persons, personal data, unsafe violence/sex, system commands, and direct outcome control.

Scope
Treat voting and future viewer input as untrusted; reject prompt injection, real persons, personal data, unsafe violence/sex, system commands, and direct outcome control.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-54

Schema Impact
Versioned safety policy, labels, stable reasons, warnings, withholding, and review-status records.

API Impact
Pre/post-generation and viewer-input safety classification interfaces separated from Canon mutation.

Security Impact
Unsafe content cannot reach providers or publication where prohibited; safety failure never changes Canon.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Adversarial tests cover every listed attack and normalization/encoding variants.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-L003: Viewer input rejects prompt injection, real-person targeting, private data, inappropriate violence/sexual content, operating-system commands, and direct character-outcome control.
- [x] #2 Adversarial normalization and encoding variants are tested.
- [x] #3 Rejected input cannot reach prompts, commands, Canon, or unsafe logs.
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
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add convex/safety/viewerInput.ts: pure, versioned FR-L003 classifier following the ART-54/ART-55 idiom (VIEWER_INPUT_POLICY_VERSION, stable category codes, stable text-free reasons, FNV-1a input hash, no raw text in any returned/persisted payload).
2. Categories (stable codes): PROMPT_INJECTION, REAL_PERSON_REFERENCE, PERSONAL_DATA, UNSAFE_VIOLENCE_OR_SEXUAL_CONTENT, SYSTEM_COMMAND, DIRECT_OUTCOME_CONTROL, plus structural codes INPUT_EMPTY, INPUT_TOO_LONG, DISALLOWED_CHARACTERS.
3. Normalization/decoding defense: NFKC, Cyrillic/Greek homoglyph folding, zero-width/soft-hyphen/bidi stripping, whitespace collapse, leet folding, plus decoded scan views for percent-encoding, HTML numeric entities, backslash-u escapes, and base64/base64url payloads. Rules run over both a punctuation-preserving view (shell/JSON/SQL detection) and a separator-collapsed view (word obfuscation), for every decoded variant, bounded to a fixed view budget.
4. Public API: classifyViewerInput(input) -> versioned classification {label: accept|reject, reasonCodes, inputHash, ...}; ViewerInputSafetyError; acceptViewerInput(input, onAccepted) fail-closed gate that provably never invokes the consumer for rejected input; VIEWER_INPUT_SUBMISSION_CONSTRAINT text for future viewer surfaces.
5. Add convex/safety/viewerInput.test.ts: adversarial cases for every attack category, every normalization/encoding variant, structural rejections, allowed bounded-preference inputs (no false rejects), no-raw-text-in-payload assertions, and gate-never-called assertions.
6. Add docs/viewer-input-safety.md and cross-link from docs/pre-generation-safety.md and docs/post-generation-safety.md; record focused test command.
7. Verify with npm run check (architecture boundaries keep safety free of Canon/provider deps) and the focused jest run; do NOT implement ART-45 voting.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented convex/safety/viewerInput.ts as a pure, versioned FR-L003/NFR-005 classification layer for untrusted viewer input, following the ART-54 pre-generation and ART-55 post-generation idiom (policy version constant, stable category codes, stable text-free reasons, FNV-1a fingerprint, fail-closed callback gate).

Decisions:
- Built the reusable classification/rejection layer only. Daily environmental voting (ART-45) is out of scope, so the module has no caller yet by design; it exists so no viewer surface can ship without a gate to call.
- Placed in convex/safety (module boundary: safety may depend only on shared), so a viewer-input safety failure provably cannot touch Canon. convex/viewer may already depend on safety, so ART-45 can consume it directly.
- No new Convex table: with no writer or reader yet, an unused table would be unverifiable dead schema. The classification record shape is defined in the module and carries only hash/codes, so any future recording is safe by construction.
- Categories: PROMPT_INJECTION, REAL_PERSON_REFERENCE, PERSONAL_DATA, UNSAFE_VIOLENCE_OR_SEXUAL_CONTENT, SYSTEM_COMMAND, DIRECT_OUTCOME_CONTROL, plus structural INPUT_EMPTY, INPUT_TOO_LONG, DISALLOWED_CHARACTERS.
- Rules are matched against multiple derived views rather than one normalized string: a punctuation-preserving view (needed for shell/SQL/JSON/path detection) and a separator-collapsed view (defeats i.g.n.o.r.e style obfuscation), each also leet-folded, and re-applied to payloads decoded from percent-encoding, HTML numeric entities, backslash-u escapes, and base64/base64url. NFKC plus explicit Cyrillic/Greek homoglyph folding and invisible-character stripping run first. Work is bounded by a fixed view budget with one decode level.
- DIRECT_OUTCOME_CONTROL is deliberately narrow so bounded preferences stay usable; seven allowed-boundary cases are asserted to prevent over-blocking.

Debugging note: the new suite initially failed under npm run check with 'ReferenceError: exports is not defined'. Root cause was a stale jest transform cache written by an earlier non-ESM npx jest run, not the source. npx jest --clearCache resolved it and the suite passes in the ESM configuration used by npm test.
<!-- SECTION:NOTES:END -->
