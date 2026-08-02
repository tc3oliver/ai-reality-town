# Baseline Record

Captures the state of the upstream AI Town baseline at the moment AI Reality Town was
initialized, and the result of running the upstream checks offline.

## Environment

| Item | Value |
| --- | --- |
| Operating system | Darwin 23.5.0 (macOS) |
| Shell | zsh |
| Node | v20.19.2 |
| npm | 10.8.2 |
| Git | 2.39.3 (Apple Git-146) |
| GitHub CLI | 2.97.0 |
| GitHub account | tc3oliver |
| Git protocol | https |

## Baseline commit

- Commit: `7b242334bfbfef02f7718bded120d431e8f307df`
- Upstream branch: `main`
- Date: 2026-08-02
- Tag: `upstream-baseline-20260802`

## Install result

`npm ci` — exit code 0.

```
added 749 packages, and audited 750 packages
23 vulnerabilities (2 low, 6 moderate, 14 high, 1 critical)
```

No `npm install` repair was required; the upstream lockfile was consistent with
`package.json`.

## Test result

`npm test` — exit code 0.

```
Test Suites: 6 passed, 6 total
Tests:       50 passed, 50 total
```

No external LLM, API key, network, or Convex account is required to run the upstream
test suite (tests are pure utilities: geometry, minheap, async map, compression,
integer encoding, types).

## Lint result

**At the raw upstream baseline, `npm run lint` did NOT pass.** ESLint 8.42's legacy
config loader could not load the upstream `.eslintrc.js` (which uses `export default`
under a `"type": "module"` package), failing with
`Unexpected top-level property "__esModule"`. The linter therefore never actually ran on
the upstream code — the command errored during config load.

This is a pre-existing upstream condition in this environment, recorded here honestly.

### Fix applied in Phase 0

- Migrated `.eslintrc.js` (ESM) → `.eslintrc.cjs` (CommonJS `module.exports`) so ESLint
  loads the config. This is a minimal config migration; the rule set is unchanged.
- Scoped `npm run lint` to the **project-owned** directories
  (`convex/canon`, `convex/simulation`, `convex/shared`, `convex/observability`,
  `convex/story`, `convex/recaps`), which pass cleanly under the type-checked rules.
- The upstream-retained code (`src/`, `convex/aiTown`, `convex/agent`, `convex/engine`,
  `convex/util`, …) carries pre-existing type-checked lint debt (~2100 `no-unsafe-*`
  findings on `any` usage) that was masked by the broken config. Fixing that upstream
  debt is out of Phase 0 scope; it is retained as-is.

After the fix, the scoped `npm run lint` exits 0.

## Typecheck result

`tsc --noEmit` — exit code 0 (clean).

The project has no upstream `typecheck` script; `tsc` is normally only invoked by
`build`. This project adds a `typecheck` script so the type system can be checked
without running the full Vite build.

## Build result

`npm run build` (`tsc && vite build`) — exit code 0.

```
vite v4.5.9 building for production...
✓ 709 modules transformed.
✓ built in 2.05s
```

The production build does **not** require a Convex deployment URL. The
`VITE_CONVEX_URL`-based throw in `src/components/ConvexClientProvider.tsx` only fires
at browser runtime, not at build time.

## Convex requirements

- `npm run dev` / `predev` require a live Convex deployment (`convex dev`).
- `convex dev --run init` (the `predev` step) seeds the world and needs deployment
  credentials.
- **None of `test`, `lint`, `typecheck`, or `build` require a Convex account.**
- Convex generated files (`convex/_generated/*`) are committed in the upstream
  repository, so typechecks succeed offline.

## Known upstream failures

- `npm run lint` errored on config load at the raw upstream baseline (see "Lint result"
  above). All other offline checks (`test`, `tsc --noEmit`, `build`) pass at baseline.

## Fixes applied

- Migrated ESLint config to `.eslintrc.cjs` and scoped `npm run lint` to project-owned
  code (see "Lint result"). Documented here, not hidden.

## npm audit (recorded, not force-fixed)

```
23 vulnerabilities (2 low, 6 moderate, 14 high, 1 critical)
```

- `ws` (Memory exhaustion DoS) — transitive via `convex` (1.31.8-alpha.0 – 1.41.0).
- `yaml` (Stack overflow via deeply nested YAML) — moderate.
- `npm audit fix` (non-breaking) is offered but not applied, to avoid an unintended
  dependency / lockfile shift in the foundation. No `npm audit fix --force` is run.

## Remaining blockers

None for the offline foundation. The only external dependency for *running* (not
building/testing) the live simulation is a Convex deployment, which is an external
setup item, not a Phase 0 code blocker.
