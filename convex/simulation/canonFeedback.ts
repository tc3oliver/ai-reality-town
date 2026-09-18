/**
 * A Canon refusal, turned into something a model can act on (ART-205).
 *
 * ## What went wrong without this
 *
 * The whole-scene retry loop only ever saw PARSER rejections. Canon validation runs later and
 * elsewhere — stage 8, inside the finishing mutation, after the authoring action has returned — so a
 * scene whose proposals parsed but violated Canon was persisted, and ART-149 reuse replayed the
 * identical stored scene into the identical refusal on every retry. The slot could not recover, no
 * matter how many attempts it was given, and no provider call was ever made to try anything else.
 *
 * Six prompt-contract fixes (ART-196 … ART-204) each raised the chance that a scene is born valid.
 * None of them could rescue one that is not. `DUPLICATE_CHARACTER_MOVEMENT` kept occurring after
 * ART-204 stated the rule, because a model that breaks a rule it was told is not a rule the prompt
 * can fix.
 *
 * ## What is allowed to travel back
 *
 * Bounded facts, and nothing else:
 *
 *  - the stable Canon code;
 *  - the rule that was violated — `validateCanon`'s own message, which is a repository constant in
 *    `convex/canon/validators.ts` and never model text or world content;
 *  - the field path and the index of the offending proposed event;
 *  - one instruction saying what to do differently.
 *
 * What does NOT travel: the validator's `details` object, any part of the world projection, any
 * other character's state, and anything the author was not already given. A refusal is a statement
 * about the author's OWN output, so telling it what it did wrong reveals nothing it did not write —
 * and the `details` payload is the one field that could carry world state, so it is dropped whole
 * rather than filtered.
 *
 * Nothing here relaxes a validator. The rule is unchanged; only the author's knowledge of it
 * improves.
 */

import { sanitizeFailureText } from '../shared/failureDetail';

/** One Canon refusal, reduced to what is safe to show the author and useful for correcting. */
export type CanonRejectionFeedback = {
  /** The stable `CanonErrorCode`. */
  code: string;
  /** `validateCanon`'s own message for the rule. A repository constant, never world content. */
  rule: string;
  /** The field the refusal points at, e.g. `stateChanges[0]`. `null` when it named none. */
  path: string | null;
  /** Which `proposedEvents` entry was refused, when it could be attributed. */
  proposedEventIndex: number | null;
  /** What to do differently. Derived from the code, never from the validator's payload. */
  instruction: string;
};

/**
 * What to do about each refusal a scene author can actually provoke.
 *
 * Keyed on the stable code rather than on the message, so rewording a validator does not silently
 * drop the instruction. A code with no entry gets {@link GENERIC_INSTRUCTION}, which is honest
 * rather than confidently wrong — the alternative is inventing a correction for a rule this table
 * does not know.
 */
