/**
 * Control-path integration test for the FR-K006 kill switch and its recovery paths.
 *
 * The caller-facing mutations in `emergencyStopFunctions.ts` are thin — authorize,
 * call a shared helper, audit — so this suite drives those SAME shared helpers against
 * an in-memory Convex `db` double and proves the four PRD guarantees by execution:
 *
 *   AC#1  new simulation work is refused, existing public content is untouched
 *   AC#2  incomplete run state and accepted events survive verbatim
 *   AC#3  an authorized operator can resume, or roll back non-destructively
 *   AC#4  activation, repeated activation, resume, and rollback are idempotent
 *
 * The rollback half runs against the ART-17 {@link InMemorySnapshotRecoveryStore}, the
 * same reference store the snapshot suite uses, so the "non-destructive" claim is
 * checked against the real recovery primitive rather than a re-implementation.
 */

import { readFileSync } from 'node:fs';
import type { GenericMutationCtx } from 'convex/server';
import type { DataModel } from '../_generated/dataModel';
import { activateRecoveryHead, clearRecoveryHead, InMemorySnapshotRecoveryStore } from '../canon/snapshotManager';
import { buildSnapshot } from '../canon/snapshots';
import { emptyProjection, type AcceptedEvent } from '../canon/model';
import {
  selectServedVersion,
  serveReadModel,
  type PublicReadReadStore,
  type StoredReadModel,
} from '../publicRead/readModel';
import { EMERGENCY_STOP_ERROR_CODE } from '../simulation/emergencyStop';
import {
  assertPublicWorldAdmitsSimulation,
  assertWorldAdmitsSimulation,
  engageWorldEmergencyStop,
  isPublicWorldEmergencyStopped,
  isWorldEmergencyStopped,
  PUBLIC_EMERGENCY_STOP_WORLD_ID,
  readEmergencyStopState,
  releaseWorldEmergencyStop,
} from '../simulation/emergencyStopOperations';
import { loadScheduleRow, reserveSlots } from '../simulation/schedulerOperations';
import { capabilitiesForRole, hasCapability, OPS_CAPABILITY_MINIMUM_ROLE } from './operatorAuthorization';

type MutationDb = GenericMutationCtx<DataModel>['db'];
type Row = Record<string, unknown> & { _id: string };

/** Minimal in-memory stand-in for the Convex `db` surface these helpers use. */
function createFakeDb() {
  const tables = new Map<string, Row[]>();
  let counter = 0;
  const rowsOf = (table: string): Row[] => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table) as Row[];
  };
  const findById = (id: string): { row: Row; table: string } | null => {
    for (const [table, rows] of tables) {
      const row = rows.find((candidate) => candidate._id === id);
      if (row) return { row, table };
    }
    return null;
  };
  return {
    insert(table: string, doc: Record<string, unknown>) {
      const _id = `${table}:${(counter += 1)}`;
      rowsOf(table).push({ ...doc, _id });
      return Promise.resolve(_id);
    },
    get(id: string) {
      return Promise.resolve(findById(id)?.row ?? null);
    },
    patch(id: string, patch: Record<string, unknown>) {
      const found = findById(id);
      if (!found) throw new Error(`no such row: ${id}`);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete found.row[key];
        else found.row[key] = value;
      }
      return Promise.resolve();
    },
    query(table: string) {
      return {
        withIndex(_index: string, build?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown) {
          const constraints: [string, unknown][] = [];
          const builder = { eq: (field: string, value: unknown) => { constraints.push([field, value]); return builder; } };
          build?.(builder);
          const matched = () => rowsOf(table).filter((row) => constraints.every(([field, value]) => row[field] === value));
          const cursor = {
            unique() {
              const rows = matched();
              if (rows.length > 1) throw new Error('unique() matched multiple rows');
              return Promise.resolve(rows[0] ?? null);
            },
            collect() { return Promise.resolve(matched()); },
            first() { return Promise.resolve(matched()[0] ?? null); },
            order() { return cursor; },
          };
          return cursor;
        },
      };
    },
    rowsOf,
  };
}

