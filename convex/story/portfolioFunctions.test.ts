/**
 * `admitArcToPortfolio`'s source-event validation reads only the candidate's own ids (ART-100).
 *
 * `candidate.sourceEventIds` is already the exact, bounded set of ids this check needs — the
 * prior implementation collected the world's WHOLE `canonEvents` table on `by_world_and_sequence`
 * bound only on `worldId`, built a membership Set from it, and threw away everything the
 * candidate didn't reference. This file pins the bounded replacement: one point lookup per
 * source event id (`by_world_and_sequence` with BOTH `worldId` and `sequenceNumber`), never a
 * scan of the world's whole event log.
 */

import { admitArcToPortfolio } from './portfolioFunctions';
import type { StoryArcProjectionData } from './model';

const WORLD_ID = 'mistwood';
const ARC_ID = 'arc-mill';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const handler = admitArcToPortfolio as unknown as Registered;

/** The event id `deriveEventId` builds for a sequence number. */
const eventId = (sequenceNumber: number) => `${WORLD_ID}#event#${sequenceNumber}`;

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
          const chain = (rows: Row[]) => ({
            order: (direction: 'asc' | 'desc') => chain(direction === 'desc' ? [...rows].reverse() : rows),
            take: (count: number) => Promise.resolve(rows.slice(0, count)),
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
  };
  return { db } as Parameters<typeof handler._handler>[0];
}

/**
 * `memoryCtx`, plus recording of every `canonEvents` point lookup (`.unique()`) and whether
 * `canonEvents` was ever `.collect()`-ed. A whole-table collect would leave
 * `sequenceNumbersLookedUp` empty — `.collect()` is never `.unique()` — which is exactly what
 * should turn the read-shape assertions below red.
 */
function recordingCtx(tables: Tables) {
  const sequenceNumbersLookedUp: number[] = [];
  let canonEventsCollected = false;
  const inner = memoryCtx(tables) as { db: Record<string, unknown> };
  type Chain = {
    order: (direction: 'asc' | 'desc') => Chain;
    take: (count: number) => Promise<Row[]>;
    collect: () => Promise<Row[]>;
    first: () => Promise<Row | null>;
    unique: () => Promise<Row | null>;
  };
  const db = {
    ...inner.db,
    query(table: string) {
      const rawQuery = (inner.db.query as (t: string) => {
        withIndex: (i: string, b?: (q: unknown) => unknown) => Chain;
      })(table);
      if (table !== 'canonEvents') return rawQuery;
      return {
        withIndex(index: string, build?: (q: unknown) => unknown) {
          const constraints: Row = {};
          const spy = { eq(field: string, value: unknown) { constraints[field] = value; return spy; } };
          if (build) build(spy);
          const chain = rawQuery.withIndex(index, build);
          return {
            ...chain,
            collect: () => { canonEventsCollected = true; return chain.collect(); },
            unique: () => {
              sequenceNumbersLookedUp.push(constraints.sequenceNumber as number);
              return chain.unique();
            },
          };
        },
      };
    },
  };
  return {
    ctx: { db } as Parameters<typeof handler._handler>[0],
    sequenceNumbersLookedUp,
    canonEventsCollected: () => canonEventsCollected,
  };
}

function canonRow(sequenceNumber: number): Row {
  return { worldId: WORLD_ID, sequenceNumber };
}

/** `count` unrelated canon rows, starting well clear of any id a test names explicitly. */
function unrelatedCanonEvents(count: number, startAt = 1_000): Row[] {
  return Array.from({ length: count }, (_unused, index) => canonRow(startAt + index));
}

function projection(over: Partial<StoryArcProjectionData> = {}): StoryArcProjectionData {
  return {
    schemaVersion: 1, worldId: WORLD_ID, arcId: ARC_ID,
    title: '磨坊停工', premise: '兩派因磨坊停工而對立。', currentQuestion: '審計會揭露什麼?',
    status: 'active', coreCharacterIds: ['he-jun', 'zhao-ming'],
    incitingEventId: eventId(0), latestTurningPointEventId: null,
    essentialFactIds: [], unresolvedQuestions: [], resolvedQuestions: [],
    recommendedEntryEventId: null, heatScore: 50,
    lastProgressTime: { worldDay: 1, timeSlot: 'morning', sourceEventId: eventId(0) },
    revision: 0,
    ...over,
  };
}

