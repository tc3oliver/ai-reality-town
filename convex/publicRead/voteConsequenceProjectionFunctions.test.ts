/**
 * The consequence rebuild as it actually runs (FR-J002 / ART-46).
 *
 * Handler-level, following the pattern `episodeTimelineProjectionFunctions.test.ts` established:
 * the registered mutation's `_handler` runs against a fake `ctx`, so the six indexed reads, the
 * Scene → grouping-run → Director-plan walk, the ART-132 safety gate and the publish are
 * exercised as they run in production.
 *
 * Every assertion is made on the PUBLISHED PAYLOAD rather than on an intermediate value. The
 * whole point of a derived read model is that the published row is what a visitor sees, and only
 * the payload can show what was written down.
 */

import {
  rebuildVoteConsequenceProjection,
  refreshVoteConsequenceProjections,
} from './voteConsequenceProjectionFunctions';
import type { VoteConsequenceProjection } from './voteConsequenceProjection';

const WORLD_ID = 'mistwood';
const DAY = 7;
const DIRECTOR_RUN = 'director:mistwood:7:morning';
const GROUPING_RUN = 'grouping:mistwood:7:morning';
const SCENE = 'mistwood:7:morning:grouping:scene:1';
const WITHHELD_SCENE = 'mistwood:7:morning:grouping:scene:2';

const REFUSED_SUMMARY = 'POISONED: 一段安全分類器拒絕發佈的場景敘述。';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const handler = rebuildVoteConsequenceProjection as unknown as Registered;

/**
 * The slice of Convex these handlers use. Index constraints are `eq` chains, so filtering by the
 * captured constraints reproduces them — including the `worldId`-only PREFIX queries this
 * handler makes against the three simulation-run tables. `createdAt` ordering is modelled
 * because `readWithheldSceneLabels` reads the override ledger through it.
 */
