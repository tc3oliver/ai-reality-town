/**
 * Control-path integration test for the operations console (FR-K001 AC#1, AC#2).
 *
 * The console's caller-facing mutations in `opsConsoleFunctions.ts` are thin:
 * they authorize, call a shared helper, then audit. This suite drives those SAME
 * shared helpers — the ones the pre-existing internal mutations also call —
 * against an in-memory Convex `db` double, so "an authorized operator can pause,
 * resume, advance, retry, cancel, and inspect" is proven by execution rather than
 * by reading the wiring.
 */

import type { GenericMutationCtx } from 'convex/server';
import type { DataModel, Doc, Id } from '../_generated/dataModel';
import {
  loadScheduleRow,
  pauseWorldSchedule,
  readScheduleInspection,
  readSlotAttemptHistory,
  reserveSlots,
  resumeWorldSchedule,
  retrySlotRun,
  ATTEMPT_HISTORY_SLOT_LIMIT,
} from '../simulation/schedulerOperations';
import { worldDayRunId } from '../simulation/worldDayLive';
import type { TimeSlot } from '../canon/eventTypes';
import { decideSlotCancellation } from './opsConsole';

type MutationDb = GenericMutationCtx<DataModel>['db'];
type Row = Record<string, unknown> & { _id: string };

/**
 * Minimal in-memory stand-in for the Convex `db` surface these helpers use.
 * `withIndex` is modelled as an equality filter over the fields the caller
 * constrains, which is behaviourally equivalent for the indexes in play.
 */
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
  const db = {
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
        // Convex removes a field when it is patched to undefined.
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
  return db;
}

type FakeDb = ReturnType<typeof createFakeDb>;

const WORLD = 'mistwood';
const T0 = 1_000_000;

async function seedSchedule(db: FakeDb, over: Record<string, unknown> = {}) {
  await db.insert('worldSchedules', {
    worldId: WORLD, mode: 'development', status: 'running', baseSeed: 7,
    anchorRealTimeMs: T0, anchorWorldDay: 1, nextWorldDay: 1, nextTimeSlot: 'morning',
    publishEnabled: false, createdAt: T0, updatedAt: T0, ...over,
  });
}

function asDb(db: FakeDb): MutationDb {
  return db as unknown as MutationDb;
}

describe('pause and resume the world (FR-K001)', () => {
  it('pauses a running world and records the pause instant', async () => {
    const db = createFakeDb();
    await seedSchedule(db);
    await pauseWorldSchedule(asDb(db), WORLD, T0 + 500);
    const row = await loadScheduleRow(asDb(db), WORLD);
    expect(row.status).toBe('paused');
    expect(row.pausedAt).toBe(T0 + 500);
  });

  it('is idempotent under retry: pausing an already-paused world changes nothing (AC#2)', async () => {
    const db = createFakeDb();
    await seedSchedule(db);
    await pauseWorldSchedule(asDb(db), WORLD, T0 + 500);
    await pauseWorldSchedule(asDb(db), WORLD, T0 + 900);
    const row = await loadScheduleRow(asDb(db), WORLD);
    expect(row.status).toBe('paused');
    expect(row.pausedAt).toBe(T0 + 500);
  });

  it('resumes a paused world and shifts the real-time anchor by the paused duration', async () => {
    const db = createFakeDb();
    await seedSchedule(db);
    await pauseWorldSchedule(asDb(db), WORLD, T0 + 500);
    await resumeWorldSchedule(asDb(db), WORLD, T0 + 2_500);
    const row = await loadScheduleRow(asDb(db), WORLD);
    expect(row.status).toBe('running');
    expect(row.pausedAt).toBeUndefined();
    // The public clock must not jump: the anchor absorbs the 2000ms pause.
    expect(row.anchorRealTimeMs).toBe(T0 + 2_000);
  });

  it('is idempotent under retry: resuming a running world changes nothing (AC#2)', async () => {
    const db = createFakeDb();
    await seedSchedule(db);
    await resumeWorldSchedule(asDb(db), WORLD, T0 + 900);
    const row = await loadScheduleRow(asDb(db), WORLD);
    expect(row.status).toBe('running');
    expect(row.anchorRealTimeMs).toBe(T0);
  });

  it('rejects a resume that precedes the pause and a non-finite clock', async () => {
    const db = createFakeDb();
    await seedSchedule(db);
    await pauseWorldSchedule(asDb(db), WORLD, T0 + 500);
    await expect(resumeWorldSchedule(asDb(db), WORLD, T0)).rejects.toThrow(/INVALID_CLOCK/);
    await expect(pauseWorldSchedule(asDb(db), WORLD, Number.NaN)).rejects.toThrow(/INVALID_CLOCK/);
  });

  it('reports a missing schedule rather than silently succeeding', async () => {
    const db = createFakeDb();
    await expect(pauseWorldSchedule(asDb(db), WORLD, T0)).rejects.toThrow(/SCHEDULE_NOT_FOUND/);
  });
});

