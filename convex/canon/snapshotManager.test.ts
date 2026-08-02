import { isCanonError } from '../shared/errors';
import { emptyProjection, type AcceptedEvent } from './model';
import { replayWorldEvents } from './replay';
import {
  activateRecoveryHead,
  clearRecoveryHead,
  createDailySnapshot,
  getOperationalProjection,
  InMemorySnapshotRecoveryStore,
} from './snapshotManager';
import { buildSnapshot, projectionIntegrityHash } from './snapshots';

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
