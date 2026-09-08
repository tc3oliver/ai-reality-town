---
id: ART-47
title: Privacy-preserving product analytics instrumentation
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-02 15:33'
updated_date: '2026-09-08 00:18'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. AUDIT (done). ART-140 shipped the 17 live_* events, an ALLOWLIST sanitizer and emission points, with a no-op sink. §15's 16 product events, the transport, persistence and every metric do not exist. `analyticsSurface.test.ts` asserts src/analytics reaches no network; `readOnlyClientBoundary` forbids client write primitives outside two declared viewer roots; PRD 2.0 §22.16 sets successful mutations from public VIEWING to zero.

2. ONE sanitizer boundary. Move ART-140's ALLOWED_PAYLOAD_KEYS + sanitizeAnalyticsPayload into `convex/shared/analyticsContract.ts` and extend the event registry with §15's 16. `shared` depends on nothing and everything may depend on it, so the CLIENT emitter and the SERVER ingest run the SAME function — no second payload filter, and the server does not trust the client.

3. Telemetry is architecturally separate from world mutation. New `convex/analytics/` module, a new `telemetry` gate in publicFunctionSurface, and a new `analyticsWriteBoundary` with its own cap, roots and forbidden symbols. `viewerWriteBoundary.maxViewerMutations` stays 2 — analytics spends none of the world-mutation budget, and that is asserted. The ingest module may not name a Canon, simulation or reducer symbol.

4. Exactly-once logical measurement, two independent layers. (a) The unit of measurement is (sessionKey, eventName, subject) derived from the sanitized payload, so a rerender or a UI retry emits the same key and the pure queue drops it. (b) The envelope carries that key to the server, which resolves it on a unique index — a transport retry re-sends identical keys and inserts nothing new.

5. Identity. A third independent browser token under its own storage key, digested server-side via the existing `deviceDigest`, never stored raw — the design §15 already forced on the ballot and progress keys so the three surfaces cannot be joined on one column. Required because D1/D7 return is not computable without a stable anonymous key. Session key is per-session and never persisted.

6. Metrics. `convex/analytics/metrics.ts` (pure) computes §16.1's eight product metrics against their PRD targets plus the four dynamic-view derivations observability lists as unmeasured. Every rate is `{ numerator, denominator, rate: number | null, status: 'measured' | 'no_observations' }` — a zero denominator is never reported as 0%, and a D7 cohort that has not matured is excluded rather than counted as a non-return.

7. Emission. §15 events wired into the real public surfaces; ART-140's 17 live events routed through the same sink, unchanged.

8. Evidence. Privacy/adversarial suite, transport retry/idempotency suite, funnel/retention fixture suite, a browser Dynamic-View emission gate that captures the real envelopes, and >=10 fault injections each compiled and executed.
<!-- SECTION:PLAN:END -->