type FakeDb = ReturnType<typeof createFakeDb>;

const WORLD = 'mistwood';
const T0 = 1_000_000;
const OPERATOR = { operatorId: 'ops-admin', reason: 'runaway generation cost' };

function asDb(db: FakeDb): MutationDb {
  return db as unknown as MutationDb;
}

async function seedSchedule(db: FakeDb, over: Record<string, unknown> = {}) {
  await db.insert('worldSchedules', {
    worldId: WORLD, mode: 'development', status: 'running', baseSeed: 7,
    anchorRealTimeMs: T0, anchorWorldDay: 1, nextWorldDay: 1, nextTimeSlot: 'morning',
    publishEnabled: false, createdAt: T0, updatedAt: T0, ...over,
  });
}

/** One published public page, plus a running and a completed slot: the state a stop must preserve. */
async function seedWorldWithWork(db: FakeDb) {
  await seedSchedule(db);
  await reserveSlots(asDb(db), WORLD, 3, 'manual-slot', T0);
  const [first, , third] = db.rowsOf('scheduledSlots');
  await db.patch(first._id, { status: 'completed', committedEventId: 'evt-1', completedAt: T0 + 5 });
  await db.patch(third._id, { status: 'running', startedAt: T0 + 9, attemptCount: 1 });
  await db.insert('canonEvents', { worldId: WORLD, eventId: 'evt-1', sequenceNumber: 0 });
  await db.insert('publishedReadModels', {
    schemaVersion: 1, worldId: WORLD, modelKind: 'world', modelRef: 'world:mistwood', version: 3,
    payload: { headline: 'Day 1 in Mistwood' }, status: 'published', sourceEventIds: ['evt-1'],
    isCurrent: true, isLastKnownGood: true, contentHash: 'rmhash:seed', createdAt: T0, publishedAt: T0, updatedAt: T0,
  });
}

/**
 * The public read path over the SAME db the kill switch writes to. Backed only by
 * `publishedReadModels`, exactly like the production wiring — which is why a public
 * page keeps serving while the simulation is halted.
 */
function publicReadStore(db: FakeDb): PublicReadReadStore {
  return {
    loadTargetVersions: (worldId, modelKind, modelRef) => Promise.resolve(
      db.rowsOf('publishedReadModels')
        .filter((row) => row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef)
        .map((row) => row as unknown as StoredReadModel),
    ),
  };
}

const servePublicPage = (db: FakeDb) => serveReadModel(publicReadStore(db), WORLD, 'world', 'world:mistwood');
const slotSnapshot = (db: FakeDb) => structuredClone(db.rowsOf('scheduledSlots'));

