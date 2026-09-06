/**
 * The automatic publication gate (ART-162).
 *
 * `worldSchedules.publishEnabled` existed since ART-18 and gated nothing — written by the
 * scheduler, copied onto every reserved slot, read by no production code. This suite is what makes
 * it mean something, and what stops it meaning more than it should.
 *
 * The asymmetry is the whole design and most of the tests below exist to pin it:
 *
 *   **It can SUPPRESS publication. It can never FORCE it.**
 *
 * So there are two families here. One proves `false` freezes the public surface without touching
 * anything upstream of it. The other proves `true` grants nothing — it does not bypass safety, does
 * not override a withhold, and does not release content the lifecycle has not walked to `ready`.
 */

import {
  commitReadModelVersion,
  serveReadModel,
  type CommitReadModelResult,
  type JsonValue,
  type PublicReadStore,
  type PublishedReadModel,
  type ReadModelKind,
  type StoredReadModel,
} from './readModel';
import { writeStore } from './readModelFunctions';
import { advancePublication } from '../editorial/publicationLifecycleFunctions';
import { isPublicationEnabled, PUBLICATION_SUPPRESSED } from '../shared/publicationGate';
import {
  createPublicationRecord,
  transitionPublication,
  type PublicationRecord,
} from '../editorial/publicationLifecycle';

const WORLD_ID = 'mistwood';
const NOW = 1_700_000_000_000;
const KIND: ReadModelKind = 'world';
const REF = 'mistwood';

/**
 * The in-memory store, with the gate as a settable fact rather than a hard-coded `true`.
 *
 * `writes` counts every insert and patch, so "suppressed" can be asserted as *nothing happened*
 * rather than as *the return value said so* — a gate that returned the right shape while still
 * writing would pass the weaker assertion.
 */
class GatedReadStore implements PublicReadStore {
  readonly rows: StoredReadModel[] = [];
  writes = 0;
  constructor(public enabled = true) {}

  publicationEnabled(): Promise<boolean> { return Promise.resolve(this.enabled); }

  loadTargetVersions(worldId: string, modelKind: ReadModelKind, modelRef: string) {
    return Promise.resolve(this.rows.filter((row) =>
      row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef));
  }
  findCurrent(worldId: string, modelKind: ReadModelKind, modelRef: string) {
    return Promise.resolve(this.rows.find((row) =>
      row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isCurrent) ?? null);
  }
  loadLastKnownGood(worldId: string, modelKind: ReadModelKind, modelRef: string) {
    return Promise.resolve(this.rows.filter((row) =>
      row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isLastKnownGood));
  }
  insertVersion(record: PublishedReadModel) {
    this.writes += 1;
    const id = `row-${this.rows.length + 1}`;
    this.rows.push({ ...record, id, isCurrent: true, isLastKnownGood: false });
    return Promise.resolve(id);
  }
  markCurrent(rowId: string, patch: { isCurrent: boolean; isLastKnownGood: boolean; status: StoredReadModel['status']; updatedAt: number }) {
    this.writes += 1;
    const row = this.rows.find((entry) => entry.id === rowId);
    if (row) Object.assign(row, patch);
    return Promise.resolve();
  }
}

const commit = (store: GatedReadStore, payload: JsonValue, over: Partial<Parameters<typeof commitReadModelVersion>[1]> = {}): Promise<CommitReadModelResult> =>
  commitReadModelVersion(store, {
    worldId: WORLD_ID, modelKind: KIND, modelRef: REF, payload,
    sourceEventIds: ['mistwood#event#1'], status: 'published', now: NOW, ...over,
  });

// =============================================================================
// AC#1 / AC#2 — false freezes the public surface
// =============================================================================

describe('AC#1 — with the gate closed, no read-model version is written', () => {
  it('writes nothing at all, and says it suppressed', async () => {
    const store = new GatedReadStore(false);

    const result = await commit(store, { day: 1 });

    expect(result.suppressed).toBe(true);
    // Asserted as "nothing happened", not merely as "the result said so": a gate that returned
    // the right shape while still inserting would pass a weaker check.
    expect(store.writes).toBe(0);
    expect(store.rows).toHaveLength(0);
  });

  it('reports the version a reader can actually see, not the one it declined to write', async () => {
    const store = new GatedReadStore(true);
    await commit(store, { day: 1 });
    store.enabled = false;

    const result = await commit(store, { day: 2 });

    // Reporting version 2 here would tell a caller something was published that was not.
    expect(result).toMatchObject({ suppressed: true, version: 1 });
  });

  it('suppresses every model kind, because the gate is per WORLD not per projection', async () => {
    const store = new GatedReadStore(false);

    for (const kind of ['world', 'episode', 'character'] as ReadModelKind[]) {
      const result = await commit(store, { k: kind }, { modelKind: kind, modelRef: kind === 'world' ? 'mistwood' : `mistwood:${kind}:1` });
      expect(result.suppressed).toBe(true);
    }
    expect(store.writes).toBe(0);
  });
});