const INSTRUCTIONS: Record<string, string> = {
  DUPLICATE_CHARACTER_MOVEMENT:
    'Emit at most ONE character_location_changed for that character across the entire scene. If two hops matter, keep only the destination that matters and describe the rest in narrative text.',
  CHARACTER_ALREADY_MOVED_THIS_SLOT:
    'That character has already moved in this world time slot. Remove the movement entirely and keep them where they are.',
  LOCATION_PRECONDITION_FAILED:
    'Use the character’s own current location as fromLocationId, exactly as this scene’s movement rules state it, and make sure the destination differs from it.',
  TELEPORTATION_NOT_ALLOWED:
    'Choose a destination from that character’s own listed destinations. Anywhere else is unreachable from where they stand.',
  UNKNOWN_LOCATION_REFERENCE:
    'Use only the location ids this scene named. Do not invent a location, and do not use one that was not offered.',
  UNKNOWN_CHARACTER_REFERENCE:
    'Use only the participant ids this scene named. A character mentioned in passing is not available.',
  UNKNOWN_EVENT_REFERENCE:
    'Leave causedByEventIds as an empty array. You have no event ids and any id written there will not exist.',
  UNKNOWN_ITEM_REFERENCE:
    'Do not reference items. Remove the item change and express it as narrative text instead.',
  UNKNOWN_ORGANIZATION_REFERENCE:
    'Do not reference organizations. Remove the organization change and express it as narrative text instead.',
  PARTICIPANT_MISMATCH:
    'Every character named inside stateChanges must also appear in that event’s participantIds, and both must be scene participants.',
  PRIVATE_RELATIONSHIP_DISCLOSURE:
    'Set visibility to "public" on that relationship change. Every event here carries a publicSummary, and a private relationship change cannot sit on one.',
  INVALID_RELATIONSHIP_TARGET:
    'Give the relationship change two different characters for sourceCharacterId and targetCharacterId.',
  INVALID_RELATIONSHIP_DELTA:
    'Make at least one of the six relationship deltas non-zero, or remove the relationship change.',
  INVALID_EVENT_SHAPE:
    'Give every proposedEvents item at least one entry in stateChanges, and use only the fields the schema declares.',
  INVALID_FACT_SUBJECT:
    'A fact may only be about a scene participant, this scene’s location, or the world itself — and one event may not create two facts with the same subject and predicate.',
  INVALID_CHARACTER_STATE_CHANGE:
    'Do not emit character_state_changed. You have not been given the character’s current recorded value, which it must match.',
  CHARACTER_STATE_PRECONDITION_FAILED:
    'Do not emit character_state_changed. You have not been given the character’s current recorded value, which it must match.',
  KNOWLEDGE_SOURCE_MISSING:
    'Do not emit character_knowledge_learned. Write the same idea as a knowledgeChanges note about another event instead.',
  DEAD_CHARACTER_ACTION:
    'That character is dead and cannot act. Remove them from the event.',
  RUMOR_NOT_FOUND:
    'That rumor does not exist yet. Emit rumor_originated first, or drop the rumor change.',
  RUMOR_SOURCE_NOT_HELD:
    'That character does not hold the rumor, so they cannot spread, judge or correct it.',
  RUMOR_CANNOT_BECOME_FACT:
    'An event that spreads a rumor may not also state the same claim as a fact. Keep one or the other.',
  ITEM_OWNERSHIP_CONFLICT:
    'Do not emit item_transferred. You have not been given item ids or their current owners.',
};

export const GENERIC_INSTRUCTION =
  'Change the proposed events so this rule is satisfied, and keep every other rule this scene stated.';

/** How much of a Canon message is kept. Bounded for the same reason a failure message is. */
const RULE_MAX_LENGTH = 200;

/**
 * Reduce a Canon refusal to the feedback contract.
 *
 * `details` is deliberately not read at all. It is the one field on a `CanonValidationError` that
 * can carry world state — location ids, character ids, capacities — and dropping it whole is a
 * stronger guarantee than filtering it.
 */
export function canonRejectionFeedback(
  error: { code: string; message?: string; path?: string },
  proposedEventIndex: number | null = null,
): CanonRejectionFeedback {
  const rule = sanitizeFailureText(error.message ?? '').slice(0, RULE_MAX_LENGTH);
  return {
    code: error.code,
    rule,
    path: typeof error.path === 'string' && error.path.length > 0 ? error.path : null,
    proposedEventIndex,
    instruction: INSTRUCTIONS[error.code] ?? GENERIC_INSTRUCTION,
  };
}

/**
 * The correction block the next attempt's prompt carries.
 *
 * Written as an instruction to change specific output rather than as a general rule, because the
 * general rule was already in the prompt on the attempt that broke it. Repeating it would be
 * repeating what demonstrably did not work.
 */
export function renderCanonRejection(feedback: CanonRejectionFeedback): string {
  const where = [
    feedback.proposedEventIndex === null ? null : `proposedEvents[${feedback.proposedEventIndex}]`,
    feedback.path,
  ].filter((part): part is string => part !== null).join(' ');
  return [
    'Your previous answer for this scene was REJECTED by Canon validation and nothing was committed.',
    where.length > 0 ? `The refusal was at ${where}.` : null,
    `Rule violated (${feedback.code}): ${feedback.rule}`,
    `Correction: ${feedback.instruction}`,
    'Produce the whole scene again, corrected. Keep everything that did not violate this rule.',
  ].filter((part): part is string => part !== null).join(' ');
}
