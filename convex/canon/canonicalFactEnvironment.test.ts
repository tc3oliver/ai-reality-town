import { emptyProjection, type AcceptedEvent, type ProposedEvent } from './model';
import { reduceWorldEvent } from './reducer';
import { replayWorldEvents } from './replay';
import { buildSnapshot, replayFromSnapshot } from './snapshots';
import { validateCanon } from './validators';

function factEvent(sequenceNumber: number, value: string, visibility: 'canon' | 'public' | 'private' = 'public'): AcceptedEvent {
  return {
    schemaVersion: 1, worldId: 'w', idempotencyKey: `weather-${sequenceNumber}`,
    proposedBy: { type: 'system' }, worldDay: sequenceNumber + 1, timeSlot: 'morning',
    eventType: 'world_event', participantIds: [], causedByEventIds: [],
    stateChanges: [{ type: 'fact_created', subjectType: 'world', subjectId: 'w', predicate: 'weather', value, visibility }],
    eventId: `w#event#${sequenceNumber}`, sequenceNumber, acceptedAt: sequenceNumber + 1,
    validationVersion: 'canon-v1', traceId: `trace-${sequenceNumber}`,
  };
}

describe('ART-78 canonical fact and world environment projection', () => {
  it('retains immutable fact versions with subject, predicate, value, visibility, and validity range', () => {
    const first = factEvent(0, 'rain');
    const second = factEvent(1, 'clear', 'private');
    const projection = replayWorldEvents(emptyProjection('w'), [first, second]);

    expect(projection.facts).toEqual([
      {
        factId: `${first.eventId}:fact:0`, subjectType: 'world', subjectId: 'w', predicate: 'weather',
        value: 'rain', visibility: 'public', sourceEventId: first.eventId,
        validFromEventId: first.eventId, validUntilEventId: second.eventId,
      },
      {
        factId: `${second.eventId}:fact:0`, subjectType: 'world', subjectId: 'w', predicate: 'weather',
        value: 'clear', visibility: 'private', sourceEventId: second.eventId,
        validFromEventId: second.eventId, validUntilEventId: null,
      },
    ]);
    expect(projection.worldEnvironment.weather).toMatchObject({
      key: 'weather', value: 'clear', visibility: 'private', validFromEventId: second.eventId,
    });
    expect(projection.environmentHistory.weather).toEqual([
      expect.objectContaining({ value: 'rain', validUntilEventId: second.eventId }),
      expect.objectContaining({ value: 'clear', validUntilEventId: null }),
    ]);
  });

  it('reconstructs identical environment versions from full and snapshot replay without mutating inputs', () => {
    const events = [factEvent(0, 'rain'), factEvent(1, 'fog'), factEvent(2, 'clear')];
    const start = emptyProjection('w');
    const afterFirst = reduceWorldEvent(start, events[0]);
    const snapshot = buildSnapshot(afterFirst, 10, 1);
    const full = replayWorldEvents(start, events);
    const fromSnapshot = replayFromSnapshot(snapshot, events.slice(1));
    expect(fromSnapshot).toEqual(full);
    expect(start).toEqual(emptyProjection('w'));
    expect(events[0].stateChanges[0]).toMatchObject({ value: 'rain' });
  });

  it('rejects foreign world subjects and duplicate same-key changes before acceptance', () => {
    const proposal = factEvent(0, 'rain') as ProposedEvent;
    proposal.stateChanges = [
      { type: 'fact_created', subjectType: 'world', subjectId: 'other', predicate: 'weather', value: 'rain', visibility: 'public' },
    ];
    expect(validateCanon(proposal, emptyProjection('w'))?.code).toBe('INVALID_FACT_SUBJECT');
    proposal.stateChanges = [
      { type: 'fact_created', subjectType: 'world', subjectId: 'w', predicate: 'weather', value: 'rain', visibility: 'public' },
      { type: 'fact_created', subjectType: 'world', subjectId: 'w', predicate: 'weather', value: 'clear', visibility: 'public' },
    ];
    expect(validateCanon(proposal, emptyProjection('w'))?.code).toBe('INVALID_FACT_SUBJECT');
  });
});
