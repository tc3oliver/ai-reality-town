---
id: ART-148
title: >-
  LLM_MODEL=auto defeats the per-model token budget and drowns its own mismatch
  signal
status: To Do
assignee: []
created_date: '2026-08-29 05:40'
labels:
  - prd-1.0
  - epic-o
dependencies: []
priority: high
type: bug
ordinal: 148000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The deployment sets LLM_MODEL to the alias `auto` rather than a concrete model id. ART-59 keys its daily cap and its counters on the model id (`tokensByModel`, keyed via `addModelTokens`), and settlement books tokens under the *metered* model returned by the provider. With `auto`, the reservation is keyed on a string that is never a real model, so (a) the per-model daily cap never binds to any actual model and is effectively unenforced, and (b) the requested-vs-settled metering mismatch counter trips on every single call, so the counter that exists to detect real drift is saturated by design and its signal is unusable. This was surfaced while delivering ART-59 and is a live production-configuration hazard, not a theoretical one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The per-model daily cap binds to the concrete model actually used when the configured model is an alias
- [ ] #2 The requested-vs-settled metering mismatch counter does not increment for the expected alias-resolution case, and still increments for genuine drift
- [ ] #3 A test pins the alias case so a regression turns it red
- [ ] #4 The operator-facing budget surface shows the resolved concrete model, not the alias
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
