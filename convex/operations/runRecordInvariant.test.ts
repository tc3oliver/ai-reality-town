/**
 * A run that ultimately succeeds carries no failure from a prior attempt (ART-150).
 *
 * ## The invariant, and why it needs a suite of its own
 *
 * `WorldDayRun` and `PostCommitRun` each carry `failureStage`, `errorCode` and `errorMessage`.
 * Those three fields describe ONE attempt — the one that failed — while `status` describes the
 * run. A record that says `completed` and still names an error code is not a partially-true
 * record; it is two answers to the same question, and the operations surface reads the wrong one.
 *
 * Neither orchestrator can enforce this on its own. Both delegate the write to an injected store
 * and then return whatever `loadRun` gives back, so the invariant is a term of the STORE contract:
 * `resumeRun` starts a new attempt and must therefore clear the previous attempt's failure, and
 * `completeRun` must not resurrect one. There are five implementations of that contract in this
 * repository — the Convex adapter, the two the long-run harness owns, and the per-suite doubles —
 * and before ART-150 exactly one of them cleared. The Convex adapter got it for free, because
 * `db.patch` removes a field patched to `undefined` and `patchRun` names all three fields on every
 * call; every hand-written `Object.assign` store kept them.
 *
 * That divergence is the defect. The harness is the evidence base for ART-73's ninety-day gate and
 * for the FR-M002 evaluators, so a harness whose completed slots carry stale error codes reports a
 * world that the deployment would not have recorded — while the deployment stayed correct, which is
 * why nothing caught it.
 *
 * ## What each test proves
 *
 * Every case drives a REAL fail-then-succeed through the real orchestrator: attempt 1 throws at a
 * named stage, attempt 2 resumes from the last completed checkpoint and finishes. That is the only
 * way to produce the state in question — writing a dirty record by hand and asserting it gets
 * cleaned would be a test of the assertion, not of the path.
 *
 * AC#2 is asserted in the same tests rather than separately: clearing the run summary must not
 * discard the history, and the per-attempt checkpoint rows are where that history lives. A fix that
 * cleared the checkpoints too would satisfy AC#1 and be a worse bug, so the two are pinned
 * together.
 */

import type { GenericMutationCtx } from 'convex/server';
import type { DataModel } from '../_generated/dataModel';
import {
  executeWorldDay,
  WORLD_DAY_STAGES,
  WorldDayOrchestrationError,
  type WorldDayRunInput,
  type WorldDayStage,
  type WorldDayStageHandlers,
} from '../simulation/worldDayOrchestration';
import { createConvexWorldDayRunStore } from '../simulation/worldDayOrchestrationFunctions';
import {
  executePostCommitPipeline,
  POST_COMMIT_STAGES,
  PostCommitOrchestrationError,
  type PostCommitRunInput,
  type PostCommitStage,
  type PostCommitStageHandlers,
} from './postCommitOrchestration';
import { MemoryPostCommitRunStore, MemoryWorldDayRunStore } from './longRunHarness';

const WORLD_DAY_INPUT: WorldDayRunInput = {
  runId: 'worldday:mistwood:4:noon', worldId: 'mistwood', worldDay: 4, timeSlot: 'noon',
};
const POST_COMMIT_INPUT: PostCommitRunInput = {
  runId: 'postcommit:mistwood:11', worldId: 'mistwood',
  sourceEventId: 'event:mistwood:11', sourceEventSequenceNumber: 11, worldDay: 4,
};

const FAILING_WORLD_DAY_STAGE: WorldDayStage = 'simulate_scenes';
const FAILING_POST_COMMIT_STAGE: PostCommitStage = 'arc';
const INJECTED_CODE = 'INJECTED_PROVIDER_UNAVAILABLE';
const INJECTED_MESSAGE = 'the provider refused this attempt';

