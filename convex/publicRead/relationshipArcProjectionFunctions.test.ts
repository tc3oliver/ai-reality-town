/**
 * `rebuildArcProjection`'s Canon read is bound to the arc's own events (ART-100).
 *
 * `storyArcEventClassifications` already names the exact, small set of sequence numbers that
 * belong to a given arc (`arcSourceSequences`) BEFORE any Canon row is read — the prior
 * implementation collected the world's WHOLE `canonEvents` table on `by_world_and_sequence`
 * bound only on `worldId`, then filtered it down to that same small set in JS. This file pins
 * the bounded replacement: one point lookup per known sequence number (`by_world_and_sequence`
 * with BOTH `worldId` and `sequenceNumber`), never a scan of the world's whole event log.
 *
 * Handler-level, following the pattern `voteConsequenceProjectionFunctions.test.ts` established:
 * the registered mutation's `_handler` runs against a fake `ctx` that also records which
 * `canonEvents` point lookups were actually made, so a regression back to a whole-table collect
 * — which would still produce the right payload on a small fixture — turns the read-shape
 * assertions red even before the payload assertions could catch it.
 */

import { rebuildArcProjection } from './relationshipArcProjectionFunctions';

const WORLD_ID = 'mistwood';
const ARC_ID = 'arc-mill';
const OTHER_ARC_ID = 'arc-harbor';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const handler = rebuildArcProjection as unknown as Registered;

/** The event id `rowToAcceptedEvent` derives for a sequence number. */
const eventId = (sequenceNumber: number) => `${WORLD_ID}#event#${sequenceNumber}`;

/**
 * The slice of Convex this handler uses. Index constraints are `eq` chains, so filtering by the
 * captured constraints reproduces them.
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
 * `canonEvents` was ever `.collect()`-ed at all. A whole-table collect would leave
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
          const spy = {
            eq(field: string, value: unknown) { constraints[field] = value; return spy; },
          };
          if (build) build(spy);
          const chain = rawQuery.withIndex(index, build);
          return {
            ...chain,
            collect: () => {
              canonEventsCollected = true;
              return chain.collect();
            },
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

function lifecycleRow(status = 'active'): Row {
  return { worldId: WORLD_ID, arcId: ARC_ID, status };
}

/** The COMPLETE `ArcProjectionFields` shape — `parseArcProjectionFields` rejects a partial one. */
function arcProjectionRow(revision: number, over: Record<string, unknown> = {}): Row {
  return {
    worldId: WORLD_ID,
    arcId: ARC_ID,
    revision,
    fields: {
      title: '磨坊停工',
      premise: '兩派因磨坊停工而對立。',
      currentQuestion: '審計會揭露什麼?',
      coreCharacterIds: ['he-jun', 'zhao-ming'],
      incitingEventId: eventId(0),
      latestTurningPointEventId: null,
      essentialFactIds: [],
      unresolvedQuestions: [],
      resolvedQuestions: [],
      recommendedEntryEventId: null,
      heatScore: 50,
      ...over,
    },
  };
}

function classificationRow(
  sequenceNumber: number,
  memberships: Array<{ arcId: string; importance: number }>,
): Row {
  return {
    worldId: WORLD_ID, sourceEventId: eventId(sequenceNumber),
    sourceEventSequenceNumber: sequenceNumber, memberships, newArc: null,
  };
}

function canonRow(sequenceNumber: number, fact?: { predicate: string; value: string }): Row {
  return {
    worldId: WORLD_ID,
    sequenceNumber,
    acceptedAt: 1_000 + sequenceNumber,
    validationVersion: '1',
    traceId: `trace-${sequenceNumber}`,
    payload: {
      schemaVersion: 1,
      worldId: WORLD_ID,
      idempotencyKey: `event-${sequenceNumber}`,
      proposedBy: { type: 'system' },
      worldDay: 1,
      timeSlot: 'morning',
      eventType: 'conversation',
      participantIds: ['zhao-ming', 'he-jun'],
      causedByEventIds: [],
      publicSummary: `事件 ${sequenceNumber}`,
      stateChanges: fact ? [{
        type: 'fact_created', visibility: 'public', subjectType: 'world', subjectId: WORLD_ID,
        factId: `fact-${sequenceNumber}`, predicate: fact.predicate, value: fact.value,
      }] : [],
    },
  };
}

/**
 * `count` unrelated canon events (no classification into `ARC_ID`), simulating a long world
 * history. Starts at `startAt` so a test can keep these clear of the specific sequence numbers
 * it classifies into the arc — two rows sharing a `sequenceNumber` would collide in the fake
 * `by_world_and_sequence` index exactly as they would in the real one.
 */