describe('advance one slot / one world day (FR-K001)', () => {
  it('reserves one queued slot and advances the cursor', async () => {
    const db = createFakeDb();
    await seedSchedule(db);
    const ids = await reserveSlots(asDb(db), WORLD, 1, 'manual-slot', T0);
    expect(ids).toHaveLength(1);
    const slot = db.rowsOf('scheduledSlots')[0];
    expect(slot).toMatchObject({
      worldId: WORLD, worldDay: 1, timeSlot: 'morning', status: 'queued',
      trigger: 'manual-slot', attemptCount: 0, slotKey: 'mistwood:day:1:slot:morning',
    });
    const schedule = await loadScheduleRow(asDb(db), WORLD);
    expect(schedule.nextTimeSlot).toBe('noon');
  });

  it('reserves a whole world day as five slots', async () => {
    const db = createFakeDb();
    await seedSchedule(db);
    const ids = await reserveSlots(asDb(db), WORLD, 5, 'manual-day', T0);
    expect(ids).toHaveLength(5);
    expect(db.rowsOf('scheduledSlots').map((row) => row.timeSlot))
      .toEqual(['morning', 'noon', 'afternoon', 'evening', 'night']);
    const schedule = await loadScheduleRow(asDb(db), WORLD);
    expect(schedule.nextWorldDay).toBe(2);
    expect(schedule.nextTimeSlot).toBe('morning');
  });

  it('is safe under retry: a repeated advance over the same slot key double-books nothing (AC#2)', async () => {
    const db = createFakeDb();
    await seedSchedule(db);
    await reserveSlots(asDb(db), WORLD, 1, 'manual-slot', T0);
    // Rewind the cursor to simulate a retried command landing on the same slot.
    const schedule = await loadScheduleRow(asDb(db), WORLD);
    await db.patch(schedule._id, { nextWorldDay: 1, nextTimeSlot: 'morning' });
    const second = await reserveSlots(asDb(db), WORLD, 1, 'manual-slot', T0 + 10);
    expect(second).toHaveLength(0);
    expect(db.rowsOf('scheduledSlots')).toHaveLength(1);
  });
});

describe('retry a failed job (FR-K001)', () => {
  it('requeues a failed slot, clears its error, and keeps its idempotency key', async () => {
    const db = createFakeDb();
    await seedSchedule(db);
    await reserveSlots(asDb(db), WORLD, 1, 'manual-slot', T0);
    const slot = db.rowsOf('scheduledSlots')[0];
    await db.patch(slot._id, { status: 'failed', errorCode: 'PROVIDER_TIMEOUT', completedAt: T0 + 5 });

    await retrySlotRun(asDb(db), slot._id as Id<'scheduledSlots'>, T0 + 100);

    expect(slot).toMatchObject({ status: 'queued', trigger: 'retry', idempotencyKey: 'mistwood:day:1:slot:morning' });
    expect(slot.errorCode).toBeUndefined();
    expect(slot.completedAt).toBeUndefined();
    // Retry must not invent a committed event.
    expect(slot.committedEventId).toBeUndefined();
  });

  it.each(['queued', 'running', 'completed'] as const)('refuses to retry a %s slot', async (status) => {
    const db = createFakeDb();
    await seedSchedule(db);
    await reserveSlots(asDb(db), WORLD, 1, 'manual-slot', T0);
    const slot = db.rowsOf('scheduledSlots')[0];
    await db.patch(slot._id, { status });
    await expect(retrySlotRun(asDb(db), slot._id as Id<'scheduledSlots'>, T0 + 100))
      .rejects.toThrow(/INVALID_SLOT_TRANSITION/);
  });
});

