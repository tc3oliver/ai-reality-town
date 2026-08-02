import { readFileSync } from 'node:fs';
import type { StoryArcProjectionData, StoryArcStatus } from './model';
import { createArcResolutionDecision, detectArcStagnation, type ArcResolutionAction } from './resolution';

function projection(status: StoryArcStatus = 'active'): StoryArcProjectionData {
  return {
    schemaVersion: 1, worldId: 'w', arcId: 'arc', title: 'Missing Mayor', premise: 'The mayor vanished.',
    currentQuestion: 'Where is she?', status, coreCharacterIds: ['c1'], incitingEventId: 'w#event#0',
    latestTurningPointEventId: null, essentialFactIds: [], unresolvedQuestions: ['Where?'], resolvedQuestions: [],
    recommendedEntryEventId: null, heatScore: 50,
    lastProgressTime: { worldDay: 3, timeSlot: 'night', sourceEventId: 'w#event#3' }, revision: 0,
  };
}

const base = (action: ArcResolutionAction, fromStatus: StoryArcStatus = 'active') => ({
  worldId: 'w', arcId: 'arc', action, fromStatus, fromTier: 'major' as const,
  targetArcId: null, outcome: null, consequences: [], sourceEventId: 'w#event#20',
  sourceEventSequenceNumber: 20, reason: 'operator resolution', decidedAtWorldDay: 20,
});

describe('FR-F005 arc stagnation and resolution', () => {
  it('emits one stable operator prompt at exactly 14 world days, not before', () => {
    expect(detectArcStagnation(projection(), 'major', 16)).toBeNull();
    const prompt = detectArcStagnation(projection(), 'major', 17);
    expect(prompt).toMatchObject({
      promptId: 'w:arc:stagnant:w#event#3', stagnantWorldDays: 14,
      sourceEventId: 'w#event#3', tier: 'major', status: 'active',
    });
    expect(prompt?.suggestedActions).toEqual([
      'suggest_outcome', 'merge', 'downgrade', 'enter_resolving', 'background_compress',
    ]);
    expect(detectArcStagnation(projection('resolved'), 'major', 30)).toBeNull();
  });

  it('supports non-destructive suggestion, merge, downgrade, and resolving paths', () => {
    expect(createArcResolutionDecision(base('suggest_outcome'))).toMatchObject({ resultingStatus: 'active', resultingTier: 'major' });
    expect(createArcResolutionDecision({ ...base('merge'), targetArcId: 'arc-2' })).toMatchObject({ targetArcId: 'arc-2', resultingStatus: 'active' });
    expect(createArcResolutionDecision(base('downgrade'))).toMatchObject({ resultingTier: 'minor', resultingStatus: 'active' });
    expect(createArcResolutionDecision(base('enter_resolving'))).toMatchObject({ fromStatus: 'active', resultingStatus: 'resolving' });
  });

  it('requires valid lifecycle transitions so a major arc cannot silently disappear', () => {
    expect(() => createArcResolutionDecision(base('archive'))).toThrow(/only a resolved arc may archive/);
    expect(() => createArcResolutionDecision({ ...base('resolve'), fromStatus: 'active' })).toThrow(/only a resolving arc may resolve/);
    expect(() => createArcResolutionDecision({ ...base('merge'), targetArcId: 'arc' })).toThrow(/different target arc/);
    expect(() => createArcResolutionDecision({ ...base('downgrade'), fromTier: 'minor' })).toThrow(/only a major arc/);
  });

  it('retains outcome and source-proven ART-82 consequences when resolving', () => {
    const decision = createArcResolutionDecision({
      ...base('resolve', 'resolving'), outcome: 'The mayor returned with the ledger.',
      consequences: [{
        consequenceId: 'consequence-1', summary: 'Lin no longer trusts the mayor.',
        affectedCharacterIds: ['c1'], affectsWorldSummary: true, sourceEventId: 'w#event#20',
      }],
    });
    expect(decision).toMatchObject({
      decisionId: 'arc:resolution:20', resultingStatus: 'resolved',
      outcome: 'The mayor returned with the ledger.',
    });
    expect(decision.consequences[0]).toMatchObject({ sourceEventId: decision.sourceEventId, affectedCharacterIds: ['c1'] });
    expect(() => createArcResolutionDecision({ ...base('resolve', 'resolving'), outcome: 'Done' })).toThrow(/outcome and consequences/);
    expect(() => createArcResolutionDecision({
      ...base('resolve', 'resolving'), outcome: 'Done', consequences: [{
        consequenceId: 'c', summary: 'Changed', affectedCharacterIds: [], affectsWorldSummary: true,
        sourceEventId: 'w#event#19',
      }],
    })).toThrow(/resolution Accepted Event/);
  });

  it('archives and background-compresses only resolved history with retained evidence', () => {
    const terminal = {
      outcome: 'Question answered', consequences: [{ consequenceId: 'c', summary: 'History retained',
        affectedCharacterIds: [], affectsWorldSummary: true, sourceEventId: 'w#event#20' }],
    };
    expect(createArcResolutionDecision({ ...base('archive', 'resolved'), ...terminal }).resultingStatus).toBe('archived');
    expect(createArcResolutionDecision({ ...base('background_compress', 'resolved'), ...terminal }).resultingStatus).toBe('archived');
    expect(() => createArcResolutionDecision({ ...base('background_compress', 'active'), ...terminal })).toThrow(/only resolved history/);
  });

  it('keeps operator and persistence surfaces internal', () => {
    const source = readFileSync('convex/story/resolutionFunctions.ts', 'utf8');
    expect(source).toContain('internalMutation({');
    expect(source).toContain('internalQuery({');
    expect(source).not.toMatch(/\bmutation\(\{/);
    expect(source).not.toMatch(/\bquery\(\{/);
  });
});
