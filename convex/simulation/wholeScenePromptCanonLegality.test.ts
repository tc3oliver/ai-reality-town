/**
 * The worked example in the prompt is an event Canon accepts (ART-196).
 *
 * ## What went wrong
 *
 * `wholeSceneSystemPrompt` builds one example Proposed Event and tells the model "A well-formed
 * item for this scene looks like: …". When the scene's location had no legal destination it set
 * `stateChanges: []` — and `validateEventStructure` refuses an event carrying no state change, so
 * the single worked example the model was given was rejected unconditionally.
 *
 * That stopped the live world. Every authored slot on the acceptance deployment failed with
 * `[INVALID_EVENT_SHAPE] stateChanges must not be empty`, and the failure was only legible at all
 * because ART-195 had just made it so.
 *
 * ART-157 introduced the empty array for a good reason — it had stopped the example demonstrating a
 * movement to a destination Canon would reject — and its own notes record why nothing caught the
 * replacement: the deterministic author knows the canon rules independently of the prompt, so every
 * existing suite stayed green while the prompt told a real model something false.
 *
 * ## Why these tests parse the prompt rather than inspect a constant
 *
 * The example is built inside the prompt builder and never exported. Asserting against a copy of it
 * would assert that the copy is legal. So the cases below run the REAL builder, pull the example
 * back out of the string the model actually receives, and put it through `validateEventStructure` —
 * the same function that refused the live slot.
 */

import { EVENT_TYPES } from '../canon/eventTypes';
import { emptyProjection } from '../canon/model';
import type { WorldProjection } from '../canon/model';
import { validateCanon, validateEventStructure } from '../canon/validators';
import type { GroupedScene } from './sceneGrouping';
import { participantMovementFor } from './worldDayLive';
import { WHOLE_SCENE_JSON_SCHEMA, parseWholeSceneOutput, wholeSceneSystemPrompt } from './sceneSimulation';

const scene: GroupedScene = {
  schemaVersion: 1, sceneId: 'grouping:mistwood:5:morning:scene:2', groupingRunId: 'grouping:mistwood:5:morning',
  directorRunId: 'director-1', worldId: 'mistwood', worldDay: 5, timeSlot: 'morning',
  locationId: 'mistwood-hall', participantIds: ['gao-wenrui', 'lin-yingxue'],
  sourceIntentIds: ['intent-1'], arcIds: ['arc-ledger'],
  trigger: '帳冊的缺頁', dramaticPressure: '鎮長在午前抵達',
};

/**
 * The example object, recovered from the prompt the model is sent.
 *
 * Located by its marker sentence and then by balancing braces, rather than by a regex over the
 * whole prompt: the prompt also embeds the serialized JSON Schema, which is far larger and would
 * match any greedy pattern first.
 */
function exampleFrom(prompt: string): unknown {
  const marker = 'A well-formed item for this scene looks like: ';
  const start = prompt.indexOf(marker);
  if (start < 0) throw new Error('the prompt no longer carries a worked example');
  const from = start + marker.length;
  let depth = 0;
  for (let index = from; index < prompt.length; index += 1) {
    if (prompt[index] === '{') depth += 1;
    else if (prompt[index] === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(prompt.slice(from, index + 1)) as unknown;
    }
  }
  throw new Error('the worked example is not a balanced object');
}