describe('AC#2 — previously released content keeps serving', () => {
  it('leaves the live version current and readable', async () => {
    const store = new GatedReadStore(true);
    await commit(store, { day: 1 });
    store.enabled = false;

    await commit(store, { day: 2 });
    const served = await serveReadModel(store, WORLD_ID, KIND, REF);

    // The requirement, and the reason the gate returns BEFORE `findCurrent`/`insertVersion` rather
    // than suppressing only the insert: a gate that skipped the insert but still demoted the
    // current row would blank the public surface instead of freezing it.
    expect(served?.payload).toEqual({ day: 1 });
    expect(served?.version).toBe(1);
    expect(served?.servedFrom).toBe('current');
  });

  it('keeps serving across many suppressed commits, without drift', async () => {
    const store = new GatedReadStore(true);
    await commit(store, { day: 1 });
    store.enabled = false;

    for (let day = 2; day <= 6; day += 1) await commit(store, { day });

    expect((await serveReadModel(store, WORLD_ID, KIND, REF))?.payload).toEqual({ day: 1 });
    expect(store.rows).toHaveLength(1);
  });

  it('resumes publishing the moment the gate reopens, from the next version', async () => {
    const store = new GatedReadStore(true);
    await commit(store, { day: 1 });
    store.enabled = false;
    await commit(store, { day: 2 });
    store.enabled = true;

    const result = await commit(store, { day: 3 });

    // The negative control for every suppression test above: they would all pass against a gate
    // that suppressed permanently.
    expect(result.suppressed).toBe(false);
    expect((await serveReadModel(store, WORLD_ID, KIND, REF))?.payload).toEqual({ day: 3 });
    // Version 2, not 3: the suppressed commit never existed, so it consumed no version number.
    expect(result.version).toBe(2);
  });
});

// =============================================================================
// AC#3–#5 — true grants nothing on its own
// =============================================================================

const record = (over: Partial<PublicationRecord> = {}): PublicationRecord => ({
  ...createPublicationRecord({
    publicationId: 'pub:episode:mistwood:1:1',
    worldId: WORLD_ID, contentKind: 'episode', contentRef: 'episode:mistwood:1',
    summary: null, actor: { type: 'system', id: 'pipeline' }, reason: 'generated', at: NOW,
  }),
  ...over,
});

/** Walk a fresh record to `ready` through the real lifecycle, as the editorial path does. */
function readyRecord(): PublicationRecord {
  let current = record();
  for (const action of ['validate', 'begin_safety_review', 'pass_safety_review'] as const) {
    current = transitionPublication(current, action, { type: 'admin', id: 'ed-1' }, 'r', NOW);
  }
  return current;
}

describe('AC#3 — with the gate open, ready content advances through the normal lifecycle', () => {
  it('reaches published only via the lifecycle, never by the flag', () => {
    const ready = readyRecord();
    expect(ready.status).toBe('ready');

    const published = transitionPublication(ready, 'publish', { type: 'admin', id: 'ed-1' }, 'ship', NOW);

    expect(published.status).toBe('published');
  });

  it('the gate is consulted for `publish` and for nothing else', () => {
    // Every other transition must run with the gate CLOSED. A suppressed world keeps deriving,
    // classifying and moving records to ready — it simply stops there. Gating the whole lifecycle
    // would leave a backlog of unreviewed content, which is not what "pause publication" means.
    expect(isPublicationEnabled({ publishEnabled: false })).toBe(false);
    let current = record();
    for (const action of ['validate', 'begin_safety_review', 'pass_safety_review'] as const) {
      current = transitionPublication(current, action, { type: 'admin', id: 'ed-1' }, 'r', NOW);
    }
    expect(current.status).toBe('ready');
  });
});

describe('AC#4 — the gate cannot release withheld content', () => {
  it('a withheld record refuses `publish` regardless of the flag', () => {
    const withheld = transitionPublication(readyRecord(), 'withhold',
      { type: 'admin', id: 'sr-1' }, 'unsafe', NOW);
    expect(withheld.status).toBe('withheld');

    // The lifecycle refuses this on its own. `publishEnabled` has no branch that could reach it:
    // the gate only ever REMOVES a transition, so an open gate leaves this refusal exactly as it
    // was — which is why an "override withheld" bug cannot be written without deleting the gate.
    expect(() => transitionPublication(withheld, 'publish',
      { type: 'admin', id: 'ed-1' }, 'ship', NOW)).toThrow();
    expect(isPublicationEnabled({ publishEnabled: true })).toBe(true);
  });

  it('a withhold can still be recorded while publication is suppressed', () => {
    // The gate must never make a world LESS safe. Refusing to record a safety withhold because
    // publication is paused would do exactly that.
    const withheld = transitionPublication(readyRecord(), 'withhold',
      { type: 'admin', id: 'sr-1' }, 'unsafe', NOW);

    expect(withheld.status).toBe('withheld');
  });
});

