# P1 integration suites — §19.2 cases 2 and 5 (ART-76)

PRD §19.2 lists ten integration scenarios. Eight were covered before this task:

| Scenarios | Suite | Task |
| --- | --- | --- |
| 1, 3, 4 — secret transfer, dead-character exclusion, unique item ownership | `convex/knowledge/canonCognitionIntegration.test.ts` | ART-61 |
| 6–10 — provider retry, no double-submit, Episode uses accepted events only, correction → read model, public content survives simulation failure | `convex/operations/failureIntegration.test.ts` | ART-74 |
| **2 — 謠言經多人傳播** | `convex/knowledge/rumorPropagationIntegration.test.ts` | **ART-76** |
| **5 — 投票事件安全注入** | `convex/viewer/voteInjectionIntegration.test.ts` | **ART-76** |

Both new suites drive the REAL domain surface — `commitProposedEvent`, structural and Canon
validation, the deterministic reducer, replay, snapshots — with only the Canon store swapped for
its in-memory reference implementation. No production logic was added for either.

## 1. Case 2 — one rumor, four people

Unit coverage for rumors was already thorough. `canon/rumorChain.test.ts` (ART-28) settles the
rules one at a time; `knowledge/rumorLedger.test.ts` settles the ledger;
`publicRead/rumorPublicBoundary.test.ts` settles the public boundary.

What none of them does is ask the case's four questions **of one accepted log**:

1. **Provenance** — every hop cites an event id that is actually in the log.
2. **Versions** — a holder told a distorted retelling is on a different version from one told the
   original.
3. **Belief divergence** — two holders of the same rumor hold different stances and confidences.
4. **Containment** — each of those answers is readable only by the character it belongs to, and a
   character the rumor never reached gets the *same* refusal as "not yours", so rumor ids cannot be
   enumerated by guessing.

Asked separately, each can be true of a different world. Asked of one log, they are a statement
about the system.

The fixture's shape is deliberate: `lin → wu → hao` all carry the original wording, `hao → mei`
distorts it, and `mei` then doubts what she was told. Version divergence and belief divergence are
different things, and a world that only ever produced one of them could not tell a test that
conflated them apart.

**One thing worth knowing about the chain:** the origin is hop 0, with a null `fromCharacterId`. So
three tellings produce four entries. That is the chain modelling "lin came to hold it" as a step
rather than as a precondition, which is what lets the origin carry the same provenance every later
hop does.

## 2. Case 5 — the whole ballot, including the part nothing could run

`environmentVote.test.ts` settles each decision in isolation and `environmentVoteInjection.test.ts`
(ART-45) settles the tail — a closed round's winner reaches Canon as a proposal, and is still
refused when it breaks a world rule.

Neither covers the part §19.2 names first: **safety**. The FR-L003 classifier sits at two points on
this path, and both are called only from Convex handlers, whose bodies never execute under jest:

- `validateBallotCandidates` gates the **slate**, before a round may open at all;
- `evaluateVoteSubmission` classifies every submitted candidate id **before** it is compared
  against the catalog, so an injection payload never reaches a code path that could log it.

Both are exported pure functions, so the suite drives all ten links without a handler:

```
selectDailyCandidates → validateBallotCandidates → evaluateVoteSubmission
  → countersFromBallots → tallyFromCounters → closeRoundFromTally
  → buildWinningIntervention → buildViewerVoteProposal
  → validateEventStructure → commitProposedEvent → replayWorldEvents
```

「安全注入」 has two halves and the suite asserts both: the winner reaches Canon, **and nothing else
does**. A refused submission never reaches the tally. An off-ballot catalog id is refused by the
ballot rather than by the classifier — and the distinct rejection code is what proves which gate
ran. A round with no accepted vote elects nobody and injects nothing. A redelivered drain
re-derives the same `idempotencyKey` and commits once. A winning event that violates an immutable
world rule is still refused, which is the whole content of 「勝出不代表指定後續結果」.

## 3. Evidence

Six injections into **production** code, each turning a named test in the new suites red — which is
the only way a test suite that adds no production logic can be shown to be worth having:

| Injection | Test turned red |
| --- | --- |
| `evaluateVoteSubmission` skips the FR-L003 classifier | `refuses an injection payload at the classifier, before the catalog is consulted` |
| accept any catalog id, on today's ballot or not | `refuses a well-formed id that is not on the ballot for today` |
| stop enforcing the round submission cap | `stops accepting submissions once the round is full, and elects from what it has` |
| `authorizeRumorRead` distinguishes "exists but not yours" | `refuses the rumor to a character it never reached, without confirming it exists` |
| `authorizeCharacterRumorList` drops its requester check | `refuses one character listing another's rumors` |
| the reducer stops creating a version for a distorted retelling | `keeps two versions alive at once…` **and** `lets two holders … believe different things` |

A seventh attempt was **rejected rather than reported**: removing the `held` guard from
`authorizeRumorRead` left its only use unreferenced, so the suite failed to compile and reported
`Tests: 0 total`. A suite that did not load is not evidence that a test can fail, so it was
replaced with the compiling injection above.
