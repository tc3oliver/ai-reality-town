import { readFileSync } from 'node:fs';
import { assertCharacterIntentContextAuthorization, parseCharacterIntentContext, validateCharacterIntent } from './characterIntent';

const context = () => ({ schemaVersion: 1, intentRunId: 'intent:run:1', directorRunId: 'director:1', worldId: 'w', worldDay: 4,
  timeSlot: 'noon', characterId: 'a', persona: { summary: 'Careful reporter', source: { sourceId: 'seed:a', sourceEventId: null } },
  currentGoal: { value: 'Verify the ledger', source: { sourceId: 'goal:a', sourceEventId: 'w#event#2' } },
  emotionalState: { value: 'anxious', source: { sourceId: 'state:a', sourceEventId: 'w#event#3' } },
  currentLocationId: 'station', reachableLocationIds: ['square'],
  knowledge: [{ knowledgeId: 'k1', belief: 'The ledger is nearby', sourceEventId: 'w#event#2' }],
  memories: [{ memoryId: 'm1', content: 'Saw a locked cabinet', sourceEventId: 'w#event#1', retrievalScore: 0.8 }],
  assets: [{ assetId: 'camera', sourceEventId: 'w#event#0' }],
  activeArcs: [{ arcId: 'arc-1', currentQuestion: 'Who hid it?', sourceEventId: 'w#event#1' }],
});
const intent = () => ({ schemaVersion: 1, intentId: 'i1', intentRunId: 'intent:run:1', directorRunId: 'director:1', characterId: 'a',
  action: 'attempt', actionDescription: 'Photograph the cabinet', targetCharacterId: null, desiredLocationId: 'station',
  rationale: 'Preserve evidence', urgency: 0.7, knowledgeIds: ['k1'], memoryIds: ['m1'], assetIds: ['camera'], arcIds: ['arc-1'], downgradeReason: null });

describe('FR-C003 knowledge-scoped character intents', () => {
  it('retains traceable provenance for every allowed cognition input', () => {
    const parsed = parseCharacterIntentContext(context());
    expect(parsed.persona.source).toEqual({ sourceId: 'seed:a', sourceEventId: null });
    expect(parsed.currentGoal.source.sourceEventId).toBe('w#event#2');
    expect(parsed.emotionalState.source.sourceEventId).toBe('w#event#3');
    expect(parsed.knowledge[0].sourceEventId).toBe('w#event#2');
    expect(parsed.memories[0]).toMatchObject({ sourceEventId: 'w#event#1', retrievalScore: 0.8 });
    expect(parsed.assets[0].sourceEventId).toBe('w#event#0');
    expect(parsed.activeArcs[0].sourceEventId).toBe('w#event#1');
  });
  it('accepts a strict structured intent without world mutation or outcome fields', () => {
    expect(validateCharacterIntent(intent(), context())).toMatchObject({ disposition: 'accepted', intent: { action: 'attempt', knowledgeIds: ['k1'] } });
    expect(() => validateCharacterIntent({ ...intent(), stateChanges: [] }, context())).toThrow(/world-mutating fields are forbidden/);
    expect(() => validateCharacterIntent({ ...intent(), finalOutcome: 'The cabinet opens' }, context())).toThrow(/world-mutating fields are forbidden/);
  });
  it.each([['knowledgeIds', ['other']], ['memoryIds', ['other']], ['assetIds', ['other']], ['arcIds', ['other']]])
  ('rejects unauthorized %s', (field, value) => {
    expect(() => validateCharacterIntent({ ...intent(), [field]: value }, context())).toThrow(/unauthorized/);
  });
  it('downgrades an unavailable-location action to a safe wait without changing the world', () => {
    expect(validateCharacterIntent({ ...intent(), desiredLocationId: 'secret-room' }, context())).toMatchObject({
      disposition: 'downgraded', intent: { action: 'wait', desiredLocationId: 'station', urgency: 0, downgradeReason: 'INTENT_LOCATION_UNAVAILABLE' },
    });
  });
  it('rejects cross-run/character context and malformed untraceable inputs', () => {
    expect(() => validateCharacterIntent({ ...intent(), characterId: 'b' }, context())).toThrow(/provenance does not match/);
    expect(() => parseCharacterIntentContext({ ...context(), persona: { summary: 'Reporter' } })).toThrow();
    expect(() => parseCharacterIntentContext({ ...context(), memories: [{ ...context().memories[0], retrievalScore: 2 }] })).toThrow(/from 0 to 1/);
  });
  it('rejects cognition context that is not authorized by the character projection', () => {
    const authorization = { knowledgeIds: new Set(['k1']), memoryIds: new Set(['m1']), assetIds: new Set(['camera']), currentLocationId: 'station' };
    expect(assertCharacterIntentContextAuthorization(context(), authorization).characterId).toBe('a');
    expect(() => assertCharacterIntentContextAuthorization({ ...context(), knowledge: [{ knowledgeId: 'other-secret', belief: 'secret', sourceEventId: 'e' }] }, authorization)).toThrow(/another character's or unknown knowledge/);
    expect(() => assertCharacterIntentContextAuthorization({ ...context(), currentLocationId: 'clinic' }, authorization)).toThrow(/does not match/);
  });
  it('keeps idempotent persistence and reads internal-only', () => {
    const source = readFileSync('convex/simulation/characterIntentFunctions.ts', 'utf8');
    expect(source).toContain('deduplicated: true'); expect(source).toContain('internalMutation({'); expect(source).toContain('internalQuery({');
    expect(source).not.toMatch(/\bmutation\(\{|\bquery\(\{/);
  });
});
