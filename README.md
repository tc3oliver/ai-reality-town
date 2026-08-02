# AI Reality Town

> A persistent AI social simulation and interactive reality-show world, built on AI Town.

AI Reality Town is an **independent** project derived from
[`a16z-infra/ai-town`](https://github.com/a16z-infra/ai-town) (MIT). It is **not** the
official AI Town project, and it is **not** a GitHub fork — the full upstream history is
preserved while this project grows in its own direction.

**AI Reality Town is under active development and is not yet ready for production deployment.**

---

## Vision

A living town of AI characters you can watch unfold over time — friendships forming, rumors
spreading, secrets surfacing, alliances shifting. Underneath the visuals, every meaningful
thing that happens is captured as an authoritative, replayable history, so the world has a
consistent past the audience can trust and revisit.

## What you'll be able to see

- A persistent town where AI residents move around, meet, talk, and remember.
- Relationships and reputations that evolve from what actually happens.
- Public facts, private knowledge, and hearsay kept deliberately separate.
- A world whose state can always be reconstructed from its history.

## Core concepts

- **Canonical events.** What happens in the world is recorded as an append-only, validated
  log of events. This log is the authoritative history of the world.
- **Propose, never write.** Any AI or director only *proposes* events; a validation pipeline
  decides what enters the canon. AI output can never directly mutate world truth.
- **Deterministic replay.** World state is derived by pure reducers, so the same events
  always reproduce the same world — no hidden state, no clock or randomness in the math.
- **AI Town as the visual runtime.** [AI Town](https://github.com/a16z-infra/ai-town)
  powers the map, movement, and realtime visuals. The canonical domain is the long-term
  source of truth that sits alongside it.

## Architecture

```
Proposer (AI / director / system)
   │  proposes only
   ▼
Proposed Event  ──►  Structural + canonical validation
                          │
                          ▼
               Append-only event log  ──►  Deterministic reducer  ──►  World projection
                                                                          (read models)
                                          ▲
                            AI Town = visual & realtime runtime
```

The canonical event log is the source of truth; the visible world and any narrative
projections are derived from it.

## Repository layout

```
convex/
  canon/         canonical event model, validation, commit, reducer, replay
  simulation/    simulation provider interface and workflow
  story/         story projection boundary
  recaps/        recap projection boundary
  aiTown/        upstream AI Town game logic (retained)
  engine/        upstream AI Town engine (retained)
src/             upstream PixiJS client (retained)
docs/            architecture and development docs
```

## Prerequisites

- Node.js 20+ and npm.
- Git. The GitHub CLI (`gh`) is handy for repository operations.
- A [Convex](https://convex.dev) deployment is required **only** to run the live
  simulation; building and testing need none.

## Local setup

```bash
git clone https://github.com/tc3oliver/ai-reality-town.git
cd ai-reality-town
npm ci
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the simulation and frontend (needs a Convex deployment). |
| `npm run build` | Type-check and build the frontend. |
| `npm test` | Run the test suite. |
| `npm run typecheck` | Type-check the project. |
| `npm run lint` | Lint the project-owned modules. |

## Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for setup,
branching, commit, and testing expectations, and [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)
for conventions. Keep changes focused, tested, and free of secrets.

## Upstream attribution

This project is based on **AI Town** by `a16z-infra` and its contributors, distributed under
the MIT License. AI Reality Town preserves the upstream history and MIT attribution, and has
diverged into an independent platform. See [`ATTRIBUTION.md`](./ATTRIBUTION.md).

- **Not** the official AI Town project.
- **Not** a GitHub fork — derived by clone, with full upstream history retained.

## License

MIT — unchanged from upstream. See [`LICENSE`](./LICENSE).

## Security

A public production security audit has **not** been completed, and server-side authorization
is not yet in place. Please do not deploy AI Reality Town as a public production service.
Report vulnerabilities privately — see [`SECURITY.md`](./SECURITY.md).