describe('engage the kill switch (FR-K006 AC#1, AC#2)', () => {
  it('halts new work, pauses the schedule, and records the preserved queue', async () => {
    const db = createFakeDb();
    await seedWorldWithWork(db);

    const outcome = await engageWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, now: T0 + 100 });

    expect(outcome).toMatchObject({ changed: true, resultCode: 'OPS_EMERGENCY_STOP_ENGAGED' });
    expect(await isWorldEmergencyStopped(asDb(db), WORLD)).toBe(true);
    expect((await loadScheduleRow(asDb(db), WORLD)).status).toBe('paused');
    // Both unfinished slots are recorded as preserved; the completed one is not.
    expect(outcome.view.preservedSlotKeys)
      .toEqual(['mistwood:day:1:slot:afternoon', 'mistwood:day:1:slot:noon']);
    expect(outcome.view).toMatchObject({
      engaged: true, engagedAt: T0 + 100, engagedBy: 'ops-admin', scheduleStatusBefore: 'running', activationCount: 1,
    });
  });

  it('preserves every incomplete run and every accepted event byte for byte (AC#2)', async () => {
    const db = createFakeDb();
    await seedWorldWithWork(db);
    const slotsBefore = slotSnapshot(db);
    const canonBefore = structuredClone(db.rowsOf('canonEvents'));

    await engageWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, now: T0 + 100 });

    // Not cancelled, not failed, not requeued, not stripped of its committed event.
    expect(slotSnapshot(db)).toEqual(slotsBefore);
    expect(db.rowsOf('canonEvents')).toEqual(canonBefore);
  });

  it('keeps existing public content servable throughout the outage (AC#1)', async () => {
    const db = createFakeDb();
    await seedWorldWithWork(db);
    const before = await servePublicPage(db);
    expect(before).toMatchObject({ servedFrom: 'current', status: 'published', payload: { headline: 'Day 1 in Mistwood' } });

    await engageWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, now: T0 + 100 });
    expect(await servePublicPage(db)).toEqual(before);

    await releaseWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, reason: 'incident closed', now: T0 + 900 });
    expect(await servePublicPage(db)).toEqual(before);
    // The read model was never versioned, withheld, or re-published by the switch.
    expect(db.rowsOf('publishedReadModels')).toHaveLength(1);
    expect(selectServedVersion(db.rowsOf('publishedReadModels') as unknown as StoredReadModel[])?.version).toBe(3);
  });

  it('refuses new simulation work while engaged and admits it again after release', async () => {
    const db = createFakeDb();
    await seedWorldWithWork(db);
    await expect(assertWorldAdmitsSimulation(asDb(db), WORLD)).resolves.toBeUndefined();

    await engageWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, now: T0 + 100 });
    await expect(assertWorldAdmitsSimulation(asDb(db), WORLD))
      .rejects.toThrow(new RegExp(EMERGENCY_STOP_ERROR_CODE));

    await releaseWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, reason: 'incident closed', now: T0 + 900 });
    await expect(assertWorldAdmitsSimulation(asDb(db), WORLD)).resolves.toBeUndefined();
  });

  it('is idempotent: repeated activation applies nothing and keeps the first activation (AC#4)', async () => {
    const db = createFakeDb();
    await seedWorldWithWork(db);
    await engageWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, now: T0 + 100 });
    const stopRowBefore = structuredClone(db.rowsOf('worldEmergencyStops'));

    const repeat = await engageWorldEmergencyStop(asDb(db), WORLD, {
      operatorId: 'ops-other', reason: 'second operator hits the switch', now: T0 + 400,
    });

    expect(repeat).toMatchObject({ changed: false, resultCode: 'OPS_EMERGENCY_STOP_ALREADY_ENGAGED' });
    expect(db.rowsOf('worldEmergencyStops')).toEqual(stopRowBefore);
    expect(repeat.view).toMatchObject({ engagedBy: 'ops-admin', engagedAt: T0 + 100, activationCount: 1 });
  });

  it('rejects a blank operator, a blank reason, a bad clock, and an unknown world', async () => {
    const db = createFakeDb();
    await seedSchedule(db);
    await expect(engageWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, operatorId: ' ', now: T0 }))
      .rejects.toThrow(/EMERGENCY_STOP_INPUT_INVALID/);
    await expect(engageWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, reason: '', now: T0 }))
      .rejects.toThrow(/EMERGENCY_STOP_INPUT_INVALID/);
    await expect(engageWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, now: Number.NaN }))
      .rejects.toThrow(/EMERGENCY_STOP_INPUT_INVALID/);
    await expect(engageWorldEmergencyStop(asDb(db), 'no-such-world', { ...OPERATOR, now: T0 }))
      .rejects.toThrow(/SCHEDULE_NOT_FOUND/);
    expect(db.rowsOf('worldEmergencyStops')).toEqual([]);
  });
});

