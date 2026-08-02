# Story Arc projection contract

ART-65 implements FR-F003 as a versioned, event-replayable Story read model. Every arc
stores title, premise, current question, lifecycle status, core characters, inciting
event, latest turning point, essential facts, unresolved and resolved questions,
recommended entry event, heat score, and last progress world time.

Turning point and recommended entry are explicitly nullable until established; the
fields are never omitted. Heat is runtime bounded to 0–100. IDs and question arrays are
non-empty, deduplicated, and a question cannot simultaneously be resolved and
unresolved. Character and event references are checked against the world.

Initialization and updates append full, versioned Story projection events linked to an
Accepted Canon event. The pure reducer requires contiguous revisions beginning with
`initialized`, deterministically replays the latest fields, derives last progress time
from the source event, and composes status from the ART-64 lifecycle projection.
Optimistic expected revision prevents concurrent lost updates.

Projection operations and replay queries are internal. Essential facts can contain
unpublished context and are not a public read model; later publication tasks must
explicitly select safe fields.

## Verification

```bash
npm test -- --runInBand convex/story/projection.test.ts
npm run check
```
