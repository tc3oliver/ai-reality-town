---
id: ART-138
title: Run the Dynamic Viewing MVP public release gate
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-04 16:00'
updated_date: '2026-09-09 18:34'
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
## Blocked (2026-08-25): H01 + H03

Every PRD 2.0 Dynamic Viewing feature task is now Done (ART-118..ART-137, ART-140, ART-123, ART-127, ART-129, ART-134, ART-136). This gate is the only remaining item, and it cannot be executed autonomously.

**AC#10** requires a PUBLIC ACCEPTANCE ENVIRONMENT with the Mistwood world seeded and its slot scheduler producing accepted events, so the twelve-character requirement is verified against real Canon rather than fixtures. That needs a deployed Convex deployment with provider credentials — H01 — and standing it up is a production deploy, which `CLAUDE.md` §5 forbids outright (H03).

**AC#11** requires the ART-136 benchmark to be confirmed executed AND PASSED before release. It has been executed and is committed at `docs/benchmarks/`, but the mid-tier mobile profile measures ~28 fps against NFR2-002's 30 fps threshold. That figure was taken on a host with no usable GPU (Chromium reports ANGLE/SwiftShader even with the blocklist ignored), so it is recorded as a FAIL and as inconclusive for real mobile hardware — it needs a device or a GPU host, which is the same class of blocker.

Everything else this gate aggregates already exists and is cited in `docs/prd-2.0-requirement-matrix.md`: the read-only guarantee suite (ART-128), the browser E2E on desktop and Pixel 5 (ART-137, ART-135), asset licence checks, the binding completeness assertions, and the replay publication-version contract (ART-121/ART-132).

## 2026-09-06 — Convex deployment is disabled: free-plan limits exceeded (H02)

The release gate stays Blocked, and this is now a second, independent reason. Verified today on three separate paths, all returning the identical server error `You have exceeded the free plan limits, so your deployments have been disabled`:

- `npx convex run --inline-query ...` against the dev deployment
- `npx convex run --prod --inline-query ...`
- a raw `POST https://colorless-deer-917.convex.cloud/api/query`

`npx convex function-spec` still succeeds, so the deployment metadata is intact and the code is still pushed — only function execution is refused. Nothing about this is repairable from the repository; it needs a paid Convex plan or a quota reset on the account.

What this blocks: every acceptance criterion on this gate that requires observing the running system — live world-day execution, real end-to-end latency, and any claim about production behaviour. Fixture and harness numbers must not be substituted for them.

What it does NOT block, and is being worked separately: ART-154, ART-155 and ART-156 (the three security findings that reopened ART-62) are pure code defects, reproducible and fixable offline.

Also recorded while checking: the deployment environment has `CLERK_JWT_ISSUER_DOMAIN` set and `SIMULATION_OPS_ALLOW_TOKEN_FALLBACK` unset — the configuration the ART-62 re-audit asked for. That closes the environment half of finding H-1 and leaves ART-154 as the remaining code half.

## 2026-09-06 (later) — Convex blocker LIFTED

The maintainer restored the Convex team. Re-verified: `POST /api/query` now returns an `ArgumentValidationError` (i.e. the function EXECUTED and rejected bad arguments) instead of the free-plan refusal, and `npx convex run --inline-query` returns data.

Live state at the moment of recovery, read with bounded queries only:

- one world, `mistwood`, `mode: development`, `status: running`, `nextWorldDay: 4`, `publishEnabled: true`
- 78 accepted canon events
- newest `postCommitRuns` rows: sequences 74, 73, 72, all `completed`

**Nothing is currently consuming I/O.** All four crons scope themselves to PUBLIC worlds — `tickAllPublicSchedules` binds `by_mode_and_status` on `("public","running")` (`simulation/schedulerOperations.ts:180-181`), and the runtime-snapshot and vote crons do the same. `mistwood` is `development`, so every one of them reads zero rows per tick.

**The standing hazard is unchanged and is ART-100, not a cron.** A post-commit run still reads O(total accepted events); AC#1 of ART-100 is explicitly unmet. Setting this world to `public` + `running` restarts a 60-second cron against a pipeline whose read cost grows with canon size, which is what exhausted the plan. Do not flip the mode until ART-100 AC#1 is met or the world is watched.

## 2026-09-09 — re-audited from scratch; the earlier notes were stale and are superseded

