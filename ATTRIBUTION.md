# Attribution

AI Reality Town is based on **AI Town** by `a16z-infra` and its contributors.

> AI Reality Town is based on AI Town by a16z-infra and its contributors.
>
> Upstream: https://github.com/a16z-infra/ai-town
>
> AI Town is distributed under the MIT License.
>
> AI Reality Town preserves the upstream history and has diverged into an independent
> persistent social simulation and interactive reality-show platform.

## Upstream

- **Repository:** https://github.com/a16z-infra/ai-town
- **Baseline commit:** `7b242334bfbfef02f7718bded120d431e8f307df`
- **Baseline date:** 2026-08-02
- **Local tag:** `upstream-baseline-20260802`
- **License:** MIT (`Copyright (c) 2023 a16z-infra`)

## What comes from upstream

The AI Town game engine (`convex/engine`), game logic (`convex/aiTown`), the agent/LLM
layer (`convex/agent`), the PixiJS client (`src/`), the level editor (`src/editor/`), all
assets (`assets/`, `public/`, `data/`), the hand-rolled LLM adapter
(`convex/util/llm.ts`), and the original documentation are retained from upstream under
the MIT License. AI Town's authorship and copyright are preserved unchanged.

## What is new in this project

The independent Canon Event domain and simulation foundation, including (but not limited
to):

- `convex/canon/` — event model, validation, commit, reducer, replay, snapshots, fixture.
- `convex/simulation/` — provider interface, fake provider, workflow, run state.
- `convex/story/`, `convex/recaps/`, `convex/observability/`, `convex/shared/`.
- The `canonEvents`, `canonIdempotencyKeys`, `canonSnapshots`, and `simulationRuns`
  Convex tables.
- The foundation test suite, CI, and project documentation.

## Third-party assets

Third-party assets and dependencies retain their upstream provenance and licenses.
PixiJS, React, Convex, Vite, Jest, Tailwind, and others remain under their respective
licenses as declared in `package.json`.
