/**
 * The operator read surface for dynamic view observability (FR-Q001 / ART-133).
 *
 * WHY THIS FILE IS IN `operations` AND NOT `publicRead`. The response needs three things
 * from three modules: the incident tables (`publicRead`), the freshness classifier
 * (`publicRead`) and the LLM trace count (`observability`). `architecture/module-boundaries.json`
 * forbids `publicRead -> observability` — a public read module that could import the
 * generation path could trigger one, and ART-128's suite actively asserts no `publicRead`
 * file names it. `operations` may depend on both, so the read lives here and the public
 * read path stays unable to reach observability at all.
 *
 * READ-ONLY, AND ONLY A READ. This task reports; it does not control. The gate is the
 * EXISTING `schedule.inspect` capability, reused rather than extended: FR-Q002 / ART-134
 * owns operator controls over the dynamic layer, and minting a capability here would take
 * a decision that belongs to that task.
 *
 * WHAT IT REFUSES TO PRETEND. Four of the eleven FR-Q001 metrics cannot be measured from
 * this deployment (see `convex/publicRead/dynamicViewMetrics.ts`). They are returned with
 * `value: null` and a `reason`, not with a fabricated zero. A zero and an unmeasured
 * metric look identical on a dashboard and mean opposite things.
 */

import { v } from 'convex/values';
import type { GenericQueryCtx } from 'convex/server';

import { query } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import {
  DYNAMIC_VIEW_METRICS,
  LATENCY_BUCKET_BOUNDS_MS,
  emptyIncidentCounts,
  latencyQuantileMs,
  type DynamicIncidentCode,
} from '../publicRead/dynamicViewMetrics';
import { RUNTIME_FRESHNESS, classifyRuntimeFreshness, type PublicRuntimeFreshness } from '../publicRead/runtimeSnapshot';
import { credentialArgs, requireOperator } from './opsConsoleFunctions';

type QueryCtx = GenericQueryCtx<DataModel>;

/** One day: long enough to span every public slot, short enough to stay actionable. */
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Clamped the same way `listOperatorAudit` clamps its own `limit`. */
const DEFAULT_INCIDENT_LIMIT = 20;
const MAX_INCIDENT_LIMIT = 200;

/**
 * How many rows a windowed count will read before it stops.
 *
 * A count over an index range is unbounded by nature, and an operator query that reads a
 * year of audit rows to answer "how many in the last day" is a self-inflicted outage. The
 * scan stops at this many rows and says so via `scanLimitReached`, which is a
 * distinguishable answer rather than a quietly wrong one.
 */
const SCAN_LIMIT = 1000;

/** The reason strings are part of the contract: an unmeasured metric must say why. */
const CLIENT_EXTERNAL_REASON =
  'Not measurable server-side. Counting viewers or renderer errors requires the browser to '
  + 'report, and the read-only client boundary (ART-128 / FR-O009) forbids every client write '
  + 'primitive — useMutation, useAction and any Convex client outside the provider shim. '
  + 'Reporting 0 would be indistinguishable from a healthy measurement of zero.';

const ANONYMOUS_DENIAL_REASON =
  'Anonymous denials are not durably recorded. A Convex mutation is transactional, so a row '
  + 'written on the path to a rejection is rolled back by that same rejection; and an '
  + 'unauthenticated caller who could append a row per attempt would have an unauthenticated '
  + 'storage-exhaustion vector. Denied attempts remain in the Convex function logs. '
  + 'See docs/simulation-operations-console.md and docs/dynamic-view-observability.md.';

const STRUCTURAL_ZERO_REASON =
  'Structurally zero, not counted to zero: every anonymous-gated function in the public '
  + 'surface policy is a query, and a Convex query can neither write nor schedule. '
  + 'Proven by convex/publicRead/publicReadOnlyGuarantee.test.ts.';

type MetricValue = Record<string, unknown> | number | null;

type IncidentSummary = {
  windowCount: number;
  cumulativeCount: number;
  scanLimitReached: boolean;
  recent: Array<{
    characterId: string;
    locationId: string;
    canonLocationId?: string;
    motionSequence?: number;
    snapshotSequence: number;
    detectedAt: number;
  }>;
};

