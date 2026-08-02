import { readFileSync } from 'node:fs';
import type { ArcProjectionEvent, ArcProjectionFields } from './model';
import {
  ArcProjectionError,
  parseArcProjectionFields,
  replayArcProjection,
  validateArcProjectionReferences,
} from './projection';

function fields(): ArcProjectionFields {
  return {
    title: 'The Missing Ledger',
    premise: 'A hidden ledger threatens Mistwood leadership.',
    currentQuestion: 'Who hid the ledger and why?',
    coreCharacterIds: ['cassia', 'rowan'],
    incitingEventId: 'w#event#0',
    latestTurningPointEventId: null,
    essentialFactIds: ['fact-ledger-hidden'],
    unresolvedQuestions: ['Who owns the key?'],
    resolvedQuestions: [],
    recommendedEntryEventId: null,
    heatScore: 42,
  };
}

function event(revision: number, overrides: Partial<ArcProjectionEvent> = {}): ArcProjectionEvent {
  return {
    schemaVersion: 1, worldId: 'w', arcId: 'arc-ledger', revision,
    kind: revision === 0 ? 'initialized' : 'updated', fields: fields(),
    sourceEventId: `w#event#${revision}`, sourceEventSequenceNumber: revision,
    worldDay: revision + 1, timeSlot: revision === 0 ? 'morning' : 'evening',
    ...overrides,
  };
}

function expectProjectionError(operation: () => unknown, path?: string): void {
  try {
    operation();
    throw new Error('expected ArcProjectionError');
  } catch (error) {
    expect(error).toBeInstanceOf(ArcProjectionError);
    if (path !== undefined) expect(error).toMatchObject({ path });
  }
}

describe('FR-F003 Story Arc projection data contract', () => {
  it('stores every required field and deterministically replays accepted-event progress with lifecycle status', () => {
    const updateFields = {
      ...fields(),
      currentQuestion: 'Will Cassia publish the ledger?',
      latestTurningPointEventId: 'w#event#1',
      resolvedQuestions: ['Who owns the key?'],
      unresolvedQuestions: ['Will Cassia publish the ledger?'],
      recommendedEntryEventId: 'w#event#1',
      heatScore: 76,
    };
    const events = [event(0), event(1, { fields: updateFields })];
    const projection = replayArcProjection(events, 'escalating');
    expect(projection).toEqual({
      schemaVersion: 1, worldId: 'w', arcId: 'arc-ledger', ...updateFields,
      status: 'escalating',
      lastProgressTime: { worldDay: 2, timeSlot: 'evening', sourceEventId: 'w#event#1' },
      revision: 1,
    });
    expect(replayArcProjection(structuredClone(events), 'escalating')).toEqual(projection);
  });

  it.each([
    ['title', (value: Record<string, unknown>) => { value.title = ''; }],
    ['premise', (value: Record<string, unknown>) => { delete value.premise; }],
    ['currentQuestion', (value: Record<string, unknown>) => { value.currentQuestion = 7; }],
    ['coreCharacterIds', (value: Record<string, unknown>) => { value.coreCharacterIds = ['cassia', 'cassia']; }],
    ['incitingEventId', (value: Record<string, unknown>) => { value.incitingEventId = null; }],
    ['latestTurningPointEventId', (value: Record<string, unknown>) => { value.latestTurningPointEventId = 3; }],
    ['essentialFactIds', (value: Record<string, unknown>) => { value.essentialFactIds = ['fact', 'fact']; }],
    ['resolvedQuestions', (value: Record<string, unknown>) => { value.resolvedQuestions = ['Who owns the key?']; }],
    ['recommendedEntryEventId', (value: Record<string, unknown>) => { value.recommendedEntryEventId = false; }],
    ['heatScore', (value: Record<string, unknown>) => { value.heatScore = 101; }],
    ['unknown', (value: Record<string, unknown>) => { value.secretPrompt = 'no'; }],
  ])('runtime rejects malformed %s', (_name, mutate) => {
    const value = structuredClone(fields()) as unknown as Record<string, unknown>;
    mutate(value);
    expectProjectionError(() => parseArcProjectionFields(value));
  });

  it('rejects unknown character/event references and sequence gaps or wrong event kinds', () => {
    const parsed = parseArcProjectionFields(fields());
    expectProjectionError(
      () => validateArcProjectionReferences(parsed, new Set(['cassia']), new Set(['w#event#0'])),
      'fields.coreCharacterIds',
    );
    expectProjectionError(
      () => validateArcProjectionReferences(parsed, new Set(['cassia', 'rowan']), new Set()),
      'fields.incitingEventId',
    );
    expectProjectionError(() => replayArcProjection([event(0), event(2)], 'active'));
    expectProjectionError(() => replayArcProjection([event(0, { kind: 'updated' })], 'active'));
  });

  it('keeps storage and replay queries internal and does not publish essential facts', () => {
    const source = readFileSync('convex/story/projectionFunctions.ts', 'utf8');
    expect(source).toContain('internalMutation({');
    expect(source).toContain('internalQuery({');
    expect(source).not.toMatch(/\bmutation\(\{/);
    expect(source).not.toMatch(/\bquery\(\{/);
  });
});
