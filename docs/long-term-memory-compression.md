# Long-term memory compression (FR-E004 / RISK-003 / ART-27)

How a character's old memories become impressions without the character losing anything.

Related: `docs/subjective-character-memory.md` (FR-E002, where memories come from),
`docs/authorized-memory-retrieval.md` (FR-E003, the retriever this must not degrade),
`docs/deterministic-reducer.md` (why the source is a replay and not a table).

## 1. There is nothing to delete

The obvious reading of "compress old memories" is a job that rewrites stored memory rows into
summaries and removes the originals. That design cannot satisfy AC#1 (原始 Event 仍保留) or AC#4
(壓縮失敗不得刪除原始記憶) — it can only promise them, and a half-finished delete is exactly the
thing that breaks a promise like that.

`characterMemories` is not a table. It is a projection replayed from the append-only Accepted
Event log: `character_memory_formed` in `convex/canon/reducer.ts` is the only thing that creates a
memory, and nothing in the system removes one. So `compressCharacterMemories` is a **pure function
from that projection to a derived digest**, and it writes nothing.

That turns two acceptance criteria from disciplinary into structural. There is no code path —
returning or throwing — that could remove a source, because none of them can write.
`memoryCompression.boundary.test.ts` pins it by walking the module's real import graph: the only
value import in the whole closure is `convex/shared/errors.ts`. Everything it needs from Canon is
a *type*, which is the point — it reads a projection it is handed and holds no way to fetch,
store or replace one.

## 2. What "lossless" is defined to mean

A digest sentence cannot reproduce the prose of the twelve memories it summarizes. A claim of
"lossless" that meant *byte recovery from the digest alone* would therefore be false, and the
task's whole value is that the claim is true. So the word is pinned to three properties, each
checked by machine in `memoryCompression.lossless.test.ts` against a thirty-memory fixture and the
**real** FR-E003 retriever:

| # | Property | Settles |
|---|---|---|
| 1 | **Exact partition** — `retainedMemories` and the union of the digests' `sourceMemoryIds` are disjoint and together cover the input memory ids exactly once | AC#1 |
| 2 | **Round trip** — `expandCompressedMemories(compress(m), m)` returns `m` verbatim | AC#1 |
| 3 | **Recall preservation** — retrieval over the compressed corpus returns every retained memory the *uncompressed* corpus would have returned, at the same or better rank, at every limit 1..12 | AC#3 |

Property 3 is a theorem, not a fixture coincidence. Every FR-E003 factor — token overlap,
importance, recency, emotional magnitude, arc membership — scores one memory without reference to
any other, and ties break on the stable memory id. So the ranking is a total order on the
individual records, and deleting candidates from the input can only **promote** a survivor, never
demote it. Any retained memory inside the top *k* of the full corpus is therefore inside the top
*k* of the compressed one. The suite still checks it exhaustively across four disagreeing queries
and every limit, because a theorem about the retriever stops being true the day the retriever
changes, and this is where that change should be noticed.

AC#3 follows from property 3 plus one fact: `retainedMemories` contains **every** memory at or
above `HIGH_IMPORTANCE_RETENTION`, regardless of age.

### What is lost

An old, low-importance memory stops being retrievable **verbatim by the cognition path**. That is
the compression; claiming otherwise would be claiming the module does nothing.

It is acceptable because the loss is confined to the *retrieval corpus*, not to the *record*. The
memory id survives inside a digest, and property 2 turns that id back into the exact record on
demand. `memoryCompression.lossless.test.ts` asserts this loss directly rather than only
describing it here — it finds the memories the full corpus would have returned and the compressed
one does not, and then proves each of them is still both cited by a digest and recoverable. A
suite that only ever asserted preservation would pass just as happily against a compression that
compressed nothing.

## 3. The retention rule

```
retained(m) = m.importance >= HIGH_IMPORTANCE_RETENTION || age(m, now) < horizonDays
```

Two reasons to keep a memory verbatim, and a memory needs only one of them. `now` is a **world**
time supplied by the caller, never `Date.now()`, so replaying a world compresses it identically.

`HIGH_IMPORTANCE_RETENTION` is 0.7 on the 0..1 scale Canon validates: far enough above the
midpoint that a merely notable event still folds, below the ceiling so "important" does not come
to mean "singular". Any number here is a judgement. What keeps the guarantee honest is that the
constant is the only place the number is written down, and the parity suite *reads* it rather than
restating it — so the checked property tracks whatever the world tunes it to.

Compression is a **fixed point**: compressing an already-compressed corpus folds nothing further.
Age is measured against world time, not against the last run, so a character cannot quietly lose
another slice of their life on every pass. This is checked, because it is the failure mode a
scheduled version of this job would have.

