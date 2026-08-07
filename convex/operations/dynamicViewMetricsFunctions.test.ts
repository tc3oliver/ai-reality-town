/**
 * The operator read surface for dynamic view metrics (FR-Q001 / ART-133).
 *
 * Handler-level, following ART-128's pattern: the registered function's `_handler` is
 * invoked directly with a fake `ctx`, so the authorization gate and the response shape are
 * exercised as they actually run rather than as they are declared.
 *
 * The AC#3 block is the interesting one. FR-Q001 asks that public mutation attempts be
 * "rejected and recorded", and this task deliberately does NOT add a durable per-attempt
 * table — `opsConsoleFunctions.ts` already established that a Convex mutation rolls its own
 * audit row back on the way to a throw, so such a table cannot work, and an unauthenticated
 * caller who could append a row per attempt would have a storage-exhaustion vector. The
 * tests below therefore prove the LIMITATION IS DECLARED rather than proving a counter
 * exists, and prove the rejection half structurally by iterating the policy.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DYNAMIC_VIEW_METRICS, LATENCY_BUCKET_BOUNDS_MS, emptyLatencyBuckets } from '../publicRead/dynamicViewMetrics';
import { OPS_CAPABILITIES, OPS_UNAUTHORIZED } from './operatorAuthorization';
import { inspectDynamicViewMetrics } from './dynamicViewMetricsFunctions';

const ROOT = process.cwd();
const WORLD_ID = 'mistwood';
const NOW = Date.now();

type Registered = {
  isQuery?: boolean;
  isMutation?: boolean;
  isPublic?: boolean;
  isInternal?: boolean;
  exportArgs: () => string;
  _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

const handler = inspectDynamicViewMetrics as unknown as Registered;

const REGISTRY = JSON.stringify([
  { operatorId: 'op-real', role: 'viewer', subjects: [], token: 'correct-horse-battery-staple' },
]);

const CREDENTIALS = { operatorId: 'op-real', operatorToken: 'correct-horse-battery-staple' };

// ---------------------------------------------------------------------------
// A `db` that answers from fixture arrays, keyed by table.
// ---------------------------------------------------------------------------

type Tables = {
  dynamicViewMetricRollups: Record<string, unknown>[];
  dynamicViewIncidents: Record<string, unknown>[];
  worldSchedules: Record<string, unknown>[];
  publicRuntimeSnapshots: Record<string, unknown>[];
  operatorAuditLog: Record<string, unknown>[];
  llmTraces: Record<string, unknown>[];
};

function emptyTables(): Tables {
  return {
    dynamicViewMetricRollups: [],
    dynamicViewIncidents: [],
    worldSchedules: [],
    publicRuntimeSnapshots: [],
    operatorAuditLog: [],
    llmTraces: [],
  };
}

/**
 * Minimal Convex query surface. `withIndex` records the equality constraints the handler
 * asked for and filters on them, so a handler that queried the wrong index or forgot to
 * scope by world would return the wrong fixtures rather than silently passing.
 */
function fakeDb(tables: Tables) {
  return {
    query(table: keyof Tables) {
      let rows = [...tables[table]];
      const chain = {
        withIndex(_name: string, build: (q: unknown) => unknown) {
          const constraints: Array<[string, unknown]> = [];
          const q = {
            eq(field: string, value: unknown) { constraints.push([field, value]); return q; },
            gte(field: string, value: unknown) { constraints.push([`${field}>=`, value]); return q; },
            lt(field: string, value: unknown) { constraints.push([`${field}<`, value]); return q; },
          };
          build(q);
          rows = rows.filter((row) => constraints.every(([field, value]) => {
            if (field.endsWith('>=')) return (row[field.slice(0, -2)] as number) >= (value as number);
            if (field.endsWith('<')) return (row[field.slice(0, -1)] as number) < (value as number);
            return row[field] === value;
          }));
          return chain;
        },
        order() { return chain; },
        take(count: number) { return Promise.resolve(rows.slice(0, count)); },
        collect() { return Promise.resolve(rows); },
        unique() { return Promise.resolve(rows[0] ?? null); },
        first() { return Promise.resolve(rows[0] ?? null); },
      };
      return chain;
    },
  };
}

