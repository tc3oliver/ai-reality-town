/**
 * Convex wiring for dynamic view metrics (FR-Q001 / ART-133).
 *
 * Same split as `runtimeSnapshotFunctions.ts`: {@link commitDynamicViewMetrics} is written
 * against a narrow store interface and knows nothing about `ctx.db`, so the whole commit
 * decision is unit-testable, and the adapters below are the only code that touches a
 * table.
 *
 * Registers no Convex function. Everything here is called from inside
 * `rebuildLiveProjection`'s existing transaction; the operator-facing READ lives in
 * `convex/operations/dynamicViewMetricsFunctions.ts`, because `publicRead` may not depend
 * on `observability` and this task's read surface needs to.
 */

import type { GenericMutationCtx } from 'convex/server';

import type { DataModel, Id } from '../_generated/dataModel';
import {
  DYNAMIC_VIEW_METRICS_SCHEMA_VERSION,
  DynamicViewMetricsError,
  assertDynamicViewIncident,
  emptyIncidentCounts,
  emptyLatencyBuckets,
  latencyBucketIndex,
  type DynamicIncidentCode,
  type DynamicViewIncident,
  type DynamicViewIncidentRow,
} from './dynamicViewMetrics';

/** The rollup row, as this module reads and writes it. */
export type DynamicViewMetricRollup = {
  readonly schemaVersion: typeof DYNAMIC_VIEW_METRICS_SCHEMA_VERSION;
  readonly worldId: string;
  readonly rebuildCount: number;
  readonly latencyBuckets: readonly number[];
  readonly latencyMaxMs: number;
  readonly incidentCountsByCode: Readonly<Record<string, number>>;
  readonly lastRebuildAt: number;
  readonly lastSnapshotSequence: number;
  readonly updatedAt: number;
};

export type StoredDynamicViewMetricRollup = DynamicViewMetricRollup & { readonly id: string };

export interface DynamicViewMetricsStore {
  loadRollup(worldId: string): Promise<StoredDynamicViewMetricRollup | null>;
  insertRollup(row: DynamicViewMetricRollup): Promise<string>;
  patchRollup(rowId: string, patch: Omit<DynamicViewMetricRollup, 'schemaVersion' | 'worldId'>): Promise<void>;
  insertIncident(row: DynamicViewIncidentRow): Promise<string>;
}

export type CommitDynamicViewMetricsInput = {
  readonly worldId: string;
  readonly incidents: readonly DynamicViewIncident[];
  /** How long the rebuild took to produce the projection it is about to publish. */
  readonly latencyMs: number;
  readonly snapshotSequence: number;
  readonly now: number;
};

export type CommitDynamicViewMetricsResult = {
  readonly incidentsRecorded: number;
  readonly rebuildCount: number;
  readonly latencyMaxMs: number;
};

/**
 * Record one rebuild: its latency, and every defect it found.
 *
 * Called inside `rebuildLiveProjection`'s transaction on purpose. If an incident is
 * rejected by {@link assertDynamicViewIncident}, the throw takes the whole rebuild with
 * it — publishing a projection while silently discarding the record of what was wrong
 * with it is the one outcome worth failing loudly over.
 *
 * The rollup is patched, never appended, so a world costs one row forever.
 */