/** Stage handlers that fail once at `failing`, then succeed for every later attempt. */
function worldDayHandlersFailingOnce(failing: WorldDayStage): { handlers: WorldDayStageHandlers; recover: () => void } {
  let down = true;
  const handlers = Object.fromEntries(WORLD_DAY_STAGES.map((stage) => [stage, () => {
    if (stage === failing && down) throw new WorldDayOrchestrationError(INJECTED_CODE, INJECTED_MESSAGE);
    return Promise.resolve(
      stage === 'commit_accepted_events' ? { committedEventIds: ['event:mistwood:1'] } : { stage },
    );
  }])) as unknown as WorldDayStageHandlers;
  return { handlers, recover: () => { down = false; } };
}

function postCommitHandlersFailingOnce(failing: PostCommitStage): { handlers: PostCommitStageHandlers; recover: () => void } {
  let down = true;
  const handlers = Object.fromEntries(POST_COMMIT_STAGES.map((stage) => [stage, () => {
    if (stage === failing && down) throw new PostCommitOrchestrationError(INJECTED_CODE, INJECTED_MESSAGE);
    return Promise.resolve({ stage });
  }])) as unknown as PostCommitStageHandlers;
  return { handlers, recover: () => { down = false; } };
}

describe('a world-day run that succeeds after a failed attempt (ART-150 AC#1, AC#3)', () => {
  it('reports no error code, message or failure stage once it completes', async () => {
    const store = new MemoryWorldDayRunStore();
    const { handlers, recover } = worldDayHandlersFailingOnce(FAILING_WORLD_DAY_STAGE);

    const failed = await executeWorldDay(WORLD_DAY_INPUT, store, handlers);
    expect(failed).toMatchObject({
      status: 'failed', attemptCount: 1,
      failureStage: FAILING_WORLD_DAY_STAGE, errorCode: INJECTED_CODE, errorMessage: INJECTED_MESSAGE,
    });

    recover();
    const succeeded = await executeWorldDay(WORLD_DAY_INPUT, store, handlers);

    expect(succeeded.status).toBe('completed');
    expect(succeeded.attemptCount).toBe(2);
    // Absent, not merely falsy: an operator filtering on "has an error code" must not match this run.
    expect(succeeded.errorCode).toBeUndefined();
    expect(succeeded.errorMessage).toBeUndefined();
    expect(succeeded.failureStage).toBeUndefined();
  });

  it('keeps the failed attempt as checkpoint history rather than discarding it (AC#2)', async () => {
    const store = new MemoryWorldDayRunStore();
    const { handlers, recover } = worldDayHandlersFailingOnce(FAILING_WORLD_DAY_STAGE);
    await executeWorldDay(WORLD_DAY_INPUT, store, handlers);
    recover();
    await executeWorldDay(WORLD_DAY_INPUT, store, handlers);

    const history = await store.listCheckpoints(WORLD_DAY_INPUT.runId);
    expect(history).toContainEqual(expect.objectContaining({
      stage: FAILING_WORLD_DAY_STAGE, attempt: 1, status: 'failed',
      errorCode: INJECTED_CODE, errorMessage: INJECTED_MESSAGE,
    }));
    // The second attempt re-ran the same stage and got through, under its own attempt number.
    expect(history).toContainEqual(expect.objectContaining({
      stage: FAILING_WORLD_DAY_STAGE, attempt: 2, status: 'completed',
    }));
  });
});

describe('a post-commit run that succeeds after a failed attempt (ART-150 AC#1, AC#3)', () => {
  it('reports no error code, message or failure stage once it completes', async () => {
    const store = new MemoryPostCommitRunStore();
    const { handlers, recover } = postCommitHandlersFailingOnce(FAILING_POST_COMMIT_STAGE);

    const failed = await executePostCommitPipeline(POST_COMMIT_INPUT, store, handlers, 'trace:1');
    expect(failed).toMatchObject({
      status: 'failed', failureStage: FAILING_POST_COMMIT_STAGE, errorCode: INJECTED_CODE,
    });

    recover();
    const succeeded = await executePostCommitPipeline(POST_COMMIT_INPUT, store, handlers, 'trace:1');

    expect(succeeded.status).toBe('completed');
    expect(succeeded.errorCode).toBeUndefined();
    expect(succeeded.errorMessage).toBeUndefined();
    expect(succeeded.failureStage).toBeUndefined();
  });

  it('keeps the failed attempt as checkpoint history rather than discarding it (AC#2)', async () => {
    const store = new MemoryPostCommitRunStore();
    const { handlers, recover } = postCommitHandlersFailingOnce(FAILING_POST_COMMIT_STAGE);
    await executePostCommitPipeline(POST_COMMIT_INPUT, store, handlers, 'trace:1');
    recover();
    await executePostCommitPipeline(POST_COMMIT_INPUT, store, handlers, 'trace:1');

    expect(await store.listCheckpoints(POST_COMMIT_INPUT.runId)).toContainEqual(expect.objectContaining({
      stage: FAILING_POST_COMMIT_STAGE, attempt: 1, status: 'failed', errorCode: INJECTED_CODE,
    }));
  });
});

