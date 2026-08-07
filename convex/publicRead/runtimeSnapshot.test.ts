/**
 * Public Runtime Snapshot contract tests (FR-N007 / ART-116).
 *
 * Organised by acceptance criterion, because the criteria are the contract: a failure here
 * should name the promise that broke, not just the function that threw.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A test file may reach across the module boundary — `scripts/architecture/check-boundaries.mjs`
// skips `*.test.*`. Importing the real slot table is the point: it pins the freshness
// thresholds to the cadence they were derived from.
import { PUBLIC_SLOT_START_MS } from '../simulation/scheduler';
import {
  createSingleMoveFixture,
  createZeroEventFixture,
  FIXTURE_ACCEPTED_AT_MS,
  MISTWOOD_SEED_PLACEMENTS,
} from '../visualRuntime/fixtures';
import type { VisualRuntimeInput } from '../visualRuntime/visualSyncPlanner';
import {
  buildPublicDynamicProjection,
  type PublicDynamicProjection,
} from './publicDynamicProjection';
import {
  assertPublicRuntimeSnapshot,
  buildRuntimeSnapshot,
  classifyRuntimeFreshness,
  commitRuntimeSnapshot,
  hashRuntimeSnapshotContent,
  serveRuntimeSnapshot,
  toRuntimeSnapshotStatus,
  PUBLIC_SLOT_MAX_GAP_MS,
  RUNTIME_FRESHNESS,
  RUNTIME_SNAPSHOT_DELAYED_MAX_AGE_MS,
  RUNTIME_SNAPSHOT_ENVELOPE_FIELDS,
  RUNTIME_SNAPSHOT_FIELDS,
  RUNTIME_SNAPSHOT_LIVE_MAX_AGE_MS,
  RUNTIME_SNAPSHOT_OBSERVATION_MAX_AGE_MS,
  RUNTIME_SNAPSHOT_STATUSES,
  RuntimeSnapshotError,
  type PublicRuntimeSnapshot,
  type PublicRuntimeSnapshotStatus,
  type RuntimeSnapshotStore,
  type StoredRuntimeSnapshot,
} from './runtimeSnapshot';
import {
  publicRuntimeFreshnessValidator,
  publicRuntimeSnapshotEnvelopeValidator,
  publicRuntimeSnapshotStatusValidator,
} from './runtimeSnapshotValidators';

const WORLD_ID = 'mistwood';
const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

class MemoryRuntimeSnapshotStore implements RuntimeSnapshotStore {
  readonly rows: StoredRuntimeSnapshot[] = [];
  private counter = 0;
  /** Toggled to simulate a snapshot-write outage. */
  insertShouldThrow = false;

  loadCurrent(worldId: string): Promise<StoredRuntimeSnapshot | null> {
    return Promise.resolve(this.rows.find((row) => row.worldId === worldId && row.isCurrent) ?? null);
  }
  insertSnapshot(record: PublicRuntimeSnapshot): Promise<string> {
    if (this.insertShouldThrow) throw new Error('SNAPSHOT_WRITE_UNAVAILABLE');
    this.counter += 1;
    const id = `snap-${this.counter}`;
    this.rows.push({ ...record, id });
    return Promise.resolve(id);
  }
  demote(rowId: string): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === rowId);
    if (!row) throw new Error('ROW_NOT_FOUND');
    row.isCurrent = false;
    return Promise.resolve();
  }
  touchObservedAt(rowId: string, observedAt: number): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === rowId);
    if (!row) throw new Error('ROW_NOT_FOUND');
    row.observedAt = observedAt;
    return Promise.resolve();
  }
}

function project(
  fixture: VisualRuntimeInput,
  over: Partial<Parameters<typeof buildPublicDynamicProjection>[0]> = {},
): PublicDynamicProjection {
  return buildPublicDynamicProjection({
    worldId: WORLD_ID,
    nowMs: fixture.nowMs,
    runtime: { mapId: fixture.mapId, grid: fixture.grid, bindings: fixture.bindings },
    seedPlacements: MISTWOOD_SEED_PLACEMENTS,
    acceptedEvents: fixture.acceptedEvents,
    worldStatus: 'running',
    activeScenes: [],
    ...over,
  });
}

