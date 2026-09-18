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
  'correction',
  'compensation',
  'retcon',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * What proposing an event type requires of its author (ART-209).
 *
 * ## Why this is a table and not three tuples
 *
 * `EVENT_TYPES` says what the world's vocabulary IS; it says nothing about who may speak each word.
 * That second question was answered in two places that had no way to check each other: a hand-written
 * `REMEDIATION_EVENT_TYPES` tuple here, and the `enumOf(EVENT_TYPES)` the whole-scene request handed
 * the model in `convex/simulation/sceneSimulation.ts`. The request therefore offered a scene author
 * `correction`, `compensation` and `retcon` — three types {@link isRemediationEventType} exists
 * specifically to refuse it — and a live slot died on
 * `[INVALID_EVENT_SHAPE] remediation events must be proposed by an administrator`.
 *
 * Deriving both the remediation set and the authoring vocabulary from one table is what makes
 * "exposed is a subset of authorized" hold by construction. Adding an event type forces a decision
 * here, because the `satisfies` clause makes the table exhaustive over `EventType`; there is no
 * second list to forget.
 *
 * - `narrative`   — anything narrating the world forward. No authority beyond authoring is needed.
 * - `remediation` — FR-K003. Ordinary APPENDED events (accepted history is never edited or deleted)
 *   that state the record was wrong, so they must be proposed by {@link REMEDIATION_PROPOSED_BY_TYPE}
 *   and must cite the accepted events they remediate.
 */
export type EventTypeAuthority = 'narrative' | 'remediation';

export const EVENT_TYPE_AUTHORITY = {
  conversation: 'narrative',
  movement: 'narrative',
  relationship_change: 'narrative',
  discovery: 'narrative',
  rumor: 'narrative',
  world_event: 'narrative',
  correction: 'remediation',
  compensation: 'remediation',
  retcon: 'remediation',
} as const satisfies Record<EventType, EventTypeAuthority>;

/**
 * The proposer authority a remediation requires.
 *
 * Named rather than written as a bare `'admin'` in `validators.ts` so that the rule which GRANTS the
 * capability and the rule which decides what an unprivileged author may be offered are the same
 * symbol. `convex/operations/canonCorrection.ts` carries the matching operator-capability policy
 * (`canon.correct` / `canon.compensate` / `canon.retcon`); a scene author holds none of them.
 */
export const REMEDIATION_PROPOSED_BY_TYPE = 'admin' as const;

/** Event types derived from {@link EVENT_TYPE_AUTHORITY}; the union is the table's, not a copy. */
export type RemediationEventType = {
  [K in EventType]: (typeof EVENT_TYPE_AUTHORITY)[K] extends 'remediation' ? K : never;
}[EventType];
export const REMEDIATION_EVENT_TYPES: readonly RemediationEventType[] = EVENT_TYPES.filter(
  (eventType): eventType is RemediationEventType => EVENT_TYPE_AUTHORITY[eventType] === 'remediation',
);

/**
 * The event types an author holding no operator capability may propose (ART-209).
 *
 * This is the set the whole-scene request's `eventType` enum must be drawn from. It is the
 * complement of the remediation set by construction, so the two cannot drift apart, and narrowing
 * the request to it relaxes nothing: Canon's rules are unchanged and the author simply stops being
 * offered words it was never allowed to say.
 */
export type SceneAuthorEventType = Exclude<EventType, RemediationEventType>;
export const SCENE_AUTHOR_EVENT_TYPES: readonly SceneAuthorEventType[] = EVENT_TYPES.filter(
  (eventType): eventType is SceneAuthorEventType => EVENT_TYPE_AUTHORITY[eventType] === 'narrative',
);

/**
 * The remediation types that SUPERSEDE the events they cite: they restate what the
 * canonical record should have said. Because they overrule an earlier statement
 * rather than continue from it, canon validation exempts them from the transition
 * rules that only make sense for events narrating the world forward (a dead
 * character may participate, and a life state may be restored).
 *
 * `compensation` is deliberately absent: it leaves the original event's account
 * standing and only offsets forward-going state, so every normal rule still applies.
 */
export const SUPERSEDING_EVENT_TYPES = ['correction', 'retcon'] as const;
export type SupersedingEventType = (typeof SUPERSEDING_EVENT_TYPES)[number];

/** Source/authority that proposed an event. */
export const PROPOSED_BY_TYPES = ['system', 'director', 'character', 'admin'] as const;
export type ProposedByType = (typeof PROPOSED_BY_TYPES)[number];

/**
 * The proposer values a scene author may claim (ART-209).
 *
 * `admin` is excluded because it is not a source, it is an AUTHORITY: it is the single value that
 * makes {@link REMEDIATION_EVENT_TYPES} pass structural validation. Offering it on an authoring
 * request lets a model assert an operator capability nothing granted it — and the whole-scene
 * request did offer it, alongside the remediation types it unlocks.
 *
 * Every remaining value is a source the world genuinely has: `system` proposes on the world's
 * behalf, `director` on the plan's, `character` on a character's. None of them widens what Canon
 * will accept, which is exactly what makes them safe to offer and `admin` not.
 */
