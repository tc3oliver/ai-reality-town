# Mistwood production seed

`convex/canon/mistwoodSeed.ts` is the versioned, production-intended seed for the
single MVP public world. It is distinct from `mistwoodFixture.ts`, which remains a
small deterministic test fixture and is never a public-world registration.

## Contents

Seed version 1 provides:

- eight connected principal locations;
- three fictional organizations and three historical events;
- twelve fictional principal residents with complete Persona, public/private goals,
  fears, behavior rules, initial locations, affiliations, secrets, knowledge, assets,
  and directional relationships;
- twelve source-owned secrets and two explicit false beliefs;
- three interest conflicts, two resource dependencies, two emotional tensions, a
  town-wide mistaken account of the station flood, and the launchable “Station
  Ledger” Story Arc.

The seed is consumed through the existing validated, atomic world and character
import contracts. It does not bypass their runtime validation or partial-write
protection. The initial-tension profile likewise runs through the normal readiness
validator before warmup may begin.

## Public-world isolation

`convex/canon/publicWorldRegistry.ts` is the fail-closed MVP registration boundary.
It contains exactly one entry, `mistwood`. Unknown, fixture, test, and warmup IDs
resolve to `null`; later public read-model and routing work must consume this registry
instead of enumerating imported worlds.

## Safety and verification

Both content declarations explicitly state that the world and residents are
fictional and contain no real-person data. The full serialized seed is checked by
the deterministic pre-generation safety policy. No production deployment is
performed by this seed task.

Run the end-to-end seed checks with:

```bash
npm test -- --runTestsByPath convex/canon/mistwoodSeed.test.ts
```

The suite exercises the real parsers and atomic in-memory import adapters, all seven
readiness thresholds, safety review, duplicate/failure behavior, and public routing
isolation.