describe('the example Proposed Event the prompt demonstrates', () => {
  it('is accepted by Canon when the scene HAS a legal destination', () => {
    const example = exampleFrom(wholeSceneSystemPrompt(scene, { legalDestinationIds: ['mistwood-mill'] }));
    expect(validateEventStructure(example)).toBeNull();
  });

  it('is accepted by Canon when the scene has NO legal destination', () => {
    /**
     * The live failure, stated as a test. Before ART-196 this example carried `stateChanges: []`
     * and `validateEventStructure` returned `INVALID_EVENT_SHAPE` — so the model was being shown,
     * as its only worked example, an event that could never be committed.
     */
    const example = exampleFrom(wholeSceneSystemPrompt(scene, { legalDestinationIds: [] }));
    expect(validateEventStructure(example)).toBeNull();
  });

  it('never demonstrates an event carrying no state change, whatever the scene', () => {
    // Stated over both branches as a property, because the defect was that one branch differed
    // from the other in a way no test compared.
    for (const legalDestinationIds of [[], ['mistwood-mill'], ['mistwood-mill', 'mistwood-paper']]) {
      const example = exampleFrom(wholeSceneSystemPrompt(scene, { legalDestinationIds })) as {
        stateChanges: unknown[];
      };
      expect(example.stateChanges.length).toBeGreaterThan(0);
    }
  });

  it('demonstrates a change that needs no destination when there is none to use', () => {
    // Not a movement: the whole reason ART-157 emptied the array was that a movement had nowhere
    // legal to go. The substitute has to be legal in EVERY scene, not merely in this one.
    const example = exampleFrom(wholeSceneSystemPrompt(scene, { legalDestinationIds: [] })) as {
      eventType: string; stateChanges: Array<{ type: string }>;
    };
    expect(example.eventType).toBe('conversation');
    expect(example.stateChanges.map(({ type }) => type)).not.toContain('character_location_changed');
  });

  it('demonstrates an eventType Canon actually supports', () => {
    /**
     * The second defect in the same example, and independent of the first: the no-destination
     * branch used `interaction`, which is not in `EVENT_TYPES` and never was. So that branch was
     * refused twice over, and only the movement branch had ever been put through Canon by anything.
     */
    for (const legalDestinationIds of [[], ['mistwood-mill']]) {
      const example = exampleFrom(wholeSceneSystemPrompt(scene, { legalDestinationIds })) as { eventType: string };
      expect(EVENT_TYPES as readonly string[]).toContain(example.eventType);
    }
  });

  it('still refuses to name a destination the scene has no right to use', () => {
    // ART-157's guarantee, unchanged. Fixing one example must not restore the other defect.
    const prompt = wholeSceneSystemPrompt(scene, { legalDestinationIds: [] });
    expect(prompt).toContain('No character may leave mistwood-hall');
    expect(JSON.stringify(exampleFrom(prompt))).not.toContain('toLocationId');
  });
});

describe('the request states the rule as well as demonstrating it', () => {
  it('carries minItems on stateChanges in the schema', () => {
    const properties = (WHOLE_SCENE_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>);
    const item = (properties.proposedEvents.items as Record<string, Record<string, unknown>>);
    expect((item.properties.stateChanges as Record<string, unknown>).minItems).toBe(1);
  });

  it('serializes that bound into the prompt the model reads', () => {
    // The schema is embedded in the prompt verbatim, so a bound that is not serialized is a bound
    // the model never sees.
    expect(wholeSceneSystemPrompt(scene, { legalDestinationIds: [] })).toContain('"minItems":1');
  });

  it('says the rule in prose too', () => {
    expect(wholeSceneSystemPrompt(scene, { legalDestinationIds: [] }))
      .toContain('must carry at least one entry in stateChanges');
  });
});

// =============================================================================
// validateCanon, not only validateEventStructure (ART-197)
// =============================================================================

/**
 * The gap ART-196 fell into, closed.
 *
 * Its tests put the example through `validateEventStructure` and stopped there — so the example it
 * shipped, a `character_state_changed` on `emotion`, passed every check while `validateCanon`
 * would have refused it in any scene where the character's emotion was not the literal shown.
 * `fromValue` has to equal the projected value, and a worked example cannot know one.
 *
 * The slot the world actually failed on failed HERE, at `validate_canon`, one stage past where
 * ART-196's tests were looking.
 */
function worldWithParticipants(): WorldProjection {
  const projection = emptyProjection(scene.worldId);
  for (const characterId of scene.participantIds) {
    projection.characterAlive[characterId] = true;
    projection.characterLocations[characterId] = scene.locationId;
  }
  projection.locations[scene.locationId] = {
    locationId: scene.locationId, name: '鎮公所', description: '',
    locationType: 'civic', capacity: 8, connectedLocationIds: ['mistwood-mill'], active: true,
    lastUpdatedEventId: 'seed',
  };
  projection.locations['mistwood-mill'] = {
    locationId: 'mistwood-mill', name: '磨坊', description: '',
    locationType: 'work', capacity: 8, connectedLocationIds: [scene.locationId], active: true,
    lastUpdatedEventId: 'seed',
  };
  return projection;
}

