# Story Arc lifecycle

ART-64 implements FR-F002 with seven explicit states:

```text
Emerging → Active → Escalating → Climax → Resolving → Resolved → Archived
     └────────→ Archived    └────→ Resolving
                 Active ─────────→ Resolving
```

The exact transition matrix lives in `convex/story/lifecycle.ts`. Transitions are
forward-only, require the caller's expected current status, and carry an accepted Canon
event ID/sequence, reason, and finite change time. The Convex mutation verifies that the
source event exists in the same world before writing.

Current lifecycle state is a Story projection, not Canon. Every state change also
appends a transition row, so projection updates do not erase history. Archived arcs
remain available through the internal history query. Active-context selection includes
only Active, Escalating, Climax, and Resolving; Emerging, Resolved, and Archived arcs are
excluded.

All lifecycle mutations and queries are internal. Reasons may depend on unpublished
facts and are not a public read model. Public Story Arc projection is handled by later
publication tasks.

## Verification

```bash
npm test -- --runInBand convex/story/lifecycle.test.ts
npm run check
```

## Who decides a transition (ART-163)

The domain does. A provider proposes classification and evidence — which arcs an event
belongs to, how important it is, what role it plays — and every transition is then derived
from the lifecycle table plus the arc's own state. There is no path by which a model names a
final status.

Two additions make that concrete on the live path:

- **Resolution statuses are gated by a decision.** `resolving`, `resolved` and `archived` are
  reachable only through a recorded `ArcResolutionDecision`; the terminal two require a
  non-empty outcome and at least one consequence. See `docs/arc-stagnation-resolution.md`.
- **Archived is reachable at all.** No accepted event classifies into a `resolved` arc, so the
  classification-driven path stops one step short of `Archived`. The stagnation ladder takes
  that step, 14 world days after resolution.

Both are exercised end to end by `convex/operations/arcClosureLoop.test.ts` and over 30 world
days by the ART-60 harness, which now asserts that at least one arc records a turning point,
at least one reaches resolution, every terminal resolution carries its evidence, and no arc
holds an active slot past the stagnation threshold.
