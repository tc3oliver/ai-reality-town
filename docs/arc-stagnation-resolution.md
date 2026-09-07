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

## What the running pipeline does with all of this (ART-163)

Everything above was true and reachable only by hand. ART-163 audited the Story Arc engine
against a running world and found four capabilities that were implemented, unit-tested,
registered as Convex functions and called by **nothing**: `recordArcResolutionDecision`,
`applyArcResolutionConsequences`, any action on a stagnation prompt, and
`validateMajorArcMemberships`.

The consequence was not cosmetic. The live post-commit arc stage walked an arc
`emerging → … → resolving → resolved` one step per world day through
`transitionArcLifecycle`, which asks only whether a transition is legal. So the rule two
paragraphs above — *a terminal decision requires an outcome and at least one consequence* —
was enforced nowhere on the path the world actually takes. Arcs closed carrying nothing,
no summary was refreshed, and a stalled arc held its major slot for the life of the world.

### Resolution is a decision, not a transition

The stage now reaches `resolving`, `resolved` or `archived` only through a recorded
`ArcResolutionDecision`. The order is the guarantee:

1. **decide** — `createArcResolutionDecision` throws before the lifecycle is touched, so a
   terminal status is unreachable without an outcome;
2. **transition** — the lifecycle boundary, unchanged;
3. **apply consequences** — only for a terminal decision.

Transitioning first would leave an arc `resolved` behind a decision that failed, which is a
corrupt state rather than a refused one.

Outcome and consequences are **derived**, never authored: the outcome is the resolution
event's own public summary (falling back to the arc title and world day so it can never be
empty), and the consequences are one per core character plus one for the world. A provider
proposes what happened in a scene; it does not write the world's verdict on the story it was
telling.

### The stagnation ladder

Keyed only on world-day gaps, so it is deterministic and replayable:

| Gap | Arc | Action |
| --- | --- | --- |
| 14 days without progress | major, active family | `downgrade` — the major slot is freed, the arc survives at minor tier |
| 28 days without progress | any active family | `enter_resolving`, then `resolve` on the next run |
| 14 days after resolution | `resolved` | `archive` |

The ladder runs on **every** commit, including one that classifies into no arc at all. A
stalled arc is by definition one no event is classifying into, so remediating it only inside
the classification branch would mean the arcs most in need of it were never reached.

Archiving is on the ladder for a structural reason: `candidateArcs` only considers emerging
and active-family arcs, so no accepted event ever classifies into a `resolved` one and the
classification-driven path can never take the last step. Without this an arc would sit at
`resolved` forever and "archived arcs stay queryable" would describe a state nothing entered.

Nothing is ever deleted. A downgraded arc keeps its whole history; a wound-down arc closes
with an outcome that says plainly it was closed for want of progress.

### Downgrade is applied, not just recorded

`recordArcResolutionDecision` now patches the portfolio entry's tier to the decision's
`resultingTier`. `syncArcPortfolioEntry` deliberately leaves tier alone — tier is the
admission decision — so without this the arc would keep a major slot it had formally lost:
FR-F003 count control reads the entry, not the decision.

Focused verification:

```bash
npm test -- --runTestsByPath convex/story/resolution.test.ts
npm test -- --runTestsByPath convex/operations/arcClosureLoop.test.ts
ART60_LONG_RUN=1 npm run test:longrun
```