Everything below was re-derived from the tree and from the running deployment. The 2026-08-25 and 2026-09-06 notes on this task were NOT carried forward: three of the blockers they name are fixed, and one of them ("Convex deployments are disabled") is no longer true.

The result is `docs/prd-2.0-closure-record.md` — thirty-one §22 criteria plus this task's own thirteen, each with a named file and a named test, or a recorded measurement, or an owner operation with its acceptance command and pass threshold.

**§22: 30 PASS, 1 FAIL, 0 EXTERNAL_BLOCKED. This task's own ACs: 11 PASS, 2 EXTERNAL_BLOCKED. The MVP is NOT complete.**

## What changed since the old notes

- **ART-99 is fixed.** `convex/canon/snapshotManager.test.ts`'s `ART-99 seeded-world baseline replay and verification` covers it, and the live deployment now holds BOTH an `initial` snapshot and a `daily` snapshot at world day 4 for the seeded world — the exact pairing that used to raise `SNAPSHOT_CORRUPT`.
- **ART-141 is fixed.** Its own notes record the live chain (provider → parse → normalize → validate → commit, 2/2 accepted). ART-157 then fixed the prompt so a movement names a legal destination, and ART-159/ART-160 wired the real adapter into the scheduled path.
- **Convex function execution works.** Bounded queries return data today.
- **ART-100's reason for not going public is gone.** `postCommitLiveFunctions.readMeasurement.test.ts` proves it by name: `AC#1 — a post-commit run's canon reads do not grow with total accepted-event count`. That test still passes with ART-169's new stage in the pipeline.

## The live readings, taken with bounded read-only queries

83 accepted events over world days 0–4, naming **all twelve** seeded residents and **all eight** locations — so §22.4/#5 are corroborated against real Canon, not fixtures. 75 post-commit runs, all completed. 25 scheduled slots: 23 completed, 2 failed with `UNKNOWN_LOCATION_REFERENCE` at `validate_canon` on day 4. Twelve `character` read models current. Three publication records, **all `ready`, none released**. Zero withhold classifications, zero operator audit rows.

**Two readings changed my verdicts.** The deployment is behind `main`: `function-spec` lists 62 modules and is missing `operations/productAnalyticsFunctions` and `operations/worldQualityFunctions`, and two indexes the current tree declares do not exist there. And **74 of 74 scene simulation runs were authored by `fake-whole-scene-v1` (`provider: "fake"`)**, between 2026-08-04 and 2026-09-06. So the running system cannot corroborate the real-provider path; the repository evidence for §22.29 stands on its own and is cited that way.

## The one FAIL, and why it is not a code defect

§22.30. `docs/benchmarks/dynamic-view-latest.md` records mid-tier mobile at 28.4 fps (`stream`) and 28.38 fps (`delayed`) against NFR2-002's 30. The number is real and is reported as a failure rather than exempted — but the host reports an ANGLE/SwiftShader device with no usable GPU, so it software-rasterises a 1080×2340 backing store under 4× CPU throttling. It cannot settle the criterion either way for hardware graphics. Nothing in this repository can: there is no newer benchmark and no GPU-capable runner. Substituting the desktop figure, the `degraded` 60 fps or the `snapshot` 37.35 fps would be reporting a different measurement under the same name.

## A second finding the audit turned up

**No registered function can change an existing world's mode.** `configureSchedule` is the only writer of `worldSchedules.mode` and refuses when a schedule exists; the console's `pauseWorld`/`resumeWorld` move `status`, not `mode`. So AC#10's acceptance environment cannot be enabled by any command this repository offers — the owner has to patch the row through the dashboard, unaudited. Raised as **ART-172** rather than fixed here, because this task's own scope says "This task only verifies and records" and excludes new feature work.

## The record is enforced, not just written

`npm run check:closure-record` (new, in `npm run check`) holds the document to the tree: the §2 summary must be re-derivable from the rows, every cited path must exist, and **every quoted test title must appear verbatim in a file that row cites**. Run against the first draft it found nine citations that did not resolve — an abbreviated quote, three files named without their directory, and a CI job name mistaken for a test. All nine are fixed; 44 cited test names now resolve.

Three injections against the real artifacts, each turning `the closure record in the repository agrees with itself and with the tree` red: a verdict changed without its summary, a test name altered in the record, and — the one that matters — a cited test RENAMED IN THE SOURCE.
<!-- SECTION:NOTES:END -->
