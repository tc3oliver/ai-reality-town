# Persona Deviation and Character Summaries (FR-B003 / ART-11)

How Canon notices that a character acted out of character, what it does about it, and how a
character's summary keeps up.

Related: `docs/character-state-projection.md` (FR-B001, the state half of the comparison),
`docs/relationship-projection.md` (FR-B002, the relationship half),
`docs/character-seed.md` (FR-A002, where the anchors come from),
`docs/proposed-event-review.md` (FR-K002, where a refusal is read).

- Pure detection, decision and summary fold: `convex/canon/personaDeviation.ts`
- Commit-time gate: `validatePersonaConsistency` in `convex/canon/validators.ts`
- Internal read: `canon/queries.ts:getCharacterSummaries`

## 1. Detection is structural, never a reading of the persona prose

A seeded persona is mostly free text: `personalityTraits`, `values`, `behaviorRules`,
`publicGoal`, `fear`. The obvious implementation compares that text against the event's `reason`
and `publicSummary` and decides whether the character "acted out of character".

**That was rejected outright**, for three reasons and one decisive one:

- it is a second, unversioned classifier whose verdict nobody can reproduce;
- it drifts the moment a seed is reworded, silently changing what Canon accepts;
- it cannot be replayed, because the wording it judged is not the wording it would judge today;
- and **the strings it would judge are written by the very provider whose output is being
  judged.** A provider that learns the phrasing walks straight through the gate.

`docs/proposed-event-review.md` already names that failure mode for rejection reasons — that
surface "never reads, parses, or pattern-matches a free-text error message" — and the same rule
applies here.

So a deviation is only ever detected from data Canon can check itself: the character's projected
state (FR-B001), their projected directional relationships (FR-B002), and the two seeded fields
the projection also tracks — `occupation` and `organizationIds`. Every signal is a comparison
between two values the world already holds.

**The cost, stated plainly:** this cannot see a character betraying a `behaviorRule` in dialogue
alone. Nothing in Canon records that, and inventing it would be asserting a world fact nobody
accepted. What Canon *does* record is when someone abandons their trade, walks out on their
faction, or inverts how they feel about another person — which are precisely the 重大行動 the
requirement is about.

## 2. An LLM cannot declare its own deviation away

The other shape considered was a `personaDeviation` field on the proposal, filled in by the
proposer, with the gate enforcing the justification the proposer declared.

That makes AC#1 a **claim** rather than a guarantee: an unflagged proposal proves only that the
proposer did not flag it. Detection here is computed *from* the proposal, never read *off* it, so
a proposal cannot suppress its own flag. Justifications are held to the same rule — each is a
second **structured state change** in the same event, not an assertion about it.

## 3. The signals

| Signal | Class | Fires when |
|---|---|---|
| `occupation_abandoned` | reversal | `character_state_changed{field:'occupation'}` moves away from the seeded occupation, and the character still held it |
| `seeded_organization_left` | reversal | `character_state_changed{field:'organization_memberships'}` drops a seeded membership |
| `relationship_polarity_reversed` | reversal | a signed relationship dimension crosses zero with a swing ≥ `PERSONA_SIGNIFICANT_RELATIONSHIP_SWING` |
| `relationship_swing` | deviation | the same swing without a sign change |

`PERSONA_SIGNIFICANT_RELATIONSHIP_SWING` is **40**, a fifth of the −100..100 range in one scene.
Below it a relationship is drifting, which is what relationships are supposed to do. The existing
producers move relationships by 1–5 per scene (`fakeProvider`, `fakeSceneNarrator`,
`mistwoodFixture`), so ordinary play never approaches it — a fault-injected threshold of 1 breaks
three tests in the long-run harness, which is the evidence that the number is load-bearing rather
than decorative.

Three details that are decisions rather than mechanics:

- **The anchor is the fallback, not just the seed record.** Neither `occupation` nor
  `organization_memberships` has usually been written by any event, so the projection holds
  nothing. Detection falls back to the seeded anchor — otherwise a character's *first* departure,
  the only one that departs from persona at all, would be the one nobody ever sees.
- **Only a departure from the anchor counts.** Once a character has already left their seeded
  trade the anchor is spent; re-flagging every later job move would turn the flag into a change
  log.
- **`familiarity` is excluded from the signed dimensions.** The seed bounds it to 0..100 because
  knowing someone is a quantity, not a direction, so a sign flip in it would be an artefact of the
  reducer's shared clamp rather than a fact about anyone.
- **A first-ever relationship has no polarity to invert.** Recording one at −60 is a strong
  characterisation, so it is a `relationship_swing`, not a reversal.

## 4. The four supports, narrowed to what Canon can witness

FR-B003 requires a departing major action to carry an explicit emotional change, a major event
cause, a goal conflict, or a growth/breakdown marker. **Any one** of them suffices — the PRD lists
alternatives, not a conjunction; a character can break under a single blow without also changing
jobs over it.

| PRD bullet | Structural evidence required |
|---|---|
| 明確情緒變化 | a `character_state_changed{field:'emotion'}` for this character in the same event |
| 重大事件原因 | a cited `causedByEventIds` entry that **this character participated in** |
| 目標衝突 | an adversarial relationship change (trust down or resentment up) toward a co-participant, from a **different** state change than the one that raised the signal |
| 角色成長或崩潰標記 | a `character_memory_formed` for this character with `importance ≥ 0.7` |

Two of those narrowings are the load-bearing ones:

**A cause must be material.** Citing *any* accepted event is a bar a provider clears by naming the
last thing that happened. Requiring the cause to have involved the character is not. The commit
pipeline supplies `knownEventParticipantIds` from events it has already loaded, so this costs no
extra read; without that map the support simply never fires, because a caller that cannot prove
the link must not assume it.