export type SceneAuthorProposedByType = Exclude<ProposedByType, typeof REMEDIATION_PROPOSED_BY_TYPE>;
export const SCENE_AUTHOR_PROPOSED_BY_TYPES: readonly SceneAuthorProposedByType[] =
  PROPOSED_BY_TYPES.filter(
    (proposedByType): proposedByType is SceneAuthorProposedByType =>
      proposedByType !== REMEDIATION_PROPOSED_BY_TYPE,
  );

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
  'character_life_changed',
  'character_knowledge_learned',
  'character_memory_formed',
  'item_transferred',
  'character_state_changed',
  'location_state_changed',
  'organization_state_changed',
  // FR-E005. Four verbs, because the PRD asks for four separable histories: where a rumor came
  // from, how it travelled and mutated, who currently believes what, and what correction is
  // known. Collapsing them into one "rumor_changed" bag would make "A was told, then B doubted"
  // indistinguishable from "A doubted, then B was told" — and the order is the story.
  'rumor_originated',
  'rumor_propagated',
  'rumor_belief_changed',
  'rumor_corrected',
] as const;
export type StateChangeType = (typeof STATE_CHANGE_TYPES)[number];

/**
 * The four rumor verbs (FR-E005), named as a set so the reducer, the validators and the public
 * boundary can ask "is this a rumor change?" without restating the list and drifting.
 */
export const RUMOR_STATE_CHANGE_TYPES = [
  'rumor_originated', 'rumor_propagated', 'rumor_belief_changed', 'rumor_corrected',
] as const;
export type RumorStateChangeType = (typeof RUMOR_STATE_CHANGE_TYPES)[number];

/**
 * What a character currently does with a rumor they hold (FR-E005 「相信」/「否定」).
 *
 * Deliberately NOT a truth value. `KNOWLEDGE_TRUTH_STATUSES` says whether a claim is objectively
 * true; this says whether a character accepts it. A world where those two are the same field is a
 * world where believing something hard enough makes it so.
 */
export const RUMOR_STANCES = ['believes', 'doubts', 'rejects'] as const;
export type RumorStance = (typeof RUMOR_STANCES)[number];

export const KNOWLEDGE_SOURCE_TYPES = [
  'observed', 'told', 'public', 'evidence', 'inference', 'memory',
] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export const KNOWLEDGE_TRUTH_STATUSES = ['true', 'false', 'unknown'] as const;
export type KnowledgeTruthStatus = (typeof KNOWLEDGE_TRUTH_STATUSES)[number];

export const KNOWLEDGE_SHAREABILITIES = ['private', 'trusted', 'public'] as const;
export type KnowledgeShareability = (typeof KNOWLEDGE_SHAREABILITIES)[number];

export const CHARACTER_STATE_FIELDS = [
  'health', 'emotion', 'finance', 'occupation', 'organization_memberships',
  'availability', 'active',
] as const;
export type CharacterStateField = (typeof CHARACTER_STATE_FIELDS)[number];

/**
 * The character state fields whose value is public NARRATIVE TEXT (ART-124).
 *
 * A strict subset of {@link CHARACTER_STATE_FIELDS}, and the distinction is load-bearing in two
 * directions:
 *
 * - `organization_memberships` and `availability` are accepted by Canon but are projected to no
 *   public field at all (`CHARACTER_STATE_FIELD_MAP` in
 *   `convex/publicRead/worldCharacterProjectionFunctions.ts` maps neither). Feeding them to the
 *   post-generation safety classifier would let a string that was never going to be shown
 *   trigger a `withhold` — and a `withhold` drops the ENTIRE scene from Canon, taking its
 *   unrelated location changes, relationship updates and memories with it. Over-scanning here is
 *   not a conservative choice; it destroys content.
 * - `active` IS projected, but it is existence rather than text: a boolean nobody reads as prose.
 *   It is excluded so that neither the classifier nor the projection-side gate ever treats a
 *   deactivation as a sentence under review. See `EXISTENCE_CHARACTER_STATE_FIELDS`.
 *
 * Declared in `canon` because it is the one module both `simulation` (which classifies) and
 * `publicRead` (which projects) may depend on. `worldCharacterProjection.test.ts` pins it against
 * `CHARACTER_STATE_FIELD_MAP` so the two cannot drift.
 */
export const PUBLIC_TEXT_CHARACTER_STATE_FIELDS = [
  'health', 'emotion', 'finance', 'occupation',
] as const;
export type PublicTextCharacterStateField = (typeof PUBLIC_TEXT_CHARACTER_STATE_FIELDS)[number];

