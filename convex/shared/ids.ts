/**
 * Pure identifier / key derivation helpers for the Canon domain.
 *
 * No randomness, no clock, no I/O. Everything here is deterministic so that the
 * reducer and replay produce identical output for identical input.
 */

export type WorldId = string;
export type EventId = string;
export type IdempotencyKey = string;
export type TraceId = string;
export type CharacterId = string;
export type LocationId = string;

/**
 * Deterministic, **directional** relationship key for a pair of characters.
 *
 * Relationships are directional (A's trust of B may differ from B's trust of A), so
 * the source character always precedes the target. The format is fixed.
 */
export function relationshipKey(
  sourceCharacterId: string,
  targetCharacterId: string,
): string {
  return `${sourceCharacterId}|${targetCharacterId}`;
}

/**
 * Deterministic event id derived from the world and its monotonic sequence number.
 * Used by the commit step so that an accepted event always has a stable identity.
 */
export function deriveEventId(worldId: string, sequenceNumber: number): EventId {
  return `${worldId}#event#${sequenceNumber}`;
}

/** Empty trace id sentinel used when no trace is provided. */
export const EMPTY_TRACE_ID = 'trace:none';