describe('the worked example survives Canon validation, not only structural validation', () => {
  it('is accepted with no legal destination', () => {
    const example = exampleFrom(wholeSceneSystemPrompt(scene, { legalDestinationIds: [] }));
    expect(validateEventStructure(example)).toBeNull();
    expect(validateCanon(example as never, worldWithParticipants())).toBeNull();
  });

  it('is accepted with a legal destination', () => {
    const example = exampleFrom(wholeSceneSystemPrompt(scene, { legalDestinationIds: ['mistwood-mill'] }));
    expect(validateEventStructure(example)).toBeNull();
    expect(validateCanon(example as never, worldWithParticipants())).toBeNull();
  });

  it('demonstrates a change that needs no knowledge of projected state', () => {
    /**
     * `character_memory_formed` has exactly two canon rules and both are about the character being
     * a scene participant. `character_state_changed` — what ART-196 chose — additionally requires
     * `fromValue` to equal the projection, which no static example can guarantee.
     */
    const example = exampleFrom(wholeSceneSystemPrompt(scene, { legalDestinationIds: [] })) as {
      stateChanges: Array<{ type: string }>;
    };
    expect(example.stateChanges.map(({ type }) => type)).toEqual(['character_memory_formed']);
  });
});

describe('the prompt states the Canon rules a scene author can break', () => {
  const prompt = () => wholeSceneSystemPrompt(scene, { legalDestinationIds: [] });

  it('says a relationship change must be public, which is why the live slot failed', () => {
    // Strict mode makes `publicSummary` mandatory on every event, and `validateCanon` refuses a
    // `private` relationship change on an event that has one. The schema offered both values.
    expect(prompt()).toContain('visibility to "public"');
  });

  it('names the scene participants as the only characters a stateChange may name', () => {
    const text = prompt();
    expect(text).toContain('must be one of this scene');
    for (const characterId of scene.participantIds) expect(text).toContain(characterId);
  });

  it('states the two relationship rules that refuse a whole scene', () => {
    expect(prompt()).toContain('must differ');
    expect(prompt()).toContain('non-zero');
  });

  it('stops asking for the two variants this request cannot support', () => {
    /**
     * `character_state_changed` needs the character's current recorded value and
     * `character_knowledge_learned` needs a causal event id. The request supplies neither, so
     * asking for them produced nothing but rejections.
     */
    expect(prompt()).toContain('Never emit character_state_changed or character_knowledge_learned');
  });

  it('still names the alternatives, so the prohibition is not a dead end', () => {
    const text = prompt();
    for (const variant of ['character_memory_formed', 'relationship_changed', 'fact_created']) {
      expect(text).toContain(variant);
    }
  });
});

// =============================================================================
// The prompt states what the PARSER enforces (ART-199)
// =============================================================================

/**
 * Third failure of the same class, from the live slot after ART-197 shipped:
 *
 *   mistwood day 5 noon — SCENE_OUTPUT_PROVENANCE_MISMATCH at output_validation
 *   "Proposed Event must remain within the Scene world, slot, and participants"
 *
 * `parseWholeSceneOutput` requires every proposed event to copy the scene's `worldId`, `worldDay`
 * and `timeSlot` verbatim and to name only its participants. The payload carries all four and the
 * worked example uses them — but nothing said they must be COPIED, and each of these refuses the
 * WHOLE scene.
 *
 * ## Why each case asserts the rule TWICE
 *
 * Once that the parser refuses the violation, once that the prompt states the rule. A prompt
 * sentence with no parser behind it is decoration; a parser rule the prompt never states is what
 * stopped this world three times running. Pinning both in one test is what stops them drifting
 * apart — the failure mode here has always been that one side moved and the other did not.
 */
