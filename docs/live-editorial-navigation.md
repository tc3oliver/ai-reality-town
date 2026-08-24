# Live ↔ editorial navigation

**Requirement:** FR-P002 (PRD 2.0 §12 Epic P) · **Task:** ART-130

FR-P002's problem statement: Live Town and the editorial surfaces exist as disconnected routes,
so a viewer cannot move between "what is happening now" and "what it means". This is the map of
the connections that close that, and of the one mechanism they all share.

## What already existed

Two of the five criteria were already satisfied by earlier tasks, and are recorded here rather
than re-implemented:

- **AC#1** — an ended active scene links to its Episode. `ActiveScenePanel` (ART-122 / FR-O003)
  renders 「閱讀當日 Episode」 for a scene whose status is `ended`, and `liveMap.a11y.test.tsx`
  asserts an active scene offers no such link while an ended one does.
- **AC#4** — the recommended entry is openable from the live overlay. `StoryOverlay` (ART-125 /
  FR-O007) renders 「從第 N 集開始認識這個世界」, asserted in the same suite.

## What ART-130 added: the direction back

Episode → character and arc → character existed as links to the **pages**. What nothing answered
was **where they are right now**, which is the map.

| From | To | Link |
| --- | --- | --- |
| Episode detail, per related character | Live map, focused on them, card open | `?focus=character:<id>&card=1` |
| Arc detail, per core person | Live map, focused on them, card open | `?focus=character:<id>&card=1` |

The map link is an **addition**, never a replacement: both pages still link to the character page
beside it, and the test asserts that.

## The focus parameter

```
<base>/live/<worldId>?focus=<targetId>[&card=1]
```

`targetId` is a camera focus target — `character:<id>`, `location:<id>`, `scene:<id>` or `town`.
`card=1` additionally opens that character's card, because "where is this person" and "what are
they doing" are one question and the camera alone answers half of it.

**A malformed or unresolvable focus degrades to a working page.** A hand-edited URL, or one
carrying an id from an older deploy, leaves the viewer at the live map unfocused rather than at an
error. That is also why the parameter is not validated at parse time: the live map resolves it
against the targets it actually has, and an id matching none of them simply leaves the camera
where it was.

### One namespace, one owner

The target-id constructors moved from `components/world/cameraModel` to
`components/live/liveMapRoute` in this task, and `cameraModel` re-exports them so no importer
changed.

They had to move because the architecture check refused the alternative — `clientPublic` may not
depend on `clientWorldReadOnly`, and that check was right to refuse. The other option was writing
`` `character:${id}` `` a second time in `components/public`, which is two namespaces that happen
to agree today: change the prefix in one and every editorial link silently stops resolving,
dropping viewers at an unfocused map with **nothing failing anywhere**.

`clientLiveRoute` is the one module all three sides may depend on, because it depends on nothing
itself. `clientWorldReadOnly` gained it as a permitted dependency — a one-line boundary change
that cannot create a cycle, since the module it points at has an empty `mayDependOn`.

`liveMapLinks.test.ts` asserts the **round trip** rather than a literal href, for the same reason:
a test expecting `/live/mistwood?focus=character%3Ahe-jun` would keep passing after the prefix
changed while every real link broke.

## AC#5 — preserving progress and focus

Two mechanisms, both already established in this codebase rather than invented here.

**The camera** is recorded in `sessionStorage` per world on every change and restored on the next
mount. A viewer watching the mill who follows a scene to its Episode and comes back is looking at
the mill again, not at the town view as if they had just arrived. Navigation is only continuous if
the return leg is.

**Replay progress** needs nothing new: `replaySession.ts` (ART-121) already marks a replay as
auto-played per tab, so returning to the map does not restart a replay the viewer has seen.

### Precedence, and why

An explicit `?focus=` **always wins** over the remembered camera. A viewer who just clicked
「在地圖上查看 何俊」 is asking for 何俊 *now*; restoring the mill they were watching an hour ago
would ignore the thing they clicked. Absent both, `resolveLiveEntry` returns `mode: undefined` —
"no opinion" — so the map keeps its own default rather than this module becoming a second place
that decides it.

A card is **never** re-opened from memory. Opening one is something a viewer does; doing it for
them on every return is the page making a decision on their behalf.

### Fail open, unlike the replay mark

`replaySession` fails *closed* — its failure mode is auto-playing repeatedly, so a storage it
cannot write to must mean "already played". This one fails *open*: its failure mode is merely
arriving at the town view, which is the ordinary first-visit experience. Every failure path
(no storage, blocked storage, a throw on access, malformed JSON, a wrong field type, a stored
`zoomStep` of `1e9`) answers "nothing remembered", and nothing becomes unreachable — the camera
chrome is right there.

`resolveLiveEntry` is pure and lives outside the component precisely so all of that is reachable
from a unit test with a fake storage, rather than only through a renderer.

## Verified, and not

Verified: the href round trips for all three target kinds including ids needing escaping (`&`,
`=`, `/`, CJK) and scene ids containing colons; the precedence rule's four branches; totality over
every malformed stored record; both pages rendering the links with per-row accessible names that
start with the visible label (WCAG 2.4.4 / 2.5.3) and carry the touch target; and both pages
staying axe-clean.

**Not verified here: a real browser navigating and returning.** No headless browser runs in this
repo — that is ART-137 (the dynamic-view E2E suite), whose remit explicitly includes navigation in
both directions. This is the structural floor under it.
