/**
 * The durable record of what Canon validation decided about each Proposed Event (ART-90).
 *
 * ## Why this table has to exist
 *
 * FR-M002 asks for a Canon Rejection Rate, and before ART-90 nothing in the deployment could
 * answer it. `commitProposedEvent` throws and writes nothing, so a rejected proposal leaves no
 * trace in Canon — deliberately, and that is right: Canon is the accepted log. The evidence lived
 * only in the run tables, and all three lose it in different ways:
 *
 *  - `worldDayRuns` is PATCHED per attempt, so a retry overwrites the previous code;
 *  - `scheduledSlots.errorCode` is CLEARED on retry, so a rate built on it undercounts by
 *    construction;
 *  - `worldDayCheckpoints` appends per `(runId, stage, attempt)` — the only durable per-attempt
 *    record — but it holds ONE code for a stage that may have validated a dozen proposals, because
 *    both validation stages throw on the first failure.
 *
 * So a rejection rate over those tables would have a slot-shaped denominator and a
 * first-failure-shaped numerator. This table gives it a PROPOSAL-shaped one.
 *
 * ## The stages still throw on the first failure
 *
 * Recording is not a behaviour change to the commit path. `validate_structured_output` and
 * `validate_canon` now validate every proposal, record what each verdict was, and then throw on
 * the first rejection exactly as before — so no proposal is committed that would not have been,
 * and no slot survives that would not have. What changes is only that the verdicts survive.
 *
 * ## Exactly-once
 *
 * Keyed on `(worldId, idempotencyKey, stage)`. A Proposed Event's idempotency key is derived from
 * its scene, which is derived from `(worldId, worldDay, timeSlot)`, so a retried slot re-derives
 * the same keys and re-records the same verdicts — insert-if-absent, so the rate counts logical
 * proposals rather than attempts. A retry that reaches a DIFFERENT verdict for one key is a real
 * event and is recorded as a conflict rather than silently overwriting: validation is a pure
 * function of the proposal and the projection, so the same key reaching two verdicts means the
 * projection moved under it, which is exactly what an operator needs to see.
 *
 * ## No payload, ever
 *
 * A row carries the key, the stage, the verdict, a stable error code and the scene it came from.
 * It never carries the proposal, its state changes or its public summary: a rejected proposal's
 * content is the thing FR-M002's "without exposing secrets" clause is about, and the surest way
 * not to expose it is not to store it.
 */

import type { CanonErrorCode } from '../shared/errors';

/** Which validation gate produced the verdict. */
export const VALIDATION_STAGES = ['structural', 'canon'] as const;
export type ValidationStage = (typeof VALIDATION_STAGES)[number];

export const VALIDATION_OUTCOMES = ['accepted', 'rejected'] as const;
export type ValidationOutcome = (typeof VALIDATION_OUTCOMES)[number];

export type ProposalValidationRecord = {
  schemaVersion: 1;
  worldId: string;
  worldDay: number;
  timeSlot: string;
  /** The proposal's own identity. Derived from its scene, so a retry re-derives it. */
  idempotencyKey: string;
  /** The scene that proposed it, when the proposal carries one. */
  sceneId: string | null;
  stage: ValidationStage;
  outcome: ValidationOutcome;
  /** A stable Canon error code, or null when the proposal was accepted by this stage. */
  errorCode: CanonErrorCode | null;
  createdAt: number;
};

export type ProposalValidationDraft = Omit<ProposalValidationRecord, 'schemaVersion' | 'createdAt'>;

/** The scene a proposal came from: `metadata.sceneId`, else the idempotency key's own prefix. */
export function proposalSceneId(proposal: {
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): string | null {
  const stamped = proposal.metadata?.sceneId;
  if (typeof stamped === 'string' && stamped.length > 0) return stamped;
  const [prefix] = proposal.idempotencyKey.split(':event:');
  return prefix.length > 0 && prefix !== proposal.idempotencyKey ? prefix : null;
}

export class ValidationOutcomeError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'ValidationOutcomeError';
  }
}

/**
 * Whether an already-stored verdict agrees with a re-derived one.
 *
 * Same verdict: the retry re-derived what the first attempt decided, which is the normal case and
 * a no-op. Different verdict: refused, because the two cannot both be true of one proposal against
 * one projection, and a silent overwrite would erase the more interesting of the two.
 */
export function reconcileValidationOutcome(
  existing: { outcome: string; errorCode: string | null; idempotencyKey: string; stage: string },
  next: { outcome: string; errorCode: string | null },
): { deduplicated: true } {
  if (existing.outcome !== next.outcome || existing.errorCode !== next.errorCode) {
    throw new ValidationOutcomeError('VALIDATION_OUTCOME_CONFLICT',
      `proposal ${existing.idempotencyKey} reached a different ${existing.stage} verdict on a later attempt`);
  }
  return { deduplicated: true };
}
