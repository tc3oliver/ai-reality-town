import { isCanonError } from '../shared/errors';
import { emptyProjection, type AcceptedEvent, type WorldProjection } from './model';
import { replayWorldEvents } from './replay';
import {
  activateRecoveryHead,
  clearRecoveryHead,
  createDailySnapshot,
  getOperationalProjection,
  InMemorySnapshotRecoveryStore,
} from './snapshotManager';
import { buildSnapshot, cloneProjection, projectionIntegrityHash } from './snapshots';
import { buildWorldImportPlan, type WorldConfigurationV1 } from './worldConfig';

function dailyFact(day: number): AcceptedEvent {
  const sequenceNumber = day - 1;
  return {
    schemaVersion: 1,
    worldId: 'mistwood',
    idempotencyKey: `day-${day}`,
    proposedBy: { type: 'system' },
    worldDay: day,
    timeSlot: 'night',
    eventType: 'world_event',
    participantIds: [],
    causedByEventIds: [],
    stateChanges: [{
      type: 'fact_created', subjectType: 'world', subjectId: 'mistwood',
      predicate: `day-${day}-complete`, value: true, visibility: 'canon',
    }],
    eventId: `mistwood#event#${sequenceNumber}`,
    sequenceNumber,
    acceptedAt: 1_000 + day,
    validationVersion: 'canon-v1',
    traceId: `trace-${day}`,
  };
}

function expectCode(error: unknown, code: string): void {
  expect(isCanonError(error) && error.error.code).toBe(code);
}

describe('FR-D006 daily snapshots, replay, and non-destructive rollback', () => {
  it('creates one snapshot per day and proves full/snapshot replay equality for 30 days', async () => {
    const store = new InMemorySnapshotRecoveryStore();
    const snapshots = [];
    for (let day = 1; day <= 30; day++) {
      store.appendEvent(dailyFact(day));
      const result = await createDailySnapshot(store, 'mistwood', day, 10_000 + day);
      expect(result.deduplicated).toBe(false);
      snapshots.push(result.snapshot);
      const duplicate = await createDailySnapshot(store, 'mistwood', day, 20_000 + day);
      expect(duplicate).toMatchObject({ deduplicated: true, snapshot: { snapshotId: result.snapshot.snapshotId } });
      const full = replayWorldEvents(emptyProjection('mistwood'), store.acceptedEvents());
      expect(result.snapshot.projection).toEqual(full);
    }
    expect(store.storedSnapshots()).toHaveLength(30);
    expect(snapshots.map((snapshot) => snapshot.worldDay)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1),
    );
    expect(snapshots[29].projection.facts).toHaveLength(30);
  });

  it('activates and clears a recovery head without deleting accepted history', async () => {
    const store = new InMemorySnapshotRecoveryStore();
    let dayTenSnapshotId = '';
    for (let day = 1; day <= 30; day++) {
      store.appendEvent(dailyFact(day));
      const { snapshot } = await createDailySnapshot(store, 'mistwood', day, 10_000 + day);
      if (day === 10) dayTenSnapshotId = snapshot.snapshotId;
    }
    const before = store.acceptedEvents();
    await activateRecoveryHead(store, {
      worldId: 'mistwood', snapshotId: dayTenSnapshotId, operatorId: 'ops-1',
      reason: 'investigate projection regression', createdAt: 50_000,
    });
    const rolledBack = await getOperationalProjection(store, 'mistwood');
    expect(rolledBack.lastSequenceNumber).toBe(9);
    expect(rolledBack.facts).toHaveLength(10);
    expect(store.acceptedEvents()).toEqual(before);
    expect(store.audit).toHaveLength(1);

    await clearRecoveryHead(store, {
      worldId: 'mistwood', operatorId: 'ops-1', reason: 'recovery complete', createdAt: 50_001,
    });
    const restored = await getOperationalProjection(store, 'mistwood');
    expect(restored.lastSequenceNumber).toBe(29);
    expect(restored.facts).toHaveLength(30);
    expect(store.acceptedEvents()).toEqual(before);
    expect(store.audit.map((entry) => entry.action)).toEqual(['activated', 'cleared']);
  });

  it('rejects corrupted and unsupported snapshots before replay or rollback', async () => {
    const store = new InMemorySnapshotRecoveryStore();
    store.appendEvent(dailyFact(1));
    const projection = replayWorldEvents(emptyProjection('mistwood'), store.acceptedEvents());
    const valid = buildSnapshot(projection, 1, 1);
    const corrupt = { ...valid, projection: { ...valid.projection, facts: [] } };
    const storedCorrupt = await store.saveSnapshot(corrupt, 'manual');
    try {
      await activateRecoveryHead(store, {
        worldId: 'mistwood', snapshotId: storedCorrupt.snapshotId, operatorId: 'ops', reason: 'test', createdAt: 2,
      });
      throw new Error('expected corrupt snapshot rejection');
    } catch (error) {
      expectCode(error, 'SNAPSHOT_CORRUPT');
    }

    const forged = { ...corrupt, projectionHash: projectionIntegrityHash(corrupt.projection) };
    const storedForged = await store.saveSnapshot(forged, 'manual');
    try {
      await activateRecoveryHead(store, {
        worldId: 'mistwood', snapshotId: storedForged.snapshotId, operatorId: 'ops', reason: 'test', createdAt: 2,
      });
      throw new Error('expected history mismatch rejection');
    } catch (error) {
      expectCode(error, 'SNAPSHOT_CORRUPT');
    }

    const unsupported = { ...valid };
    (unsupported as unknown as { snapshotVersion: number }).snapshotVersion = 2;
    const storedUnsupported = await store.saveSnapshot(unsupported, 'manual');
    try {
      await activateRecoveryHead(store, {
        worldId: 'mistwood', snapshotId: storedUnsupported.snapshotId, operatorId: 'ops', reason: 'test', createdAt: 3,
      });
      throw new Error('expected unsupported snapshot rejection');
    } catch (error) {
      expectCode(error, 'UNSUPPORTED_SNAPSHOT_VERSION');
    }
  });

  it('fails explicitly when accepted history has a sequence gap', async () => {
    const store = new InMemorySnapshotRecoveryStore();
    const gap = dailyFact(2);
    store.appendEvent(gap);
    try {
      await createDailySnapshot(store, 'mistwood', 2, 2);
      throw new Error('expected sequence gap');
    } catch (error) {
      expectCode(error, 'SEQUENCE_GAP');
    }
  });
});