describe('every parser rule that refuses a whole scene is stated in the prompt', () => {
  const prompt = wholeSceneSystemPrompt(scene, { legalDestinationIds: [] });

  /** A minimal well-formed scene output, for one field at a time to be broken. */
  const wellFormed = () => ({
    schemaVersion: 1,
    sceneId: scene.sceneId,
    sceneSummary: '兩人在大廳對質。',
    keyActions: [{ characterId: scene.participantIds[0], action: '推出帳冊。' }] as Array<{ characterId: string; action: string }>,
    dialogueHighlights: [] as unknown[],
    proposedEvents: [{
      schemaVersion: 1, worldId: scene.worldId, idempotencyKey: `${scene.sceneId}:1`,
      proposedBy: { type: 'system' }, worldDay: scene.worldDay, timeSlot: scene.timeSlot,
      eventType: 'conversation', locationId: scene.locationId,
      participantIds: [scene.participantIds[0]], causedByEventIds: [], publicSummary: '兩人對質。',
      stateChanges: [{
        type: 'character_memory_formed', characterId: scene.participantIds[0],
        content: '停頓。', interpretation: '有所隱瞞。',
        importance: 0.5, emotionalWeight: 0.4, confidence: 0.7, visibility: 'private',
      }],
    }],
    relationshipChanges: [] as unknown[], knowledgeChanges: [] as unknown[],
    memories: [] as unknown[], rumors: [] as unknown[], continuityWarnings: [] as string[],
  });

  it('accepts the well-formed baseline, so every case below is about the one field it breaks', () => {
    // The negative control. Without it a broken fixture would make all the rules below "pass".
    expect(() => parseWholeSceneOutput(wellFormed(), scene)).not.toThrow();
  });

  it('refuses a proposed event carrying a different timeSlot, and says so', () => {
    const output = wellFormed();
    output.proposedEvents[0].timeSlot = 'night';
    expect(() => parseWholeSceneOutput(output, scene))
      .toThrow(/SCENE_OUTPUT_PROVENANCE_MISMATCH/u);
    expect(prompt).toContain(`timeSlot ${JSON.stringify(scene.timeSlot)}`);
  });

  it('refuses a proposed event carrying a different worldDay, and says so', () => {
    const output = wellFormed();
    output.proposedEvents[0].worldDay = scene.worldDay + 1;
    expect(() => parseWholeSceneOutput(output, scene))
      .toThrow(/SCENE_OUTPUT_PROVENANCE_MISMATCH/u);
    expect(prompt).toContain(`worldDay ${scene.worldDay}`);
  });

  it('refuses a proposed event naming a character who is not a scene participant, and says so', () => {
    // The likeliest real violation: a character mentioned in the dialogue but not in the scene.
    const output = wellFormed();
    output.proposedEvents[0].participantIds = [scene.participantIds[0], 'wu-zhen'];
    expect(() => parseWholeSceneOutput(output, scene))
      .toThrow(/SCENE_OUTPUT_PROVENANCE_MISMATCH/u);
    expect(prompt).toContain('only mentioned in passing is not a participant');
  });

  it('refuses a keyActions entry naming a non-participant, and says so', () => {
    const output = wellFormed();
    output.keyActions = [{ characterId: 'wu-zhen', action: '插話。' }];
    expect(() => parseWholeSceneOutput(output, scene)).toThrow(/SCENE_OUTPUT_INVALID/u);
    expect(prompt).toContain('keyActions');
  });

  it('refuses duplicate idempotencyKeys within one scene, and says so', () => {
    const output = wellFormed();
    output.proposedEvents = [output.proposedEvents[0], { ...output.proposedEvents[0] }];
    expect(() => parseWholeSceneOutput(output, scene)).toThrow(/SCENE_OUTPUT_INVALID/u);
    expect(prompt).toContain('unique idempotencyKey');
  });

  it('refuses repeated continuityWarnings, and says so', () => {
    const output = wellFormed();
    output.continuityWarnings = ['帳冊缺頁', '帳冊缺頁'];
    expect(() => parseWholeSceneOutput(output, scene)).toThrow(/SCENE_OUTPUT_INVALID/u);
    expect(prompt).toContain('continuityWarnings must not repeat');
  });

  it('refuses an empty keyActions list, and says so', () => {
    const output = wellFormed();
    output.keyActions = [];
    expect(() => parseWholeSceneOutput(output, scene)).toThrow(/SCENE_OUTPUT_INVALID/u);
    expect(prompt).toContain('at least one keyActions entry');
  });

  it('inlines the scene identity as literals rather than telling the model to look it up', () => {
    // ART-157's reasoning about destinations: a value the model must derive from elsewhere in the
    // payload is a value it can derive wrongly.
    expect(prompt).toContain(`worldId ${JSON.stringify(scene.worldId)}`);
    expect(prompt).toContain(JSON.stringify(scene.participantIds));
  });
});