function candidate(sourceEventIds: unknown, over: Record<string, unknown> = {}): unknown {
  return {
    projection: projection(),
    tier: 'minor', priority: 10, published: false,
    sourceEventIds,
    ...over,
  };
}

function baseTables(over: Partial<Tables> = {}): Tables {
  return {
    canonEvents: [],
    storyArcPortfolioEntries: [],
    storyArcPortfolioDecisions: [],
    ...over,
  };
}

describe('admitArcToPortfolio — source-event validation reads only the candidate\'s own ids (ART-100)', () => {
  it('does one point lookup per source event id — never a table-wide collect', async () => {
    const tables = baseTables({
      canonEvents: [...unrelatedCanonEvents(50), canonRow(3), canonRow(7)],
    });
    const { ctx, sequenceNumbersLookedUp, canonEventsCollected } = recordingCtx(tables);
    await handler._handler(ctx, {
      worldId: WORLD_ID,
      candidate: candidate([eventId(3), eventId(7)]),
      remediation: { type: 'reject' },
      decidedAt: 5_000,
    });
    expect([...sequenceNumbersLookedUp].sort((left, right) => left - right)).toEqual([3, 7]);
    expect(canonEventsCollected()).toBe(false);
  });

  it('admits the arc when every source event is accepted', async () => {
    const tables = baseTables({ canonEvents: [canonRow(3), canonRow(7)] });
    const result = await handler._handler(memoryCtx(tables), {
      worldId: WORLD_ID,
      candidate: candidate([eventId(3), eventId(7)]),
      remediation: { type: 'reject' },
      decidedAt: 5_000,
    }) as { action: string; arcId: string };
    expect(result.action).toBe('accepted');
    expect(result.arcId).toBe(ARC_ID);
    expect((tables.storyArcPortfolioEntries ?? [])).toHaveLength(1);
  });

  it('refuses a candidate that cites an event Canon never accepted', async () => {
    const tables = baseTables({ canonEvents: [canonRow(3)] });
    await expect(handler._handler(memoryCtx(tables), {
      worldId: WORLD_ID,
      // Event 7 does not exist in `canonEvents` at all.
      candidate: candidate([eventId(3), eventId(7)]),
      remediation: { type: 'reject' },
      decidedAt: 5_000,
    })).rejects.toThrow(/ARC_PORTFOLIO_EVENT_NOT_ACCEPTED/);
  });

  it('refuses an id that parses to a real sequence number but was never actually derived from it', async () => {
    // `9` is an accepted sequence number in THIS world, but the id names a different world —
    // `deriveEventId` re-derivation, not bare row existence, is what must catch this.
    const tables = baseTables({ canonEvents: [canonRow(9)] });
    await expect(handler._handler(memoryCtx(tables), {
      worldId: WORLD_ID,
      candidate: candidate(['other-world#event#9']),
      remediation: { type: 'reject' },
      decidedAt: 5_000,
    })).rejects.toThrow(/ARC_PORTFOLIO_EVENT_NOT_ACCEPTED/);
  });

  it('refuses when sourceEventIds is not an array, and does zero canon reads', async () => {
    const { ctx, sequenceNumbersLookedUp } = recordingCtx(baseTables({ canonEvents: [canonRow(3)] }));
    await expect(handler._handler(ctx, {
      worldId: WORLD_ID,
      candidate: candidate('not-an-array'),
      remediation: { type: 'reject' },
      decidedAt: 5_000,
    })).rejects.toThrow(/ARC_PORTFOLIO_EVENT_NOT_ACCEPTED/);
    expect(sequenceNumbersLookedUp).toEqual([]);
  });

  it('does zero canon reads for a candidate with no source events', async () => {
    const { ctx, sequenceNumbersLookedUp } = recordingCtx(baseTables());
    const result = await handler._handler(ctx, {
      worldId: WORLD_ID,
      candidate: candidate([]),
      remediation: { type: 'reject' },
      decidedAt: 5_000,
    }) as { action: string };
    expect(result.action).toBe('accepted');
    expect(sequenceNumbersLookedUp).toEqual([]);
  });
});
