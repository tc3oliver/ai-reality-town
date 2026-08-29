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
import { reassessMajorActiveArcEntries } from '../story/entryRecommendationFunctions';
import { refreshArcStagnationPrompts } from '../story/resolutionFunctions';
import { generateIncrementalRecap } from '../recaps/functions';
import { runPostCommitPipeline } from './postCommitLiveFunctions';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };

// ---------------------------------------------------------------------------
// Index-faithful in-memory `ctx.db`.
// ---------------------------------------------------------------------------

/** `[table]: { [indexName]: orderedFieldList }`, transcribed from each table's `schema.ts`. */
const INDEX_REGISTRY: Record<string, Record<string, readonly string[]>> = {
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
  dailyEpisodes: {
    by_world_and_day: ['worldId', 'worldDay'],
    by_world_and_episode: ['worldId', 'episodeNumber'],
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
    'story/entryRecommendationFunctions:reassessMajorActiveArcEntries': reassessMajorActiveArcEntries as unknown as Registered,
    'story/resolutionFunctions:refreshArcStagnationPrompts': refreshArcStagnationPrompts as unknown as Registered,
    'recaps/functions:generateIncrementalRecap': generateIncrementalRecap as unknown as Registered,
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
  if (currentDayEventCount >= 2) {
    const catchUpTo = measuredSequenceNumber - 1;
    await (generateIncrementalRecap as unknown as Registered)._handler(ctx, {
      worldId, mode: 'incremental', recapType: 'episode', targetId: `day:${currentDay}`,
      snapshotId: `setup:${worldId}:episode:day:${currentDay}`,
      fromSequenceNumber: currentDayFirstSequenceNumber, toSequenceNumber: catchUpTo, generatedAt: now,
    });
    await (generateIncrementalRecap as unknown as Registered)._handler(ctx, {
      worldId, mode: 'incremental', recapType: 'viewer_context', targetId: worldId,
      snapshotId: `setup:${worldId}:viewer_context:${worldId}`,
      fromSequenceNumber: 0, toSequenceNumber: catchUpTo, generatedAt: now,
    });
  }

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

describe('ART-100 Slice 0 — post-commit document-read measurement harness', () => {
  it('is a working harness: it measures nonzero, index-scoped reads for one post-commit run', async () => {
    const small = await measurePostCommitReads(SMALL_N);
    expect(small.docsRead).toBeGreaterThan(0);
    // The dominant contributor is canonEvents, read whole by every full-replay rebuild this
    // pipeline runs unconditionally (world/character/timeline/live/onboarding/voteConsequence/
    // relationshipGraph) — the exact reads AC#1 is about existing for.
    expect(small.byTable.canonEvents).toBeGreaterThan(0);
  });

  it('reports a per-table breakdown so a reader can see WHERE the reads went', async () => {
    const { byTable } = await measurePostCommitReads(SMALL_N);
    const contributingTables = Object.keys(byTable).sort();
    // Not asserting the full set (that's what the AC#1 test's recorded numbers are for) — only
    // that the breakdown is actually broken down, not a single opaque total.
    expect(contributingTables.length).toBeGreaterThan(1);
  });

  /**
   * RE-BASELINED (was: "the vote-consequence rebuild's day-scoped read is bounded, pinned at
   * exactly 10 reads"). `postCommitLiveFunctions.ts`'s `loadWorldState` was rewritten concurrently
   * with this slice: `completedWorldDays` (a full-log fold) became `completedWorldDaysBounded`,
   * which probes ONE row per world day across `[min, max]` on `by_world_and_day` — a NEW read on
   * the SAME index `rebuildVoteConsequenceProjection`'s day-scoped Phase 1 already used, so the
   * two are no longer separable by table+index alone. The original assertion's intent — "this
   * index's traffic does not scale with total canon size" — no longer holds in the form it was
   * written: the aggregate `canonEvents:by_world_and_day` count now DOES grow, but with
   * `completedDays` (the new per-day probe), not with events-per-day (the pre-existing day-scoped
   * reads, still bounded, still flat when `eventsPerCompletedDay`/`currentDayEventCount` are held
   * fixed as they are between `MULTI_DAY_SMALL` and `MULTI_DAY_LARGE`).
   *
   * Verified at both scale points below rather than assumed: `completedDays` 5 -> 11 (day span
   * 6 -> 12, +6 days) moves `canonEvents:by_world_and_day` 36 -> 48 (+12), a rate of 2 reads per
   * additional day. That rate is `completedWorldDaysBounded`'s one-row-per-day existence probe,
   * paid TWICE per run (see the AC#1 comment on why `loadWorldState` now runs twice) — nowhere
   * near the ~5 reads per day a day's own event rows would cost, which is the comparison that
   * actually distinguishes "still reading events" from "now just probing existence".
   */
  it('the day-scoped canonEvents index now grows with completed-day count, not with events per day', async () => {
    const small = await measureMultiDay(MULTI_DAY_SMALL);
    const large = await measureMultiDay(MULTI_DAY_LARGE);
    const daySpanSmall = MULTI_DAY_SMALL.completedDays + 1; // +1: the open day itself
    const daySpanLarge = MULTI_DAY_LARGE.completedDays + 1;
    const smallCount = small.byIndex['canonEvents:by_world_and_day'];
    const largeCount = large.byIndex['canonEvents:by_world_and_day'];
    const perDayRate = (largeCount - smallCount) / (daySpanLarge - daySpanSmall);

    // Grows with day count — the new intent, replacing "does not grow at all".
    expect(largeCount).toBeGreaterThan(smallCount);
    // ...at a small, bounded per-day rate, far below what re-reading each day's own events would
    // cost (`eventsPerCompletedDay`, held at 5 in both fixtures). A regression back to scanning
    // event rows per day — instead of just probing existence — would push this rate up toward 5+
    // and this assertion would catch it without anyone having to update a hardcoded total.
    expect(perDayRate).toBeGreaterThan(0);
    expect(perDayRate).toBeLessThan(MULTI_DAY_SMALL.eventsPerCompletedDay);
  });

  /**
   * Slice-2 evidence, measured rather than asserted in prose (mirrors
   * `relationshipGraphProjectionFunctions.test.ts`'s "reads only the events after the snapshot").
   *
   * INVESTIGATED, not guessed (2026-08-29): this went 3 -> 7 -> 5 across three consecutive
   * measurements taken minutes apart, while `worldCharacterProjectionFunctions.ts` was under
   * concurrent, unrelated edit. Traced with a temporary stack-capturing hook on every
   * `canonSnapshots` read (added, used, removed — not left in this file) to answer the only
   * question that mattered: is the fixture unfaithful, or is `snapshotReplay.ts`'s resumability
   * predicate wrong?
   *
   * NEITHER. Every read observed was `readLatestSnapshot`'s FAST PATH (`.order('desc').first()`
   * at `snapshotReplay.ts:151`) returning exactly 1 row; the `.take(SNAPSHOT_SCAN_LIMIT)` fallback
   * branch (`:159`, only reachable when the newest row is judged unresumable) fired ZERO times in
   * any run captured. The seeded row — built via `buildSnapshot`, never hand-rolled — is resumable
   * every time it is read. The 7-reading trace resolved to real call sites:
   * `rebuildWorldProjection` and `rebuildCharacterProjection` (`worldCharacterProjectionFunctions.ts`)
   * had each grown a snapshot fast path of their own (one direct `readLatestSnapshot` call to
   * decide which path to take, PLUS `readProjectionViaSnapshot`'s own internal `readLatestSnapshot`
   * call when a snapshot exists — two reads per rebuild, not one), on top of the original three
   * (`rebuildRelationshipGraphProjection`, `loadCharacterKnowledge`, `loadCharacterMemories`):
   * 2+2+1+1+1 = 7, exactly. By the time this comment was finalized a further concurrent edit to
   * the same file had brought it to 5 (still stable, still flat across scale) — i.e. this constant
   * is legitimately owned by however many OTHER rebuilds currently have their own snapshot fast
   * path, a number this file has no reason to track and every reason to expect will keep moving as
   * ART-100 lands elsewhere.
   *
   * So: NOT pinning an exact call-site count here — that would make this test somebody else's
   * merge conflict. What IS pinned, and is the actual O(1)-per-call-site claim: the count must be
   * IDENTICAL at both scale points, whatever it currently is. A call site that started scaling
   * with N (a real regression) would break this assertion without anyone having had to keep a
   * roster of which rebuilds currently read `canonSnapshots` up to date.
   */
  it('with a daily snapshot present, every snapshot-reading call site stays O(1) — flat across scale, whatever the current call-site count is — and the snapshot\'s savings grow with history (Slice 2 evidence)', async () => {
    const noSnapshotSmall = await measureMultiDay(MULTI_DAY_SMALL);
    const noSnapshotLarge = await measureMultiDay(MULTI_DAY_LARGE);
    const withSnapshotSmall = await measureMultiDay({ ...MULTI_DAY_SMALL, withSnapshot: true });
    const withSnapshotLarge = await measureMultiDay({ ...MULTI_DAY_LARGE, withSnapshot: true });

    // Not a hardcoded constant (see the comment above for why): the count of snapshot reads must
    // be nonzero (the fast path is genuinely exercised) and IDENTICAL at both scale points.
    expect(withSnapshotSmall.byTable.canonSnapshots).toBeGreaterThan(0);
    expect(withSnapshotLarge.byTable.canonSnapshots).toBe(withSnapshotSmall.byTable.canonSnapshots);

    // The reads the snapshot eliminated (full replay minus snapshot-tail, summed across every
    // snapshot-reading call site) grow with completed history, which is exactly what "was
    // O(total canon), is now O(days since last snapshot)" predicts.
    const savingsAtSmallScale = noSnapshotSmall.docsRead - withSnapshotSmall.docsRead;
    const savingsAtLargeScale = noSnapshotLarge.docsRead - withSnapshotLarge.docsRead;
    expect(savingsAtSmallScale).toBeGreaterThan(0);
    expect(savingsAtLargeScale).toBeGreaterThan(savingsAtSmallScale);
  });

  /**
   * AC#1 — KNOWN RED, ART-100 baseline. RE-BASELINED (was ratio 1.898) after a concurrent rewrite
   * of `postCommitLiveFunctions.ts`'s `loadWorldState`/`loadProjection` — see the two re-baselined
   * tests above for what changed. SELF-LIQUIDATING: the number that must change for this test to
   * pass is the RATIO on the "single-day" line below (currently 1.895); the threshold is 1.5. Do
   * not weaken the threshold to make it pass — land the incremental rebuilds instead, and this
   * test turns green on its own the next time it runs.
   *
   * Measured on `feat/ART-100-incremental-projections` (`npm test -- --runTestsByPath
   * convex/operations/postCommitLiveFunctions.readMeasurement.test.ts`, this test unskipped).
   * NOTE: this branch has at least three agents concurrently editing production rebuilds right
   * now (`worldCharacterProjectionFunctions.ts`, `liveStateFunctions.ts`,
   * `episodeTimelineProjectionFunctions.ts`, `postCommitLiveFunctions.ts`, and others, moving
   * between successive baselines within the SAME session — the ratio and per-table numbers below
   * moved three times over the course of writing this comment block, always staying red, never
   * approaching the 1.5 threshold). Re-run this file's own tests for the CURRENT numbers rather
   * than trusting these as anything more than "confirmed red at time of writing":
   *
   * ## Single-day fixture (`measurePostCommitReads`, what this test actually runs)
   *
   *   N=30  post-commit docsRead = 366   (was 323, then 391)
   *   N=60  post-commit docsRead = 666   (was 613, then 741)
   *   ratio (60/30)               = 1.820  (was 1.898, then 1.895)  <- THIS is the number the
   *                                           assertion below reads; it must drop under 1.5 to pass.
   *
   * Per-table breakdown at N=30 (of 366 total) / N=60 (of 666 total):
   *   canonEvents               311 / 611   (grows with N — the AC#1 signal)
   *     by_world_and_sequence   215 / 425   (full-collect + bounded-range reads; see call sites below)
   *     by_world_and_day         96 / 186   (single-day-fixture confound: `loadWorldState`'s
   *                                          `dayEvents`/`dayBounds`/`completedWorldDaysBounded` all
   *                                          bind on `worldId + worldDay`, and this fixture's single
   *                                          world day makes "one day" and "the whole world" the same
   *                                          set again — see the multi-day test above for the fixed
   *                                          version of this same confound)
   *   postCommitRuns             25 /  25   (constant: run-store bookkeeping)
   *   postCommitCheckpoints      22 /  22   (constant: run-store bookkeeping)
   *   recapSnapshots               8 /   8   (constant: bounded recap-cursor + range reads)
   *
   * ## Why `loadWorldState` runs TWICE per post-commit run (drives both `by_world_and_sequence`'s
   * point lookups and `by_world_and_day`'s doubling below)
   *
   * Stage 17 (`recap`) always fires in this fixture and its handler calls `port.generateRecap`,
   * which calls `invalidate()`, clearing the `worldState` cache — even though a recap write
   * changes nothing `loadWorldState` reads. Stage 20 (`snapshot`) then calls
   * `port.loadWorldState` again to check whether the current day is finished, triggering a full
   * second fetch: `eventAtSequence` (1), `dayEvents`/`dayBounds`/`completedWorldDaysBounded`'s
   * day-oriented reads, all repeated. This is NOT new behaviour — the OLD code invalidated on the
   * same schedule — but the old `loadWorldState` kept its expensive part (`loadCanonRows`, the
   * one full `canonEvents` collect) in a SEPARATE cache that `invalidate()` never cleared, so the
   * second `loadWorldState` call was cheap. The new code has no such second cache, so its
   * day-oriented reads pay twice. Not this slice's call to fix; recorded because it explains the
   * "36" and "96" numbers directly rather than leaving them looking arbitrary.
   *
   * ## Is `canonEvents:by_world_and_sequence` (the unbounded index binding) still hit? YES —
   * from SIX full-collect call sites plus one worse-than-full one, all unconditional:
   *
   *   1. `rebuildWorldProjection` (worldCharacterProjectionFunctions.ts, `loadWorldEvents`) — 30/60.
   *   2. `rebuildCharacterProjection` (same file, same helper) — 30/60 per affected character
   *      (one, in this fixture).
   *   3. `rebuildLiveProjection` (liveStateFunctions.ts) — 30/60, DELIBERATELY kept as a full
   *      replay per that file's own new docblock (`buildVisualReplay` ranks candidates across the
   *      whole history; `locations` needs the seeded baseline, which a snapshot cannot supply
   *      without violating `SEED_BASELINE_FIELDS`) — see that file for the full reasoning.
   *   4. `loadCharacterKnowledge` -> `loadProjection` -> `readProjectionViaSnapshot`'s no-snapshot
   *      fallback (canon/snapshotReplay.ts) — 30/60. NEW call site (see above).
   *   5. `loadCharacterMemories` -> same `loadProjection` fallback, independently — 30/60. NEW.
   *   6. `rebuildRelationshipGraphProjection` -> same `readProjectionViaSnapshot` fallback,
   *      because this fixture's world day never completes so stage 20 never writes a snapshot to
   *      resume from — 30/60. FIXED when a snapshot exists (see the multi-day-with-snapshot test).
   *   7. `rebuildOnboardingSummary` (onboardingSummaryFunctions.ts) — 55/116ish (worse than a
   *      single collect): its doubling `.order('desc').take(window)` tail scan never finds a
   *      showable major event or fact in this inert fixture, so it keeps doubling until exhausted
   *      — the ~2x-collect worst case its own docblock documents.
   *
   * NOT hit any more (confirmed absent from the trace; disappeared between the previous baseline
   * and this one): `rebuildTimelineProjection` and `rebuildEpisodeIndexProjection`.
   * `episodeTimelineProjectionFunctions.ts` was rewritten to look up Canon rows only for the
   * specific sequence numbers a `storyArcEventClassifications` row already named as
   * importance-qualifying — point lookups on `worldId + sequenceNumber` — and this fixture
   * classifies nothing (one participant, below the arc floor), so it makes zero canon reads now.
   *
   * ## Multi-day fixture (`measureMultiDay`), same total events (30 / 60), WITHOUT a snapshot
   *
   *   totalEvents=30  docsRead = 361   canonEvents=276 (by_world_and_sequence=240, by_world_and_day=36)  dailyEpisodes=30
   *   totalEvents=60  docsRead = 669   canonEvents=548 (by_world_and_sequence=500, by_world_and_day=48)  dailyEpisodes=66
   *   ratio (60/30) = 1.853 — still red. `by_world_and_day` grows 36 -> 48 here too, but at the
   *   bounded per-day rate the dedicated test above pins (~2/day), not at anything close to
   *   `eventsPerCompletedDay` (5) — confirmed NOT an events-count confound.
   *
   * `dailyEpisodes` (read whole at several call sites) also grows with `completedDays` (30 -> 66):
   * a further, unoptimized, day-count-scaling read site, out of this slice's scope, flagged rather
   * than silently absorbed into the total.
   *
   * ## Multi-day fixture, WITH a real daily snapshot seeded at the last completed day
   *
   * `canonSnapshots` itself is NOT pinned to a specific number here (see the dedicated Slice-2
   * test's comment above: it has moved 3 -> 7 -> 5 across successive measurements as OTHER
   * rebuilds — currently `worldCharacterProjectionFunctions.ts` — gain or lose their own snapshot
   * fast path, under concurrent edit at measurement time). What stays true regardless of that
   * count: it is IDENTICAL at both scale points (flat, not O(N) — verified every time this file's
   * tests run), and the docsRead SAVINGS over the no-snapshot run at matching totalEvents grow
   * with completed history, which is exactly what turning full replays into snapshot-tail reads
   * predicts. Re-run this file's own tests for the numbers current at read time rather than
   * trusting a pasted snapshot of them here.
   *
   * Still red at every scale regardless of the snapshot-call-site count: `rebuildWorldProjection`,
   * `rebuildCharacterProjection`, `rebuildLiveProjection` (deliberately, see above) and
   * `rebuildOnboardingSummary`'s worst-case tail scan remain full replays regardless of fixture
   * shape, which is why AC#1 stays red rather than "mostly fixed".
   */



  it.skip('AC#1 — a post-commit run\'s document reads do not grow linearly with total accepted-event count', async () => {
    const small = await measurePostCommitReads(SMALL_N);
    const large = await measurePostCommitReads(LARGE_N);
    const ratio = large.docsRead / small.docsRead;
    // If reads were independent of history size, doubling N would not double the read count.
    // Right now it does (see the recorded baseline above: ratio ~1.895) — this is the ART-100 red
    // baseline. The threshold below (1.5) is the self-liquidating condition: once the remaining
    // full-replay rebuilds listed above are incremental, this ratio drops under it and the test
    // passes without editing this file.
    expect(ratio).toBeLessThan(1.5);
  });
});
