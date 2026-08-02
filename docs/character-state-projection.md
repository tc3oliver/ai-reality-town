# Event-derived character state

ART-9 implements PRD 1.0 `FR-B001`. Character current state is a deterministic projection
of ordered Accepted Events; providers and LLMs can only submit a versioned Proposed Event
and cannot write projection fields.

The unified `CharacterCurrentState` contains current location; health, emotion, finance,
occupation, organization memberships, availability, alive/active status, and the
Accepted Event that most recently updated the record.

Location and life events update both their specialized indexes and the unified state. A
death transition always sets `alive=false` and `active=false`. Other fields use the typed
`character_state_changed` union with a selected field, optional prior value, required new
value, and non-empty reason. Validation enforces field-specific types, participant and
character references, organization references, prior-state consistency, one update per
character/field/event, and rejects no-op or contradictory death updates.

The reducer exhaustively handles the union and snapshots deep-clone membership arrays,
so full replay and snapshot replay reconstruct identical state. Raw Canon event,
world-projection, snapshot, and character-state queries are internal-only; later public
read-model tasks publish an explicit privacy-filtered subset.

`characterState.test.ts` covers every required field, deterministic replay, invalid
types/reasons/references/preconditions, contradictory updates, and attempted direct
projection overwrite. `reducer.purity.test.ts` includes the new union in the exhaustive
supported-version property test.

```bash
npm test -- --runInBand convex/canon/characterState.test.ts convex/canon/reducer.purity.test.ts convex/canon/replay.test.ts
npm run check
```
