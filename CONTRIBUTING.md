# Contributing

Thanks for your interest in AI Reality Town. This is a Phase 0 foundation project; the
scope of accepted contributions is intentionally narrow (see `docs/foundation-scope.md`).

## Development environment

- Node.js 20+ and npm.
- `npm ci` to install.
- Offline checks need **no** Convex deployment or API key:
  `npm run check:offline` (typecheck + lint + foundation tests).

See `docs/DEVELOPMENT.md` for the full command list and conventions.

## Branch naming

- `feat/<topic>`, `fix/<topic>`, `chore/<topic>`, `docs/<topic>`.
- Keep `main` green; branch from it.

## Commit rules

- One purpose per commit; conventional prefixes (`feat:`, `fix:`, `test:`, `docs:`,
  `chore:`, `ci:`).
- No `--no-verify`. No secrets. Lockfile changes in their own commit.

## Test requirements

- Follow upstream's colocated Jest convention (`*.test.ts`).
- New behavior needs tests; existing tests must keep passing.
- Never skip or delete a failing test to make CI green.

## Adding an event type

Extend the discriminated union — never model a core canon change as
`Record<string, unknown>`. See `docs/DEVELOPMENT.md` ("How to add a new event type").

## Canon invariants (do not break)

- Accepted events are append-only and immutable. Corrections are new events.
- The reducer is pure: no DB, env, clock, or unseeded randomness.
- Providers only propose; only the commit pipeline writes canon.

## Do not directly modify accepted canon history

If a committed event is wrong, add a correction/compensation event. Never edit or delete
an accepted `canonEvents` row to "fix" history.

## Definition of Done (per PR)

- `npm run check:offline` passes (and `npm run build` where UI/build is touched).
- Tests added/updated; no lowered TypeScript strictness; no secrets.
- PR template checklist completed.

## Do not commit secrets

Never commit API keys, tokens, deployment URLs, or credentials. See `SECURITY.md`.

## Behavior & safety

Participation is governed by `CODE_OF_CONDUCT.md`. Be respectful and constructive.