/** A projection pinned to a chosen Canon position, so sequence behaviour is testable directly. */
function atSequence(
  base: PublicDynamicProjection,
  snapshotSequence: number,
  updatedAt = FIXTURE_ACCEPTED_AT_MS,
): PublicDynamicProjection {
  return { ...base, snapshotSequence, updatedAt };
}

function capture(
  store: MemoryRuntimeSnapshotStore,
  dynamic: PublicDynamicProjection,
  now: number,
  worldStatus: Parameters<typeof commitRuntimeSnapshot>[1]['worldStatus'] = 'running',
) {
  return commitRuntimeSnapshot(store, { worldId: WORLD_ID, dynamic, worldStatus, now });
}

const singleMove = project(createSingleMoveFixture());
const zeroEvent = project(createZeroEventFixture());

describe('AC#1 — snapshots carry a sequence number and a timestamp', () => {
  it('starts the snapshot sequence at 1 and records both clocks', async () => {
    const store = new MemoryRuntimeSnapshotStore();
    const result = await capture(store, singleMove, T0);

    expect(result).toMatchObject({ snapshotSequence: 1, captured: true, reason: 'captured' });
    const [row] = store.rows;
    expect(row.snapshotSequence).toBe(1);
    expect(row.createdAt).toBe(T0);
    expect(row.observedAt).toBe(T0);
    expect(row.contentUpdatedAt).toBe(singleMove.updatedAt);
    expect(row.sourceRuntimeSequence).toBe(singleMove.snapshotSequence);
    expect(row.runtimeVersion).toBe(singleMove.runtimeVersion);
    expect(row.isCurrent).toBe(true);
  });

  it('allocates the next sequence for genuinely new content', async () => {
    const store = new MemoryRuntimeSnapshotStore();
    await capture(store, zeroEvent, T0);
    const second = await capture(store, singleMove, T0 + HOUR);

    expect(second.snapshotSequence).toBe(2);
    expect(store.rows).toHaveLength(2);
    expect(store.rows.filter((row) => row.isCurrent)).toHaveLength(1);
    expect((await store.loadCurrent(WORLD_ID))?.snapshotSequence).toBe(2);
  });

  it('keeps the source runtime sequence distinct from its own counter', async () => {
    const store = new MemoryRuntimeSnapshotStore();
    await capture(store, atSequence(singleMove, 42), T0);
    await capture(store, atSequence(singleMove, 43), T0 + HOUR);

    expect(store.rows.map((row) => row.snapshotSequence)).toEqual([1, 2]);
    expect(store.rows.map((row) => row.sourceRuntimeSequence)).toEqual([42, 43]);
  });

  const missingFieldCases = RUNTIME_SNAPSHOT_FIELDS.map((field) => [field] as const);

  it.each(missingFieldCases)('rejects a snapshot missing %s', (field) => {
    const valid = buildRuntimeSnapshot({
      worldId: WORLD_ID, dynamic: singleMove, worldStatus: 'running', snapshotSequence: 1, now: T0,
    });
    const candidate: Record<string, unknown> = { ...valid };
    delete candidate[field];
    expect(() => assertPublicRuntimeSnapshot(candidate)).toThrow(RuntimeSnapshotError);
  });

  // ART-122 widened `PublicActiveScene` with eight spatial fields. Every one is optional,
  // and these two tests are what that decision buys: a row written before ART-122 and a row
  // written after it must both validate. If any new field were required, the first case
  // would throw — and because `serveRuntimeSnapshot` asserts on the way OUT, every snapshot
  // already in `publicRuntimeSnapshots` would become unreadable, taking the public map dark
  // with no way to rewrite the rows.
  it('still validates a scene persisted before ART-122, carrying none of the new fields', () => {
    const valid = buildRuntimeSnapshot({
      worldId: WORLD_ID, dynamic: singleMove, worldStatus: 'running', snapshotSequence: 1, now: T0,
    });
    const legacy = {
      ...valid,
      activeSceneStates: [{ title: '簽約', summary: '眾人見證休戰。', sourceEventIds: ['evt-1'] }],
    };
    expect(() => assertPublicRuntimeSnapshot(legacy)).not.toThrow();
  });

  it('validates a scene carrying every ART-122 field', () => {
    const valid = buildRuntimeSnapshot({
      worldId: WORLD_ID, dynamic: singleMove, worldStatus: 'running', snapshotSequence: 1, now: T0,
    });
    const widened = {
      ...valid,
      activeSceneStates: [{
        title: '簽約', summary: '眾人見證休戰。', sourceEventIds: ['evt-1'],
        sceneId: '3:evening:mistwood-hall', locationId: 'mistwood-hall',
        participantCharacterIds: ['cassia', 'rowan'], arcIds: ['arc-truce'],
        status: 'ended', publicationStatus: 'published', startedAt: 100, endedAt: 200,
      }],
    };
    expect(() => assertPublicRuntimeSnapshot(widened)).not.toThrow();
    expect(() => assertPublicRuntimeSnapshot({
      ...widened,
      activeSceneStates: [{ ...widened.activeSceneStates[0], endedAt: 50 }],
    })).toThrow(/must not precede startedAt/);
    expect(() => assertPublicRuntimeSnapshot({
      ...widened,
      activeSceneStates: [{ ...widened.activeSceneStates[0], status: 'pending' }],
    })).toThrow(RuntimeSnapshotError);
  });

  it('rejects a snapshot carrying a field the contract does not publish', () => {
    const valid = buildRuntimeSnapshot({
      worldId: WORLD_ID, dynamic: singleMove, worldStatus: 'running', snapshotSequence: 1, now: T0,
    });
    expect(() => assertPublicRuntimeSnapshot({ ...valid, adminNotes: 'ops only' })).toThrow(/does not publish/);
  });

  const invalidCases: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['a zero snapshotSequence', { snapshotSequence: 0 }],
    ['a fractional snapshotSequence', { snapshotSequence: 1.5 }],
    ['a negative sourceRuntimeSequence', { sourceRuntimeSequence: -1 }],
    ['a negative createdAt', { createdAt: -1 }],
    ['a NaN observedAt', { observedAt: Number.NaN }],
    ['an out-of-enum status', { status: 'stale' }],
    ['an out-of-enum status claiming delay', { status: 'delayed' }],
    ['an empty worldId', { worldId: '' }],
    ['an empty mapId', { mapId: '' }],
    ['a non-boolean isCurrent', { isCurrent: 'yes' }],
    ['a non-array characterStates', { characterStates: {} }],
    ['a non-array activeSceneStates', { activeSceneStates: null }],
    ['a wrong schemaVersion', { schemaVersion: 2 }],
  ];

  it.each(invalidCases)('rejects a snapshot with %s', (_label, patch) => {
    const valid = buildRuntimeSnapshot({
      worldId: WORLD_ID, dynamic: singleMove, worldStatus: 'running', snapshotSequence: 1, now: T0,
    });
    expect(() => assertPublicRuntimeSnapshot({ ...valid, ...patch })).toThrow(RuntimeSnapshotError);
  });

  it('rejects two motions for the same character', () => {
    const valid = buildRuntimeSnapshot({
      worldId: WORLD_ID, dynamic: singleMove, worldStatus: 'running', snapshotSequence: 1, now: T0,
    });
    const candidate = { ...valid, characterStates: [valid.characterStates[0], { ...valid.characterStates[0] }] };
    expect(() => assertPublicRuntimeSnapshot(candidate)).toThrow(/exactly one motion/);
  });
});

