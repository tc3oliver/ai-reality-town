/**
 * The viewer-progress Convex handlers (FR-H004 / ART-39).
 *
 * Handler-level, following the pattern `episodeTimelineProjectionFunctions.test.ts` established:
 * the registered function's `_handler` runs against a hand-rolled in-memory `ctx`, so the index
 * lookup, the read-model join and the row write are exercised as they actually run. That matters
 * more here than in most suites, because the claim under test is a property of ROW ACCESS —
 * "a request presenting digest B can neither observe nor mutate digest A's row" cannot be settled
 * by a pure function, and asserting it against a mock that indexes by whatever the test passes in
 * would be asserting the mock.
 *
 * ## What the AC#7 test does and does not prove
 *
 * It proves the FIRST clause of FR-H004 AC#7 structurally: there is no argument through which one
 * viewer names another's row, so cross-identity read and write are impossible by accident and by
 * enumeration. It does NOT prove — and this suite does not claim — that a person holding someone
 * else's device token is kept out. They are that viewer, exactly as `environmentVote.ts` records
 * for the ballot. The second clause (explicit, authorized, lossless merging with an authenticated
 * identity) is unreachable in this deployment and belongs to ART-71; see
 * `docs/device-return-recap.md` §5.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getViewerProgress, recordViewerProgress } from './viewerProgressFunctions';
import {
  deviceViewerKey,
  MAX_ATTEMPTS_PER_DEVICE_PER_WORLD,
  MAX_PROGRESS_ROWS_PER_WORLD,
  viewerProgressEpisodeId,
} from './viewerProgress';

const WORLD_ID = 'mistwood';
const DEVICE_A = 'device-aaaa1111';
const DEVICE_B = 'device-bbbb2222';

const CHARACTER_A = 'char-anna';
const CHARACTER_B = 'char-ben';
const ARC_MILL = 'arc-mill';
const ARC_TRUCE = 'arc-truce';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const readHandler = getViewerProgress as unknown as Registered;
const writeHandler = recordViewerProgress as unknown as Registered;

/**
 * The slice of Convex these handlers use. Index constraints are `eq` chains, so filtering by the
 * captured constraints reproduces them — which is also what makes the cross-identity assertion
 * meaningful: a handler that looked a row up by anything other than its index constraints would
 * find nothing here.
 */
