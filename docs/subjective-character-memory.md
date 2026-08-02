# Subjective character memory

ART-25 implements FR-E002 as an event-derived cognition projection. A provider may
propose `character_memory_formed`, but the memory exists only after its containing event
passes validation and becomes an Accepted Event.

Each memory contains subjective content and interpretation, importance (0–1), emotional
weight (-1–1), confidence (0–1), visibility, character identity, deterministic memory
ID, source event ID, and created world time. The reducer derives provenance from the
accepted containing event; providers cannot forge it.

Memory and Canon Fact are separate projection fields. Multiple participants in one
event may remember it differently, including interpretations that contradict Canon.
Those interpretations never modify facts.

Memory reads use an internal Convex query. Characters may read only their own memories;
operations may inspect a target ledger. There is no public query, and returned/snapshot
records are cloned. Later editorial publication must explicitly select safe material;
private memory is not directly exposed.

## Verification

```bash
npm test -- --runInBand convex/knowledge/subjectiveMemory.test.ts
npm run check
```
