/**
 * Dynamic view observability (FR-Q001 / ART-133).
 *
 * Organised by the acceptance criterion each block discharges. Two of the five criteria
 * are about what the system must NOT do — record private data, and let diagnostics reach
 * the public payload — so those blocks assert absence over a deliberately hostile input
 * rather than over a happy path.
 *
 * The end-to-end blocks drive {@link rebuildOnce}, a transcription of
 * `rebuildLiveProjection`'s handler with `ctx.db` replaced by in-memory stores, calling the
 * REAL `collectIncidents` and `commitDynamicViewMetrics`. The claims worth making here —
 * "the published payload did not change", "no Canon row was written" — are claims about
 * what happens around the pure functions, and a test of the pure functions alone could not
 * make them. Fakes are local to this suite, per the repo's convention.
 */

import type { AcceptedEvent } from '../canon/model';
import { MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { rowToAcceptedEvent, type CanonEventRow } from '../canon/serialize';
import { buildMistwoodCharacterVisualBindings } from '../visual/mistwoodVisualBindings';
import { detectUnboundCharacters } from '../visualRuntime/characterBindings';
import { FIXTURE_ACCEPTED_AT_MS, MISTWOOD_SEED_PLACEMENTS } from '../visualRuntime/fixtures';
import { mistwoodRuntimeContext } from '../visualRuntime/mistwoodRuntime';
import { VISUAL_RUNTIME_PROBLEM_CODES, type VisualRuntimeProblem } from '../visualRuntime/motion';
import { detectLocationMismatches } from './canonRuntimeMismatch';
import {
  DYNAMIC_INCIDENT_CODES,
  DYNAMIC_INCIDENT_FIELDS,
  DYNAMIC_VIEW_METRICS,
  DYNAMIC_VIEW_METRIC_KEYS,
  LATENCY_BUCKET_BOUNDS_MS,
  LATENCY_BUCKET_COUNT,
  METRIC_PROVENANCE,
  assertDynamicViewIncident,
  emptyLatencyBuckets,
  latencyBucketIndex,
  latencyQuantileMs,
  toIncident,
  type DynamicViewIncident,
  type DynamicViewIncidentRow,
} from './dynamicViewMetrics';
import {
  commitDynamicViewMetrics,
  type DynamicViewMetricRollup,
  type DynamicViewMetricsStore,
  type StoredDynamicViewMetricRollup,
} from './dynamicViewMetricsFunctions';
import { canonCharacterLocations, collectIncidents } from './liveStateFunctions';
import {
  LIVE_MODEL_KIND,
  buildLiveProjection,
  liveSourceEventIds,
} from './liveState';
import {
  PUBLIC_DYNAMIC_FORBIDDEN_FIELDS,
  buildPublicDynamicProjectionResult,
  selectPublicDynamicProjection,
  type PublicCharacterMotion,
} from './publicDynamicProjection';
import {
  SERVABLE_STATUS,
  commitReadModelVersion,
  serveReadModel,
  type JsonValue,
  type PublishedReadModel,
  type PublicReadStore,
  type StoredReadModel,
} from './readModel';

const WORLD_ID = MISTWOOD_PUBLIC_WORLD_ID;
const LIVE_REF = `live:${WORLD_ID}`;
const IN_TRANSIT_MS = FIXTURE_ACCEPTED_AT_MS + 1_000;

// ---------------------------------------------------------------------------
// Fixtures and fakes
// ---------------------------------------------------------------------------

function canonRow(args: {
  readonly sequenceNumber: number;
  readonly characterId: string;
  readonly fromLocationId: string;
  readonly toLocationId: string;
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
      worldDay: 1,
      timeSlot: 'morning',
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

/** A clean move: station to square, both zones bound, a walkable road between them. */
const WU_ZHEN_MOVE = canonRow({
  sequenceNumber: 0,
  characterId: 'wu-zhen',
  fromLocationId: 'mistwood-station',
  toLocationId: 'mistwood-square',
});

/** `mistwood-nowhere` has no Location Visual Binding, so no position can be published. */
const UNBOUND_DESTINATION_MOVE = canonRow({
  sequenceNumber: 0,
  characterId: 'shen-kai',
  fromLocationId: 'mistwood-square',
  toLocationId: 'mistwood-nowhere',
});

class MemoryReadStore implements PublicReadStore {
  readonly rows: StoredReadModel[] = [];
  private counter = 0;
  async loadTargetVersions(worldId: string, modelKind: string, modelRef: string) {
    return Promise.resolve(this.rows.filter((row) =>
      row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef));
  }
  async findCurrent(worldId: string, modelKind: string, modelRef: string) {
    return Promise.resolve(this.rows.find((row) =>
      row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isCurrent) ?? null);
  }
  async loadLastKnownGood(worldId: string, modelKind: string, modelRef: string) {
    return Promise.resolve(this.rows.filter((row) =>
      row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isLastKnownGood));
  }
  async insertVersion(record: PublishedReadModel): Promise<string> {
    this.counter += 1;
    const id = `row-${this.counter}`;
    this.rows.push({ ...record, id });
    return Promise.resolve(id);
  }
  async markCurrent(rowId: string, patch: { isCurrent: boolean; isLastKnownGood: boolean; status: never; updatedAt: number }) {
    const row = this.rows.find((candidate) => candidate.id === rowId);
    if (row) { row.isCurrent = patch.isCurrent; row.isLastKnownGood = patch.isLastKnownGood; row.status = patch.status; }
    return Promise.resolve();
  }
}

class MemoryMetricsStore implements DynamicViewMetricsStore {
  readonly incidents: DynamicViewIncidentRow[] = [];
  private rollup: StoredDynamicViewMetricRollup | null = null;
  async loadRollup(worldId: string) {
    return Promise.resolve(this.rollup?.worldId === worldId ? this.rollup : null);
  }
  async insertRollup(row: DynamicViewMetricRollup) {
    this.rollup = { ...row, id: 'rollup-1' };
    return Promise.resolve('rollup-1');
  }
  async patchRollup(_rowId: string, patch: Omit<DynamicViewMetricRollup, 'schemaVersion' | 'worldId'>) {
    if (this.rollup) this.rollup = { ...this.rollup, ...patch };
    return Promise.resolve();
  }
  async insertIncident(row: DynamicViewIncidentRow) {
    this.incidents.push(row);
    return Promise.resolve(`incident-${this.incidents.length}`);
  }
  current(): StoredDynamicViewMetricRollup | null {
    return this.rollup;
  }
}

type RebuildResult = {
  readonly version: number;
  readonly deduplicated: boolean;
  readonly contentHash: string;
  readonly latencyMs: number;
  readonly incidents: readonly DynamicViewIncident[];
};

/**
 * `rebuildLiveProjection`'s handler with the database replaced. Arcs and episodes stay
 * empty — they are FR-I002 inputs and change nothing about the motion this task measures.
 */
async function rebuildOnce(args: {
  readonly canonRows: readonly CanonEventRow[];
  readonly store: MemoryReadStore;
  readonly metrics: MemoryMetricsStore;
  readonly nowMs: number;
  /** Lets a test seed a Canon/runtime divergence the real pipeline cannot produce. */
  readonly canonLocationsOverride?: Record<string, string>;
}): Promise<RebuildResult> {
  const acceptedEvents: AcceptedEvent[] = args.canonRows.map(rowToAcceptedEvent);
  const runtime = mistwoodRuntimeContext();
  const derived = buildPublicDynamicProjectionResult({
    worldId: WORLD_ID,
    nowMs: args.nowMs,
    runtime,
    seedPlacements: MISTWOOD_SEED_PLACEMENTS,
    acceptedEvents,
    worldStatus: 'running',
    activeScenes: [],
  });
  const dynamic = derived.projection;
  const payload = buildLiveProjection({
    worldId: WORLD_ID, acceptedEvents, arcs: [], publishedEpisode: null, dynamic,
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

  const canonLocations = args.canonLocationsOverride ?? canonCharacterLocations(WORLD_ID, acceptedEvents);
  const incidents = collectIncidents({ dynamic, runtime, problems: derived.problems.records, canonLocations });
  const latencyMs = dynamic.snapshotSequence > 0 ? Math.max(0, args.nowMs - dynamic.updatedAt) : 0;
  await commitDynamicViewMetrics(args.metrics, {
    worldId: WORLD_ID, incidents, latencyMs, snapshotSequence: dynamic.snapshotSequence, now: args.nowMs,
  });

  return {
    version: result.version,
    deduplicated: result.deduplicated,
    contentHash: args.store.rows[args.store.rows.length - 1].contentHash,
    latencyMs,
    incidents,
  };
}

function motion(overrides: Partial<PublicCharacterMotion> = {}): PublicCharacterMotion {
  return {
    characterId: 'wu-zhen',
    semanticLocationId: 'mistwood-square',
    motionType: 'canon',
    motionSequence: 4,
    from: { x: 1, y: 1 },
    to: { x: 2, y: 2 },
    startedAt: 10,
    arriveAt: 20,
    animationState: 'idle',
    direction: 'down',
    ...overrides,
  };
}

function validIncidentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    worldId: WORLD_ID,
    code: 'CANON_RUNTIME_LOCATION_MISMATCH',
    characterId: 'wu-zhen',
    locationId: 'mistwood-square',
    canonLocationId: 'mistwood-inn',
    motionSequence: 4,
    snapshotSequence: 7,
    detectedAt: 1_700_000_000_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC#1 — every FR-Q001 metric is recorded, or is declared unrecordable
// ---------------------------------------------------------------------------

describe('AC#1 — the registry covers every FR-Q001 metric exactly once', () => {
  it('declares the eleven metrics PRD 2.0 §12 FR-Q001 names, in PRD order', () => {
    // Transcribed from the PRD sentence itself. The last item is one metric carrying two
    // counters ("播放次數與跳過率"), not two metrics, which is why the count is eleven.
    expect(DYNAMIC_VIEW_METRICS.map((metric) => metric.prdName)).toEqual([
      'Runtime Projection 更新延遲',
      'Snapshot 年齡',
      'Active Viewer 數量',
      'Renderer Error Rate',
      'Canon／Runtime Location Mismatch',
      'Missing Character Binding',
      'Missing Location Binding',
      'Public Mutation Attempt',
      'Viewer-triggered LLM Call Count',
      '降級模式使用率',
      'Replay 播放次數與跳過率',
    ]);
    expect(DYNAMIC_VIEW_METRICS).toHaveLength(11);
  });

  it('gives every metric a unique key and a declared provenance', () => {
    expect(new Set(DYNAMIC_VIEW_METRIC_KEYS).size).toBe(DYNAMIC_VIEW_METRICS.length);
    for (const metric of DYNAMIC_VIEW_METRICS) {
      expect(METRIC_PROVENANCE).toContain(metric.provenance);
    }
  });

  it('names an owning task for exactly the metrics that are not measured here', () => {
    // The point of the registry: an unmeasured metric is visibly assigned, not silently
    // missing. A measured one has nothing outstanding and must not name an owner, or the
    // list of "what is still owed" stops meaning anything.
    for (const metric of DYNAMIC_VIEW_METRICS) {
      const unmeasured = metric.provenance === 'client_external' || metric.provenance === 'pending_feature';
      expect({ key: metric.key, hasOwner: metric.owner !== null }).toEqual({ key: metric.key, hasOwner: unmeasured });
    }
    expect(DYNAMIC_VIEW_METRICS.filter((metric) => metric.provenance === 'client_external').map((m) => m.owner))
      .toEqual(['ART-136', 'ART-137']);
    expect(DYNAMIC_VIEW_METRICS.filter((metric) => metric.provenance === 'pending_feature').map((m) => m.owner))
      .toEqual(['ART-127', 'ART-121']);
  });

  it('derives the incident codes from the runtime rather than restating them', () => {
    // A new Visual Runtime problem code must become recordable automatically. Restating
    // the list here is exactly how a new code would end up detected and then dropped.
    for (const code of VISUAL_RUNTIME_PROBLEM_CODES) expect(DYNAMIC_INCIDENT_CODES).toContain(code);
    expect(DYNAMIC_INCIDENT_CODES).toHaveLength(VISUAL_RUNTIME_PROBLEM_CODES.length + 1);
    expect(DYNAMIC_INCIDENT_CODES).toContain('CANON_RUNTIME_LOCATION_MISMATCH');
  });

  it('records latency for a real rebuild', async () => {
    const metrics = new MemoryMetricsStore();
    const result = await rebuildOnce({
      canonRows: [WU_ZHEN_MOVE], store: new MemoryReadStore(), metrics, nowMs: IN_TRANSIT_MS,
    });
    expect(result.latencyMs).toBe(IN_TRANSIT_MS - (FIXTURE_ACCEPTED_AT_MS + WU_ZHEN_MOVE.sequenceNumber));
    const rollup = metrics.current();
    expect(rollup?.rebuildCount).toBe(1);
    expect(rollup?.latencyBuckets.reduce((sum, count) => sum + count, 0)).toBe(1);
  });

  it('measures a world with no history as zero rather than as decades', async () => {
    // `updatedAt` is 0 with no accepted event, so subtracting it from a real clock would
    // report a world seeded a moment ago as fifty-five years behind.
    const metrics = new MemoryMetricsStore();
    const result = await rebuildOnce({
      canonRows: [], store: new MemoryReadStore(), metrics, nowMs: IN_TRANSIT_MS,
    });
    expect(result.latencyMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC#2 / AC#3 — the two structural zeros
// ---------------------------------------------------------------------------

describe('AC#2/AC#3 — the zero counters are structural, and the rebuild stays read-only', () => {
  it('writes no Canon row while recording metrics', async () => {
    const canonRows = [WU_ZHEN_MOVE];
    const before = JSON.stringify(canonRows);
    await rebuildOnce({
      canonRows, store: new MemoryReadStore(), metrics: new MemoryMetricsStore(), nowMs: IN_TRANSIT_MS,
    });
    expect(canonRows).toHaveLength(1);
    expect(JSON.stringify(canonRows)).toBe(before);
  });

  it('skips mismatch detection rather than failing the rebuild when Canon cannot be folded', () => {
    // A sequence gap is a hard error for the reducer, and rightly so — but the PUBLIC read
    // path must not go down because a diagnostic could not be computed. `null` is the
    // declared "not comparable this pass" answer.
    const gapped = [canonRow({ sequenceNumber: 5, characterId: 'wu-zhen', fromLocationId: 'a', toLocationId: 'b' })]
      .map(rowToAcceptedEvent);
    expect(canonCharacterLocations(WORLD_ID, gapped)).toBeNull();
    expect(canonCharacterLocations(WORLD_ID, [rowToAcceptedEvent(WU_ZHEN_MOVE)]))
      .toEqual({ 'wu-zhen': 'mistwood-square' });
  });
});

// ---------------------------------------------------------------------------
// AC#4 — a defect is attributable to a character, a location and a sequence
// ---------------------------------------------------------------------------

describe('AC#4 — Canon/runtime mismatches are attributed', () => {
  it('reports one incident carrying both locations and both sequences', () => {
    const incidents = detectLocationMismatches({
      characters: [motion({ characterId: 'wu-zhen', semanticLocationId: 'mistwood-square', motionSequence: 4 })],
      canonLocations: { 'wu-zhen': 'mistwood-inn' },
      snapshotSequence: 9,
    });
    expect(incidents).toEqual([{
      code: 'CANON_RUNTIME_LOCATION_MISMATCH',
      characterId: 'wu-zhen',
      locationId: 'mistwood-square',
      canonLocationId: 'mistwood-inn',
      motionSequence: 4,
      snapshotSequence: 9,
    }]);
  });

  it('treats a character Canon has never moved as agreement, not as drift', () => {
    // Canon records a location only once a character MOVES, so a seeded character has no
    // entry. Calling that a mismatch would make every fresh world report twelve faults on
    // day one and train an operator to ignore the metric.
    expect(detectLocationMismatches({
      characters: [motion({ characterId: 'lin-yingxue' })],
      canonLocations: {},
      snapshotSequence: 1,
    })).toEqual([]);
  });

  it('attributes two diverging characters to two separate rows', () => {
    const incidents = detectLocationMismatches({
      characters: [
        motion({ characterId: 'pei-lan', semanticLocationId: 'mistwood-hall', motionSequence: 2 }),
        motion({ characterId: 'wu-zhen', semanticLocationId: 'mistwood-square', motionSequence: 6 }),
      ],
      canonLocations: { 'pei-lan': 'mistwood-mill', 'wu-zhen': 'mistwood-inn' },
      snapshotSequence: 12,
    });
    expect(incidents.map((incident) => [incident.characterId, incident.locationId, incident.canonLocationId, incident.motionSequence]))
      .toEqual([
        ['pei-lan', 'mistwood-hall', 'mistwood-mill', 2],
        ['wu-zhen', 'mistwood-square', 'mistwood-inn', 6],
      ]);
  });

  it('records a seeded divergence end to end, through the real rebuild path', async () => {
    const metrics = new MemoryMetricsStore();
    await rebuildOnce({
      canonRows: [WU_ZHEN_MOVE],
      store: new MemoryReadStore(),
      metrics,
      nowMs: IN_TRANSIT_MS,
      // The pipeline agrees with itself today, so the divergence has to be injected to
      // prove the detector would catch one.
      canonLocationsOverride: { 'wu-zhen': 'mistwood-clinic' },
    });
    const mismatches = metrics.incidents.filter((row) => row.code === 'CANON_RUNTIME_LOCATION_MISMATCH');
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({
      worldId: WORLD_ID,
      characterId: 'wu-zhen',
      locationId: 'mistwood-square',
      canonLocationId: 'mistwood-clinic',
      snapshotSequence: 1,
      detectedAt: IN_TRANSIT_MS,
    });
    expect(mismatches[0].motionSequence).toBe(1);
    expect(metrics.current()?.incidentCountsByCode.CANON_RUNTIME_LOCATION_MISMATCH).toBe(1);
  });
});

describe('AC#4 — missing bindings are attributed', () => {
  const bindings = buildMistwoodCharacterVisualBindings();

  it('reports nothing when every published character has an active sprite', () => {
    const published = bindings.map((binding) => ({ characterId: binding.characterId, locationId: 'mistwood-hall' }));
    expect(detectUnboundCharacters(published, bindings)).toEqual([]);
  });

  it('names the character and the location it would have been drawn at', () => {
    const withoutPeiLan = bindings.filter((binding) => binding.characterId !== 'pei-lan');
    const problems = detectUnboundCharacters(
      [{ characterId: 'pei-lan', locationId: 'mistwood-hall' }],
      withoutPeiLan,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      code: 'VISUAL_RUNTIME_UNBOUND_CHARACTER',
      characterId: 'pei-lan',
      locationId: 'mistwood-hall',
    });
  });

  it('treats a retired binding as no binding', () => {
    // The row is kept for audit, but there is no sprite to draw from it.
    const retired = bindings.map((binding) =>
      binding.characterId === 'wu-zhen' ? { ...binding, status: 'retired' as const } : binding);
    expect(detectUnboundCharacters([{ characterId: 'wu-zhen', locationId: 'mistwood-square' }], retired))
      .toHaveLength(1);
  });

  it('attributes an unbound LOCATION without inventing a motion sequence', async () => {
    // The character was never published — there is no motion — so claiming sequence 0
    // would assert they are standing at their seeded position, which is exactly the
    // wrong conclusion.
    const metrics = new MemoryMetricsStore();
    await rebuildOnce({
      canonRows: [UNBOUND_DESTINATION_MOVE], store: new MemoryReadStore(), metrics, nowMs: IN_TRANSIT_MS,
    });
    const unbound = metrics.incidents.filter((row) => row.code === 'VISUAL_RUNTIME_UNBOUND_LOCATION');
    expect(unbound).toHaveLength(1);
    expect(unbound[0]).toMatchObject({ characterId: 'shen-kai', locationId: 'mistwood-nowhere' });
    expect(unbound[0].motionSequence).toBeUndefined();
    expect(unbound[0].canonLocationId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC#5 — no private character data is recorded
// ---------------------------------------------------------------------------

describe('AC#5 — the incident allowlist is the privacy gate', () => {
  it('accepts exactly the declared fields', () => {
    expect(() => assertDynamicViewIncident(validIncidentRow())).not.toThrow();
    expect([...DYNAMIC_INCIDENT_FIELDS].sort()).toEqual(Object.keys(validIncidentRow()).sort());
  });

  it('refuses any field the contract does not declare', () => {
    for (const extra of ['note', 'context', 'operatorId', 'detail']) {
      expect(() => assertDynamicViewIncident(validIncidentRow({ [extra]: 'x' })))
        .toThrow('DYNAMIC_METRICS_UNKNOWN_FIELD');
    }
  });

  it('refuses the free-text message even though the source problem carries one', () => {
    expect(() => assertDynamicViewIncident(validIncidentRow({ message: 'anything at all' })))
      .toThrow('DYNAMIC_METRICS_UNKNOWN_FIELD');
    // And the narrowing that produces a row cannot reintroduce it. A full runtime problem
    // is accepted — TypeScript's own excess-property check refuses the inline literal,
    // which is the drop being enforced by the signature rather than by discipline.
    const problem: VisualRuntimeProblem = {
      code: 'VISUAL_RUNTIME_NO_PATH', characterId: 'wu-zhen', locationId: 'mistwood-square', message: 'leak me',
    };
    const incident = toIncident(problem, 3);
    expect(Object.keys(incident)).not.toContain('message');
    expect(JSON.stringify(incident)).not.toContain('leak me');
  });

  it('refuses a forbidden field at any depth, not merely at the root', () => {
    for (const forbidden of PUBLIC_DYNAMIC_FORBIDDEN_FIELDS) {
      expect(() => assertDynamicViewIncident({ ...validIncidentRow(), [forbidden]: 'x' }))
        .toThrow('DYNAMIC_METRICS_FORBIDDEN_FIELD');
    }
    // Nested: the shallow allowlist alone would never look inside this object, so the
    // recursive walk is what catches a future "context bag".
    expect(() => assertDynamicViewIncident({
      ...validIncidentRow(),
      snapshotSequence: { deep: { memories: ['what the character privately recalls'] } },
    })).toThrow('DYNAMIC_METRICS_FORBIDDEN_FIELD');
  });

  it('shares no field name with the public forbidden list', () => {
    // A structural check, so a future field added to the incident contract cannot collide
    // with a name the public projection already refuses to publish.
    for (const field of DYNAMIC_INCIDENT_FIELDS) {
      expect(PUBLIC_DYNAMIC_FORBIDDEN_FIELDS).not.toContain(field);
    }
  });

  it('leaks nothing through a real rebuild that produced incidents', async () => {
    const metrics = new MemoryMetricsStore();
    await rebuildOnce({
      canonRows: [UNBOUND_DESTINATION_MOVE], store: new MemoryReadStore(), metrics, nowMs: IN_TRANSIT_MS,
    });
    expect(metrics.incidents.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(metrics.incidents);
    for (const forbidden of PUBLIC_DYNAMIC_FORBIDDEN_FIELDS) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
    expect(serialized).not.toContain('message');
    expect(serialized).not.toContain('has no active');
    for (const row of metrics.incidents) {
      expect(() => assertDynamicViewIncident(row)).not.toThrow();
    }
  });

  it('rolls the whole rebuild back rather than persisting a row it cannot validate', async () => {
    const metrics = new MemoryMetricsStore();
    await expect(commitDynamicViewMetrics(metrics, {
      worldId: WORLD_ID,
      incidents: [{ code: 'CANON_RUNTIME_LOCATION_MISMATCH', characterId: '', locationId: 'l', snapshotSequence: 1 }],
      latencyMs: 10,
      snapshotSequence: 1,
      now: IN_TRANSIT_MS,
    })).rejects.toThrow('DYNAMIC_METRICS_INVALID_VALUE');
    expect(metrics.incidents).toEqual([]);
    expect(metrics.current()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The published payload is unaffected
// ---------------------------------------------------------------------------

describe('recording a defect does not perturb what the public is served', () => {
  it('publishes no incident data, and deduplicates a repeated rebuild all the same', async () => {
    const store = new MemoryReadStore();
    const metrics = new MemoryMetricsStore();
    const first = await rebuildOnce({ canonRows: [UNBOUND_DESTINATION_MOVE], store, metrics, nowMs: IN_TRANSIT_MS });
    const second = await rebuildOnce({ canonRows: [UNBOUND_DESTINATION_MOVE], store, metrics, nowMs: IN_TRANSIT_MS });

    // The content digest is what stops a version row per rebuild. If an incident had
    // reached the payload it would move, and every rebuild would append a version.
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.deduplicated).toBe(true);
    expect(second.version).toBe(first.version);
    expect(store.rows).toHaveLength(1);

    // Metrics still accrued across both passes: the payload is unchanged, the record is not.
    expect(metrics.current()?.rebuildCount).toBe(2);
    expect(metrics.incidents.length).toBe(first.incidents.length * 2);

    const served = await serveReadModel(store, WORLD_ID, LIVE_MODEL_KIND, LIVE_REF);
    const serialized = JSON.stringify(served?.payload);
    for (const code of DYNAMIC_INCIDENT_CODES) expect(serialized).not.toContain(code);
    expect(serialized).not.toContain('problems');
    expect(serialized).not.toContain('canonLocationId');
    // And the projection itself still validates as the §10.4 contract.
    expect(selectPublicDynamicProjection(served?.payload)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The latency histogram
// ---------------------------------------------------------------------------

describe('the latency histogram is bounded and reports honestly', () => {
  it('puts a sample in the first bucket whose bound it does not exceed', () => {
    expect(latencyBucketIndex(0)).toBe(0);
    expect(latencyBucketIndex(LATENCY_BUCKET_BOUNDS_MS[0])).toBe(0);
    expect(latencyBucketIndex(LATENCY_BUCKET_BOUNDS_MS[0] + 1)).toBe(1);
    // Anything past the last bound overflows, which is why there is one more bucket
    // than there are bounds.
    expect(latencyBucketIndex(LATENCY_BUCKET_BOUNDS_MS[LATENCY_BUCKET_BOUNDS_MS.length - 1] + 1))
      .toBe(LATENCY_BUCKET_COUNT - 1);
    expect(emptyLatencyBuckets()).toHaveLength(LATENCY_BUCKET_COUNT);
  });

  it("carries the PRD's stated P95 target as a bucket edge", () => {
    // So a regression shows up as samples crossing one boundary rather than as a number
    // that has to be compared against a target held somewhere else.
    expect(LATENCY_BUCKET_BOUNDS_MS).toContain(5000);
  });

  it('reports a quantile as a bucket bound, and null when there is nothing to report', () => {
    expect(latencyQuantileMs(emptyLatencyBuckets(), 0.95)).toBeNull();
    const buckets = emptyLatencyBuckets();
    buckets[0] = 99;
    buckets[3] = 1;
    expect(latencyQuantileMs(buckets, 0.5)).toBe(LATENCY_BUCKET_BOUNDS_MS[0]);
    expect(latencyQuantileMs(buckets, 0.999)).toBe(LATENCY_BUCKET_BOUNDS_MS[3]);
    // A quantile landing in the overflow bucket has no upper bound; inventing one would
    // be worse than saying so, and `latencyMaxMs` is the honest answer there.
    const overflowed = emptyLatencyBuckets();
    overflowed[LATENCY_BUCKET_COUNT - 1] = 1;
    expect(latencyQuantileMs(overflowed, 0.95)).toBeNull();
  });

  it('keeps one row per world however many rebuilds happen', async () => {
    const metrics = new MemoryMetricsStore();
    for (let index = 0; index < 5; index += 1) {
      await commitDynamicViewMetrics(metrics, {
        worldId: WORLD_ID, incidents: [], latencyMs: index * 400, snapshotSequence: index, now: 1_000 + index,
      });
    }
    const rollup = metrics.current();
    expect(rollup?.rebuildCount).toBe(5);
    expect(rollup?.latencyMaxMs).toBe(1600);
    expect(rollup?.latencyBuckets.reduce((sum, count) => sum + count, 0)).toBe(5);
    expect(rollup?.lastSnapshotSequence).toBe(4);
  });

  it('clamps a backwards clock rather than persisting a negative duration', async () => {
    const metrics = new MemoryMetricsStore();
    await commitDynamicViewMetrics(metrics, {
      worldId: WORLD_ID, incidents: [], latencyMs: -5_000, snapshotSequence: 1, now: 1_000,
    });
    expect(metrics.current()?.latencyMaxMs).toBe(0);
    expect(metrics.current()?.latencyBuckets[0]).toBe(1);
  });
});