/**
 * What the earlier attempts left behind, once the slot row stopped carrying them (ART-150 AC#2).
 *
 * The test above pins the other half: retrying a failed slot CLEARS its error code, so the row an
 * operator reads describes the attempt about to run rather than the one that failed. That is what
 * makes a recovered slot readable as recovered — and it is also what would discard the history if
 * nothing else held it. These cases prove something else holds it.
 */
describe('earlier attempt failures survive the retry that clears the slot (ART-150 AC#2)', () => {
  async function seedRetriedSlot(db: FakeDb, over: Record<string, unknown> = {}) {
    await seedSchedule(db);
    await reserveSlots(asDb(db), WORLD, 1, 'manual-slot', T0);
    const slot = db.rowsOf('scheduledSlots')[0];
    await db.patch(slot._id, { status: 'queued', attemptCount: 3, errorCode: undefined, ...over });
    return slot;
  }

  /** The run id the executor derives for this slot, which is how the checkpoints are found. */
  const RUN_ID = worldDayRunId({ worldId: WORLD, worldDay: 1, timeSlot: 'morning' });

  async function seedCheckpoint(db: FakeDb, over: Record<string, unknown>) {
    await db.insert('worldDayCheckpoints', {
      runId: RUN_ID, stage: 'simulate_scenes', attempt: 1, status: 'failed',
      errorCode: 'PROVIDER_UNAVAILABLE', errorMessage: 'route chain exhausted',
      createdAt: T0, updatedAt: T0, ...over,
    });
  }

  it('reports each failed attempt in the order it happened', async () => {
    const db = createFakeDb();
    const slot = await seedRetriedSlot(db);
    await seedCheckpoint(db, { attempt: 2, errorCode: 'PROVIDER_TIMEOUT', errorMessage: 'timed out' });
    await seedCheckpoint(db, { attempt: 1 });
    await seedCheckpoint(db, { attempt: 3, status: 'completed', errorCode: undefined, errorMessage: undefined });

    const { history, omittedSlots } = await readSlotAttemptHistory(
      asDb(db), WORLD, db.rowsOf('scheduledSlots') as unknown as Doc<'scheduledSlots'>[]);

    expect(omittedSlots).toBe(0);
    expect(history).toEqual([{
      slotKey: slot.slotKey, worldDay: 1, timeSlot: 'morning',
      failures: [
        { attempt: 1, stage: 'simulate_scenes', errorCode: 'PROVIDER_UNAVAILABLE', errorMessage: 'route chain exhausted' },
        { attempt: 2, stage: 'simulate_scenes', errorCode: 'PROVIDER_TIMEOUT', errorMessage: 'timed out' },
      ],
    }]);
    // The completed checkpoint is not a failure and must not be reported as one.
    expect(history[0].failures.map((failure) => failure.attempt)).not.toContain(3);
  });

  it('reports nothing for a slot that has only ever been attempted once', async () => {
    const db = createFakeDb();
    await seedRetriedSlot(db, { attemptCount: 1 });
    await seedCheckpoint(db, { attempt: 1 });

    const { history } = await readSlotAttemptHistory(
      asDb(db), WORLD, db.rowsOf('scheduledSlots') as unknown as Doc<'scheduledSlots'>[]);
    expect(history).toEqual([]);
  });

  it('bounds how many slots it reads and says how many it left out', async () => {
    const db = createFakeDb();
    await seedSchedule(db);
    const total = ATTEMPT_HISTORY_SLOT_LIMIT + 4;
    await reserveSlots(asDb(db), WORLD, total, 'manual-day', T0);
    for (const row of db.rowsOf('scheduledSlots')) {
      await db.patch(row._id, { attemptCount: 2 });
      await db.insert('worldDayCheckpoints', {
        runId: worldDayRunId({ worldId: WORLD, worldDay: row.worldDay as number, timeSlot: row.timeSlot as TimeSlot }),
        stage: 'simulate_scenes',
        attempt: 1, status: 'failed', errorCode: 'PROVIDER_UNAVAILABLE', errorMessage: 'down',
        createdAt: T0, updatedAt: T0,
      });
    }

    const { history, omittedSlots } = await readSlotAttemptHistory(
      asDb(db), WORLD, db.rowsOf('scheduledSlots') as unknown as Doc<'scheduledSlots'>[]);

    expect(history).toHaveLength(ATTEMPT_HISTORY_SLOT_LIMIT);
    expect(omittedSlots).toBe(4);
    // The bound keeps the NEWEST slots in world time — the ones an operator is looking at.
    expect(history[history.length - 1].timeSlot).toBe(
      db.rowsOf('scheduledSlots')[total - 1].timeSlot);
  });
});

