# Arc Heat Score (FR-F006 / ART-32)

`convex/story/heat.ts` — pure, versioned, deterministic. Persisted by
`convex/story/heatFunctions.ts`, computed on the post-commit arc stage, read by the operator
console through `inspectArcHeat`.

## 1. What was here before

`heatScore` is **not** a new field. It has been on `StoryArcProjectionData` since ART-65, it is
validated to 0–100, and `portfolio.ts` has ordered the homepage by it ever since — so it has been
deciding what a viewer sees first for a long time. What it was not is a heat score. Both places
that produced it wrote the same line:

```ts
heatScore: Math.round(membership.importance * 100)
```

That is **one** of the six signals FR-F006 lists (最近事件重要性), read off the single event being
folded. Three consequences, worth naming rather than leaving to be rediscovered:

- **Nothing decayed.** 新鮮度 was not merely unweighted, it was *unrepresentable*: the value depended
  only on the latest event, so an arc that had not moved for ten world days kept whatever number
  its last event happened to carry.
- **A quiet climax lost to a loud aside.** 是否接近高潮 had no influence, so a `climax` arc advanced
  by a low-importance scene sorted below an `emerging` one advanced by a high-importance scene.
- **It satisfied neither AC#1 nor AC#3**, because a single multiplication has no derivation to
  trace and no composition to view.

## 2. The six signals

| Signal (FR-F006) | Component | Source | Weight |
| --- | --- | --- | ---: |
| 最近事件重要性 | `recent_importance` | the classifier's importance for the event being folded | 0.25 |
| 未解張力 | `unresolved_tension` | `unresolvedQuestions.length`, saturating at 3 | 0.15 |
| 核心人物關注度 | `core_attention` | share of the arc's **own** core cast in the event's participants | 0.15 |
| 觀眾互動 | `viewer_interaction` | `arcInteractionCounters`, saturating at 20 | 0.15 |
| 新鮮度 | `freshness` | world days since the arc's last progress, over a 7-day window | 0.15 |
| 是否接近高潮 | `climax_proximity` | lifecycle status → proximity, `climax` = 1, `resolved`/`archived` = 0 | 0.15 |

The weights are deliberately flat-ish rather than tuned. There is no traffic to tune against yet —
§16.1's figures need a live deployment — so a weighting presented as optimised would be a guess
wearing a number. The two departures from equal are the ones the requirement's own wording
justifies: 最近事件重要性 leads its list, and 是否接近高潮 is the only signal about the arc's
**position** rather than its recent activity, which is what stops a climax being buried by a quiet
slot.

`resolved` and `archived` score **0** proximity, not 1. 「是否接近高潮」 asks how much is still
coming; an arc whose climax has passed has none of it left, and one that scored highest at the
moment it ended would hold the homepage against arcs that are still moving.

## 3. Unmeasured is not zero

The composite renormalises by **measured weight** — the FR-M002 pattern from
`convex/quality/evaluator.ts`. A component the deployment cannot observe is left out of both the
numerator and the denominator rather than counted as zero.

That distinction matters more here than it looks. *"Every arc scores 0.6 because nobody is
watching"* and *"every arc scores 0.6 because we cannot see who is watching"* order arcs identically
and mean opposite things, and only one of them is something an operator should act on.

Two components can report `no_observations`, each with a stated reason:

- `viewer_interaction`, when the caller supplies no rollup. The long-run harness does exactly this:
  it drives no analytics ingest, so its arcs are scored on the other five signals rather than on
  five plus a fabricated zero.
- `core_attention`, when the arc declares no core characters — a share of an empty cast has no
  value, and scoring it 0 would rank that arc below one whose core cast simply was not in the scene.

## 4. Where 觀眾互動 comes from

`analyticsEvents` has no index by arc, and adding one would not have helped: the count wanted is
over the arc's whole life, so even an indexed read would grow without bound, and CLAUDE.md §9
forbids that on a per-event path.

