import type { AcceptedEvent } from '../canon/model';
import {
  CONSEQUENCE_SUMMARY_SCHEMA_VERSION,
  ConsequenceSummaryError,
  WORLD_SUMMARY_SUBJECT,
  consequenceSummaryId,
  deriveConsequenceSummaries,
  validateConsequenceSummaries,
  type ConsequenceSummary,
} from './consequenceSummary';
import type { ArcConsequence, ArcResolutionDecision } from './resolution';

function acceptedEvent(eventId: string, sequenceNumber: number, worldId = 'w1'): AcceptedEvent {
  return { eventId, worldId, sequenceNumber } as unknown as AcceptedEvent;
}

function baseConsequence(over: Partial<ArcConsequence> = {}): ArcConsequence {
  return {
    consequenceId: 'c1',
    summary: 'Trust slowly rebuilt between the rival families.',
    affectedCharacterIds: ['char-a', 'char-b'],
    affectsWorldSummary: true,
    sourceEventId: 'evt-42',
    ...over,
  };
}

function resolvedDecision(over: Partial<ArcResolutionDecision> = {}): ArcResolutionDecision {
  return {
    schemaVersion: 1,
    decisionId: 'arc-1:resolution:42',
    worldId: 'w1',
    arcId: 'arc-1',
    action: 'resolve',
    fromStatus: 'resolving',
    resultingStatus: 'resolved',
    fromTier: 'minor',
    resultingTier: 'minor',
    targetArcId: null,
    outcome: 'The feud ended in a fragile truce.',
    consequences: [baseConsequence()],
    sourceEventId: 'evt-42',
    sourceEventSequenceNumber: 42,
    reason: 'truce reached',
    decidedAtWorldDay: 10,
    ...over,
  };
}

describe('consequenceSummaryId', () => {
  it('is deterministic for a (arc, consequence, scope, subject) tuple', () => {
    expect(consequenceSummaryId('arc-1', 'c1', 'world', WORLD_SUMMARY_SUBJECT))
      .toBe('arc-1:consequence:c1:world:world');
    expect(consequenceSummaryId('arc-1', 'c1', 'character', 'char-a'))
      .toBe('arc-1:consequence:c1:character:char-a');
  });
});