describe('release the kill switch (FR-K006 AC#3, AC#4)', () => {
  it('resumes a world that was running and absorbs the halted duration into the clock anchor', async () => {
    const db = createFakeDb();
    await seedWorldWithWork(db);
    await engageWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, now: T0 + 100 });

    const released = await releaseWorldEmergencyStop(asDb(db), WORLD, {
      operatorId: 'ops-admin', reason: 'incident closed', now: T0 + 2_100,
    });

    expect(released).toMatchObject({ changed: true, resultCode: 'OPS_EMERGENCY_STOP_RELEASED' });
    const schedule = await loadScheduleRow(asDb(db), WORLD);
    expect(schedule.status).toBe('running');
    expect(schedule.pausedAt).toBeUndefined();
    // The public world clock must not jump: the anchor absorbs the 2000ms outage.
    expect(schedule.anchorRealTimeMs).toBe(T0 + 2_000);
    expect(await isWorldEmergencyStopped(asDb(db), WORLD)).toBe(false);
  });

  it('leaves a world that was already paused before the emergency paused', async () => {
    const db = createFakeDb();
    await seedSchedule(db, { status: 'paused', pausedAt: T0 - 50 });
    await engageWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, now: T0 + 100 });
    await releaseWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, reason: 'incident closed', now: T0 + 2_100 });

    const schedule = await loadScheduleRow(asDb(db), WORLD);
    expect(schedule.status).toBe('paused');
    expect(schedule.anchorRealTimeMs).toBe(T0);
  });

  it('is idempotent: releasing a world that is not stopped changes nothing (AC#4)', async () => {
    const db = createFakeDb();
    await seedWorldWithWork(db);
    const never = await releaseWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, reason: 'nothing to do', now: T0 + 10 });
    expect(never).toMatchObject({ changed: false, resultCode: 'OPS_EMERGENCY_STOP_NOT_ENGAGED' });
    expect(db.rowsOf('worldEmergencyStops')).toEqual([]);

    await engageWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, now: T0 + 100 });
    await releaseWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, reason: 'incident closed', now: T0 + 2_100 });
    const scheduleAfterFirst = structuredClone(db.rowsOf('worldSchedules'));

    const repeat = await releaseWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, reason: 'again', now: T0 + 3_000 });
    expect(repeat).toMatchObject({ changed: false, resultCode: 'OPS_EMERGENCY_STOP_NOT_ENGAGED' });
    expect(db.rowsOf('worldSchedules')).toEqual(scheduleAfterFirst);
  });

  it('records each activation so a repeated incident is distinguishable from a repeated command', async () => {
    const db = createFakeDb();
    await seedWorldWithWork(db);
    await engageWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, now: T0 + 100 });
    await engageWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, now: T0 + 150 });
    await releaseWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, reason: 'incident closed', now: T0 + 2_100 });
    await engageWorldEmergencyStop(asDb(db), WORLD, { ...OPERATOR, reason: 'it happened again', now: T0 + 5_000 });

    const view = await readEmergencyStopState(asDb(db), WORLD);
    expect(view).toMatchObject({ engaged: true, activationCount: 2, reason: 'it happened again', engagedAt: T0 + 5_000 });
    expect(db.rowsOf('worldEmergencyStops')).toHaveLength(1);
  });

  it('reports an unused switch without inventing a record', async () => {
    const db = createFakeDb();
    await seedSchedule(db);
    expect(await readEmergencyStopState(asDb(db), WORLD))
      .toEqual({ worldId: WORLD, engaged: false, state: 'released', preservedSlotKeys: [], activationCount: 0 });
  });
});

