/**
 * A rules-only slot and the world-day RUN record (ART-181).
 *
 * `runRulesOnlySlot` is the FR-M004 rung-4/5 path: it claims and settles a slot exactly as an
 * authored one, but it runs no world-day pipeline, so until this task it wrote `scheduledSlots`
 * and nothing else. `worldDayRunId` is derived from the slot identity, so a retry reuses the same
 * run id — and the ladder's OWN recovery walks into the disagreement: a slot fails while
 * authoring (`worldDayRuns` → `failed`, with the provider's stage and code), the world drops to
 * rung 4, the retry succeeds here, and the two rows now contradict each other for the same slot.
 *
 * These drive the real `prepareQueuedWorldDaySlot` handler against an in-memory database, because
 * the claim is what decides the slot is rules-only and asserting the settlement against
 * `runRulesOnlySlot` in isolation would prove a function nobody routed to.
 *
 * The world is deliberately EMPTY of characters in most of them. An empty world produces no
 * rules-only proposals and still completes — that is stated in `runRulesOnlySlot`'s own docblock
 * and it is not a special case being exploited here, it is the quiet-world path — which keeps the
 * fixture to the tables the run record actually involves.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getFunctionName } from 'convex/server';

import { prepareQueuedWorldDaySlot } from './worldDayLiveFunctions';
import { worldDayRunId } from './worldDayLive';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const WORLD_ID = 'world-art181';
const T0 = 1_700_000_000_000;
const SLOT = { worldId: WORLD_ID, worldDay: 3, timeSlot: 'morning' as const };
const RUN_ID = worldDayRunId(SLOT);
const SLOT_ID = 'scheduledSlots:0';

/** A minimal index-aware store: `withIndex` narrows by the fields the caller `eq`s. */
function memoryDb(tables: Tables, refuseInsertInto?: string) {
  const findRow = (id: string): Row | undefined => {
    for (const rows of Object.values(tables)) {
      const row = rows.find((candidate) => candidate._id === id);
      if (row) return row;
    }
    return undefined;
  };
  return {
    query(table: string) {
      let matched = [...(tables[table] ?? [])];
      const chain = {
        withIndex(_name: string, build?: (q: unknown) => unknown) {
          if (build) {
            const eqs: Array<[string, unknown]> = [];
            const q = {
              eq(field: string, value: unknown) { eqs.push([field, value]); return q; },
              gte() { return q; },
              lte() { return q; },
            };
            build(q);
            matched = matched.filter((row) => eqs.every(([field, value]) => row[field] === value));
          }
          return chain;
        },
        order() { return chain; },
        filter() { return chain; },
        take: (count: number) => Promise.resolve(matched.slice(0, count)),
        first: () => Promise.resolve(matched[0] ?? null),
        unique: () => Promise.resolve(matched[0] ?? null),
        collect: () => Promise.resolve(matched),
      };
      return chain;
    },
    get: (id: string) => Promise.resolve(findRow(id) ?? null),
    insert(table: string, row: Row) {
      if (table === refuseInsertInto) throw new Error('CANON_PERSISTENCE_UNAVAILABLE');
      const id = `${table}:${(tables[table] ?? []).length}`;
      (tables[table] ??= []).push({ ...row, _id: id });
      return Promise.resolve(id);
    },
    patch(id: string, patch: Row) {
      const row = findRow(id);
      if (!row) throw new Error(`ROW_NOT_FOUND ${id}`);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete row[key];
        else row[key] = value;
      }
      return Promise.resolve();
    },
  };
}

function baseTables(over: Partial<Tables> = {}): Tables {
  return {
    scheduledSlots: [{
      _id: SLOT_ID, slotKey: `${WORLD_ID}:3:morning`, worldId: WORLD_ID, worldDay: 3,
      timeSlot: 'morning', status: 'queued', attemptCount: 1, createdAt: T0, updatedAt: T0,
    }],
    // Rung 4: the world's automatic responses to a provider outage have reached rules-only.
    worldDegradationStates: [{
      _id: 'worldDegradationStates:0', worldId: WORLD_ID, level: 'rules_only',
      consecutiveFailures: 2, lastTriggerCode: 'LLM_NETWORK_ERROR',
      lastTransitionWorldDay: 3, lastTransitionAt: T0, slotsSinceProviderProbe: 0,
      lastSignalKey: null,
    }],
    worldSchedules: [{
      _id: 'worldSchedules:0', worldId: WORLD_ID, mode: 'development', status: 'running',
      publishEnabled: true, createdAt: T0, updatedAt: T0,
    }],
    worldEmergencyStops: [],
    canonEvents: [],
    canonSnapshots: [],
    worldCharacters: [],
    worldLocations: [],
    worldCharacterKnowledge: [],
    worldAssets: [],
    worldSecrets: [],
    storyArcs: [],
    worldDayRuns: [],
    worldDayCheckpoints: [],
    ...over,
  };
}

