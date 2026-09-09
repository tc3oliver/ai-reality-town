/**
 * The operator command that promotes a world to public, and demotes it back (FR-K001 / ART-172).
 *
 * `worldSchedules.mode` is the switch every cron binds on. Until this command it had exactly one
 * writer, `configureSchedule`, which refuses once a schedule exists — so the only way to promote a
 * world was to hand-patch the row in the Convex dashboard: unaudited, unreasoned, and invisible to
 * `operatorAuditLog`.
 *
 * Two layers, tested separately on purpose. The RULE (when may a world move) is a pure function
 * over state and is asserted directly, including the asymmetry between promotion and demotion.
 * The COMMAND is asserted against a real `ctx.db` double, because the claims worth making about it
 * — "the row actually changed", "the audit row landed in the same transaction", "an operator who
 * is not an administrator got nowhere" — are claims about the write, not about the rule.
 */

import {
  isOperatorScheduleMode,
  planScheduleModeChange,
  OPERATOR_SCHEDULE_MODES,
  SchedulerError,
} from '../simulation/scheduler';
import { changeWorldScheduleMode } from '../simulation/schedulerOperations';
import { OPS_UNAUTHORIZED } from './operatorAuthorization';
import { changeWorldMode } from './worldModeControlFunctions';

const WORLD_ID = 'mistwood';
const NOW = 1_700_000_000_000;
const REASON = 'promoting the acceptance environment for the release gate';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Registered = {
  isMutation?: boolean;
  isPublic?: boolean;
  isInternal?: boolean;
  _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

const handler = changeWorldMode as unknown as Registered;

const REGISTRY = JSON.stringify([
  { operatorId: 'op-admin', role: 'admin', subjects: [], token: 'correct-horse-battery-staple' },
  { operatorId: 'op-plain', role: 'operator', subjects: [], token: 'a-different-long-token-value' },
]);
const ADMIN = { operatorId: 'op-admin', operatorToken: 'correct-horse-battery-staple' };
const OPERATOR = { operatorId: 'op-plain', operatorToken: 'a-different-long-token-value' };

/** Rows carry their own `_id`, so `patch` cannot match the wrong one. */
function withIds(tables: Tables): Tables {
  for (const [table, rows] of Object.entries(tables)) {
    rows.forEach((row, index) => { row._id ??= `${table}:${index}`; });
  }
  return tables;
}

function memoryDb(tables: Tables) {
  return {
    query(table: string) {
      return {
        withIndex(_index: string, build?: (q: unknown) => unknown) {
          const constraints: Row = {};
          const builder = {
            eq(field: string, value: unknown) { constraints[field] = value; return builder; },
            gt() { return builder; },
          };
          if (build) build(builder);
          const matched = (tables[table] ?? []).filter((row) =>
            Object.entries(constraints).every(([field, value]) => row[field] === value));
          const chain = (rows: Row[]) => ({
            order: (direction: 'asc' | 'desc') => chain(direction === 'desc' ? [...rows].reverse() : rows),
            take: (n: number) => Promise.resolve(rows.slice(0, n)),
            collect: () => Promise.resolve(rows),
            first: () => Promise.resolve(rows[0] ?? null),
            unique: () => Promise.resolve(rows[0] ?? null),
          });
          return chain(matched);
        },
      };
    },
    insert(table: string, row: Row) {
      const _id = `${table}:${(tables[table] ?? []).length}`;
      (tables[table] ??= []).push({ ...row, _id });
      return Promise.resolve(_id);
    },
    patch(id: string, patch: Row) {
      for (const rows of Object.values(tables)) {
        const row = rows.find((candidate) => candidate._id === id);
        if (row) Object.assign(row, patch);
      }
      return Promise.resolve();
    },
    get(id: string) {
      for (const rows of Object.values(tables)) {
        const row = rows.find((candidate) => candidate._id === id);
        if (row) return Promise.resolve(row);
      }
      return Promise.resolve(null);
    },
  };
}

const scheduleRow = (overrides: Row = {}): Row => ({
  worldId: WORLD_ID, mode: 'development', status: 'running', baseSeed: 7,
  anchorRealTimeMs: NOW - 86_400_000, anchorWorldDay: 0, nextWorldDay: 4, nextTimeSlot: 'morning',
  publishEnabled: true, createdAt: NOW - 86_400_000, updatedAt: NOW - 3_600_000,
  ...overrides,
});

const baseTables = (overrides: Row = {}): Tables => withIds({
  worldSchedules: [scheduleRow(overrides)],
  worldEmergencyStops: [],
  operatorAuditLog: [],
});

const ctxFor = (tables: Tables) => ({
  // No identity: every caller here authenticates with an operator token, never with Convex auth.
  auth: { getUserIdentity: () => Promise.resolve(null) },
  db: memoryDb(tables),
});

const args = (overrides: Row = {}): Row => ({
  worldId: WORLD_ID, reason: REASON, targetMode: 'public', now: NOW, ...ADMIN, ...overrides,
});

const modeOf = (tables: Tables): unknown => tables.worldSchedules[0].mode;

// ---------------------------------------------------------------------------
// The rule, decided from state alone
// ---------------------------------------------------------------------------

describe('planScheduleModeChange — when a world may move between modes', () => {
  const plan = (overrides: Partial<Parameters<typeof planScheduleModeChange>[0]> = {}) =>
    planScheduleModeChange({
      current: 'development', status: 'running', targetMode: 'public', simulationHalted: false,
      ...overrides,
    });

  it('promotes a running world that is not emergency-stopped', () => {
    expect(plan()).toEqual({
      changed: true, from: 'development', to: 'public', resultCode: 'SCHEDULE_MODE_CHANGED',
    });
  });

  it('refuses to promote a paused world, rather than starting a cron against it', () => {
    // The failure this prevents: a promotion that reports success while the world is paused, and
    // then starts public scheduling at whatever moment somebody happens to resume it.
    expect(() => plan({ status: 'paused' })).toThrow(/SCHEDULE_MODE_REFUSED_PAUSED/);
  });

  it('refuses to promote an emergency-stopped world', () => {
    expect(() => plan({ simulationHalted: true })).toThrow(/SCHEDULE_MODE_REFUSED_EMERGENCY_STOP/);
  });

  it('allows a demotion from ANY state, because it only takes work away', () => {
    // The asymmetry is deliberate and is the point of testing both directions. Refusing to demote
    // a stopped world would leave an operator unable to take it off the public crons exactly when
    // something has gone wrong with it.
    for (const state of [
      { status: 'paused' as const, simulationHalted: false },
      { status: 'running' as const, simulationHalted: true },
      { status: 'paused' as const, simulationHalted: true },
    ]) {
      expect(plan({ current: 'public', targetMode: 'development', ...state }))
        .toEqual({ changed: true, from: 'public', to: 'development', resultCode: 'SCHEDULE_MODE_CHANGED' });
    }
  });

  it('reports a repeat as unchanged rather than as an error or a second change', () => {
    expect(plan({ current: 'public' })).toEqual({
      changed: false, from: 'public', to: 'public', resultCode: 'SCHEDULE_MODE_UNCHANGED',
    });
    // ...including from a state a promotion would have been refused from. Asking a paused public
    // world to be public changes nothing, so there is nothing to refuse.
    expect(plan({ current: 'public', status: 'paused' }).changed).toBe(false);
  });

  it('offers exactly the two modes an operator decides between', () => {
    // `test` and `warmup` are configuration-time modes a harness sets at creation. Moving a live
    // world into one would detach it from every cron while reading as an ordinary mode change.
    expect([...OPERATOR_SCHEDULE_MODES]).toEqual(['development', 'public']);
    expect(isOperatorScheduleMode('test')).toBe(false);
    expect(isOperatorScheduleMode('warmup')).toBe(false);
    expect(isOperatorScheduleMode('public')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The persistence layer, over a real row
// ---------------------------------------------------------------------------

describe('changeWorldScheduleMode — the one writer of mode after creation', () => {
  it('writes the new mode and stamps the row', async () => {
    const tables = baseTables();
    const plan = await changeWorldScheduleMode(memoryDb(tables) as never, WORLD_ID, {
      targetMode: 'public', now: NOW,
    });
    expect(plan.changed).toBe(true);
    expect(modeOf(tables)).toBe('public');
    expect(tables.worldSchedules[0].updatedAt).toBe(NOW);
  });

  it('writes nothing at all on a repeat', async () => {
    const tables = baseTables({ mode: 'public', updatedAt: 1 });
    const plan = await changeWorldScheduleMode(memoryDb(tables) as never, WORLD_ID, {
      targetMode: 'public', now: NOW,
    });
    expect(plan.changed).toBe(false);
    // `updatedAt` untouched: a no-op that stamped the row would make the audit trail and the row
    // disagree about whether anything happened.
    expect(tables.worldSchedules[0].updatedAt).toBe(1);
  });

  it('reads the kill switch from its own table rather than trusting the schedule row', async () => {
    // A world can be `running` in `worldSchedules` and halted in `emergencyStops` at the same
    // time — that is exactly what the kill switch does, since it deliberately leaves the queue
    // and the schedule status intact.
    const tables = withIds({
      worldSchedules: [scheduleRow()],
      worldEmergencyStops: [{
        worldId: WORLD_ID, state: 'engaged', engagedAt: NOW - 60_000, engagedBy: 'op-admin',
        reason: 'provider outage', preservedSlotKeys: [], activationCount: 1,
      }],
      operatorAuditLog: [],
    });
    await expect(changeWorldScheduleMode(memoryDb(tables) as never, WORLD_ID, {
      targetMode: 'public', now: NOW,
    })).rejects.toThrow(/SCHEDULE_MODE_REFUSED_EMERGENCY_STOP/);
    expect(modeOf(tables)).toBe('development');
  });

  it('refuses a world with no schedule at all', async () => {
    const tables = withIds({ worldSchedules: [], worldEmergencyStops: [], operatorAuditLog: [] });
    await expect(changeWorldScheduleMode(memoryDb(tables) as never, 'no-such-world', {
      targetMode: 'public', now: NOW,
    })).rejects.toThrow(SchedulerError);
  });
});

// ---------------------------------------------------------------------------
// The command: authorization, the reason, and the audit row
// ---------------------------------------------------------------------------

describe('changeWorldMode — the authorized console command', () => {
  const previous = process.env.SIMULATION_OPS_OPERATORS;
  beforeEach(() => { process.env.SIMULATION_OPS_OPERATORS = REGISTRY; });
  afterAll(() => { process.env.SIMULATION_OPS_OPERATORS = previous; });

  it('is a public mutation, so the gate is the only thing between a client and the switch', () => {
    expect(handler.isMutation).toBe(true);
    expect(handler.isPublic).toBe(true);
    expect(handler.isInternal).toBeFalsy();
  });

  it('promotes a world for an administrator, and audits it in the same transaction', async () => {
    const tables = baseTables();
    const result = await handler._handler(ctxFor(tables), args()) as {
      changed: boolean; previousMode: string; mode: string; resultCode: string;
    };

    expect(result).toEqual({
      worldId: WORLD_ID, previousMode: 'development', mode: 'public',
      changed: true, resultCode: 'SCHEDULE_MODE_CHANGED',
    });
    expect(modeOf(tables)).toBe('public');

    // AC#2: the actor, the reason, both modes and the timestamp. `resultCode` carries the
    // direction; `target` and `worldId` carry which world.
    expect(tables.operatorAuditLog).toHaveLength(1);
    expect(tables.operatorAuditLog[0]).toMatchObject({
      operatorId: 'op-admin', worldId: WORLD_ID, capability: 'world.change_mode',
      target: WORLD_ID, reason: REASON, outcome: 'applied', resultCode: 'SCHEDULE_MODE_CHANGED',
    });
  });

  it('refuses an operator who is not an administrator, before the row is touched', async () => {
    const tables = baseTables();
    await expect(handler._handler(ctxFor(tables), args(OPERATOR))).rejects.toThrow(OPS_UNAUTHORIZED);
    expect(modeOf(tables)).toBe('development');
    expect(tables.operatorAuditLog).toEqual([]);
  });

  it('refuses an unauthenticated caller and an empty registry alike', async () => {
    const anonymous = baseTables();
    await expect(handler._handler(ctxFor(anonymous), {
      worldId: WORLD_ID, reason: REASON, targetMode: 'public', now: NOW,
    })).rejects.toThrow(OPS_UNAUTHORIZED);
    expect(modeOf(anonymous)).toBe('development');

    process.env.SIMULATION_OPS_OPERATORS = '';
    const closed = baseTables();
    await expect(handler._handler(ctxFor(closed), args())).rejects.toThrow(OPS_UNAUTHORIZED);
    expect(modeOf(closed)).toBe('development');
    process.env.SIMULATION_OPS_OPERATORS = REGISTRY;
  });

  it('refuses a forged token', async () => {
    const tables = baseTables();
    await expect(handler._handler(ctxFor(tables), args({ operatorToken: 'guessed-token-value' })))
      .rejects.toThrow(OPS_UNAUTHORIZED);
    expect(modeOf(tables)).toBe('development');
  });

  it('refuses a blank reason before anything is applied', async () => {
    const tables = baseTables();
    await expect(handler._handler(ctxFor(tables), args({ reason: '   ' })))
      .rejects.toThrow(/WORLD_MODE_REASON_REQUIRED/);
    expect(modeOf(tables)).toBe('development');
    expect(tables.operatorAuditLog).toEqual([]);
  });

  it('audits a repeat as a no_op rather than dropping it', async () => {
    // AC#4. An operator who ran the promotion twice, or two operators who each thought they had,
    // are facts the trail should carry. A log in which the second attempt never happened is how
    // "who put this world in front of the public, and when" becomes unanswerable.
    const tables = baseTables({ mode: 'public' });
    const result = await handler._handler(ctxFor(tables), args()) as { changed: boolean; mode: string };

    expect(result.changed).toBe(false);
    expect(result.mode).toBe('public');
    expect(tables.operatorAuditLog).toHaveLength(1);
    expect(tables.operatorAuditLog[0]).toMatchObject({
      capability: 'world.change_mode', outcome: 'no_op', resultCode: 'SCHEDULE_MODE_UNCHANGED',
    });
  });

  it('refuses to promote a paused world, and leaves no audit row claiming it did', async () => {
    const tables = baseTables({ status: 'paused', pausedAt: NOW - 1_000 });
    await expect(handler._handler(ctxFor(tables), args()))
      .rejects.toThrow(/SCHEDULE_MODE_REFUSED_PAUSED/);
    expect(modeOf(tables)).toBe('development');
    // The throw rolls the transaction back in production; asserting it here as well says that the
    // audit is written AFTER the change rather than optimistically before it.
    expect(tables.operatorAuditLog).toEqual([]);
  });

  it('demotes a paused world, because the refusal is on promotion only', async () => {
    const tables = baseTables({ mode: 'public', status: 'paused', pausedAt: NOW - 1_000 });
    const result = await handler._handler(ctxFor(tables), args({ targetMode: 'development' })) as {
      changed: boolean; mode: string;
    };
    expect(result).toMatchObject({ changed: true, previousMode: 'public', mode: 'development' });
    expect(modeOf(tables)).toBe('development');
  });
});
