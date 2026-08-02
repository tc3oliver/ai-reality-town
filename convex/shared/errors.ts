/**
 * Stable Canon error codes and error shape.
 *
 * Pure module. Business logic must decide error handling by `code`, never by
 * parsing free-text messages.
 */

export type CanonErrorCode =
  | 'INVALID_EVENT_SHAPE'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'DUPLICATE_IDEMPOTENCY_KEY'
  | 'LOCATION_PRECONDITION_FAILED'
  | 'DUPLICATE_CHARACTER_MOVEMENT'
  | 'INVALID_RELATIONSHIP_TARGET'
  | 'INVALID_RELATIONSHIP_DELTA'
  | 'PARTICIPANT_MISMATCH'
  | 'INVALID_FACT_SUBJECT'
  | 'SEQUENCE_CONFLICT'
  | 'SEQUENCE_GAP'
  | 'DUPLICATE_SEQUENCE'
  | 'IMMUTABLE_WORLD_RULE_VIOLATION'
  | 'TELEPORTATION_NOT_ALLOWED'
  | 'CHARACTER_ALREADY_MOVED_THIS_SLOT'
  | 'DEAD_CHARACTER_ACTION'
  | 'KNOWLEDGE_SOURCE_MISSING'
  | 'INVALID_KNOWLEDGE_CORRECTION'
  | 'KNOWLEDGE_ACCESS_DENIED'
  | 'ITEM_OWNERSHIP_CONFLICT'
  | 'UNKNOWN_CHARACTER_REFERENCE'
  | 'UNKNOWN_LOCATION_REFERENCE'
  | 'UNKNOWN_ITEM_REFERENCE'
  | 'UNKNOWN_EVENT_REFERENCE'
  | 'INVALID_LIFE_STATE_CHANGE'
  | 'SNAPSHOT_CORRUPT'
  | 'UNSUPPORTED_SNAPSHOT_VERSION'
  | 'SNAPSHOT_DAY_CONFLICT'
  | 'RECOVERY_HEAD_CONFLICT'
  | 'INVALID_CHARACTER_STATE_CHANGE'
  | 'CHARACTER_STATE_PRECONDITION_FAILED'
  | 'UNKNOWN_ORGANIZATION_REFERENCE';

export type CanonValidationError = {
  code: CanonErrorCode;
  message: string;
  path?: string;
  details?: Record<string, unknown>;
};

/**
 * Error thrown by the canon domain. Carries a structured {@link CanonValidationError}
 * so callers (commit, workflow, tests) can branch on a stable `code`.
 */
export class CanonError extends Error {
  readonly error: CanonValidationError;

  constructor(error: CanonValidationError) {
    super(`[${error.code}] ${error.message}`);
    this.name = 'CanonError';
    this.error = error;
  }
}

export function canonError(
  code: CanonErrorCode,
  message: string,
  details?: Record<string, unknown>,
  path?: string,
): CanonValidationError {
  return { code, message, details, path };
}

/** True if the thrown value is a {@link CanonError}. */
export function isCanonError(value: unknown): value is CanonError {
  return value instanceof CanonError;
}

/**
 * Serialize a thrown value into a stable {@link CanonValidationError}.
 * Non-CanonError throwables collapse to a generic INVALID_EVENT_SHAPE, preserving
 * the original message in details so context is never lost.
 */
export function toValidationError(thrown: unknown): CanonValidationError {
  if (isCanonError(thrown)) {
    return thrown.error;
  }
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  return {
    code: 'INVALID_EVENT_SHAPE',
    message: 'Unexpected error while validating event',
    details: { originalMessage: message },
  };
}
