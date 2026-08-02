import { TIME_SLOTS } from '../canon/eventTypes';
import {
  InMemoryWorldScheduler,
  PUBLIC_SLOT_START_MS,
  REAL_DAY_MS,
  type ScheduledSlotRun,
} from './scheduler';

function scheduler(mode: 'public' | 'development' | 'test' = 'development', publishEnabled?: boolean): InMemoryWorldScheduler {
  return new InMemoryWorldScheduler({
    worldId: 'mistwood', mode, baseSeed: 20260803, anchorRealTimeMs: 1_000,
    anchorWorldDay: 7, publishEnabled, createdAt: 1_000,
  });
}

function coordinates(runs: ScheduledSlotRun[]): string[] {
  return runs.map((run) => `${run.worldDay}:${run.timeSlot}`);
}

describe('FR-C001 clock-controlled world scheduler', () => {
  it('queues each public slot exactly once in five-slot order across real calendar days', () => {
    const engine = scheduler('public');
    const anchor = 1_000;
    const all: ScheduledSlotRun[] = [];
    for (const offset of PUBLIC_SLOT_START_MS) all.push(...engine.tickPublic(anchor + offset));
    all.push(...engine.tickPublic(anchor + REAL_DAY_MS));
    expect(coordinates(all)).toEqual([
      '7:morning', '7:noon', '7:afternoon', '7:evening', '7:night', '8:morning',
    ]);
    expect(engine.tickPublic(anchor + REAL_DAY_MS)).toEqual([]);
    expect(new Set(engine.inspect().runs.map((run) => run.slotKey)).size).toBe(6);
    expect(engine.inspect().runs.every((run) => run.publishEnabled)).toBe(true);
  });

  it('pause freezes public time and resume shifts the real-time anchor', () => {
    const engine = scheduler('public');
    const anchor = 1_000;
    expect(engine.tickPublic(anchor)).toHaveLength(1);
    engine.pause(anchor + 3_600_000);
    expect(engine.tickPublic(anchor + REAL_DAY_MS)).toEqual([]);
    engine.resume(anchor + REAL_DAY_MS + 3_600_000);
    expect(engine.tickPublic(anchor + REAL_DAY_MS + 6 * 3_600_000)).toHaveLength(1);
    expect(engine.inspect().runs.map((run) => run.timeSlot)).toEqual(['morning', 'noon']);
  });

  it('supports exact manual slot/day and accelerated controls, including while paused', () => {
    const engine = scheduler('development');
    engine.pause(2_000);
    expect(engine.advanceOneSlot(2_001).timeSlot).toBe('morning');
    const day = engine.advanceOneWorldDay(2_002);
    expect(coordinates(day)).toEqual(['7:noon', '7:afternoon', '7:evening', '7:night', '8:morning']);
    expect(engine.accelerate(2, 2_003)).toHaveLength(10);
    expect(engine.inspect().runs).toHaveLength(16);
  });

  it('fixed seed produces the same slots and seeds and stays unpublished by default', () => {
    const first = scheduler('test').accelerate(3, 2_000);
    const second = scheduler('test').accelerate(3, 9_000);
    expect(first.map(({ worldDay, timeSlot, seed, publishEnabled, idempotencyKey }) =>
      ({ worldDay, timeSlot, seed, publishEnabled, idempotencyKey })))
      .toEqual(second.map(({ worldDay, timeSlot, seed, publishEnabled, idempotencyKey }) =>
        ({ worldDay, timeSlot, seed, publishEnabled, idempotencyKey })));
    expect(first.every((run) => !run.publishEnabled)).toBe(true);
    expect(scheduler('test', true).advanceOneSlot(2_000).publishEnabled).toBe(true);
  });

  it('retries the same failed slot and Canon idempotency key without duplicate acceptance', () => {
    const engine = scheduler('development');
    const reserved = engine.advanceOneSlot(2_000);
    const acceptedByKey = new Map<string, string>();
    const commit = (run: ScheduledSlotRun): string => {
      const existing = acceptedByKey.get(run.idempotencyKey);
      if (existing) return existing;
      const eventId = 'mistwood#event#0';
      acceptedByKey.set(run.idempotencyKey, eventId);
      return eventId;
    };

    const firstAttempt = engine.start(reserved.slotKey, 2_001);
    commit(firstAttempt);
    engine.fail(reserved.slotKey, 'POST_COMMIT_TIMEOUT', 2_002);
    const retried = engine.retry(reserved.slotKey, 2_003);
    expect(retried.idempotencyKey).toBe(firstAttempt.idempotencyKey);
    const secondAttempt = engine.start(reserved.slotKey, 2_004);
    engine.complete(reserved.slotKey, commit(secondAttempt), 2_005);

    expect(acceptedByKey.size).toBe(1);
    expect(engine.inspect().runs).toHaveLength(1);
    expect(engine.inspect().runs[0]).toMatchObject({
      status: 'completed', attemptCount: 2, committedEventId: 'mistwood#event#0', trigger: 'retry',
    });
  });

  it('exposes inspectable schedule and run lifecycle with rejected invalid transitions', () => {
    const engine = scheduler('development');
    const run = engine.advanceOneSlot(2_000);
    expect(() => engine.complete(run.slotKey, undefined, 2_001)).toThrow('[INVALID_SLOT_TRANSITION]');
    engine.start(run.slotKey, 2_002);
    engine.fail(run.slotKey, 'PROVIDER_DOWN', 2_003);
    expect(engine.inspect()).toMatchObject({
      schedule: { worldId: 'mistwood', status: 'running', nextTimeSlot: TIME_SLOTS[1] },
      runs: [{ slotKey: run.slotKey, status: 'failed', errorCode: 'PROVIDER_DOWN', attemptCount: 1 }],
    });
    expect(() => engine.accelerate(0, 2_004)).toThrow('[INVALID_ADVANCE_COUNT]');
    expect(() => engine.resume(Number.NaN)).toThrow('[INVALID_CLOCK]');
  });
});
