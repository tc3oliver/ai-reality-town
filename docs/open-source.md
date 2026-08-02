# Open-source guide

AI Reality Town is an independent public repository derived from AI Town. This document
summarizes how the project is set up for open collaboration.

## Provenance

- **Derived from:** [`a16z-infra/ai-town`](https://github.com/a16z-infra/ai-town) (MIT).
- **Method:** cloned (not forked) so the full upstream history is preserved while this
  project diverges independently. See `docs/upstream.md`.
- **License:** MIT, unchanged from upstream. See `LICENSE` and `ATTRIBUTION.md`.

## Repository setup

- `origin` → this project's public repository.
- `upstream` → `a16z-infra/ai-town` (for tracking upstream changes; never push to it).
- Default branch: `main`.
- Visibility: public. Issues enabled; wiki disabled; no Pages/Discussions.

## Contribution path

1. Read `docs/DEVELOPMENT.md` for setup, commands, and conventions.
2. Open an issue or pick an existing one (Phase 0 deliberately keeps the backlog small).
3. Branch from `main` (see naming in DEVELOPMENT.md).
4. Run `npm run check:offline` locally before opening a PR.
5. Use the PR template; complete the checklist (scope, schema/canon impact, tests,
  validation commands).
6. CI runs the offline checks on every PR.

## What's welcome

- Bug fixes and tests around the canon/reducer/replay domain.
- Documentation improvements.
- New `StateChange` variants following the discriminated-union pattern (see DEVELOPMENT.md
  "How to add a new event type").

## What's out of scope for now

- Real LLM integration, story/recap engines, audience UI, voting, multi-world.

## Releasing

No GitHub Releases are created in Phase 0. Releases and versioning will be defined later.

## Security

Public production deployment is **not** supported yet — a server-side authorization audit
is required first. See `SECURITY.md`.