So the ingest maintains a rollup. `arcInteractionCounters` is one mutable row per `(world, arc)`,
bumped inside `recordAnalyticsEvents`' dedupe loop — from *inside* the loop rather than a second
pass, so the counter and `analyticsEvents` can never disagree about how many interactions were
recorded: a duplicate `continue`s and reaches neither.

`ARC_INTERACTION_EVENTS` is the counted set: `story_arc_viewed`, `story_arc_followed`,
`live_arc_opened`. Every one carries `arcId` in `ANALYTICS_EVENT_PAYLOAD_KEYS`, which is what makes
the rollup possible without widening what analytics stores — `arcId` is a world identifier, already
public on every Episode page.

**`story_arc_followed` counts in both directions.** Interaction is attention, and un-following an
arc is attention paid to it; a rollup that counted only the positive direction would report an arc
people are actively abandoning as one nobody has an opinion about.

The row carries a count, an arc id and a world id — no viewer, no session, no day. The heat score
needs 「有多少互動」 and nothing else, and a rollup that could answer more would be a second, weaker
copy of the analytics privacy boundary.

## 5. Traceability and inspection

`storyArcHeatScores` holds one row per arc, upserted by the post-commit arc stage: the score, the
measured weight, every component with its own evidence and reason, and a digest over the canonical
breakdown.

**One row per arc, not one per computation.** Heat is recomputed on every accepted event that
touches the arc, so an append-only stream would grow with traffic while answering a question that
is only asked about *now* — 「這個 Arc 現在為什麼是這個分數」. The durable history of the score itself
is already append-only elsewhere: `heatScore` is a field of `storyArcProjectionEvents`, whose
revisions are never rewritten. So 「分數如何隨時間變化」 is answerable from the projection stream and
「分數由什麼組成」 from this table.

**The heat is computed even when no field changed.** 新鮮度 and 是否接近高潮 move with the world
rather than with the arc's own fields, so an arc whose fields are identical can still be a different
temperature. `nextArcProjectionFields` therefore returns the heat alongside `fields: null`, and the
caller records the new score without appending a revision that says nothing.

`inspectArcHeat` (operator-gated, `world.inspect`) returns the stored breakdown for every arc,
hottest first. It does **not** recompute: an inspection that re-derived the score could agree with
itself while disagreeing with what the pipeline stored, which is the failure it exists to detect.
`currentDefinition` is published rather than filtered, so an operator comparing two arcs can see
when one was last scored under an older definition.

Component evidence carries ids, counts and world days only — never a summary, a question or a
scene. The breakdown reaches an authorized surface, and the surest way for it not to leak
unpublished narrative is for it never to hold any. `heat.test.ts` asserts that every string in
every component's evidence matches an identifier shape.

## 6. AC#2 — the ordering is not the model's

`compareArcsByHeat` is exported so the ordering has one definition: heat descending, ties broken on
arc id. A comparator written out at each call site is how two surfaces come to disagree about which
arc is hottest, and an arc's position is the first thing a viewer reads. The tie-break is what makes
the order a property of the arcs rather than of whichever query returned them first.

## 7. Evidence

Six injections, each turning named tests red:

| Injection | Test |
| --- | --- |
| score an unmeasured signal as zero instead of renormalising | `renormalises, so an unobservable signal does not depress every arc equally` |
| let a resolved arc keep peak climax proximity | `peaks at the climax and drops to zero once the arc has resolved` |
| stop freshness decaying | `falls as the arc goes untouched, and reaches zero at the freshness window` |
| drop the ordering tie-break | `orders by heat and breaks every tie deterministically` |
| stop clamping a component value | 3 tests, including `keeps every score inside the range…` |
| stop counting un-follows as interaction | `counts each arc interaction once, and accumulates across events` |

A seventh injection — removing the clamp on the *composite* — turned nothing red, and the guard was
**removed rather than kept**: every component value is already clamped and the weights are positive,
so a weighted mean of them is in range by construction. A guard that cannot fire is the failure mode
CLAUDE.md §9 names, so the invariant is stated in a comment and the range is held by the test that
drives NaN, negative and out-of-range inputs through the whole function.