/** A `worldDayRuns` row left behind by an attempt that failed while authoring. */
function failedRunRow(over: Row = {}): Row {
  return {
    _id: 'worldDayRuns:0', runId: RUN_ID, worldId: WORLD_ID, worldDay: 3, timeSlot: 'morning',
    status: 'failed', attemptCount: 1, failureStage: 'simulate_scenes',
    errorCode: 'LLM_NETWORK_ERROR', errorMessage: 'provider unreachable',
    createdAt: T0, updatedAt: T0, ...over,
  };
}

type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };

/**
 * Run the real handler. `runMutation` is dispatched by the registered function's own name, so the
 * scheduler mutations behave as they do in the deployment (the slot row really moves) while the
 * claim is short-circuited to the slot under test.
 */
async function prepare(tables: Tables, refuseInsertInto?: string): Promise<unknown> {
  const db = memoryDb(tables, refuseInsertInto);
  const ctx = {
    db,
    runMutation: async (ref: unknown, args: Record<string, unknown>): Promise<unknown> => {
      const name = getFunctionName(ref as never);
      if (name.endsWith(':claimLiveSlot')) {
        return { kind: 'claimed', slotId: SLOT_ID, slotKey: `${WORLD_ID}:3:morning` };
      }
      if (name.endsWith(':startScheduledSlot')) {
        await db.patch(SLOT_ID, { status: 'running', updatedAt: args.now });
        return null;
      }
      if (name.endsWith(':completeScheduledSlot')) {
        await db.patch(SLOT_ID, {
          status: 'completed', committedEventId: args.committedEventId, completedAt: args.now,
          errorCode: undefined, updatedAt: args.now,
        });
        return null;
      }
      if (name.endsWith(':failScheduledSlot')) {
        await db.patch(SLOT_ID, { status: 'failed', errorCode: args.errorCode, updatedAt: args.now });
        return null;
      }
      throw new Error(`UNEXPECTED_MUTATION ${name}`);
    },
  };
  return (prepareQueuedWorldDaySlot as unknown as Registered)._handler(
    ctx, { worldId: WORLD_ID, now: T0 + 1_000 });
}

const runRow = (tables: Tables): Row | undefined => tables.worldDayRuns.find((row) => row.runId === RUN_ID);

/**
 * The long-run harness has its own rules-only branch and its own `MemoryWorldDayRunStore`, so the
 * fix has to exist in both or the harness reproduces the defect invisibly inside the evidence the
 * 30- and 90-day gates rest on.
 *
 * **This is a source-level pin and not a behavioural one, which is a real weakness.** Driving the
 * harness's rules-only branch for real means running its own loop with a dead provider until the
 * ladder reaches rung 4 — minutes of work inside the 30-day gate, not a unit test. So what is
 * asserted here is that the harness CALLS the settlement at the rung-4 branch, in the form that
 * runs it.
 *
 * The first version of this test asserted only that the name appeared in the file, and the fault
 * injection caught it: replacing the call with `void settleInheritedRunRecord;` left it green.
 * Requiring the awaited call with its arguments is what makes the injection bite. It would still
 * pass if the function itself were gutted — the behavioural half of that is the production test
 * below, which drives the identical two refusals through the real handler.
 */
