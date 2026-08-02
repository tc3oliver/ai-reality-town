import { TIME_SLOTS, type TimeSlot } from '../canon/eventTypes';

export const REAL_DAY_MS = 86_400_000;
export const PUBLIC_SLOT_START_MS = [0, 6, 11, 15, 19].map((hour) => hour * 3_600_000) as readonly number[];

export type SchedulerMode = 'public' | 'development' | 'test' | 'warmup';
export type SchedulerStatus = 'running' | 'paused';
export type SlotTrigger = 'clock' | 'manual-slot' | 'manual-day' | 'accelerated' | 'retry';
export type SlotRunStatus = 'queued' | 'running' | 'completed' | 'failed';

export type WorldScheduleState = {
  worldId: string;
  mode: SchedulerMode;
  status: SchedulerStatus;
  baseSeed: number;
  anchorRealTimeMs: number;
  anchorWorldDay: number;
  nextWorldDay: number;
  nextTimeSlot: TimeSlot;
  publishEnabled: boolean;
  pausedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type ScheduledSlotRun = {
  slotKey: string;
  worldId: string;
  worldDay: number;
  timeSlot: TimeSlot;
  trigger: SlotTrigger;
  status: SlotRunStatus;
  seed: number;
  publishEnabled: boolean;
  idempotencyKey: string;
  attemptCount: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  committedEventId?: string;
  errorCode?: string;
};

export type ScheduleInspection = { schedule: WorldScheduleState; runs: ScheduledSlotRun[] };

export class SchedulerError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'SchedulerError';
  }
}

function assertClock(now: number): void {
  if (!Number.isFinite(now)) throw new SchedulerError('INVALID_CLOCK', 'clock value must be finite');
}

export function slotKey(worldId: string, worldDay: number, timeSlot: TimeSlot): string {
  return `${worldId}:day:${worldDay}:slot:${timeSlot}`;
}

export function nextCursor(worldDay: number, timeSlot: TimeSlot): { worldDay: number; timeSlot: TimeSlot } {
  const index = TIME_SLOTS.indexOf(timeSlot);
  return index === TIME_SLOTS.length - 1
    ? { worldDay: worldDay + 1, timeSlot: TIME_SLOTS[0] }
    : { worldDay, timeSlot: TIME_SLOTS[index + 1] };
}

export function cursorOrdinal(state: WorldScheduleState): number {
  return (state.nextWorldDay - state.anchorWorldDay) * TIME_SLOTS.length
    + TIME_SLOTS.indexOf(state.nextTimeSlot);
}

/** Inclusive ordinal of the latest public slot whose fixed start boundary is due. */
export function publicDueOrdinal(state: WorldScheduleState, now: number): number {
  const elapsed = now - state.anchorRealTimeMs;
  if (elapsed < 0) return -1;
  const dayOffset = Math.floor(elapsed / REAL_DAY_MS);
  const withinDay = elapsed % REAL_DAY_MS;
  let slotIndex = 0;
  for (let index = 1; index < PUBLIC_SLOT_START_MS.length; index++) {
    if (withinDay >= PUBLIC_SLOT_START_MS[index]) slotIndex = index;
  }
  return dayOffset * TIME_SLOTS.length + slotIndex;
}

export function deterministicSlotSeed(baseSeed: number, worldDay: number, timeSlot: TimeSlot): number {
  let hash = (baseSeed ^ Math.imul(worldDay, 0x45d9f3b)) >>> 0;
  hash = (hash ^ Math.imul(TIME_SLOTS.indexOf(timeSlot) + 1, 0x27d4eb2d)) >>> 0;
  return hash;
}

function validateConfiguration(input: {
  worldId: string; baseSeed: number; anchorRealTimeMs: number; anchorWorldDay: number; createdAt: number;
}): void {
  if (input.worldId.trim().length === 0
      || !Number.isSafeInteger(input.baseSeed)
      || !Number.isFinite(input.anchorRealTimeMs)
      || !Number.isSafeInteger(input.anchorWorldDay) || input.anchorWorldDay < 0
      || !Number.isFinite(input.createdAt)) {
    throw new SchedulerError('INVALID_SCHEDULE_CONFIGURATION', 'schedule configuration is invalid');
  }
}

