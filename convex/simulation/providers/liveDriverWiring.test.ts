/**
 * The cron → driver handoff (ART-160).
 *
 * Fault injection found this untested: emptying the world list inside `driveLiveWorlds` left every
 * other suite green, because they all exercise the layers BELOW the driver. A live path that is
 * fully correct and never invoked is exactly the defect ART-159 was written for — the adapter, the
 * safety gate and the route chain were all built, tested, and unreachable — so the handoff itself
 * needs its own coverage rather than being assumed from the parts.
 *
 * Two things are pinned here and nowhere else:
 *
 *  - the driver actually asks for worlds and drives each one it is given;
 *  - the cron actually references the driver, which no runtime test can see, because a cron that
 *    was never registered simply never fires.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFunctionName } from 'convex/server';
import { driveLiveWorlds } from './liveWorldDayActions';
import { LIVE_ROUTE_CHAIN_ENV } from './liveSceneAuthor';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const LIVE_ENV = {
  LLM_API_URL: 'https://gateway.example.com/v1',
  LLM_MODEL: 'auto',
  LLM_EMBEDDING_MODEL: 'bge-m3',
  LLM_EMBEDDING_DIMENSION: '1024',
  LLM_API_KEY: 'test-key-never-a-real-credential',
  [LIVE_ROUTE_CHAIN_ENV]: 'auto',
};

const PATHS = {
  listWorlds: 'simulation/schedulerOperations:listDrivableWorlds',
  prepare: 'simulation/worldDayLiveFunctions:prepareQueuedWorldDaySlot',
  finalize: 'simulation/worldDayLiveFunctions:runQueuedWorldDaySlot',
} as const;

type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const driver = driveLiveWorlds as unknown as Registered;

/**
 * Restore whatever the environment was, so one test cannot configure another.
 *
 * `await`s the body rather than returning its promise: the driver reads `process.env` inside an
 * async handler, so restoring in a synchronous `finally` would put the environment back before the
 * code under test had looked at it.
 */
