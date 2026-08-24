/**
 * The dynamic view controls, executed (FR-Q002 / ART-134 AC#1, #2, #3, #5, #8).
 *
 * ## Why this exists alongside the boundary suite
 *
 * `dynamicViewControls.boundary.test.ts` reads the source for symbols, which settles the
 * negatives — no Canon path, no second gate, no second write target. It does NOT settle that
 * every command actually CALLS what it references, and that gap is not theoretical: wrapping
 * the `recordAudit` call in `if (false)` passed the whole boundary suite, because the symbol
 * was still there. A fault injection found that, and this suite is the answer to it.
 *
 * So these run the real registered handlers against a fake context and assert what they wrote.
 * A command that stops auditing, stops appending, or stops checking the gate fails here.
 */

import { OPS_UNAUTHORIZED } from './operatorAuthorization';
import {
  inspectDynamicViewControls,
  rebuildDynamicProjection,
  setCharacterVisualHidden,
  setDynamicUpdatesPaused,
  setSceneVisualHidden,
  setSnapshotPinned,
} from './dynamicViewControlFunctions';

const WORLD = 'mistwood';
const ADMIN = 'clerk|admin-1';

type Row = Record<string, unknown> & { worldId?: string };

/**
 * A database that records what was written and answers indexed reads from it.
 *
 * Enough of Convex's query builder for these handlers and no more: they use exactly one index
 * on one table, so a fuller fake would be scaffolding nobody reads.
 */
function recordingDb() {
  const tables: Record<string, Row[]> = { dynamicViewControls: [], operatorAuditLog: [] };
  const db = {
    insert: (table: string, row: Row) => {
      (tables[table] ??= []).push(row);
      return Promise.resolve(`${table}-${(tables[table]?.length ?? 0)}`);
    },
    query: (table: string) => ({
      withIndex: (_name: string, build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown) => {
        let worldId: unknown;
        build({ eq: (field, value) => { if (field === 'worldId') worldId = value; return { eq: () => undefined }; } });
        const rows = (tables[table] ?? []).filter((row) => row.worldId === worldId);
        return { collect: () => Promise.resolve(rows) };
      },
    }),
  };
  return { db, tables };
}

/** An authorised admin, and a recording db. `SIMULATION_OPS_OPERATORS` is set per test. */
function operatorCtx(runMutation: (...args: unknown[]) => unknown = () => { throw new Error('runMutation'); }) {
  const { db, tables } = recordingDb();
  return {
    ctx: {
      auth: { getUserIdentity: () => Promise.resolve({ subject: ADMIN, tokenIdentifier: ADMIN, issuer: 'https://ops.example' }) },
      db,
      storage: db,
      scheduler: db,
      runMutation,
    } as never,
    tables,
  };
}

function anonymousCtx() {
  const { db, tables } = recordingDb();
  return {
    ctx: {
      auth: { getUserIdentity: () => Promise.resolve(null) },
      db, storage: db, scheduler: db,
      runMutation: () => { throw new Error('runMutation'); },
    } as never,
    tables,
  };
}

const call = (fn: unknown, ctx: unknown, args: unknown) =>
  (fn as { _handler: (c: unknown, a: unknown) => Promise<unknown> })._handler(ctx, args);

const command = (extra: Record<string, unknown> = {}) => ({
  worldId: WORLD, reason: 'incident 42', engaged: true, now: 1_000, ...extra,
});

let previousRegistry: string | undefined;
beforeEach(() => {
  previousRegistry = process.env.SIMULATION_OPS_OPERATORS;
  process.env.SIMULATION_OPS_OPERATORS = JSON.stringify([
    // `subjects`, plural — the registry's real shape. A singular `subject` parses to an
    // operator with no identities and denies everyone, which is the registry failing closed
    // exactly as designed.
    { operatorId: 'ops-admin', role: 'admin', subjects: [ADMIN] },
  ]);
});
afterEach(() => {
  if (previousRegistry === undefined) delete process.env.SIMULATION_OPS_OPERATORS;
  else process.env.SIMULATION_OPS_OPERATORS = previousRegistry;
});

describe('every command appends a ledger row AND an audit row (AC#8)', () => {
  const commands: Array<[string, unknown, Record<string, unknown>]> = [
    ['pause updates', setDynamicUpdatesPaused, {}],
    ['pin the snapshot', setSnapshotPinned, {}],
    ['hide a character', setCharacterVisualHidden, { characterId: 'he-jun' }],
    ['hide a scene', setSceneVisualHidden, { sceneId: '7:evening:mistwood-mill' }],
  ];

  test.each(commands)('%s', async (_name, fn, extra) => {
    const { ctx, tables } = operatorCtx();
    await call(fn, ctx, command(extra));

    expect(tables.dynamicViewControls).toHaveLength(1);
    // The audit row is the criterion, and asserting it BEHAVIOURALLY is the point: a source
    // scan for `recordAudit` passes even when the call is wrapped in `if (false)`.
    expect(tables.operatorAuditLog).toHaveLength(1);
    expect(tables.operatorAuditLog[0]).toMatchObject({
      worldId: WORLD,
      operatorId: 'ops-admin',
      reason: 'incident 42',
      outcome: 'applied',
    });
    expect(String(tables.operatorAuditLog[0].capability)).toMatch(/^dynamic\./);
  });

  test('a no-op is audited too, rather than dropped', async () => {
    const { ctx, tables } = operatorCtx();
    await call(setDynamicUpdatesPaused, ctx, command());
    await call(setDynamicUpdatesPaused, ctx, command({ now: 2_000 }));

    // An operator pressing "pause" on an already-paused world is part of the account of what
    // happened. A silent drop would leave a gap in it.
    expect(tables.operatorAuditLog).toHaveLength(2);
    expect(tables.operatorAuditLog[1]).toMatchObject({ outcome: 'no_op' });
  });

  test('the reason is required, so no row is unexplained (NFR-005)', async () => {
    const { ctx, tables } = operatorCtx();
    await expect(call(setDynamicUpdatesPaused, ctx, command({ reason: '   ' }))).rejects.toThrow();
    // And nothing was written on the way to the throw.
    expect(tables.dynamicViewControls).toHaveLength(0);
  });
});