function memoryCtx(tables: Tables) {
  const db = {
    query(table: string) {
      return {
        withIndex(_index: string, build?: (q: unknown) => unknown) {
          const constraints: Row = {};
          const builder = {
            eq(field: string, value: unknown) {
              constraints[field] = value;
              return builder;
            },
          };
          if (build) build(builder);
          const matched = (tables[table] ?? []).filter((row) =>
            Object.entries(constraints).every(([field, value]) => row[field] === value));
          const ascending = [...matched].sort((left, right) =>
            Number(left.createdAt ?? 0) - Number(right.createdAt ?? 0));
          const chain = (rows: Row[]) => ({
            order: (direction: 'asc' | 'desc') => chain(direction === 'desc' ? [...rows].reverse() : rows),
            take: (count: number) => Promise.resolve(rows.slice(0, count)),
            collect: () => Promise.resolve(rows),
            first: () => Promise.resolve(rows[0] ?? null),
            unique: () => Promise.resolve(rows[0] ?? null),
          });
          return chain(ascending);
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
  };
  return { db } as Parameters<typeof writeHandler._handler>[0];
}

/** A published `episodes:<worldId>` row, in the real `publishedReadModels` shape. */
function episodeIndexRow(): Row {
  return {
    _id: 'publishedReadModels:0',
    schemaVersion: 1,
    worldId: WORLD_ID,
    modelKind: 'episode',
    modelRef: `episodes:${WORLD_ID}`,
    version: 1,
    payload: {
      schemaVersion: 1,
      worldId: WORLD_ID,
      episodes: [
        { worldDay: 3, episodeNumber: 1, title: '第 1 集', headline: 'h1', arcIds: [ARC_MILL], characterIds: [CHARACTER_A] },
        { worldDay: 7, episodeNumber: 2, title: '第 2 集', headline: 'h2', arcIds: [ARC_TRUCE], characterIds: [CHARACTER_B] },
      ],
      arcIds: [ARC_MILL, ARC_TRUCE],
      characterIds: [CHARACTER_A, CHARACTER_B],
    },
    status: 'published',
    sourceEventIds: ['mistwood#event#1'],
    isCurrent: true,
    isLastKnownGood: false,
    contentHash: 'hash-1',
    createdAt: 1_000,
    publishedAt: 1_000,
    updatedAt: 1_000,
  };
}

function seeded(): Tables {
  return { publishedReadModels: [episodeIndexRow()] };
}

const submit = (tables: Tables, args: Record<string, unknown>) =>
  writeHandler._handler(memoryCtx(tables), {
    worldId: WORLD_ID,
    lastViewedEpisodeId: null,
    followedCharacterIds: [],
    followedArcIds: [],
    spoilerMode: 'publicOnly',
    ...args,
  }) as Promise<{ accepted: boolean; code: string | null }>;

const read = (tables: Tables, deviceKey: string) =>
  readHandler._handler(memoryCtx(tables), { worldId: WORLD_ID, deviceKey });

const progressRows = (tables: Tables): Row[] => tables.viewerProgress ?? [];

describe('AC#3 — an unauthenticated device gets progress, keyed on its own digest', () => {
  test('a first submission creates exactly one row, under a namespaced digest', async () => {
    const tables = seeded();
    const result = await submit(tables, {
      deviceKey: DEVICE_A,
      lastViewedEpisodeId: viewerProgressEpisodeId(WORLD_ID, 3),
      followedCharacterIds: [CHARACTER_A],
      followedArcIds: [ARC_MILL],
    });
    expect(result).toEqual({ accepted: true, code: null });

    const rows = progressRows(tables);
    expect(rows).toHaveLength(1);
    expect(rows[0].viewerKey).toBe(deviceViewerKey(DEVICE_A));
    // §15: the raw token is nowhere in the stored row.
    expect(JSON.stringify(rows[0])).not.toContain(DEVICE_A);
    expect(tables.viewerProgressCounters).toEqual([
      expect.objectContaining({ worldId: WORLD_ID, rowCount: 1 }),
    ]);
  });

  test('the same device reads back exactly what it recorded', async () => {
    const tables = seeded();
    await submit(tables, {
      deviceKey: DEVICE_A,
      lastViewedEpisodeId: viewerProgressEpisodeId(WORLD_ID, 7),
      followedCharacterIds: [CHARACTER_B],
      followedArcIds: [ARC_TRUCE],
      spoilerMode: 'full',
    });
    const record = await read(tables, DEVICE_A);
    expect(record).toEqual(expect.objectContaining({
      lastViewedEpisodeId: viewerProgressEpisodeId(WORLD_ID, 7),
      followedCharacterIds: [CHARACTER_B],
      followedArcIds: [ARC_TRUCE],
      spoilerMode: 'full',
    }));
    expect(typeof (record as { updatedAt: unknown }).updatedAt).toBe('number');
    // The read serves the §13.12 fields and nothing else -- not `attempts`, not `viewerKey`, not
    // the digest. A read that echoed the stored key would hand back the one value the digest
    // exists to keep out of the response.
    expect(Object.keys(record as object).sort()).toEqual([
      'followedArcIds', 'followedCharacterIds', 'lastViewedEpisodeId', 'spoilerMode', 'updatedAt',
    ]);
  });

  test('a device with no row reads null, and a malformed key reads null too', async () => {
    const tables = seeded();
    expect(await read(tables, DEVICE_A)).toBeNull();
    // The same nothing for both, so the read says nothing about the key it was handed.
    expect(await read(tables, 'BAD KEY')).toBeNull();
  });

  test('a stored row this build cannot validate is served as null, not coerced', async () => {
    const tables = seeded();
    await submit(tables, { deviceKey: DEVICE_A, followedArcIds: [ARC_MILL] });
    // A mode no build knows. Coercing it to the default would silently decide what the viewer
    // is shown; `null` degrades the recap to its no-progress state instead.
    progressRows(tables)[0].spoilerMode = 'cinematic';
    expect(await read(tables, DEVICE_A)).toBeNull();
  });
});

describe('AC#7 (first clause) — progress cannot be read or modified across identities', () => {
  test('device B can neither observe nor mutate device A row', async () => {
    const tables = seeded();
    await submit(tables, {
      deviceKey: DEVICE_A,
      lastViewedEpisodeId: viewerProgressEpisodeId(WORLD_ID, 7),
      followedCharacterIds: [CHARACTER_A],
      followedArcIds: [ARC_MILL],
      spoilerMode: 'full',
    });
    const before = JSON.parse(JSON.stringify(progressRows(tables)[0])) as Row;

    // READ: B presents its own key and sees nothing. There is no argument through which B could
    // ask for A's row -- the digest is computed server-side from the key B presented.
    expect(await read(tables, DEVICE_B)).toBeNull();

    // WRITE: B records a completely different record. A's row must be untouched, and B must get
    // a row of its own rather than overwriting one.
    const result = await submit(tables, {
      deviceKey: DEVICE_B,
      lastViewedEpisodeId: viewerProgressEpisodeId(WORLD_ID, 3),
      followedCharacterIds: [CHARACTER_B],
      followedArcIds: [ARC_TRUCE],
      spoilerMode: 'watchedOnly',
    });
    expect(result).toEqual({ accepted: true, code: null });

    const rows = progressRows(tables);
    expect(rows).toHaveLength(2);
    const rowA = rows.find((row) => row.viewerKey === deviceViewerKey(DEVICE_A));
    const rowB = rows.find((row) => row.viewerKey === deviceViewerKey(DEVICE_B));
    expect(rowA).toEqual(before);
    expect(rowB).toEqual(expect.objectContaining({
      lastViewedEpisodeId: viewerProgressEpisodeId(WORLD_ID, 3),
      followedCharacterIds: [CHARACTER_B],
      followedArcIds: [ARC_TRUCE],
      spoilerMode: 'watchedOnly',
    }));

    // And A still reads back A's record, unchanged by anything B did.
    expect(await read(tables, DEVICE_A)).toEqual(expect.objectContaining({
      lastViewedEpisodeId: viewerProgressEpisodeId(WORLD_ID, 7),
      followedCharacterIds: [CHARACTER_A],
      spoilerMode: 'full',
    }));
  });

  test("B's attempts never spend A's budget", async () => {
    const tables = seeded();
    await submit(tables, { deviceKey: DEVICE_A, followedArcIds: [ARC_MILL] });
    for (let index = 0; index < 5; index += 1) {
      await submit(tables, { deviceKey: DEVICE_B, followedArcIds: [ARC_TRUCE] });
    }
    const rowA = progressRows(tables).find((row) => row.viewerKey === deviceViewerKey(DEVICE_A));
    expect(rowA?.attempts).toBe(1);
  });

  test('the surface declares no argument that could name another row', () => {
    // The structural half of the claim: `_id`, `viewerKey` and `viewerId` are not merely refused,
    // they are not inputs. Convex validates against `exportArgs()` before a handler runs.
    for (const fn of [getViewerProgress, recordViewerProgress]) {
      const declared = Object.keys(
        (JSON.parse((fn as unknown as { exportArgs: () => string }).exportArgs()) as {
          value?: Record<string, unknown>;
        }).value ?? {},
      );
      for (const forbidden of ['id', '_id', 'viewerKey', 'viewerId', 'deviceDigest']) {
        expect(declared).not.toContain(forbidden);
      }
      expect(declared).toContain('deviceKey');
    }
  });
});

describe('AC#4 — refusal paths, and what each of them writes', () => {
  test('a device past its attempt budget writes NOTHING AT ALL', async () => {
    const tables = seeded();
    await submit(tables, { deviceKey: DEVICE_A, followedArcIds: [ARC_MILL] });
    const row = progressRows(tables)[0];
    row.attempts = MAX_ATTEMPTS_PER_DEVICE_PER_WORLD;
    const frozen = JSON.parse(JSON.stringify(row)) as Row;
    const countersBefore = JSON.parse(JSON.stringify(tables.viewerProgressCounters)) as Row[];

    const result = await submit(tables, { deviceKey: DEVICE_A, followedArcIds: [ARC_TRUCE] });
    expect(result).toEqual({ accepted: false, code: 'PROGRESS_ATTEMPTS_EXHAUSTED' });

    // Not "the follow set is unchanged" -- the whole row is byte-identical, `attempts` and
    // `updatedAt` included. Past the budget the surface stops being a way to touch a row at all,
    // so an exhausted caller cannot even keep a timestamp moving.
    expect(progressRows(tables)).toHaveLength(1);
    expect(progressRows(tables)[0]).toEqual(frozen);
    expect(tables.viewerProgressCounters).toEqual(countersBefore);
  });

  test('an unknown followed id is refused, and the refusal still costs an attempt', async () => {
    const tables = seeded();
    await submit(tables, { deviceKey: DEVICE_A, followedArcIds: [ARC_MILL] });

    const result = await submit(tables, { deviceKey: DEVICE_A, followedCharacterIds: ['char-nobody'] });
    expect(result).toEqual({ accepted: false, code: 'PROGRESS_REFERENCE_UNKNOWN' });

    const row = progressRows(tables)[0];
    // The attempt is recorded -- otherwise the budget is decorative and the endpoint is an
    // oracle for enumerating which ids the world has.
    expect(row.attempts).toBe(2);
    // And nothing the refused submission carried was stored.
    expect(row.followedCharacterIds).toEqual([]);
    expect(row.followedArcIds).toEqual([ARC_MILL]);
  });

  test('a refused FIRST submission still creates its row, so the budget applies to it too', async () => {
    const tables = seeded();
    const result = await submit(tables, { deviceKey: DEVICE_A, followedArcIds: ['arc-invented'] });
    expect(result).toEqual({ accepted: false, code: 'PROGRESS_REFERENCE_UNKNOWN' });
    expect(progressRows(tables)).toEqual([
      expect.objectContaining({ attempts: 1, followedArcIds: [], spoilerMode: 'publicOnly' }),
    ]);
  });

  test('a full world refuses the new row AND does not allocate it', async () => {
    // The defect this pins: `PROGRESS_WORLD_FULL` can only fire when this device has no row, so
    // without the early return it fell straight through to the insert branch -- allocating the
    // row the ceiling had just refused and pushing `rowCount` one past the ceiling on every
    // subsequent call. The refusal whose entire purpose is "do not allocate" was allocating.
    const tables = seeded();
    tables.viewerProgressCounters = [{
      _id: 'viewerProgressCounters:0',
      schemaVersion: 1,
      worldId: WORLD_ID,
      rowCount: MAX_PROGRESS_ROWS_PER_WORLD,
      updatedAt: 1,
    }];
    const countersBefore = JSON.parse(JSON.stringify(tables.viewerProgressCounters)) as Row[];

    const result = await submit(tables, { deviceKey: DEVICE_A, followedArcIds: [ARC_MILL] });
    expect(result).toEqual({ accepted: false, code: 'PROGRESS_WORLD_FULL' });
    expect(tables.viewerProgress).toBeUndefined();
    expect(tables.viewerProgressCounters).toEqual(countersBefore);

    // And it stays refused rather than climbing: a caller hammering a full world buys nothing.
    for (let index = 0; index < 5; index += 1) {
      await submit(tables, { deviceKey: `device-probe-${index}0000`, followedArcIds: [ARC_MILL] });
    }
    expect(tables.viewerProgress).toBeUndefined();
    expect(tables.viewerProgressCounters?.[0].rowCount).toBe(MAX_PROGRESS_ROWS_PER_WORLD);
  });

  test('a world that has published nothing is refused as unknown, and allocates nothing', async () => {
    // An empty submission against a made-up world passed every referential check VACUOUSLY and
    // inserted a `viewerProgress` row PLUS a fresh counter starting at zero -- so the per-world
    // ceiling bounded nothing across worlds, and an anonymous caller had unmetered row
    // insertion. The mutation now anchors on a published row first, the way
    // `submitEnvironmentVote` anchors on an open round before it writes anything.
    const tables: Tables = {};
    const empty = {
      deviceKey: DEVICE_A,
      lastViewedEpisodeId: null,
      followedCharacterIds: [],
      followedArcIds: [],
    };
    expect(await submit(tables, empty)).toEqual({ accepted: false, code: 'PROGRESS_WORLD_UNKNOWN' });
    expect(tables.viewerProgress).toBeUndefined();
    expect(tables.viewerProgressCounters).toBeUndefined();

    // Ten invented worlds, ten refusals, zero rows and zero counters anywhere.
    for (let index = 0; index < 10; index += 1) {
      await writeHandler._handler(memoryCtx(tables), {
        worldId: `invented-world-${index}`,
        spoilerMode: 'publicOnly',
        ...empty,
      });
    }
    expect(tables.viewerProgress).toBeUndefined();
    expect(tables.viewerProgressCounters).toBeUndefined();
  });

  test('a real world whose published index is EMPTY is not treated as unknown', async () => {
    // The distinction the fix rests on. A world that has published an index with no episodes yet
    // is a real world: an empty submission is accepted and allocates its row. Collapsing this
    // into the `null` case would have made the repair a denial of service on new worlds.
    const tables: Tables = { publishedReadModels: [{ ...episodeIndexRow(), payload: {
      schemaVersion: 1, worldId: WORLD_ID, episodes: [], arcIds: [], characterIds: [],
    } }] };
    const result = await submit(tables, {
      deviceKey: DEVICE_A,
      lastViewedEpisodeId: null,
      followedCharacterIds: [],
      followedArcIds: [],
    });
    expect(result).toEqual({ accepted: true, code: null });
    expect(progressRows(tables)).toHaveLength(1);
  });

  test('a malformed device key is refused without allocating a row', async () => {
    // Digesting garbage yields a well-formed digest, so this would otherwise allocate a row keyed
    // on the digest of nonsense -- for a submission that can never succeed.
    const tables = seeded();
    const result = await submit(tables, { deviceKey: 'NOT A VALID KEY' });
    expect(result).toEqual({ accepted: false, code: 'PROGRESS_DEVICE_KEY_INVALID' });
    expect(tables.viewerProgress).toBeUndefined();
    expect(tables.viewerProgressCounters).toBeUndefined();
  });

  test('no refusal echoes a submitted value', async () => {
    const tables = seeded();
    const secret = 'char-a-value-the-caller-made-up';
    const result = await submit(tables, { deviceKey: DEVICE_A, followedCharacterIds: [secret] });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

describe('the read is a read', () => {
  test('reading progress writes nothing, even when no row exists', async () => {
    const tables = seeded();
    await read(tables, DEVICE_A);
    await read(tables, DEVICE_B);
    expect(tables.viewerProgress).toBeUndefined();
    expect(tables.viewerProgressCounters).toBeUndefined();
  });

  test('a malformed key is answered before any row is accessed', async () => {
    // The docblock claims this; without the check it was a comment describing a path that was not
    // there. A `db` whose every property access throws is what makes "before any row access" a
    // checkable fact rather than a description of intent.
    const exploding = { db: new Proxy({}, { get() { throw new Error('reached the database'); } }) };
    await expect(
      readHandler._handler(exploding as Parameters<typeof readHandler._handler>[0], {
        worldId: WORLD_ID,
        deviceKey: 'NOT A VALID KEY',
      }),
    ).resolves.toBeNull();
  });
});

describe('the increment-only counter is safe only while the table is never vacuumed', () => {
  test('viewerProgress is absent from TablesToVacuum', () => {
    // Nothing decrements `viewerProgressCounters`. That is safe today because `viewerProgress`
    // rows are never deleted; enable retention and the counter drifts monotonically up until the
    // world is permanently locked out with `PROGRESS_WORLD_FULL` while holding almost no rows.
    // Mirrors the identical guard `runtimeSnapshot.test.ts` keeps for two other excluded tables.
    const cron = readFileSync(join(process.cwd(), 'convex/crons.ts'), 'utf8');
    const list = cron
      .slice(cron.indexOf('const TablesToVacuum'), cron.indexOf('export const vacuumOldEntries'))
      // Comments stripped first: a prose mention of a table is the opposite of vacuuming it.
      .replace(/\/\/.*$/gm, '');
    expect(list).not.toContain('viewerProgress');
    expect(list).not.toContain('viewerProgressCounters');
  });
});
