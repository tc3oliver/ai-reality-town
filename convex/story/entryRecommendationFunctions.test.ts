/**
 * `reassessOne`'s `latestSequenceNumber` read is a single last row, not a table collect (ART-100).
 *
 * Only the single HIGHEST sequence number in `canonEvents` is ever used
 * (`reassessedAtSequenceNumber`), so the prior implementation's whole-log collect on
 * `by_world_and_sequence` bound only on `worldId` — just to read `canonRows[canonRows.length -
 * 1].sequenceNumber` — is replaced by `.order('desc').first()`: one row read, never the world's
 * whole event log.
 */

import { reassessArcEntryRecommendation } from './entryRecommendationFunctions';

const WORLD_ID = 'mistwood';
const ARC_ID = 'arc-mill';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const handler = reassessArcEntryRecommendation as unknown as Registered;

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
            Number(left.sequenceNumber ?? 0) - Number(right.sequenceNumber ?? 0));
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
  return { db } as Parameters<typeof handler._handler>[0];
}

/**
 * `memoryCtx`, plus recording of every `canonEvents` read: whether `.collect()` was ever called,
 * and every row count `.first()` resolved to. A regression back to a whole-table collect would
 * make `canonEventsCollected()` true — which is exactly what should turn the read-shape
 * assertion below red.
 */
function recordingCtx(tables: Tables) {
  let canonEventsCollected = false;
  let canonEventsFirstCalls = 0;
  const inner = memoryCtx(tables) as { db: Record<string, unknown> };
  type Chain = {
    order: (direction: 'asc' | 'desc') => Chain;
    take: (count: number) => Promise<Row[]>;
    collect: () => Promise<Row[]>;
    first: () => Promise<Row | null>;
    unique: () => Promise<Row | null>;
  };
  function wrap(chain: Chain): Chain {
    return {
      order: (direction) => wrap(chain.order(direction)),
      take: (count) => chain.take(count),
      collect: () => { canonEventsCollected = true; return chain.collect(); },
      first: () => { canonEventsFirstCalls += 1; return chain.first(); },
      unique: () => chain.unique(),
    };
  }
  const db = {
    ...inner.db,
    query(table: string) {
      const rawQuery = (inner.db.query as (t: string) => { withIndex: (i: string, b?: (q: unknown) => unknown) => Chain })(table);
      if (table !== 'canonEvents') return rawQuery;
      return { withIndex: (index: string, build?: (q: unknown) => unknown) => wrap(rawQuery.withIndex(index, build)) };
    },
  };
  return {
    ctx: { db } as Parameters<typeof handler._handler>[0],
    canonEventsCollected: () => canonEventsCollected,
    canonEventsFirstCalls: () => canonEventsFirstCalls,
  };
}

function canonRow(sequenceNumber: number): Row {
  return { worldId: WORLD_ID, sequenceNumber };
}

function portfolioEntry(): Row {
  return {
    worldId: WORLD_ID, arcId: ARC_ID,
    entry: {
      tier: 'major',
      projection: {
        schemaVersion: 1, worldId: WORLD_ID, arcId: ARC_ID,
        title: '磨坊停工', premise: '兩派因磨坊停工而對立。', currentQuestion: '審計會揭露什麼?',
        status: 'active', coreCharacterIds: [],
        incitingEventId: `${WORLD_ID}#event#0`, latestTurningPointEventId: null,
        essentialFactIds: [], unresolvedQuestions: [], resolvedQuestions: [],
        recommendedEntryEventId: null, heatScore: 50,
        lastProgressTime: { worldDay: 1, timeSlot: 'morning', sourceEventId: `${WORLD_ID}#event#0` },
        revision: 0,
      },
      sourceEventIds: [],
    },
  };
}

function episodeRow(): Row {
  return { worldId: WORLD_ID, worldDay: 1, episodeNumber: 1, episode: {}, sourceEventIds: [] };
}

function baseTables(over: Partial<Tables> = {}): Tables {
  return {
    canonEvents: [],
    storyArcPortfolioEntries: [portfolioEntry()],
    dailyEpisodes: [episodeRow()],
    storyArcRecommendedEntries: [],
    ...over,
  };
}

describe('reassessArcEntryRecommendation — latestSequenceNumber is a single last row (ART-100)', () => {
  it('reads the last canonEvents row by `.order("desc").first()`, never a table-wide collect', async () => {
    const canonEvents = Array.from({ length: 200 }, (_unused, sequenceNumber) => canonRow(sequenceNumber));
    const { ctx, canonEventsCollected, canonEventsFirstCalls } = recordingCtx(baseTables({ canonEvents }));
    const result = await handler._handler(ctx, { worldId: WORLD_ID, arcId: ARC_ID, now: 5_000 }) as {
      reassessed: boolean; reassessedAtSequenceNumber: number | null;
    };
    expect(result.reassessed).toBe(true);
    // The highest sequence number in a 200-row table (199), read without collecting the table.
    expect(result.reassessedAtSequenceNumber).toBe(199);
    expect(canonEventsCollected()).toBe(false);
    expect(canonEventsFirstCalls()).toBe(1);
  });

  it('reassesses to sequence number 0 for a world with no accepted events at all', async () => {
    const result = await handler._handler(memoryCtx(baseTables({ canonEvents: [] })), {
      worldId: WORLD_ID, arcId: ARC_ID, now: 5_000,
    }) as { reassessed: boolean; reassessedAtSequenceNumber: number | null };
    expect(result.reassessed).toBe(true);
    expect(result.reassessedAtSequenceNumber).toBe(0);
  });

  it('picks the true maximum sequence number, not merely the last-inserted row', async () => {
    const canonEvents = [canonRow(5), canonRow(50), canonRow(20)];
    const result = await handler._handler(memoryCtx(baseTables({ canonEvents })), {
      worldId: WORLD_ID, arcId: ARC_ID, now: 5_000,
    }) as { reassessedAtSequenceNumber: number | null };
    expect(result.reassessedAtSequenceNumber).toBe(50);
  });
});
