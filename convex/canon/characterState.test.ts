import { commitProposedEvent } from './commit';
import { InMemoryCanonStore } from './inMemoryStore';
import { emptyProjection, type AcceptedEvent, type CanonRuleContext, type ProposedEvent } from './model';
import { normalizeProposedEventOutput } from './proposedEvent';
import { replayWorldEvents } from './replay';
import { validateCanon, validateEventStructure } from './validators';
import { isCanonError } from '../shared/errors';

const context: CanonRuleContext = {
  worldId: 'w', rules: [], characterIds: ['a'], locationIds: ['station', 'clinic'],
  organizationIds: ['press', 'clinic-org'], initialCharacterAlive: { a: true },
};

function proposal(change: ProposedEvent['stateChanges'][number]): ProposedEvent {
  return {
    schemaVersion: 1, worldId: 'w', idempotencyKey: `state-${change.type}`,
    proposedBy: { type: 'character', id: 'a' }, worldDay: 1, timeSlot: 'morning',
    eventType: 'world_event', participantIds: ['a'], causedByEventIds: [], stateChanges: [change],
  };
}

function accepted(overrides: Partial<AcceptedEvent>): AcceptedEvent {
  return {
    ...proposal({ type: 'character_state_changed', characterId: 'a', field: 'health', toValue: 'healthy', reason: 'initial accepted state' }),
    eventId: 'w#event#0', sequenceNumber: 0, acceptedAt: 1,
    validationVersion: 'canon-v1', traceId: 'trace-0', ...overrides,
  };
}

describe('FR-B001 event-derived character current state', () => {
  it('replays every required state field exclusively from accepted events', () => {
    const first = accepted({
      stateChanges: [
        { type: 'character_location_changed', characterId: 'a', fromLocationId: 'station', toLocationId: 'clinic' },
        { type: 'character_state_changed', characterId: 'a', field: 'health', toValue: 'injured', reason: 'clinic diagnosis' },
        { type: 'character_state_changed', characterId: 'a', field: 'emotion', toValue: 'anxious', reason: 'recent discovery' },
        { type: 'character_state_changed', characterId: 'a', field: 'finance', toValue: 'indebted', reason: 'medical bill' },
        { type: 'character_state_changed', characterId: 'a', field: 'occupation', toValue: 'reporter', reason: 'accepted employment' },
        { type: 'character_state_changed', characterId: 'a', field: 'organization_memberships', toValue: ['press'], reason: 'press membership' },
        { type: 'character_state_changed', characterId: 'a', field: 'availability', toValue: 'unavailable', reason: 'receiving treatment' },
        { type: 'character_state_changed', characterId: 'a', field: 'active', toValue: true, reason: 'remains active' },
      ],
    });
    const second = accepted({
      idempotencyKey: 'life-2', eventId: 'w#event#1', sequenceNumber: 1,
      worldDay: 2, stateChanges: [{ type: 'character_life_changed', characterId: 'a', alive: false, reason: 'accepted fatal event' }],
    });
    const initial = emptyProjection('w');
    expect(initial.characterStates).toEqual({});
    const rebuilt = replayWorldEvents(initial, [first, second]);
    expect(rebuilt.characterStates.a).toEqual({
      currentLocationId: 'clinic', health: 'injured', emotion: 'anxious', finance: 'indebted',
      occupation: 'reporter', organizationMemberships: ['press'], availability: 'unavailable',
      active: false, alive: false, lastUpdatedEventId: 'w#event#1',
    });
    expect(replayWorldEvents(emptyProjection('w'), [first, second])).toEqual(rebuilt);
  });

  it('enforces field types, causal reason, prior value, participant, and organization references', () => {
    const current = {
      ...emptyProjection('w'),
      characterStates: { a: { health: 'healthy', lastUpdatedEventId: 'prior' } },
    };
    const wrongPrior = proposal({
      type: 'character_state_changed', characterId: 'a', field: 'health',
      fromValue: 'critical', toValue: 'injured', reason: 'diagnosis',
    });
    expect(validateEventStructure(wrongPrior)).toBeNull();
    expect(validateCanon(wrongPrior, current, context)).toMatchObject({ code: 'CHARACTER_STATE_PRECONDITION_FAILED' });

    const unknownOrganization = proposal({
      type: 'character_state_changed', characterId: 'a', field: 'organization_memberships',
      toValue: ['unknown-org'], reason: 'joined',
    });
    expect(validateCanon(unknownOrganization, current, context)).toMatchObject({ code: 'UNKNOWN_ORGANIZATION_REFERENCE' });

    const noParticipant = { ...wrongPrior, participantIds: [] };
    expect(validateCanon(noParticipant, current, context)).toMatchObject({ code: 'PARTICIPANT_MISMATCH' });

    const wrongType = proposal({
      type: 'character_state_changed', characterId: 'a', field: 'active',
      toValue: 'yes', reason: 'invalid provider output',
    });
    expect(validateEventStructure(wrongType)).toMatchObject({ code: 'INVALID_EVENT_SHAPE' });
    const emptyReason = proposal({
      type: 'character_state_changed', characterId: 'a', field: 'emotion', toValue: 'calm', reason: '',
    });
    expect(validateEventStructure(emptyReason)).toMatchObject({ code: 'INVALID_EVENT_SHAPE' });

    const duplicate = proposal({
      type: 'character_state_changed', characterId: 'a', field: 'emotion', toValue: 'calm', reason: 'first',
    });
    duplicate.stateChanges.push({
      type: 'character_state_changed', characterId: 'a', field: 'emotion', toValue: 'angry', reason: 'second',
    });
    expect(validateCanon(duplicate, current, context)).toMatchObject({ code: 'INVALID_CHARACTER_STATE_CHANGE' });

    const contradictoryDeath = proposal({
      type: 'character_life_changed', characterId: 'a', alive: false, reason: 'fatal event',
    });
    contradictoryDeath.stateChanges.push({
      type: 'character_state_changed', characterId: 'a', field: 'active', toValue: true, reason: 'contradiction',
    });
    expect(validateCanon(contradictoryDeath, current, context)).toMatchObject({ code: 'INVALID_CHARACTER_STATE_CHANGE' });
  });

  it('prevents providers from directly overwriting projection state or bypassing commit', async () => {
    const valid = proposal({
      type: 'character_state_changed', characterId: 'a', field: 'health', toValue: 'injured', reason: 'accepted consequence',
    });
    const direct = { ...valid, characterStates: { a: { health: 'god-mode' } } };
    try {
      normalizeProposedEventOutput(direct);
      throw new Error('expected direct projection overwrite rejection');
    } catch (error) {
      expect(isCanonError(error) && error.error.code).toBe('INVALID_EVENT_SHAPE');
    }
    const store = new InMemoryCanonStore();
    store.setCanonRuleContext(context);
    await expect(commitProposedEvent(store, {
      proposed: direct as unknown as ProposedEvent, traceId: 'direct-overwrite',
    })).rejects.toMatchObject({ error: { code: 'INVALID_EVENT_SHAPE' } });
    expect(store.committedEvents()).toEqual([]);
  });
});