describe('deriveConsequenceSummaries (AC#1 — summaries from accepted events)', () => {
  it('expands world + per-character summaries with full provenance (AC#2)', () => {
    const summaries = deriveConsequenceSummaries(resolvedDecision(), [acceptedEvent('evt-42', 42)]);
    const world = summaries.find((s) => s.scope === 'world');
    const charA = summaries.find((s) => s.scope === 'character' && s.subjectId === 'char-a');
    const charB = summaries.find((s) => s.scope === 'character' && s.subjectId === 'char-b');
    expect(summaries).toHaveLength(3);
    expect(world?.subjectId).toBe(WORLD_SUMMARY_SUBJECT);
    expect(charA).toBeDefined();
    expect(charB).toBeDefined();
    for (const summary of summaries) {
      expect(summary.arcId).toBe('arc-1');                 // arc provenance
      expect(summary.sourceEventId).toBe('evt-42');        // event provenance
      expect(summary.sourceEventIds).toContain('evt-42');
      expect(summary.consequenceId).toBe('c1');
      expect(summary.outcome).toBe('The feud ended in a fragile truce.');
      expect(summary.summary).toBe('Trust slowly rebuilt between the rival families.');
      expect(summary.schemaVersion).toBe(CONSEQUENCE_SUMMARY_SCHEMA_VERSION);
      expect(summary.revision).toBe(42);
    }
  });

  it('omits world scope when affectsWorldSummary is false', () => {
    const decision = resolvedDecision({ consequences: [baseConsequence({ affectsWorldSummary: false })] });
    const summaries = deriveConsequenceSummaries(decision, [acceptedEvent('evt-42', 42)]);
    expect(summaries.every((s) => s.scope === 'character')).toBe(true);
    expect(summaries).toHaveLength(2);
  });

  it('produces deterministic, idempotent summaries on re-derivation (AC#3)', () => {
    const once = deriveConsequenceSummaries(resolvedDecision(), [acceptedEvent('evt-42', 42)]);
    const twice = deriveConsequenceSummaries(resolvedDecision(), [acceptedEvent('evt-42', 42)]);
    expect(twice).toEqual(once);
  });

  it('rejects a non-terminal decision', () => {
    expect(() => deriveConsequenceSummaries(
      resolvedDecision({ action: 'enter_resolving', fromStatus: 'active', resultingStatus: 'resolving' }),
      [acceptedEvent('evt-42', 42)],
    )).toThrow(ConsequenceSummaryError);
  });

  it('rejects a terminal decision without outcome or consequences', () => {
    expect(() => deriveConsequenceSummaries(
      resolvedDecision({ outcome: null, consequences: [] }),
      [acceptedEvent('evt-42', 42)],
    )).toThrow(ConsequenceSummaryError);
  });

  it('rejects when the resolution event is not among accepted sources (AC#2)', () => {
    expect(() => deriveConsequenceSummaries(resolvedDecision(), [acceptedEvent('evt-9', 9)]))
      .toThrow(ConsequenceSummaryError);
  });

  it('rejects a consequence that does not reference the resolution event', () => {
    const decision = resolvedDecision({ consequences: [baseConsequence({ sourceEventId: 'evt-9' })] });
    expect(() => deriveConsequenceSummaries(decision, [acceptedEvent('evt-42', 42)])).toThrow(ConsequenceSummaryError);
  });

  it('rejects a consequence with no world or character target', () => {
    const decision = resolvedDecision({
      consequences: [baseConsequence({ affectsWorldSummary: false, affectedCharacterIds: [] })],
    });
    expect(() => deriveConsequenceSummaries(decision, [acceptedEvent('evt-42', 42)])).toThrow(ConsequenceSummaryError);
  });

  it('deduplicates accepted source events in sourceEventIds', () => {
    const summaries = deriveConsequenceSummaries(
      resolvedDecision(),
      [acceptedEvent('evt-42', 42), acceptedEvent('evt-42', 42)],
    );
    expect(new Set(summaries[0].sourceEventIds).size).toBe(summaries[0].sourceEventIds.length);
    expect(summaries[0].sourceEventIds).toEqual(['evt-42']);
  });
});

describe('validateConsequenceSummaries (AC#2 — provenance check)', () => {
  function validSummaries(): ConsequenceSummary[] {
    return deriveConsequenceSummaries(resolvedDecision(), [acceptedEvent('evt-42', 42)]);
  }

  it('accepts summaries whose sources all resolve to accepted events', () => {
    const summaries = validSummaries();
    expect(validateConsequenceSummaries(summaries, [acceptedEvent('evt-42', 42)])).toEqual(summaries);
  });

  it('rejects a primary sourceEventId that is not accepted', () => {
    const summaries = validSummaries().map((s) => ({ ...s, sourceEventId: 'evt-missing' }));
    expect(() => validateConsequenceSummaries(summaries, [acceptedEvent('evt-42', 42)])).toThrow(ConsequenceSummaryError);
  });

  it('rejects a sourceEventIds entry that is not accepted', () => {
    const summaries = validSummaries().map((s) => ({ ...s, sourceEventIds: ['evt-42', 'evt-missing'] }));
    expect(() => validateConsequenceSummaries(summaries, [acceptedEvent('evt-42', 42)])).toThrow(ConsequenceSummaryError);
  });

  it('rejects duplicate summary ids', () => {
    const summaries = validSummaries();
    const duplicated = [...summaries, summaries[0]];
    expect(() => validateConsequenceSummaries(duplicated, [acceptedEvent('evt-42', 42)])).toThrow(ConsequenceSummaryError);
  });

  it('rejects an empty set', () => {
    expect(() => validateConsequenceSummaries([], [acceptedEvent('evt-42', 42)])).toThrow(ConsequenceSummaryError);
  });
});