## 4. The five digest kinds

| Kind | Keyed by | Fed by |
|---|---|---|
| `impression` 長期印象 | the character | **every** folded memory |
| `belief` 穩定信念 | the normalized interpretation | folded memories sharing that reading, at least `STABLE_BELIEF_MIN_SUPPORT` of them |
| `relationship` 角色關係摘要 | the other participant | folded memories from events they were also in |
| `arc` Story Arc 理解 | the arc id | folded memories from events in that arc |
| `location` 地點經驗 | the location id | folded memories from events there |

Only `impression` is unconditional. The other four are keyed on a fact the event may not carry —
a solo event has no other participant, and not every event has a location — so none of them can
carry the coverage guarantee, and `impression` is why the union in property 1 can be total. The
suite asserts that separately, so if the impression ever stops being total the partition check is
not left measuring an accident.

A belief is stable because the same reading **recurs**, not because it is held strongly. Three is
the smallest support that can show a pattern across separate occasions; two is how a character
describes one incident and its immediate aftermath. Matching is case- and whitespace-insensitive
and nothing stronger — no stemming, no synonyms. An inference engine there would invent agreement
the character never expressed, and would need a language to be tuned for, which the world does not
commit to.

## 5. Digest text is a template, never model output

`summary` is a format string over numbers this module computed. A summarizing LLM would read
better and would break two invariants at once: a provider would be **producing** cognition state
rather than proposing an event for Canon to accept, and the same corpus would stop compressing to
the same digest — so properties 1 and 3 would no longer be checkable at all.

Every aggregate a digest reports is a plain statistic over its `sourceMemoryIds`, so a reader who
distrusts the digest can recompute it from the expansion. One test does exactly that rather than
comparing against a literal.

## 6. The caller passes a narrowed event context

Relationship, arc and location digests need facts a `CharacterMemoryRecord` does not carry: who
else was there, which arc the event belongs to, where it happened. Reading them here would mean
importing the Accepted Event log and the story projection, and `knowledge` may not depend on
`story` at all (`architecture/module-boundaries.json`). So the caller supplies them — the same
shape of contract `retrieveAuthorizedMemories` already uses for `arcRelevantEventIds`.

The contract is deliberately **exact** rather than permissive. A context for an event this
character has no memory of is *rejected*, not ignored:

| Input | Rejected with |
|---|---|
| a memory belonging to another character | `MEMORY_ACCESS_DENIED` |
| an event context no supplied memory refers to | `MEMORY_COMPRESSION_INPUT_INVALID` |
| a context whose participants exclude the character | `PARTICIPANT_MISMATCH` |
| a memory whose event context is missing | `UNKNOWN_EVENT_REFERENCE` |
| a duplicated memory id or event context | `MEMORY_COMPRESSION_INPUT_INVALID` |
| a fractional or negative horizon, a negative world day, an empty character id | `MEMORY_COMPRESSION_INPUT_INVALID` |

Ignoring a surplus context would be safe for the *output* — nothing unreferenced can reach a
digest — but it would let a caller hand over event metadata for events the character never
witnessed and never learn they had done so. Rejecting makes the narrowing checkable at the
boundary instead of assumed inside it.

Every one of those rejections happens **before** any digest is built, and every one is covered by
a case that also asserts the input is unchanged. The inputs in those cases are deeply frozen, so a
mutation would throw rather than be missed by an assertion nobody wrote. That is AC#4: a failed
compression produces nothing and changes nothing.

## 7. The internal query

`internal.knowledge.memoryQueries.compressCharacterMemoryHistory` is the only callable surface,
and it is an `internalQuery` — a **read**. Private memory has no public function boundary, exactly
as FR-E002 and FR-E003 already require, so no public read path can reach a digest and no LLM call
can be triggered by one.

It authorizes the requester against the memory owner through the same `authorizeMemoryRead` as
FR-E003, then narrows the replayed events down to the ones the character actually remembers before
handing them over. Because the pure function rejects a wider context than that, an accidental
widening in the query fails loudly instead of quietly passing other people's scenes into a
digest builder.

Arc membership arrives as an argument for the module-boundary reason in §6.

## 8. Relationship to RISK-003

RISK-003 (infinite growth of retained history) was already mitigated for prompt size by FR-E003:
bounded retrieval caps what reaches a model regardless of how much history exists. This adds the
other half — the working corpus itself stops growing without bound, because everything old and
unremarkable collapses into a fixed number of digests keyed by character, belief, companion, arc
and location. It does not shrink storage, and it was never going to: Canon is append-only, and
that is the invariant that makes the rest of this document true.