async function withEnv<T>(env: Record<string, string | undefined>, body: () => Promise<T>): Promise<T> {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await body();
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

/**
 * An `ActionCtx` that answers the driver's calls from a script.
 *
 * `prepare` is scripted per world rather than executed, because what is under test here is the
 * DRIVER's loop — which worlds it asks about, what it does with each answer, and whether one
 * world's failure stops the rest. The prepare/finalize contract itself is covered by
 * `liveOrchestration.test.ts` against the real claim handler.
 */
function driverCtx(script: {
  worlds: string[];
  prepare?: (worldId: string) => unknown;
}) {
  const calls: Array<{ path: string; args: Record<string, unknown> }> = [];
  const dispatch = (ref: unknown, args: unknown) => {
    const path = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
    calls.push({ path, args: args as Record<string, unknown> });
    if (path === PATHS.listWorlds) return Promise.resolve(script.worlds);
    if (path === PATHS.prepare) {
      const worldId = String((args as { worldId: string }).worldId);
      const prepared = script.prepare ? script.prepare(worldId) : { kind: 'idle' };
      // A world that refuses — emergency-stopped, paused, unseeded — throws out of the real
      // mutation, so the script models a refusal the same way.
      if (prepared instanceof Error) return Promise.reject(prepared);
      return Promise.resolve(prepared);
    }
    if (path === PATHS.finalize) return Promise.resolve({ slots: [{ status: 'completed' }] });
    // Anything else is a call the driver should not be making at this point; surfacing it beats
    // returning `undefined` and letting a silent mis-wire pass.
    throw new Error(`unexpected call ${path}`);
  };
  return { ctx: { runQuery: dispatch, runMutation: dispatch } as never, calls };
}

const drive = async (script: Parameters<typeof driverCtx>[0], args: Record<string, unknown> = {}) => {
  const { ctx, calls } = driverCtx(script);
  const result = await withEnv(LIVE_ENV,
    () => driver._handler(ctx, { now: 1_700_000_000_000, ...args })) as {
      worlds: Array<Record<string, unknown>>; skipped: string | null;
    };
  return { result, calls };
};

describe('AC#1 — the cron driver actually drives', () => {
  it('asks which worlds are drivable, and prepares each one', async () => {
    const { result, calls } = await drive({ worlds: ['mistwood', 'second-world'] });

    expect(calls.filter(({ path }) => path === PATHS.listWorlds)).toHaveLength(1);
    // The injection this test exists for: emptying the world list made every other suite pass.
    expect(calls.filter(({ path }) => path === PATHS.prepare).map(({ args }) => args.worldId))
      .toEqual(['mistwood', 'second-world']);
    expect(result.worlds.map((world) => world.worldId)).toEqual(['mistwood', 'second-world']);
  });

  it('drives nothing when no world is drivable, without erroring', async () => {
    const { result, calls } = await drive({ worlds: [] });

    expect(result.worlds).toEqual([]);
    expect(calls.filter(({ path }) => path === PATHS.prepare)).toHaveLength(0);
  });

  it('passes the resolved route to prepare, so the meter keys on the chain it built', async () => {
    const { calls } = await drive({ worlds: ['mistwood'] });

    const prepare = calls.find(({ path }) => path === PATHS.prepare);
    expect(prepare?.args.deploymentModelId).toBe('auto');
  });
});

describe('AC#5 — a refusing world does not stop the others', () => {
  it('records the refusal against the world and keeps going', async () => {
    const { result } = await drive({
      worlds: ['stopped-world', 'healthy-world'],
      prepare: (worldId) => worldId === 'stopped-world'
        ? Object.assign(new Error('stopped'), { code: 'WORLD_EMERGENCY_STOPPED' })
        : { kind: 'idle' },
    });

    // One broken world must not become a broken tick: that is the shape a shared cron failure
    // would otherwise take, and it would stop every other world silently.
    expect(result.worlds[0]).toMatchObject({ worldId: 'stopped-world', skipped: 'WORLD_EMERGENCY_STOPPED' });
    expect(result.worlds[1]).toMatchObject({ worldId: 'healthy-world', executed: 0 });
  });

  it('stops at a world that is already being driven, without taking its next slot', async () => {
    const { result, calls } = await drive({
      worlds: ['mistwood'],
      prepare: () => ({ kind: 'busy', slotKey: 'mistwood:day:0:slot:morning', leaseExpiresAt: 1 }),
    }, { maxSlotsPerWorld: 3 });

    // `busy` means do NOTHING — not "try the next slot". World time is ordered.
    expect(result.worlds[0]).toMatchObject({ executed: 0, skipped: 'SLOT_LEASE_HELD' });
    expect(calls.filter(({ path }) => path === PATHS.prepare)).toHaveLength(1);
    expect(calls.filter(({ path }) => path === PATHS.finalize)).toHaveLength(0);
  });
});

describe('AC#1 — an unconfigured deployment reports why, rather than erroring every minute', () => {
  it('skips with a stable reason when no provider is configured', async () => {
    const { ctx } = driverCtx({ worlds: ['mistwood'] });
    const result = await withEnv(
      { LLM_API_URL: undefined, LLM_MODEL: undefined, LLM_API_KEY: undefined,
        LLM_EMBEDDING_MODEL: undefined, LLM_EMBEDDING_DIMENSION: undefined },
      () => driver._handler(ctx, {}),
    ) as { worlds: unknown[]; skipped: string | null };

    // A cron that always throws is a cron nobody reads, and this failure has to stay legible: it
    // is exactly what "the world stopped advancing" looks like from outside.
    expect(result.skipped).toBe('LLM_CONFIG_MISSING');
    expect(result.worlds).toEqual([]);
  });

  it('does not claim a slot before discovering it cannot author', async () => {
    const { ctx, calls } = driverCtx({ worlds: ['mistwood'] });
    await withEnv({ LLM_API_URL: undefined, LLM_MODEL: undefined, LLM_API_KEY: undefined,
      LLM_EMBEDDING_MODEL: undefined, LLM_EMBEDDING_DIMENSION: undefined },
    () => driver._handler(ctx, {}));

    // Claiming and then failing would leave a lease on a world nothing can advance.
    expect(calls).toEqual([]);
  });
});

describe('the cron actually references the driver', () => {
  /**
   * No runtime test can see this: an unregistered cron simply never fires, and every function it
   * would have called still passes its own tests. The only observable is the registration itself.
   */
  const crons = readFileSync(join(ROOT, 'convex/crons.ts'), 'utf8');

  it('registers the live world-day driver', () => {
    expect(crons).toContain("'simulation/providers/liveWorldDayActions:driveLiveWorlds'");
    expect(crons).toContain('driveLiveWorldsRef');
  });

  it('registers the post-commit drain, which the driver deliberately does not run itself', () => {
    // `simulation` may not depend on `operations`, so the driver cannot drain post-commit. If this
    // cron were missing, worlds would commit events that no projection ever saw.
    expect(crons).toContain("'operations/postCommitLiveFunctions:drainAllLivePostCommit'");
    expect(crons).toContain('drainAllLivePostCommitRef');
  });

  it('still registers the reservation cron the driver depends on', () => {
    // The driver drains queued slots; something has to queue them. Losing this would leave a
    // driver that correctly finds nothing to do, forever.
    expect(crons).toContain("'simulation/schedulerOperations:tickAllPublicSchedules'");
  });
});
