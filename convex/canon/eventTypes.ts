/**
 * Canonical event classification — string-literal unions, their value sets, and
 * runtime type guards used by structural validation.
 *
 * Pure module: no Convex, no network, no clock, no randomness.
 */

/** Ordered slots that make up a world day. */
export const TIME_SLOTS = ['morning', 'noon', 'afternoon', 'evening', 'night'] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number];

/** High-level classification of a proposed world event. */
export const EVENT_TYPES = [
  'conversation',
  'movement',
  'relationship_change',
  'discovery',
  'rumor',
  'world_event',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Source/authority that proposed an event. */
export const PROPOSED_BY_TYPES = ['system', 'director', 'character', 'admin'] as const;
export type ProposedByType = (typeof PROPOSED_BY_TYPES)[number];

/** Visibility levels for a canonical fact. */
export const FACT_VISIBILITIES = ['canon', 'public', 'private'] as const;
export type FactVisibility = (typeof FACT_VISIBILITIES)[number];

export const FACT_SUBJECT_TYPES = ['world', 'character', 'location', 'item'] as const;
export type FactSubjectType = (typeof FACT_SUBJECT_TYPES)[number];

/** State-change discriminator values (single source of truth for the union). */
export const STATE_CHANGE_TYPES = [
  'character_location_changed',
  'relationship_changed',
  'fact_created',
] as const;
export type StateChangeType = (typeof STATE_CHANGE_TYPES)[number];

const TIME_SLOT_SET = new Set<string>(TIME_SLOTS);
const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);
const PROPOSED_BY_TYPE_SET = new Set<string>(PROPOSED_BY_TYPES);
const FACT_VISIBILITY_SET = new Set<string>(FACT_VISIBILITIES);
const FACT_SUBJECT_TYPE_SET = new Set<string>(FACT_SUBJECT_TYPES);
const STATE_CHANGE_TYPE_SET = new Set<string>(STATE_CHANGE_TYPES);

export const isTimeSlot = (v: unknown): v is TimeSlot =>
  typeof v === 'string' && TIME_SLOT_SET.has(v);
export const isEventType = (v: unknown): v is EventType =>
  typeof v === 'string' && EVENT_TYPE_SET.has(v);
export const isProposedByType = (v: unknown): v is ProposedByType =>
  typeof v === 'string' && PROPOSED_BY_TYPE_SET.has(v);
export const isFactVisibility = (v: unknown): v is FactVisibility =>
  typeof v === 'string' && FACT_VISIBILITY_SET.has(v);
export const isFactSubjectType = (v: unknown): v is FactSubjectType =>
  typeof v === 'string' && FACT_SUBJECT_TYPE_SET.has(v);
export const isStateChangeType = (v: unknown): v is StateChangeType =>
  typeof v === 'string' && STATE_CHANGE_TYPE_SET.has(v);
