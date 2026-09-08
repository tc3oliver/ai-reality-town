/**
 * FR-G004 / §16.2 — the operator's explicit, reviewable exclusion of a high-importance Accepted
 * Event from the public record (ART-89).
 *
 * ## What was missing
 *
 * §16.2 reads 「至少 95% 的高重要度 Accepted Event 由已發布 recap 覆蓋，**或帶有明確、可審查的排除理由**」.
 * ART-35 shipped the type (`CoverageExclusion`), the candidate field (`declaredExclusions`) and the
 * check (`COVERAGE_EXCLUSION_UNJUSTIFIED`). It shipped no storage and no writer: every caller in the
 * repository passed `declaredExclusions: []`, so the check was unreachable and the second half of
 * the clause was satisfied by nothing at all. This module is the missing half.
 *
 * ## The rules, and why each is a refusal rather than a normalisation
 *
 *  - **A reason is required and must not be blank.** The clause's whole content is 「明確、可審查」;
 *    an exclusion without a reason is an omission with a note attached. Refused with
 *    `COVERAGE_EXCLUSION_INVALID` rather than stored and reported later, because a stored blank
 *    would already have removed the event from the coverage denominator by the time anyone read it.
 *  - **The event must be accepted.** An exclusion naming an event Canon never accepted excuses
 *    nothing; refusing keeps the exclusion set a subset of the denominator it reduces.
 *  - **Append-only, one row per `(worldId, eventId)`.** Re-declaring the same exclusion is a no-op
 *    that returns the stored row, so a retried operator action cannot create a second reason for
 *    one omission. A DIFFERENT reason for an already-excluded event is refused: the record of why
 *    something was left out of the public account must not be editable in place, for the same
 *    reason accepted Canon is not.
 *
 * ## It never touches Canon
 *
 * The event stays accepted, stays in Canon and stays in the world. The row records only that a
 * named operator said, in words, why it is not in a recap. `convex/quality/storyQuality.ts` reads
 * it and reports the excluded count and its reason beside the coverage rate rather than folding
 * exclusions into the numerator: a world that excluded everything must not report full coverage.
 */

/** Every reason must survive review, so it is bounded and non-blank rather than free-form. */
export const MIN_EXCLUSION_REASON_LENGTH = 8;
export const MAX_EXCLUSION_REASON_LENGTH = 500;

export class CoverageExclusionError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'CoverageExclusionError';
  }
}

export type CoverageExclusionRecord = {
  schemaVersion: 1;
  worldId: string;
  worldDay: number;
  eventId: string;
  reason: string;
  operatorId: string;
  createdAt: number;
};

export type CoverageExclusionRequest = {
  worldId: string;
  worldDay: number;
  eventId: string;
  reason: string;
  operatorId: string;
  createdAt: number;
};

/**
 * Validate a declaration and return the row to store. Pure: the caller does the reading and the
 * writing, so the rules are testable without a deployment.
 */
export function buildCoverageExclusion(request: CoverageExclusionRequest): CoverageExclusionRecord {
  const reason = request.reason.trim();
  if (request.worldId.trim().length === 0 || request.eventId.trim().length === 0
      || request.operatorId.trim().length === 0) {
    throw new CoverageExclusionError('COVERAGE_EXCLUSION_INVALID', 'world, event and operator are required');
  }
  if (!Number.isSafeInteger(request.worldDay) || request.worldDay < 0 || !Number.isFinite(request.createdAt)) {
    throw new CoverageExclusionError('COVERAGE_EXCLUSION_INVALID', 'world day and creation time must be valid');
  }
  if (reason.length < MIN_EXCLUSION_REASON_LENGTH || reason.length > MAX_EXCLUSION_REASON_LENGTH) {
    throw new CoverageExclusionError('COVERAGE_EXCLUSION_INVALID',
      `an exclusion reason must be ${MIN_EXCLUSION_REASON_LENGTH}-${MAX_EXCLUSION_REASON_LENGTH} characters`);
  }
  return {
    schemaVersion: 1,
    worldId: request.worldId,
    worldDay: request.worldDay,
    eventId: request.eventId,
    reason,
    operatorId: request.operatorId,
    createdAt: request.createdAt,
  };
}

/**
 * Decide what to do when the event is already excluded.
 *
 * The same reason is idempotent; a different one is refused. Editing why a high-importance event
 * was kept out of the public account would rewrite the reviewable record the clause exists to
 * create — a second declaration is a new decision and belongs to whatever process supersedes the
 * first, not to a patch.
 */
export function reconcileCoverageExclusion(
  existing: CoverageExclusionRecord,
  next: CoverageExclusionRecord,
): { deduplicated: true } {
  if (existing.reason !== next.reason) {
    throw new CoverageExclusionError('COVERAGE_EXCLUSION_CONFLICT',
      `event ${existing.eventId} is already excluded with a different reason`);
  }
  return { deduplicated: true };
}