function unrelatedCanonEvents(count: number, startAt = 1_000): Row[] {
  return Array.from({ length: count }, (_unused, index) => canonRow(startAt + index));
}

function baseTables(over: Partial<Tables> = {}): Tables {
  return {
    storyArcLifecycles: [lifecycleRow()],
    storyArcProjectionEvents: [arcProjectionRow(0)],
    storyArcRecommendedEntries: [],
    dailyEpisodes: [],
    arcConsequenceSummaries: [],
    storyArcEventClassifications: [],
    canonEvents: [],
    publishedReadModels: [],
    ...over,
  };
}

async function publishedArc(tables: Tables) {
  const result = await handler._handler(
    memoryCtx(tables),
    { worldId: WORLD_ID, arcId: ARC_ID, now: 5_000 },
  ) as { modelRef: string; version: number; deduplicated: boolean };
  const row = (tables.publishedReadModels ?? []).at(-1);
  expect(row).toBeDefined();
  return { result, row: row!, payload: row!.payload as { knownClues: Array<{ predicate: string; sourceEventId: string }>; essentialBackstory: Array<{ predicate: string }> } };
}

describe('rebuildArcProjection — canonEvents reads only this arc\'s known source sequences (ART-100)', () => {
  it('does N point lookups, one per classified sequence — never a table-wide collect', async () => {
    const canonEvents = [
      ...unrelatedCanonEvents(50),
      canonRow(10, { predicate: '休戰', value: '磨坊前簽署' }),
      canonRow(25, { predicate: '賠償', value: '已支付' }),
      canonRow(40, { predicate: '審計', value: '已啟動' }),
    ];
    const tables = baseTables({
      canonEvents,
      storyArcEventClassifications: [
        classificationRow(10, [{ arcId: ARC_ID, importance: 5 }]),
        classificationRow(25, [{ arcId: ARC_ID, importance: 5 }]),
        classificationRow(40, [{ arcId: ARC_ID, importance: 5 }]),
        // Noise: classified, but into a DIFFERENT arc — must not be looked up for this rebuild.
        classificationRow(11, [{ arcId: OTHER_ARC_ID, importance: 5 }]),
        // Noise: an event this world's classifier never associated with any arc.
        classificationRow(12, []),
      ],
    });
    const { ctx, sequenceNumbersLookedUp, canonEventsCollected } = recordingCtx(tables);
    await handler._handler(ctx, { worldId: WORLD_ID, arcId: ARC_ID, now: 5_000 });

    expect([...sequenceNumbersLookedUp].sort((left, right) => left - right)).toEqual([10, 25, 40]);
    expect(canonEventsCollected()).toBe(false);
  });

  it('publishes the same facts, in sequence order, as the pre-ART-100 whole-log read would', async () => {
    // AC#3: the point-lookup read must change nothing about the published payload.
    const canonEvents = [
      ...unrelatedCanonEvents(20),
      canonRow(40, { predicate: '審計', value: '已啟動' }),
      canonRow(10, { predicate: '休戰', value: '磨坊前簽署' }),
      canonRow(25, { predicate: '賠償', value: '已支付' }),
    ];
    const { payload } = await publishedArc(baseTables({
      canonEvents,
      storyArcEventClassifications: [
        classificationRow(10, [{ arcId: ARC_ID, importance: 5 }]),
        classificationRow(25, [{ arcId: ARC_ID, importance: 5 }]),
        classificationRow(40, [{ arcId: ARC_ID, importance: 5 }]),
      ],
    }));
    // Sequence order (10, 25, 40), NOT insertion order into `canonEvents` or `Set` iteration
    // order over `arcSourceSequences` — both of which would have put 40 first here.
    expect(payload.knownClues.map((fact) => fact.predicate)).toEqual(['休戰', '賠償', '審計']);
    expect(payload.knownClues.map((fact) => fact.sourceEventId)).toEqual([eventId(10), eventId(25), eventId(40)]);
    expect(payload.essentialBackstory.map((fact) => fact.predicate)).toEqual(['休戰', '賠償', '審計']);
  });

  it('publishes an empty backstory, and does zero point lookups, when the arc has no classified events yet', async () => {
    const { ctx, sequenceNumbersLookedUp } = recordingCtx(baseTables({
      canonEvents: unrelatedCanonEvents(10),
    }));
    const result = await handler._handler(ctx, { worldId: WORLD_ID, arcId: ARC_ID, now: 5_000 }) as { modelRef: string };
    expect(result.modelRef).toBe(`arc:${ARC_ID}`);
    expect(sequenceNumbersLookedUp).toEqual([]);
  });
});