describe('AC#2 — a snapshot is readable with no simulation executing', () => {
  it('serves a full envelope from a store holding one row and nothing else', async () => {
    const store = new MemoryRuntimeSnapshotStore();
    await capture(store, singleMove, T0);

    const envelope = await serveRuntimeSnapshot(store, WORLD_ID, T0 + HOUR);
    expect(envelope).not.toBeNull();
    expect(Object.keys(envelope!).sort()).toEqual([...RUNTIME_SNAPSHOT_ENVELOPE_FIELDS].sort());
    expect(envelope!.characterStates).toHaveLength(singleMove.characters.length);
    expect(envelope!.mapId).toBe(singleMove.mapId);
    expect(envelope!.snapshotSequence).toBe(1);
  });

  it('returns null before the first capture rather than inventing a snapshot', async () => {
    expect(await serveRuntimeSnapshot(new MemoryRuntimeSnapshotStore(), WORLD_ID, T0)).toBeNull();
  });

  it('serving mutates no stored row', async () => {
    const store = new MemoryRuntimeSnapshotStore();
    await capture(store, singleMove, T0);
    const before = JSON.stringify(store.rows);
    await serveRuntimeSnapshot(store, WORLD_ID, T0 + 5 * HOUR);
    expect(JSON.stringify(store.rows)).toBe(before);
  });

  const sources = ['runtimeSnapshot.ts', 'runtimeSnapshotValidators.ts'].map((name) => ({
    name,
    source: readFileSync(join(process.cwd(), 'convex/publicRead', name), 'utf8'),
  }));

  it('names no simulation or Canon table in the snapshot modules', () => {
    for (const { name, source } of sources) {
      for (const symbol of ['canonEvents', 'worldSchedules', '_generated']) {
        expect(`${name}:${source.includes(symbol)}`).toBe(`${name}:false`);
      }
    }
  });

  it('imports no Convex runtime into the pure module, so there is nowhere for a write to go', () => {
    const pure = sources.find((entry) => entry.name === 'runtimeSnapshot.ts');
    expect(pure?.source).not.toContain("from 'convex/");
    for (const api of ['ctx.db', 'internalMutation', 'db.insert(', 'db.patch(', 'db.replace(']) {
      expect(pure?.source.includes(api)).toBe(false);
    }
  });

  it('declares the public read as a query over the snapshot table alone', () => {
    const wiring = readFileSync(join(process.cwd(), 'convex/publicRead/runtimeSnapshotFunctions.ts'), 'utf8');
    expect(wiring).toContain('export const getPublicRuntimeSnapshot = query({');
    const start = wiring.indexOf('export const getPublicRuntimeSnapshot');
    const rest = wiring.slice(start + 1);
    const declaration = wiring.slice(start, start + 1 + rest.indexOf('\nexport const '));
    expect(declaration).toContain('worldId: v.string()');
    expect(declaration).not.toContain('mutation');
    expect(declaration).not.toContain('canonEvents');
    expect(declaration).not.toContain('worldSchedules');
    expect(declaration).not.toContain('identity');
    expect(declaration).not.toContain('viewer');
  });
});

