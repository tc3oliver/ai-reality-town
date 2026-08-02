import { emptyProjection, type AcceptedEvent, type ProjectedLocation, type ProposedEvent, type WorldProjection } from './model';
import { reduceWorldEvent } from './reducer';
import { replayWorldEvents } from './replay';
import { buildSnapshot, replayFromSnapshot } from './snapshots';
import { validateCanon } from './validators';

function location(locationId: string, connections: string[], capacity = 2, active = true): ProjectedLocation {
  return {
    locationId, name: locationId, description: `${locationId} description`, locationType: 'test',
    capacity, connectedLocationIds: connections, active, lastUpdatedEventId: 'initial-snapshot',
  };
}

function movement(sequenceNumber: number, characterId: string, fromLocationId: string, toLocationId: string): AcceptedEvent {
  return {
    schemaVersion: 1, worldId: 'w', idempotencyKey: `move-${sequenceNumber}`,
    proposedBy: { type: 'system' }, worldDay: sequenceNumber, timeSlot: 'morning', eventType: 'movement',
    participantIds: [characterId], causedByEventIds: [],
    stateChanges: [{ type: 'character_location_changed', characterId, fromLocationId, toLocationId }],
    eventId: `w#event#${sequenceNumber}`, sequenceNumber, acceptedAt: sequenceNumber,
    validationVersion: 'canon-v1', traceId: `trace-${sequenceNumber}`,
  };
}

function start(): WorldProjection {
  return {
    ...emptyProjection('w'),
    characterLocations: { a: 'square', b: 'station' },
    locations: {
      square: location('square', ['station']),
      station: location('station', ['square', 'clinic']),
      clinic: location('clinic', ['station'], 1),
      closed: location('closed', ['square'], 2, false),
    },
    locationOccupancy: { square: ['a'], station: ['b'], clinic: [], closed: [] },
  };
}

describe('ART-79 location connectivity and occupancy projection', () => {
  it('replays location state and keeps occupancy identical to character locations each sequence', () => {
    const first = movement(0, 'a', 'square', 'station');
    const afterMove = reduceWorldEvent(start(), first);
    expect(afterMove.locationOccupancy).toMatchObject({ square: [], station: ['a', 'b'] });
    expect(afterMove.characterLocations).toEqual({ a: 'station', b: 'station' });

    const update: AcceptedEvent = {
      ...movement(1, 'a', 'station', 'station'), eventType: 'world_event', participantIds: [],
      stateChanges: [{
        type: 'location_state_changed', locationId: 'clinic', name: 'Clinic',
        description: 'The town clinic.', locationType: 'clinic', capacity: 3,
        connectedLocationIds: ['station'], active: true, reason: 'Renovation completed',
      }],
    };
    const replayed = replayWorldEvents(start(), [first, update]);
    expect(replayed.locations.clinic).toMatchObject({ capacity: 3, active: true, lastUpdatedEventId: update.eventId });
    expect(replayed.locationOccupancy.station).toEqual(['a', 'b']);
  });

  it('produces identical full and snapshot replay with isolated location arrays', () => {
    const first = movement(0, 'a', 'square', 'station');
    const second = movement(1, 'a', 'station', 'clinic');
    const afterFirst = reduceWorldEvent(start(), first);
    const snapshot = buildSnapshot(afterFirst, 1, 0);
    const full = replayWorldEvents(start(), [first, second]);
    expect(replayFromSnapshot(snapshot, [second])).toEqual(full);
    full.locations.station.connectedLocationIds.push('mutated');
    expect(snapshot.projection.locations.station.connectedLocationIds).not.toContain('mutated');
  });

  it('rejects unknown, inactive, disconnected, and over-capacity destinations', () => {
    const projection = start();
    expect(validateCanon(movement(0, 'a', 'square', 'missing') as ProposedEvent, projection)?.code).toBe('UNKNOWN_LOCATION_REFERENCE');
    expect(validateCanon(movement(0, 'a', 'square', 'closed') as ProposedEvent, projection)?.code).toBe('UNKNOWN_LOCATION_REFERENCE');
    expect(validateCanon(movement(0, 'a', 'square', 'clinic') as ProposedEvent, projection)?.code).toBe('TELEPORTATION_NOT_ALLOWED');
    projection.locations.station.capacity = 1;
    expect(validateCanon(movement(0, 'a', 'square', 'station') as ProposedEvent, projection)?.code).toBe('UNKNOWN_LOCATION_REFERENCE');
  });

  it('rejects deactivation or capacity reduction that conflicts with occupancy', () => {
    const proposal = movement(0, 'a', 'square', 'station') as ProposedEvent;
    proposal.eventType = 'world_event'; proposal.participantIds = [];
    proposal.stateChanges = [{
      type: 'location_state_changed', locationId: 'square', name: 'Square', description: 'Town square',
      locationType: 'square', capacity: 2, connectedLocationIds: ['station'], active: false,
      reason: 'Closure',
    }];
    expect(validateCanon(proposal, start())?.code).toBe('UNKNOWN_LOCATION_REFERENCE');
    proposal.stateChanges[0] = {
      type: 'location_state_changed', locationId: 'square', name: 'Square', description: 'Town square',
      locationType: 'square', capacity: 0, connectedLocationIds: ['station'], active: true,
      reason: 'Unsafe capacity reduction',
    };
    expect(validateCanon(proposal, start())?.code).toBe('UNKNOWN_LOCATION_REFERENCE');
  });
});