// =============================================================================
// The movement rule is true for the character it names (ART-200)
// =============================================================================

/**
 * Fourth stop of the same class, from the live slot after ART-199:
 *
 *   mistwood day 5 noon — LOCATION_PRECONDITION_FAILED at validate_canon
 *   "movement fromLocationId does not match current location"
 *
 * ART-157's rule ends "fromLocationId must be <scene.locationId>". That is true only when every
 * participant is standing at the scene's location — and a scene groups characters by INTENT while
 * Canon tracks position. For anyone projected elsewhere the prompt was instructing a value
 * `validateCanon` refuses, and the destinations offered were not connected to where they stood, so
 * a corrected origin would then have failed `TELEPORTATION_NOT_ALLOWED`.
 */
describe('a participant who is not standing at the scene location', () => {
  /** `lin-yingxue` is at the mill; the scene is at the hall. The live situation. */
  const elsewhere = {
    'gao-wenrui': { fromLocationId: 'mistwood-hall', destinations: ['mistwood-mill'] },
    'lin-yingxue': { fromLocationId: 'mistwood-mill', destinations: ['mistwood-hall'] },
  };

  it('is never told to use the scene location as their origin', () => {
    const prompt = wholeSceneSystemPrompt(scene, {
      legalDestinationIds: ['mistwood-mill'], participantMovement: elsewhere,
    });
    expect(prompt).toContain('lin-yingxue is at mistwood-mill');
    // The ART-157 sentence, which asserted one origin for everyone, must be gone when per-character
    // positions are known — it is the sentence that was false.
    expect(prompt).not.toContain(`fromLocationId must be ${JSON.stringify(scene.locationId)}.`);
  });

  it('is offered only destinations connected to where they actually are', () => {
    const prompt = wholeSceneSystemPrompt(scene, {
      legalDestinationIds: ['mistwood-mill'], participantMovement: elsewhere,
    });
    // From the mill, the hall. NOT the scene-level list, which is computed from the hall.
    expect(prompt).toContain('lin-yingxue is at mistwood-mill; if lin-yingxue moves');
    expect(prompt).toContain('["mistwood-hall"]');
  });

  it('is told plainly when they may not move, rather than being left out', () => {
    // A character absent from a list of who MAY move is a character the model reads as
    // unconstrained — the same reasoning ART-157 gives for saying so explicitly.
    const prompt = wholeSceneSystemPrompt(scene, {
      legalDestinationIds: [],
      participantMovement: {
        'gao-wenrui': { fromLocationId: 'mistwood-hall', destinations: [] },
        'lin-yingxue': { fromLocationId: 'mistwood-mill', destinations: ['mistwood-hall'] },
      },
    });
    expect(prompt).toContain('gao-wenrui is at mistwood-hall and may not move in this scene');
  });

  it('demonstrates a movement the NAMED character can actually make', () => {
    /**
     * The example names `scene.participantIds[0]`. Before ART-200 it combined that character with
     * the scene's location and the scene-level destination list, so for a character standing
     * elsewhere the one worked example was an illegal move — the ART-196 failure, again.
     */
    const example = exampleFrom(wholeSceneSystemPrompt(scene, {
      legalDestinationIds: ['mistwood-mill'],
      participantMovement: {
        'gao-wenrui': { fromLocationId: 'mistwood-paper', destinations: ['mistwood-hall'] },
        'lin-yingxue': { fromLocationId: 'mistwood-mill', destinations: ['mistwood-hall'] },
      },
    })) as { stateChanges: Array<{ type: string; fromLocationId?: string; toLocationId?: string }> };

    const move = example.stateChanges.find(({ type }) => type === 'character_location_changed');
    expect(move).toBeDefined();
    expect(move?.fromLocationId).toBe('mistwood-paper');
    expect(move?.toLocationId).toBe('mistwood-hall');
  });

  it('demonstrates no movement at all when the named character cannot make one', () => {
    const example = exampleFrom(wholeSceneSystemPrompt(scene, {
      // The scene-level list is non-empty, and before ART-200 that alone decided the example.
      legalDestinationIds: ['mistwood-mill'],
      participantMovement: {
        'gao-wenrui': { fromLocationId: 'mistwood-paper', destinations: [] },
      },
    })) as { stateChanges: Array<{ type: string }> };

    expect(example.stateChanges.map(({ type }) => type)).toEqual(['character_memory_formed']);
  });

  it('keeps the ART-157 scene-level rule for callers that supply no positions', () => {
    // Every pure scene-parsing test calls it that way, and the rule is correct under its own
    // assumption. This change adds precision where it is available; it removes nothing.
    const prompt = wholeSceneSystemPrompt(scene, { legalDestinationIds: ['mistwood-mill'] });
    expect(prompt).toContain(`fromLocationId must be ${JSON.stringify(scene.locationId)}.`);
  });
});