describe('AC#3 — the client can tell Live from Delayed, Paused and Stale', () => {
  const base = {
    status: 'live' as PublicRuntimeSnapshotStatus,
    sourceRuntimeSequence: 5,
    contentUpdatedAt: T0,
    createdAt: T0,
    observedAt: T0,
  };

  const cases: ReadonlyArray<readonly [string, Partial<typeof base> & { nowMs: number }, string]> = [
    ['fresh content', { nowMs: T0 }, 'live'],
    ['content one millisecond short of the live limit', { nowMs: T0 + RUNTIME_SNAPSHOT_LIVE_MAX_AGE_MS - 1 }, 'live'],
    ['content exactly at the live limit', { nowMs: T0 + RUNTIME_SNAPSHOT_LIVE_MAX_AGE_MS, observedAt: T0 + RUNTIME_SNAPSHOT_LIVE_MAX_AGE_MS }, 'delayed'],
    ['content one millisecond short of the delayed limit', { nowMs: T0 + RUNTIME_SNAPSHOT_DELAYED_MAX_AGE_MS - 1, observedAt: T0 + RUNTIME_SNAPSHOT_DELAYED_MAX_AGE_MS - 1 }, 'delayed'],
    ['content exactly at the delayed limit', { nowMs: T0 + RUNTIME_SNAPSHOT_DELAYED_MAX_AGE_MS, observedAt: T0 + RUNTIME_SNAPSHOT_DELAYED_MAX_AGE_MS }, 'stale'],
    ['content far past the delayed limit', { nowMs: T0 + 10 * 24 * HOUR, observedAt: T0 + 10 * 24 * HOUR }, 'stale'],
  ];

  it.each(cases)('reports %s as %s', (_label, patch, expected) => {
    expect(classifyRuntimeFreshness({ ...base, ...patch }).freshness).toBe(expected);
  });

  it('reports a paused world as paused at any age', () => {
    for (const nowMs of [T0, T0 + 10 * 24 * HOUR]) {
      expect(classifyRuntimeFreshness({ ...base, status: 'paused', observedAt: nowMs, nowMs }).freshness).toBe('paused');
    }
  });

  it('reports a paused world as paused even when nobody has re-observed it', () => {
    const nowMs = T0 + 30 * 24 * HOUR;
    expect(classifyRuntimeFreshness({ ...base, status: 'paused', nowMs }).freshness).toBe('paused');
  });

  it('reports a stale observation as stale even when the content looks brand new', () => {
    const nowMs = T0 + RUNTIME_SNAPSHOT_OBSERVATION_MAX_AGE_MS;
    expect(classifyRuntimeFreshness({
      ...base, contentUpdatedAt: nowMs, createdAt: nowMs, observedAt: T0, nowMs,
    }).freshness).toBe('stale');
  });

  it('still trusts an observation one millisecond inside the limit', () => {
    const nowMs = T0 + RUNTIME_SNAPSHOT_OBSERVATION_MAX_AGE_MS - 1;
    expect(classifyRuntimeFreshness({
      ...base, contentUpdatedAt: nowMs, createdAt: nowMs, observedAt: T0, nowMs,
    }).freshness).toBe('live');
  });

  it('measures a zero-history world from its capture, not from the Unix epoch', async () => {
    expect(zeroEvent.snapshotSequence).toBe(0);
    expect(zeroEvent.updatedAt).toBe(0);

    const store = new MemoryRuntimeSnapshotStore();
    await capture(store, zeroEvent, T0);
    const envelope = await serveRuntimeSnapshot(store, WORLD_ID, T0 + HOUR);

    expect(envelope?.freshness).toBe('live');
    expect(envelope?.contentAgeMs).toBe(HOUR);
  });

  it('clamps a snapshot from the future to zero age rather than reporting negative time', () => {
    const verdict = classifyRuntimeFreshness({ ...base, nowMs: T0 - HOUR });
    expect(verdict.contentAgeMs).toBe(0);
    expect(verdict.observationAgeMs).toBe(0);
  });

  it('fails closed: an unreadable schedule is recorded as paused, never as live', () => {
    expect(toRuntimeSnapshotStatus('unknown')).toBe('paused');
    expect(toRuntimeSnapshotStatus('paused')).toBe('paused');
    expect(toRuntimeSnapshotStatus('running')).toBe('live');
  });

  it('publishes exactly the four PRD freshness values', () => {
    expect([...RUNTIME_FRESHNESS]).toEqual(['live', 'delayed', 'paused', 'stale']);
  });

  it('rejects a non-finite instant instead of guessing a verdict', () => {
    expect(() => classifyRuntimeFreshness({ ...base, nowMs: Number.NaN })).toThrow(RuntimeSnapshotError);
  });
});

