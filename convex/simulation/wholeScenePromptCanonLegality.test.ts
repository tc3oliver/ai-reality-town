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
import { participantMovementFor, participantStateFor, recordedCharacterState } from './worldDayLive';
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

  it('stops asking for a variant it cannot supply the context for', () => {
    /**
     * `character_knowledge_learned` needs a causal event id, and ART-203 removed
     * `causedByEventIds` from the request entirely — so the author has none and the variant cannot
     * be used correctly from here at all.
     *
     * `character_state_changed` was prohibited alongside it by ART-197 for the same kind of
     * reason. ART-198 supplies the missing context instead, so it is now a WHITELIST rather than a
     * prohibition; this scene carries no recorded state, which is the prohibited case.
     */
    const text = prompt();
    // ART-206 made the knowledge variant unavailable STRUCTURALLY, so the prose no longer forbids
    // it by name — it points at the schema, which is the thing that now enforces it.
    expect(text).toContain('there is no knowledge, item, location or organization change among them');
    expect(text).toContain('Never emit character_state_changed: this scene records no current value');
  });

  it('allows character_state_changed exactly where a current value is known (ART-198)', () => {
    const text = wholeSceneSystemPrompt(scene, {
      legalDestinationIds: [],
      participantState: {
        'gao-wenrui': { emotion: '平靜', occupation: '鎮長助理' },
      },
    });

    expect(text).toContain('allowed ONLY for these characters and fields');
    // The value is quoted, because it is the ONLY legal `fromValue` and the author cannot know it.
    expect(text).toContain('gao-wenrui -> {"emotion":"平靜","occupation":"鎮長助理"}');
    expect(text).toContain('toValue different from it');
    // The blanket prohibition is gone for this scene, and only for this scene.
    expect(text).not.toContain('Never emit character_state_changed');
  });

  it('keeps a participant with nothing recorded out of the whitelist', () => {
    // An absent entry is a prohibition, not an invitation to guess — the ART-157 shape.
    const text = wholeSceneSystemPrompt(scene, {
      legalDestinationIds: [],
      participantState: { 'gao-wenrui': { emotion: '平靜' } },
    });
    expect(text).toContain('gao-wenrui ->');
    expect(text).not.toContain('lin-yingxue ->');
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

  it('refuses an invented causal event id, and tells the model not to emit the field', () => {
    // The live failure, twice: ART-201 asked in prose and one slot obeyed while the next did not.
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

  it('forbids item fact SUBJECTS, which the schema cannot express as a type', () => {
    // `subjectType` is an enum the schema must keep whole, so this one stays a prose rule. The
    // whole-entity VARIANTS are handled structurally instead — see the ART-206 block below.
    expect(prompt).toContain('Never use subjectType "item"');
  });

  it('pins the event location to the scene location', () => {
    expect(prompt).toContain(`locationId must be ${JSON.stringify(scene.locationId)}`);
  });
});

// =============================================================================
// A field with one valid value is not asked for (ART-203)
// =============================================================================

describe('causedByEventIds is filled in rather than requested', () => {
  const sceneOutput = (event: Record<string, unknown>) => ({
    schemaVersion: 1, sceneId: scene.sceneId, sceneSummary: '兩人對質。',
    keyActions: [{ characterId: scene.participantIds[0], action: '推出帳冊。' }],
    dialogueHighlights: [],
    proposedEvents: [event],
    relationshipChanges: [], knowledgeChanges: [], memories: [], rumors: [], continuityWarnings: [],
  });

  const baseEvent = (overrides: Record<string, unknown> = {}) => ({
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

  it('is absent from the schema, so the model is never asked for it', () => {
    const item = ((WHOLE_SCENE_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>)
      .proposedEvents.items as Record<string, Record<string, unknown>>);
    expect(Object.keys(item.properties)).not.toContain('causedByEventIds');
    // `strictObject` derives `required` from `properties`, so absent from one is absent from both.
    expect(item.required as unknown as string[]).not.toContain('causedByEventIds');
  });

  it('is absent from the SCHEMA the prompt serializes, while the example still shows the value', () => {
    /**
     * The two do different jobs and must agree. The schema no longer DEMANDS the field — a field
     * with one valid value should not be one the model is invited to invent — while the worked
     * example still demonstrates `[]`, which is the value the model should write if it writes one
     * at all. An instruction that contradicted the example would be worse than either alone.
     */
    const prompt = wholeSceneSystemPrompt(scene, { legalDestinationIds: [] });
    const serializedSchema = JSON.stringify(WHOLE_SCENE_JSON_SCHEMA);
    expect(serializedSchema).not.toContain('causedByEventIds');
    expect(prompt).toContain(serializedSchema);
    expect(prompt).toContain('"causedByEventIds":[]');
  });

  it('parses an event that omits it, filling the only value it could correctly hold', () => {
    // The ART-139 rule, applied to a third field: the caller already knows the answer.
    const parsed = parseWholeSceneOutput(sceneOutput(baseEvent()), scene);
    expect(parsed.proposedEvents[0].causedByEventIds).toEqual([]);
  });

  it('does NOT overwrite a value the model did supply', () => {
    /**
     * Filling an omitted field is a parse; overwriting a supplied one is a repair that changes
     * meaning. An invented causal link should be refused by Canon, not quietly erased here —
     * erasing it would make a hallucination invisible.
     */
    const parsed = parseWholeSceneOutput(
      sceneOutput(baseEvent({ causedByEventIds: ['mistwood#event#999'] })), scene);
    expect(parsed.proposedEvents[0].causedByEventIds).toEqual(['mistwood#event#999']);
  });
});

// =============================================================================
// The at-most-once-per-event family (ART-204)
// =============================================================================

/**
 * Sixth stop of the same class, on fresh day-6 slots after ART-203:
 *
 *   mistwood day 6 morning — DUPLICATE_CHARACTER_MOVEMENT at validate_canon
 *   mistwood day 6 noon    — DUPLICATE_CHARACTER_MOVEMENT at validate_canon
 *   "a character may move at most once per event"
 *
 * The model narrated a character walking somewhere and then walking on again, and wrote both hops
 * as `character_location_changed` entries on the same event.
 */
describe('the at-most-once-per-event rules are stated', () => {
  const prompt = wholeSceneSystemPrompt(scene, { legalDestinationIds: ['mistwood-mill'] });

  const eventWith = (stateChanges: unknown[]) => ({
    schemaVersion: 1, worldId: scene.worldId, idempotencyKey: `${scene.sceneId}:1`,
    proposedBy: { type: 'system' }, worldDay: scene.worldDay, timeSlot: scene.timeSlot,
    eventType: 'movement', locationId: scene.locationId,
    participantIds: [scene.participantIds[0]], causedByEventIds: [] as string[],
    publicSummary: '有人離開了。', stateChanges,
  });

  it('refuses two movements of one character in one event, and says so', () => {
    const projection = worldWithParticipants();
    const twice = eventWith([
      {
        type: 'character_location_changed', characterId: scene.participantIds[0],
        fromLocationId: scene.locationId, toLocationId: 'mistwood-mill',
      },
      {
        type: 'character_location_changed', characterId: scene.participantIds[0],
        fromLocationId: 'mistwood-mill', toLocationId: scene.locationId,
      },
    ]);
    expect(validateCanon(twice as never, projection))
      .toMatchObject({ code: 'DUPLICATE_CHARACTER_MOVEMENT' });
    expect(prompt).toContain('at most one character_location_changed in a single event');
  });

  it('accepts a single movement, so the rule is about the duplicate and not about movement', () => {
    // The negative control: without it the assertion above would pass on a fixture that was
    // invalid for some unrelated reason.
    const once = eventWith([{
      type: 'character_location_changed', characterId: scene.participantIds[0],
      fromLocationId: scene.locationId, toLocationId: 'mistwood-mill',
    }]);
    expect(validateCanon(once as never, worldWithParticipants())).toBeNull();
  });

  it('states the per-SLOT movement rule as well, which is a different refusal', () => {
    // A character appears in one scene per slot, but a scene may propose several events, and a
    // second movement in a later event is refused by CHARACTER_ALREADY_MOVED_THIS_SLOT.
    expect(prompt).toContain('may move at most ONCE in this whole scene');
  });

  it('names the other members of the family', () => {
    expect(prompt).toContain('character_life_changed');
    expect(prompt).toContain('rumor_belief_changed');
    expect(prompt).toContain('rumor_corrected');
  });
});

// =============================================================================
// The recorded state the whitelist is built from (ART-198)
// =============================================================================

/**
 * The trap this task was scoped around, and the reason `recordedState` exists beside
 * `emotionalState` rather than replacing it.
 *
 * `LiveCharacter.emotionalState` is `projection.characterStates[id]?.emotion ?? 'steady'`. That
 * default is right for the Director — a character with no recorded mood still needs one to plan
 * around — and it cannot be shown to an author: `validateCanon` compares `fromValue` against the
 * RAW projected value, and `equal(undefined, 'steady')` is false. Passing the defaulted value
 * through would have reintroduced `CHARACTER_STATE_PRECONDITION_FAILED` for every character whose
 * mood Canon has never set, which is most of them in a young world.
 */
describe('participantStateFor offers only what Canon actually recorded', () => {
  const snapshotWith = (characters: Array<{ characterId: string; recordedState?: Record<string, string> }>) =>
    ({ characters } as never);

  it('offers a field Canon has a value for', () => {
    const states = participantStateFor(
      snapshotWith([{ characterId: 'gao-wenrui', recordedState: { emotion: '平靜' } }]), scene);
    expect(states).toEqual({ 'gao-wenrui': { emotion: '平靜' } });
  });

  it('omits a character with nothing recorded, rather than offering a default', () => {
    // The `?? 'steady'` trap. An offered `'steady'` would be refused by the very check it was
    // offered to satisfy.
    const states = participantStateFor(
      snapshotWith([{ characterId: 'gao-wenrui' }, { characterId: 'lin-yingxue' }]), scene);
    expect(states).toEqual({});
  });

  it('omits a character the snapshot does not know at all', () => {
    expect(participantStateFor(snapshotWith([]), scene)).toEqual({});
  });

  it('offers only the narrative-text fields, not the structural ones', () => {
    /**
     * `organization_memberships` needs organization ids the author has not been given;
     * `availability` and `active` are structural flags, and `active` is an assertion about
     * existence that a scene has no business flipping.
     */
    const states = participantStateFor(snapshotWith([{
      characterId: 'gao-wenrui',
      recordedState: { emotion: '平靜', health: '良好', finance: '拮据', occupation: '助理' },
    }]), scene);
    expect(Object.keys(states['gao-wenrui']).sort())
      .toEqual(['emotion', 'finance', 'health', 'occupation']);
  });

  it('quotes the recorded value verbatim into the rule, so fromValue can be copied', () => {
    // End to end: what the snapshot recorded is what the author is told to write.
    const text = wholeSceneSystemPrompt(scene, {
      legalDestinationIds: [],
      participantState: participantStateFor(
        snapshotWith([{ characterId: 'lin-yingxue', recordedState: { emotion: '警惕' } }]), scene),
    });
    expect(text).toContain('lin-yingxue -> {"emotion":"警惕"}');
  });
});

describe('recordedCharacterState decides which fields are offerable at all', () => {
  it('keeps the four narrative-text fields', () => {
    expect(recordedCharacterState({
      emotion: '平靜', health: '良好', finance: '拮据', occupation: '助理',
    })).toEqual({ emotion: '平靜', health: '良好', finance: '拮据', occupation: '助理' });
  });

  it('drops the structural fields, whatever the projection holds for them', () => {
    /**
     * Found by fault injection: the filter had no test of its own, because
     * `participantStateFor` copies whatever it is handed and the narrowing happens one layer down.
     *
     * `organization_memberships` needs organization ids the author has not been given;
     * `availability` and `active` are structural, and `active` is an assertion about existence a
     * scene has no business flipping.
     */
    expect(recordedCharacterState({
      emotion: '平靜', availability: 'free', active: true, organization_memberships: ['mill-guild'],
    })).toEqual({ emotion: '平靜' });
  });

  it('drops a non-string value rather than coercing it', () => {
    // A value that cannot be quoted back as a `fromValue` cannot be changed correctly, so offering
    // it would be offering a change guaranteed to be refused.
    expect(recordedCharacterState({ emotion: 42, health: '良好' })).toEqual({ health: '良好' });
  });

  it('returns undefined when nothing is recorded, rather than an empty object', () => {
    // Absent means "may not be changed". An empty object would read as a character who is
    // present in the whitelist with no fields, which is a different and confusing thing.
    expect(recordedCharacterState(undefined)).toBeUndefined();
    expect(recordedCharacterState({ availability: 'free' })).toBeUndefined();
    expect(recordedCharacterState({ emotion: '' })).toBeUndefined();
  });
});

// =============================================================================
// The schema stops offering what the request cannot support (ART-206)
// =============================================================================

/**
 * From a live slot, named exactly by the ART-195 detail:
 *
 *   [SCENE_SIMULATION_FAILED] whole-scene provider failed:
 *   [INVALID_EVENT_SHAPE] CanonError at output_validation (retryable):
 *   [INVALID_EVENT_SHAPE] sourceEventId has invalid reference format
 *
 * The model emitted a `character_knowledge_learned` with an invented `sourceEventId`. ART-197 and
 * ART-198 told it never to emit that variant — and the schema went on listing it, so the request
 * was offering and forbidding the same thing.
 *
 * ART-203 settled this shape one level down, for `causedByEventIds`. A variant the request cannot
 * supply the context for should not be in the schema the request sends.
 */
describe('the request schema offers only variants it can support', () => {
  const variantTypes = () => {
    const properties = WHOLE_SCENE_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>;
    const item = properties.proposedEvents.items as Record<string, Record<string, unknown>>;
    const stateChanges = item.properties.stateChanges as Record<string, Record<string, unknown>>;
    const variants = stateChanges.items.anyOf as Array<{
      properties: { type: { const?: string } };
    }>;
    return variants.map(({ properties: p }) => p.type.const);
  };

  it.each([
    ['character_knowledge_learned', 'needs a sourceEventId, and ART-203 removed causedByEventIds'],
    ['item_transferred', 'needs an item id and its unique current owner'],
    ['location_state_changed', 'needs a location’s full current properties'],
    ['organization_state_changed', 'needs an organization id and its current state'],
  ])('does not offer %s — %s', (type) => {
    expect(variantTypes()).not.toContain(type);
    // …and not in the serialized copy the model actually reads, either.
    expect(JSON.stringify(WHOLE_SCENE_JSON_SCHEMA)).not.toContain(`"${type}"`);
  });

  it('still offers character_state_changed, because ART-198 supplies what it needs', () => {
    // The negative control. Removing this one would undo ART-198 rather than complete ART-206.
    expect(variantTypes()).toContain('character_state_changed');
  });

  it('still offers the variants an author can fill from what the scene gave it', () => {
    for (const type of ['character_location_changed', 'relationship_changed', 'fact_created',
      'character_memory_formed', 'character_life_changed', 'rumor_originated']) {
      expect(variantTypes()).toContain(type);
    }
  });

  it('says the same thing in prose that the schema enforces, rather than contradicting it', () => {
    // The defect was a request that offered and forbade the same variant. The prose now points at
    // the schema instead of listing prohibitions the schema already makes impossible.
    const text = wholeSceneSystemPrompt(scene, { legalDestinationIds: [] });
    expect(text).toContain('The schema lists every stateChanges type you may use');
    expect(text).toContain('there is no knowledge, item, location or organization change among them');
  });
});