describe('authorized non-destructive rollback (FR-K006 AC#3, AC#4)', () => {
  const event = (sequenceNumber: number): AcceptedEvent => ({
    schemaVersion: 1, eventId: `evt-${sequenceNumber}`, worldId: WORLD, sequenceNumber, worldDay: sequenceNumber,
    timeSlot: 'morning', eventType: 'conversation', participantIds: ['gao-wenrui'], locationId: 'mistwood-hall',
    summary: `event ${sequenceNumber}`, stateChanges: [], visibility: 'public',
    proposedBy: { type: 'director', runId: 'run-1' }, idempotencyKey: `key-${sequenceNumber}`,
    validationVersion: 'canon-v1', traceId: 'trace-1', acceptedAt: T0 + sequenceNumber,
  } as unknown as AcceptedEvent);

  async function seededRecoveryStore() {
    const store = new InMemorySnapshotRecoveryStore();
    for (const sequenceNumber of [0, 1, 2]) store.appendEvent(event(sequenceNumber));
    // A verified snapshot of the world as of day 1, i.e. before the last event.
    const projection = { ...emptyProjection(WORLD), lastSequenceNumber: -1 };
    const snapshot = await store.saveSnapshot(buildSnapshot(projection, T0, 0), 'daily');
    return { store, snapshot };
  }

  it('moves one read pointer and never edits or deletes an accepted event', async () => {
    const { store, snapshot } = await seededRecoveryStore();
    const before = store.acceptedEvents();

    const head = await activateRecoveryHead(store, {
      worldId: WORLD, snapshotId: snapshot.snapshotId, ...OPERATOR, reason: 'bad batch published', createdAt: T0 + 10,
    });

    expect(head).toMatchObject({ targetSnapshotId: snapshot.snapshotId, targetSequenceNumber: snapshot.lastSequenceNumber });
    expect(store.acceptedEvents()).toEqual(before);
    expect(store.audit).toMatchObject([{ action: 'activated', operatorId: 'ops-admin', reason: 'bad batch published' }]);
  });

  it('is reversible: clearing the pointer restores the full projection and keeps history intact', async () => {
    const { store, snapshot } = await seededRecoveryStore();
    await activateRecoveryHead(store, {
      worldId: WORLD, snapshotId: snapshot.snapshotId, ...OPERATOR, reason: 'bad batch published', createdAt: T0 + 10,
    });
    await clearRecoveryHead(store, { worldId: WORLD, ...OPERATOR, reason: 'rollback no longer needed', createdAt: T0 + 20 });

    expect(await store.loadRecoveryHead(WORLD)).toBeNull();
    expect(store.acceptedEvents()).toHaveLength(3);
    expect(store.audit.map(({ action }) => action)).toEqual(['activated', 'cleared']);
  });

  it('is idempotent: re-activating the same snapshot leaves exactly one head (AC#4)', async () => {
    const { store, snapshot } = await seededRecoveryStore();
    const args = { worldId: WORLD, snapshotId: snapshot.snapshotId, ...OPERATOR, reason: 'bad batch published' };
    const first = await activateRecoveryHead(store, { ...args, createdAt: T0 + 10 });
    const second = await activateRecoveryHead(store, { ...args, createdAt: T0 + 30 });

    expect(second.targetSnapshotId).toBe(first.targetSnapshotId);
    expect(second.targetSequenceNumber).toBe(first.targetSequenceNumber);
    expect(await store.loadRecoveryHead(WORLD)).toMatchObject({ targetSnapshotId: snapshot.snapshotId });
    expect(store.acceptedEvents()).toHaveLength(3);
  });

  it('refuses a rollback target that does not exist', async () => {
    const { store } = await seededRecoveryStore();
    await expect(activateRecoveryHead(store, {
      worldId: WORLD, snapshotId: 'snapshot-missing', ...OPERATOR, reason: 'typo', createdAt: T0 + 10,
    })).rejects.toThrow(/RECOVERY_HEAD_CONFLICT/);
  });
});

