---
id: ART-66
title: Three-level episode recap formats
status: Done
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 15:43'
updated_date: '2026-08-03 16:24'
labels:
  - prd-1.0
  - epic-i
milestone: m-0
dependencies:
  - ART-33
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 66000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-G003

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Produce Quick, Standard, Deep, and runtime-validated Machine Summary formats with the PRD length and field requirements.

Scope
Produce Quick, Standard, Deep, and runtime-validated Machine Summary formats with the PRD length and field requirements.

Out of Scope
Adjacent PRD requirements, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-33

Schema Impact
Episode, recap, machine-summary, coverage, or derived-content records named by the task, each linked to accepted source events.

API Impact
Editorial generation/validation interfaces and publication-candidate outputs; no direct Canon mutation.

Security Impact
Spoilers and unsafe content are withheld through field visibility and publication gates.

Validation Commands
npm run check; run the focused test command added by this task and record its exact invocation in implementation notes.

Test Requirements
Automated tests cover every acceptance criterion and all stated negative or failure cases.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-G003: Quick Recap is 80–150 Chinese characters.
- [x] #2 FR-G003: Standard Recap is 400–800 Chinese characters.
- [x] #3 FR-G003: Deep Recap contains complete causal context and event list.
- [x] #4 FR-G003: Machine Summary is runtime-validated structured data containing What Changed, Why It Happened, Who Is Affected, New Questions, Resolved Questions, Required Prior Facts, and Story Arc Progress.
- [x] #5 All recap formats trace to accepted events and cannot change Canon.
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
ART-66 — Three-level episode recap formats (FR-G003). Pure recap-format layer over accepted events.

1. New pure module convex/recaps/recapFormats.ts:
   - RecapFormats { quickRecap, standardRecap, deepRecap, machineSummary, sourceEventIds }
   - MachineSummary { whatChanged, whyItHappened, whoIsAffected, newQuestions, resolvedQuestions, requiredPriorFacts, storyArcProgress } (the 7 FR-G003 fields)
   - countChineseCharacters(text) (CJK range)
   - buildMachineSummary(events, arcContext?) — deterministic derivation from Accepted Events (whatChanged<-stateChanges, whyItHappened<-causedByEventIds, whoIsAffected<-participantIds, requiredPriorFacts<-fact_created, arc fields<-context)
   - validateRecapFormats(formats, acceptedEvents) — AC#1 quick 80-150 CJK, AC#2 standard 400-800 CJK, AC#3 deep has causal+event list, AC#4 machineSummary 7 fields runtime-validated, AC#5 traceability (sourceEventIds resolve to accepted events; no canon mutation possible — pure module).
2. Tests recapFormats.test.ts: CJK count; quick/standard length bounds (pass+reject); deep causal+event list; machineSummary 7 fields; traceability rejects unaccepted source; build->validate round-trip on fixtures.
3. Gate npm run check green; PRD traceability FR-G003->doc-1.
4. Finalize task to Done IN this feature PR (task edit Done before push), so metadata lands with the code.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented three-level episode recap formats (FR-G003) as a pure recap-format layer over accepted events.

- convex/recaps/recapFormats.ts: RecapFormats (quick/standard/deep/machineSummary), MachineSummary with the 7 FR-G003 fields (whatChanged, whyItHappened, whoIsAffected, newQuestions, resolvedQuestions, requiredPriorFacts, storyArcProgress), countChineseCharacters, buildMachineSummary (deterministic derivation), buildDeepRecap (causal event list), validateRecapFormats (AC#1-5).
- recapFormats.test.ts: CJK count, quick/standard length bounds (pass+reject), deep structure, machineSummary 7 fields + missing/unknown/non-array rejection, traceability rejection of unaccepted source.

Verified: npm run check green (architecture, typecheck, lint, test 19/19 recapFormats + 441 total, build). Quick 80-150 中文字 and Standard 400-800 中文字 enforced; Machine Summary runtime-validated; sourceEventIds trace only to accepted events (no canon mutation). PRD FR-G003 -> doc-1.
<!-- SECTION:FINAL_SUMMARY:END -->
