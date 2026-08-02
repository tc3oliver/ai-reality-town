import { readFileSync } from 'node:fs';
import { CanonError, isCanonError } from '../shared/errors';
import { KNOWLEDGE_SOURCE_TYPES, type KnowledgeSourceType } from '../canon/eventTypes';
import { emptyProjection, type AcceptedEvent, type StateChange } from '../canon/model';
import { normalizeProposedEventOutput } from '../canon/proposedEvent';
import { reduceWorldEvent } from '../canon/reducer';
import { replayWorldEvents } from '../canon/replay';
import { validateCanon, validateEventStructure } from '../canon/validators';
import { authorizeKnowledgeRead } from './authorization';

function accepted(sequenceNumber: number, changes: StateChange[], causedByEventIds: string[]): AcceptedEvent {
  return {
    schemaVersion: 1, worldId: 'w', idempotencyKey: `knowledge-${sequenceNumber}`,
    proposedBy: { type: 'system' }, worldDay: 2, timeSlot: 'afternoon', eventType: 'discovery',
    participantIds: ['a'], causedByEventIds, stateChanges: changes,
    eventId: `w#event#${sequenceNumber}`, sequenceNumber, acceptedAt: 100 + sequenceNumber,
    validationVersion: 'canon-v1', traceId: `trace-${sequenceNumber}`,
  };
}

function learned(sourceType: KnowledgeSourceType, index: number): StateChange {
  return {
    type: 'character_knowledge_learned', characterId: 'a', factId: `fact-${index}`,
    beliefValue: index % 2 === 0, truthStatus: (['true', 'false', 'unknown'] as const)[index % 3],
    confidence: index / 10, sourceType, sourceEventId: 'w#event#0',
    shareability: (['private', 'trusted', 'public'] as const)[index % 3],
  };
}

function sourceEvent(): AcceptedEvent {
  return accepted(0, [{
    type: 'fact_created', subjectType: 'world', subjectId: 'w', predicate: 'signal',
    value: true, visibility: 'canon',
  }], []);
}

