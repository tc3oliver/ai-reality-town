---
id: ART-138
title: Run the Dynamic Viewing MVP public release gate
status: Blocked
assignee:
  - '@claude'
created_date: '2026-08-04 16:00'
updated_date: '2026-09-11 20:21'
labels:
  - prd-2.0
  - v2-k
  - release-gate
dependencies:
  - ART-141
priority: critical
type: feature
ordinal: 138000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-Q008 (PRD 2.0 §12 Epic Q) — realizes §22 (all thirty-one acceptance criteria)

**Problem / Context:** PRD 2.0 §26 forbids claiming MVP completion until every §22 criterion has objective evidence, and §22.28 explicitly forbids declaring product completion on the basis of backend completion alone. PRD 1.0 closure was declared that way, which is the failure this gate exists to prevent.

**Goal:** A single auditable gate producing evidence for all thirty-one PRD 2.0 §22 acceptance criteria, and updating the closure record.

**Scope:**
- Verify each of the thirty-one §22 criteria with cited evidence.
- Confirm ART-99 fixed with a fixed-seed regression test.
- Confirm ART-139 (schemaVersion/sceneId contract layer, Done) and ART-141 (proposedEvents structural compliance) both fixed, with the real provider producing accepted events and a permanent regression test in place.
- Confirm twelve character bindings and eight location bindings.
- Confirm zero successful public mutations and zero viewer-triggered LLM calls.
- Confirm the ART-136 performance benchmark was executed and passed before release.
- Confirm Visual Replay references only published content identifiers and versions, and invalidates on withhold or supersede.
- Confirm desktop and mobile E2E pass.
- Confirm asset licence and attribution completeness.
- Update the requirement matrix and produce a PRD 2.0 closure record.
- Confirm regression on affected PRD 1.0 P0 capability.
- Report every §18.1 metric that FR-Q007 has not yet made measurable as "not measured" rather than estimated.

**Fixture rule (ART-107 §8):** Any deterministic-fixture development or test must use IDs from the production Mistwood seed (`convex/canon/mistwoodSeed.ts`). `convex/canon/mistwoodFixture.ts` was rebuilt in place (not renamed) to use production seed IDs (Lin Yingxue, Wu Zhen), so it is now safe to import for structural testing, but production acceptance and any other V2 Dynamic Live work must still source data from `mistwoodSeed.ts` directly, not this foundation-test fixture.

**Out of Scope:** Any new feature work. This task only verifies and records.

**Dependencies:** ART-99, ART-141 (ART-139 already Done) and every PRD 2.0 P0 task.

**Schema Impact:** None.

**API Impact:** None.

**Security Impact:** Includes the public authorization audit sign-off.

**Test Requirements:** No new tests; aggregates and cites existing evidence.

**Validation Commands:**
- `npm run check`
- Full E2E, security and performance suites.

**Documentation Impact:** PRD 2.0 closure record; update `docs/prd-2.0-requirement-matrix.md`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All twenty-eight PRD 2.0 section 22 acceptance criteria have cited objective evidence
- [x] #2 ART-99 is fixed and covered by a fixed-seed regression test
- [x] #3 Twelve character bindings and eight location bindings are verified complete
- [x] #4 Successful public mutations are zero and viewer-triggered LLM calls are zero
- [x] #5 Desktop and mobile browser E2E pass
- [x] #6 Asset licence and attribution records are complete
- [x] #7 Affected PRD 1.0 P0 capability shows no regression
- [x] #8 Typecheck, lint, tests, build and CI all pass
- [x] #9 The requirement matrix and closure record are updated and no longer claim product completion from backend completion alone
- [ ] #10 The public acceptance environment has the Mistwood world seeded and its slot scheduler producing accepted events, so the twelve-character requirement is verified against real canon rather than fixtures only
- [ ] #11 The ART-136 performance benchmark is confirmed executed and passed before release, not deferred to post-launch
- [x] #12 Visual Replay is confirmed to reference only published content identifiers and versions and to invalidate on withhold or supersede
- [x] #13 Every section 18.1 metric not yet made measurable by FR-Q007 is reported as not measured rather than estimated
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Read `docs/prd-2.0-closure-record.md`. This note is a pointer, not a second record.

