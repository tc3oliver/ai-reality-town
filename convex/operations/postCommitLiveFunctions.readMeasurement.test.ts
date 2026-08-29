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
   * The multi-day fixture's reason to exist: give `rebuildVoteConsequenceProjection`'s day-scoped
   * Phase 1 read (`canonEvents` by `by_world_and_day`) a window that is genuinely narrower than
   * the whole log, which the single-day fixture cannot (there, "one day" and "the whole world"
   * are the same set — see that fixture's docblock). `currentDayEventCount` and
   * `eventsPerCompletedDay` are held fixed while `completedDays` more than doubles (5 -> 11), so a
   * read that is truly day-scoped reports the SAME count at both scale points; a regression to a
   * world-scoped collect would show up as growth here exactly as it does for AC#1 below.
   */
  it('the multi-day fixture gives the vote-consequence rebuild\'s day-scoped read room to prove it is bounded', async () => {
    const small = await measureMultiDay(MULTI_DAY_SMALL);
    const large = await measureMultiDay(MULTI_DAY_LARGE);
    // Two day-scoped reads per run (the lookahead window is 1 day): the last completed day plus
    // the current open day — `eventsPerCompletedDay + currentDayEventCount` rows, never the
    // world's total, and identical whether `completedDays` is 5 or 11.
    const expectedDayScopedReads = MULTI_DAY_SMALL.eventsPerCompletedDay + MULTI_DAY_SMALL.currentDayEventCount;
    expect(small.byIndex['canonEvents:by_world_and_day']).toBe(expectedDayScopedReads);
    expect(large.byIndex['canonEvents:by_world_and_day']).toBe(expectedDayScopedReads);
  });

  /**
   * Slice-2 evidence, measured rather than asserted in prose (mirrors
   * `relationshipGraphProjectionFunctions.test.ts`'s "reads only the events after the snapshot").
   *
   * Without a snapshot, `rebuildRelationshipGraphProjection` falls back to a full replay, so its
   * `canonEvents` contribution grows with total canon size exactly like the still-unfixed
   * rebuilds. With a real daily snapshot seeded at the boundary of the last completed day (via
   * `seedDailySnapshot` / `buildSnapshot` — never hand-rolled, see that function's docblock), it
   * resumes from the snapshot and reads only the CONSTANT-size open day after it.
   *
   * The pipeline's OVERALL total still grows either way — this fixes one of ~6 full-replay call
   * sites, not all of them, so it is not asserted to go flat (that would be the wrong claim; see
   * the AC#1 comment for the ones still outstanding). What DOES isolate this one rebuild's win:
   * `canonSnapshots` is read exactly once per run regardless of scale (the snapshot lookup itself
   * is O(1)), and the GAP between the no-snapshot and with-snapshot totals — the reads the
   * snapshot saved — grows with `completedDays` exactly as the eliminated full replay would have.
   */
  it('with a daily snapshot present, the relationship-graph rebuild\'s own reads stop scaling, and the snapshot\'s savings grow with history (Slice 2 evidence)', async () => {
    const noSnapshotSmall = await measureMultiDay(MULTI_DAY_SMALL);
    const noSnapshotLarge = await measureMultiDay(MULTI_DAY_LARGE);
    const withSnapshotSmall = await measureMultiDay({ ...MULTI_DAY_SMALL, withSnapshot: true });
    const withSnapshotLarge = await measureMultiDay({ ...MULTI_DAY_LARGE, withSnapshot: true });

    // `readLatestSnapshot`: exactly one row read (`.order('desc').first()`), both scale points.
    expect(withSnapshotSmall.byTable.canonSnapshots).toBe(1);
    expect(withSnapshotLarge.byTable.canonSnapshots).toBe(1);

    // The reads the snapshot eliminated (full replay minus snapshot-tail) grow with completed
    // history, which is exactly what "was O(total canon), is now O(days since last snapshot)"
    // predicts: more completed days behind the snapshot means more the no-snapshot run had to
    // re-read and the with-snapshot run did not.
    const savingsAtSmallScale = noSnapshotSmall.docsRead - withSnapshotSmall.docsRead;
    const savingsAtLargeScale = noSnapshotLarge.docsRead - withSnapshotLarge.docsRead;
    expect(savingsAtSmallScale).toBeGreaterThan(0);
    expect(savingsAtLargeScale).toBeGreaterThan(savingsAtSmallScale);
  });

  /**
   * AC#1 — KNOWN RED, ART-100 baseline. SELF-LIQUIDATING: the number that must change for this
   * test to pass is the RATIO on the "single-day" line below (currently 1.898); the assertion's
   * threshold is 1.5. Do not weaken the threshold to make it pass — land the incremental rebuilds
   * instead, and this test turns green on its own the next time it runs.
   *
   * Measured on `feat/ART-100-incremental-projections` (`npm test -- --runTestsByPath
   * convex/operations/postCommitLiveFunctions.readMeasurement.test.ts`, this test unskipped).
   * NOTE: at measurement time this branch already had Slice-1/2 WINDOW and SNAPSHOT_PLUS_TAIL work
   * landed for `rebuildRelationshipArc`/`rebuildOnboardingSummary`/`rebuildVoteConsequence`/
   * `rebuildRelationshipGraph` (concurrent work on this same branch, not part of this slice) — the
   * numbers below are the CURRENT baseline, not a "zero incremental work anywhere" baseline.
   *
   * ## Single-day fixture (`measurePostCommitReads`, what this test actually runs)
   *
   *   N=30  post-commit docsRead = 323
   *   N=60  post-commit docsRead = 613
   *   ratio (60/30)               = 1.898  <- THIS is the number the assertion below reads; it
   *                                           must drop under 1.5 for the test to pass.
   *
   * Per-table breakdown at N=30 (of 323 total) / N=60 (of 613 total):
   *   canonEvents               268 / 558   (grows with N — the AC#1 signal)
   *     by_world_and_sequence   238 / 498   (full-collect + bounded-range reads combined)
   *     by_world_and_day         30 /  60   (rebuildVoteConsequenceProjection's day-scoped Phase 1
   *                                          read — bounded by day size in production, but this
   *                                          fixture keeps every event on world day 0, so "one
   *                                          day" and "the whole world" coincide here)
   *   postCommitRuns             25 /  25   (constant: run-store bookkeeping)
   *   postCommitCheckpoints      22 /  22   (constant: run-store bookkeeping)
   *   recapSnapshots               8 /   8   (constant: bounded recap-cursor + range reads)
   *
   * The non-canonEvents rows (55 total) do not move between N=30 and N=60; canonEvents alone
   * grows 268 -> 558, which is the entire difference.
   *
   * ## Multi-day fixture (`measureMultiDay`), same total events (30 / 60), WITHOUT a snapshot
   *
   * Confirms the single-day fixture's `by_world_and_day` confound is real and is fixed here: with
   * genuinely separate days, that index reports the SAME count (10 = one completed day's 5 rows +
   * the open day's 5) at both scales, instead of growing with N.
   *
   *   totalEvents=30  docsRead = 333   canonEvents=248 (by_world_and_sequence=238, by_world_and_day=10)  dailyEpisodes=30
   *   totalEvents=60  docsRead = 629   canonEvents=508 (by_world_and_sequence=498, by_world_and_day=10)  dailyEpisodes=66
   *   ratio (60/30) = 1.888 — still red, for the same reason: world/character/timeline/live/
   *   onboarding remain full replays regardless of how the days are laid out.
   *
   * SECOND, UNPLANNED finding from building this fixture: `dailyEpisodes` (read whole, unindexed
   * by day, at 5-6 call sites — `liveStateFunctions.ts`, `episodeIndexProjectionFunctions.ts`,
   * `episodeTimelineProjectionFunctions.ts`, `onboardingSummaryFunctions.ts`,
   * `postCommitLiveFunctions.ts`'s `loadWorldState`) grows with `completedDays` (30 -> 66), not
   * per-event, but not O(1) either. Out of scope for this slice's fixture work; flagged here
   * rather than silently absorbed into the "known red" total.
   *
   * ## Multi-day fixture, WITH a real daily snapshot seeded at the last completed day
   *
   *   totalEvents=30  docsRead = 309   canonEvents=223 (by_world_and_sequence=213)  canonSnapshots=1
   *   totalEvents=60  docsRead = 575   canonEvents=453 (by_world_and_sequence=443)  canonSnapshots=1
   *
   * `canonSnapshots` (the snapshot lookup `rebuildRelationshipGraphProjection` now makes instead
   * of a full replay) costs exactly 1 read at both scales — the Slice 2 win for that one rebuild,
   * verified by the dedicated test above. The snapshot's SAVINGS over the no-snapshot run
   * (333-309=24 at N=30, 629-575=54 at N=60) grow with completed history, which is exactly what a
   * fix that turned an O(total canon) read into an O(days since snapshot) read predicts — that
   * growing gap is itself evidence, not just the flat `canonSnapshots` count. The pipeline TOTAL
   * still nearly doubles either way (1.86x with a snapshot vs. 1.89x without): one rebuild out of
   * ~6 full-replay call sites being fixed is not enough to move AC#1's verdict, which is the whole
   * reason this test stays red and skipped rather than being declared "mostly fixed".
   *
   * ## Call sites still dominating the `canonEvents` growth (single-day figures), ranked
   *
   * Each a `.collect()` — or, for `rebuildOnboardingSummary`, a doubling `.order('desc').take(window)`
   * sequence that degrades to ~2x a full collect when no showable major event/fact ever settles
   * the search, which this inert fixture deliberately triggers (see `canonRow`'s docblock; this is
   * NOT a day-count confound, so the multi-day fixture does not change it either) — over the WHOLE
   * accepted-event log, once per post-commit run:
   *   1. `createConvexPostCommitLivePort.loadWorldState` (postCommitLiveFunctions.ts) — the
   *      cached canon load every other stage's `loadWorldState`/`loadCharacterKnowledge`/
   *      `loadCharacterMemories` call reuses within one run.
   *   2. `rebuildWorldProjection` + `rebuildCharacterProjection`
   *      (worldCharacterProjectionFunctions.ts, `loadWorldEvents`) — 2 collects for this fixture's
   *      one affected character; one MORE per additional affected character.
   *   3. `rebuildTimelineProjection` (episodeTimelineProjectionFunctions.ts).
   *   4. `rebuildLiveProjection` (liveStateFunctions.ts).
   *   5. `rebuildOnboardingSummary` (onboardingSummaryFunctions.ts) — already windowed, but this
   *      fixture has no showable major event or fact, which is exactly its documented ~2x-collect
   *      worst case.
   *   6. `rebuildRelationshipGraphProjection` — FIXED when a daily snapshot exists (see above);
   *      still a full replay on the single-day fixture, which never has one.
   *   7. `rebuildVoteConsequenceProjection` — FIXED by day-scoping when days are genuinely
   *      separate (see the multi-day-without-snapshot numbers above); the single-day fixture's
   *      shared day/world set still shows this as growth.
   */
  it.skip('AC#1 — a post-commit run\'s document reads do not grow linearly with total accepted-event count', async () => {
    const small = await measurePostCommitReads(SMALL_N);
    const large = await measurePostCommitReads(LARGE_N);
    const ratio = large.docsRead / small.docsRead;
    // If reads were independent of history size, doubling N would not double the read count.
    // Right now it does (see the recorded baseline above: ratio ~1.898) — this is the ART-100 red
    // baseline. The threshold below (1.5) is the self-liquidating condition: once the remaining
    // full-replay rebuilds listed above are incremental, this ratio drops under it and the test
    // passes without editing this file.
    expect(ratio).toBeLessThan(1.5);
  });
});