export function configureWorldSchedule(input: {
  worldId: string;
  mode: SchedulerMode;
  baseSeed: number;
  anchorRealTimeMs: number;
  anchorWorldDay: number;
  publishEnabled?: boolean;
  createdAt: number;
}): WorldScheduleState {
  validateConfiguration(input);
  return {
    worldId: input.worldId,
    mode: input.mode,
    status: 'running',
    baseSeed: input.baseSeed,
    anchorRealTimeMs: input.anchorRealTimeMs,
    anchorWorldDay: input.anchorWorldDay,
    nextWorldDay: input.anchorWorldDay,
    nextTimeSlot: TIME_SLOTS[0],
    publishEnabled: input.publishEnabled ?? input.mode === 'public',
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

/** Reference scheduler used by domain tests and mirrored by internal persistence operations. */
export class InMemoryWorldScheduler {
  private state: WorldScheduleState;
  private readonly runs = new Map<string, ScheduledSlotRun>();

  constructor(configuration: Parameters<typeof configureWorldSchedule>[0]) {
    this.state = configureWorldSchedule(configuration);
  }

  inspect(): ScheduleInspection {
    return {
      schedule: structuredClone(this.state),
      runs: structuredClone([...this.runs.values()].sort((a, b) =>
        a.worldDay - b.worldDay || TIME_SLOTS.indexOf(a.timeSlot) - TIME_SLOTS.indexOf(b.timeSlot))),
    };
  }

  pause(now: number): void {
    assertClock(now);
    if (this.state.status === 'paused') return;
    this.state = { ...this.state, status: 'paused', pausedAt: now, updatedAt: now };
  }

  resume(now: number): void {
    assertClock(now);
    if (this.state.status !== 'paused' || this.state.pausedAt === undefined) return;
    if (now < this.state.pausedAt) throw new SchedulerError('INVALID_CLOCK', 'resume time precedes pause time');
    this.state = {
      ...this.state,
      status: 'running',
      anchorRealTimeMs: this.state.anchorRealTimeMs + (now - this.state.pausedAt),
      pausedAt: undefined,
      updatedAt: now,
    };
  }

  private reserve(count: number, trigger: SlotTrigger, now: number): ScheduledSlotRun[] {
    assertClock(now);
    if (!Number.isSafeInteger(count) || count < 0) throw new SchedulerError('INVALID_ADVANCE_COUNT', 'advance count is invalid');
    const reserved: ScheduledSlotRun[] = [];
    for (let index = 0; index < count; index++) {
      const { nextWorldDay: worldDay, nextTimeSlot: timeSlot } = this.state;
      const key = slotKey(this.state.worldId, worldDay, timeSlot);
      if (!this.runs.has(key)) {
        const run: ScheduledSlotRun = {
          slotKey: key,
          worldId: this.state.worldId,
          worldDay,
          timeSlot,
          trigger,
          status: 'queued',
          seed: deterministicSlotSeed(this.state.baseSeed, worldDay, timeSlot),
          publishEnabled: this.state.publishEnabled,
          idempotencyKey: key,
          attemptCount: 0,
          createdAt: now,
          updatedAt: now,
        };
        this.runs.set(key, run);
        reserved.push(structuredClone(run));
      }
      const next = nextCursor(worldDay, timeSlot);
      this.state = { ...this.state, nextWorldDay: next.worldDay, nextTimeSlot: next.timeSlot, updatedAt: now };
    }
    return reserved;
  }

  tickPublic(now: number): ScheduledSlotRun[] {
    assertClock(now);
    if (this.state.mode !== 'public') throw new SchedulerError('INVALID_SCHEDULE_MODE', 'clock tick requires public mode');
    if (this.state.status === 'paused') return [];
    const count = Math.max(0, publicDueOrdinal(this.state, now) - cursorOrdinal(this.state) + 1);
    return this.reserve(count, 'clock', now);
  }

  advanceOneSlot(now: number): ScheduledSlotRun { return this.reserve(1, 'manual-slot', now)[0]; }
  advanceOneWorldDay(now: number): ScheduledSlotRun[] { return this.reserve(TIME_SLOTS.length, 'manual-day', now); }
  accelerate(worldDays: number, now: number): ScheduledSlotRun[] {
    if (this.state.mode === 'public') throw new SchedulerError('INVALID_SCHEDULE_MODE', 'accelerated runs require non-public mode');
    if (!Number.isSafeInteger(worldDays) || worldDays < 1 || worldDays > 90) {
      throw new SchedulerError('INVALID_ADVANCE_COUNT', 'accelerated world days must be between 1 and 90');
    }
    return this.reserve(worldDays * TIME_SLOTS.length, 'accelerated', now);
  }

  start(slotRunKey: string, now: number): ScheduledSlotRun {
    assertClock(now);
    const run = this.runs.get(slotRunKey);
    if (!run || run.status !== 'queued') throw new SchedulerError('INVALID_SLOT_TRANSITION', 'only queued slots may start');
    Object.assign(run, { status: 'running', attemptCount: run.attemptCount + 1, startedAt: now, updatedAt: now, errorCode: undefined });
    return structuredClone(run);
  }

  complete(slotRunKey: string, committedEventId: string | undefined, now: number): ScheduledSlotRun {
    assertClock(now);
    const run = this.runs.get(slotRunKey);
    if (!run || run.status !== 'running') throw new SchedulerError('INVALID_SLOT_TRANSITION', 'only running slots may complete');
    Object.assign(run, { status: 'completed', committedEventId, completedAt: now, updatedAt: now });
    return structuredClone(run);
  }

  fail(slotRunKey: string, errorCode: string, now: number): ScheduledSlotRun {
    assertClock(now);
    const run = this.runs.get(slotRunKey);
    if (!run || run.status !== 'running') throw new SchedulerError('INVALID_SLOT_TRANSITION', 'only running slots may fail');
    Object.assign(run, { status: 'failed', errorCode, completedAt: now, updatedAt: now });
    return structuredClone(run);
  }

  retry(slotRunKey: string, now: number): ScheduledSlotRun {
    assertClock(now);
    const run = this.runs.get(slotRunKey);
    if (!run || run.status !== 'failed') throw new SchedulerError('INVALID_SLOT_TRANSITION', 'only failed slots may retry');
    Object.assign(run, { status: 'queued', trigger: 'retry', completedAt: undefined, updatedAt: now });
    return structuredClone(run);
  }
}