/**
 * Character state fields that assert EXISTENCE rather than describe it (ART-124).
 *
 * Never gated by the safety filter, for exactly the reason `character_life_changed` is not:
 * withholding a deactivation would resurrect a character who has left the world because a
 * sentence about them was under review. `convex/publicRead/publicDynamicProjection.ts`'s
 * `excludedCharacterIds` already reads this field as existence on the motion path; this constant
 * is what keeps the character projection agreeing with it.
 */
export const EXISTENCE_CHARACTER_STATE_FIELDS = ['active'] as const;

const TIME_SLOT_SET = new Set<string>(TIME_SLOTS);
const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);
const REMEDIATION_EVENT_TYPE_SET = new Set<string>(REMEDIATION_EVENT_TYPES);
const SCENE_AUTHOR_EVENT_TYPE_SET = new Set<string>(SCENE_AUTHOR_EVENT_TYPES);
const SCENE_AUTHOR_PROPOSED_BY_TYPE_SET = new Set<string>(SCENE_AUTHOR_PROPOSED_BY_TYPES);
const SUPERSEDING_EVENT_TYPE_SET = new Set<string>(SUPERSEDING_EVENT_TYPES);
const PROPOSED_BY_TYPE_SET = new Set<string>(PROPOSED_BY_TYPES);
const FACT_VISIBILITY_SET = new Set<string>(FACT_VISIBILITIES);
const FACT_SUBJECT_TYPE_SET = new Set<string>(FACT_SUBJECT_TYPES);
const STATE_CHANGE_TYPE_SET = new Set<string>(STATE_CHANGE_TYPES);
const KNOWLEDGE_SOURCE_TYPE_SET = new Set<string>(KNOWLEDGE_SOURCE_TYPES);
const KNOWLEDGE_TRUTH_STATUS_SET = new Set<string>(KNOWLEDGE_TRUTH_STATUSES);
const KNOWLEDGE_SHAREABILITY_SET = new Set<string>(KNOWLEDGE_SHAREABILITIES);
const CHARACTER_STATE_FIELD_SET = new Set<string>(CHARACTER_STATE_FIELDS);
const RUMOR_STATE_CHANGE_TYPE_SET = new Set<string>(RUMOR_STATE_CHANGE_TYPES);
const RUMOR_STANCE_SET = new Set<string>(RUMOR_STANCES);

export const isTimeSlot = (v: unknown): v is TimeSlot =>
  typeof v === 'string' && TIME_SLOT_SET.has(v);
export const isEventType = (v: unknown): v is EventType =>
  typeof v === 'string' && EVENT_TYPE_SET.has(v);
export const isRemediationEventType = (v: unknown): v is RemediationEventType =>
  typeof v === 'string' && REMEDIATION_EVENT_TYPE_SET.has(v);
/** ART-209. True for an event type a scene author is entitled to propose. */
export const isSceneAuthorEventType = (v: unknown): v is SceneAuthorEventType =>
  typeof v === 'string' && SCENE_AUTHOR_EVENT_TYPE_SET.has(v);
/** ART-209. True for a proposer a scene author is entitled to claim. */
export const isSceneAuthorProposedByType = (v: unknown): v is SceneAuthorProposedByType =>
  typeof v === 'string' && SCENE_AUTHOR_PROPOSED_BY_TYPE_SET.has(v);
export const isSupersedingEventType = (v: unknown): v is SupersedingEventType =>
  typeof v === 'string' && SUPERSEDING_EVENT_TYPE_SET.has(v);
export const isProposedByType = (v: unknown): v is ProposedByType =>
  typeof v === 'string' && PROPOSED_BY_TYPE_SET.has(v);
export const isFactVisibility = (v: unknown): v is FactVisibility =>
  typeof v === 'string' && FACT_VISIBILITY_SET.has(v);
export const isFactSubjectType = (v: unknown): v is FactSubjectType =>
  typeof v === 'string' && FACT_SUBJECT_TYPE_SET.has(v);
export const isStateChangeType = (v: unknown): v is StateChangeType =>
  typeof v === 'string' && STATE_CHANGE_TYPE_SET.has(v);
export const isKnowledgeSourceType = (v: unknown): v is KnowledgeSourceType =>
  typeof v === 'string' && KNOWLEDGE_SOURCE_TYPE_SET.has(v);
export const isKnowledgeTruthStatus = (v: unknown): v is KnowledgeTruthStatus =>
  typeof v === 'string' && KNOWLEDGE_TRUTH_STATUS_SET.has(v);
export const isKnowledgeShareability = (v: unknown): v is KnowledgeShareability =>
  typeof v === 'string' && KNOWLEDGE_SHAREABILITY_SET.has(v);
export const isCharacterStateField = (v: unknown): v is CharacterStateField =>
  typeof v === 'string' && CHARACTER_STATE_FIELD_SET.has(v);
export const isRumorStateChangeType = (v: unknown): v is RumorStateChangeType =>
  typeof v === 'string' && RUMOR_STATE_CHANGE_TYPE_SET.has(v);
export const isRumorStance = (v: unknown): v is RumorStance =>
  typeof v === 'string' && RUMOR_STANCE_SET.has(v);
