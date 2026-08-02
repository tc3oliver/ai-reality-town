<!--
Thanks for contributing! Complete the sections below. Keep PRs focused (one purpose).
Do not include secrets, API keys, tokens, or deployment URLs.
-->

## Summary

<!-- What does this PR do, and why? -->

## Requirement / Issue

<!-- Link the issue or describe the motivating requirement. -->

## Architecture impact

- [ ] No architecture change.
- [ ] Architecture change — ADR / `docs/architecture/` updated.

### Schema change

- [ ] No schema change.
- [ ] Schema change — added via the spread pattern in `convex/schema.ts`; no upstream model duplicated.

### Canon invariant impact

- [ ] No impact on canon invariants.
- [ ] Impact — describe how append-only / reducer-determinism / idempotency / provider-proposes-only are preserved:

## Tests

<!-- What was tested, and how. New behavior needs tests. -->

## Validation commands run

```
npm run check:offline
# and, if UI/build touched:
npm run build
```

## Screenshots

<!-- Only for UI changes. -->

## Checklist

- [ ] `npm run check:offline` passes locally.
- [ ] Tests added/updated; no skipped or deleted failing tests.
- [ ] No lowered TypeScript strictness.
- [ ] No secrets, credentials, or deployment URLs committed.
- [ ] No `--no-verify`; no force push; nothing pushed to `upstream`.
- [ ] Docs / ADRs updated where relevant.
