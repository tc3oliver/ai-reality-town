import { commitProposedEvent } from './commit';
import { InMemoryCanonStore } from './inMemoryStore';
import type { ProposedEvent } from './model';
import {
  canonRuleContextFromConfiguration,
  importWorldConfiguration,
  InMemoryWorldImportStore,
  parseWorldConfiguration,
  WorldImportError,
  type WorldConfigurationV1,
} from './worldConfig';

function validConfiguration(): WorldConfigurationV1 {
  return {
    schemaVersion: 1,
    contentDeclaration: { fictionalWorld: true, containsRealPersonData: false },
    world: {
      id: 'mistwood',
      name: 'Mistwood',
      description: 'A fictional forest town.',
      background: 'Mistwood grew around an old rail stop.',
      era: 'Contemporary fictional era',
      technologyLevel: 'Modern consumer technology',
      geographyRules: ['Travel occurs only through connected locations.'],
      socialRules: ['The town council meets in public.'],
      laws: ['Trespass is prohibited.'],
      taboos: ['Residents do not enter the sealed tunnel.'],
      startDate: '2026-08-03',
    },
    locations: [
      {
        id: 'station', name: 'Old Station', description: 'A disused rail station.', type: 'station',
        capacity: 40, connectedLocationIds: ['square'], active: true,
      },
      {
        id: 'square', name: 'Town Square', description: 'The center of Mistwood.', type: 'public_square',
        capacity: 100, connectedLocationIds: ['station'], active: true,
      },
    ],
    organizations: [
      { id: 'gazette', name: 'Mistwood Gazette', description: 'The local paper.', type: 'newspaper', headquartersLocationId: 'square' },
    ],
    immutableRules: [
      { id: 'no-movement', description: 'Movement is disabled in this validation fixture.', enforcement: { type: 'forbid_event_type', eventType: 'movement' } },
      { id: 'fiction-only', description: 'The world is fictional.', enforcement: { type: 'narrative_only' } },
    ],
    history: [
      {
        id: 'rail-closure', title: 'Rail Closure', summary: 'The railway closed before the public story began.',
        occurredOn: '2020-06-01', locationIds: ['station'], organizationIds: ['gazette'],
      },
    ],
  };
}

function movementProposal(): ProposedEvent {
  return {
    schemaVersion: 1,
    worldId: 'mistwood',
    idempotencyKey: 'mistwood:movement:1',
    proposedBy: { type: 'system' },
    worldDay: 0,
    timeSlot: 'morning',
    eventType: 'movement',
    participantIds: ['cassia'],
    causedByEventIds: [],
    stateChanges: [{
      type: 'character_location_changed', characterId: 'cassia', fromLocationId: 'station', toLocationId: 'square',
    }],
  };
}

describe('atomic world configuration import', () => {
  it('imports a structured configuration and creates an initial snapshot', async () => {
    const store = new InMemoryWorldImportStore();
    const result = await importWorldConfiguration(store, validConfiguration(), 1_700_000_000_000);
    expect(result).toEqual({
      worldId: 'mistwood', locationCount: 2, organizationCount: 1,
      immutableRuleCount: 2, historyCount: 1, initialSnapshotSequence: -1,
    });
    const plan = store.plan('mistwood');
    expect(plan?.initialSnapshot).toMatchObject({ worldId: 'mistwood', lastSequenceNumber: -1 });
    expect(plan?.initialSnapshot.projection).toEqual({
      worldId: 'mistwood', lastSequenceNumber: -1, characterLocations: {}, characterAlive: {},
      lastCharacterMovement: {}, itemOwners: {}, characterKnowledge: {}, relationships: {}, facts: [],
    });
  });

  it('rejects malformed schema and fictional-content declaration before writing', async () => {
    const store = new InMemoryWorldImportStore();
    const malformed = { ...validConfiguration(), unexpected: true };
    await expect(importWorldConfiguration(store, malformed, 1)).rejects.toMatchObject({ code: 'WORLD_CONFIG_INVALID_SHAPE' });
    const realPerson: unknown = { ...validConfiguration(), contentDeclaration: { fictionalWorld: false, containsRealPersonData: true } };
    await expect(importWorldConfiguration(store, realPerson, 1)).rejects.toMatchObject({ code: 'WORLD_CONFIG_NOT_FICTIONAL' });
    expect(store.importedWorldIds()).toEqual([]);
  });

  it.each([
    ['location connection', (config: WorldConfigurationV1) => { config.locations[0].connectedLocationIds = ['missing']; }],
    ['organization headquarters', (config: WorldConfigurationV1) => { config.organizations[0].headquartersLocationId = 'missing'; }],
    ['history organization', (config: WorldConfigurationV1) => { config.history[0].organizationIds = ['missing']; }],
  ])('rejects an invalid %s reference before writing', async (_name, mutate) => {
    const store = new InMemoryWorldImportStore();
    const config = validConfiguration();
    mutate(config);
    await expect(importWorldConfiguration(store, config, 1)).rejects.toMatchObject({ code: 'WORLD_CONFIG_INVALID_REFERENCE' });
    expect(store.importedWorldIds()).toEqual([]);
  });

  it('rejects initial history dated after world start', async () => {
    const store = new InMemoryWorldImportStore();
    const config = validConfiguration();
    config.history[0].occurredOn = '2027-01-01';
    await expect(importWorldConfiguration(store, config, 1)).rejects.toMatchObject({
      code: 'WORLD_CONFIG_INVALID_REFERENCE', path: 'history[0].occurredOn',
    });
    expect(store.importedWorldIds()).toEqual([]);
  });

  it('makes persisted immutable rules consumable by the Canon commit validator', async () => {
    const configuration = parseWorldConfiguration(validConfiguration());
    const canonStore = new InMemoryCanonStore();
    canonStore.setCanonRuleContext(canonRuleContextFromConfiguration(configuration));
    await expect(commitProposedEvent(canonStore, { proposed: movementProposal(), traceId: 'trace-1' })).rejects.toMatchObject({
      error: { code: 'IMMUTABLE_WORLD_RULE_VIOLATION', details: { ruleId: 'no-movement' } },
    });
    expect(canonStore.committedEvents()).toEqual([]);
  });

  it('rolls every staged row back when an injected write fails', async () => {
    const store = new InMemoryWorldImportStore();
    store.injectFailureAfter(3);
    await expect(importWorldConfiguration(store, validConfiguration(), 1)).rejects.toThrow('INJECTED_WORLD_IMPORT_FAILURE');
    expect(store.importedWorldIds()).toEqual([]);
  });

  it('rejects duplicate world imports without changing the first import', async () => {
    const store = new InMemoryWorldImportStore();
    await importWorldConfiguration(store, validConfiguration(), 1);
    const original = store.plan('mistwood');
    await expect(importWorldConfiguration(store, validConfiguration(), 2)).rejects.toMatchObject({ code: 'WORLD_ALREADY_EXISTS' });
    expect(store.plan('mistwood')).toBe(original);
  });

  it('uses stable error objects rather than free-text classification', () => {
    try {
      parseWorldConfiguration({ schemaVersion: 99 });
      throw new Error('expected parsing to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(WorldImportError);
      expect(error).toMatchObject({ code: 'WORLD_CONFIG_UNSUPPORTED_VERSION' });
    }
  });
});
