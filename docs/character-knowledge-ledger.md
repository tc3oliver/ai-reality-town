# Character knowledge ledger

ART-24 implements FR-E001 as a deterministic, source-proven projection. Providers can
only propose `character_knowledge_learned` changes; the Canon commit pipeline validates
them, and only accepted events update the ledger through the pure reducer.

Each projected record contains a deterministic knowledge ID, character and fact IDs,
belief value, truth status, confidence, source type and source event, learned world
time, shareability, and correction links. All six PRD source types are supported:
observed, told, public, evidence, inference, and memory. Confidence is bounded to 0–1.

Corrections append a new knowledge record. The prior record remains in history and is
linked through `correctedByKnowledgeId`; a correction must target an uncorrected record
owned by the same character and concerning the same fact. Canon history is never edited.

The additive v1 fields preserve replay compatibility: legacy event payloads normalize
to their fact ID as belief value, `unknown` truth, 0.5 confidence, and `private`
shareability. Initial seed knowledge similarly normalizes explicit source provenance.

Knowledge reads are internal. A character requester can read only its own ledger;
operations may read a target ledger for review. There is no public Convex query, and
returned records are cloned so callers cannot mutate projection state.

## Rumors are ledger records, not a second store

ART-28 (FR-E005) records what a character holds about a rumor here, as an ordinary knowledge
record carrying `rumorId`, `rumorVersionId` and `rumorStance`. A parallel "who believes which
rumor" table would have been a second answer to *what does this character know*, and the two
would eventually disagree — about a character who was told something and then died, say, or
about a read the ledger's authorization refused and the other store did not.

The consequences are worth stating because they are load-bearing rather than incidental:
a rumor holding is superseded through the same `correctsKnowledgeId` link a correction uses,
so belief history survives; propagation pins `sourceType: 'told'` so hearsay cannot claim to be
first-hand; and `factId` is `rumor:<rumorId>`, which names the claim without asserting a fact
exists for it. See `docs/rumor-propagation-chains.md`.

## Verification

```bash
npm test -- --runInBand convex/knowledge/knowledgeLedger.test.ts convex/canon/characterSeed.test.ts
npm run check
```