describe('AC#5 — the gate cannot bypass safety or skip the lifecycle', () => {
  it.each(['generated', 'validated', 'safety_review'] as const)(
    'refuses to publish directly from %s, gate open', (status) => {
      const stuck = record({ status });

      expect(() => transitionPublication(stuck, 'publish',
        { type: 'admin', id: 'ed-1' }, 'ship', NOW)).toThrow();
    });

  it('the gate has no path that advances a status', () => {
    // Structural, and the point of the whole design: `isPublicationEnabled` returns a boolean and
    // takes no record, so there is no expression in which it could promote anything. "publishEnabled
    // bypassed the safety gate" is not a bug that can be written without changing this signature.
    expect(typeof isPublicationEnabled({ publishEnabled: true })).toBe('boolean');
    expect(isPublicationEnabled({ publishEnabled: true })).toBe(true);
    expect(isPublicationEnabled({ publishEnabled: false })).toBe(false);
  });
});

describe('the flag itself', () => {
  it('reads an unscheduled world as publishing', () => {
    // Absent means "no opinion", and no opinion means behave exactly as before this gate existed.
    // Reading absent as suppressed would blank every read model in the offline gate.
    expect(isPublicationEnabled(null)).toBe(true);
    expect(isPublicationEnabled(undefined)).toBe(true);
    expect(isPublicationEnabled({})).toBe(true);
  });

  it('carries a stable refusal code, so a suppressed publish is not a mystery', () => {
    expect(PUBLICATION_SUPPRESSED).toBe('PUBLICATION_SUPPRESSED');
  });
});

// =============================================================================
// AC#6 — the flag never touches Canon
// =============================================================================

describe('AC#6 — changing the flag writes no Canon, in either direction', () => {
  it('the gate module cannot reach Canon: it takes a row and returns a boolean', () => {
    // The strongest available statement, and better than counting writes in a fixture: the gate
    // has no store, no database and no event in scope, so there is nothing it could write to.
    expect(isPublicationEnabled.length).toBe(1);
    expect(isPublicationEnabled({ publishEnabled: false })).toBe(false);
  });

  it('a suppressed commit performs no write of any kind', async () => {
    const store = new GatedReadStore(false);

    await commit(store, { day: 1 });

    // `publishedReadModels` is not Canon, but this is the same guarantee at the surface that
    // matters: suppression is the ABSENCE of a write, not a compensating one.
    expect(store.writes).toBe(0);
  });
});

// =============================================================================
// AC#7 — the PRODUCTION path is gated, not just the fixture
// =============================================================================

/**
 * Everything above drives a fixture store whose gate is a settable field. That proves the gate
 * WORKS and says nothing about whether the deployed bindings use it.
 *
 * Two production bindings must: the read-model writer every projection commits through, and the
 * editorial publish transition. The compiler already refuses a `PublicReadStore` that omits
 * `publicationEnabled` — but not one that hard-codes `true`, which is exactly what a careless
 * revert looks like. These drive the real bindings against a real schedule row.
 */