describe('cancel an uncommitted scene (FR-K001)', () => {
  it('drops a queued slot from the queue and never re-reserves it', async () => {
    const db = createFakeDb();
    await seedSchedule(db);
    await reserveSlots(asDb(db), WORLD, 1, 'manual-slot', T0);
    const slot = db.rowsOf('scheduledSlots')[0];

    const decision = decideSlotCancellation({
      slotKey: slot.slotKey as string, worldId: WORLD,
      status: slot.status as 'queued', committedEventId: slot.committedEventId as string | undefined,
    }, []);
    expect(decision.action).toBe('cancel');
    await db.patch(slot._id, { status: 'cancelled', errorCode: 'OPS_CANCELLED', completedAt: T0 + 1 });

    // A cancelled slot is not queued, so the executor (which claims `queued`
    // rows) will never pick it up...
    const { runs } = await readScheduleInspection(asDb(db), WORLD);
    expect(runs.filter((run) => run.status === 'queued')).toHaveLength(0);

    // ...and reservation is keyed by slotKey, so it is not silently recreated.
    const schedule = await loadScheduleRow(asDb(db), WORLD);
    await db.patch(schedule._id, { nextWorldDay: 1, nextTimeSlot: 'morning' });
    await reserveSlots(asDb(db), WORLD, 1, 'manual-slot', T0 + 50);
    expect(db.rowsOf('scheduledSlots')).toHaveLength(1);
    expect(db.rowsOf('scheduledSlots')[0].status).toBe('cancelled');
  });

  it('refuses to cancel a slot whose scene reached accepted Canon', async () => {
    const db = createFakeDb();
    await seedSchedule(db);
    await reserveSlots(asDb(db), WORLD, 1, 'manual-slot', T0);
    const slot = db.rowsOf('scheduledSlots')[0];
    await db.patch(slot._id, { status: 'completed', committedEventId: 'evt-1' });
    expect(() => decideSlotCancellation({
      slotKey: slot.slotKey as string, worldId: WORLD, status: 'completed', committedEventId: 'evt-1',
    }, [])).toThrow(/OPS_SLOT_COMMITTED/);
    // The row is untouched: accepted history keeps its queue provenance.
    expect(slot.committedEventId).toBe('evt-1');
  });
});

describe('inspect schedules and queues (FR-K001)', () => {
  it('returns the schedule cursor plus the queue ordered by world day then time slot', async () => {
    const db = createFakeDb();
    await seedSchedule(db);
    await reserveSlots(asDb(db), WORLD, 7, 'manual-day', T0);

    const { schedule, runs } = await readScheduleInspection(asDb(db), WORLD);
    expect(schedule).toMatchObject({ worldId: WORLD, status: 'running', nextWorldDay: 2, nextTimeSlot: 'afternoon' });
    expect(runs.map((run) => `${run.worldDay}:${run.timeSlot}`)).toEqual([
      '1:morning', '1:noon', '1:afternoon', '1:evening', '1:night', '2:morning', '2:noon',
    ]);
  });

  it('returns a null schedule for an unknown world instead of throwing', async () => {
    const db = createFakeDb();
    const { schedule, runs } = await readScheduleInspection(asDb(db), 'no-such-world');
    expect(schedule).toBeNull();
    expect(runs).toEqual([]);
  });
});