describe('FR-E001 source-proven character knowledge ledger', () => {
  it('projects all allowed sources, truth states, confidence, time, and shareability from accepted events', () => {
    const source = sourceEvent();
    const knowledge = accepted(1, KNOWLEDGE_SOURCE_TYPES.map(learned), [source.eventId]);
    const initial = emptyProjection('w');
    const replayed = replayWorldEvents(initial, [source, knowledge]);

    expect(replayed.characterKnowledge.a).toHaveLength(6);
    expect(replayed.characterKnowledge.a.map((entry) => entry.sourceType)).toEqual(KNOWLEDGE_SOURCE_TYPES);
    expect(replayed.characterKnowledge.a[1]).toEqual(expect.objectContaining({
      knowledgeId: 'w#event#1:knowledge:1', factId: 'fact-1', beliefValue: false,
      truthStatus: 'false', confidence: 0.1, sourceEventId: source.eventId,
      learnedAt: { worldDay: 2, timeSlot: 'afternoon', eventId: knowledge.eventId },
      shareability: 'trusted',
    }));
    expect(initial.characterKnowledge).toEqual({});
  });

  it('appends a correction and preserves the corrected belief and causal chain', () => {
    const source = sourceEvent();
    const first = accepted(1, [learned('evidence', 0)], [source.eventId]);
    const before = replayWorldEvents(emptyProjection('w'), [source, first]);
    const correctionChange: StateChange = {
      type: 'character_knowledge_learned', characterId: 'a', factId: 'fact-0',
      beliefValue: false, truthStatus: 'false', confidence: 0.95, sourceType: 'evidence',
      sourceEventId: first.eventId, shareability: 'private',
      correctsKnowledgeId: 'w#event#1:knowledge:0',
    };
    const correctionProposal = accepted(2, [correctionChange], [first.eventId]);
    expect(validateCanon(correctionProposal, before, {
      worldId: 'w', rules: [], characterIds: ['a'], knownEventIds: [source.eventId, first.eventId],
    })).toBeNull();
    expect(validateCanon({ ...correctionProposal, stateChanges: [correctionChange, correctionChange] }, before, {
      worldId: 'w', rules: [], characterIds: ['a'], knownEventIds: [source.eventId, first.eventId],
    })).toMatchObject({ code: 'INVALID_KNOWLEDGE_CORRECTION' });
    const after = reduceWorldEvent(before, correctionProposal);
    expect(after.characterKnowledge.a).toEqual([
      expect.objectContaining({ knowledgeId: 'w#event#1:knowledge:0', correctedByKnowledgeId: 'w#event#2:knowledge:0' }),
      expect.objectContaining({ knowledgeId: 'w#event#2:knowledge:0', correctsKnowledgeId: 'w#event#1:knowledge:0', truthStatus: 'false' }),
    ]);
  });

  it('rejects invalid confidence, missing causal sources, and invalid corrections', () => {
    const event = accepted(1, [learned('observed', 0)], ['w#event#0']);
    const { eventId: _eventId, sequenceNumber: _sequence, acceptedAt: _acceptedAt,
      validationVersion: _validation, traceId: _trace, ...proposal } = event;
    const invalidConfidence = structuredClone(proposal) as unknown as Record<string, unknown>;
    (invalidConfidence.stateChanges as Array<Record<string, unknown>>)[0].confidence = 2;
    expect(validateEventStructure(invalidConfidence)).toMatchObject({ code: 'INVALID_EVENT_SHAPE', path: 'stateChanges[0].confidence' });
    const missingSource = { ...proposal, causedByEventIds: [] };
    expect(validateCanon(missingSource, emptyProjection('w'), {
      worldId: 'w', rules: [], characterIds: ['a'], knownEventIds: [],
    })).toMatchObject({ code: 'KNOWLEDGE_SOURCE_MISSING' });

    const badCorrection = structuredClone(proposal);
    const change = badCorrection.stateChanges[0];
    if (change.type !== 'character_knowledge_learned') throw new Error('fixture mismatch');
    change.correctsKnowledgeId = 'missing-knowledge';
    expect(validateCanon(badCorrection, emptyProjection('w'), {
      worldId: 'w', rules: [], characterIds: ['a'], knownEventIds: ['w#event#0'],
    })).toMatchObject({ code: 'INVALID_KNOWLEDGE_CORRECTION' });
  });

  it('normalizes legacy v1 knowledge fields to safe explicit values', () => {
    const legacy = accepted(1, [{
      type: 'character_knowledge_learned', characterId: 'a', factId: 'legacy-fact',
      sourceType: 'memory', sourceEventId: 'w#event#0',
    }], ['w#event#0']);
    const { eventId: _eventId, sequenceNumber: _sequence, acceptedAt: _acceptedAt,
      validationVersion: _validation, traceId: _trace, ...proposal } = legacy;
    expect(normalizeProposedEventOutput(proposal).stateChanges[0]).toEqual(expect.objectContaining({
      beliefValue: 'legacy-fact', truthStatus: 'unknown', confidence: 0.5, shareability: 'private',
    }));
  });

  it('allows self and operations reads but rejects cross-character access and exposes no public query', () => {
    const projection = replayWorldEvents(emptyProjection('w'), [
      sourceEvent(), accepted(1, [learned('told', 0)], ['w#event#0']),
    ]);
    expect(authorizeKnowledgeRead(projection.characterKnowledge, 'a', { type: 'character', characterId: 'a' })).toHaveLength(1);
    expect(authorizeKnowledgeRead(projection.characterKnowledge, 'a', { type: 'operations', operatorId: 'op-1' })).toHaveLength(1);
    expect(() => authorizeKnowledgeRead(projection.characterKnowledge, 'a', { type: 'character', characterId: 'b' })).toThrow(CanonError);
    try {
      authorizeKnowledgeRead(projection.characterKnowledge, 'a', { type: 'character', characterId: 'b' });
    } catch (error) {
      expect(isCanonError(error) && error.error.code).toBe('KNOWLEDGE_ACCESS_DENIED');
    }
    const querySource = readFileSync('convex/knowledge/queries.ts', 'utf8');
    expect(querySource).toContain('internalQuery({');
    expect(querySource).not.toMatch(/\bquery\(\{/);
  });
});
