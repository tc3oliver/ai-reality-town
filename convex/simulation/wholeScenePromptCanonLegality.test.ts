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
import { validateEventStructure } from '../canon/validators';
import type { GroupedScene } from './sceneGrouping';
import { WHOLE_SCENE_JSON_SCHEMA, wholeSceneSystemPrompt } from './sceneSimulation';

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