describe('participantMovementFor derives positions from the snapshot', () => {
  const snapshot = {
    characters: [
      { characterId: 'gao-wenrui', currentLocationId: 'mistwood-hall' },
      { characterId: 'lin-yingxue', currentLocationId: 'mistwood-mill' },
    ],
    locations: [
      { locationId: 'mistwood-hall', active: true, capacity: 8, occupancy: 1, connectedLocationIds: ['mistwood-mill'] },
      { locationId: 'mistwood-mill', active: true, capacity: 8, occupancy: 1, connectedLocationIds: ['mistwood-hall'] },
      { locationId: 'mistwood-shut', active: false, capacity: 8, occupancy: 0, connectedLocationIds: ['mistwood-mill'] },
    ],
  } as never;

  it('gives each participant their own origin, not the scene’s', () => {
    const movement = participantMovementFor(snapshot, scene);
    expect(movement['gao-wenrui'].fromLocationId).toBe('mistwood-hall');
    expect(movement['lin-yingxue'].fromLocationId).toBe('mistwood-mill');
  });

  it('computes destinations from that origin, and filters an inactive one', () => {
    const movement = participantMovementFor(snapshot, scene);
    // From the mill: the hall is connected and open; `mistwood-shut` is connected and inactive.
    expect(movement['lin-yingxue'].destinations).toEqual(['mistwood-hall']);
  });

  it('omits a participant the snapshot does not know, rather than inventing an origin', () => {
    // Defaulting to the scene's location is precisely the assumption this replaces.
    const movement = participantMovementFor(snapshot, { participantIds: ['nobody'] });
    expect(movement).toEqual({});
  });
});

// =============================================================================
// Identifiers the author cannot know (ART-201)
// =============================================================================

/**
 * Fifth stop of the same class:
 *
 *   mistwood day 5 afternoon — UNKNOWN_EVENT_REFERENCE at validate_canon
 *   "causal event does not exist"
 *
 * `validateCanon` checks `causedByEventIds` against the world's known event ids, and a scene author
 * is given none. The worked example carries `[]` and nothing said it had to stay empty.
 *
 * Each case pairs the prompt sentence with the validator that enforces it. A rule stated to the
 * model with no validator behind it is decoration, and a validator the prompt never mentions is
 * what stopped this world five times running.
 */
