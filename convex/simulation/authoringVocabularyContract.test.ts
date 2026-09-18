/**
 * What the scene author is OFFERED must be what the scene author is ALLOWED (ART-209).
 *
 * ## The failure
 *
 * A live slot on acceptance spent an authoring attempt on
 *
 *     [INVALID_EVENT_SHAPE] remediation events must be proposed by an administrator
 *
 * The request schema declared `eventType: enumOf(EVENT_TYPES)`, and `EVENT_TYPES` is Canon's WHOLE
 * vocabulary — including `correction`, `compensation` and `retcon`, which `validateEventStructure`
 * refuses to anyone but an administrator citing accepted events. One field away, `proposedBy.type`
 * offered `admin`, which is the authority that unlocks them. The model picked a word it had been
 * handed and lost the scene for it.
 *
 * ## Why this file does not import the answer
 *
 * The obvious test — compare the schema's enum with `SCENE_AUTHOR_EVENT_TYPES` — is the tautology
 * this repository's conventions name: a validator must not be handed its own input. Both sides would
 * read the same constant and the test would pass however wrong that constant was.
 *
 * So the two sets are built from opposite ends and never introduced:
 *
 *   exposed     — walked out of the real `WHOLE_SCENE_JSON_SCHEMA`, the object actually serialized
 *                 into the prompt and sent to the gateway;
 *   authorized  — PROBED out of the real `validateEventStructure`, by asking it about every
 *                 combination in `EVENT_TYPES` × `PROPOSED_BY_TYPES` and recording what it says.
 *
 * Neither reads `SCENE_AUTHOR_EVENT_TYPES` or `SCENE_AUTHOR_PROPOSED_BY_TYPES`. Delete the
 * derivation and rebuild it wrongly by hand, and this file still knows.
 */

import { EVENT_TYPES, PROPOSED_BY_TYPES } from '../canon/eventTypes';
import { validateEventStructure } from '../canon/validators';
import { canonRejectionFeedback } from './canonFeedback';
import {
  SceneSimulationError, WHOLE_SCENE_JSON_SCHEMA, parseWholeSceneOutput, wholeSceneSystemPrompt,
} from './sceneSimulation';
import type { GroupedScene } from './sceneGrouping';

const scene: GroupedScene = {
  schemaVersion: 1, sceneId: 'grouping:mistwood:7:evening:scene:1', groupingRunId: 'grouping:mistwood:7:evening',
  directorRunId: 'director-7', worldId: 'mistwood', worldDay: 7, timeSlot: 'evening',
  locationId: 'mistwood-hall', participantIds: ['gao-wenrui', 'lin-yingxue'],
  sourceIntentIds: ['intent-1'], arcIds: ['arc-ledger'],
  trigger: '帳冊的缺頁', dramaticPressure: '鎮長在午前抵達',
};

// =============================================================================
// Side one: what the request actually offers
// =============================================================================

/**
 * Read an enum out of the schema by path, refusing to guess.
 *
 * A missing node throws rather than yielding `[]`, because an empty exposed set would satisfy every
 * subset assertion below and the file would report a clean pass on a schema it could not read.
 */
function exposedEnum(...path: readonly string[]): readonly string[] {
  let node: unknown = WHOLE_SCENE_JSON_SCHEMA;
  for (const key of path) {
    if (node === null || typeof node !== 'object') throw new Error(`schema path broke at ${key}`);
    node = (node as Record<string, unknown>)[key];
  }
  if (node === null || typeof node !== 'object') throw new Error(`no schema node at ${path.join('.')}`);
  const values = (node as Record<string, unknown>).enum;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`no non-empty enum at ${path.join('.')}`);
  }
  return values.map(String);
}

const exposedEventTypes = exposedEnum('properties', 'proposedEvents', 'items', 'properties', 'eventType');
const exposedProposedByTypes = exposedEnum(
  'properties', 'proposedEvents', 'items', 'properties', 'proposedBy', 'properties', 'type');

// =============================================================================
// Side two: what the validator actually accepts
// =============================================================================

/**
 * One proposal, minimal in everything except the two fields under test.
 *
 * Every other field is deliberately valid so that a refusal can only be about `eventType` or
 * `proposedBy.type`. `character_memory_formed` is the state change ART-197 established as legal in
 * every scene: it needs no destination, no second participant and no prior canon.
 */
const probeEvent = (eventType: string, proposedByType: string, causedByEventIds: readonly string[]) => ({
  schemaVersion: 1, worldId: scene.worldId, idempotencyKey: `${scene.sceneId}:1`,
  proposedBy: { type: proposedByType },
  worldDay: scene.worldDay, timeSlot: scene.timeSlot, eventType, locationId: scene.locationId,
  participantIds: [scene.participantIds[0]], causedByEventIds: [...causedByEventIds],
  publicSummary: '兩人在廳中對質。',
  stateChanges: [{
    type: 'character_memory_formed', characterId: scene.participantIds[0],
    content: '他記住了對方說話時的停頓。', interpretation: '對方有所隱瞞。',
    importance: 0.6, emotionalWeight: 0.4, confidence: 0.7, visibility: 'private',
  }],
});

