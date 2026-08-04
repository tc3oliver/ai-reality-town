# Audited Canon Correction Workflows (FR-K003)

An operator can fix accepted Canon **only by appending a new event**. Accepted history is
never edited and never deleted — the canon store exposes no update and no delete
operation, so the fix and the mistake both stay in the log forever.

- Policy + orchestration (pure, unit tested): `convex/operations/canonCorrection.ts`
- Convex wiring (caller-facing `mutation`s): `convex/operations/canonCorrectionFunctions.ts`
- Event-type classification: `convex/canon/eventTypes.ts`
- Canon rules: `convex/canon/validators.ts`
- Integration test: `convex/operations/canonCorrection.test.ts`
- Architecture rule: `docs/architecture/adr/ADR-0002-append-only-canon-events.md`

## 1. Three remediation types, three contracts

| Type | Command | Capability | Claims the cited events were wrong | May overrule forward-only canon rules | Must restate public content |
| --- | --- | --- | --- | --- | --- |
| `correction` | `createCorrectionEvent` | `canon.correct` | yes — it supersedes what they said | yes | no |
| `compensation` | `createCompensationEvent` | `canon.compensate` | no — their account still stands; it only offsets state going forward | no | no |
| `retcon` | `createRetconEvent` | `canon.retcon` | yes — it rewrites the canonical account | yes | **yes**, a `publicSummary` is required |

Choose by intent:

- **Correction** — the record is factually wrong. "He-jun never died; the report named
  the wrong villager."
- **Compensation** — the record is right, but the world must be made whole. "The transfer
  really happened, and we are transferring the item back."
- **Retcon** — the story itself is being rewritten and the audience must be told. It is
  the heaviest remediation, so it is the only one that cannot be applied silently.

"Forward-only canon rules" are the two rules that describe the world moving forward and
therefore cannot bind a statement about the past: a dead character may not participate in
an event, and a life state may not be restored. A `correction`/`retcon` is exempt
(`SUPERSEDING_EVENT_TYPES` in `convex/canon/eventTypes.ts`); a `compensation` is not.
Every other canon rule — reference existence, preconditions, per-event uniqueness,
immutable world rules — applies to all three unchanged.

## 2. What every remediation must carry

Structural validation refuses a remediation that is not proposed by an administrator or
that cites no prior event, and canon validation refuses one that cites an event the world
never accepted. On top of that, `buildRemediationEvent` requires:

- a non-empty **operator identity** (stamped as `proposedBy.id`),
- a non-empty **reason**,
- at least one **cited event id**, without duplicates,
- a **`publicSummary`** when the type is `retcon`,
- a caller-supplied **`idempotencyKey`**, so a retried submission returns the original
  remediation instead of appending a second one.

## 3. Who and why, recorded twice

```
metadata.remediation = {
  schemaVersion: 1, type, operatorId, reason,
  targetEventIds, supersedes, offsets
}
```

That block is stamped onto the accepted event, so it is immutable for as long as the
event exists. The same operator, capability, reason, and cited events are ALSO written to
the `operatorAuditLog` row in the same transaction as the commit (the ART-48 trail
described in `docs/simulation-operations-console.md`). A remediation therefore cannot
exist without an attributable operator and a stated reason (FR-K003 AC#2, AC#5), and a
refused remediation writes neither the event nor the audit row.

## 4. Replay stays consistent

The remediation is committed through the shared `commitProposedEvent` pipeline and gets
its own sequence number. Replay reads the same events in the same order and reaches the
same projection every time; the superseded event still contributes its original state
change, and the remediation applies after it. Nothing is rewritten, so there is no
"replay before/after" divergence to reconcile (FR-K003 AC#3).

## 5. Public content follows the correction

After the commit, the command runs ART-98's `runPostCommitPipeline` for the sequence
number it just allocated — the exact post-commit pipeline every simulated event runs
(`docs/post-commit-pipeline.md`). The world, character, relationship, arc, primer,
episode, timeline, live, and onboarding read models are rebuilt from the corrected
history and republished, so public pages reflect the correction with no generation on the
read path (FR-K003 AC#4). There is no second refresh path.

A post-commit stage failure is recorded on the run and retried by the next call; it never
rolls the accepted remediation back, and public pages keep serving their last-known-good
content until the replacement publishes.

## 6. Example

```bash
npx convex run operations/canonCorrectionFunctions:createRetconEvent '{
  "worldId": "mistwood",
  "operatorId": "ops-admin",
  "operatorToken": "<ops token>",
  "reason": "the mill report named the wrong villager",
  "targetEventIds": ["mistwood#event#42"],
  "idempotencyKey": "retcon-mill-collapse-1",
  "worldDay": 4,
  "timeSlot": "morning",
  "participantIds": ["he-jun"],
  "publicSummary": "He-jun survived the mill collapse after all.",
  "stateChanges": [
    { "type": "character_life_changed", "characterId": "he-jun", "alive": true,
      "reason": "the death was recorded in error" }
  ]
}'
```