**A reversal must not supply its own conflict.** A trust reversal *is* trust going down, so a
naive "was there an adversarial relationship change?" check would find the reversal itself and
clear every reversal ever proposed. The conflict must come from a different state change.

`growth_or_breakdown` uses ART-25's own mechanism — the subjective memory the world formed at the
time — because that is precisely the "marker" the requirement names, and `importance` is a
validated 0..1 field rather than prose. The 0.7 floor asks for a memory the world itself treated
as formative; a lower bar would let any recorded memory launder any reversal.

## 5. The two dispositions, and why there are two

| Situation | Outcome | Code |
|---|---|---|
| deviation with ≥1 support | **flagged**, committed | — |
| reversal with no support | **rejected** | `UNSUPPORTED_PERSONA_REVERSAL` |
| non-reversal deviation with no support | **sent for review** | `PERSONA_DEVIATION_REVIEW_REQUIRED` |

AC#2 offers two remedies — 拒絕 **or** 送審 — and an operator has to be able to tell which one
applied from the code alone. A reversal with nothing behind it is refused outright. A large but
same-direction change is refused *pending a human look*, because it might well be right and only a
person can say.

Both are `CanonError`s, so **nothing unsupported enters Canon either way**; the difference is what
the operator is told, not whether history was written. Both are stable `SCREAMING_SNAKE_CASE`, so
`proposalReview.ts` reports them verbatim rather than collapsing them to
`UNCLASSIFIED_REJECTION` — the FR-K002 console is the review queue, and this needed no second one.

Two exemptions, each for a reason that already exists in `validateCanon`:

- **Superseding remediation events** (`correction`, `retcon`) are never assessed. They restate what
  the record should have said; judging one as a persona deviation would report that the character
  changed when only the account of them was fixed. The exemption lives in
  `assessPersonaDeviations` rather than in the gate, so the gate and the summary can never
  disagree about it.
- **A world with no seeded anchors** leaves the gate inert, like every other optional reference set
  on `CanonRuleContext`. Refusing to validate would be a far worse failure than not detecting a
  deviation: FR-B003 is a quality gate, not an integrity one, and an unseeded world must still
  commit.

The gate runs **last**, after every reference, precondition and uniqueness rule. A persona verdict
on an event naming a character who does not exist would tell an operator nothing they can act on.

## 6. The summary is a projection, not a table

A flag is a pure function of (accepted event, prior projection, seeded anchor). Storing it would
create a second record that can disagree with Canon, would need back-filling onto all existing
history, and would have to be kept consistent across snapshot restore. So
`buildCharacterSummaries` derives it instead — **this task adds no table, no field, and no snapshot
version bump.**

```
CharacterSummary {
  characterId
  anchor                    // who they were: occupation, organizations, traits, values
  version                   // 1 for the seeded persona, +1 per turning point
  flags[]                   // every flagged deviation, oldest first
  lastTurningPointEventId
}
```

It deliberately does **not** restate current occupation, location or emotion: FR-B001's
`characterStates` already projects those from the same events, and a second copy would be a second
thing to keep true.

**A turning point is narrower than a flag** (AC#3). A flag becomes a turning point when it inverted
an anchor, or when the world recorded the moment as formative (`growth_or_breakdown`). A large
same-sign relationship swing is flagged but is *not* a turning point: trusting someone you already
trusted rather more is a big move within the character, not a new character. If it were, every
summary would be "refreshed" by ordinary drama and `version` would stop meaning anything.

The fold mirrors `replayWorldEvents` — same starting projection, no reordering, no filtering, no
mutation — and assesses each event against the projection as it stood **before** that event, which
is the same view the commit gate had. So a rebuilt summary always agrees with the decision that was
actually made. `betrayal` reads as a reversal only because the event that warmed the relationship
had already been folded in; assessed against an empty projection it is a plain swing, and
`personaDeviation.test.ts` pins exactly that difference.

History committed before this gate existed can hold deviations with no support. They are recorded
as flags with an empty `justifications` list rather than dropped or retro-rejected: **accepted
history is never re-judged**, and a summary that hid them would be the less honest option.

## 7. Privacy

A summary is **internal**. A flag says that `lin`'s trust in `wu` inverted from +50 to −50 — the
same private causal detail that keeps `relationshipHistory` and `getRelationshipProjection`
internal. `getCharacterSummaries` is an `internalQuery`, and the anchor carries only
`occupation`, `organizationIds`, `personalityTraits` and `values`: `privateProfile`, `privateGoal`,
`fear` and `behaviorRules` are excluded because nothing uses them and copying private seed text
into a derived structure widens its blast radius for no gain.

A refusal's `details` carries the structured signals and never a `reason` string, because a
rejection is read by every role that may inspect the world while a private relationship reason is
not.

`publicRead` is *allowed* to depend on `canon` by `architecture/module-boundaries.json`, so the
boundary checker cannot catch a leak here. `personaDeviation.boundary.test.ts` is what does: it
reads every file under `convex/publicRead`, `convex/viewer` and `src`, and fails if any of them so
much as names `CharacterSummary`, `personaDeviation`, `getCharacterSummaries` or
`lastTurningPointEventId`. Asserting over the file list rather than a fixed set of greps means a
**new** public file is covered the day it is added.

## 8. Verification

```bash
npm test -- --runInBand convex/canon/personaDeviation.test.ts convex/canon/personaDeviation.boundary.test.ts
npm run check
```

`personaDeviation.test.ts` groups its cases by the criterion each settles. AC#2 is settled by
committing through the real pipeline and then asserting the store is **still empty** — not by
inspecting a return value a broken commit would produce anyway.
