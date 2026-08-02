# World Configuration Import

ART-5 implements FR-A001 with the versioned `WorldConfigurationV1` contract in
`convex/canon/worldConfig.ts`. The administrative entry point is the Convex
`internalMutation` named `canon/worldConfig:importWorld`; public clients cannot invoke it.

## Required structure

Schema version 1 requires:

- `contentDeclaration`: `fictionalWorld: true` and `containsRealPersonData: false`;
- `world`: stable id, name, description, background, era, technology level, ISO start
  date, and non-empty geography/social/law/taboo rule lists;
- `locations`: positive capacity, activity state, and valid location connections;
- `organizations`: optional headquarters referencing an imported location;
- `immutableRules`: narrative rules or typed Canon enforcement for forbidden event types
  and maximum event participants;
- `history`: dated initial history whose location/organization references exist and whose
  date is not after world start.

Unknown fields, unsupported versions, empty required values, duplicate identifiers,
non-fictional declarations, invalid references, invalid enforcement unions, and repeat
world imports fail with stable `WorldImportError.code` values.

## Atomicity and Canon integration

The pure parser validates the entire document and builds a `WorldImportPlan` before any
write. The internal Convex mutation writes the definition, locations, organizations,
immutable rules, history, and sequence `-1` Initial Snapshot in one Convex transaction;
an exception rolls back the whole transaction. The offline reference adapter stages all
rows and includes injected-failure tests proving no partial world becomes visible.

The Canon commit store loads `worldImmutableRules` for the target world and passes them to
`validateCanon`. The same stored rule context is also available through the internal
`canon/worldConfig:getCanonRuleContext` query. Immutable rule violations use the stable
`IMMUTABLE_WORLD_RULE_VIOLATION` Canon error code.

Character/persona, relationship, knowledge, secret, and asset seed records are added by
ART-6 after this atomic world foundation exists; final 12–20-character Mistwood content is
owned by ART-77.

## Verification

```bash
npm test -- --runInBand --runTestsByPath \
  convex/canon/worldConfig.test.ts \
  convex/canon/commit.test.ts \
  convex/canon/validators.test.ts
npm run check
```