function operatorCtx(tables: Tables) {
  return { auth: { getUserIdentity: () => Promise.resolve(null) }, db: fakeDb(tables) };
}

/** A `db` that throws on any access, to prove the gate refuses before it reads. */
function anonymousCtx() {
  const state = { touched: false };
  const db = new Proxy({}, {
    get(_target, property) {
      state.touched = true;
      throw new Error(`unauthorized caller reached the database: .${String(property)}`);
    },
  });
  return { ctx: { auth: { getUserIdentity: () => Promise.resolve(null) }, db }, state };
}

type MetricEntry = {
  key: string;
  prdName: string;
  provenance: string;
  owner: string | null;
  value: unknown;
  reason: string | null;
};

type Response = { worldId: string; generatedAt: number; windowMs: number; metrics: MetricEntry[] };

async function inspect(tables: Tables, args: Record<string, unknown> = {}): Promise<Response> {
  return handler._handler(operatorCtx(tables), { ...CREDENTIALS, worldId: WORLD_ID, ...args }) as Promise<Response>;
}

function metricOf(response: Response, key: string): MetricEntry {
  const entry = response.metrics.find((metric) => metric.key === key);
  if (!entry) throw new Error(`no metric ${key} in the response`);
  return entry;
}

// ---------------------------------------------------------------------------