describe('AC#4 — a stale snapshot is never presented as continuously updating', () => {
  it('serves a stale verdict from a row still persisted as live', async () => {
    const store = new MemoryRuntimeSnapshotStore();
    await capture(store, singleMove, T0);
    expect(store.rows[0].status).toBe('live');

    const envelope = await serveRuntimeSnapshot(store, WORLD_ID, T0 + 13 * HOUR);
    expect(envelope?.status).toBe('live');
    expect(envelope?.freshness).toBe('stale');
    // The verdict is computed, not stored: the row is byte-identical afterwards.
    expect(store.rows[0].status).toBe('live');
  });

  it('has no persistable status that could express delayed or stale', () => {
    expect([...RUNTIME_SNAPSHOT_STATUSES]).toEqual(['live', 'paused']);
    const persistable = new Set<string>(RUNTIME_SNAPSHOT_STATUSES);
    expect(persistable.has('delayed')).toBe(false);
    expect(persistable.has('stale')).toBe(false);
  });

  it('never writes the freshness verdict into a stored row', async () => {
    const store = new MemoryRuntimeSnapshotStore();
    await capture(store, singleMove, T0);
    expect(Object.keys(store.rows[0])).not.toContain('freshness');
    expect(Object.keys(store.rows[0]).sort()).toEqual([...RUNTIME_SNAPSHOT_FIELDS, 'id'].sort());
  });

  it('ships the thresholds and both ages so the client can re-derive the verdict as its clock moves', async () => {
    const store = new MemoryRuntimeSnapshotStore();
    await capture(store, singleMove, T0);
    const envelope = await serveRuntimeSnapshot(store, WORLD_ID, T0 + 2 * HOUR);

    expect(envelope?.thresholds).toEqual({
      liveMaxAgeMs: RUNTIME_SNAPSHOT_LIVE_MAX_AGE_MS,
      delayedMaxAgeMs: RUNTIME_SNAPSHOT_DELAYED_MAX_AGE_MS,
      observationMaxAgeMs: RUNTIME_SNAPSHOT_OBSERVATION_MAX_AGE_MS,
    });
    expect(envelope?.observationAgeMs).toBe(2 * HOUR);
    expect(envelope?.contentAgeMs).toBe((T0 + 2 * HOUR) - singleMove.updatedAt);

    // Re-deriving locally at a later instant reaches the same conclusion the server would.
    const later = (T0 + 2 * HOUR) + 20 * HOUR;
    const localContentAge = envelope!.contentAgeMs + (later - (T0 + 2 * HOUR));
    expect(localContentAge >= envelope!.thresholds.delayedMaxAgeMs).toBe(true);
    expect((await serveRuntimeSnapshot(store, WORLD_ID, later))?.freshness).toBe('stale');
  });

  it('keeps the Convex validators aligned with the hand-written contract', () => {
    const members = (validator: unknown): string[] =>
      (validator as { members: { value: string }[] }).members.map((member) => member.value).sort();
    expect(members(publicRuntimeSnapshotStatusValidator)).toEqual([...RUNTIME_SNAPSHOT_STATUSES].sort());
    expect(members(publicRuntimeFreshnessValidator)).toEqual([...RUNTIME_FRESHNESS].sort());

    const envelopeFields = (publicRuntimeSnapshotEnvelopeValidator as unknown as {
      fields: Record<string, unknown>;
    }).fields;
    expect(Object.keys(envelopeFields).sort()).toEqual([...RUNTIME_SNAPSHOT_ENVELOPE_FIELDS].sort());
  });

  it('declares the stored status through the same validator the schema uses', () => {
    const schema = readFileSync(join(process.cwd(), 'convex/publicRead/schema.ts'), 'utf8');
    const table = schema.slice(schema.indexOf('publicRuntimeSnapshots: defineTable'));
    expect(table).toContain('status: publicRuntimeSnapshotStatusValidator');
    expect(table).not.toContain("v.literal('stale')");
    expect(table).not.toContain("v.literal('delayed')");
  });
});

