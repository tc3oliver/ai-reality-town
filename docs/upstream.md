# Upstream Relationship: AI Town

AI Reality Town is derived from [`a16z-infra/ai-town`](https://github.com/a16z-infra/ai-town).
It was created by **cloning** the upstream repository (not via GitHub Fork) so that it
carries the full upstream history while diverging as an independent project.

## Upstream repository

- **Repository:** https://github.com/a16z-infra/ai-town
- **License:** MIT (`Copyright (c) 2023 a16z-infra`)
- **Remote name (local):** `upstream`

## Baseline

- **Baseline commit:** `7b242334bfbfef02f7718bded120d431e8f307df`
  (`Merge pull request #299 from hankchnag/fix/windows-install-unused-hnswlib`)
- **Baseline branch (upstream):** `main`
- **Baseline date:** 2026-08-02
- **Local tag:** `upstream-baseline-20260802`
  (annotated; message: "AI Town upstream baseline used to initialize AI Reality Town")

> The upstream default branch is `main`, which matches this project's default branch.
> No branch remapping is required.

## Original scripts (at baseline)

| Script | Command |
| --- | --- |
| `dev` | `npm-run-all --parallel dev:backend dev:frontend` |
| `build` | `tsc && vite build` |
| `lint` | `eslint .` |
| `predev` | `convex dev --run init --until-success` |
| `test` | `NODE_OPTIONS=--experimental-vm-modules jest --verbose` |

There is no dedicated `typecheck` script upstream; `tsc` is run as part of `build`.
This project adds an explicit `typecheck` script (`tsc --noEmit`).

## Major dependencies (at baseline)

Runtime: `convex`, `react`/`react-dom`, `pixi.js` + `@pixi/react`, `pixi-viewport`,
`@clerk/clerk-react`, `replicate`, `usehooks-ts`, `react-modal`, `react-toastify`.
Dev: `vite`, `typescript`, `jest` + `ts-jest`, `eslint` + `@typescript-eslint`,
`prettier`, `tailwindcss`, `npm-run-all`.

The upstream LLM layer (`convex/util/llm.ts`) is hand-rolled (no OpenAI/LangChain SDK)
and reads `OPENAI_API_KEY` / `LLM_API_URL` / `LLM_PROVIDER` etc. from the environment.
It is preserved unchanged.

## Remote structure

```
origin    https://github.com/tc3oliver/ai-reality-town.git   (this project)
upstream  https://github.com/a16z-infra/ai-town.git          (AI Town)
```

- `origin` always points at this project's public repository.
- `upstream` always points at AI Town.
- Never push to `upstream`. Never point `origin` at AI Town or `upstream` at this repo.

## How to fetch upstream

```bash
git fetch upstream
```

## How to compare upstream

```bash
# Commits on upstream/main that are not on our main:
git log --oneline main..upstream/main

# Full diff (three-dot) between our main and upstream/main:
git diff main...upstream/main
```

## How to merge selected upstream changes

Upstream changes are reviewed and merged selectively — never merged wholesale
without review:

```bash
git fetch upstream
git switch main
git pull --ff-only origin main

# Inspect:
git log --oneline main..upstream/main
git diff main...upstream/main

# Cherry-pick a specific upstream commit onto a feature branch:
git switch -c chore/upstream-<topic>
git cherry-pick <upstream-sha>

# Or merge a range, then resolve conflicts deliberately:
git merge upstream/main --no-ff
```

Because this project has diverged (independent package name, canon domain, branding,
documentation), wholesale merges will conflict. Always reconcile manually and re-run
the offline checks (`npm run check:offline`) before merging a PR.

## Known divergence from upstream

- Package name changed from `ai-town` to `ai-reality-town`; repository/description
  metadata repointed to this project.
- Branding (HTML title, README) rewritten to reflect AI Reality Town.
- New, project-owned modules added under `convex/canon/`, `convex/simulation/`,
  `convex/story/`, `convex/recaps/`, `convex/observability/`, `convex/shared/`,
  and read-model placeholders under `src/features/`.
- New Convex tables added via the existing schema aggregation pattern:
  `canonEvents`, `canonIdempotencyKeys`, `canonSnapshots`, `simulationRuns`.
- New scripts (`typecheck`, `test:foundation`, `check:offline`, `check`) and CI.
- The upstream LLM adapter (`convex/util/llm.ts`) and game engine are intentionally
  left intact; AI Town remains the visual and realtime runtime.

## Security concerns (at baseline)

- `npm audit` reports 23 vulnerabilities (transitive `ws` via `convex`, and `yaml`).
  These are dev-server / transport level. Recorded only; no `npm audit fix --force`.
  See `docs/baseline.md`.
- The upstream app exposes no production server-side authorization on the canon/world
  mutations beyond Convex's default. **Public production deployment requires a separate
  server-side authorization audit** before launch (out of scope for Phase 0).

## Asset attribution

- All original AI Town source, assets (`assets/`, `public/`, `src/editor/`), and the
  level editor remain under their upstream MIT license.
- Third-party assets retain their upstream provenance; see `ATTRIBUTION.md`.