const sceneOutput = (event: Record<string, unknown>) => ({
  schemaVersion: 1, sceneId: scene.sceneId, sceneSummary: '兩人對質。',
  keyActions: [{ characterId: scene.participantIds[0], action: '推出帳冊。' }],
  dialogueHighlights: [], proposedEvents: [event],
  relationshipChanges: [], knowledgeChanges: [], memories: [], rumors: [], continuityWarnings: [],
});

const authoredEvent = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1, worldId: scene.worldId, idempotencyKey: `${scene.sceneId}:1`,
  proposedBy: { type: 'system' }, worldDay: scene.worldDay, timeSlot: scene.timeSlot,
  eventType: 'conversation', locationId: scene.locationId,
  participantIds: [scene.participantIds[0]], publicSummary: '兩人對質。',
  stateChanges: [{
    type: 'character_memory_formed', characterId: scene.participantIds[0],
    content: '停頓。', interpretation: '有所隱瞞。',
    importance: 0.5, emotionalWeight: 0.4, confidence: 0.7, visibility: 'private',
  }],
  ...overrides,
});

/**
 * The refusal `parseWholeSceneOutput` produced, or `null` when it accepted the answer.
 *
 * Deliberately not narrowed to `SceneSimulationError`: normalization refuses with a `CanonError`,
 * and one of the cases below is precisely about which of the two answers. Catching only one class
 * would have made "the parser handled it" and "the parser rethrew someone else's complaint"
 * indistinguishable.
 */
