# Proposed-Event Review (FR-K002, NFR-005)

Event review is the **authenticated, authorized, read-only** surface that shows an
operator why a proposed event was accepted, rejected, or withheld. It is a
companion to the [simulation operations console](./simulation-operations-console.md)
(FR-K001) and deliberately **not** part of the public read path.

- Pure derivation + redaction (unit tested): `convex/operations/proposalReview.ts`
- Durable-record assembly (integration tested): `convex/operations/proposalReviewStore.ts`
- Convex wiring (caller-facing `query`): `convex/operations/proposalReviewFunctions.ts`

## 1. Surface

| Function | Kind | Purpose | Minimum role |
| --- | --- | --- | --- |
| `listProposedEventReviews` | `query` | Reviewable proposals for a world, filtered and bounded | `viewer` |
| `reviewProposedEvent` | `query` | One proposal, addressed by its idempotency key | `viewer` |

Both authorize through the **same** gate as the operations console: the
`SIMULATION_OPS_OPERATORS` registry, the `viewer < operator < admin` role order,
the identity-then-ops-token principal resolution, and the uniform
`OPS_UNAUTHORIZED` denial. Review is a read, so it is gated on the existing
`world.inspect` capability rather than a new one — a role that may already
inspect world state is the role that may read why an event was accepted.

Review never mutates, so it appends no `operatorAuditLog` row: that table records
privileged *mutations*, and a read that logged would let any caller grow the
audit trail. Reads remain observable in the Convex function logs.

## 2. What one review record contains

Every FR-K002 bullet maps to a field, and every field comes from a record the
pipeline already wrote. Review adds **no table, no pipeline write, and no
re-execution** of validation, safety, or the model: an operator must see what
actually happened, not a fresh re-judgement of it.

| FR-K002 field | Record field | Source of truth |
| --- | --- | --- |
| Proposed Event | `proposedEvent` | `sceneSimulationRuns.result.output.proposedEvents` (ART-30) |
| Validation Result | `validationResult` | presence of a `canonEvents` row for the proposal's idempotency key |
| Rejection Reason | `rejectionReasonCode`, `rejectionStage` | `worldDayRuns.errorCode` / `failureStage`, or the safety reason codes |
| Model Trace | `modelTrace`, `providerTrace` | `llmTraces` (ART-57) + the scene's provider accounting |
| Participant | `participantIds` | proposal participants ∪ scene participants |
| State Changes | `stateChanges` | the proposal's own `stateChanges` |
| Related Arc | `relatedArcIds` | scene `arcIds` ∪ `storyArcEventClassifications` memberships |
| Safety Label | `safety` | `sceneSimulationRuns.result.safety` (ART-54/ART-55) |

`commit` carries the accepted event's canonical `eventId`, `sequenceNumber`,
`validationVersion`, `traceId`, and `acceptedAt` once the proposal reached Canon.

## 3. Disposition

Exactly one disposition applies to a proposal at any instant, and the precedence
encodes what the pipeline actually did:

| Disposition | Validation Result | When |
| --- | --- | --- |
| `committed` | `accepted` | a `canonEvents` row exists for the idempotency key |
| `withheld` | `not_run` | post-generation safety refused the scene, so Canon validation never ran |
| `rejected` | `rejected` | the slot's world-day run recorded a failure and nothing committed |
| `pending` | `not_run` | still in flight |

Accepted Canon wins outright: a slot can fail *after* one proposal committed, and
accepted history is never re-judged by a review surface.

## 4. Stable reason codes (AC#3)

A rejection is reported as the machine code the producing layer already recorded —
a `CanonErrorCode` such as `TELEPORTATION_NOT_ALLOWED`, an orchestration code, or
a safety reason code such as `EXTREME_VIOLENCE_DETAIL`. This surface **never**
reads, parses, or pattern-matches a free-text error message, so the console cannot
grow a second, drifting classification of "why".

A recorded value is accepted only when it is bounded `SCREAMING_SNAKE_CASE`.
Anything else is reported as `UNCLASSIFIED_REJECTION`; a scene withheld by safety
with no recorded category is reported as `SAFETY_REVIEW_REQUIRED`. Reporting a
placeholder is deliberate — inventing a specific code from a message would be
exactly the classification logic AC#3 forbids. Free-text `errorMessage` values are
never returned.

## 5. Secret safety and redaction (AC#2)

The ART-57 trace record is incapable of holding a prompt, a response body, or a
secret: its write boundary rejects those fields outright. Review projects it
further, by the **authenticated principal's role** — never by caller input:

| Role | Model Trace | Proposal metadata |
| --- | --- | --- |
| `viewer` | ART-57 public projection (`traceId`, `worldId`, `worldDay`, `finalStatus`) | omitted entirely |
| `operator`, `admin` | full accounting record (model, prompt version, tokens, latency, retries) | sensitive keys scrubbed |

Proposal `metadata` is the only free-form provider JSON on this surface, so it is
the one place a provider could smuggle a prompt or a key into an operator
response. It is scrubbed recursively with ART-57's own sensitive-key predicate
(`isSensitiveTraceKey`), imported rather than reimplemented so the rule cannot
drift. An unreadable safety decision fails closed to `human_review_required`.

## 6. Filters

`listProposedEventReviews` filters server-side on already-structured fields —
never on free text: `worldDay`, `timeSlot`, `sceneId`, `eventType`,
`disposition`, `validationResult`, `safetyLabel`, `reasonCode` (matches the
rejection code or any safety reason code), `participantId`, and `arcId`. Filters
combine conjunctively.

Results are ordered newest world time first (world day, then slot position, then
idempotency key for determinism) and bounded to `limit` (default 50, max 200),
the same bounds the console's audit list uses.

## 7. Example

```bash
# All withheld proposals for a world day, as an operator using the bootstrap token.
npx convex run operations/proposalReviewFunctions:listProposedEventReviews \
  '{"worldId":"mistwood","worldDay":3,"disposition":"withheld",
    "operatorId":"ops-runner","operatorToken":"<token>"}'

# One proposal in full.
npx convex run operations/proposalReviewFunctions:reviewProposedEvent \
  '{"worldId":"mistwood","idempotencyKey":"mistwood:3:noon:1",
    "operatorId":"ops-runner","operatorToken":"<token>"}'
```

## 8. Tests

- `convex/operations/proposalReview.test.ts` — disposition precedence, stable
  reason codes (including that free text is never classified or surfaced),
  role-based trace redaction, metadata scrubbing, filtering, page bounds, and
  uniform denial through the ART-48 gate.
- `convex/operations/proposalReviewStore.test.ts` — end-to-end assembly of
  committed / rejected / withheld / pending records against an in-memory Convex
  `db` double, including arc union, trace correlation, world scoping, and
  fail-closed safety.