describe('AC#5 — snapshot failure does not affect the Canon event store', () => {
  const newSources = ['runtimeSnapshot.ts', 'runtimeSnapshotValidators.ts', 'runtimeSnapshotFunctions.ts'].map((name) => ({
    name,
    source: readFileSync(join(process.cwd(), 'convex/publicRead', name), 'utf8'),
  }));

  // Mirrors `architecture/module-boundaries.json`'s canonWriteBoundary.forbiddenSymbols.
  const forbidden = ['canonEvents', 'commitProposedEvent', 'validateAndCommitProposedEvent', 'reduceWorldEvent'];

  it.each(forbidden)('names no Canon write symbol (%s) in any snapshot module', (symbol) => {
    for (const { name, source } of newSources) {
      expect(`${name}:${source.includes(symbol)}`).toBe(`${name}:false`);
    }
  });

  it('leaves the previous head serving when the snapshot write itself throws', async () => {
    const store = new MemoryRuntimeSnapshotStore();
    await capture(store, zeroEvent, T0);
    const before = JSON.stringify(store.rows);

    store.insertShouldThrow = true;
    await expect(capture(store, singleMove, T0 + HOUR)).rejects.toThrow('SNAPSHOT_WRITE_UNAVAILABLE');

    expect(JSON.stringify(store.rows)).toBe(before);
    const envelope = await serveRuntimeSnapshot(store, WORLD_ID, T0 + HOUR);
    expect(envelope?.snapshotSequence).toBe(1);
    expect(envelope?.characterStates).toHaveLength(zeroEvent.characters.length);
  });

  it('captures inside the rebuild transaction rather than dispatching a separate mutation', () => {
    const wiring = readFileSync(join(process.cwd(), 'convex/publicRead/liveStateFunctions.ts'), 'utf8');
    expect(wiring).toContain('commitRuntimeSnapshot(runtimeSnapshotWriteStore(ctx.db)');
    expect(wiring).not.toContain('ctx.runMutation');
  });
});

