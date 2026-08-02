import { readFileSync } from 'node:fs';
import type { CharacterIntent, IntentValidationResult } from './characterIntent';
import { groupCharacterIntents, MAX_MAJOR_SCENE_PARTICIPANTS, type SceneGroupingInput } from './sceneGrouping';

const intent = (id: string, characterId: string, location = 'station', arcIds = ['arc-1'], targetCharacterId: string | null = null): CharacterIntent => ({
  schemaVersion: 1, intentId: id, intentRunId: `run:${id}`, directorRunId: 'director:1', characterId,
  action: 'attempt', actionDescription: `Action ${id}`, targetCharacterId, desiredLocationId: location,
  rationale: `Pressure ${id}`, urgency: 0.5, knowledgeIds: [], memoryIds: [], assetIds: [], arcIds, downgradeReason: null,
});
const accepted = (value: CharacterIntent): IntentValidationResult => ({ disposition: 'accepted', intent: value });
const input = (intents: IntentValidationResult[]): SceneGroupingInput => ({ schemaVersion: 1, groupingRunId: 'group:1',
  directorRunId: 'director:1', worldId: 'w', worldDay: 2, timeSlot: 'noon', intents });

describe('FR-C004 conflict-safe scene grouping', () => {
  it('merges related same-slot/location intents and retains every source Intent', () => {
    const result = groupCharacterIntents(input([accepted(intent('i2', 'b')), accepted(intent('i1', 'a'))]));
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]).toMatchObject({ locationId: 'station', participantIds: ['a', 'b'],
      sourceIntentIds: ['i1', 'i2'], arcIds: ['arc-1'], directorRunId: 'director:1' });
    expect(result.decisions).toEqual([
      { intentId: 'i1', disposition: 'grouped', sceneId: 'group:1:scene:1', reason: 'GROUPED_COMPATIBLE_INTENTS' },
      { intentId: 'i2', disposition: 'grouped', sceneId: 'group:1:scene:1', reason: 'GROUPED_COMPATIBLE_INTENTS' },
    ]);
  });
  it('keeps unrelated locations/arcs separate while preventing simultaneous participant conflicts', () => {
    expect(groupCharacterIntents(input([accepted(intent('i1', 'a', 'station', ['arc-1'])), accepted(intent('i2', 'b', 'clinic', ['arc-2']))])).scenes).toHaveLength(2);
    expect(() => groupCharacterIntents(input([
      accepted(intent('i1', 'a', 'station', ['arc-1'], 'shared')),
      accepted(intent('i2', 'b', 'clinic', ['arc-2'], 'shared')),
    ]))).toThrow(/cannot participate in two major scenes/);
    expect(() => groupCharacterIntents(input([accepted(intent('i1', 'a')), accepted(intent('i2', 'a'))])))
      .toThrow(/cannot submit multiple major-scene attempts/);
  });
  it(`defers a connected scene above the ${MAX_MAJOR_SCENE_PARTICIPANTS}-participant cap`, () => {
    const intents = Array.from({ length: MAX_MAJOR_SCENE_PARTICIPANTS + 1 }, (_, index) => accepted(intent(`i${index}`, `c${index}`)));
    const result = groupCharacterIntents(input(intents));
    expect(result.scenes).toEqual([]);
    expect(result.decisions).toHaveLength(MAX_MAJOR_SCENE_PARTICIPANTS + 1);
    expect(result.decisions.every(({ disposition, reason }) => disposition === 'deferred' && reason === 'SCENE_PARTICIPANT_LIMIT')).toBe(true);
  });
  it('defers downgraded/wait intents with their stable reason', () => {
    const waiting = { ...intent('i1', 'a'), action: 'wait' as const, downgradeReason: 'INTENT_LOCATION_UNAVAILABLE' };
    expect(groupCharacterIntents(input([{ disposition: 'downgraded', intent: waiting }]))).toEqual({ scenes: [], decisions: [
      { intentId: 'i1', disposition: 'deferred', sceneId: null, reason: 'INTENT_LOCATION_UNAVAILABLE' },
    ] });
  });
  it('is deterministic, rejects duplicate/mismatched Intents, and never mutates inputs', () => {
    const original = input([accepted(intent('i2', 'b')), accepted(intent('i1', 'a'))]);
    const before = structuredClone(original);
    expect(groupCharacterIntents(original)).toEqual(groupCharacterIntents(original));
    expect(original).toEqual(before);
    expect(() => groupCharacterIntents(input([accepted(intent('i1', 'a')), accepted(intent('i1', 'b'))]))).toThrow(/IDs must be unique/);
    expect(() => groupCharacterIntents(input([accepted({ ...intent('i1', 'a'), directorRunId: 'other' })]))).toThrow(/Director Run/);
  });
  it('keeps persistence idempotent/internal and requires persisted source Intents', () => {
    const source = readFileSync('convex/simulation/sceneGroupingFunctions.ts', 'utf8');
    expect(source).toContain('deduplicated: true'); expect(source).toContain('SCENE_GROUPING_INTENT_NOT_FOUND');
    expect(source).toContain('source Intent context belongs to another world slot');
    expect(source).toContain('internalMutation({'); expect(source).toContain('internalQuery({');
    expect(source).not.toMatch(/\bmutation\(\{|\bquery\(\{/);
    expect(readFileSync('convex/simulation/sceneGrouping.ts', 'utf8')).not.toMatch(/commitProposedEvent|reduceWorldEvent/);
  });
});