Re-audited **2026-09-12** against `main`. Everything below replaces the layered 2026-08-25 /
2026-09-06 notes that used to live here. Those were a running log — one of them described the
Convex deployment as disabled by free-plan limits, which was lifted the same day; another named
ART-100's read cost as the reason Mistwood could not go public, which ART-100 fixed. Keeping them
made the blocker list ambiguous, which is the opposite of what a release gate is for. They are in
git history if anyone wants them.

**The current record is `docs/prd-2.0-closure-record.md`**, held to this repository by
`npm run check:closure-record` (ART-138's own gate): the §2 summary must be re-derivable from its
rows, every cited path must exist, and every quoted test title must appear verbatim in a file that
row cites.

## Where the gate stands

| | |
| --- | --- |
| PRD 2.0 §22 | 30 PASS / 1 FAIL / 0 EXTERNAL_BLOCKED, of 31 |
| ART-138's own thirteen | 11 PASS / 0 FAIL / 2 EXTERNAL_BLOCKED |

**MVP closure: NOT COMPLETE**, and the reasons are exactly three — one product failure and two
environment blockers. None of them is repairable from this repository, and each has an owner
operation, an acceptance command and a pass threshold written out in §6 of the record.

1. **§22.30 / AC#11 — the mid-tier mobile frame rate.** 29.26 fps against a 30 fps threshold, on a
   host whose Chromium reports `ANGLE (… SwiftShader Device …)` even with the GPU blocklist
   ignored. Recorded as a FAIL, and separately as inconclusive for real hardware. Needs a device or
   a GPU-capable runner. **ART-173's load probe does not change this and is not offered against
   it** — its mobile figures come off the same rasteriser and are recorded
   `measured_but_inconclusive`; its desktop figures pass and speak only for desktop.
2. **AC#10 — the public acceptance environment.** Mistwood is `mode: development`. ART-172 built
   the audited `changeWorldMode` control, so the remaining step is the owner deploying current
   `main` and running one command — not a dashboard row patch, as an earlier note had it.
3. **AC#7 of ART-136 — the eight-hour soak.** Not external in the way the other two are: it needs
   no hardware this project lacks, only eight hours of wall clock. `BENCH_SOAK_MINUTES=480
   npm run bench`. ART-178 made the harness report the shortfall itself (`settlesCriterion`, a
   `⚠️` row and a `run_too_short` gap) instead of leaving a two-minute run reading as a pass.

## What this session actually changed about the gate

Nothing in the blocker list — and that is the finding. What changed is that several things
previously recorded as blocked or unreachable turned out to be repository work:

- **ART-173** closed ART-136 AC#6. Twenty and forty visible characters were recorded `unreachable`
  because Mistwood has twelve residents; that argument is true about the world and irrelevant to a
  renderer-capacity threshold. Now measured on both profiles, with the three exclusions the probe
  genuinely cannot cover recorded rather than dropped.
- **ART-172** narrowed AC#10 from「no audited way to change a world's mode」to「the owner runs one
  command after deploying」.
- **ART-178** converted AC#7 from a silent pass into a stated shortfall.
- **ART-180 / ART-181 / ART-179 / ART-177 / ART-176** closed defects found by a reachability and
  consistency audit of the whole repository, none of which altered the gate's verdicts.

## The single remaining open item this gate does not own

**ART-182** — the per-pair `relationship:<pairKey>` read model is published on every relationship
change and read by nothing. It is a cost-and-clarity question with a PRD judgement in it, not a
§22 criterion, and it is tracked separately rather than folded in here.
<!-- SECTION:NOTES:END -->