describe('the read is operator-gated, and gated before it reads', () => {
  const prior = process.env.SIMULATION_OPS_OPERATORS;
  const priorIssuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
  beforeEach(() => {
    process.env.SIMULATION_OPS_OPERATORS = REGISTRY;
    delete process.env.CLERK_JWT_ISSUER_DOMAIN;
  });
  afterEach(() => {
    if (prior === undefined) delete process.env.SIMULATION_OPS_OPERATORS;
    else process.env.SIMULATION_OPS_OPERATORS = prior;
    if (priorIssuer === undefined) delete process.env.CLERK_JWT_ISSUER_DOMAIN;
    else process.env.CLERK_JWT_ISSUER_DOMAIN = priorIssuer;
  });

  it('is a public query and never a mutation', () => {
    // FR-Q001 reports; FR-Q002 controls. A mutation here would be scope this task does
    // not own, and would also become the first non-operator-reviewed console write.
    expect(handler.isQuery).toBe(true);
    expect(handler.isMutation).toBeUndefined();
    expect(handler.isPublic).toBe(true);
    expect(handler.isInternal).toBeUndefined();
  });

  it('refuses an unauthenticated caller before touching a row', async () => {
    const { ctx, state } = anonymousCtx();
    await expect(handler._handler(ctx, { worldId: WORLD_ID })).rejects.toThrow(OPS_UNAUTHORIZED);
    expect(state.touched).toBe(false);
  });

  it('refuses forged credentials with the same uniform denial', async () => {
    for (const forgery of [
      { operatorId: 'op-real', operatorToken: 'wrong-token' },
      { operatorId: 'op-attacker', operatorToken: 'correct-horse-battery-staple' },
      {},
    ]) {
      const { ctx, state } = anonymousCtx();
      await expect(handler._handler(ctx, { worldId: WORLD_ID, ...forgery })).rejects.toThrow(OPS_UNAUTHORIZED);
      expect(state.touched).toBe(false);
    }
  });

  it('reuses the existing schedule.inspect capability rather than minting one', () => {
    // Capability expansion belongs to FR-Q002 / ART-134. Adding one here would edit the
    // matched OPS_CAPABILITIES / CAPABILITY_MINIMUM_ROLE pair that task will also edit.
    const source = readFileSync(join(ROOT, 'convex/operations/dynamicViewMetricsFunctions.ts'), 'utf8');
    expect(source).toContain("requireOperator(ctx, 'schedule.inspect', args)");
    expect(OPS_CAPABILITIES).toContain('schedule.inspect');
    const invented = [...source.matchAll(/requireOperator\(ctx,\s*'([^']+)'/g)].map((match) => match[1]);
    expect(invented).toEqual(['schedule.inspect']);
    for (const capability of invented) expect(OPS_CAPABILITIES).toContain(capability);
  });

  it('declares no character-control argument', () => {
    const declared = Object.keys(
      (JSON.parse(handler.exportArgs()) as { value?: Record<string, unknown> }).value ?? {},
    );
    expect(declared.sort()).toEqual(['limit', 'operatorId', 'operatorToken', 'windowMs', 'worldId']);
    for (const forbidden of ['characterId', 'playerId', 'destination', 'message', 'action']) {
      expect(declared).not.toContain(forbidden);
    }
  });

  describe('the response', () => {
    it('AC#1 — returns exactly one entry per registry key, even for an empty world', async () => {
      const response = await inspect(emptyTables());
      expect(response.metrics.map((metric) => metric.key)).toEqual(DYNAMIC_VIEW_METRICS.map((metric) => metric.key));
      for (const metric of response.metrics) {
        // Every entry is either measured or carries a reason it is not. Neither a silent
        // null nor a bare value with no provenance is a legal answer.
        expect(metric.provenance).toBeTruthy();
        expect(metric.value !== null || (metric.reason ?? '').length > 0).toBe(true);
      }
    });

    it('AC#1 — reports latency percentiles from the rollup histogram', async () => {
      const tables = emptyTables();
      const buckets = emptyLatencyBuckets();
      buckets[0] = 9;
      buckets[3] = 1;
      tables.dynamicViewMetricRollups.push({
        schemaVersion: 1, worldId: WORLD_ID, rebuildCount: 10, latencyBuckets: buckets,
        latencyMaxMs: 4_800, incidentCountsByCode: {}, lastRebuildAt: NOW, lastSnapshotSequence: 12, updatedAt: NOW,
      });
      const latency = metricOf(await inspect(tables), 'runtimeProjectionLatency');
      expect(latency.provenance).toBe('server_measured');
      expect(latency.value).toMatchObject({
        p50Ms: LATENCY_BUCKET_BOUNDS_MS[0],
        p95Ms: LATENCY_BUCKET_BOUNDS_MS[3],
        maxMs: 4_800,
        sampleCount: 10,
        rebuildCount: 10,
        lastSnapshotSequence: 12,
      });
    });

    it('AC#1 — says so, rather than reporting zero, when no rebuild has happened', async () => {
      const latency = metricOf(await inspect(emptyTables()), 'runtimeProjectionLatency');
      expect(latency.value).toBeNull();
      expect(latency.reason).toContain('No rebuild');
    });

    it('AC#1 — aggregates snapshot age across public worlds, including paused ones', async () => {
      const tables = emptyTables();
      tables.worldSchedules.push(
        { worldId: WORLD_ID, mode: 'public', status: 'running' },
        { worldId: 'w-paused', mode: 'public', status: 'paused' },
        { worldId: 'w-dev', mode: 'development', status: 'running' },
      );
      tables.publicRuntimeSnapshots.push(
        {
          worldId: WORLD_ID, isCurrent: true, status: 'live', sourceRuntimeSequence: 4,
          contentUpdatedAt: NOW - 1_000, createdAt: NOW - 1_000, observedAt: NOW - 1_000,
        },
        {
          worldId: 'w-paused', isCurrent: true, status: 'paused', sourceRuntimeSequence: 2,
          contentUpdatedAt: NOW - 90_000_000, createdAt: NOW - 90_000_000, observedAt: NOW - 90_000_000,
        },
      );
      const age = metricOf(await inspect(tables), 'snapshotAge');
      expect(age.value).toMatchObject({
        worldCount: 2,
        observedWorlds: 2,
        byFreshness: { live: 1, delayed: 0, paused: 1, stale: 0 },
      });
      // The oldest is the paused one; `paused` is a verdict about the world, not a claim
      // that its content is fresh.
      expect((age.value as { oldestContentAgeMs: number }).oldestContentAgeMs).toBeGreaterThan(80_000_000);
    });

    it('AC#4 — surfaces attributed incidents, not just counts', async () => {
      const tables = emptyTables();
      tables.dynamicViewMetricRollups.push({
        schemaVersion: 1, worldId: WORLD_ID, rebuildCount: 3, latencyBuckets: emptyLatencyBuckets(),
        latencyMaxMs: 0, incidentCountsByCode: { CANON_RUNTIME_LOCATION_MISMATCH: 7 },
        lastRebuildAt: NOW, lastSnapshotSequence: 5, updatedAt: NOW,
      });
      tables.dynamicViewIncidents.push(
        {
          schemaVersion: 1, worldId: WORLD_ID, code: 'CANON_RUNTIME_LOCATION_MISMATCH',
          characterId: 'wu-zhen', locationId: 'mistwood-square', canonLocationId: 'mistwood-inn',
          motionSequence: 4, snapshotSequence: 5, detectedAt: NOW - 1_000,
        },
        {
          schemaVersion: 1, worldId: WORLD_ID, code: 'VISUAL_RUNTIME_UNBOUND_CHARACTER',
          characterId: 'pei-lan', locationId: 'mistwood-hall', snapshotSequence: 5, detectedAt: NOW - 1_000,
        },
        // Another world's row must not appear in this world's answer.
        {
          schemaVersion: 1, worldId: 'w-other', code: 'CANON_RUNTIME_LOCATION_MISMATCH',
          characterId: 'someone-else', locationId: 'elsewhere', snapshotSequence: 1, detectedAt: NOW - 1_000,
        },
      );
      const response = await inspect(tables);

      const mismatch = metricOf(response, 'canonRuntimeLocationMismatch');
      expect(mismatch.value).toMatchObject({ windowCount: 1, cumulativeCount: 7 });
      expect((mismatch.value as { recent: unknown[] }).recent).toEqual([{
        characterId: 'wu-zhen', locationId: 'mistwood-square', canonLocationId: 'mistwood-inn',
        motionSequence: 4, snapshotSequence: 5, detectedAt: NOW - 1_000,
      }]);
      expect(JSON.stringify(mismatch.value)).not.toContain('someone-else');

      const unbound = metricOf(response, 'missingCharacterBinding');
      expect((unbound.value as { recent: Array<{ characterId: string }> }).recent[0].characterId).toBe('pei-lan');
      // No motion sequence was recorded, so none is invented on the way out.
      expect((unbound.value as { recent: Array<Record<string, unknown>> }).recent[0].motionSequence).toBeUndefined();
    });

    it('AC#4 — drops an incident older than the window', async () => {
      const tables = emptyTables();
      tables.dynamicViewIncidents.push({
        schemaVersion: 1, worldId: WORLD_ID, code: 'VISUAL_RUNTIME_UNBOUND_LOCATION',
        characterId: 'shen-kai', locationId: 'mistwood-nowhere', snapshotSequence: 2, detectedAt: NOW - 10_000_000,
      });
      const wide = metricOf(await inspect(tables, { windowMs: 30 * 24 * 60 * 60 * 1000 }), 'missingLocationBinding');
      const narrow = metricOf(await inspect(tables, { windowMs: 1_000 }), 'missingLocationBinding');
      expect((wide.value as { windowCount: number }).windowCount).toBe(1);
      expect((narrow.value as { windowCount: number }).windowCount).toBe(0);
    });

    it('AC#2 — reports the viewer-triggered LLM call count as a structural zero', async () => {
      const tables = emptyTables();
      // Simulation traces exist and are NOT a violation: they come from scheduled work.
      tables.llmTraces.push(
        { worldId: WORLD_ID, worldDay: 3, recordedAt: NOW - 1_000 },
        { worldId: WORLD_ID, worldDay: 1, recordedAt: NOW - 200_000_000 },
      );
      const metric = metricOf(await inspect(tables), 'viewerTriggeredLlmCalls');
      expect(metric.provenance).toBe('structural_zero');
      expect(metric.value).toMatchObject({ count: 0, publicSurfaceIsQueriesOnly: true, traceCountInWindow: 1 });
      expect(metric.reason).toContain('query');
    });

    it('declares the two metrics the read-only boundary makes unmeasurable', async () => {
      // The alternative — a permanent 0 — is worse than a null: on a dashboard it is
      // indistinguishable from a healthy measurement, and an operator would act on it.
      for (const key of ['activeViewerCount', 'rendererErrorRate']) {
        const metric = metricOf(await inspect(emptyTables()), key);
        expect(metric.provenance).toBe('client_external');
        expect(metric.value).toBeNull();
        expect(metric.reason).toContain('read-only client boundary');
        expect(metric.owner).toMatch(/^ART-13[67]$/);
      }
    });

    it('declares the two metrics whose feature does not exist yet', async () => {
      for (const [key, owner] of [['degradationModeUsage', 'ART-127'], ['replayPlaySkipCounts', 'ART-121']]) {
        const metric = metricOf(await inspect(emptyTables()), key);
        expect(metric.provenance).toBe('pending_feature');
        expect(metric.value).toBeNull();
        expect(metric.owner).toBe(owner);
        expect(metric.reason).toContain('does not exist yet');
      }
    });

    it('clamps the window and the incident limit', async () => {
      expect((await inspect(emptyTables(), { windowMs: 10 ** 12 })).windowMs).toBe(30 * 24 * 60 * 60 * 1000);
      expect((await inspect(emptyTables(), { windowMs: -5 })).windowMs).toBe(1);
      const tables = emptyTables();
      for (let index = 0; index < 5; index += 1) {
        tables.dynamicViewIncidents.push({
          schemaVersion: 1, worldId: WORLD_ID, code: 'VISUAL_RUNTIME_UNBOUND_LOCATION',
          characterId: `c-${index}`, locationId: 'mistwood-nowhere', snapshotSequence: index, detectedAt: NOW - 10,
        });
      }
      const limited = metricOf(await inspect(tables, { limit: 2 }), 'missingLocationBinding');
      expect((limited.value as { recent: unknown[]; windowCount: number }).recent).toHaveLength(2);
      expect((limited.value as { windowCount: number }).windowCount).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // AC#3
  // -------------------------------------------------------------------------

  describe('AC#3 — public mutation attempts', () => {
    it('proves zero successful public mutations by iterating the policy, not by counting', async () => {
      // The zero is a property of the SURFACE. Iterating means adding an anonymous
      // mutation later breaks this build rather than quietly making the metric a lie.
      const policy = JSON.parse(readFileSync(join(ROOT, 'architecture/module-boundaries.json'), 'utf8')) as {
        publicFunctionSurface: { allowed: Array<{ name: string; kind: string; gate: string }> };
      };
      const anonymous = policy.publicFunctionSurface.allowed.filter((entry) => entry.gate === 'anonymous');
      expect(anonymous.length).toBeGreaterThan(0);
      expect(anonymous.filter((entry) => entry.kind === 'mutation')).toEqual([]);

      const metric = metricOf(await inspect(emptyTables()), 'publicMutationAttempts');
      expect((metric.value as { successfulPublicMutations: number }).successfulPublicMutations).toBe(0);
    });

    it('declares that anonymous denials are not durably recorded, and why', async () => {
      // This is the honest half of AC#3. A missing field would let a reader assume the
      // number was zero; an explicit null plus a reason makes the limitation visible.
      const metric = metricOf(await inspect(emptyTables()), 'publicMutationAttempts');
      expect((metric.value as { anonymousDenialsDurable: unknown }).anonymousDenialsDurable).toBeNull();
      expect(metric.reason).toContain('transactional');
      expect(metric.reason).toContain('storage-exhaustion');
      expect((metric.reason ?? '').length).toBeGreaterThan(0);
    });

    it('surfaces the refusals that ARE durable, counting only refused rows in the window', async () => {
      const tables = emptyTables();
      tables.operatorAuditLog.push(
        { worldId: WORLD_ID, outcome: 'refused', at: NOW - 1_000 },
        { worldId: WORLD_ID, outcome: 'refused', at: NOW - 2_000 },
        { worldId: WORLD_ID, outcome: 'applied', at: NOW - 3_000 },
        { worldId: WORLD_ID, outcome: 'no_op', at: NOW - 4_000 },
        { worldId: WORLD_ID, outcome: 'refused', at: NOW - 200_000_000 },
        { worldId: 'w-other', outcome: 'refused', at: NOW - 1_000 },
      );
      const metric = metricOf(await inspect(tables), 'publicMutationAttempts');
      expect((metric.value as { operatorRefusals: number }).operatorRefusals).toBe(2);
    });

    it('adds no call site that writes a refusal, only a count of what already exists', () => {
      // ART-134 owns populating `outcome: 'refused'` more broadly. This task must not
      // start writing audit rows from a read surface.
      const source = readFileSync(join(ROOT, 'convex/operations/dynamicViewMetricsFunctions.ts'), 'utf8');
      expect(source).not.toContain('db.insert');
      expect(source).not.toContain('db.patch');
      expect(source).not.toContain('recordAudit');
    });
  });
});
