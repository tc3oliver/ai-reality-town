/**
 * ART-100 Slice 0 — a document-read measurement harness for the post-commit pipeline.
 *
 * Nothing in this repo measures Convex document reads anywhere else: an exhaustive search for
 * `readBytes`/`docsRead`/`countReads`/`MiB` finds only prose comments (the ART-100 task
 * description, `postCommitLiveFunctions.ts`'s own `DEFAULT_MAX_POST_COMMIT_EVENTS` note, and a
 * few docs). `convex/operations/postCommitLiveFunctions.ts` — the file that drives PRD §12
 * stages 11-21 on every accepted event — has ZERO test coverage before this file.
 *
 * ## What this measures
 *
 * The REAL `runPostCommitPipeline` mutation (`postCommitLiveFunctions.ts`), run against an
 * in-memory `ctx` whose `db` is index-faithful (see `createMemoryDb` below) and whose
 * `runMutation` dispatches — by function name, via the SAME `internalFunctionRef` machinery the
 * production wiring uses — to the REAL registered handlers for every stage that fires with a
 * one-participant, no-state-change accepted event: the two ART-I005 projections, the episode
 * index/timeline/live/onboarding rebuilds, the vote-consequence and relationship-graph rebuilds,
 * arc-entry reassessment, arc-stagnation refresh, and incremental recap generation. All of them
 * read and write the SAME shared table set, so a rebuild's internal `ctx.db` calls — invisible
 * from the `PostCommitLivePort` interface — are counted exactly as Convex would count them.
 *
 * Stages that do not fire for this fixture (episode assembly, safety, publication-lifecycle
 * transitions, daily snapshot, share formats, arc classification/lifecycle/portfolio) are not
 * wired: a single participant and zero state changes keep the world day permanently
 * "incomplete" and the event under the arc-creation participant floor, so those stages take
 * their real, cheap no-op branches rather than needing a second copy of their own fixtures. If a
 * future change makes one of them fire anyway, `runMutation` throws
 * `UNDISPATCHED_MUTATION: <name>` rather than silently no-op'ing — see the dispatch table below.
 *
 * ## Why one measured run, not N runs
 *
 * AC#1 asks about the read cost of ONE post-commit run at a given canon size, not the cost of
 * reaching that size. Reaching it here is direct table seeding (no simulation, no real commits),
 * which is faithful because every rebuild this harness dispatches to reads `canonEvents` itself
 * — nothing about how the rows got there changes what a rebuild reads back.
 *
 * The one piece of pipeline state that top by real *history* rather than by canon size is the
 * recap cursor (`recapSnapshots`, read via `state.recapCursors` in `createConvexPostCommitLivePort`):
 * `generateIncrementalRecap` reads a bounded `[from, to]` window keyed off the PRIOR snapshot's
 * cursor, so an un-primed cursor makes the very first recap call re-read the whole day — an
 * artifact of this harness's shortcut, not of the production system, and not one that AC#1 is
 * about. `measurePostCommitReads` prices this out by priming both recap targets one event behind
 * the measured one via the real `generateIncrementalRecap` mutation (steady-state cursor), then
 * RESETS the read counters before the measured call. Everything counted past that point is the
 * one post-commit run.
 *
 * ## Index faithfulness (requirement, not decoration)
 *
 * `createMemoryDb` requires every read to go through `.withIndex(name, builder)` against a name
 * registered in `INDEX_REGISTRY` — a bare `.query(table).collect()` throws, and so does an
 * unregistered index name. `eq()` constraints must match a legal PREFIX of the index's declared
 * fields (in order); the field immediately after the eq-prefix may additionally carry one or more
 * range operators (`gt`/`gte`/`lt`/`lte`) — exactly what `recaps/functions.ts` does with
 * `by_world_and_sequence` + `gte`/`lte`. A query bound only on `worldId` therefore returns the
 * whole world's rows; one bound on `worldId` + `sequenceNumber` returns exactly one. Getting this
 * wrong is exactly the failure mode that would make the measurement worthless — a double that
 * ignored index bounds would silently full-scan and hide the very growth AC#1 is about.
 */

import { getFunctionName } from 'convex/server';

import { emptyProjection } from '../canon/model';
import { replayWorldEvents } from '../canon/replay';
import { rowToAcceptedEvent } from '../canon/serialize';
import { buildSnapshot } from '../canon/snapshots';
import { TIME_SLOTS } from '../canon/eventTypes';
import { rebuildWorldProjection, rebuildCharacterProjection } from '../publicRead/worldCharacterProjectionFunctions';
import { rebuildEpisodeIndexProjection } from '../publicRead/episodeIndexProjectionFunctions';
import { rebuildTimelineProjection } from '../publicRead/episodeTimelineProjectionFunctions';
import { rebuildLiveProjection } from '../publicRead/liveStateFunctions';
import { rebuildOnboardingSummary } from '../publicRead/onboardingSummaryFunctions';
import { rebuildVoteConsequenceProjection } from '../publicRead/voteConsequenceProjectionFunctions';
import { rebuildRelationshipGraphProjection } from '../publicRead/relationshipGraphProjectionFunctions';
import { rebuildViewerKnowledgeProjections } from '../publicRead/viewerKnowledgeProjectionFunctions';
import { reassessMajorActiveArcEntries } from '../story/entryRecommendationFunctions';
import { refreshArcStagnationPrompts } from '../story/resolutionFunctions';
import { generateIncrementalRecap } from '../recaps/functions';
import { runLiveWorldDayCycle, runPostCommitPipeline } from './postCommitLiveFunctions';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };

// ---------------------------------------------------------------------------
// Index-faithful in-memory `ctx.db`.
// ---------------------------------------------------------------------------

