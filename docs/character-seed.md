# Primary Character Seed

ART-6 implements FR-A002 with `CharacterSeedBundleV1` in
`convex/canon/characterSeed.ts`. It is applied only after the atomic world configuration
exists. The Convex entry point `canon/characterSeed:seedWorldCharacters` is an
`internalMutation`; browsers and other public callers cannot invoke it.

## Contract

A bundle contains 12–20 primary fictional characters. Every character requires:

- public and private profiles;
- personality traits, values, public goal, private goal, fear, and behavior rules;
- an existing initial location and valid organization references;
- at least one personal secret they initially know;
- at least one initial knowledge record and owned asset;
- participation in at least one initial relationship.

Secrets require one or more valid initial knowers. Knowledge records reference valid
characters and normalize source type, source reference, and learned world day so even
initial beliefs retain provenance. Assets reference valid characters. Directional relationships contain trust, affection, resentment, fear,
dependency, familiarity, and visibility. A reciprocal pair is valid because the two
directions may differ; duplicate `(sourceCharacterId, targetCharacterId)` pairs,
self-relationships, unknown characters, and out-of-range dimensions are rejected.

The root declaration must state `fictionalCharacters: true` and
`containsRealPersonData: false`, and every default character must set `fictional: true`.
This makes real-person/default-PII seeds invalid at the runtime boundary; content safety
and later operator review remain independent release gates.

## Atomicity

Parsing and all cross-reference checks finish before writes. The internal mutation loads
the world/location/organization reference set, rejects repeated seeds, then inserts
characters, secrets, knowledge, assets, and relationships in one Convex transaction.
The offline adapter stages the complete plan and has injected mid-write failure tests
that prove no partial character state becomes visible.

Final authored Mistwood names and biographies are owned by ART-77; ART-6 uses fictional
test residents to prove the reusable 12–20-character contract without prematurely
locking product content.

## Verification

```bash
npm test -- --runInBand --runTestsByPath convex/canon/characterSeed.test.ts
npm run check
```
