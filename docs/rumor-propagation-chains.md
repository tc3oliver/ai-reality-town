# Versioned rumor propagation chains

ART-28 implements FR-E005. A rumor is replayable domain state folded from accepted
events — origin, propagation chain, versions, credibility, objective truth and known
corrections — and it never becomes a Canon Fact.

## What existed before, and what it was not

The `rumor` event type had been declared since the foundation and was consumed by nothing.
Separately, whole-scene simulation accepts a `rumors[]` collection whose own prompt calls it
"short narrative notes about a proposed event, not state changes", carrying exactly
`{sourceCharacterId, content, proposedEventIndex}` with no confidence and no visibility.

Both survive, and the distinction is now stated in the prompt as well as in code: **a
`rumors[]` note is colour a reader sees and changes nothing.** A rumor the world tracks
exists only as `rumor_*` state changes inside a proposed event, and only after Canon accepts
them.

## The four verbs

`STATE_CHANGE_TYPES` gains four entries, because the PRD asks for four separable histories.
Collapsing them into one `rumor_changed` bag would make "A was told, then B doubted"
indistinguishable from "A doubted, then B was told", and the order is the story.

| Change | Records |
| --- | --- |
| `rumor_originated` | 原始來源: who started it, what they claim, how sure they are, who may hear it |
| `rumor_propagated` | one hop, plus a new version if the teller changed the wording |
| `rumor_belief_changed` | 相信 / 否定: a holder's stance and confidence |
| `rumor_corrected` | 已知更正, appended; corrects nothing in place and moves nobody's belief |

`rumor_originated` requires a fact-SHAPED claim — `claimSubjectType`, `claimSubjectId`,
`claimPredicate`, `claimedValue` — without being a fact. That shape is what makes 客觀真假
derivable rather than authored.

## The two derived fields

**客觀真假** is computed by asking Canon about the claim: `unknown` while no accepted
`fact_created` has settled the subject and predicate, then `true` or `false` by strict
comparison against the live fact. A provider that could write it would be authoring the
world's verdict on its own output, which is FR-E005 AC#1 with the rule removed.

**可信程度** is the mean stance-weighted confidence across current holders (`believes` 1,
`doubts` ½, `rejects` 0), in 0..1. Zero for a rumor nobody holds. Holders are folded in
character-id order, and the sort is load-bearing rather than tidy: a projection loaded out of
a stored snapshot need not preserve object key order, and an unsorted fold would make a
snapshot-resumed world's credibility differ from an identical replayed one — which
`projectionIntegrityHash` would then report as corruption.

Both are recomputed after every state change in an event, scoped to the rumors that event
touched plus any whose claim a `fact_created` re-versioned.

## Belief lives in the knowledge ledger

There is no second store of who holds which rumor. A rumor a character carries is knowledge
they carry — it has a source, a confidence, a shareability and an authorization story, and
`characterKnowledge` already owns all four. Rumor holdings are ledger records with
`rumorId`, `rumorVersionId` and `rumorStance` attached, superseded through the ledger's own
`correctsKnowledgeId` / `correctedByKnowledgeId` link so "believed v1 until slot 3" stays
readable.

Provenance is kept honest: propagation pins `sourceType: 'told'` rather than taking it from
the proposer, so hearsay cannot claim to be first-hand; an origin may declare any source type
*except* `told`, because at an origin there is nobody who told them. `factId` is
`rumor:<rumorId>` — it names the claim without conceding a fact exists.

`truthStatus` on the record is the standing Canon could have reported **at the moment of
learning**, not the current answer. That is what a misconception is made of, and flattening
it to the present would erase it.

Two characters can therefore hold the same `rumorId` at different versions, with different
stances and different confidence, and nothing merges them. Changing your mind does not move
you onto the current version: re-pointing a doubter at `currentVersionId` would quietly
upgrade them to a wording nobody ever told them.

## What Canon validation enforces

- A character may only pass on, doubt or correct a rumor that **actually reached them**
  (`RUMOR_SOURCE_NOT_HELD`). This is the rule that makes a chain a chain rather than a set of
  unrelated sightings. It is enforced twice — in `validateCanon` and again in the reducer —
  because a projection built by replay must not depend on validation having run.
- One event may not both spread a rumor and establish its claim as canonical fact
  (`RUMOR_CANNOT_BECOME_FACT`), in either order; and an event typed `rumor` may carry no
  `fact_created` at all.
- An unattributed correction is the world speaking, so only an `admin` or `system` proposer
  may issue one.
- A rumor may originate once, be corrected at most once per event, and a character may change
  their stance on it at most once per event.

A rumor that starts and travels several hops inside one scene is accepted: hops are judged
against the world the earlier changes in the same event produce, exactly as movement is.

## Reads are authorized, and thin

`convex/knowledge/rumorAuthorization.ts` gates reads under the ledger's own rule. Operations
sees the whole chain and every current holding. A **character sees only what reached them**:
the version they were told, their own stance and confidence, and the hops they were personally
party to.

Withheld from a character, deliberately: the origin (hearing a rumor tells you who told *you*),
the full chain (it is the map of who talks to whom), the credibility (an aggregate of what
others privately believe), Canon's verdict (a character who could read it would never need to
weigh a rumor again), and the corrections (being on the record is not the same as having been
told). A rumor that never reached a character is refused with the same
`KNOWLEDGE_ACCESS_DENIED` as another character's ledger, so ids cannot be enumerated by
guessing.

## Nothing public

Rumor chains are internal. `PUBLIC_DYNAMIC_FORBIDDEN_FIELDS` names every rumor field ahead of
any emitter, and `visualReplay` inherits the list whole. The character and world read models
build from fixed allowlists, so a field added to `WorldProjection` cannot join a public payload
by omission.

## Verification

```bash
npm test -- --runTestsByPath convex/canon/rumorChain.test.ts
npm test -- --runTestsByPath convex/knowledge/rumorLedger.test.ts
npm test -- --runTestsByPath convex/publicRead/rumorPublicBoundary.test.ts
npm run check
```

Eight fault injections were run against these suites and each reddened a named test: a rumor
seeded into `emptyProjection` (no event), a dropped propagation hop, an unsourced acquisition,
a `fact_created` pushed from `rumor_originated`, holders merged across characters, a correction
rewriting its version, `cloneProjection` truncating versions and hops, and rumor content
written into the public character payload.

The third of those found a real gap rather than confirming one: removing canon validation's
holders check alone left every test green, because the reducer refuses the same hop with the
same code. Both enforcement points are now pinned separately.