async function summarizeIncidents(
  ctx: QueryCtx,
  worldId: string,
  code: DynamicIncidentCode,
  windowStart: number,
  limit: number,
  cumulative: number,
): Promise<IncidentSummary> {
  const rows = await ctx.db
    .query('dynamicViewIncidents')
    .withIndex('by_world_and_code', (q) =>
      q.eq('worldId', worldId).eq('code', code).gte('detectedAt', windowStart))
    .order('desc')
    .take(SCAN_LIMIT);
  return {
    windowCount: rows.length,
    cumulativeCount: cumulative,
    scanLimitReached: rows.length === SCAN_LIMIT,
    recent: rows.slice(0, limit).map((row) => ({
      characterId: row.characterId,
      locationId: row.locationId,
      ...(row.canonLocationId === undefined ? {} : { canonLocationId: row.canonLocationId }),
      ...(row.motionSequence === undefined ? {} : { motionSequence: row.motionSequence }),
      snapshotSequence: row.snapshotSequence,
      detectedAt: row.detectedAt,
    })),
  };
}

/**
 * Snapshot age across every public world, derived on read from the head snapshot and the
 * server clock. Nothing is stored for this: freshness is never persisted (a stored
 * `live` would go on claiming `live` while it aged), so the aggregate is recomputed the
 * same way a single-world read computes it.
 */
async function snapshotAgeAcrossWorlds(ctx: QueryCtx, nowMs: number) {
  const schedules = await ctx.db
    .query('worldSchedules')
    .withIndex('by_mode_and_status', (q) => q.eq('mode', 'public'))
    .collect();

  const byFreshness = Object.fromEntries(
    RUNTIME_FRESHNESS.map((freshness) => [freshness, 0]),
  ) as Record<PublicRuntimeFreshness, number>;
  let oldestContentAgeMs: number | null = null;
  let oldestObservationAgeMs: number | null = null;
  let observedWorlds = 0;

  for (const schedule of schedules) {
    const head = await ctx.db
      .query('publicRuntimeSnapshots')
      .withIndex('by_world_and_current', (q) => q.eq('worldId', schedule.worldId).eq('isCurrent', true))
      .unique();
    if (!head) continue;
    observedWorlds += 1;
    const verdict = classifyRuntimeFreshness({
      status: head.status,
      sourceRuntimeSequence: head.sourceRuntimeSequence,
      contentUpdatedAt: head.contentUpdatedAt,
      createdAt: head.createdAt,
      observedAt: head.observedAt,
      nowMs,
    });
    byFreshness[verdict.freshness] += 1;
    oldestContentAgeMs = Math.max(oldestContentAgeMs ?? 0, verdict.contentAgeMs);
    oldestObservationAgeMs = Math.max(oldestObservationAgeMs ?? 0, verdict.observationAgeMs);
  }

  return {
    worldCount: schedules.length,
    /** Worlds with a snapshot to age. A world with none is counted but not classified. */
    observedWorlds,
    byFreshness,
    oldestContentAgeMs,
    oldestObservationAgeMs,
  };
}

/**
 * Everything FR-Q001 asks for, in one response, with each metric's provenance attached.
 *
 * Every registry key appears exactly once whatever the world's state, so a consumer can
 * render the full PRD list and see which entries are unmeasured rather than discovering
 * their absence by their omission.
 */