describe('AC#6 — the sequence never regresses after a client reconnect', () => {
  it('never lowers the served sequence across a mixed run of captures', async () => {
    const store = new MemoryRuntimeSnapshotStore();
    const observed: number[] = [];

    for (let step = 0; step < 10; step += 1) {
      // Alternate genuinely new content with an exact repeat of the previous payload.
      const dynamic = step % 2 === 0
        ? atSequence(singleMove, step + 1, FIXTURE_ACCEPTED_AT_MS + step)
        : atSequence(singleMove, step, FIXTURE_ACCEPTED_AT_MS + step - 1);
      await capture(store, dynamic, T0 + step * HOUR);
      observed.push((await serveRuntimeSnapshot(store, WORLD_ID, T0 + step * HOUR))!.snapshotSequence);
    }

    for (let index = 1; index < observed.length; index += 1) {
      expect(observed[index]).toBeGreaterThanOrEqual(observed[index - 1]);
    }
    expect(observed.at(-1)).toBeGreaterThan(observed[0]);
  });

  it('refuses a source projection that has gone backwards', async () => {
    const store = new MemoryRuntimeSnapshotStore();
    await capture(store, atSequence(singleMove, 42), T0);
    const headBefore = JSON.stringify(await store.loadCurrent(WORLD_ID));

    const result = await capture(store, atSequence(singleMove, 7), T0 + HOUR);

    expect(result).toMatchObject({ captured: false, reason: 'source_regressed', snapshotSequence: 1, sourceRuntimeSequence: 42 });
    expect(JSON.stringify(await store.loadCurrent(WORLD_ID))).toBe(headBefore);
    expect(store.rows).toHaveLength(1);
  });

  it('accepts a source projection that stands still', async () => {
    const store = new MemoryRuntimeSnapshotStore();
    await capture(store, atSequence(singleMove, 42), T0);
    const result = await capture(store, atSequence(singleMove, 42), T0 + HOUR);
    expect(result.reason).toBe('deduplicated');
  });

  it('patches observedAt on a duplicate heartbeat without burning a sequence number', async () => {
    const store = new MemoryRuntimeSnapshotStore();
    await capture(store, singleMove, T0);
    const result = await capture(store, singleMove, T0 + HOUR);

    expect(result).toMatchObject({ captured: false, reason: 'deduplicated', snapshotSequence: 1 });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].observedAt).toBe(T0 + HOUR);
    expect(store.rows[0].createdAt).toBe(T0);
  });

  it('does not lose the served sequence when a capture fails between two good ones', async () => {
    const store = new MemoryRuntimeSnapshotStore();
    await capture(store, atSequence(singleMove, 1, FIXTURE_ACCEPTED_AT_MS), T0);
    const first = (await serveRuntimeSnapshot(store, WORLD_ID, T0))!.snapshotSequence;

    store.insertShouldThrow = true;
    await expect(capture(store, atSequence(singleMove, 2, FIXTURE_ACCEPTED_AT_MS + 1), T0 + HOUR)).rejects.toThrow();
    const during = (await serveRuntimeSnapshot(store, WORLD_ID, T0 + HOUR))!.snapshotSequence;

    store.insertShouldThrow = false;
    await capture(store, atSequence(singleMove, 3, FIXTURE_ACCEPTED_AT_MS + 2), T0 + 2 * HOUR);
    const after = (await serveRuntimeSnapshot(store, WORLD_ID, T0 + 2 * HOUR))!.snapshotSequence;

    expect(during).toBe(first);
    expect(after).toBeGreaterThan(during);
  });

  it('treats a status change as new content even when the world state is identical', async () => {
    const store = new MemoryRuntimeSnapshotStore();
    await capture(store, singleMove, T0, 'running');
    const paused = await capture(store, singleMove, T0 + HOUR, 'paused');

    expect(paused).toMatchObject({ captured: true, snapshotSequence: 2 });
    expect((await serveRuntimeSnapshot(store, WORLD_ID, T0 + HOUR))?.freshness).toBe('paused');
  });
});