function memoryCtx(tables: Tables) {
  const db = {
    query(table: string) {
      return {
        withIndex(_index: string, build?: (q: unknown) => unknown) {
          const constraints: Row = {};
          const rangeConstraints: Array<[string, number]> = [];
          const builder = {
            eq(field: string, value: unknown) {
              constraints[field] = value;
              return builder;
            },
            gte(field: string, value: number) {
              rangeConstraints.push([field, value]);
              return builder;
            },
          };
          if (build) build(builder);
          const matched = (tables[table] ?? []).filter((row) =>
            Object.entries(constraints).every(([field, value]) => row[field] === value)
            && rangeConstraints.every(([field, value]) => Number(row[field] ?? 0) >= value));
          const ascending = [...matched].sort((left, right) =>
            Number(left.sequenceNumber ?? left.createdAt ?? 0) - Number(right.sequenceNumber ?? right.createdAt ?? 0));
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

function canonRow(sequenceNumber: number, over: {
  idempotencyKey?: string;
  causedByEventIds?: string[];
  publicSummary?: string;
  sceneId?: string;
  worldDay?: number;
} = {}): Row {
  return {
    worldId: WORLD_ID,
    sequenceNumber,
    // Denormalized onto the row itself, exactly as `convex/canon/schema.ts` stores it — the fake
    // db's `by_world_and_day` index reads this column directly, not `payload.worldDay`.
    worldDay: over.worldDay ?? DAY,
    acceptedAt: 1_000 + sequenceNumber,
    validationVersion: '1',
    traceId: `trace-${sequenceNumber}`,
    payload: {
      schemaVersion: 1,
      worldId: WORLD_ID,
      idempotencyKey: over.idempotencyKey ?? `scene:${sequenceNumber}`,
      proposedBy: { type: 'system' },
      worldDay: over.worldDay ?? DAY,
      timeSlot: 'morning',
      eventType: 'conversation',
      participantIds: ['zhao-ming', 'he-jun'],
      causedByEventIds: over.causedByEventIds ?? [],
      publicSummary: over.publicSummary ?? `事件 ${sequenceNumber}`,
      stateChanges: [],
      ...(over.sceneId === undefined ? {} : { metadata: { sceneId: over.sceneId } }),
    },
  };
}

/** `deriveEventId` builds these from world + sequence; mirrored so assertions can name them. */
const id = (sequenceNumber: number) => `${WORLD_ID}#event#${sequenceNumber}`;

function classificationRow(sourceId: string, label: string): Row {
  return {
    policyVersion: 1, worldId: WORLD_ID, classificationId: `${sourceId}:simulation:safety`,
    sourceId, kind: 'scene', label, reasonCodes: [], warningCodes: [],
    classifiedTextHash: 'fnv1a32:deadbeef', createdAt: 1_000,
  };
}

/**
 * The pipeline chain the `uncertain` bucket rests on, persisted the way the simulation persists
 * it: a Director plan whose context lists the intervention, the grouping run that plan produced,
 * and the Scene runs that grouping produced.
 */
function planTables(viewerInterventionEventIds: string[], sceneIds: string[]): Partial<Tables> {
  return {
    directorPlans: [{
      schemaVersion: 1, worldId: WORLD_ID, directorRunId: DIRECTOR_RUN, worldDay: DAY,
      timeSlot: 'morning', createdAt: 1_000, plan: {},
      context: { schemaVersion: 1, directorRunId: DIRECTOR_RUN, viewerInterventionEventIds },
    }],
    groupedSceneRuns: [{
      schemaVersion: 1, worldId: WORLD_ID, groupingRunId: GROUPING_RUN,
      directorRunId: DIRECTOR_RUN, worldDay: DAY, timeSlot: 'morning',
      intentRunIds: [], result: {}, createdAt: 1_000,
    }],
    sceneSimulationRuns: sceneIds.map((sceneId, index) => ({
      schemaVersion: 1, worldId: WORLD_ID, simulationRunId: `sim:${index}`,
      groupingRunId: GROUPING_RUN, sceneId, status: 'validated', result: {}, createdAt: 1_000,
    })),
  };
}

function baseTables(over: Partial<Tables> = {}): Tables {
  return {
    canonEvents: [],
    environmentVoteInterventions: [],
    sceneSimulationRuns: [],
    groupedSceneRuns: [],
    directorPlans: [],
    postGenerationSafetyClassifications: [],
    safetyStatusOverrides: [],
    publishedReadModels: [],
    ...over,
  };
}

async function published(tables: Tables, targetWorldDay = DAY) {
  const result = await handler._handler(
    memoryCtx(tables),
    { worldId: WORLD_ID, targetWorldDay, now: 5_000 },
  ) as { modelRef: string; version: number; deduplicated: boolean };
  const row = (tables.publishedReadModels ?? []).at(-1);
  expect(row).toBeDefined();
  return { result, row: row!, payload: row!.payload as VoteConsequenceProjection };
}

/** The applied-intervention ledger row `markQueuedEnvironmentEventApplied` writes. */
function interventionRow(appliedEventId: string): Row {
  return {
    schemaVersion: 1, worldId: WORLD_ID, worldDay: DAY - 1, targetWorldDay: DAY,
    candidateId: 'power_outage', idempotencyKey: `vote:${WORLD_ID}:${DAY - 1}`, votes: 12,
    status: 'applied', appliedEventId, createdAt: 900, appliedAt: 1_000,
  };
}

describe('rebuildVoteConsequenceProjection — AC#1: the four buckets are published', () => {
  it('publishes the trigger, its direct effect and the events downstream of it', async () => {
    const { result, row, payload } = await published(baseTables({
      canonEvents: [
        canonRow(0),
        canonRow(1, { idempotencyKey: `vote:${WORLD_ID}:${DAY - 1}`, publicSummary: '全鎮停電。' }),
        canonRow(2, { causedByEventIds: [id(1)] }),
        canonRow(3, { causedByEventIds: [id(2)] }),
      ],
      environmentVoteInterventions: [interventionRow(id(1))],
    }));

    expect(result.modelRef).toBe(`voteConsequence:${WORLD_ID}:${DAY}`);
    expect(row.modelKind).toBe('voteConsequence');
    expect(row.status).toBe('published');
    expect(payload.trigger?.eventId).toBe(id(1));
    expect(payload.direct.map((node) => node.eventId)).toEqual([id(2)]);
    expect(payload.downstream.map((node) => node.eventId)).toEqual([id(3)]);
    expect(payload.explicitCausalEdgeCount).toBe(2);
    // The published row's own provenance is the payload's, so operations can audit the
    // projection against Canon without opening the payload.
    expect(row.sourceEventIds).toEqual([id(1), id(2), id(3)]);
  });

  it('resolves the uncertain bucket through the real Scene → grouping → Director-plan chain', async () => {
    const { payload } = await published(baseTables({
      canonEvents: [
        canonRow(1, { idempotencyKey: `vote:${WORLD_ID}:${DAY - 1}` }),
        canonRow(2, { sceneId: SCENE }),
      ],
      environmentVoteInterventions: [interventionRow(id(1))],
      ...planTables([id(1)], [SCENE]),
    }));
    expect(payload.uncertain.map((node) => node.eventId)).toEqual([id(2)]);
    expect(payload.uncertain[0].provenance.basis).toBe('director_plan_context');
  });

  it('contributes nothing when the Scene\'s grouping run was never persisted', async () => {
    // A partially-persisted run must not be able to manufacture a link.
    const { payload } = await published(baseTables({
      canonEvents: [
        canonRow(1, { idempotencyKey: `vote:${WORLD_ID}:${DAY - 1}` }),
        canonRow(2, { sceneId: SCENE }),
      ],
      ...planTables([id(1)], [SCENE]),
      groupedSceneRuns: [],
    }));
    expect(payload.uncertain).toEqual([]);
  });

  it('publishes an empty payload for a day with no viewer intervention', async () => {
    const { result, payload } = await published(baseTables({
      canonEvents: [canonRow(0), canonRow(1)],
    }));
    expect(payload.trigger).toBeNull();
    expect(payload.direct).toEqual([]);
    expect(payload.uncertain).toEqual([]);
    // The read still resolves, which is what lets the view state the emptiness.
    expect(result.modelRef).toBe(`voteConsequence:${WORLD_ID}:${DAY}`);
  });

  it('dedups an unchanged rebuild instead of churning a version', async () => {
    const tables = baseTables({
      canonEvents: [canonRow(1, { idempotencyKey: `vote:${WORLD_ID}:${DAY - 1}` })],
    });
    const first = await published(tables);
    const second = await published(tables);
    expect(first.result.deduplicated).toBe(false);
    expect(second.result.deduplicated).toBe(true);
    expect(second.result.version).toBe(first.result.version);
  });

  it('refuses an invalid target world day', async () => {
    await expect(handler._handler(memoryCtx(baseTables()), {
      worldId: WORLD_ID, targetWorldDay: -1, now: 5_000,
    })).rejects.toThrow(/VOTE_CONSEQUENCE_INVALID/);
  });
});

describe('rebuildVoteConsequenceProjection — AC#2: the honest shape of today\'s canon', () => {
  it('publishes zero causal links and a full uncertain bucket when no event carries an edge', async () => {
    /**
     * THE PRODUCTION SHAPE, end to end.
     *
     * Every event here has `causedByEventIds: []`, exactly as the live system commits them, and
     * two of them come from a Scene whose Director plan was told about the vote. The published
     * payload must claim no causality at all and report those two as unconfirmed. This test is
     * what fails if a later change starts inferring causal edges at rebuild time.
     */
    const { payload } = await published(baseTables({
      canonEvents: [
        canonRow(1, { idempotencyKey: `vote:${WORLD_ID}:${DAY - 1}`, publicSummary: '全鎮停電。' }),
        canonRow(2, { sceneId: SCENE }),
        canonRow(3, { sceneId: SCENE }),
        canonRow(4),
      ],
      environmentVoteInterventions: [interventionRow(id(1))],
      ...planTables([id(1)], [SCENE]),
    }));
    expect(payload.trigger?.eventId).toBe(id(1));
    expect(payload.direct).toEqual([]);
    expect(payload.downstream).toEqual([]);
    expect(payload.explicitCausalEdgeCount).toBe(0);
    expect(payload.uncertain.map((node) => node.eventId)).toEqual([id(2), id(3)]);
    // Event 4 belongs to no Scene the Director was told about, so it is in no bucket at all.
    expect(payload.sourceEventIds).not.toContain(id(4));
    expect(JSON.stringify(payload)).not.toContain('canon_caused_by');
  });
});

describe('rebuildVoteConsequenceProjection — the ART-132 safety gate (FR-P004)', () => {
  it('never writes the summary of an event whose Scene the classifier refused', async () => {
    const { payload } = await published(baseTables({
      canonEvents: [
        canonRow(1, { idempotencyKey: `vote:${WORLD_ID}:${DAY - 1}` }),
        canonRow(2, {
          causedByEventIds: [id(1)], sceneId: WITHHELD_SCENE, publicSummary: REFUSED_SUMMARY,
        }),
      ],
      environmentVoteInterventions: [interventionRow(id(1))],
      postGenerationSafetyClassifications: [classificationRow(WITHHELD_SCENE, 'withhold')],
    }));
    // The node SURVIVES and loses only its text: the causal structure is what this view is
    // about, and dropping the row would misreport the chain's length.
    expect(payload.direct).toHaveLength(1);
    expect(payload.direct[0].publicSummary).toBeNull();
    expect(payload.direct[0].publicationStatus).toBe('withheld');
    expect(JSON.stringify(payload)).not.toContain('POISONED');
  });

  it('does NOT redact an event with no resolvable Scene provenance', async () => {
    // ART-132's convention: silence means "never in scope", not "refused".
    const { payload } = await published(baseTables({
      canonEvents: [
        canonRow(1, { idempotencyKey: `vote:${WORLD_ID}:${DAY - 1}` }),
        canonRow(2, { causedByEventIds: [id(1)], publicSummary: '磨坊熄了燈。' }),
      ],
      postGenerationSafetyClassifications: [classificationRow(WITHHELD_SCENE, 'withhold')],
    }));
    expect(payload.direct[0].publicSummary).toBe('磨坊熄了燈。');
    expect(payload.direct[0].publicationStatus).toBe('published');
  });

  it('redacts by event id, so a refusal cannot be applied to its neighbour', async () => {
    const { payload } = await published(baseTables({
      canonEvents: [
        canonRow(1, { idempotencyKey: `vote:${WORLD_ID}:${DAY - 1}` }),
        canonRow(2, {
          causedByEventIds: [id(1)], sceneId: WITHHELD_SCENE, publicSummary: REFUSED_SUMMARY,
        }),
        canonRow(3, { causedByEventIds: [id(1)], sceneId: SCENE, publicSummary: '井邊的爭執。' }),
      ],
      postGenerationSafetyClassifications: [
        classificationRow(SCENE, 'allow'),
        classificationRow(WITHHELD_SCENE, 'withhold'),
      ],
    }));
    expect(payload.direct[0].publicSummary).toBeNull();
    expect(payload.direct[1].publicSummary).toBe('井邊的爭執。');
  });
});

/**
 * A `ctx` that also records which index — and which constraints — each `withIndex` call asked
 * for, so a test can pin the SHAPE of a read (e.g. "the suffix from sequence N", not just "some
 * canonEvents rows"). A regression to a whole-table `.collect()` can still produce the right
 * result on a small fixture; only this can tell the two apart.
 */
function recordingCtx(tables: Tables) {
  const reads: Array<{ table: string; index: string; constraints: Row }> = [];
  const inner = memoryCtx(tables) as { db: Record<string, unknown> };
  const db = {
    ...inner.db,
    query(table: string) {
      const chain = (inner.db.query as (t: string) => {
        withIndex: (i: string, b?: (q: unknown) => unknown) => unknown;
      })(table);
      return {
        withIndex(index: string, build?: (q: unknown) => unknown) {
          // A second, side-effect-free pass over the same builder shape, purely to observe
          // which constraints the handler actually asked for.
          const constraints: Row = {};
          const spy = {
            eq(field: string, value: unknown) { constraints[field] = value; return spy; },
            gte(field: string, value: unknown) { constraints[`${field}>=`] = value; return spy; },
          };
          if (build) build(spy);
          reads.push({ table, index, constraints });
          return chain.withIndex(index, build);
        },
      };
    },
  };
  return { ctx: { db } as Parameters<typeof handler._handler>[0], reads };
}

describe('rebuildVoteConsequenceProjection — the Director chain is read run-scoped, not collected', () => {
  /**
   * The chain tables carry the raw generation blobs and this mutation runs on every accepted
   * event, so a whole-table read here grew without bound. These two tests pin the SHAPE of the
   * reads, not just their result: a regression to `.collect()` on the world would still produce
   * the right buckets, and only an assertion about which index was asked can catch it.
   */
  it('walks directorPlans by day and the two run hops by run id', async () => {
    const { ctx, reads } = recordingCtx(baseTables({
      canonEvents: [canonRow(1, { idempotencyKey: `vote:${WORLD_ID}:${DAY - 1}` })],
      ...planTables([id(1)], [SCENE]),
    }));
    await handler._handler(ctx, { worldId: WORLD_ID, targetWorldDay: DAY, now: 5_000 });

    const indexFor = (table: string) => reads.filter((read) => read.table === table).map((read) => read.index);
    expect(indexFor('directorPlans')).toEqual(['by_world_day_and_slot', 'by_world_day_and_slot']);
    expect(indexFor('groupedSceneRuns')).toEqual(['by_director_run']);
    expect(indexFor('sceneSimulationRuns')).toEqual(['by_grouping_run']);
    // The world-wide indexes these used to be read on must not appear at all.
    expect(reads).not.toContainEqual({ table: 'directorPlans', index: 'by_world_and_run' });
    expect(reads).not.toContainEqual({ table: 'sceneSimulationRuns', index: 'by_scene' });
  });

  it('reads the lookahead day too, so a Scene planned after the vote is still seen', async () => {
    // The `uncertain` bucket rests on the Director's ten-event window, which outlives the day.
    // A day-8 Scene whose plan names the day-7 vote is a real link and must not be dropped.
    const nextDayScene = 'mistwood:8:morning:grouping:scene:9';
    const { payload } = await published(baseTables({
      canonEvents: [
        canonRow(1, { idempotencyKey: `vote:${WORLD_ID}:${DAY - 1}` }),
        canonRow(2, { sceneId: nextDayScene, worldDay: DAY + 1 }),
      ],
      directorPlans: [{
        schemaVersion: 1, worldId: WORLD_ID, directorRunId: 'director:next', worldDay: DAY + 1,
        timeSlot: 'morning', createdAt: 2_000, plan: {},
        context: { schemaVersion: 1, directorRunId: 'director:next', viewerInterventionEventIds: [id(1)] },
      }],
      groupedSceneRuns: [{
        schemaVersion: 1, worldId: WORLD_ID, groupingRunId: 'grouping:next',
        directorRunId: 'director:next', worldDay: DAY + 1, timeSlot: 'morning',
        intentRunIds: [], result: {}, createdAt: 2_000,
      }],
      sceneSimulationRuns: [{
        schemaVersion: 1, worldId: WORLD_ID, simulationRunId: 'sim:next',
        groupingRunId: 'grouping:next', sceneId: nextDayScene, status: 'validated',
        result: {}, createdAt: 2_000,
      }],
    }));
    expect(payload.uncertain.map((node) => node.eventId)).toEqual([id(2)]);
  });
});

describe('rebuildVoteConsequenceProjection — canonEvents is read in two bounded passes, not whole (ART-100)', () => {
  /**
   * These pin the SHAPE of the `canonEvents` reads, not just the resulting buckets: a regression
   * back to `by_world_and_sequence` bound only on `worldId` (the old whole-log collect) would
   * still produce the right payload on these small fixtures, and only an assertion about which
   * index — and which constraints — the handler asked for can catch it.
   */
  function canonIndexFor(reads: Array<{ table: string; index: string; constraints: Row }>) {
    return reads.filter((read) => read.table === 'canonEvents');
  }

  it('reads only the target day, on `by_world_and_day`, when the day has no trigger', async () => {
    const { ctx, reads } = recordingCtx(baseTables({
      canonEvents: [canonRow(0), canonRow(1)],
    }));
    await handler._handler(ctx, { worldId: WORLD_ID, targetWorldDay: DAY, now: 5_000 });

    const canonReads = canonIndexFor(reads);
    expect(canonReads).toEqual([
      { table: 'canonEvents', index: 'by_world_and_day', constraints: { worldId: WORLD_ID, worldDay: DAY } },
    ]);
    // No second pass at all — an empty payload references no event, so nothing further to read.
    expect(canonReads.some((read) => read.index === 'by_world_and_sequence')).toBe(false);
  });

  it('reads the day, then the suffix from the trigger\'s sequenceNumber — never the whole table', async () => {
    const { ctx, reads } = recordingCtx(baseTables({
      canonEvents: [
        canonRow(0),
        canonRow(1, { idempotencyKey: `vote:${WORLD_ID}:${DAY - 1}` }),
        canonRow(2, { causedByEventIds: [id(1)] }),
      ],
      environmentVoteInterventions: [interventionRow(id(1))],
    }));
    await handler._handler(ctx, { worldId: WORLD_ID, targetWorldDay: DAY, now: 5_000 });

    const canonReads = canonIndexFor(reads);
    expect(canonReads).toEqual([
      { table: 'canonEvents', index: 'by_world_and_day', constraints: { worldId: WORLD_ID, worldDay: DAY } },
      {
        table: 'canonEvents', index: 'by_world_and_sequence',
        constraints: { worldId: WORLD_ID, 'sequenceNumber>=': 1 },
      },
    ]);
    // The suffix bound is the TRIGGER's own sequence number (1), never 0 — a bound of 0 is what
    // an unconditional `by_world_and_sequence` collect on `worldId` alone would look like.
    expect(canonReads[1].constraints['sequenceNumber>=']).toBe(1);
  });

  it('produces byte-identical output whether or not events precede the trigger', async () => {
    // AC#3: the suffix read must change nothing about the published payload. Event 0 sits
    // BEFORE the trigger and is excluded from the bounded read; the assertions below are exactly
    // the ones the pre-ART-100 whole-log read satisfied.
    const { payload } = await published(baseTables({
      canonEvents: [
        canonRow(0, { publicSummary: '與投票無關的較早事件。' }),
        canonRow(1, { idempotencyKey: `vote:${WORLD_ID}:${DAY - 1}`, publicSummary: '全鎮停電。' }),
        canonRow(2, { causedByEventIds: [id(1)] }),
      ],
      environmentVoteInterventions: [interventionRow(id(1))],
    }));
    expect(payload.trigger?.eventId).toBe(id(1));
    expect(payload.direct.map((node) => node.eventId)).toEqual([id(2)]);
    expect(payload.explicitCausalEdgeCount).toBe(1);
    // Event 0 — before the trigger — appears in no bucket and is not part of the payload at all.
    expect(payload.sourceEventIds).not.toContain(id(0));
    expect(JSON.stringify(payload)).not.toContain('與投票無關');
  });
});

describe('refreshVoteConsequenceProjections — a withhold reaches every published day (FR-P004)', () => {
  it('rebuilds each day the world has published, dropping newly-withheld text', async () => {
    /**
     * The gap this closes: the override handler rebuilt only `liveState` and the onboarding
     * summary, so an operator withholding a day-7 Scene while the world ran on day 9 watched
     * the sentence vanish from the map while `voteConsequence:mistwood:7` kept serving it — and
     * nothing would ever have rebuilt that day again, because the pipeline only refreshes a
     * bounded trailing window around the day being committed.
     */
    const tables = baseTables({
      canonEvents: [
        canonRow(1, { idempotencyKey: `vote:${WORLD_ID}:${DAY - 1}` }),
        canonRow(2, {
          causedByEventIds: [id(1)], sceneId: WITHHELD_SCENE, publicSummary: REFUSED_SUMMARY,
        }),
      ],
    });
    // Day 7 is published while the Scene is still allowed...
    const before = await published(tables);
    expect(before.payload.direct[0].publicSummary).toBe(REFUSED_SUMMARY);

    // ...then an operator withholds it, and only the refresh runs — no new commit on day 7.
    tables.postGenerationSafetyClassifications = [classificationRow(WITHHELD_SCENE, 'withhold')];
    const refresh = refreshVoteConsequenceProjections as unknown as Registered;
    const result = await refresh._handler(
      memoryCtx(tables), { worldId: WORLD_ID, now: 9_000 },
    ) as { modelRefs: string[]; rebuiltDayCount: number };

    expect(result.rebuiltDayCount).toBe(1);
    expect(result.modelRefs).toEqual([`voteConsequence:${WORLD_ID}:${DAY}`]);
    const after = (tables.publishedReadModels ?? []).at(-1)!.payload as VoteConsequenceProjection;
    expect(after.direct[0].publicSummary).toBeNull();
    expect(after.direct[0].publicationStatus).toBe('withheld');
    expect(JSON.stringify(after)).not.toContain('POISONED');
  });

  it('does no work for a world that has published nothing', async () => {
    const refresh = refreshVoteConsequenceProjections as unknown as Registered;
    const result = await refresh._handler(
      memoryCtx(baseTables()), { worldId: WORLD_ID, now: 9_000 },
    ) as { rebuiltDayCount: number };
    expect(result.rebuiltDayCount).toBe(0);
  });
});
