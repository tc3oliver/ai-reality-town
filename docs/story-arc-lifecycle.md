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
