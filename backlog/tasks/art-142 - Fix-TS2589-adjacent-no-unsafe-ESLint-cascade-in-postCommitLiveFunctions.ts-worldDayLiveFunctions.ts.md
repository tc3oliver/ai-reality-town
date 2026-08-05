---
id: ART-142
title: >-
  Fix TS2589-adjacent no-unsafe-* ESLint cascade in postCommitLiveFunctions.ts /
  worldDayLiveFunctions.ts
status: To Do
assignee: []
created_date: '2026-08-05 03:49'
labels:
  - infrastructure
  - typescript
  - ci
dependencies: []
priority: critical
ordinal: 142000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement ID: None (infrastructure defect, not a PRD requirement) -- discovered during ART-112 (retire the a16z engine), blocks its merge.

Problem / Context: This repository generates a very large Convex `internal`/`api` type (one entry per exported query/mutation/action across every module). TypeScript has a fixed, non-configurable type-instantiation depth/complexity limit; once the generated union crosses some threshold, specific `useQuery`/`ctx.runQuery`/`ctx.runMutation(api.X.Y, ...)` or `internal.X.Y` call sites can fail to resolve their type, either as a hard `tsc` error (`TS2589: Type instantiation is excessively deep and possibly infinite`) or, in ESLint`&apos;`s type-aware `@typescript-eslint` rules, as the expression silently resolving to `any`, which then cascades into `no-unsafe-assignment`/`no-unsafe-member-access`/`no-unsafe-return` errors at every downstream use of that value.

This is confirmed real and deterministic, not flaky: a fresh `git clone` + `npm ci` of `main` (no changes) typechecks and lints clean; the same fresh install of a branch that merely renames one zero-Convex-function file (no logic change) reproducibly fails `npm run lint` with 78 errors in three completely unrelated files. Confirmed independently causable by large-scale file deletion too (ART-112 deletes roughly 20 files worth of Convex functions). Two call sites hit the hard `tsc` error (`convex/music.ts`, `src/components/public/ArcDetailPage.tsx`) and were fixed in ART-112 with a narrowly-scoped `@ts-ignore` plus, for ArcDetailPage, sharing one function reference between two identical adjacent queries. Fixing those two did NOT relieve the pressure on the ESLint side (confirmed via a second, independent fresh-clone run) -- `convex/operations/postCommitLiveFunctions.ts` (~16 distinct `internal.*Functions`/`internal.*Operations` submodule references across roughly lines 180-435) and `convex/simulation/worldDayLiveFunctions.ts` (`directorFunctions`, `characterIntentFunctions`, `sceneGroupingFunctions`, `sceneSimulationFunctions`, `schedulerOperations` x3) still fail with 78 `no-unsafe-*` errors on a genuinely fresh install, even with ART-112`&apos;`s two typecheck fixes applied. `convex/operations/canonCorrectionFunctions.ts` has one additional occurrence (`internal.operations.postCommitLiveFunctions.runPostCommitPipeline`).

This is pre-existing latent fragility in the codebase`&apos;`s TypeScript/Convex-codegen interaction, not a defect introduced by ART-112`&apos;`s own logic -- but ART-112`&apos;`s file deletion (or any sufficiently large future change to the Convex module count) is what tips it over, and it will keep recurring for other unrelated future PRs unless addressed at the root.

Goal: `npm run lint` and `npm run typecheck` pass cleanly on a fresh `npm ci` install regardless of how many Convex modules exist or how files are renamed/added/removed, without narrow per-call-site suppression comments as the only mitigation.

Scope:
- Root-cause whether this is fixable by upgrading `typescript`/`@typescript-eslint` (currently pinned at `typescript@5.1.3`, `@typescript-eslint@^6.4.1` -- both from 2023; later versions have known improvements to large conditional/mapped type instantiation performance) -- try this first, it may be the cheapest real fix.
- If an upgrade does not resolve it, or is not viable, apply the same narrowly-scoped, well-commented `@ts-ignore` (placed as the literal line immediately before the exact failing expression -- a multi-line comment block above it does not suppress the error; verify empirically after each change, on a fresh clone, not just locally) to every remaining failing expression in `postCommitLiveFunctions.ts`, `worldDayLiveFunctions.ts`, and `canonCorrectionFunctions.ts`. Where the same `internal.X.Y` submodule reference is used multiple times in one function, extract it once to a local `const` (as ART-112 did for `ArcDetailPage.tsx`) rather than suppressing each use separately.
- Verify via a genuinely fresh `git clone` + `npm ci` (not a locally-warm `node_modules`, which was empirically shown in this session to give false-clean results) that `npm run check` passes end to end.
- Document the finding (root cause, the fresh-clone verification requirement, and the fix) in `docs/DEVELOPMENT.md` or an ADR, so future contributors understand why these specific lines carry `@ts-ignore` and do not "clean them up" without understanding why.

Out of Scope: Any change to ART-112`&apos;`s actual retirement logic (already correct and merged separately). Restructuring the Convex module layout to reduce the `internal`/`api` union size (a larger, separate architectural discussion if the TypeScript upgrade does not resolve this).

Dependencies: None. Blocks ART-112`&apos;`s merge.

Schema Impact: None.

API Impact: None.

Security Impact: None -- `@ts-ignore` suppressions are compile-time only; Convex validates all function arguments against the real function signature at the wire layer regardless of what TypeScript inferred at the call site.

Test Requirements: No new automated tests (this is a tooling/build-health fix); the fix IS the validation (npm run check passing on a fresh clone).

Validation Commands:
- Fresh clone verification (not a warm local checkout): `git clone` into a scratch directory, `npm ci`, `npm run check`.

Documentation Impact: Record the root cause and fix in docs/DEVELOPMENT.md or a new ADR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 npm run typecheck passes with zero errors on a genuinely fresh git clone + npm ci
- [ ] #2 npm run lint passes with zero errors on a genuinely fresh git clone + npm ci
- [ ] #3 The fix is verified via an actual fresh-clone reproduction, not a locally-warm node_modules, and that verification step is recorded in the task notes
- [ ] #4 A TypeScript/typescript-eslint version upgrade is evaluated first as the preferred root-cause fix before applying per-call-site suppressions
- [ ] #5 Every remaining per-call-site @ts-ignore (if the upgrade path does not fully resolve it) carries a comment explaining why, and is placed correctly (verified to actually suppress, not silently unused)
- [ ] #6 The root cause and fix are documented for future contributors
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
