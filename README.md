# AI Reality Town

> A persistent AI social simulation and interactive reality-show world built on AI Town.

**Current status: Phase 0 — Foundation.**

AI Reality Town is an **independent** project derived from
[`a16z-infra/ai-town`](https://github.com/a16z-infra/ai-town) (MIT). It is **not** the
official AI Town project, and it is **not** a GitHub fork — the full upstream history is
preserved while this project diverges.

This repository currently ships the **Canon Event foundation**: an append-only,
validated, deterministic event store with a fake simulation provider. It does **not** yet
run a real simulation, has **no real LLM**, and is **not** ready for public production
deployment.

---

## Project vision

A persistent world (codename: **Mistwood**) whose canonical history is an authoritative,
auditable, replayable log of events — objective facts, public information, character
cognition, and rumor kept deliberately separate. AI Town remains the visual and realtime
runtime; the independent Canon domain is the long-term source of truth.

## What currently works (Phase 0)

- **Append-only Canon Event store** with structural + canon validation and stable error
  codes.
- **Idempotent commit** — a repeated proposal never creates a second event.
- **Deterministic reducer** — pure; same events always produce the same projection, with
  no database, clock, or randomness.
- **Replay & snapshots** — replay the log, or resume from a snapshot, identically.
- **Deterministic Fake Simulation Provider** — proposes events with no network/LLM/key.
- **Foundation workflow** — runs a fake proposal through commit, with retry-safe
  idempotency.
- **Mistwood fixture** — a fixed, repeatable world for tests.
- **Offline tests (102 passing), CI, and documentation.**

## What does not work yet

- No real LLM provider.
- No full character autonomy, story-arc engine, episode/recap generation.
- No audience onboarding, voting, or public operations backend.
- No server-side authorization; **no public production deployment**.
- 200 residents, economy, items, voice, video, multi-world, user-created worlds.

## Architecture summary

```
Provider (propose only) → ProposedEvent → Structural + Canon validation
  → Idempotent commit → canonEvents (append-only)
  → Deterministic reducer → WorldProjection (read model)
```

- **Simulation** proposes events; **never** writes canon.
- **Canon** is append-only; corrections are new events, never in-place edits.
- **Reducer** is pure and deterministic.
- **AI Town** stays the visual/realtime runtime.

See `docs/architecture/` and `docs/architecture/adr/` (ADR-0001…0003).

## Repository structure

```
convex/
  canon/         event model, validation, commit, reducer, replay, snapshots, fixture
  simulation/    provider interface, fake provider, workflow, run state
  story/         story projection boundary (declared, not implemented)
  recaps/        recap projection boundary (declared, not implemented)
  observability/ trace-id plumbing
  shared/        constants, errors, ids
  aiTown/        upstream AI Town game logic (retained)
  engine/        upstream AI Town engine (retained)
  agent/         upstream AI Town agent/LLM layer (retained)
src/             upstream PixiJS client (retained) + features/ placeholders
docs/            architecture, baseline, upstream, scope, development
```

## Prerequisites

- Node.js 20+ and npm.
- Git and the GitHub CLI (`gh`) for repo/PR operations.
- A Convex deployment **only** to run the live simulation; offline checks need none.

## Local setup

```bash
git clone https://github.com/tc3oliver/ai-reality-town.git
cd ai-reality-town
npm ci
```

## Available commands

| Command | What it does |
| --- | --- |
| `npm run check:offline` | typecheck + lint + foundation tests + build (no Convex/key/network) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test:foundation` | Canon + simulation domain tests |
| `npm test` | Full Jest suite |
| `npm run build` | `tsc && vite build` (offline-safe) |
| `npm run check` | typecheck + lint + full tests + build |
| `npm run dev` | Convex backend + Vite frontend (needs a Convex deployment) |

## Testing

```bash
npm test                 # full suite
npm run test:foundation  # canon + simulation only
```

Tests follow upstream AI Town's colocated Jest convention. No second framework.

## Convex setup status

A Convex deployment is **not required** for any offline check. It is only needed to run
`npm run dev` (the live simulation). The Convex generated files are committed, so
typechecks succeed offline.

## GitHub repository

- Source: https://github.com/tc3oliver/ai-reality-town
- Upstream: https://github.com/a16z-infra/ai-town (tracked via the `upstream` remote)

## Upstream attribution

This project is based on AI Town by `a16z-infra` and its contributors, distributed under
the MIT License. AI Reality Town preserves the upstream history and MIT attribution, and
has diverged into an independent platform. See `ATTRIBUTION.md` and `docs/upstream.md`.

## License

MIT — unchanged from upstream. See `LICENSE`.

## Security status

**Not ready for public production deployment.** A server-side authorization audit is
required first. Report vulnerabilities privately — see `SECURITY.md`.

## Contributing

Phase 0 keeps the accepted scope narrow. See `CONTRIBUTING.md` and
`docs/DEVELOPMENT.md`.
