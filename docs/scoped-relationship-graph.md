# Scoped relationship graph (FR-I007, NFR-002)

ART-44. The public relationship graph, published per world day as the read model
`relationshipGraph:<worldId>:<worldDay>` and rendered at `#graph/<worldId>` (default day) or
`#graph/<worldId>/<worldDay>` (date-switched).

FR-I007: 預設只顯示:當前 Arc 核心人物 / 一階關係 / 最近七日有變化的關係。支援:日期切換 / 關係類型篩選 /
人物摘要 / 關係變化原因。不得預設渲染全部角色與全部關係。
NFR-002, graph clause: 關係圖預設節點不超過 30。

## 1. Why the graph is built on the server

Not a preference. Relationship projections are published one `modelRef` per pair
(`relationship:<pairKey>`), and **no published model enumerates the pairs**. A client can ask for
a relationship it already knows the name of; it cannot discover which relationships exist. There
is no client-side construction of this graph to prefer or reject.

It is also the only place the two hard bounds can be guarantees rather than hopes. A thirty-node
cap applied in a component is a cap on what that component draws. Applied before publication, a
viewer with a devtools console sees the same thirty nodes, because thirty nodes is what was
published. The same is true of the private-relationship exclusion.

## 2. What it reads, and the privacy trap it avoids

`convex/publicRead/relationshipGraphProjectionFunctions.ts` reads Canon, plus the two
index-scoped story reads `rebuildLiveProjection` already makes on the same commit path:

- `canonEvents` on `by_world_and_sequence`, replayed through the deterministic reducer, for
  `relationshipHistory` — the world day, all six deltas, the reason and the **visibility** of
  every relationship change (`convex/canon/model.ts` `RelationshipHistoryEntry`);
- `storyArcLifecycles` + `storyArcProjectionEvents`, both `eq('worldId', …)`, for the current
  arc's status and `coreCharacterIds`.

None of the `v.any()` generation-blob tables (`directorPlans.context`, `groupedSceneRuns.result`,
`sceneSimulationRuns.result`) is touched. Those were the ART-46 review finding, and they are what
"no unbounded whole-world collect in a rebuild path" is actually about. `canonEvents` *is* read
whole, which is the same read three sibling rebuilds already make here and is unavoidable for an
accumulated level: a relationship's standing is a fold over its entire history, so no suffix of
the log answers it. ART-100 tracks making these incremental.

### Why Canon rather than the published `relationship:<pairKey>` model

1. **The published model does not carry what this needs.** `RelationshipChange` publishes three of
   the six deltas (trust, affection, resentment) and no world day at all. The seven-day window
   needs the day; 關係類型篩選 needs all six dimensions.
2. **Independence from ART-95.** The published payload's current dimensions were the last event's
   delta rather than an accumulated level. That defect is repaired in the same branch, but a graph
   built on the repaired field would be correct *because of* the repair, and the two changes could
   then only be reviewed together. Built on Canon, this graph is correct either way.
3. `publicRead` may depend on `canon`, and `liveStateFunctions.ts` already replays the world
   through `../canon/replay` on this path.

### The trap: Canon's accumulated levels are NOT publication-safe

`WorldProjection.relationships` — Canon's `RelationshipState` — is the obvious thing to read and
the wrong one. `convex/canon/queries.ts` exposes it only as an internalQuery labelled 「Private
relationship state and causal history」, and the neighbouring persona-summary query in that same
file spells out why: 「a public reader who could see that a character's trust in someone inverted would learn a
private relationship fact the public projection deliberately withholds」.

The cause is in the reducer, which folds **every** `relationship_changed` into that state, public
and private alike. Publishing the number would leak the magnitude and direction of hidden feelings
through arithmetic rather than through a field, defeating `buildRelationshipProjection`'s
private-visibility rejection without ever naming a private value.

So `groupPublicRelationships` keeps only `visibility === 'public'` entries and re-folds those with
`accumulatePublicRelationshipDimensions`. A pair whose only history is private **does not appear
at all** — not at zero, since an edge at neutral would itself disclose that something private
happened between those two. `assertNoPrivateRelationship` then re-checks the property on the
assembled input, so a caller that forgets the filter fails loudly.

Canon's key is directional (`source|target`), so A→B and B→A are separate histories. Both fold
into one undirected edge ordered by `sequenceNumber`, matching `buildRelationshipProjection`'s
sorted `pairKey`; picking one direction would report half of a mutual falling-out.

### Character summaries

Built through `characterSourceFrom` + `buildCharacterProjection` — the same pair
`rebuildCharacterProjection` uses — so 人物摘要 sits behind the identical field allowlist as the
character page and inherits ART-132's withheld-scene redaction. Only the nodes that survived the
thirty-node cap are built, via a two-pass build: the first pass settles who is on the graph with
no summaries at all, the second fills them in for the survivors. The two passes cannot disagree,
because node selection reads no character field.

## 3. The default scope

Three conditions, all required:

1. **Current-arc core characters.** The seed set. The current arc is selected from the world's
   published arcs by status precedence `climax > escalating > resolving > active`, then `arcId`
   ascending. A world with no active arc publishes a graph with a null arc and no nodes — a
   publishable answer, so the view can say 「目前沒有進行中的故事線」 without the read returning
   nothing, which is indistinguishable from an outage.
2. **One hop.** An edge qualifies only if at least one endpoint is a core character. An edge
   between two non-core characters is two hops from the arc even when both are on the graph as
   neighbours.
3. **Changed in the last seven world days.** `targetWorldDay - lastChangedWorldDay <= 7`,
   inclusive at both ends: seven days ago is IN, eight days ago is OUT. Changes in the target
   day's future are also out — a day-3 graph that showed a day-6 change would not be a graph of
   day 3.