export const inspectDynamicViewMetrics = query({
  args: {
    ...credentialArgs,
    worldId: v.string(),
    windowMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx, 'schedule.inspect', args);

    const nowMs = Date.now();
    const windowMs = Math.min(Math.max(Math.trunc(args.windowMs ?? DEFAULT_WINDOW_MS), 1), MAX_WINDOW_MS);
    const windowStart = nowMs - windowMs;
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? DEFAULT_INCIDENT_LIMIT), 1), MAX_INCIDENT_LIMIT);

    const rollup = await ctx.db
      .query('dynamicViewMetricRollups')
      .withIndex('by_world', (q) => q.eq('worldId', args.worldId))
      .unique();
    const cumulative = { ...emptyIncidentCounts(), ...(rollup?.incidentCountsByCode ?? {}) };

    const [mismatch, unboundCharacter, unboundLocation] = await Promise.all([
      summarizeIncidents(ctx, args.worldId, 'CANON_RUNTIME_LOCATION_MISMATCH', windowStart, limit, cumulative.CANON_RUNTIME_LOCATION_MISMATCH),
      summarizeIncidents(ctx, args.worldId, 'VISUAL_RUNTIME_UNBOUND_CHARACTER', windowStart, limit, cumulative.VISUAL_RUNTIME_UNBOUND_CHARACTER),
      summarizeIncidents(ctx, args.worldId, 'VISUAL_RUNTIME_UNBOUND_LOCATION', windowStart, limit, cumulative.VISUAL_RUNTIME_UNBOUND_LOCATION),
    ]);

    const auditRows = await ctx.db
      .query('operatorAuditLog')
      .withIndex('by_world_and_time', (q) => q.eq('worldId', args.worldId).gte('at', windowStart))
      .order('desc')
      .take(SCAN_LIMIT);

    // Newest world days first; `recordedAt` is what the window is measured against, and
    // `by_world_and_day` is the only world-scoped index this table has.
    const traceRows = await ctx.db
      .query('llmTraces')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId))
      .order('desc')
      .take(SCAN_LIMIT);
    const traceCountInWindow = traceRows.filter((row) => row.recordedAt >= windowStart).length;

    const latencyBuckets = rollup?.latencyBuckets ?? [];
    const sampleCount = latencyBuckets.reduce((sum, count) => sum + count, 0);

    const values: Record<string, { value: MetricValue; reason: string | null }> = {
      runtimeProjectionLatency: {
        value: rollup === null
          ? null
          : {
            p50Ms: latencyQuantileMs(latencyBuckets, 0.5),
            p95Ms: latencyQuantileMs(latencyBuckets, 0.95),
            maxMs: rollup.latencyMaxMs,
            sampleCount,
            rebuildCount: rollup.rebuildCount,
            lastRebuildAt: rollup.lastRebuildAt,
            lastSnapshotSequence: rollup.lastSnapshotSequence,
            bucketBoundsMs: [...LATENCY_BUCKET_BOUNDS_MS],
            buckets: [...latencyBuckets],
          },
        reason: rollup === null ? 'No rebuild has been recorded for this world yet.' : null,
      },
      snapshotAge: { value: await snapshotAgeAcrossWorlds(ctx, nowMs), reason: null },
      activeViewerCount: { value: null, reason: CLIENT_EXTERNAL_REASON },
      rendererErrorRate: { value: null, reason: CLIENT_EXTERNAL_REASON },
      canonRuntimeLocationMismatch: { value: mismatch, reason: null },
      missingCharacterBinding: { value: unboundCharacter, reason: null },
      missingLocationBinding: { value: unboundLocation, reason: null },
      publicMutationAttempts: {
        value: {
          successfulPublicMutations: 0,
          anonymousDenialsDurable: null,
          operatorRefusals: auditRows.filter((row) => row.outcome === 'refused').length,
          auditScanLimitReached: auditRows.length === SCAN_LIMIT,
        },
        reason: ANONYMOUS_DENIAL_REASON,
      },
      viewerTriggeredLlmCalls: {
        value: {
          count: 0,
          publicSurfaceIsQueriesOnly: true,
          // Context, not a violation: traces come from scheduled simulation work. A
          // non-zero number here is a healthy world, and only correlates with a fault if
          // it moves in step with public traffic.
          traceCountInWindow,
          traceScanLimitReached: traceRows.length === SCAN_LIMIT,
        },
        reason: STRUCTURAL_ZERO_REASON,
      },
      degradationModeUsage: {
        value: null,
        reason: 'The FR-O010 degradation ladder does not exist yet; there is no mode whose use could be counted.',
      },
      replayPlaySkipCounts: {
        value: null,
        reason: 'FR-O013 replay does not exist yet; PUBLIC_MOTION_TYPES reserves the motion type but nothing produces it.',
      },
    };

    return {
      worldId: args.worldId,
      generatedAt: nowMs,
      windowMs,
      metrics: DYNAMIC_VIEW_METRICS.map((metric) => {
        const resolved = values[metric.key];
        return {
          key: metric.key,
          prdName: metric.prdName,
          provenance: metric.provenance,
          owner: metric.owner,
          value: resolved.value,
          reason: resolved.reason,
        };
      }),
    };
  },
});
