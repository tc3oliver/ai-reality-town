---
id: ART-156
title: >-
  Pre-generation safety policy screens English phrases against a Traditional
  Chinese world
status: To Do
assignee: []
created_date: '2026-09-06 02:40'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 156000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ART-62 re-audit finding H-4 (Still Open, partial fix). ART-103 gave `assertPreGenerationSafe` real callers, so the gate is no longer dead code, but what it screens does not match what the system generates. `convex/safety/preGeneration.ts:61-83` is sixteen English phrase regexes (for example `/\bexplicit sexual content\b/u`) and `normalizeForSafety` lowercases with `toLocaleLowerCase("en-US")`, while `convex/llm/openAICompatible.ts:110` instructs the model to write in Traditional Chinese. Word-boundary `\b` does not fire between CJK characters, so the two paths that are nominally covered are covered in name only. Three further gaps found in the same pass: `embed()` has no gate at all and ships character memories and private knowledge straight to the provider; the gate sits in the adapter rather than in the port, so a second adapter inherits nothing; and `jsonSchema.description`, `tools[].function.description` and `body.user` reach the provider unscreened. The coverage test uses `readFileSync` plus `toContain`, which passes for code that is never executed. See docs/security-audit-art-62.md section 0.2 for the full egress inventory.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The policy screens the language the system actually generates, demonstrated by a test whose inputs are Traditional Chinese rather than English
- [ ] #2 Every provider egress path listed in the audit inventory — including embed() and the free-text fields on the request body — either passes through the gate or has a recorded, argued reason not to
- [ ] #3 The gate is enforced at the provider port rather than in one adapter, so a new adapter cannot silently bypass it
- [ ] #4 Coverage is proved by executing the gated paths, not by asserting on file text
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