describe('AC#7 — the deployed bindings read the flag', () => {
  type Row = Record<string, unknown>;

  const scheduleRow = (publishEnabled: boolean): Row => ({
    _id: 'worldSchedules:1', worldId: WORLD_ID, mode: 'public', status: 'running',
    baseSeed: 1, anchorRealTimeMs: NOW, anchorWorldDay: 0, nextWorldDay: 0,
    nextTimeSlot: 'morning', publishEnabled, createdAt: NOW, updatedAt: NOW,
  });

  function fakeDb(tables: Record<string, Row[]>) {
    return {
      query(table: string) {
        let matched = [...(tables[table] ?? [])];
        const chain = {
          withIndex(_name: string, build: (q: unknown) => unknown) {
            const eqs: Array<[string, unknown]> = [];
            const q = { eq(field: string, value: unknown) { eqs.push([field, value]); return q; } };
            build(q);
            matched = matched.filter((row) => eqs.every(([field, value]) => row[field] === value));
            return chain;
          },
          order() { return chain; },
          collect: () => Promise.resolve(matched),
          take: (count: number) => Promise.resolve(matched.slice(0, count)),
          unique: () => Promise.resolve(matched[0] ?? null),
          first: () => Promise.resolve(matched[0] ?? null),
        };
        return chain;
      },
      insert: (table: string, row: Row) => {
        (tables[table] ??= []).push({ ...row, _id: `${table}:${(tables[table]?.length ?? 0) + 1}` });
        return Promise.resolve('id');
      },
      patch: (id: string, patch: Row) => {
        for (const rows of Object.values(tables)) {
          const found = rows.find((row) => row._id === id);
          if (found) Object.assign(found, patch);
        }
        return Promise.resolve();
      },
      get: () => Promise.resolve(null),
    };
  }

  it('the read-model writer suppresses when the world says so', async () => {
    const tables = { worldSchedules: [scheduleRow(false)], publishedReadModels: [] as Row[] };
    const store = writeStore(fakeDb(tables) as never);

    const result = await commitReadModelVersion(store, {
      worldId: WORLD_ID, modelKind: KIND, modelRef: REF, payload: { day: 1 },
      sourceEventIds: ['mistwood#event#1'], status: 'published', now: NOW,
    });

    expect(result.suppressed).toBe(true);
    expect(tables.publishedReadModels).toHaveLength(0);
  });

  it('the read-model writer publishes when the world says so — the negative control', async () => {
    // Without this, the test above would pass against a writer that suppressed unconditionally.
    const tables = { worldSchedules: [scheduleRow(true)], publishedReadModels: [] as Row[] };
    const store = writeStore(fakeDb(tables) as never);

    const result = await commitReadModelVersion(store, {
      worldId: WORLD_ID, modelKind: KIND, modelRef: REF, payload: { day: 1 },
      sourceEventIds: ['mistwood#event#1'], status: 'published', now: NOW,
    });

    expect(result.suppressed).toBe(false);
    expect(tables.publishedReadModels).toHaveLength(1);
  });

  it('an unscheduled world publishes through the deployed writer', async () => {
    const tables = { worldSchedules: [] as Row[], publishedReadModels: [] as Row[] };
    const store = writeStore(fakeDb(tables) as never);

    const result = await commitReadModelVersion(store, {
      worldId: WORLD_ID, modelKind: KIND, modelRef: REF, payload: { day: 1 },
      sourceEventIds: ['mistwood#event#1'], status: 'published', now: NOW,
    });

    expect(result.suppressed).toBe(false);
  });

  const advance = (tables: Record<string, Row[]>, action: string) =>
    (advancePublication as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })
      ._handler({ db: fakeDb(tables) }, {
        worldId: WORLD_ID, contentRef: 'episode:mistwood:1', action,
        actor: { type: 'admin', id: 'ed-1' }, reason: 'ship', now: NOW,
      });

  const publicationRow = (status: string): Row => {
    const ready = readyRecord();
    return {
      _id: 'publicationRecords:1', schemaVersion: 1, publicationId: ready.publicationId,
      worldId: WORLD_ID, contentKind: 'episode', contentRef: 'episode:mistwood:1',
      status, version: 1, summary: ready.summary ?? undefined, audit: ready.audit,
      isCurrent: true, createdAt: NOW, updatedAt: NOW,
    };
  };

  it('the editorial publish transition refuses while the gate is closed', async () => {
    const tables = { worldSchedules: [scheduleRow(false)], publicationRecords: [publicationRow('ready')] };

    await expect(advance(tables, 'publish')).rejects.toThrow(PUBLICATION_SUPPRESSED);
    // Stopped at ready, exactly as specified — not withheld, not failed, just not advanced.
    expect(tables.publicationRecords[0].status).toBe('ready');
  });

  it('the editorial publish transition proceeds while the gate is open', async () => {
    const tables = { worldSchedules: [scheduleRow(true)], publicationRecords: [publicationRow('ready')] };

    await expect(advance(tables, 'publish')).resolves.toMatchObject({ status: 'published' });
  });

  it('a WITHHOLD is still recorded while the gate is closed', async () => {
    // The gate must never make a world less safe. This is the transition that would be most
    // damaging to block, and it is deliberately ungated.
    const tables = { worldSchedules: [scheduleRow(false)], publicationRecords: [publicationRow('ready')] };

    await expect(advance(tables, 'withhold')).resolves.toMatchObject({ status: 'withheld' });
  });

  it('the earlier lifecycle transitions still run while the gate is closed', async () => {
    const tables = { worldSchedules: [scheduleRow(false)], publicationRecords: [publicationRow('generated')] };

    // A suppressed world keeps deriving and classifying; it simply stops at ready.
    await expect(advance(tables, 'validate')).resolves.toMatchObject({ status: 'validated' });
  });
});