describe('ART-99 seeded-world baseline replay and verification', () => {
  function seededConfiguration(): WorldConfigurationV1 {
    return {
      schemaVersion: 1,
      contentDeclaration: { fictionalWorld: true, containsRealPersonData: false },
      world: {
        id: 'seeded-town', name: 'Seeded Town', description: 'A fictional seeded town.',
        background: 'Founded for this test.', era: 'Contemporary fictional era',
        technologyLevel: 'Modern consumer technology',
        geographyRules: ['Travel occurs only through connected locations.'],
        socialRules: ['Nothing special.'], laws: ['None.'], taboos: ['None.'],
        startDate: '2026-08-03',
      },
      locations: [
        { id: 'hall', name: 'Town Hall', description: 'The seat of government.', type: 'civic', capacity: 50, connectedLocationIds: [], active: true },
      ],
      organizations: [
        { id: 'council', name: 'Town Council', description: 'Local governance.', type: 'government', headquartersLocationId: 'hall' },
      ],
      immutableRules: [
        { id: 'fiction-only', description: 'The world is fictional.', enforcement: { type: 'narrative_only' } },
      ],
      history: [
        { id: 'founding', title: 'Founding', summary: 'The town was founded.', occurredOn: '2020-01-01', locationIds: ['hall'], organizationIds: ['council'] },
      ],
    };
  }

  function seededFact(worldId: string, day: number): AcceptedEvent {
    const sequenceNumber = day - 1;
    return {
      schemaVersion: 1, worldId, idempotencyKey: `day-${day}`, proposedBy: { type: 'system' },
      worldDay: day, timeSlot: 'night', eventType: 'world_event', participantIds: [], causedByEventIds: [],
      stateChanges: [{
        type: 'fact_created', subjectType: 'world', subjectId: worldId,
        predicate: `day-${day}-complete`, value: true, visibility: 'canon',
      }],
      eventId: `${worldId}#event#${sequenceNumber}`, sequenceNumber, acceptedAt: 1_000 + day,
      validationVersion: 'canon-v1', traceId: `trace-${day}`,
    };
  }

  async function seedStore(): Promise<{ store: InMemorySnapshotRecoveryStore; worldId: string; initialProjection: WorldProjection }> {
    const store = new InMemorySnapshotRecoveryStore();
    const plan = buildWorldImportPlan(seededConfiguration(), 1_700_000_000_000);
    const worldId = plan.configuration.world.id;
    await store.saveSnapshot(plan.initialSnapshot, 'initial');
    return { store, worldId, initialProjection: plan.initialSnapshot.projection };
  }

  it('creates a daily snapshot for a world seeded through importWorld, equal to baseline + accepted events', async () => {
    const { store, worldId, initialProjection } = await seedStore();
    store.appendEvent(seededFact(worldId, 1));
    const result = await createDailySnapshot(store, worldId, 1, 10_001);
    expect(result.deduplicated).toBe(false);
    expect(result.snapshot.snapshotId).toBeTruthy();
    expect(result.snapshot.lastSequenceNumber).toBe(0);
    const expected = replayWorldEvents(cloneProjection(initialProjection), store.acceptedEvents());
    expect(result.snapshot.projection).toEqual(expected);
    // The seeded baseline (not derivable from accepted events) is present in the daily projection.
    expect(result.snapshot.projection.locations).toHaveProperty('hall');
    expect(result.snapshot.projection.organizations).toHaveProperty('council');
  });

  it('deduplicates a second call for the same world day on a seeded world', async () => {
    const { store, worldId } = await seedStore();
    store.appendEvent(seededFact(worldId, 1));
    const first = await createDailySnapshot(store, worldId, 1, 10_001);
    const second = await createDailySnapshot(store, worldId, 1, 20_001);
    expect(second.deduplicated).toBe(true);
    expect(second.snapshot.snapshotId).toBe(first.snapshot.snapshotId);
  });

  it('does not double-apply events across the seeded baseline over several days', async () => {
    const { store, worldId, initialProjection } = await seedStore();
    for (let day = 1; day <= 3; day++) {
      store.appendEvent(seededFact(worldId, day));
      await createDailySnapshot(store, worldId, day, 10_000 + day);
    }
    const last = await store.findDailySnapshot(worldId, 3);
    expect(last?.lastSequenceNumber).toBe(2);
    expect(last?.projection.facts).toHaveLength(3);
    const expected = replayWorldEvents(cloneProjection(initialProjection), store.acceptedEvents());
    expect(last?.projection).toEqual(expected);
  });

  it('rejects a modified seeded baseline as corrupt', async () => {
    const store = new InMemorySnapshotRecoveryStore();
    const plan = buildWorldImportPlan(seededConfiguration(), 1_700_000_000_000);
    const worldId = plan.configuration.world.id;
    const tampered = { ...plan.initialSnapshot, projection: { ...plan.initialSnapshot.projection, locations: {} } };
    await store.saveSnapshot(tampered, 'initial');
    store.appendEvent(seededFact(worldId, 1));
    try {
      await createDailySnapshot(store, worldId, 1, 10_001);
      throw new Error('expected corrupt seeded baseline rejection');
    } catch (error) {
      expectCode(error, 'SNAPSHOT_CORRUPT');
    }
  });

  it('rejects a modified daily snapshot on a seeded world as corrupt', async () => {
    const { store, worldId, initialProjection } = await seedStore();
    store.appendEvent(seededFact(worldId, 1));
    const projection = replayWorldEvents(cloneProjection(initialProjection), store.acceptedEvents());
    const corrupt = { ...buildSnapshot(projection, 1, 1), projection: { ...projection, facts: [] } };
    await store.saveSnapshot(corrupt, 'daily');
    try {
      await createDailySnapshot(store, worldId, 1, 2);
      throw new Error('expected corrupt daily snapshot rejection');
    } catch (error) {
      expectCode(error, 'SNAPSHOT_CORRUPT');
    }
  });

  it('fails when a seeded world has a sequence gap after the baseline', async () => {
    const store = new InMemorySnapshotRecoveryStore();
    const plan = buildWorldImportPlan(seededConfiguration(), 1_700_000_000_000);
    const worldId = plan.configuration.world.id;
    await store.saveSnapshot(plan.initialSnapshot, 'initial');
    store.appendEvent(seededFact(worldId, 2)); // sequenceNumber 1, skipping the required 0 after the baseline
    try {
      await createDailySnapshot(store, worldId, 2, 2);
      throw new Error('expected sequence gap');
    } catch (error) {
      expectCode(error, 'SEQUENCE_GAP');
    }
  });

  it('recovery-head rollback on a seeded world still includes the seeded baseline projection', async () => {
    const { store, worldId } = await seedStore();
    let daySnapshotId = '';
    for (let day = 1; day <= 3; day++) {
      store.appendEvent(seededFact(worldId, day));
      const { snapshot } = await createDailySnapshot(store, worldId, day, 10_000 + day);
      if (day === 2) daySnapshotId = snapshot.snapshotId;
    }
    await activateRecoveryHead(store, {
      worldId, snapshotId: daySnapshotId, operatorId: 'ops', reason: 'seeded rollback test', createdAt: 99_999,
    });
    const projection = await getOperationalProjection(store, worldId);
    expect(projection.lastSequenceNumber).toBe(1);
    expect(projection.facts).toHaveLength(2);
    expect(projection.locations).toHaveProperty('hall');

    await clearRecoveryHead(store, { worldId, operatorId: 'ops', reason: 'done', createdAt: 100_000 });
    const restored = await getOperationalProjection(store, worldId);
    expect(restored.lastSequenceNumber).toBe(2);
    expect(restored.facts).toHaveLength(3);
  });
});