describe('every command refuses an unauthenticated caller (AC#8)', () => {
  test.each([
    ['pause updates', setDynamicUpdatesPaused, {}],
    ['pin the snapshot', setSnapshotPinned, {}],
    ['hide a character', setCharacterVisualHidden, { characterId: 'he-jun' }],
    ['hide a scene', setSceneVisualHidden, { sceneId: 's1' }],
    ['rebuild', rebuildDynamicProjection, {}],
  ])('%s', async (_name, fn, extra) => {
    const { ctx, tables } = anonymousCtx();
    await expect(call(fn, ctx, command(extra))).rejects.toThrow(OPS_UNAUTHORIZED);
    // Refused BEFORE anything was written, not merely refused.
    expect(tables.dynamicViewControls).toHaveLength(0);
    expect(tables.operatorAuditLog).toHaveLength(0);
  });

  test('and so does the inspect query, even though it is read-only', async () => {
    const { ctx } = anonymousCtx();
    await expect(call(inspectDynamicViewControls, ctx, { worldId: WORLD })).rejects.toThrow(OPS_UNAUTHORIZED);
  });
});

describe('the controls take effect and can be released (AC#1, #2, #3)', () => {
  test('hiding then releasing leaves nothing hidden, and both rows survive', async () => {
    const { ctx, tables } = operatorCtx();
    await call(setCharacterVisualHidden, ctx, command({ characterId: 'he-jun' }));

    const hidden = await call(inspectDynamicViewControls, ctx, { worldId: WORLD }) as
      { controls: { hiddenCharacterIds: string[] }; history: unknown[] };
    expect(hidden.controls.hiddenCharacterIds).toEqual(['he-jun']);

    await call(setCharacterVisualHidden, ctx, command({ characterId: 'he-jun', engaged: false, now: 2_000 }));
    const released = await call(inspectDynamicViewControls, ctx, { worldId: WORLD }) as
      { controls: { hiddenCharacterIds: string[] }; history: unknown[] };
    expect(released.controls.hiddenCharacterIds).toEqual([]);

    // Append-only: the release did not erase the hide. Both are in the ledger and in the
    // history the console reports, which is the whole reason for the shape.
    expect(tables.dynamicViewControls).toHaveLength(2);
    expect(released.history).toHaveLength(2);
  });

  test('the inspect query reports the pause and the pin', async () => {
    const { ctx } = operatorCtx();
    await call(setDynamicUpdatesPaused, ctx, command());
    await call(setSnapshotPinned, ctx, command({ now: 2_000 }));
    const state = await call(inspectDynamicViewControls, ctx, { worldId: WORLD }) as
      { controls: { updatesPaused: boolean; snapshotPinned: boolean } };
    expect(state.controls).toMatchObject({ updatesPaused: true, snapshotPinned: true });
  });

  test('history is newest first, so the last decision is the first thing read', async () => {
    const { ctx } = operatorCtx();
    await call(setDynamicUpdatesPaused, ctx, command({ reason: 'first' }));
    await call(setSnapshotPinned, ctx, command({ reason: 'second', now: 2_000 }));
    const state = await call(inspectDynamicViewControls, ctx, { worldId: WORLD }) as
      { history: Array<{ reason: string }> };
    expect(state.history.map((row) => row.reason)).toEqual(['second', 'first']);
  });
});

describe('rebuild (AC#5)', () => {
  test('runs the internal projection rebuild and audits it', async () => {
    const calls: unknown[] = [];
    const { ctx, tables } = operatorCtx((...args) => {
      calls.push(args);
      return Promise.resolve({ modelRef: 'live:mistwood' });
    });

    const result = await call(rebuildDynamicProjection, ctx, { worldId: WORLD, reason: 'stale', now: 1_000 });
    expect(result).toMatchObject({ rebuilt: true, modelRef: 'live:mistwood' });
    expect(calls).toHaveLength(1);
    expect(tables.operatorAuditLog[0]).toMatchObject({ capability: 'dynamic.rebuild', outcome: 'applied' });
  });

  test('is REFUSED while updates are paused, and the refusal is audited', async () => {
    const calls: unknown[] = [];
    const { ctx, tables } = operatorCtx((...args) => {
      calls.push(args);
      return Promise.resolve({ modelRef: 'live:mistwood' });
    });
    await call(setDynamicUpdatesPaused, ctx, command());

    const result = await call(rebuildDynamicProjection, ctx, { worldId: WORLD, reason: 'stale', now: 2_000 });
    // The pause is a statement that the public view should stop moving. Honouring the rebuild
    // would move it, and doing that quietly is worse than refusing.
    expect(result).toMatchObject({ rebuilt: false, resultCode: 'DYNAMIC_UPDATES_PAUSED' });
    expect(calls).toHaveLength(0);
    expect(tables.operatorAuditLog.at(-1)).toMatchObject({
      capability: 'dynamic.rebuild',
      outcome: 'refused',
      resultCode: 'DYNAMIC_UPDATES_PAUSED',
    });
  });
});
