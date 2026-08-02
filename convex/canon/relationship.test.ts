import { readFileSync } from 'node:fs';
import { emptyProjection, type AcceptedEvent, type ProposedEvent } from './model';
import { normalizeProposedEventOutput } from './proposedEvent';
import { reduceWorldEvent } from './reducer';
import { replayWorldEvents } from './replay';
import { buildSnapshot, replayFromSnapshot } from './snapshots';
import { validateCanon, validateEventStructure } from './validators';

function relationshipEvent(
  sequenceNumber: number,
  sourceCharacterId: string,
  targetCharacterId: string,
  visibility: 'private' | 'public' = 'private',
): AcceptedEvent {
  return {
    schemaVersion: 1,
    worldId: 'w',
    idempotencyKey: `relationship-${sequenceNumber}`,
    proposedBy: { type: 'system' },
    worldDay: 4,
    timeSlot: 'evening',
    eventType: 'relationship_change',
    participantIds: [sourceCharacterId, targetCharacterId],
    causedByEventIds: sequenceNumber === 0 ? [] : [`w#event#${sequenceNumber - 1}`],
    stateChanges: [{
      type: 'relationship_changed', sourceCharacterId, targetCharacterId,
      trustDelta: 7, affectionDelta: 4, resentmentDelta: -2,
      fearDelta: 3, dependencyDelta: 5, familiarityDelta: 9,
      reason: visibility === 'private' ? 'learned the unrevealed locker secret' : 'worked together publicly',
      visibility,
    }],
    eventId: `w#event#${sequenceNumber}`,
    sequenceNumber,
    acceptedAt: 100 + sequenceNumber,
    validationVersion: 'canon-v1',
    traceId: `trace-${sequenceNumber}`,
  };
}

describe('FR-B002 directional relationship projection', () => {
  it('projects asymmetric six-dimensional state with causal history and bounded values', () => {
    const ab = relationshipEvent(0, 'a', 'b');
    const ba = relationshipEvent(1, 'b', 'a', 'public');
    const reverseChange = ba.stateChanges[0];
    if (reverseChange.type !== 'relationship_changed') throw new Error('relationship fixture mismatch');
    ba.stateChanges[0] = { ...reverseChange, trustDelta: -20, fearDelta: 200 };
    const projection = replayWorldEvents(emptyProjection('w'), [ab, ba]);

    expect(projection.relationships['a|b']).toMatchObject({
      trust: 7, affection: 4, resentment: -2, fear: 3, dependency: 5, familiarity: 9,
      lastUpdatedEventId: ab.eventId,
    });
    expect(projection.relationships['b|a']).toMatchObject({ trust: -20, fear: 100 });
    expect(projection.relationshipHistory['a|b'][0]).toEqual(expect.objectContaining({
      sourceEventId: ab.eventId, sequenceNumber: 0, worldDay: 4, timeSlot: 'evening',
      reason: 'learned the unrevealed locker secret', visibility: 'private',
    }));
  });

  it('replays history identically from the event log and a snapshot without retaining mutable references', () => {
    const first = relationshipEvent(0, 'a', 'b');
    const atSnapshot = reduceWorldEvent(emptyProjection('w'), first);
    const snapshot = buildSnapshot(atSnapshot, 123, 4);
    atSnapshot.relationshipHistory['a|b'][0].reason = 'mutated caller copy';
    const second = relationshipEvent(1, 'a', 'b', 'public');
    const fromSnapshot = replayFromSnapshot(snapshot, [second]);
    const fromOrigin = replayWorldEvents(emptyProjection('w'), [first, second]);
    expect(fromSnapshot).toEqual(fromOrigin);
    expect(fromSnapshot.relationshipHistory['a|b']).toHaveLength(2);
  });

  it('normalizes legacy v1 omissions to zero and private while rejecting invalid visibility', () => {
    const accepted = relationshipEvent(0, 'a', 'b');
    const proposal: ProposedEvent = {
      schemaVersion: accepted.schemaVersion, worldId: accepted.worldId,
      idempotencyKey: accepted.idempotencyKey, proposedBy: accepted.proposedBy,
      worldDay: accepted.worldDay, timeSlot: accepted.timeSlot, eventType: accepted.eventType,
      participantIds: accepted.participantIds, causedByEventIds: accepted.causedByEventIds,
      stateChanges: accepted.stateChanges,
    };
    const legacy = structuredClone(proposal) as unknown as Record<string, unknown>;
    const legacyChange = (legacy.stateChanges as Array<Record<string, unknown>>)[0];
    delete legacyChange.fearDelta;
    delete legacyChange.dependencyDelta;
    delete legacyChange.familiarityDelta;
    delete legacyChange.visibility;
    expect(normalizeProposedEventOutput(legacy).stateChanges[0]).toEqual(expect.objectContaining({
      fearDelta: 0, dependencyDelta: 0, familiarityDelta: 0, visibility: 'private',
    }));
    legacyChange.visibility = 'viewer-secret';
    expect(validateEventStructure(legacy)).toMatchObject({
      code: 'INVALID_EVENT_SHAPE', path: 'stateChanges[0].visibility',
    });
  });

  it('keeps secret-bearing reasons behind an internal-only query boundary', () => {
    const privateProposal = relationshipEvent(0, 'a', 'b') as ProposedEvent;
    privateProposal.publicSummary = 'The locker secret changed their relationship.';
    expect(validateCanon(privateProposal, emptyProjection('w'), {
      worldId: 'w', rules: [], characterIds: ['a', 'b'],
    })).toMatchObject({ code: 'PRIVATE_RELATIONSHIP_DISCLOSURE', path: 'publicSummary' });

    const source = readFileSync('convex/canon/queries.ts', 'utf8');
    const declaration = source.slice(source.indexOf('export const getRelationshipProjection'), source.indexOf('/** The latest persisted snapshot'));
    expect(declaration).toContain('internalQuery({');
    expect(declaration).not.toContain('query({');
  });
});
