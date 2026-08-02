# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately**. Do **not** open a public GitHub
issue for security problems.

Use GitHub's **Private Vulnerability Reporting** on this repository:

1. Go to the repository's **Security** tab → **Report a vulnerability**.
2. Provide a description, reproduction steps, and impact.

This privately notifies the maintainers without exposing the report. If private
reporting is unavailable, contact a maintainer through a direct GitHub mention first and
we will provide a secure channel.

**Never paste secrets, API keys, tokens, or deployment URLs into a public issue, PR, or
commit.**

## Supported versions

Only the `main` branch is supported during Phase 0.

| Version | Supported |
| --- | --- |
| `main` (Phase 0) | ✅ |
| Older / tagged releases | ❌ (none published yet) |

## Current security posture

- A **public production security audit has not been completed**.
- **Server-side authorization is not implemented** beyond Convex defaults. Client access
  in the upstream app is anonymous today (auth scaffolding is commented out).
- **Do not deploy AI Reality Town as a public production service yet.** A server-side
  authorization audit and hardening pass is a prerequisite for any public launch, and is
  explicitly out of scope for Phase 0.

## What Phase 0 does provide

- A validated, idempotent commit boundary for canon events (providers propose; only the
  commit pipeline writes).
- Stable canon error codes (no branching on free-text error messages).
- CI that runs offline with no production secrets.

## Dependency security

`npm audit` is recorded in `docs/baseline.md`. Known advisories are tracked there; no
`npm audit fix --force` is run. Significant upgrades are handled deliberately, not
automatically.
