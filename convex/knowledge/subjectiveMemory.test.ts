import { readFileSync } from 'node:fs';
import { CanonError, isCanonError } from '../shared/errors';
import { emptyProjection, type AcceptedEvent, type StateChange } from '../canon/model';
import { normalizeProposedEventOutput } from '../canon/proposedEvent';
import { replayWorldEvents } from '../canon/replay';
import { buildSnapshot, cloneProjection } from '../canon/snapshots';
import { validateCanon, validateEventStructure } from '../canon/validators';
import { authorizeMemoryRead } from './memoryAuthorization';

function memory(characterId: string, interpretation: string, visibility: 'private' | 'trusted' | 'public' = 'private'): StateChange {
  return {
    type: 'character_memory_formed', characterId, content: 'The station clock stopped at noon.',
    interpretation, importance: 0.8, emotionalWeight: -0.5, confidence: 0.75, visibility,
  };
}

function event(): AcceptedEvent {
  return {
    schemaVersion: 1, worldId: 'w', idempotencyKey: 'memory-scene', proposedBy: { type: 'system' },
    worldDay: 5, timeSlot: 'noon', eventType: 'discovery', participantIds: ['a', 'b'],
    causedByEventIds: [], stateChanges: [
      { type: 'fact_created', subjectType: 'world', subjectId: 'w', predicate: 'stationClockStopped', value: true, visibility: 'canon' },
      memory('a', 'Someone deliberately stopped it to send me a warning.'),
      memory('b', 'The clock never stopped; A imagined the silence.'),
    ],
    eventId: 'w#event#0', sequenceNumber: 0, acceptedAt: 100,
    validationVersion: 'canon-v1', traceId: 'trace-memory',
  };
}

describe('FR-E002 subjective character memory projection', () => {
  it('creates divergent and potentially mistaken memories from one accepted event without changing Canon facts', () => {
    const accepted = event();
    const projection = replayWorldEvents(emptyProjection('w'), [accepted]);
    expect(projection.facts).toEqual([expect.objectContaining({ predicate: 'stationClockStopped', value: true })]);
    expect(projection.characterMemories.a[0]).toEqual(expect.objectContaining({
      memoryId: 'w#event#0:memory:1', sourceEventId: accepted.eventId,
      interpretation: 'Someone deliberately stopped it to send me a warning.',
      createdAt: { worldDay: 5, timeSlot: 'noon', eventId: accepted.eventId },
    }));
    expect(projection.characterMemories.b[0].interpretation).toBe('The clock never stopped; A imagined the silence.');
    expect(projection.characterMemories.a[0].interpretation).not.toBe(projection.characterMemories.b[0].interpretation);
  });

  it('validates bounds, participants, references, and rejects direct projection envelopes', () => {
    const accepted = event();
    const { eventId: _eventId, sequenceNumber: _sequence, acceptedAt: _acceptedAt,
      validationVersion: _validation, traceId: _trace, ...proposal } = accepted;
    expect(validateEventStructure(proposal)).toBeNull();
    expect(validateCanon(proposal, emptyProjection('w'), { worldId: 'w', rules: [], characterIds: ['a', 'b'] })).toBeNull();
    const invalid = structuredClone(proposal) as unknown as Record<string, unknown>;
    (invalid.stateChanges as Array<Record<string, unknown>>)[1].confidence = 1.1;
    expect(validateEventStructure(invalid)).toMatchObject({ code: 'INVALID_EVENT_SHAPE', path: 'stateChanges[1].confidence' });
    const mismatch = structuredClone(proposal);
    mismatch.participantIds = ['b'];
    expect(validateCanon(mismatch, emptyProjection('w'), { worldId: 'w', rules: [], characterIds: ['a', 'b'] }))
      .toMatchObject({ code: 'PARTICIPANT_MISMATCH' });
    expect(() => normalizeProposedEventOutput({ ...proposal, characterMemories: { a: [] } }))
      .toThrow(CanonError);
  });

  it('clones memories through snapshots and deterministic replay', () => {
    const projection = replayWorldEvents(emptyProjection('w'), [event()]);
    const cloned = cloneProjection(projection);
    const snapshot = buildSnapshot(projection, 200, 5);
    projection.characterMemories.a[0].interpretation = 'caller mutation';
    expect(cloned.characterMemories.a[0].interpretation).not.toBe('caller mutation');
    expect(snapshot.projection.characterMemories.a[0].interpretation).not.toBe('caller mutation');
  });

  it('allows only self/operations private reads and has no public query', () => {
    const projection = replayWorldEvents(emptyProjection('w'), [event()]);
    expect(authorizeMemoryRead(projection.characterMemories, 'a', { type: 'character', characterId: 'a' })).toHaveLength(1);
    expect(authorizeMemoryRead(projection.characterMemories, 'a', { type: 'operations', operatorId: 'op' })).toHaveLength(1);
    expect(() => authorizeMemoryRead(projection.characterMemories, 'a', { type: 'character', characterId: 'b' })).toThrow(CanonError);
    try {
      authorizeMemoryRead(projection.characterMemories, 'a', { type: 'character', characterId: 'b' });
    } catch (error) {
      expect(isCanonError(error) && error.error.code).toBe('MEMORY_ACCESS_DENIED');
    }
    const source = readFileSync('convex/knowledge/memoryQueries.ts', 'utf8');
    expect(source).toContain('internalQuery({');
    expect(source).not.toMatch(/\bquery\(\{/);
  });
});
