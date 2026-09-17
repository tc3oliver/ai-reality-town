# Deployment environments

Two Convex deployments back this project. They are not interchangeable, and the Convex CLI's
own words for them do not match what they are for — which is how an authorization checkpoint
came to be run against the wrong one and reported as a production result.

| Deployment | Role | Convex CLI slot |
| --- | --- | --- |
| `colorless-deer-917` | **Public Acceptance / Staging** | the `dev` slot |
| `glorious-grasshopper-417` | **Real Production** | the `prod` slot |

The mismatch is the whole point of this document. `colorless-deer-917` is the deployment the
Mistwood world actually runs on and the one every live reading in this repository has been taken
from — but Convex calls it `dev`, so a command that says "dev" is touching the acceptance
environment, and a command that says "prod" is touching real production.

## Which command touches which

| Command | Target | Notes |
| --- | --- | --- |
| `npx convex run …` | **selected dev deployment** — acceptance | The default. It does **not** touch production. |
| `npx convex env get …` / `set …` | selected dev deployment — acceptance | Add `--prod` to read or write real production. |
| `npx convex dev --once` | **acceptance** | How acceptance is brought up to current `main`. |
| `npx convex deploy` | **REAL PRODUCTION** | Never use it to update `colorless-deer-917`. It is the wrong tool for acceptance and the right tool for the thing acceptance exists to avoid. |

`npx convex env get <anything-nonexistent>` names the deployment it consulted in its error, which
is the cheapest way to confirm which one a shell is pointed at before running anything.

## Rules for qualification evidence

1. **Every piece of qualification evidence records the deployment name and its role.** A reading
   with no deployment named is not evidence; it is a number.
2. **Acceptance evidence is never labelled real-production evidence.** `colorless-deer-917` results
   are Public Acceptance results, whatever they show.
3. **A criterion that requires real production is not closed with acceptance evidence.** If a
   criterion's text names a production deployment, a production world, or a production launch, an
   acceptance PASS leaves it `BLOCKED` / `NOT RUN` — it does not move it.
4. **"Production qualification" and "public acceptance qualification" are different exercises.**
   Passing the second says nothing about the first.

## How this went wrong once

The ART-185 investigation recorded a stale `liveState` — version 19, published 2026-08-04, no
`dynamic` key — and called it a production reading. It was `colorless-deer-917`, the acceptance
environment. The diagnosis was right and the label was wrong, and the same wrong label was then
carried into an authorization checkpoint that queried acceptance and was reported as a production
result.

Real production, checked afterwards, had no functions deployed at all: every function path
returned a generic `Server Error`, including deliberately nonexistent ones, and an authenticated
call returned `401 NoAuthProvider` — `convex/auth.config.ts` bakes its provider list at push time,
so a deployment that has never been pushed to has no provider to match a token against.

## See also

- `docs/agent/OPERATOR-AUTH.md` — Clerk activation, per environment.
- `docs/prd-2.0-closure-record.md` §4 — the live readings, and which deployment they came from.