describe('authorization and wiring (FR-K006, NFR-005)', () => {
  it('reserves every emergency capability for admin', () => {
    for (const capability of ['world.emergency_stop', 'world.emergency_resume', 'world.rollback'] as const) {
      expect(OPS_CAPABILITY_MINIMUM_ROLE[capability]).toBe('admin');
      expect(hasCapability('viewer', capability)).toBe(false);
      expect(hasCapability('operator', capability)).toBe(false);
      expect(hasCapability('admin', capability)).toBe(true);
      expect(capabilitiesForRole('admin')).toContain(capability);
    }
    expect(capabilitiesForRole('operator')).not.toContain('world.emergency_stop');
  });

  it('authorizes and audits every emergency mutation through ART-48s single gate', () => {
    const source = readFileSync('convex/operations/emergencyStopFunctions.ts', 'utf8');
    // Reuses the console gate rather than standing up a second mechanism.
    expect(source).toContain("from './opsConsoleFunctions'");
    expect(source).not.toContain('SIMULATION_OPS_OPERATORS');
    expect(source).not.toContain('parseOperatorRegistry');
    for (const capability of ['world.emergency_stop', 'world.emergency_resume', 'world.rollback']) {
      expect(source).toContain(`requireOperator(ctx, '${capability}', args)`);
    }
    // One audit row per command: four mutations, four recordAudit calls.
    expect(source.match(/\bmutation\(\{/g)).toHaveLength(4);
    expect(source.match(/await recordAudit\(ctx, \{/g)).toHaveLength(4);
    // Accepted Canon is never written by the emergency surface.
    expect(source).not.toMatch(/db\.(insert|patch|delete)\('canonEvents'/);
  });

  it('gates the live executor on the switch at both the claim and the stage boundary', () => {
    const source = readFileSync('convex/simulation/worldDayLiveFunctions.ts', 'utf8');
    expect(source).toContain('await assertWorldAdmitsSimulation(ctx.db, args.worldId)');
    expect(source).toContain('guardWorldDayStageHandlers(');
    expect(source).toContain('isWorldEmergencyStopped(ctx.db, row.worldId)');
  });

  it('exposes no internal mutation that engages or releases the switch unaudited', () => {
    const source = readFileSync('convex/simulation/emergencyStopOperations.ts', 'utf8');
    expect(source).toContain('internalQuery({');
    expect(source).not.toContain('internalMutation({');
  });
});

describe('FR-K006 audit H-5 — the kill switch halts the upstream AI Town engine', () => {
  it('the public-world admission helpers track the public world switch end to end', async () => {
    const db = createFakeDb();
    await seedSchedule(db);
    expect(PUBLIC_EMERGENCY_STOP_WORLD_ID).toBe(WORLD);
    // Before engagement the public world admits simulation.
    expect(await isPublicWorldEmergencyStopped(asDb(db))).toBe(false);
    await expect(assertPublicWorldAdmitsSimulation(asDb(db))).resolves.toBeUndefined();

    await engageWorldEmergencyStop(asDb(db), PUBLIC_EMERGENCY_STOP_WORLD_ID, { ...OPERATOR, now: T0 + 100 });

    // The public-world helpers now refuse generation, exactly like the parameterized gate.
    expect(await isPublicWorldEmergencyStopped(asDb(db))).toBe(true);
    await expect(assertPublicWorldAdmitsSimulation(asDb(db)))
      .rejects.toThrow(new RegExp(EMERGENCY_STOP_ERROR_CODE));
  });

  it('the restart cron and heartbeat do not revive engines while the switch is engaged', () => {
    const source = readFileSync('convex/world.ts', 'utf8');
    // restartDeadWorlds short-circuits and heartbeatWorld gates its inactive-restart branch.
    expect(source.match(/isPublicWorldEmergencyStopped\(ctx\.db\)/g)).toHaveLength(2);
    expect(source).toContain('skipping dead-engine restarts.');
    expect(source).toContain('not restarting inactive world.');
  });

  it('upstream client input routes refuse generation work while the switch is engaged', () => {
    // joinWorld + sendWorldInput (world.ts), writeMessage (messages.ts), sendInput (aiTown/main.ts).
    expect(readFileSync('convex/world.ts', 'utf8').match(/await assertPublicWorldAdmitsSimulation\(ctx\.db\)/g)).toHaveLength(2);
    expect(readFileSync('convex/messages.ts', 'utf8').match(/await assertPublicWorldAdmitsSimulation\(ctx\.db\)/g)).toHaveLength(1);
    expect(readFileSync('convex/aiTown/main.ts', 'utf8').match(/await assertPublicWorldAdmitsSimulation\(ctx\.db\)/g)).toHaveLength(1);
  });
});
