/**
 * `validateReferences`' event-reference check reads only the fields' own ids (ART-100).
 *
 * `validateArcProjectionReferences` (`./projection.ts`) checks membership of exactly THREE
 * possible event ids — `incitingEventId`, `latestTurningPointEventId`, `recommendedEntryEventId`
 * — and no other event reference. The prior implementation collected the world's WHOLE
 * `canonEvents` table on `by_world_and_sequence` bound only on `worldId` to build the membership
 * set those three checks ran against. This file pins the bounded replacement: at most three point
 * lookups (`by_world_and_sequence` with BOTH `worldId` and `sequenceNumber`), never a scan of the
 * world's whole event log.
 */

import { initializeArcProjection } from './projectionFunctions';

const WORLD_ID = 'mistwood';
const ARC_ID = 'arc-mill';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const handler = initializeArcProjection as unknown as Registered;

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

function fields(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: '磨坊停工', premise: '兩派因磨坊停工而對立。', currentQuestion: '審計會揭露什麼?',
    coreCharacterIds: ['he-jun'], incitingEventId: eventId(3), latestTurningPointEventId: null,
    essentialFactIds: [], unresolvedQuestions: [], resolvedQuestions: [],
    recommendedEntryEventId: null, heatScore: 50,
    ...over,
  };
}

function baseTables(over: Partial<Tables> = {}): Tables {
  return {
    canonEvents: [],
    worldCharacters: [{ worldId: WORLD_ID, characterId: 'he-jun' }],
    storyArcLifecycles: [{ worldId: WORLD_ID, arcId: ARC_ID, status: 'emerging' }],
    storyArcProjectionEvents: [],
    ...over,
  };
}

function initArgs(sourceEventSequenceNumber: number, over: Record<string, unknown> = {}) {
  return {
    worldId: WORLD_ID, arcId: ARC_ID, fields: fields(over),
    sourceEventId: eventId(sourceEventSequenceNumber), sourceEventSequenceNumber,
  };
}

describe('validateReferences (via initializeArcProjection) — reads only the fields\' own ids (ART-100)', () => {
  it('does a point lookup per referenced event id — never a table-wide collect', async () => {
    const tables = baseTables({
      canonEvents: [...unrelatedCanonEvents(50), canonRow(3), canonRow(9)],
    });
    const { ctx, sequenceNumbersLookedUp, canonEventsCollected } = recordingCtx(tables);
    await handler._handler(ctx, initArgs(3, {
      incitingEventId: eventId(3), latestTurningPointEventId: eventId(9),
    }));
    // Point lookups happen for: the source-event existence check, plus the two referenced ids
    // (`incitingEventId`, `latestTurningPointEventId`) — `recommendedEntryEventId` is null here.
    expect([...sequenceNumbersLookedUp].sort((left, right) => left - right)).toEqual([3, 3, 9]);
    expect(canonEventsCollected()).toBe(false);
  });

  it('does zero reference lookups when every event field is null except the source event', async () => {
    const { ctx, sequenceNumbersLookedUp } = recordingCtx(baseTables({ canonEvents: [canonRow(3)] }));
    await handler._handler(ctx, initArgs(3, {
      incitingEventId: eventId(3), latestTurningPointEventId: null, recommendedEntryEventId: null,
    }));
    // One lookup for the source-event existence check, one for `incitingEventId` (required,
    // non-null — both happen to name sequence 3 here) — and no others, since the other two
    // reference fields are null.
    expect(sequenceNumbersLookedUp).toEqual([3, 3]);
  });

  it('accepts a projection whose references are all genuinely accepted events', async () => {
    const tables = baseTables({ canonEvents: [canonRow(3), canonRow(9), canonRow(12)] });
    const result = await handler._handler(memoryCtx(tables), initArgs(3, {
      incitingEventId: eventId(3), latestTurningPointEventId: eventId(9), recommendedEntryEventId: eventId(12),
    })) as { arcId: string; revision: number };
    expect(result).toEqual({ arcId: ARC_ID, revision: 0 });
  });

  it('refuses a reference to an event Canon never accepted', async () => {
    const tables = baseTables({ canonEvents: [canonRow(3)] });
    await expect(handler._handler(memoryCtx(tables), initArgs(3, {
      incitingEventId: eventId(3), latestTurningPointEventId: eventId(999),
    }))).rejects.toThrow(/ARC_PROJECTION_INVALID_SHAPE/);
  });
});