/** `[table]: { [indexName]: orderedFieldList }`, transcribed from each table's `schema.ts`. */
const INDEX_REGISTRY: Record<string, Record<string, readonly string[]>> = {
  /**
   * ART-91. The recap stage reads the world's degradation rung to decide whether rung 5 defers the
   * non-essential tiers. One indexed point read per run, which is why it is registered here rather
   * than excluded: this harness exists to catch reads that GROW, and a per-world point read does
   * not — but it must still be measured rather than invisible.
   */
  worldDegradationStates: {
    by_world_id: ['worldId'],
  },
  canonEvents: {
    by_world_and_sequence: ['worldId', 'sequenceNumber'],
    by_world_and_day: ['worldId', 'worldDay'],
    by_world_and_idempotency_key: ['worldId', 'idempotencyKey'],
  },
  // Read by `readProjectionViaSnapshot` (`convex/canon/snapshotReplay.ts`), which
  // `rebuildRelationshipGraphProjection` now resumes from instead of a full replay when a daily
  // snapshot exists. The single-day fixture never completes a world day, so it never has one and
  // legitimately falls back to the full-log path; the multi-day fixture seeds a real one via
  // `buildSnapshot` (see `seedDailySnapshot` below) to exercise the resumed path too.
  canonSnapshots: { by_world_and_sequence: ['worldId', 'lastSequenceNumber'] },
  worldSchedules: { by_world_id: ['worldId'] },
  storyArcLifecycles: {
    by_world_and_arc: ['worldId', 'arcId'],
    by_world_and_status: ['worldId', 'status'],
  },
  storyArcProjectionEvents: {
    by_world_arc_and_revision: ['worldId', 'arcId', 'revision'],
    by_world_and_source_event: ['worldId', 'sourceEventSequenceNumber'],
  },
  storyArcLifecycleTransitions: {
    by_world_arc_and_revision: ['worldId', 'arcId', 'revision'],
    by_source_event: ['worldId', 'sourceEventSequenceNumber'],
  },
  storyArcPortfolioEntries: { by_world_and_arc: ['worldId', 'arcId'] },
  storyArcRecommendedEntries: {
    by_world_and_arc: ['worldId', 'arcId'],
    by_world: ['worldId'],
  },
  storyArcEventClassifications: {
    by_world_and_source_event: ['worldId', 'sourceEventSequenceNumber'],
    by_world: ['worldId'],
  },
  storyArcStagnationPrompts: {
    by_world_and_prompt: ['worldId', 'promptId'],
    by_world_and_day: ['worldId', 'detectedAtWorldDay'],
  },
  worldCharacters: {
    by_world_id: ['worldId'],
    by_world_and_character: ['worldId', 'characterId'],
  },
  // ART-169: the seeded secrets the viewer-knowledge rebuild joins against. World-scoped and
  // bounded by the world config, but registered here like any other so a rebuild that started
  // reading it per event would show up in the per-table breakdown rather than hiding.
  worldSecrets: {
    by_world_id: ['worldId'],
    by_world_and_secret: ['worldId', 'secretId'],
  },
  dailyEpisodes: {
    by_world_and_day: ['worldId', 'worldDay'],
    by_world_and_episode: ['worldId', 'episodeNumber'],
    by_world_status_and_day: ['worldId', 'status', 'worldDay'],
  },
  // ART-100: `rebuildLiveProjection`'s resume point and its scene index. Registered here so the
  // harness counts their reads like any other — a checkpoint that quietly cost more than the
  // replay it replaced would otherwise be invisible.
  liveRebuildCheckpoints: { by_world: ['worldId'] },
  replaySceneCandidates: {
    by_world_and_scene: ['worldId', 'sceneId'],
    by_world_and_rank: ['worldId', 'score', 'maxSequenceNumber'],
    by_world_and_sequence: ['worldId', 'maxSequenceNumber'],
  },
  recapSnapshots: {
    by_snapshot_id: ['snapshotId'],
    by_target_and_version: ['worldId', 'recapType', 'targetId', 'version'],
    by_target_and_time: ['worldId', 'recapType', 'targetId', 'generatedAt'],
  },
  publishedReadModels: {
    by_current: ['worldId', 'modelKind', 'modelRef', 'isCurrent'],
    by_target_and_version: ['worldId', 'modelKind', 'modelRef', 'version'],
    by_status: ['worldId', 'modelKind', 'status'],
    by_lkg: ['worldId', 'modelKind', 'modelRef', 'isLastKnownGood'],
  },
  publicationRecords: {
    by_world_and_content: ['worldId', 'contentRef'],
    by_current: ['worldId', 'contentRef', 'isCurrent'],
    by_world_and_status: ['worldId', 'status'],
  },
  dynamicViewControls: { by_world_and_created: ['worldId', 'createdAt'] },
  postGenerationSafetyClassifications: {
    by_world_and_classification: ['worldId', 'classificationId'],
    by_world_and_label: ['worldId', 'label'],
    by_world_and_source: ['worldId', 'sourceId'],
  },
  safetyStatusOverrides: { by_world_source_and_created: ['worldId', 'sourceId', 'createdAt'] },
  environmentVoteInterventions: {
    by_world_and_target_day: ['worldId', 'targetWorldDay', 'status'],
    by_idempotency_key: ['idempotencyKey'],
  },
  directorPlans: {
    by_world_and_run: ['worldId', 'directorRunId'],
    by_world_day_and_slot: ['worldId', 'worldDay', 'timeSlot'],
  },
  groupedSceneRuns: {
    by_world_and_run: ['worldId', 'groupingRunId'],
    by_director_run: ['worldId', 'directorRunId'],
  },
  sceneSimulationRuns: {
    by_world_and_run: ['worldId', 'simulationRunId'],
    by_grouping_run: ['worldId', 'groupingRunId'],
    by_scene: ['worldId', 'sceneId'],
  },
  postCommitRuns: {
    by_run_id: ['runId'],
    by_world_and_sequence: ['worldId', 'sourceEventSequenceNumber'],
  },
  // ART-100: the maintained day list and the cycle's settled-through cursor.
  worldDayLedgers: { by_world: ['worldId'] },
  postCommitCursors: { by_world: ['worldId'] },
  postCommitCheckpoints: {
    by_run_and_stage: ['runId', 'stage'],
    by_run_stage_attempt: ['runId', 'stage', 'attempt'],
  },
};

/** Every table the harness's dispatched handlers can touch, pre-seeded empty. */
function emptyTables(): Tables {
  return Object.fromEntries(Object.keys(INDEX_REGISTRY).map((table) => [table, [] as Row[]]));
}

type ReadStats = { docsRead: number; byTable: Record<string, number>; byIndex: Record<string, number> };
const freshReadStats = (): ReadStats => ({ docsRead: 0, byTable: {}, byIndex: {} });

