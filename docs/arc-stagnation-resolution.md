# Arc stagnation and resolution

ART-31 implements PRD FR-F005 as an internal story-operations boundary.

- Active-family arcs produce an idempotent operator prompt after 14 world days without
  progress. The prompt retains the last-progress Accepted Event ID and offers the
  supported remediation paths.
- Resolution decisions are append-only records with Accepted Event provenance. They
  describe outcome suggestion, merge, tier downgrade, entering resolution, resolution,
  archive, or background compression. Existing lifecycle rules remain the only legal
  way to change status, so a major arc cannot disappear from active context silently.
- A terminal decision requires an outcome and at least one consequence. Each consequence
  points to the same Accepted Event and identifies affected characters and whether the
  world summary is affected. ART-82 consumes this contract to refresh summaries; ART-31
  does not generate or publish those summaries.
- Prompt and resolution APIs are internal Convex functions. Public readers cannot invoke
  remediation or receive unpublished story data.

Focused verification:

```bash
npm test -- --runTestsByPath convex/story/resolution.test.ts
```
