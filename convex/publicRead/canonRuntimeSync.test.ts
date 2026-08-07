/**
 * Canon/Runtime synchronization contract tests (FR-N006 / ART-117).
 *
 * FR-N006 was written expecting a stateful sync pipeline: a `RuntimeSyncRecord` table, an
 * idempotent command queue, a retry state machine. ART-114 and ART-115 shipped something
 * else — a pure function re-derived on every read — under which most of FR-N006's promises
 * stop being things the code *does* and become things the architecture *cannot violate*.
 * `docs/canon-runtime-synchronization.md` argues that case; this suite is the evidence for
 * it, organised by the acceptance criterion each test discharges.
 *
 * The suite exercises the whole rebuild path, not the projection function alone:
 * {@link rebuildOnce} is a faithful transcription of `liveStateFunctions.ts`'s
 * `rebuildLiveProjection` handler with `ctx.db` replaced by the two in-memory stores below.
 * That is deliberate — the interesting claims here ("no Canon row was written", "the second
 * rebuild deduplicated") are claims about what happens *around* the pure function, and a
 * test of the pure function alone could not make them. Following this repo's convention,
 * the fakes are local to the suite rather than shared.
 */

import type { AcceptedEvent } from '../canon/model';
import { MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { rowToAcceptedEvent, type CanonEventRow } from '../canon/serialize';
import { FIXTURE_ACCEPTED_AT_MS, MISTWOOD_SEED_PLACEMENTS } from '../visualRuntime/fixtures';
import { mistwoodRuntimeContext } from '../visualRuntime/mistwoodRuntime';
import { LIVE_MODEL_KIND, buildLiveProjection, liveSourceEventIds } from './liveState';
import {
  commitReadModelVersion,
  SERVABLE_STATUS,
  serveReadModel,
  type JsonValue,
  type PublishedReadModel,
  type PublicReadStore,
  type ReadModelKind,
  type StoredReadModel,
} from './readModel';
import {
  buildPublicDynamicProjectionResult,
  selectPublicDynamicProjection,
  summarizeRuntimeProblems,
  type PublicCharacterMotion,
} from './publicDynamicProjection';

const WORLD_ID = MISTWOOD_PUBLIC_WORLD_ID;
const LIVE_REF = `live:${WORLD_ID}`;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A `canonEvents` row carrying one location change, shaped as the commit pipeline stores
 * them: the proposed event as `payload`, the envelope as columns. Reconstructed through the
 * real {@link rowToAcceptedEvent} so the test reads Canon the way the mutation does.
 */
function canonRow(args: {
  readonly sequenceNumber: number;
  readonly characterId: string;
  readonly fromLocationId: string;
  readonly toLocationId: string;
  readonly worldDay?: number;
  readonly timeSlot?: string;
}): CanonEventRow {
  return {
    worldId: WORLD_ID,
    sequenceNumber: args.sequenceNumber,
    acceptedAt: FIXTURE_ACCEPTED_AT_MS + args.sequenceNumber,
    validationVersion: '1',
    traceId: 'trace:none',
    payload: {
      schemaVersion: 1,
      worldId: WORLD_ID,
      idempotencyKey: `k${args.sequenceNumber}`,
      proposedBy: { type: 'system' },
      worldDay: args.worldDay ?? 1,
      timeSlot: args.timeSlot ?? 'morning',
      eventType: 'movement',
      participantIds: [args.characterId],
      causedByEventIds: [],
      publicSummary: null,
      stateChanges: [
        {
          type: 'character_location_changed',
          characterId: args.characterId,
          fromLocationId: args.fromLocationId,
          toLocationId: args.toLocationId,
        },
      ],
    },
  };
}

/** Wu Zhen walks the station-to-square road, the same move `fixtures.ts` plans. */
const WU_ZHEN_MOVE = canonRow({
  sequenceNumber: 1,
  characterId: 'wu-zhen',
  fromLocationId: 'mistwood-station',
  toLocationId: 'mistwood-square',
});

/** No `mistwood-nowhere` zone exists, so no position for Shen Kai can be published at all. */
const UNBOUND_DESTINATION_MOVE = canonRow({
  sequenceNumber: 1,
  characterId: 'shen-kai',
  fromLocationId: 'mistwood-square',
  toLocationId: 'mistwood-nowhere',
});

/** One second into a walk: under way at every fixture arrival time, which run to ~20s+. */
const IN_TRANSIT_MS = FIXTURE_ACCEPTED_AT_MS + 1_000;
/** Far past every arrival, so nobody is mid-road. */
const SETTLED_MS = FIXTURE_ACCEPTED_AT_MS + 10_000_000;

// ---------------------------------------------------------------------------
// The rebuild path under test
// ---------------------------------------------------------------------------

type RebuildResult = {
  readonly modelRef: string;
  readonly version: number;
  readonly deduplicated: boolean;
  readonly dynamicCharacterCount: number;
  readonly dynamicProblemCount: number;
  readonly dynamicProblemsByCode: Readonly<Partial<Record<string, number>>>;
};

/**
 * `rebuildLiveProjection`'s handler with the database replaced. Arcs and episodes are left
 * empty: they are FR-I002's inputs and change nothing about the motion this task is about.
 */
async function rebuildOnce(args: {
  readonly canon: MemoryCanonStore;
  readonly store: MemoryReadStore;
  readonly nowMs: number;
}): Promise<RebuildResult> {
  const acceptedEvents: AcceptedEvent[] = args.canon.read().map(rowToAcceptedEvent);
  const derived = buildPublicDynamicProjectionResult({
    worldId: WORLD_ID,
    nowMs: args.nowMs,
    runtime: mistwoodRuntimeContext(),
    seedPlacements: MISTWOOD_SEED_PLACEMENTS,
    acceptedEvents,
    worldStatus: 'running',
    activeScenes: [],
  });
  const payload = buildLiveProjection({
    worldId: WORLD_ID,
    acceptedEvents,
    arcs: [],
    publishedEpisode: null,
    dynamic: derived.projection,
  });
  const result = await commitReadModelVersion(args.store, {
    worldId: WORLD_ID,
    modelKind: LIVE_MODEL_KIND,
    modelRef: LIVE_REF,
    payload: payload as unknown as JsonValue,
    sourceEventIds: liveSourceEventIds(payload),
    status: SERVABLE_STATUS,
    now: args.nowMs,
  });
  return {
    modelRef: LIVE_REF,
    version: result.version,
    deduplicated: result.deduplicated,
    dynamicCharacterCount: derived.projection.characters.length,
    dynamicProblemCount: derived.problems.total,
    dynamicProblemsByCode: derived.problems.byCode,
  };
}

/** The motion actually served to a public reader, not the one held in memory mid-rebuild. */
async function servedMotions(store: MemoryReadStore): Promise<readonly PublicCharacterMotion[]> {
  const served = await serveReadModel(store, WORLD_ID, LIVE_MODEL_KIND, LIVE_REF);
  return selectPublicDynamicProjection(served?.payload)?.characters ?? [];
}

function motionFor(
  motions: readonly PublicCharacterMotion[],
  characterId: string,
): PublicCharacterMotion {
  const motion = motions.find((entry) => entry.characterId === characterId);
  if (!motion) throw new Error(`no published motion for ${characterId}`);
  return motion;
}

// ---------------------------------------------------------------------------
// AC#1 — a Canon location change becomes a valid runtime destination
// ---------------------------------------------------------------------------

describe('AC#1 — a Canon location change is converted into a valid runtime destination', () => {
  it('turns an accepted move into a motion ending at the destination zone', async () => {
    const store = new MemoryReadStore();
    const canon = new MemoryCanonStore([WU_ZHEN_MOVE]);
    const result = await rebuildOnce({ canon, store, nowMs: IN_TRANSIT_MS });

    expect(result.dynamicCharacterCount).toBe(12);
    expect(result.dynamicProblemCount).toBe(0);

    const moved = motionFor(await servedMotions(store), 'wu-zhen');
    expect(moved.motionType).toBe('canon');
    expect(moved.semanticLocationId).toBe('mistwood-square');
    expect(moved.sourceEventIds).toEqual([`${WORLD_ID}#event#1`]);
    // The destination is a real point on the map, not a placeholder.
    expect(Number.isFinite(moved.to.x) && Number.isFinite(moved.to.y)).toBe(true);
    expect(moved.arriveAt).toBeGreaterThan(moved.startedAt);
  });

  it('omits a character whose destination has no binding rather than guessing a position', async () => {
    const store = new MemoryReadStore();
    const canon = new MemoryCanonStore([UNBOUND_DESTINATION_MOVE]);
    const result = await rebuildOnce({ canon, store, nowMs: IN_TRANSIT_MS });

    const ids = (await servedMotions(store)).map((motion) => motion.characterId);
    expect(ids).not.toContain('shen-kai');
    expect(result.dynamicCharacterCount).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// AC#2 / AC#3 — in-transit versus arrived
// ---------------------------------------------------------------------------

describe('AC#2 — the published motion carries an in-transit state while the character moves', () => {
  it('publishes animationState "walking" before arrival', async () => {
    const store = new MemoryReadStore();
    const canon = new MemoryCanonStore([WU_ZHEN_MOVE]);
    await rebuildOnce({ canon, store, nowMs: IN_TRANSIT_MS });

    const moved = motionFor(await servedMotions(store), 'wu-zhen');
    expect(moved.animationState).toBe('walking');
    expect(IN_TRANSIT_MS).toBeLessThan(moved.arriveAt);
    // A walk has somewhere to go; an arrival does not.
    expect(moved.from).not.toEqual(moved.to);
  });

  it('publishes animationState "idle" once the walk is over', async () => {
    const store = new MemoryReadStore();
    const canon = new MemoryCanonStore([WU_ZHEN_MOVE]);
    await rebuildOnce({ canon, store, nowMs: SETTLED_MS });

    const moved = motionFor(await servedMotions(store), 'wu-zhen');
    expect(moved.animationState).toBe('idle');
    expect(SETTLED_MS).toBeGreaterThanOrEqual(moved.arriveAt);
    expect(moved.from).toEqual(moved.to);
    expect(moved.semanticLocationId).toBe('mistwood-square');
  });
});

describe('AC#3 — semanticLocationId is the destination, and arrival is what gates the label', () => {
  /**
   * This is the rule `docs/canon-runtime-synchronization.md` writes down, pinned here so a
   * later edit cannot quietly change it. `semanticLocationId` is the destination from the
   * instant the Canon fact is accepted — Canon's statement is already true — which means it
   * is *not* an answer to "where is this character standing right now". The published
   * `arriveAt` is: a consumer wanting a location LABEL must wait for `nowMs >= arriveAt`
   * (equivalently `animationState !== 'walking'`), or it will caption a sprite that is
   * visibly mid-road with the room it has not reached, which PRD 2.0 §10.5 forbids.
   */
  it('names the destination even while the character is still walking there', async () => {
    const store = new MemoryReadStore();
    const canon = new MemoryCanonStore([WU_ZHEN_MOVE]);
    await rebuildOnce({ canon, store, nowMs: IN_TRANSIT_MS });

    const moved = motionFor(await servedMotions(store), 'wu-zhen');
    expect(moved.animationState).toBe('walking');
    expect(moved.semanticLocationId).toBe('mistwood-square');
    expect(moved.arriveAt).toBeGreaterThan(IN_TRANSIT_MS);
  });

  it('publishes the arrival instant a label consumer must gate on', async () => {
    const store = new MemoryReadStore();
    const canon = new MemoryCanonStore([WU_ZHEN_MOVE]);
    await rebuildOnce({ canon, store, nowMs: IN_TRANSIT_MS });
    const walking = motionFor(await servedMotions(store), 'wu-zhen');

    const settledStore = new MemoryReadStore();
    await rebuildOnce({ canon, store: settledStore, nowMs: SETTLED_MS });
    const arrived = motionFor(await servedMotions(settledStore), 'wu-zhen');

    // Same fact, same destination, same arrival instant — only the phase differs, and the
    // phase is derivable by the client from arriveAt alone.
    expect(walking.semanticLocationId).toBe(arrived.semanticLocationId);
    expect(walking.arriveAt).toBe(arrived.arriveAt);
    expect(walking.animationState).not.toBe(arrived.animationState);
  });
});

// ---------------------------------------------------------------------------
// AC#4 / AC#5 — the sync path is strictly Canon-read
// ---------------------------------------------------------------------------

describe('AC#4 — a runtime rebuild never writes Canon', () => {
  it('leaves every Canon row byte-identical across a rebuild', async () => {
    const canon = new MemoryCanonStore([WU_ZHEN_MOVE]);
    const before = canon.snapshot();
    await rebuildOnce({ canon, store: new MemoryReadStore(), nowMs: IN_TRANSIT_MS });
    expect(canon.snapshot()).toBe(before);
  });

  it('creates no Canon row even when the runtime cannot place a character', async () => {
    const canon = new MemoryCanonStore([UNBOUND_DESTINATION_MOVE]);
    const before = canon.snapshot();
    const result = await rebuildOnce({ canon, store: new MemoryReadStore(), nowMs: IN_TRANSIT_MS });

    expect(result.dynamicProblemCount).toBeGreaterThan(0);
    expect(canon.read()).toHaveLength(1);
    expect(canon.snapshot()).toBe(before);
  });

  it('creates no Canon row when the read-model write itself fails', async () => {
    const canon = new MemoryCanonStore([WU_ZHEN_MOVE]);
    const store = new MemoryReadStore();
    store.insertShouldThrow = true;
    const before = canon.snapshot();

    await expect(rebuildOnce({ canon, store, nowMs: IN_TRANSIT_MS })).rejects.toThrow(
      'PROJECTION_WRITE_UNAVAILABLE',
    );
    expect(canon.snapshot()).toBe(before);
  });
});

describe('AC#5 — repeating a rebuild creates no duplicate Canon event', () => {
  it('deduplicates the second rebuild and touches no Canon row in either', async () => {
    const canon = new MemoryCanonStore([WU_ZHEN_MOVE]);
    const store = new MemoryReadStore();
    const canonBefore = canon.snapshot();

    const first = await rebuildOnce({ canon, store, nowMs: SETTLED_MS });
    const canonAfterFirst = canon.snapshot();
    const second = await rebuildOnce({ canon, store, nowMs: SETTLED_MS + 5_000_000 });

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.version).toBe(first.version);
    expect(store.rows).toHaveLength(1);

    // The point of the criterion: not merely that no *duplicate* Canon event appeared, but
    // that no Canon write was ever available to make one.
    expect(canonAfterFirst).toBe(canonBefore);
    expect(canon.snapshot()).toBe(canonBefore);
    expect(canon.read()).toHaveLength(1);
  });

  it('re-derives an identical payload from unchanged Canon after the walk has settled', async () => {
    const canon = new MemoryCanonStore([WU_ZHEN_MOVE]);
    const first = await rebuildOnce({ canon, store: new MemoryReadStore(), nowMs: SETTLED_MS });
    const second = await rebuildOnce({
      canon,
      store: new MemoryReadStore(),
      nowMs: SETTLED_MS + 5_000_000,
    });
    expect(second).toEqual(first);
  });
});

/**
 * ART-120 (FR-O011 AC#2): ambient movement creates no accepted event and changes no Canon,
 * memory, knowledge, relationship or arc state.
 *
 * The claim is about a whole real rebuild rather than about the pure derivation, because the
 * derivation obviously writes nothing — it has no database handle. What was worth proving is
 * the surrounding path: that turning a settled character into an ambient-eligible one did not
 * quietly turn the read model into something that churns.
 */
describe('FR-O011 AC#2 — ambient eligibility writes nothing, anywhere', () => {
  it('publishes ambient for a settled character while leaving Canon untouched', async () => {
    const canon = new MemoryCanonStore([WU_ZHEN_MOVE]);
    const store = new MemoryReadStore();
    const canonBefore = canon.snapshot();

    await rebuildOnce({ canon, store, nowMs: SETTLED_MS });
    const moved = motionFor(await servedMotions(store), 'wu-zhen');

    expect(moved.motionType).toBe('ambient');
    expect(moved.from).toEqual(moved.to);
    expect(canon.snapshot()).toBe(canonBefore);
    expect(canon.read()).toHaveLength(1);
  });

  it('adds no read-model version however long the world sits ambient', async () => {
    // The architectural reason ambient drift is derived on the client rather than published.
    // Three rebuilds spanning hours of ambient time produce one stored row, because the
    // payload is a function of Canon and nothing else — no clock reaches it. Publishing a
    // per-minute ambient coordinate would defeat `contentHash` by construction and append
    // roughly 1,440 spurious version rows a day.
    const canon = new MemoryCanonStore([WU_ZHEN_MOVE]);
    const store = new MemoryReadStore();

    const first = await rebuildOnce({ canon, store, nowMs: SETTLED_MS });
    const second = await rebuildOnce({ canon, store, nowMs: SETTLED_MS + 60_000 });
    const third = await rebuildOnce({ canon, store, nowMs: SETTLED_MS + 4 * 60 * 60 * 1000 });

    expect(first.deduplicated).toBe(false);
    expect([second.deduplicated, third.deduplicated]).toEqual([true, true]);
    expect(store.rows).toHaveLength(1);
    expect(canon.read()).toHaveLength(1);
  });

  it('publishes no coordinate that a clock could have produced', async () => {
    // Ambient means "drift is permitted here", never "the character is at (x, y) right now".
    // If the published payload carried a drifting position, these two payloads — derived four
    // hours of ambient time apart — would differ.
    const canon = new MemoryCanonStore([WU_ZHEN_MOVE]);
    const early = await rebuildOnce({ canon, store: new MemoryReadStore(), nowMs: SETTLED_MS });
    const late = await rebuildOnce({
      canon,
      store: new MemoryReadStore(),
      nowMs: SETTLED_MS + 4 * 60 * 60 * 1000,
    });
    expect(late).toEqual(early);
  });

  it('carries the Canon day and slot the client needs to seed the drift', async () => {
    // PRD 2.0 §9.1.2 requires the seed to include `worldDay`, and FR-O012's day/night wash
    // needs the slot. Both are read off the last accepted event, so neither can imply a world
    // time nobody accepted.
    const store = new MemoryReadStore();
    const canon = new MemoryCanonStore([WU_ZHEN_MOVE]);
    await rebuildOnce({ canon, store, nowMs: SETTLED_MS });

    const served = await serveReadModel(store, WORLD_ID, LIVE_MODEL_KIND, LIVE_REF);
    const dynamic = selectPublicDynamicProjection(served?.payload);
    expect(dynamic?.worldDay).toBe(rowToAcceptedEvent(WU_ZHEN_MOVE).worldDay);
    expect(dynamic?.timeSlot).toBe(rowToAcceptedEvent(WU_ZHEN_MOVE).timeSlot);
  });
});

// ---------------------------------------------------------------------------
// AC#6 — one character, one place
// ---------------------------------------------------------------------------

describe('AC#6 — a character is never published at two locations at once', () => {
  it('collapses a multi-hop history into the single latest destination', async () => {
    const store = new MemoryReadStore();
    const canon = new MemoryCanonStore([
      canonRow({ sequenceNumber: 1, characterId: 'lin-yingxue', fromLocationId: 'mistwood-paper', toLocationId: 'mistwood-station' }),
      canonRow({ sequenceNumber: 2, characterId: 'lin-yingxue', fromLocationId: 'mistwood-station', toLocationId: 'mistwood-square', timeSlot: 'afternoon' }),
      canonRow({ sequenceNumber: 3, characterId: 'lin-yingxue', fromLocationId: 'mistwood-square', toLocationId: 'mistwood-inn', worldDay: 2, timeSlot: 'evening' }),
    ]);
    await rebuildOnce({ canon, store, nowMs: IN_TRANSIT_MS });

    const motions = await servedMotions(store);
    const forLin = motions.filter((motion) => motion.characterId === 'lin-yingxue');
    expect(forLin).toHaveLength(1);
    expect(forLin[0].semanticLocationId).toBe('mistwood-inn');
  });

  it('publishes exactly one motion per character across a busy history', async () => {
    const store = new MemoryReadStore();
    const canon = new MemoryCanonStore([
      canonRow({ sequenceNumber: 1, characterId: 'wu-zhen', fromLocationId: 'mistwood-station', toLocationId: 'mistwood-square' }),
      canonRow({ sequenceNumber: 2, characterId: 'he-jun', fromLocationId: 'mistwood-mill', toLocationId: 'mistwood-inn' }),
      canonRow({ sequenceNumber: 3, characterId: 'wu-zhen', fromLocationId: 'mistwood-square', toLocationId: 'mistwood-clinic' }),
      canonRow({ sequenceNumber: 4, characterId: 'he-jun', fromLocationId: 'mistwood-inn', toLocationId: 'mistwood-square' }),
    ]);
    await rebuildOnce({ canon, store, nowMs: IN_TRANSIT_MS });

    const motions = await servedMotions(store);
    const ids = motions.map((motion) => motion.characterId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(motionFor(motions, 'wu-zhen').semanticLocationId).toBe('mistwood-clinic');
    expect(motionFor(motions, 'he-jun').semanticLocationId).toBe('mistwood-square');
  });
});

// ---------------------------------------------------------------------------
// AC#7 — stable error codes, reachable counts
// ---------------------------------------------------------------------------

describe('AC#7 — runtime problems carry stable codes and reach an operator', () => {
  it('counts an unbound destination by its stable code', async () => {
    const store = new MemoryReadStore();
    const canon = new MemoryCanonStore([UNBOUND_DESTINATION_MOVE]);
    const result = await rebuildOnce({ canon, store, nowMs: IN_TRANSIT_MS });

    expect(result.dynamicProblemCount).toBe(1);
    expect(result.dynamicProblemsByCode).toEqual({ VISUAL_RUNTIME_UNBOUND_LOCATION: 1 });

    // The count is the *only* trace of the omission: the character is genuinely gone from
    // the published payload, which is why the signal has to exist at all.
    const ids = (await servedMotions(store)).map((motion) => motion.characterId);
    expect(ids).not.toContain('shen-kai');
    expect(ids).toHaveLength(11);
  });

  it('reports zero problems for a world the runtime can fully place', async () => {
    const result = await rebuildOnce({
      canon: new MemoryCanonStore([WU_ZHEN_MOVE]),
      store: new MemoryReadStore(),
      nowMs: IN_TRANSIT_MS,
    });
    expect(result.dynamicProblemCount).toBe(0);
    expect(result.dynamicProblemsByCode).toEqual({});
  });

  it('counts each affected character separately', async () => {
    const result = await rebuildOnce({
      canon: new MemoryCanonStore([
        UNBOUND_DESTINATION_MOVE,
        canonRow({ sequenceNumber: 2, characterId: 'pei-lan', fromLocationId: 'mistwood-hall', toLocationId: 'mistwood-void' }),
      ]),
      store: new MemoryReadStore(),
      nowMs: IN_TRANSIT_MS,
    });
    expect(result.dynamicProblemCount).toBe(2);
    expect(result.dynamicProblemsByCode).toEqual({ VISUAL_RUNTIME_UNBOUND_LOCATION: 2 });
  });

  it('tallies by code and attributes each problem, but never carries the free-text message', () => {
    // ART-133 (FR-Q001 AC#4) widened this from counts-only: an operator cannot act on
    // "one location is unbound" without knowing WHICH character and WHICH location. What
    // stayed narrow is `message` — the only free-text field, and therefore the only one a
    // future edit could interpolate something private into.
    const summary = summarizeRuntimeProblems([
      { code: 'VISUAL_RUNTIME_UNBOUND_LOCATION', characterId: 'a', locationId: 'l1', message: 'private prose' },
      { code: 'VISUAL_RUNTIME_NO_PATH', characterId: 'b', locationId: 'l2', message: 'private prose' },
      { code: 'VISUAL_RUNTIME_NO_PATH', characterId: 'c', locationId: 'l3', message: 'private prose' },
    ]);
    expect(summary.total).toBe(3);
    expect(summary.byCode).toEqual({ VISUAL_RUNTIME_UNBOUND_LOCATION: 1, VISUAL_RUNTIME_NO_PATH: 2 });
    expect(summary.records).toEqual([
      { code: 'VISUAL_RUNTIME_UNBOUND_LOCATION', characterId: 'a', locationId: 'l1' },
      { code: 'VISUAL_RUNTIME_NO_PATH', characterId: 'b', locationId: 'l2' },
      { code: 'VISUAL_RUNTIME_NO_PATH', characterId: 'c', locationId: 'l3' },
    ]);
    expect(JSON.stringify(summary)).not.toContain('private prose');
    expect(JSON.stringify(summary)).not.toContain('message');
  });

  it('never lets the summary reach the published payload', async () => {
    const store = new MemoryReadStore();
    await rebuildOnce({
      canon: new MemoryCanonStore([UNBOUND_DESTINATION_MOVE]),
      store,
      nowMs: IN_TRANSIT_MS,
    });
    const served = await serveReadModel(store, WORLD_ID, LIVE_MODEL_KIND, LIVE_REF);
    const serialized = JSON.stringify(served?.payload);
    expect(serialized).not.toContain('VISUAL_RUNTIME_UNBOUND_LOCATION');
    expect(serialized).not.toContain('dynamicProblemCount');
    expect(serialized).not.toContain('movementPhase');
  });
});

// ---------------------------------------------------------------------------
// In-memory stores. Local to this suite, per the repo's convention of not sharing fakes.
// ---------------------------------------------------------------------------

/**
 * Canon as the rebuild path is allowed to see it: rows in, nothing out. There is no insert,
 * patch or delete, because the production path has no Canon write available to it either —
 * `convex/visualRuntime/` cannot import one (`module-boundaries.json`'s `canonWriteBoundary`,
 * enforced by `npm run check:architecture` and `visualRuntime.purity.test.ts`). Any future
 * attempt to write from here would fail to compile rather than corrupt history.
 */
class MemoryCanonStore {
  constructor(private readonly rows: readonly CanonEventRow[]) {}

  read(): readonly CanonEventRow[] {
    return this.rows.map((row) => structuredClone(row));
  }

  /** Serialized history, for asserting that a rebuild changed nothing at all. */
  snapshot(): string {
    return JSON.stringify(this.rows);
  }
}

type MarkCurrentPatch = Parameters<PublicReadStore['markCurrent']>[1];

class MemoryReadStore implements PublicReadStore {
  readonly rows: StoredReadModel[] = [];
  private counter = 0;
  insertShouldThrow = false;

  loadTargetVersions(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<readonly StoredReadModel[]> {
    return Promise.resolve(this.rows.filter((row) => row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef));
  }
  findCurrent(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<StoredReadModel | null> {
    return Promise.resolve(this.rows.find((row) => row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isCurrent) ?? null);
  }
  loadLastKnownGood(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<readonly StoredReadModel[]> {
    return Promise.resolve(this.rows.filter((row) => row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isLastKnownGood));
  }
  insertVersion(record: PublishedReadModel): Promise<string> {
    if (this.insertShouldThrow) throw new Error('PROJECTION_WRITE_UNAVAILABLE');
    this.counter += 1;
    const id = `id-${this.counter}`;
    this.rows.push({ ...record, id });
    return Promise.resolve(id);
  }
  markCurrent(rowId: string, patch: MarkCurrentPatch): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === rowId);
    if (!row) throw new Error('ROW_NOT_FOUND');
    row.isCurrent = patch.isCurrent;
    row.isLastKnownGood = patch.isLastKnownGood;
    row.status = patch.status;
    return Promise.resolve();
  }
}