A core character with no qualifying edge is still a node. 「當前 Arc 核心人物」 is a scope, not a
filter on activity; a core character nobody has interacted with this week is a fact about the arc.

## 4. Dimensions are folded as of the target day

Folding a pair's whole history would put today's numbers behind a day-3 heading — wrong in a way
that looks right. Only the changes with `worldDay <= targetWorldDay` are folded, so date switching
moves the numbers and not just the caption.

## 5. The thirty-node cap, and what it leaves out

Selection order, published in the payload as `scope.nodeOrdering`:

1. The current arc's core characters, in the arc's own published `coreCharacterIds` order.
2. Then one-hop neighbours, ranked by their single best qualifying edge:
   a. `lastChangedWorldDay` descending;
   b. then edge `strength` descending;
   c. then `characterId` ascending — a total order, so nothing is decided by input order.

Truncation takes the head of that list, so what was dropped is what changed longest ago and
weakest. If the core set alone exceeds thirty it is truncated too, in the arc's order.

**Truncation is never silent.** The payload carries `candidateNodeCount` / `candidateEdgeCount`
(what qualified) alongside `omittedNodeCount` / `omittedEdgeCount` (what the cap removed), and the
page states both in words. "30 nodes" and "30 of 84 nodes" are different claims, and a view that
cannot tell them apart will make the first one. `assertRelationshipGraphBounds` refuses a payload
whose counts do not add up, so a future change to the selection order fails the rebuild and leaves
the previous version serving rather than publishing a silently-truncated graph.

An edge survives only if both its ends did. Half an edge is a claim about a relationship with
somebody the viewer is not being shown.

## 6. Relationship type

`關係類型篩選` filters over a **derived** category: the dimension carrying the most weight
(`trust | affection | resentment | fear | dependency | familiarity`), or `neutral` when all six are
zero. Ties break on a fixed dimension order, so the payload's content hash is stable.

There is no `relationshipType` field anywhere in Canon to read. Inventing a taxonomy
(「朋友」「敵人」「家人」) would mean putting a label on a relationship that nothing in the world
model supports. `neutral` is not a seventh flavour — it is the honest label for a pair whose
dimensions have moved and moved back, which is a real state.

## 7. Where it sits in the pipeline

Last in stage 19 of the post-commit pipeline (`convex/operations/postCommitLive.ts`), after the
vote-consequence rebuild. **One** reason: that stage is a single un-isolated handler, so the
newest and least critical read model must sit **downstream** of the two safety-bearing rebuilds
(`rebuildLiveProjection`, `rebuildOnboardingSummary`), never upstream of them.

The graph does **not** depend on any read model rebuilt earlier in the pipeline. It is built from
Canon (§2), so its inputs are identical whichever order this stage runs in — which is the same
fact §2 relies on when it says the graph is correct independently of ART-95's repair. An earlier
revision of this section claimed the graph was derived from `relationship`/`arc`/`character`; that
was wrong and contradicted §2.

**Only the committed day**, with no trailing window. Each day's graph is complete the moment that
day is over: unlike `voteConsequence`, no later event can add to a past day's graph, because a
change on day 9 is by construction not a change that had happened by day 7.

## 8. Accessibility

ART-94 owns the full P1 graph/timeline compliance pass. ART-44 ships the baseline every public
page here already meets — semantic landmarks, `aria-labelledby` headings, 44×44 `.public-tap`
targets, zh-Hant copy — plus the one thing a graph specifically needs:

**The diagram is never the only way to obtain the information.** The node-link diagram is
`role="img"` with a summarising label and `aria-hidden` internals (a screen reader walking the
geometry would announce a list of coordinates). Beside it — not behind a toggle — is the full text
equivalent: every character, whether they are core or one hop out, every relationship, its type,
strength, last change day and reason. `publicPages.a11y.test.tsx`'s `removing the diagram
entirely leaves every fact on the page` removes the `<svg>` and then asserts each of those facts
is still in the page text. The `toContain` checks are the claim: a text-unchanged assertion would
be vacuous, because the `<svg>` holds only `<line>` and `<circle>` and contains no text node.

There is deliberately no second, `sr-only` prose block. The visible 人物與關係 section already
carries every fact, so a hidden copy would make a screen reader announce every relationship twice.

Layout is deterministic — two concentric rings, angle a function of the node's index in the
published order. No randomness, no force simulation, no DOM measurement. The ring split is the
second, redundant encoding of `hop`, which is also stated in words, and core nodes differ from
neighbours by radius and stroke-width as well as colour, so the two groups survive greyscale.

## 9. Known limits

- **A relationship change Canon recorded without a usable world day is dropped**, not read as day
  0. Reading a missing day as 0 would place it inside the window on day 7 of a world and outside
  it on day 8 — a graph that changes for a reason nobody could explain. Canon's validators require
  the field, so this is a guard rather than an expected state.
- **`relationshipType` is derived, not recorded.** A world whose relationships all move on one
  dimension yields a filter with one option. That is an honest reflection of the data, not a
  degraded filter.
- **A day is only published while it is current.** A world that ran before this task shipped has no
  graph for its past days, and none will be built retroactively. Date switching to such a day
  returns null and the page says 「這一天尚未發布關係圖」.
- **The current-arc selection is a rule, not a measurement.** A world with two arcs at `climax`
  resolves to the lower `arcId`. The payload names the arc it chose, so a reader is never left
  guessing which story they are looking at, but the graph does not offer arc switching — FR-I007
  does not ask for it.