export async function commitDynamicViewMetrics(
  store: DynamicViewMetricsStore,
  input: CommitDynamicViewMetricsInput,
): Promise<CommitDynamicViewMetricsResult> {
  if (input.worldId.trim().length === 0) {
    throw new DynamicViewMetricsError('DYNAMIC_METRICS_INVALID_SHAPE', 'worldId must be non-empty');
  }
  if (!Number.isFinite(input.now) || !Number.isFinite(input.latencyMs)) {
    throw new DynamicViewMetricsError('DYNAMIC_METRICS_INVALID_SHAPE', 'now and latencyMs must be finite');
  }

  // A clock that ran backwards between the two reads would otherwise persist a negative
  // duration and poison every quantile derived from the bucket it lands in.
  const latencyMs = Math.max(0, Math.round(input.latencyMs));

  const head = await store.loadRollup(input.worldId);
  const latencyBuckets = head ? [...head.latencyBuckets] : emptyLatencyBuckets();
  // A row written before a bucket bound was added is grown rather than discarded.
  const empty = emptyLatencyBuckets();
  while (latencyBuckets.length < empty.length) latencyBuckets.push(0);
  latencyBuckets[latencyBucketIndex(latencyMs)] += 1;

  const incidentCountsByCode: Record<string, number> = {
    ...emptyIncidentCounts(),
    ...(head?.incidentCountsByCode ?? {}),
  };

  for (const incident of input.incidents) {
    const row: DynamicViewIncidentRow = {
      schemaVersion: DYNAMIC_VIEW_METRICS_SCHEMA_VERSION,
      worldId: input.worldId,
      detectedAt: input.now,
      ...incident,
    };
    assertDynamicViewIncident(row);
    await store.insertIncident(row);
    const code: DynamicIncidentCode = incident.code;
    incidentCountsByCode[code] = (incidentCountsByCode[code] ?? 0) + 1;
  }

  const next = {
    rebuildCount: (head?.rebuildCount ?? 0) + 1,
    latencyBuckets,
    latencyMaxMs: Math.max(head?.latencyMaxMs ?? 0, latencyMs),
    incidentCountsByCode,
    lastRebuildAt: input.now,
    lastSnapshotSequence: input.snapshotSequence,
    updatedAt: input.now,
  };

  if (head) await store.patchRollup(head.id, next);
  else {
    await store.insertRollup({
      schemaVersion: DYNAMIC_VIEW_METRICS_SCHEMA_VERSION,
      worldId: input.worldId,
      ...next,
    });
  }

  return {
    incidentsRecorded: input.incidents.length,
    rebuildCount: next.rebuildCount,
    latencyMaxMs: next.latencyMaxMs,
  };
}

/** Store adapter backed by a Convex mutation context. */
export function dynamicViewMetricsWriteStore(
  db: GenericMutationCtx<DataModel>['db'],
): DynamicViewMetricsStore {
  return {
    async loadRollup(worldId) {
      const row = await db
        .query('dynamicViewMetricRollups')
        .withIndex('by_world', (q) => q.eq('worldId', worldId))
        .unique();
      return row
        ? {
          id: row._id,
          schemaVersion: row.schemaVersion,
          worldId: row.worldId,
          rebuildCount: row.rebuildCount,
          latencyBuckets: row.latencyBuckets,
          latencyMaxMs: row.latencyMaxMs,
          incidentCountsByCode: row.incidentCountsByCode,
          lastRebuildAt: row.lastRebuildAt,
          lastSnapshotSequence: row.lastSnapshotSequence,
          updatedAt: row.updatedAt,
        }
        : null;
    },
    async insertRollup(row) {
      return db.insert('dynamicViewMetricRollups', {
        schemaVersion: row.schemaVersion,
        worldId: row.worldId,
        rebuildCount: row.rebuildCount,
        latencyBuckets: [...row.latencyBuckets],
        latencyMaxMs: row.latencyMaxMs,
        incidentCountsByCode: { ...row.incidentCountsByCode },
        lastRebuildAt: row.lastRebuildAt,
        lastSnapshotSequence: row.lastSnapshotSequence,
        updatedAt: row.updatedAt,
      });
    },
    async patchRollup(rowId, patch) {
      await db.patch(rowId as Id<'dynamicViewMetricRollups'>, {
        rebuildCount: patch.rebuildCount,
        latencyBuckets: [...patch.latencyBuckets],
        latencyMaxMs: patch.latencyMaxMs,
        incidentCountsByCode: { ...patch.incidentCountsByCode },
        lastRebuildAt: patch.lastRebuildAt,
        lastSnapshotSequence: patch.lastSnapshotSequence,
        updatedAt: patch.updatedAt,
      });
    },
    async insertIncident(row) {
      // Spread deliberately avoided: an insert must carry exactly the declared columns,
      // and naming them here is what stops a widened source type reaching the table.
      return db.insert('dynamicViewIncidents', {
        schemaVersion: row.schemaVersion,
        worldId: row.worldId,
        code: row.code,
        characterId: row.characterId,
        locationId: row.locationId,
        ...(row.canonLocationId === undefined ? {} : { canonLocationId: row.canonLocationId }),
        ...(row.motionSequence === undefined ? {} : { motionSequence: row.motionSequence }),
        snapshotSequence: row.snapshotSequence,
        detectedAt: row.detectedAt,
      });
    },
  };
}