/**
 * The deployment's own store, so the invariant is pinned where the operator actually reads it —
 * and so the memory stores have something to be equivalent TO. `db.patch` removing a field set to
 * `undefined` is the mechanism `patchRun` relies on; if that ever stopped being true, the Convex
 * side would drift from the harness in the other direction and this is the test that would say so.
 */
describe('the Convex world-day run store (ART-150 AC#1)', () => {
  type Row = Record<string, unknown> & { _id: string };

  function createFakeDb() {
    const tables = new Map<string, Row[]>();
    let counter = 0;
    const rowsOf = (table: string): Row[] => {
      if (!tables.has(table)) tables.set(table, []);
      return tables.get(table) as Row[];
    };
    const findById = (id: string): Row | null => {
      for (const rows of tables.values()) {
        const row = rows.find((candidate) => candidate._id === id);
        if (row) return row;
      }
      return null;
    };
    return {
      insert(table: string, doc: Record<string, unknown>) {
        const _id = `${table}:${(counter += 1)}`;
        rowsOf(table).push({ ...doc, _id });
        return Promise.resolve(_id);
      },
      get(id: string) { return Promise.resolve(findById(id)); },
      patch(id: string, patch: Record<string, unknown>) {
        const row = findById(id);
        if (!row) throw new Error(`no such row: ${id}`);
        for (const [key, value] of Object.entries(patch)) {
          // Convex removes a field when it is patched to undefined.
          if (value === undefined) delete row[key];
          else row[key] = value;
        }
        return Promise.resolve();
      },
      query(table: string) {
        return {
          withIndex(_index: string, build?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown) {
            const constraints: [string, unknown][] = [];
            const builder = { eq: (field: string, value: unknown) => { constraints.push([field, value]); return builder; } };
            build?.(builder);
            const matched = () => rowsOf(table).filter((row) => constraints.every(([field, value]) => row[field] === value));
            const cursor = {
              unique() {
                const rows = matched();
                if (rows.length > 1) throw new Error('unique() matched multiple rows');
                return Promise.resolve(rows[0] ?? null);
              },
              collect() { return Promise.resolve(matched()); },
              first() { return Promise.resolve(matched()[0] ?? null); },
              order() { return cursor; },
            };
            return cursor;
          },
        };
      },
      rowsOf,
    };
  }

  it('clears the prior attempt failure and keeps the failed checkpoint', async () => {
    const db = createFakeDb();
    const store = createConvexWorldDayRunStore(db as unknown as GenericMutationCtx<DataModel>['db'], 1_000_000);
    const { handlers, recover } = worldDayHandlersFailingOnce(FAILING_WORLD_DAY_STAGE);

    await executeWorldDay(WORLD_DAY_INPUT, store, handlers);
    recover();
    const succeeded = await executeWorldDay(WORLD_DAY_INPUT, store, handlers);

    expect(succeeded.status).toBe('completed');
    expect(succeeded.errorCode).toBeUndefined();
    expect(succeeded.failureStage).toBeUndefined();
    const [row] = db.rowsOf('worldDayRuns');
    // The stored row, not just the mapped view: the field is gone from the document.
    expect(Object.prototype.hasOwnProperty.call(row, 'errorCode')).toBe(false);
    expect(db.rowsOf('worldDayCheckpoints')).toContainEqual(expect.objectContaining({
      stage: FAILING_WORLD_DAY_STAGE, attempt: 1, status: 'failed', errorCode: INJECTED_CODE,
    }));
  });
});