function recordRead(stats: ReadStats, table: string, indexName: string, count: number): void {
  if (count === 0) return;
  stats.docsRead += count;
  stats.byTable[table] = (stats.byTable[table] ?? 0) + count;
  const key = `${table}:${indexName}`;
  stats.byIndex[key] = (stats.byIndex[key] ?? 0) + count;
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

type ConstraintOp = 'eq' | 'gt' | 'gte' | 'lt' | 'lte';
type Constraint = { field: string; op: ConstraintOp; value: unknown };

/**
 * An in-memory `ctx.db` double that enforces real Convex index semantics closely enough to make
 * the read count trustworthy: index name must be registered, `eq()` constraints must cover a
 * legal prefix of the index's fields in order, and at most the next field may additionally carry
 * range operators. Every `.collect()`/`.take()`/`.first()`/`.unique()` call — the only places rows
 * actually leave the store — increments `stats`.
 */
function createMemoryDb(tables: Tables, stats: ReadStats) {
  function query(table: string) {
    const unbound = (): never => {
      throw new Error(`'${table}': a query must call .withIndex(...) before a terminal read — bare scans are not modelled`);
    };
    return {
      withIndex(indexName: string, build?: (builder: unknown) => unknown) {
        const declaredIndexes = INDEX_REGISTRY[table];
        const fields = declaredIndexes?.[indexName];
        if (!fields) {
          throw new Error(`unknown index '${indexName}' on table '${table}' — register its fields in INDEX_REGISTRY`);
        }

        const constraints: Constraint[] = [];
        const builder = {
          eq(field: string, value: unknown) { constraints.push({ field, op: 'eq', value }); return builder; },
          gt(field: string, value: unknown) { constraints.push({ field, op: 'gt', value }); return builder; },
          gte(field: string, value: unknown) { constraints.push({ field, op: 'gte', value }); return builder; },
          lt(field: string, value: unknown) { constraints.push({ field, op: 'lt', value }); return builder; },
          lte(field: string, value: unknown) { constraints.push({ field, op: 'lte', value }); return builder; },
        };
        if (build) build(builder);

        let position = 0;
        let rangeField: string | null = null;
        for (const constraint of constraints) {
          if (constraint.op === 'eq') {
            if (rangeField !== null) {
              throw new Error(`'${table}.${indexName}': an eq() constraint cannot follow a range constraint`);
            }
            if (fields[position] !== constraint.field) {
              throw new Error(
                `'${table}.${indexName}': expected eq('${fields[position]}', ...) at position ${position}, got '${constraint.field}'`,
              );
            }
            position += 1;
          } else {
            const expected = fields[position];
            if (rangeField === null) rangeField = expected;
            if (constraint.field !== rangeField) {
              throw new Error(`'${table}.${indexName}': range constraint must target '${rangeField}', got '${constraint.field}'`);
            }
          }
        }

        const matched = (tables[table] ?? []).filter((row) => constraints.every((constraint) => {
          const value = row[constraint.field];
          switch (constraint.op) {
            case 'eq': return value === constraint.value;
            case 'gt': return compareValues(value, constraint.value) > 0;
            case 'gte': return compareValues(value, constraint.value) >= 0;
            case 'lt': return compareValues(value, constraint.value) < 0;
            case 'lte': return compareValues(value, constraint.value) <= 0;
            default: return false;
          }
        }));
        const ascending = [...matched].sort((left, right) => {
          for (const field of fields) {
            const delta = compareValues(left[field], right[field]);
            if (delta !== 0) return delta;
          }
          return 0;
        });

        const chain = (rows: Row[]): Row[] & Record<string, unknown> => Object.assign(rows, {
          order(direction: 'asc' | 'desc') {
            return chain(direction === 'desc' ? [...rows].reverse() : rows);
          },
          collect() {
            recordRead(stats, table, indexName, rows.length);
            return Promise.resolve(rows);
          },
          take(count: number) {
            const taken = rows.slice(0, count);
            recordRead(stats, table, indexName, taken.length);
            return Promise.resolve(taken);
          },
          first() {
            const row = rows[0] ?? null;
            recordRead(stats, table, indexName, row ? 1 : 0);
            return Promise.resolve(row);
          },
          unique() {
            if (rows.length > 1) throw new Error(`'${table}.${indexName}': unique() matched ${rows.length} rows`);
            const row = rows[0] ?? null;
            recordRead(stats, table, indexName, row ? 1 : 0);
            return Promise.resolve(row);
          },
        }) as unknown as Row[] & Record<string, unknown>;
        return chain(ascending);
      },
      collect: unbound, take: unbound, first: unbound, unique: unbound,
    };
  }

  return {
    query,
    insert(table: string, row: Row) {
      const list = (tables[table] ??= []);
      const _id = `${table}:${list.length}`;
      list.push({ ...row, _id });
      return Promise.resolve(_id);
    },
    patch(id: string, patch: Row) {
      for (const rows of Object.values(tables)) {
        const row = rows.find((candidate) => candidate._id === id);
        if (row) { Object.assign(row, patch); return Promise.resolve(undefined); }
      }
      throw new Error(`patch target not found: ${String(id)}`);
    },
    delete(id: string) {
      for (const rows of Object.values(tables)) {
        const index = rows.findIndex((candidate) => candidate._id === id);
        if (index >= 0) { rows.splice(index, 1); return Promise.resolve(undefined); }
      }
      throw new Error(`delete target not found: ${String(id)}`);
    },
  };
}

// ---------------------------------------------------------------------------
// `ctx.runMutation` dispatch to the REAL handlers, over the SAME table set.
// ---------------------------------------------------------------------------

function makeCtx(tables: Tables, stats: ReadStats) {
  const db = createMemoryDb(tables, stats);
  const dispatch: Record<string, Registered> = {
    'publicRead/worldCharacterProjectionFunctions:rebuildWorldProjection': rebuildWorldProjection as unknown as Registered,
    'publicRead/worldCharacterProjectionFunctions:rebuildCharacterProjection': rebuildCharacterProjection as unknown as Registered,
    'publicRead/episodeIndexProjectionFunctions:rebuildEpisodeIndexProjection': rebuildEpisodeIndexProjection as unknown as Registered,
    'publicRead/episodeTimelineProjectionFunctions:rebuildTimelineProjection': rebuildTimelineProjection as unknown as Registered,
    'publicRead/liveStateFunctions:rebuildLiveProjection': rebuildLiveProjection as unknown as Registered,
    'publicRead/onboardingSummaryFunctions:rebuildOnboardingSummary': rebuildOnboardingSummary as unknown as Registered,
    'publicRead/voteConsequenceProjectionFunctions:rebuildVoteConsequenceProjection': rebuildVoteConsequenceProjection as unknown as Registered,
    'publicRead/relationshipGraphProjectionFunctions:rebuildRelationshipGraphProjection': rebuildRelationshipGraphProjection as unknown as Registered,
    'publicRead/viewerKnowledgeProjectionFunctions:rebuildViewerKnowledgeProjections': rebuildViewerKnowledgeProjections as unknown as Registered,
    'story/entryRecommendationFunctions:reassessMajorActiveArcEntries': reassessMajorActiveArcEntries as unknown as Registered,
    'story/resolutionFunctions:refreshArcStagnationPrompts': refreshArcStagnationPrompts as unknown as Registered,
    'recaps/functions:generateIncrementalRecap': generateIncrementalRecap as unknown as Registered,
    /**
     * STUBBED, and the only stub in this table. `runQueuedWorldDaySlot` is PRD §12 stages 1–10 —
     * a Director plan, scene authoring through a provider port, and a Canon commit. AC#2 is about
     * what the cycle does with events that are ALREADY accepted, so the fixture seeds them
     * directly and this returns "no slot was due", which is a real branch of the live cycle (it is
     * what happens whenever the schedule has nothing queued) rather than an invented one.
     */
    'simulation/worldDayLiveFunctions:runQueuedWorldDaySlot': {
      _handler: (_ctx: unknown, args: unknown) =>
        Promise.resolve({ worldId: (args as { worldId: string }).worldId, executed: 0, slots: [] }),
    } as unknown as Registered,
  };
  const ctx = {
    db,
    runMutation: (ref: unknown, args: unknown) => {
      const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
      const handler = dispatch[name];
      if (!handler) {
        throw new Error(`UNDISPATCHED_MUTATION in the read-measurement harness: '${name}'. `
          + 'A stage that used to no-op for this fixture now calls a capability the harness does '
          + 'not wire up — add it to the dispatch table in postCommitLiveFunctions.readMeasurement.test.ts.');
      }
      return handler._handler(ctx, args);
    },
  };
  return ctx;
}

// ---------------------------------------------------------------------------
// Fixture: a one-participant, zero-state-change accepted event.
// ---------------------------------------------------------------------------

/** The world's final time slot — a completed day needs one event carrying it (see below). */
const LAST_TIME_SLOT = TIME_SLOTS[TIME_SLOTS.length - 1];

/**
 * Deliberately inert: one participant (below `NEW_ARC_MIN_PARTICIPANTS`, so stage 15 never
 * classifies an arc), no state changes (so stage 14 has no relationship pair and no fact touches
 * a character), and no `publicSummary` (so `rebuildOnboardingSummary`'s tail scan never finds a
 * showable major event — see the AC#1 comment on why that confound is independent of day count
 * and survives in every fixture variant below). This isolates exactly the reads AC#1 is about:
 * the unconditional projection rebuilds every post-commit run performs regardless of what the
 * event contains.
 */
function canonRow(worldId: string, sequenceNumber: number, worldDay: number, timeSlot: string): Row {
  const payload = {
    schemaVersion: 1,
    worldId,
    idempotencyKey: `event:${worldId}:${sequenceNumber}`,
    proposedBy: { type: 'system' },
    worldDay,
    timeSlot,
    eventType: 'conversation',
    participantIds: ['char-1'],
    causedByEventIds: [] as string[],
    stateChanges: [] as unknown[],
  };
  return {
    worldId, sequenceNumber, schemaVersion: 1, eventType: 'conversation', worldDay, timeSlot,
    participantIds: ['char-1'], causedByEventIds: [],
    payload, validationVersion: '1', idempotencyKey: payload.idempotencyKey,
    traceId: `trace-${sequenceNumber}`, acceptedAt: 1_000 + sequenceNumber,
  };
}

/**
 * A `dailyEpisodes` row for a day this harness marks completed, so stage 16 (`episode`) sees the
 * day already covered and takes its real no-op branch instead of calling the undispatched
 * `generateAcceptedEventEpisode` (Director-plan/scene-chain machinery this slice is not about).
 * `status: 'withheld'` with no `episode` field mirrors `dailyEpisodes.test`'s "blocks a withheld
 * Episode and stores no copy" fixture shape: every dispatched rebuild that reads `dailyEpisodes`
 * filters on `row.episode` being truthy, so this row is inert everywhere except
 * `episodeWorldDays`, which is exactly what it needs to be for.
 */
function withheldEpisodeRow(worldId: string, worldDay: number, now: number): Row {
  return {
    worldId, worldDay, schemaVersion: 1, episodeNumber: worldDay + 1, status: 'withheld',
    sourceEventIds: [] as string[], createdAt: now,
  };
}

/**
 * Build a real daily snapshot, the way stage 20 (`persistDailySnapshot`) would have built one at
 * the end of `lastCompletedDay` — via `buildSnapshot`, never hand-rolled, because
 * `replayFromSnapshot` runs `validateSnapshot`, which recomputes `projectionHash` from the
 * projection and rejects an invented one.
 *
 * BASELINE CHOICE: this harness's fixture worlds are never seeded through `importWorld` (no
 * `initial` canonSnapshots row), so their daily snapshot's baseline IS `emptyProjection` and this
 * substitution is EXACT — the simpler of the two cases `snapshotReplay.ts`'s module header
 * describes, and the same one `relationshipGraphProjectionFunctions.test.ts`'s `snapshotRow`
 * helper uses. A SEEDED world's daily snapshot resumes from the seed's non-empty baseline instead
 * (`convex/canon/worldConfig.ts:305-321`, pinned by `canon/snapshotReplay.test.ts`), which would
 * make `buildSnapshot(replayWorldEvents(emptyProjection(...), ...))` the WRONG snapshot to seed —
 * not applicable here, but load-bearing enough to flag explicitly per the reviewer's note.
 */
function seedDailySnapshot(tables: Tables, worldId: string, eventsThroughLastCompletedDay: readonly Row[], lastCompletedDay: number, createdAt: number): void {
  const acceptedEvents = eventsThroughLastCompletedDay.map((row) => rowToAcceptedEvent(row as Parameters<typeof rowToAcceptedEvent>[0]));
  const projection = replayWorldEvents(emptyProjection(worldId), acceptedEvents);
  const snapshot = buildSnapshot(projection, createdAt, lastCompletedDay);
  tables.canonSnapshots.push({ ...snapshot, kind: 'daily' });
}

// ---------------------------------------------------------------------------
// The measurement.
// ---------------------------------------------------------------------------

type Measurement = { docsRead: number; byTable: Record<string, number>; byIndex: Record<string, number> };

/**
 * Seed `eventCount` accepted events, prime the recap cursor to steady state (see module header),
 * then run ONE real `runPostCommitPipeline` for the newest event and report its reads alone.
 */
async function measurePostCommitReads(eventCount: number): Promise<Measurement> {
  const worldId = `measure-${eventCount}`;
  const now = 10_000_000;
  const tables = emptyTables();
  for (let sequenceNumber = 0; sequenceNumber < eventCount; sequenceNumber += 1) {
    tables.canonEvents.push(canonRow(worldId, sequenceNumber, 0, 'morning'));
  }

  const stats = freshReadStats();
  const ctx = makeCtx(tables, stats);

  if (eventCount >= 2) {
    const catchUpTo = eventCount - 2;
    const recapArgs = { worldId, mode: 'incremental' as const, fromSequenceNumber: 0, toSequenceNumber: catchUpTo, generatedAt: now };
    await (generateIncrementalRecap as unknown as Registered)._handler(ctx, {
      ...recapArgs, snapshotId: `setup:${worldId}:episode:day:0`, recapType: 'episode', targetId: 'day:0',
    });
    await (generateIncrementalRecap as unknown as Registered)._handler(ctx, {
      ...recapArgs, snapshotId: `setup:${worldId}:viewer_context:${worldId}`, recapType: 'viewer_context', targetId: worldId,
    });
  }

  // Setup above is steady-state priming, not the run AC#1 is about — only reads from here count.
  stats.docsRead = 0;
  stats.byTable = {};
  stats.byIndex = {};

  const outcome = await (runPostCommitPipeline as unknown as Registered)._handler(ctx, {
    worldId, sourceEventSequenceNumber: eventCount - 1, now,
  }) as { status: string; failureStage?: string; errorCode?: string; errorMessage?: string };

  if (outcome.status !== 'completed') {
    throw new Error(
      `post-commit pipeline did not complete at N=${eventCount}: status=${outcome.status} `
      + `stage=${outcome.failureStage} ${outcome.errorCode ?? ''} ${outcome.errorMessage ?? ''}`,
    );
  }

  return { docsRead: stats.docsRead, byTable: { ...stats.byTable }, byIndex: { ...stats.byIndex } };
}

type MultiDayOptions = {
  /** Prior, finished world days — each gets a `dailyEpisodes` row so stage 16 skips it. */
  completedDays: number;
  eventsPerCompletedDay: number;
  /** Events on the current, still-open day, ending with the measured event. Held CONSTANT across
   * scale points in the tests below — day-scoped and snapshot-tail reads should not move with it. */
  currentDayEventCount: number;
  /** Seed a real daily snapshot (via `seedDailySnapshot`) at the end of the last completed day. */
  withSnapshot: boolean;
};

/**
 * The multi-day counterpart to `measurePostCommitReads`. Where the single-day fixture keeps
 * every event on world day 0 (so it can never trigger episode assembly or a daily snapshot, but
 * also so a "day-scoped" read and a "whole-log" read coincide — see the AC#1 comment), this
 * fixture spreads events over `completedDays` finished days plus a constant-size open day, which:
 *
 *   - gives `rebuildVoteConsequenceProjection`'s Phase 1 `by_world_and_day` read a genuinely
 *     bounded window (one day's rows, not the world's), and
 *   - lets `withSnapshot: true` seed a real daily snapshot at the boundary, so
 *     `rebuildRelationshipGraphProjection` takes its `readProjectionViaSnapshot`-resumed path
 *     instead of always falling back to a full replay.
 *
 * What this DOES drag in that the single-day fixture avoids: completed days need a `dailyEpisodes`
 * row apiece (`withheldEpisodeRow`) so stage 16 (`episode`) does not try to call the undispatched
 * `generateAcceptedEventEpisode` — real Director-plan/scene-chain/safety-classification machinery
 * this slice is not measuring. That is the ONLY extra machinery: the measured day is still never
 * the world's last slot, so stage 20 (`snapshot`) still never fires on the measured run itself
 * (`persistDailySnapshot` stays undispatched; a snapshot for the WITH-snapshot case is inserted
 * directly, matching what stage 20 would have written on a PRIOR day, not run as a mutation here).
 *
 * What this does NOT fix: `rebuildOnboardingSummary`'s doubling tail-scan is keyed on whether a
 * showable major event / three facts are ever found, not on day count — this fixture's events
 * still carry neither (see `canonRow`'s docblock), so onboarding still degrades to its ~2x-collect
 * worst case here exactly as it does in the single-day fixture. Reported as a number below, not
 * silently designed away.
 */
async function measureMultiDay(options: MultiDayOptions): Promise<Measurement & { totalEvents: number }> {
  const { completedDays, eventsPerCompletedDay, currentDayEventCount, withSnapshot } = options;
  const worldId = `multiday-${completedDays}x${eventsPerCompletedDay}+${currentDayEventCount}-${withSnapshot ? 'snap' : 'nosnap'}`;
  const now = 10_000_000;
  const tables = emptyTables();

  const events: Row[] = [];
  let sequenceNumber = 0;
  for (let day = 0; day < completedDays; day += 1) {
    for (let index = 0; index < eventsPerCompletedDay; index += 1) {
      const timeSlot = index === eventsPerCompletedDay - 1 ? LAST_TIME_SLOT : 'morning';
      events.push(canonRow(worldId, sequenceNumber, day, timeSlot));
      sequenceNumber += 1;
    }
    tables.dailyEpisodes.push(withheldEpisodeRow(worldId, day, now));
  }
  const currentDay = completedDays;
  const currentDayFirstSequenceNumber = sequenceNumber;
  for (let index = 0; index < currentDayEventCount; index += 1) {
    events.push(canonRow(worldId, sequenceNumber, currentDay, 'morning'));
    sequenceNumber += 1;
  }
  tables.canonEvents.push(...events);

  if (withSnapshot && completedDays > 0) {
    const lastCompletedDay = completedDays - 1;
    const throughLastCompletedDay = events.filter((row) => (row.worldDay as number) <= lastCompletedDay);
    seedDailySnapshot(tables, worldId, throughLastCompletedDay, lastCompletedDay, now);
  }

  const stats = freshReadStats();
  const ctx = makeCtx(tables, stats);

  const measuredSequenceNumber = sequenceNumber - 1;
  /**
   * Reach steady state by running the REAL pipeline once for the previous event, rather than by
   * hand-seeding the state it would have left behind (ART-100).
   *
   * Two pieces of pipeline state are keyed on real history rather than on canon size: the recap
   * cursor (`recapSnapshots`), and `rebuildLiveProjection`'s resume point
   * (`liveRebuildCheckpoints` / `replaySceneCandidates`). An un-primed world makes the measured
   * call pay a cold start for both — the recap re-reads the whole day, and the Live rebuild folds
   * the whole log — which is an artifact of seeding tables directly, not something a production
   * world does after its first accepted event.
   *
   * Priming by INVOKING the pipeline, not by writing the rows, is the part that matters: a
   * hand-built checkpoint would be this test asserting against its own idea of the format, and
   * would keep passing if the rebuild stopped writing one. Here the rebuild has to have produced
   * a usable resume point, or the measured run below silently falls back to the full replay and
   * the AC#1 assertion fails — which is the correct outcome, not a false green.
   */
  if (measuredSequenceNumber >= 1) {
    const primed = await (runPostCommitPipeline as unknown as Registered)._handler(ctx, {
      worldId, sourceEventSequenceNumber: measuredSequenceNumber - 1, now,
    }) as { status: string; failureStage?: string; errorCode?: string; errorMessage?: string };
    if (primed.status !== 'completed') {
      throw new Error(`priming run did not complete (${JSON.stringify(options)}): status=${primed.status} `
        + `stage=${primed.failureStage} ${primed.errorCode ?? ''} ${primed.errorMessage ?? ''}`);
    }
  }
  void currentDayFirstSequenceNumber;

  // Setup above is steady-state priming, not the run AC#1 is about — only reads from here count.
  stats.docsRead = 0;
  stats.byTable = {};
  stats.byIndex = {};

  const outcome = await (runPostCommitPipeline as unknown as Registered)._handler(ctx, {
    worldId, sourceEventSequenceNumber: measuredSequenceNumber, now,
  }) as { status: string; failureStage?: string; errorCode?: string; errorMessage?: string };

  if (outcome.status !== 'completed') {
    throw new Error(
      `multi-day post-commit pipeline did not complete (${JSON.stringify(options)}): status=${outcome.status} `
      + `stage=${outcome.failureStage} ${outcome.errorCode ?? ''} ${outcome.errorMessage ?? ''}`,
    );
  }

  return {
    docsRead: stats.docsRead, byTable: { ...stats.byTable }, byIndex: { ...stats.byIndex },
    totalEvents: sequenceNumber,
  };
}

const SMALL_N = 30;
const LARGE_N = 60;
// Total events match SMALL_N/LARGE_N exactly (5x5+5=30, 11x5+5=60) so the multi-day numbers are
// directly comparable to the single-day ones at the same canon size. `currentDayEventCount` is
// held constant so a genuinely day-/tail-bounded read should report the SAME number at both.
const MULTI_DAY_SMALL: MultiDayOptions = { completedDays: 5, eventsPerCompletedDay: 5, currentDayEventCount: 5, withSnapshot: false };
const MULTI_DAY_LARGE: MultiDayOptions = { completedDays: 11, eventsPerCompletedDay: 5, currentDayEventCount: 5, withSnapshot: false };

/**
 * The AC#1 gate's two scale points, BOTH above `onboardingSummaryFunctions.MAX_SCANNED_EVENTS`.
 *
 * That rebuild's tail scan is capped, and a cap is only observable as flatness on either side of
 * it: measured at 30 and 60 events the scan reads 30 and 60, which is the cap not yet engaging
 * rather than a term that grows without bound. 210 and 410 both read exactly the cap, so the
 * criterion — reads do not grow with total accepted-event count — is what the numbers actually
 * test. Chosen so the totals are 41x5+5 = 210 and 81x5+5 = 410.
 */
const AC1_SMALL: MultiDayOptions = { completedDays: 41, eventsPerCompletedDay: 5, currentDayEventCount: 5, withSnapshot: true };
const AC1_LARGE: MultiDayOptions = { completedDays: 81, eventsPerCompletedDay: 5, currentDayEventCount: 5, withSnapshot: true };

describe('ART-100 Slice 0 — post-commit document-read measurement harness', () => {
  it('is a working harness: it measures nonzero, index-scoped reads for one post-commit run', async () => {
    const small = await measurePostCommitReads(SMALL_N);
    expect(small.docsRead).toBeGreaterThan(0);
    // The dominant contributor is canonEvents, read whole by every full-replay rebuild this
    // pipeline runs unconditionally (world/character/timeline/live/onboarding/voteConsequence/
    // relationshipGraph) — the exact reads AC#1 is about existing for.
    expect(small.byTable.canonEvents).toBeGreaterThan(0);
  });

  /**
   * The multi-day fixtures claim, in their own comment, to hold the SAME total event count as the
   * single-day ones so the two sets of numbers stay directly comparable. Now that the AC#1 gate
   * runs on the multi-day fixture, that claim is what keeps the single-day baseline meaningful as
   * a cross-check — so it is asserted rather than left as a comment arithmetic could outgrow.
   */
  it('keeps the multi-day fixtures at the same canon size as the single-day ones', async () => {
    expect((await measureMultiDay(MULTI_DAY_SMALL)).totalEvents).toBe(SMALL_N);
    expect((await measureMultiDay(MULTI_DAY_LARGE)).totalEvents).toBe(LARGE_N);
  });

  it('reports a per-table breakdown so a reader can see WHERE the reads went', async () => {
    const { byTable } = await measurePostCommitReads(SMALL_N);
    const contributingTables = Object.keys(byTable).sort();
    // Not asserting the full set (that's what the AC#1 test's recorded numbers are for) — only
    // that the breakdown is actually broken down, not a single opaque total.
    expect(contributingTables.length).toBeGreaterThan(1);
  });

  /**
   * The day-scoped `canonEvents` traffic is now FLAT across scale.
   *
   * REPLACES two tests that pinned weaker properties, both of which described a mechanism ART-100
   * has since removed. The first asserted that this index's traffic grew with COMPLETED-DAY COUNT
   * rather than with events per day; the second asserted that the growth was paid once per run
   * rather than once per cache invalidation. Both were about `completedWorldDaysBounded`, which
   * probed one row per world day — and `worldDayLedgers` now maintains that day list incrementally,
   * so there are no per-day probes left to count. Keeping either assertion would have meant
   * keeping a per-day read alive to satisfy it.
   *
   * What remains on this index is the current day's own events (`eventsOnDay`, plus
   * `rebuildVoteConsequenceProjection`'s day-scoped Phase 1) and the two `dayBounds` probes.
   * `eventsPerCompletedDay` and `currentDayEventCount` are held equal between the two fixtures, so
   * an identical count is the correct answer and any per-day term reappearing breaks it.
   */
  it('reads the same number of day-scoped canon rows however many world days the world has had', async () => {
    const small = await measureMultiDay({ ...MULTI_DAY_SMALL, withSnapshot: true });
    const large = await measureMultiDay({ ...MULTI_DAY_LARGE, withSnapshot: true });

    // Non-vacuity: the index is genuinely used, so "identical" is not "zero at both points".
    expect(small.byIndex['canonEvents:by_world_and_day']).toBeGreaterThan(0);
    expect(large.byIndex['canonEvents:by_world_and_day'])
      .toBe(small.byIndex['canonEvents:by_world_and_day']);
    // ...and the two fixtures really do differ in day count, so there was something to grow with.
    expect(MULTI_DAY_LARGE.completedDays).toBeGreaterThan(MULTI_DAY_SMALL.completedDays);
  });

  /**
   * AC#1 — KNOWN RED, and now red for exactly three measured reasons rather than a list of
   * suspects.
   *
   * ## What this test asserts, and why it is not a ratio any more
   *
   * It previously compared `docsRead` at two scale points and required the ratio under 1.5. That
   * gate could not detect what it claimed to: for a total of the form `C + kN`, any `C > 30k`
   * passes a 1.5 ratio at N=30/60 while `k` — a fully linear term — is still there. The assertion
   * is now the criterion stated literally: the number of `canonEvents` rows read is IDENTICAL at
   * both scale points. `currentDayEventCount` is held constant across them, so a read bounded by
   * the open day, by a snapshot tail, or by a named set of sequence numbers reports the same count,
   * and a read bounded by history does not.
   *
   * ## Why the multi-day WITH-snapshot fixture, and not the single-day one
   *
   * Not a weakening — the single-day fixture cannot express the criterion. Its world day never
   * completes, so no daily snapshot ever exists, so every projection MUST replay from empty and
   * O(N) is the correct cost of a correct answer. Production never looks like that: `importWorld`
   * writes an `initial` snapshot and stage 20 writes a daily one at every world-day boundary, so
   * any world past day one has something to resume from. Measuring AC#1 against a fixture that
   * structurally cannot benefit from the fix would be measuring the harness, not the system.
   *
   * ## The three remaining growers, measured by stack attribution rather than inferred
   *
   * At `MULTI_DAY_SMALL`/`MULTI_DAY_LARGE` with a snapshot (30 / 60 total events), `canonEvents`
   * reads are 152 / 218. The whole 66-row gap is these three, and nothing else:
   *
   *   1. `publicRead/liveStateFunctions.ts` `rebuildLiveProjection` — 30 -> 60. A full-log collect,
   *      DELIBERATELY, and the largest single term. See that file's docblock: `buildVisualReplay`
   *      ranks scenes for importance across the whole accepted history before taking the top few,
   *      and `locations` is a last-write-wins fold over a field that IS one of
   *      `SEED_BASELINE_FIELDS` — so a snapshot would publish seeded locations that today's
   *      replay-from-empty never shows, breaking AC#3. Fixing it needs a NEW incrementally
   *      maintained non-seeded location/character cache plus a per-scene location-fold cache; that
   *      is a design, not an index binding, and it is the one piece of work still standing between
   *      this task and AC#1.
   *   2. `publicRead/onboardingSummaryFunctions.ts` — 30 -> 60 here, but now CAPPED at
   *      `MAX_SCANNED_EVENTS` (200). This fixture is smaller than the cap, so the cap does not
   *      engage and the term still scales inside it; above 200 events it is flat. Pinned
   *      independently, at sizes either side of the cap, in that file's own test.
   *   3. `operations/postCommitLiveFunctions.ts` `completedWorldDaysBounded` — 6 -> 12. One probe
   *      per world day, so it is O(days), not O(events). It no longer pays twice (see the
   *      preceding test), but making it flat needs a maintained completed-day summary, which is a
   *      schema change this task did not take.
   *
   * Everything else in the trace is already flat across both scale points: `rebuildWorldProjection`
   * and `rebuildCharacterProjection` (40 and 10, snapshot fast path), `readProjectionViaSnapshot`
   * (15), `rebuildVoteConsequenceProjection` (10), `loadWorldState`'s point lookups and day reads
   * (8), and the recap window (2). `rebuildTimelineProjection` and `rebuildEpisodeIndexProjection`
   * make ZERO canon reads.
   *
   * Do not weaken the assertion to make this pass — land item 1 and it turns green on its own.
   */
  it('AC#1 — a post-commit run\'s canon reads do not grow with total accepted-event count', async () => {
    const small = await measureMultiDay(AC1_SMALL);
    const large = await measureMultiDay(AC1_LARGE);

    // The fixture's own precondition: the two scale points really do differ in total canon size.
    // Without this, the equality below could pass because nothing changed between the runs.
    expect(large.totalEvents).toBeGreaterThan(small.totalEvents);
    expect(small.byTable.canonEvents).toBeGreaterThan(0);

    // AC#1, stated literally: the number of canon rows a post-commit run reads is the SAME at both
    // scale points. `currentDayEventCount` is held constant across them, so a read bounded by the
    // open day (or by a snapshot tail, or by a named set of sequence numbers) reports an identical
    // count, and a read bounded by history does not.
    expect(large.byTable.canonEvents).toBe(small.byTable.canonEvents);

    /**
     * ...and `canonEvents` is not the only table that could grow, so the TOTAL is pinned too — but
     * pinned to what honestly remains rather than to zero.
     *
     * Exactly one read still scales, and it scales with WORLD DAYS: `rebuildEpisodeIndexProjection`
     * reads one `dailyEpisodes` row per day. That one is **payload-bound** — the model it publishes
     * IS the list of every episode, so it cannot read fewer rows than it publishes without
     * paginating a public contract, which is a product decision and not a read optimisation. Every
     * other O(days) read this task found has been removed, and asserting the exact rate is what
     * stops a new one hiding inside the allowance.
     */
    const extraWorldDays = AC1_LARGE.completedDays - AC1_SMALL.completedDays;
    expect(large.docsRead - small.docsRead).toBe(extraWorldDays);
    expect(large.byTable.dailyEpisodes - small.byTable.dailyEpisodes).toBe(extraWorldDays);
  });
});

/**
 * ART-100 AC#2 — a whole time slot in one transaction, on a world with hundreds of events.
 *
 * The criterion is about `runLiveWorldDayCycle`, not about a single post-commit run, and it used
 * to fail for two independent reasons: the batch size was pinned at 1, and the cycle opened by
 * collecting EVERY accepted event and EVERY post-commit run to work out what was left to do —
 * inside the very transaction whose byte budget the batch size existed to protect.
 */
describe('ART-100 AC#2 — runLiveWorldDayCycle over a whole time slot', () => {
  const HUNDREDS = 400;

  /**
   * A world of `eventCount` accepted events across finished days.
   *
   * `withSnapshot` seeds a real daily snapshot at the penultimate day boundary, which is what
   * stage 20 writes at every world-day boundary in production. Without one, every
   * `readProjectionViaSnapshot` call site falls back to a full replay — five of them, so a
   * snapshot-less fixture measures ~5N and says nothing about the cycle's own scan.
   */
  function seedWorld(worldId: string, eventCount: number, now: number, withSnapshot = true): Tables {
    const tables = emptyTables();
    const events: Row[] = [];
    let sequenceNumber = 0;
    let day = 0;
    for (; sequenceNumber < eventCount; day += 1) {
      for (let index = 0; index < 5 && sequenceNumber < eventCount; index += 1) {
        const timeSlot = index === 4 ? LAST_TIME_SLOT : 'morning';
        events.push(canonRow(worldId, sequenceNumber, day, timeSlot));
        sequenceNumber += 1;
      }
      tables.dailyEpisodes.push(withheldEpisodeRow(worldId, day, now));
    }
    tables.canonEvents.push(...events);
    if (withSnapshot && day >= 2) {
      const lastCompletedDay = day - 2;
      seedDailySnapshot(
        tables, worldId,
        events.filter((row) => (row.worldDay as number) <= lastCompletedDay),
        lastCompletedDay, now,
      );
    }
    return tables;
  }

  const runCycle = (ctx: ReturnType<typeof makeCtx>, worldId: string, now: number, maxPostCommitEvents?: number) =>
    (runLiveWorldDayCycle as unknown as Registered)._handler(ctx, {
      worldId, now, ...(maxPostCommitEvents === undefined ? {} : { maxPostCommitEvents }),
    }) as Promise<{ postCommit: Array<{ status: string; sourceEventId: string }> }>;

  it('takes a whole time slot through stages 11-21 in ONE call, by default', async () => {
    const worldId = 'ac2-slot';
    const now = 10_000_000;
    const tables = seedWorld(worldId, HUNDREDS, now);
    const stats = freshReadStats();
    const ctx = makeCtx(tables, stats);

    const result = await runCycle(ctx, worldId, now);

    // A time slot is three or more events, which is what AC#2 names. The default used to be 1.
    expect(result.postCommit.length).toBeGreaterThanOrEqual(3);
    expect(result.postCommit.every((run) => run.status === 'completed')).toBe(true);
    // ...on a world of hundreds of accepted events, which is the other half of the criterion.
    expect(tables.canonEvents).toHaveLength(HUNDREDS);
  });

  it('costs no more to open the cycle on a large world than on a small one', async () => {
    /**
     * The read that made AC#2 impossible was the cycle's OWN opening scan, before any event was
     * processed. Measured at two sizes with the batch pinned to 1 so the per-event work is equal
     * and the difference is the scan alone.
     */
    const now = 10_000_000;
    const measure = async (eventCount: number, worldId: string): Promise<number> => {
      const tables = seedWorld(worldId, eventCount, now);
      const stats = freshReadStats();
      const ctx = makeCtx(tables, stats);
      // One unmeasured call to reach steady state: the first ever cycle on a world pays a cold
      // start for the Live checkpoint, the day ledger and the settled-through cursor, all of which
      // read history ONCE and then never again. Measuring that would be measuring the catch-up,
      // not the criterion.
      await runCycle(ctx, worldId, now, 1);
      stats.byTable = {};
      stats.byIndex = {};
      stats.docsRead = 0;
      await runCycle(ctx, worldId, now, 1);
      return stats.byTable.canonEvents ?? 0;
    };
    // Both sizes sit above `onboardingSummaryFunctions.MAX_SCANNED_EVENTS`, for the reason the
    // AC#1 gate's own fixtures do: a cap is only observable as flatness on either side of it.
    const small = await measure(250, 'ac2-small');
    const large = await measure(500, 'ac2-large');
    expect(small).toBeGreaterThan(0);
    expect(large).toBe(small);
  });

  it('does not skip an event whose post-commit run failed, however far the world has advanced', async () => {
    /**
     * The negative path the cursor exists to protect. Runs need not form a prefix —
     * `runPostCommitPipeline` can be invoked directly for any event — so a cursor that jumped to
     * the highest completed run would strand everything below it, silently and permanently.
     */
    const worldId = 'ac2-gap';
    const now = 10_000_000;
    const tables = seedWorld(worldId, 50, now);
    const stats = freshReadStats();
    const ctx = makeCtx(tables, stats);

    // Event 0 is settled; event 1 failed; events 2 and 3 completed out of order.
    for (const sequenceNumber of [0, 2, 3]) {
      tables.postCommitRuns.push({
        runId: `${worldId}:${sequenceNumber}`, worldId,
        sourceEventId: `${worldId}#event#${sequenceNumber}`,
        sourceEventSequenceNumber: sequenceNumber, worldDay: 0,
        status: 'completed', attemptCount: 1, createdAt: now, updatedAt: now,
      });
    }
    tables.postCommitRuns.push({
      runId: `${worldId}:1`, worldId, sourceEventId: `${worldId}#event#1`,
      sourceEventSequenceNumber: 1, worldDay: 0,
      status: 'failed', attemptCount: 1, createdAt: now, updatedAt: now,
    });

    const result = await runCycle(ctx, worldId, now, 1);

    // The failed event is retried, NOT skipped in favour of the newest unsettled one.
    expect(result.postCommit).toHaveLength(1);
    expect(result.postCommit[0].sourceEventId).toBe(`${worldId}#event#1`);
    // ...and the cursor stopped below it rather than jumping past the completed 2 and 3.
    const cursor = tables.postCommitCursors[0] as { settledThroughSequenceNumber: number } | undefined;
    expect(cursor?.settledThroughSequenceNumber).toBe(0);
  });

  it('keeps making progress when a whole page is already settled', async () => {
    /**
     * Without a persisted cursor the cycle re-read the same settled prefix on every call and
     * returned empty while work remained — a stall, not a slowdown. The cursor advances over
     * settled events even when none of them produce work, so the next call reaches new ones.
     */
    const worldId = 'ac2-stall';
    const now = 10_000_000;
    const tables = seedWorld(worldId, 200, now);
    const settledThrough = 99;
    for (let sequenceNumber = 0; sequenceNumber <= settledThrough; sequenceNumber += 1) {
      tables.postCommitRuns.push({
        runId: `${worldId}:${sequenceNumber}`, worldId,
        sourceEventId: `${worldId}#event#${sequenceNumber}`,
        sourceEventSequenceNumber: sequenceNumber, worldDay: Math.floor(sequenceNumber / 5),
        status: 'completed', attemptCount: 1, createdAt: now, updatedAt: now,
      });
    }
    const stats = freshReadStats();
    const ctx = makeCtx(tables, stats);

    let calls = 0;
    let processed = 0;
    while (processed === 0 && calls < 10) {
      processed = (await runCycle(ctx, worldId, now, 1)).postCommit.length;
      calls += 1;
    }
    expect(processed).toBe(1);
    // Bounded catch-up: 100 settled events at 32 per call, so a handful of calls, not one per
    // event and not an infinite loop.
    expect(calls).toBeLessThanOrEqual(5);
    expect(calls).toBeGreaterThan(1);
  });
});
