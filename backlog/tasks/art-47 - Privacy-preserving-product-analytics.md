---
id: ART-47
title: Privacy-preserving product analytics instrumentation
status: To Do
assignee: []
created_date: '2026-08-02 15:33'
updated_date: '2026-08-02 16:59'
labels:
  - prd-1.0
  - epic-l
milestone: m-0
dependencies:
  - ART-40
  - ART-41
  - ART-42
  - ART-43
  - ART-44
  - ART-45
  - ART-36
  - ART-39
  - ART-68
  - ART-69
  - ART-86
  - ART-87
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Section 15; Section 16.1 measurement

Problem / Context
This task is a single reviewable PR within PRD 1.0 and owns only the capability stated below.

Goal
Define, emit, validate, and query the specified product analytics events and calculate PRD funnel/retention metrics without sensitive payloads.

Scope
Define, emit, validate, and query the specified product analytics events and calculate PRD funnel/retention metrics without sensitive payloads.

Out of Scope
Guaranteeing real-user conversion targets, Post-MVP follow-event emission before follow UI exists, and production deployment.

Dependencies
ART-40, ART-41, ART-42, ART-43, ART-44, ART-45, ART-36, ART-39, ART-68, ART-69, ART-86, ART-87

Schema Impact
Viewer Intervention, vote, consequence, analytics, or authenticated progress schemas explicitly named by the task.

API Impact
Untrusted viewer command/ingestion interfaces and privacy-safe read/aggregate queries.

Security Impact
Rate limits, authorization, injection defenses, data minimization, and no direct character control are mandatory.

Validation Commands
npm run check; run the focused validation introduced by this task and record the exact command and result.

Test Requirements
Tests cover every MVP event emission, future-event schema compatibility, payload rejection, deduplication, and correct metric calculation from fixtures.

Documentation Impact
Update the relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Instrumentation can calculate first-session Episode open rate against the 40% product target.
- [ ] #2 Instrumentation can calculate first-session duration over three minutes against the 30% target.
- [ ] #3 Instrumentation can calculate next-day and seven-day return rates against 15% and 8% targets.
- [ ] #4 Instrumentation can calculate vote participation, follow, primer expansion, and recommended-entry click rates against PRD targets.
- [ ] #5 Task completion requires correct measurement from fixtures, not achievement of real-user behavior targets.
- [ ] #6 Section 15: Typed, privacy-safe schemas and verified emission/query coverage exist for home_viewed, current_situation_expanded, recommended_episode_opened, episode_viewed, episode_completed, character_viewed, character_followed, story_arc_viewed, story_arc_followed, relationship_graph_opened, timeline_filtered, vote_viewed, vote_submitted, return_recap_viewed, live_scene_opened, and share_action.
- [ ] #7 Each implemented MVP/P1 interaction emits its analytics event exactly once under retry; deferred follow events have contract tests here and end-to-end emission evidence in ART-71.
- [ ] #8 Section 16.1: Metric calculations explicitly compare vote participation to 10%, character-or-Arc follow to 8%, three-minute-primer expansion to 20%, and recommended-entry Episode clicks to 20%.
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
