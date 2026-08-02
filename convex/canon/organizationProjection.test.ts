import { emptyProjection, type AcceptedEvent, type ProposedEvent, type WorldProjection } from './model';
import { reduceWorldEvent } from './reducer';
import { replayWorldEvents } from './replay';
import { buildSnapshot, replayFromSnapshot } from './snapshots';
import { validateEventStructure, validateCanon } from './validators';

function start(): WorldProjection {
  return {
    ...emptyProjection('w'), characterStates: { a: { lastUpdatedEventId: 'initial-snapshot' } },
    locations: { square: { locationId: 'square', name: 'Square', description: 'Town square', locationType: 'square', capacity: 10, connectedLocationIds: [], active: true, lastUpdatedEventId: 'initial-snapshot' } },
    organizations: {
      gazette: { organizationId: 'gazette', name: 'Gazette', description: 'Town paper', organizationType: 'newspaper', headquartersLocationId: 'square', active: true, lastUpdatedEventId: 'initial-snapshot' },
      closed: { organizationId: 'closed', name: 'Closed Guild', description: 'Inactive guild', organizationType: 'guild', headquartersLocationId: null, active: false, lastUpdatedEventId: 'initial-snapshot' },
    },
    organizationMembers: { gazette: [], closed: [] }, organizationMembershipHistory: {},
  };
}

function membership(sequenceNumber: number, toValue: string[], fromValue?: string[]): AcceptedEvent {
  return {
    schemaVersion: 1, worldId: 'w', idempotencyKey: `membership-${sequenceNumber}`,
    proposedBy: { type: 'system' }, worldDay: sequenceNumber + 1, timeSlot: 'noon',
    eventType: 'world_event', participantIds: ['a'], causedByEventIds: [],
    stateChanges: [{
      type: 'character_state_changed', characterId: 'a', field: 'organization_memberships',
      ...(fromValue === undefined ? {} : { fromValue }), toValue, reason: 'Membership decision',
    }],
    eventId: `w#event#${sequenceNumber}`, sequenceNumber, acceptedAt: sequenceNumber + 1,
    validationVersion: 'canon-v1', traceId: `trace-${sequenceNumber}`,
  };
}

describe('ART-81 organization membership and state projection', () => {
  it('keeps character and reverse membership projections consistent with append-only history', () => {
    const joined = membership(0, ['gazette']);
    const left = membership(1, [], ['gazette']);
    const afterJoin = reduceWorldEvent(start(), joined);
    expect(afterJoin.characterStates.a.organizationMemberships).toEqual(['gazette']);
    expect(afterJoin.organizationMembers.gazette).toEqual(['a']);
    const projection = reduceWorldEvent(afterJoin, left);
    expect(projection.characterStates.a.organizationMemberships).toEqual([]);
    expect(projection.organizationMembers.gazette).toEqual([]);
    expect(projection.organizationMembershipHistory.a).toEqual([
      expect.objectContaining({ addedOrganizationIds: ['gazette'], removedOrganizationIds: [], sourceEventId: joined.eventId }),
      expect.objectContaining({ addedOrganizationIds: [], removedOrganizationIds: ['gazette'], sourceEventId: left.eventId }),
    ]);
  });

  it('replays organization active/headquarters state and snapshot history deterministically', () => {
    const joined = membership(0, ['gazette']);
    const stateChange: AcceptedEvent = {
      ...membership(1, []), participantIds: [], stateChanges: [{
        type: 'organization_state_changed', organizationId: 'closed', name: 'Reopened Guild',
        description: 'The guild reopened.', organizationType: 'guild', headquartersLocationId: 'square',
        active: true, reason: 'Charter renewed',
      }],
    };
    const snapshot = buildSnapshot(reduceWorldEvent(start(), joined), 1, 1);
    const full = replayWorldEvents(start(), [joined, stateChange]);
    expect(replayFromSnapshot(snapshot, [stateChange])).toEqual(full);
    expect(full.organizations.closed).toMatchObject({ active: true, headquartersLocationId: 'square', lastUpdatedEventId: stateChange.eventId });
    full.organizationMembershipHistory.a[0].addedOrganizationIds.push('mutated');
    expect(snapshot.projection.organizationMembershipHistory.a[0].addedOrganizationIds).toEqual(['gazette']);
  });

  it('rejects unknown/inactive and duplicate memberships or same-event changes', () => {
    const unknown = membership(0, ['missing']) as ProposedEvent;
    expect(validateCanon(unknown, start())?.code).toBe('UNKNOWN_ORGANIZATION_REFERENCE');
    const inactive = membership(0, ['closed']) as ProposedEvent;
    expect(validateCanon(inactive, start())?.code).toBe('UNKNOWN_ORGANIZATION_REFERENCE');
    const duplicate = membership(0, ['gazette', 'gazette']) as ProposedEvent;
    expect(validateEventStructure(duplicate)?.code).toBe('INVALID_EVENT_SHAPE');
    const twice = membership(0, ['gazette']) as ProposedEvent;
    twice.stateChanges.push({ type: 'character_state_changed', characterId: 'a', field: 'organization_memberships', toValue: [], reason: 'duplicate' });
    expect(validateCanon(twice, start())?.code).toBe('INVALID_CHARACTER_STATE_CHANGE');
  });

  it('rejects organization deactivation with members and invalid headquarters', () => {
    const projection = reduceWorldEvent(start(), membership(0, ['gazette']));
    const change = membership(1, []) as ProposedEvent; change.participantIds = [];
    change.stateChanges = [{
      type: 'organization_state_changed', organizationId: 'gazette', name: 'Gazette',
      description: 'Town paper', organizationType: 'newspaper', headquartersLocationId: 'missing',
      active: false, reason: 'Closure',
    }];
    expect(validateCanon(change, projection)?.code).toBe('UNKNOWN_LOCATION_REFERENCE');
    change.stateChanges[0] = { ...change.stateChanges[0], headquartersLocationId: 'square' } as typeof change.stateChanges[0];
    expect(validateCanon(change, projection)?.code).toBe('UNKNOWN_ORGANIZATION_REFERENCE');
  });
});