describe('the prompt constrains every identifier the author cannot know', () => {
  const prompt = wholeSceneSystemPrompt(scene, { legalDestinationIds: [] });

  /** The well-formed baseline as a ProposedEvent, for one field at a time to be broken. */
  const event = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 1, worldId: scene.worldId, idempotencyKey: `${scene.sceneId}:1`,
    proposedBy: { type: 'system' }, worldDay: scene.worldDay, timeSlot: scene.timeSlot,
    eventType: 'conversation', locationId: scene.locationId,
    participantIds: [scene.participantIds[0]], causedByEventIds: [] as string[],
    publicSummary: '兩人對質。',
    stateChanges: [{
      type: 'character_memory_formed', characterId: scene.participantIds[0],
      content: '停頓。', interpretation: '有所隱瞞。',
      importance: 0.5, emotionalWeight: 0.4, confidence: 0.7, visibility: 'private',
    }] as unknown[],
    ...overrides,
  });

  /** The rule context `validateCanon` is given on the live path: the world's real entity ids. */
  const ruleContext = {
    worldId: scene.worldId,
    rules: [],
    characterIds: [...scene.participantIds],
    locationIds: [scene.locationId, 'mistwood-mill'],
    itemIds: [],
    knownEventIds: ['mistwood#event#1'],
  } as never;

  it('accepts the baseline, so every case below is about the one field it breaks', () => {
    expect(validateCanon(event() as never, worldWithParticipants(), ruleContext)).toBeNull();
  });

  it('refuses an invented causal event id, and requires an empty array', () => {
    // The live failure.
    const invalid = event({ causedByEventIds: ['mistwood#event#999'] });
    expect(validateCanon(invalid as never, worldWithParticipants(), ruleContext))
      .toMatchObject({ code: 'UNKNOWN_EVENT_REFERENCE' });
    expect(prompt).toContain('causedByEventIds must be an empty array');
    expect(prompt).toContain('any id you write will not exist');
  });

  it('refuses a fact about a character who does not exist, and names who may be a subject', () => {
    const invalid = event({
      stateChanges: [{
        type: 'fact_created', subjectType: 'character', subjectId: 'nobody',
        predicate: 'mood', value: 'tense', visibility: 'public',
      }],
    });
    expect(validateCanon(invalid as never, worldWithParticipants(), ruleContext))
      .toMatchObject({ code: 'UNKNOWN_CHARACTER_REFERENCE' });
    expect(prompt).toContain('A fact_created or a rumor claim may only be about a character in');
  });

  it('refuses a world fact whose subject is not the world id, and states the value to use', () => {
    const invalid = event({
      stateChanges: [{
        type: 'fact_created', subjectType: 'world', subjectId: 'somewhere-else',
        predicate: 'weather', value: 'rain', visibility: 'public',
      }],
    });
    expect(validateCanon(invalid as never, worldWithParticipants(), ruleContext))
      .toMatchObject({ code: 'INVALID_FACT_SUBJECT' });
    expect(prompt).toContain(`a world subject must use subjectId ${JSON.stringify(scene.worldId)}`);
  });

  it('refuses two facts with the same subject and predicate in one event, and says so', () => {
    const fact = {
      type: 'fact_created', subjectType: 'world', subjectId: scene.worldId,
      predicate: 'weather', value: 'rain', visibility: 'public',
    };
    const invalid = event({ stateChanges: [fact, { ...fact, value: 'clear' }] });
    expect(validateCanon(invalid as never, worldWithParticipants(), ruleContext))
      .toMatchObject({ code: 'INVALID_FACT_SUBJECT' });
    expect(prompt).toContain('may not create two facts with the same subject and predicate');
  });

  it('forbids the item variants, which need an id and an owner the author has not been given', () => {
    // Not a validator pairing: the point is that the request stops ASKING, as ART-197 did for
    // character_state_changed. An item fact would fail UNKNOWN_ITEM_REFERENCE against a world with
    // no items, and item_transferred additionally needs the unique current owner.
    expect(prompt).toContain('Never use subjectType "item", and never emit item_transferred');
  });

  it('forbids the other whole-entity variants for the same reason', () => {
    /**
     * `location_state_changed` and `organization_state_changed` are required by strict mode to
     * carry EVERY property of the entity — a location's name, description, type, capacity and
     * connection list — and the author is given none of them. They would fail for the same reason
     * `character_state_changed` does: the request asks for a current value it never supplied.
     */
    expect(prompt).toContain('location_state_changed or organization_state_changed');
  });

  it('pins the event location to the scene location', () => {
    expect(prompt).toContain(`locationId must be ${JSON.stringify(scene.locationId)}`);
  });
});
