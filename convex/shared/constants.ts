/**
 * Foundation-wide numeric/limit constants and validation versions.
 *
 * Pure module: no Convex, no network, no clock, no randomness.
 * The typed string unions (TimeSlot, EventType, …) live in `convex/canon/eventTypes.ts`.
 */

/** Canonical event schema version produced and accepted by this codebase. */
export const CANON_SCHEMA_VERSION = 1 as const;

/** Schema versions accepted by structural validation / the reducer. */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1];

/**
 * Tag stored on every accepted event to record which validation rule set accepted it.
 * Business logic must never branch on free text — compare against this constant.
 */
export const CANON_VALIDATION_VERSION = 'canon-v1' as const;

export const RELATIONSHIP_MIN = -100;
export const RELATIONSHIP_MAX = 100;

export const MAX_PUBLIC_SUMMARY_LENGTH = 280;
export const MAX_PARTICIPANTS = 16;
export const MAX_STATE_CHANGES = 32;
export const MAX_CAUSED_BY_EVENT_IDS = 32;