function refusalFor(event: Record<string, unknown>): Error | null {
  try {
    parseWholeSceneOutput(sceneOutput(event), scene);
    return null;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
}

const sceneRefusal = (error: Error | null): SceneSimulationError => {
  if (!(error instanceof SceneSimulationError)) {
    throw new Error(`expected a SceneSimulationError, got ${error?.name ?? 'no refusal'}: ${error?.message ?? ''}`);
  }
  return error;
};

/**
 * `[]` is the only value a scene author's `causedByEventIds` can hold, so it is the only value the
 * probe may use.
 *
 * ART-203 removed the field from the request and `parseWholeSceneOutput` fills it in; that is what
 * makes "accepted with no causal ids" the right question to ask the validator, and it is asserted
 * below rather than assumed, because the whole probe rests on it.
 */
const accepts = (eventType: string, proposedByType: string, causedByEventIds: readonly string[] = []) =>
  validateEventStructure(probeEvent(eventType, proposedByType, causedByEventIds)) === null;

/**
 * A proposer that UNLOCKS something is an authority, not a source.
 *
 * Derived, never listed: `admin` is privileged here because the validator accepts `retcon` from it
 * and refuses `retcon` from `system`, and that difference is observable without knowing the word
 * `admin` means anything. Retire the remediation rule from Canon and this set empties by itself.
 */
const privilegedProposers: readonly string[] = PROPOSED_BY_TYPES.filter((candidate) =>
  EVENT_TYPES.some((eventType) => accepts(eventType, candidate, ['mistwood#event#1'])
    && PROPOSED_BY_TYPES.some((other) => !accepts(eventType, other, ['mistwood#event#1']))));

const unprivilegedProposers: readonly string[] =
  PROPOSED_BY_TYPES.filter((candidate) => !privilegedProposers.includes(candidate));

/** Accepted from every unprivileged proposer, with the empty causal list an author always has. */
const authorizedEventTypes: readonly string[] = EVENT_TYPES.filter((eventType) =>
  unprivilegedProposers.every((proposedByType) => accepts(eventType, proposedByType)));

describe('the probe is asking a question that can come out either way', () => {
  it('finds at least one privileged proposer and at least one unprivileged one', () => {
    // Without this, an `accepts` that always returned true would make every assertion below vacuous.
    expect(privilegedProposers.length).toBeGreaterThan(0);
    expect(unprivilegedProposers.length).toBeGreaterThan(0);
  });

  it('finds at least one event type the validator refuses an unprivileged author', () => {
    expect(authorizedEventTypes.length).toBeLessThan(EVENT_TYPES.length);
  });

  it('rests on causedByEventIds being [], which the parser guarantees', () => {
    const parsed = parseWholeSceneOutput(sceneOutput(authoredEvent()), scene);
    expect(parsed.proposedEvents[0].causedByEventIds).toEqual([]);
  });
});

// =============================================================================
// The contract
// =============================================================================

describe('the exposed vocabulary is the authorized vocabulary', () => {
  it('offers no event type the validator refuses to this author', () => {
    // The defect, stated directly: `correction`, `compensation` and `retcon` were all in the enum.
    expect(exposedEventTypes.filter((eventType) => !authorizedEventTypes.includes(eventType)))
      .toEqual([]);
  });

  it('offers no proposer that grants authority beyond that vocabulary', () => {
    expect(exposedProposedByTypes.filter((proposedByType) =>
      privilegedProposers.includes(proposedByType))).toEqual([]);
  });

  it('still offers every event type this author IS allowed', () => {
    /**
     * The other direction, and not decoration. "Exposed is a subset of authorized" is satisfied
     * perfectly by an empty enum, which would take live authoring down while every subset assertion
     * stayed green. Equality is the actual contract.
     */
    expect([...exposedEventTypes].sort()).toEqual([...authorizedEventTypes].sort());
  });

  it('accepts every offered combination, not merely every offered value', () => {
    // A per-field subset check would miss a pair that is illegal only together, which is precisely
    // the shape of the remediation rule: the event type and the proposer are refused as a PAIR.
    for (const eventType of exposedEventTypes) {
      for (const proposedByType of exposedProposedByTypes) {
        expect({ eventType, proposedByType, refusal: validateEventStructure(probeEvent(eventType, proposedByType, [])) })
          .toEqual({ eventType, proposedByType, refusal: null });
      }
    }
  });

  it('carries the narrowed enums into the prompt the model is actually sent', () => {
    /**
     * The schema travels in the prompt verbatim (ART-141: the gateway accepts `strict: true` and
     * does not enforce it), so narrowing the object is only half the fix — the serialized form has
     * to be what the model reads.
     */
    const serialized = JSON.stringify(WHOLE_SCENE_JSON_SCHEMA);
    expect(wholeSceneSystemPrompt(scene, { legalDestinationIds: [] })).toContain(serialized);
    for (const eventType of EVENT_TYPES.filter((candidate) => !authorizedEventTypes.includes(candidate))) {
      expect(serialized).not.toContain(`"${eventType}"`);
    }
    for (const proposedByType of privilegedProposers) {
      expect(serialized).not.toContain(`"${proposedByType}"`);
    }
  });
});

// =============================================================================
// The narrowing is enforced, not merely advertised
// =============================================================================

describe('an out-of-vocabulary answer is refused at parse', () => {
  it('refuses a remediation event type, naming the field rather than the administrator rule', () => {
    /**
     * Before this, the refusal came from `validateEventStructure` one call later and read
     * `remediation events must be proposed by an administrator` — a rule ABOUT administrators,
     * delivered to something that is not one and cannot become one. It told the retry nothing it
     * could act on.
     */
    const refusal = sceneRefusal(refusalFor(authoredEvent({ eventType: 'retcon' })));
    expect(refusal.code).toBe('SCENE_OUTPUT_INVALID');
    expect(refusal.message).toContain('not available to a scene author');
    expect(refusal.path).toBe('proposedEvents[0].eventType');
  });

  it('refuses the admin authority even on an event type Canon would accept from it', () => {
    /**
     * This one has no downstream backstop at all. `validateEventStructure` gates what `admin`
     * UNLOCKS, not the claim itself, so an `admin`-proposed `conversation` is structurally fine and
     * would have been committed with a provenance the world never granted.
     */
    expect(validateEventStructure(probeEvent('conversation', 'admin', []))).toBeNull();
    const refusal = sceneRefusal(refusalFor(authoredEvent({ proposedBy: { type: 'admin' } })));
    expect(refusal.code).toBe('SCENE_OUTPUT_INVALID');
    expect(refusal.path).toBe('proposedEvents[0].proposedBy.type');
  });

  it('still accepts every value the request does offer', () => {
    for (const eventType of exposedEventTypes) {
      for (const proposedByType of exposedProposedByTypes) {
        expect(refusalFor(authoredEvent({ eventType, proposedBy: { type: proposedByType } }))).toBeNull();
      }
    }
  });

  it('leaves a value that is not a Canon word at all to normalization', () => {
    // "You may not use that" is the wrong answer about a word that does not exist. `eventType is not
    // supported` is the right one, and it already existed.
    const refusal = refusalFor(authoredEvent({ eventType: 'interaction' }));
    expect(refusal).not.toBeInstanceOf(SceneSimulationError);
    expect(refusal?.message).toContain('eventType is not supported');
  });

  it('turns the refusal into an instruction the next attempt can act on', () => {
    const refusal = sceneRefusal(refusalFor(authoredEvent({ eventType: 'correction' })));
    const feedback = canonRejectionFeedback(
      { code: refusal.code, message: refusal.message, path: refusal.path }, 0);
    expect(feedback.instruction).toContain('not yours');
    expect(feedback.instruction).toContain('ordinary event');
  });
});