describe('ART-181 — the long-run harness settles it the same way', () => {
  const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

  it('calls the settlement from its rung-4 branch, with the slot it just ran', () => {
    expect(read('convex/operations/longRunHarness.ts'))
      .toMatch(/await settleInheritedRunRecord\(fixture, slot, status, committedEventIds, errorCode\);/u);
  });

  it('keeps both refusals in both implementations: never create, never move a completed run', () => {
    for (const path of ['convex/operations/longRunHarness.ts', 'convex/simulation/worldDayLiveFunctions.ts']) {
      const source = read(path);
      expect(source).toMatch(/existing\.status === 'completed'/u);
      expect(source).toMatch(/failRun\(\s*runId,\s*'commit_accepted_events'/u);
      // Neither may create one. `createRun` must not appear in either settlement.
      // Anchored on the DEFINITION, not on a call: the call site appears first in the file, and
      // matching it captured five lines of arguments instead of the body. The fault injection
      // caught that too — adding `createRun` to the body left this green.
      const settlement = /async function settle(?:RunRecordForRulesOnlySlot|InheritedRunRecord)\([\s\S]*?\n\}/u.exec(source)?.[0] ?? '';
      expect(settlement.includes('createRun')).toBe(false);
      expect(settlement.length).toBeGreaterThan(200);
    }
  });
});

describe('ART-181 — a rules-only slot settles the run record it inherits', () => {
  it('clears a prior attempt\'s failure when the rules-only retry succeeds', async () => {
    /**
     * The defect, end to end. Before this task `scheduledSlots` said `completed` and
     * `worldDayRuns` said `failed` with `LLM_NETWORK_ERROR` for the same slot — and three
     * surfaces read the run row: `inspectRun`, the operations console's `runsForSlot`, and the
     * proposal-review view that maps `errorCode` + `failureStage` to a rejection reason.
     */
    const tables = baseTables({ worldDayRuns: [failedRunRow()] });
    const outcome = await prepare(tables) as { kind: string; outcome: { status: string } };

    expect(outcome.kind).toBe('settled');
    expect(outcome.outcome.status).toBe('completed');
    expect(tables.scheduledSlots[0]?.status).toBe('completed');

    const run = runRow(tables);
    expect(run?.status).toBe('completed');
    // Not merely "status flipped": the failure fields have to be GONE, which is the whole of
    // ART-150's rule and the reason a completed run carrying a provider code is a defect.
    expect(run?.errorCode).toBeUndefined();
    expect(run?.failureStage).toBeUndefined();
    expect(run?.errorMessage).toBeUndefined();
  });

  it('keeps the prior attempt visible as checkpoint history rather than erasing it', async () => {
    // ART-150 AC#2, which this must not undo: the per-attempt record is `worldDayCheckpoints`,
    // and settling the run must not touch it.
    const checkpoint = {
      _id: 'worldDayCheckpoints:0', runId: RUN_ID, stage: 'simulate_scenes', attempt: 1,
      status: 'failed', errorCode: 'LLM_NETWORK_ERROR', errorMessage: 'provider unreachable',
      createdAt: T0, updatedAt: T0,
    };
    const tables = baseTables({ worldDayRuns: [failedRunRow()], worldDayCheckpoints: [checkpoint] });
    await prepare(tables);
    expect(tables.worldDayCheckpoints).toEqual([checkpoint]);
  });

  it('creates no run record for a world that never authored one', async () => {
    /**
     * A `worldDayRuns` row asserts that a world-day run executed the ten-stage pipeline. A
     * rules-only slot did not, so minting one here would replace a stale claim with a false one —
     * and every reader above would start seeing runs for slots that never ran.
     */
    const tables = baseTables();
    await prepare(tables);
    expect(tables.worldDayRuns).toEqual([]);
    expect(tables.scheduledSlots[0]?.status).toBe('completed');
  });

  it('records a rules-only failure rather than leaving a stale success standing', async () => {
    /**
     * The other direction, and it needs a slot that actually fails. This world has one occupied
     * location, so `deriveRulesOnlyEvents` really does propose an event and it really does travel
     * `validateEventStructure` → `commitProposedEvent`; the store then refuses to persist it.
     *
     * The refusal is injected at the STORE rather than by inventing an invalid proposal, because
     * the proposals this path derives are valid by construction — a rules-only event asserts only
     * what the world already implies. A persistence failure is the failure mode that remains, and
     * it is the one `RULES_ONLY_COMMIT_FAILED` names.
     */
    const tables = baseTables({
      worldCharacters: [{
        _id: 'worldCharacters:0', worldId: WORLD_ID, characterId: 'lin-yi',
        payload: { name: '林一', initialLocationId: 'mill' },
      }],
      worldLocations: [{
        _id: 'worldLocations:0', worldId: WORLD_ID, locationId: 'mill',
        payload: { name: '磨坊', connectedLocationIds: [] },
      }],
      worldDayRuns: [failedRunRow({ status: 'running', failureStage: undefined, errorCode: undefined, errorMessage: undefined })],
    });
    const outcome = await prepare(tables, 'canonEvents') as { outcome: { status: string; errorCode?: string } };
    expect(outcome.outcome.status).toBe('failed');
    const run = runRow(tables);
    expect(run?.status).toBe('failed');
    expect(run?.errorCode).toBe(outcome.outcome.errorCode);
    expect(run?.failureStage).toBe('commit_accepted_events');
  });

  it('leaves an already-completed run alone, because nothing about it is stale', async () => {
    // `patchRun` refuses to move a completed run at all (`RUN_TERMINAL`), so settling one would
    // throw and take the slot down with it.
    const completed = failedRunRow({
      status: 'completed', failureStage: undefined, errorCode: undefined, errorMessage: undefined,
      committedEventIds: ['event-1'],
    });
    const tables = baseTables({ worldDayRuns: [completed] });
    await expect(prepare(tables)).resolves.toMatchObject({ kind: 'settled' });
    expect(runRow(tables)?.status).toBe('completed');
    expect(runRow(tables)?.committedEventIds).toEqual(['event-1']);
  });
});