describe('threshold derivation is pinned to the real slot cadence', () => {
  it('matches the longest gap between two consecutive public slots', () => {
    const dayMs = 24 * HOUR;
    const gaps = PUBLIC_SLOT_START_MS.map((start, index) => (
      index + 1 < PUBLIC_SLOT_START_MS.length
        ? PUBLIC_SLOT_START_MS[index + 1] - start
        : PUBLIC_SLOT_START_MS[0] + dayMs - start
    ));
    expect(Math.max(...gaps)).toBe(PUBLIC_SLOT_MAX_GAP_MS);
  });

  it('places delayed and the observation limit at exactly two slot gaps', () => {
    expect(RUNTIME_SNAPSHOT_LIVE_MAX_AGE_MS).toBe(PUBLIC_SLOT_MAX_GAP_MS);
    expect(RUNTIME_SNAPSHOT_DELAYED_MAX_AGE_MS).toBe(2 * PUBLIC_SLOT_MAX_GAP_MS);
    expect(RUNTIME_SNAPSHOT_OBSERVATION_MAX_AGE_MS).toBe(2 * PUBLIC_SLOT_MAX_GAP_MS);
  });

  it('leaves the hourly capture cron a wide margin under the observation limit', () => {
    const cron = readFileSync(join(process.cwd(), 'convex/crons.ts'), 'utf8');
    expect(cron).toContain("'capture public runtime snapshots'");
    expect(cron).toContain('{ hours: 1 }');
    expect(RUNTIME_SNAPSHOT_OBSERVATION_MAX_AGE_MS / HOUR).toBeGreaterThanOrEqual(12);
  });

  it('keeps the snapshot table out of the vacuum list, so a paused world keeps its only row', () => {
    const cron = readFileSync(join(process.cwd(), 'convex/crons.ts'), 'utf8');
    const list = cron
      .slice(cron.indexOf('const TablesToVacuum'), cron.indexOf('export const vacuumOldEntries'))
      // Comments stripped first: the list documents which tables are excluded and WHY, so
      // a prose mention of this table is the opposite of it being vacuumed.
      .replace(/\/\/.*$/gm, '');
    expect(list).not.toContain('publicRuntimeSnapshots');
    expect(list).not.toContain('dynamicViewMetricRollups');
  });
});

describe('the content digest covers what a viewer sees and nothing else', () => {
  const content = {
    sourceRuntimeSequence: singleMove.snapshotSequence,
    status: 'live' as PublicRuntimeSnapshotStatus,
    mapId: singleMove.mapId,
    characterStates: singleMove.characters,
    activeSceneStates: singleMove.activeScenes,
  };

  it('is stable across repeated calls', () => {
    expect(hashRuntimeSnapshotContent(content)).toBe(hashRuntimeSnapshotContent(content));
  });

  it('changes when the world state changes', () => {
    expect(hashRuntimeSnapshotContent({ ...content, status: 'paused' }))
      .not.toBe(hashRuntimeSnapshotContent(content));
    expect(hashRuntimeSnapshotContent({ ...content, characterStates: zeroEvent.characters }))
      .not.toBe(hashRuntimeSnapshotContent(content));
    expect(hashRuntimeSnapshotContent({ ...content, sourceRuntimeSequence: content.sourceRuntimeSequence + 1 }))
      .not.toBe(hashRuntimeSnapshotContent(content));
  });

  it('is unaffected by the clocks, which is what makes the heartbeat cheap', () => {
    const early = buildRuntimeSnapshot({
      worldId: WORLD_ID, dynamic: singleMove, worldStatus: 'running', snapshotSequence: 1, now: T0,
    });
    const late = buildRuntimeSnapshot({
      worldId: WORLD_ID, dynamic: singleMove, worldStatus: 'running', snapshotSequence: 1, now: T0 + 5 * 24 * HOUR,
    });
    expect(late.contentHash).toBe(early.contentHash);
  });
});

describe('input validation', () => {
  it('rejects an empty worldId or a non-finite instant', async () => {
    const store = new MemoryRuntimeSnapshotStore();
    await expect(commitRuntimeSnapshot(store, { worldId: '', dynamic: singleMove, worldStatus: 'running', now: T0 }))
      .rejects.toThrow(RuntimeSnapshotError);
    await expect(commitRuntimeSnapshot(store, { worldId: WORLD_ID, dynamic: singleMove, worldStatus: 'running', now: Number.NaN }))
      .rejects.toThrow(RuntimeSnapshotError);
    await expect(serveRuntimeSnapshot(store, '', T0)).rejects.toThrow(RuntimeSnapshotError);
  });
});
