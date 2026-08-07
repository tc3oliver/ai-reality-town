/**
 * Dynamic view observability — the metric registry and its privacy gate
 * (FR-Q001 / ART-133).
 *
 * PRD 2.0 §18.1 sets two numbers to exactly zero and §12 Epic Q names eleven metrics that
 * must be "at least recorded". Four of those eleven cannot be recorded the way the other
 * seven are, and the central design decision of this module is to say so in the data model
 * rather than in a comment:
 *
 * - **`server_measured`** — derived from something this deployment can see. Five metrics.
 * - **`structural_zero`** — the value is zero because the architecture makes a non-zero
 *   value unrepresentable, not because a counter happens to read zero. Two metrics.
 *   ART-128's suite is what proves these; here they are reported, not re-proven.
 * - **`client_external`** — genuinely unmeasurable from the server. Two metrics (active
 *   viewer count, renderer error rate) would each require the browser to WRITE something,
 *   and `readOnlyClientBoundary` in `architecture/module-boundaries.json` forbids exactly
 *   that. Reporting them as a permanent `0` would be a lie a dashboard could act on, so
 *   they are reported as `null` with the reason attached. PRD FR-Q007 explicitly sanctions
 *   marking a metric 未量測 rather than estimating it.
 * - **`pending_feature`** — the feature being measured does not exist yet. Two metrics.
 *   The entry exists so the owning task populates a declared slot instead of inventing a
 *   new contract, following the precedent of `PUBLIC_MOTION_TYPES` reserving `'replay'`.
 *
 * Pure module: no Convex import, no clock, no randomness.
 */

import {
  VISUAL_RUNTIME_PROBLEM_CODES,
  type VisualRuntimeProblem,
} from '../visualRuntime/motion';
import { PUBLIC_DYNAMIC_FORBIDDEN_FIELDS } from './publicDynamicProjection';

export const DYNAMIC_VIEW_METRICS_SCHEMA_VERSION = 1;

export const METRIC_PROVENANCE = [
  'server_measured',
  'structural_zero',
  'client_external',
  'pending_feature',
] as const;
export type MetricProvenance = (typeof METRIC_PROVENANCE)[number];

export type DynamicViewMetric = {
  readonly key: string;
  /** The metric exactly as PRD 2.0 §12 FR-Q001 names it, so the mapping is checkable. */
  readonly prdName: string;
  readonly provenance: MetricProvenance;
  /** The task that owns whatever is missing. `null` when nothing is outstanding. */
  readonly owner: string | null;
};

/**
 * The eleven FR-Q001 metrics, in PRD order. Exactly eleven: the PRD's final item is
 * "Replay 播放次數與跳過率", one metric carrying two counters, not two metrics.
 */
export const DYNAMIC_VIEW_METRICS: readonly DynamicViewMetric[] = [
  {
    key: 'runtimeProjectionLatency',
    prdName: 'Runtime Projection 更新延遲',
    provenance: 'server_measured',
    owner: null,
  },
  {
    key: 'snapshotAge',
    prdName: 'Snapshot 年齡',
    provenance: 'server_measured',
    owner: null,
  },
  {
    // Needs a browser→server write to count sessions; the read-only client boundary
    // forbids `useMutation`/`useAction`/a Convex client outside the provider shim.
    key: 'activeViewerCount',
    prdName: 'Active Viewer 數量',
    provenance: 'client_external',
    owner: 'ART-136',
  },
  {
    // Same constraint: a renderer error is only observable where the renderer runs.
    key: 'rendererErrorRate',
    prdName: 'Renderer Error Rate',
    provenance: 'client_external',
    owner: 'ART-137',
  },
  {
    key: 'canonRuntimeLocationMismatch',
    prdName: 'Canon／Runtime Location Mismatch',
    provenance: 'server_measured',
    owner: null,
  },
  {
    key: 'missingCharacterBinding',
    prdName: 'Missing Character Binding',
    provenance: 'server_measured',
    owner: null,
  },
  {
    key: 'missingLocationBinding',
    prdName: 'Missing Location Binding',
    provenance: 'server_measured',
    owner: null,
  },
  {
    key: 'publicMutationAttempts',
    prdName: 'Public Mutation Attempt',
    provenance: 'structural_zero',
    owner: null,
  },
  {
    key: 'viewerTriggeredLlmCalls',
    prdName: 'Viewer-triggered LLM Call Count',
    provenance: 'structural_zero',
    owner: null,
  },
  {
    // FR-O010's degradation ladder is unbuilt; there is no mode to count the use of.
    key: 'degradationModeUsage',
    prdName: '降級模式使用率',
    provenance: 'pending_feature',
    owner: 'ART-127',
  },
  {
    // FR-O013 replay is unbuilt; `PUBLIC_MOTION_TYPES` already reserves `'replay'`.
    key: 'replayPlaySkipCounts',
    prdName: 'Replay 播放次數與跳過率',
    provenance: 'pending_feature',
    owner: 'ART-121',
  },
];

export const DYNAMIC_VIEW_METRIC_KEYS: readonly string[] = DYNAMIC_VIEW_METRICS.map(
  (metric) => metric.key,
);

/**
 * The codes a persisted incident may carry.
 *
 * The runtime codes are spread from {@link VISUAL_RUNTIME_PROBLEM_CODES} rather than
 * restated, so a new runtime problem becomes a recordable incident automatically instead
 * of being dropped by a list nobody remembered to update.
 */
export const DYNAMIC_INCIDENT_CODES = [
  ...VISUAL_RUNTIME_PROBLEM_CODES,
  'CANON_RUNTIME_LOCATION_MISMATCH',
] as const;
export type DynamicIncidentCode = (typeof DYNAMIC_INCIDENT_CODES)[number];

export function isDynamicIncidentCode(value: unknown): value is DynamicIncidentCode {
  return typeof value === 'string' && (DYNAMIC_INCIDENT_CODES as readonly string[]).includes(value);
}

/** Every code mapped to zero — the shape `incidentCountsByCode` always has. */
export function emptyIncidentCounts(): Record<DynamicIncidentCode, number> {
  return Object.fromEntries(DYNAMIC_INCIDENT_CODES.map((code) => [code, 0])) as Record<
    DynamicIncidentCode,
    number
  >;
}

/**
 * Upper bounds of the latency histogram, in milliseconds. A histogram rather than a
 * per-sample reservoir: storage stays O(buckets) per world however long the world runs,
 * and P95 is derived at read time. `5000` is PRD 2.0's stated P95 target, so the bucket
 * boundary and the objective are the same number and a regression is visible as samples
 * crossing one edge.
 *
 * A sample greater than the last bound lands in the overflow bucket, hence
 * `bounds.length + 1` buckets.
 */
export const LATENCY_BUCKET_BOUNDS_MS = [250, 1000, 2500, 5000, 15000, 60000] as const;
export const LATENCY_BUCKET_COUNT = LATENCY_BUCKET_BOUNDS_MS.length + 1;

export function emptyLatencyBuckets(): number[] {
  return new Array<number>(LATENCY_BUCKET_COUNT).fill(0);
}

/** First bucket whose bound the sample does not exceed; the overflow bucket otherwise. */
export function latencyBucketIndex(latencyMs: number): number {
  for (let index = 0; index < LATENCY_BUCKET_BOUNDS_MS.length; index += 1) {
    if (latencyMs <= LATENCY_BUCKET_BOUNDS_MS[index]) return index;
  }
  return LATENCY_BUCKET_BOUNDS_MS.length;
}

/**
 * The bucket bound at or below which `quantile` of the samples fall, or `null` with no
 * samples. Reported as a bound, not an interpolated value: the underlying samples are
 * gone, so any finer number would be invented. A quantile that lands in the overflow
 * bucket has no upper bound and reports `null` too — `latencyMaxMs` is the honest answer
 * there.
 */
export function latencyQuantileMs(buckets: readonly number[], quantile: number): number | null {
  const total = buckets.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  const target = quantile * total;
  let cumulative = 0;
  for (let index = 0; index < buckets.length; index += 1) {
    cumulative += buckets[index];
    if (cumulative >= target) {
      return index < LATENCY_BUCKET_BOUNDS_MS.length ? LATENCY_BUCKET_BOUNDS_MS[index] : null;
    }
  }
  return null;
}

// --- the incident contract --------------------------------------------------

/**
 * One attributed defect, as a detector produces it. This is the AC#4 surface: a mismatch
 * is only useful if it names the character, the location and the sequence it happened at.
 */
export type DynamicViewIncident = {
  readonly code: DynamicIncidentCode;
  readonly characterId: string;
  /** Where the runtime put the character (or tried to). */
  readonly locationId: string;
  /** Where Canon says the character is. Set only for a mismatch. */
  readonly canonLocationId?: string;
  /** Absent when the character was dropped before a motion existed. */
  readonly motionSequence?: number;
  readonly snapshotSequence: number;
};

/** A {@link DynamicViewIncident} as it is persisted. */
export type DynamicViewIncidentRow = DynamicViewIncident & {
  readonly schemaVersion: typeof DYNAMIC_VIEW_METRICS_SCHEMA_VERSION;
  readonly worldId: string;
  readonly detectedAt: number;
};

/**
 * Every field a persisted incident may carry, and the complete list of them.
 *
 * All of these are already public elsewhere: `characterId` and `locationId` are the
 * published `PublicCharacterMotion.characterId` / `.semanticLocationId`, and the two
 * sequence numbers are published root fields. Nothing here is a new disclosure.
 *
 * `message` is conspicuously absent. `VisualRuntimeProblem.message` is free text
 * assembled by the runtime, and free text is exactly where a future edit would quietly
 * interpolate something private. Dropping it costs nothing — the structured fields carry
 * strictly more attribution than the sentence did.
 */
export const DYNAMIC_INCIDENT_FIELDS = [
  'schemaVersion',
  'worldId',
  'code',
  'characterId',
  'locationId',
  'canonLocationId',
  'motionSequence',
  'snapshotSequence',
  'detectedAt',
] as const;

export type DynamicViewMetricsErrorCode =
  | 'DYNAMIC_METRICS_INVALID_SHAPE'
  | 'DYNAMIC_METRICS_UNKNOWN_FIELD'
  | 'DYNAMIC_METRICS_FORBIDDEN_FIELD'
  | 'DYNAMIC_METRICS_INVALID_VALUE';

export class DynamicViewMetricsError extends Error {
  constructor(readonly code: DynamicViewMetricsErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'DynamicViewMetricsError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reject a forbidden field name wherever it appears, however deeply nested.
 *
 * The persisted row is flat today, so a shallow check would pass every real case — which
 * is the reason to walk it anyway. The failure this guards against is a future edit
 * attaching a nested object (a "context" bag, a serialized problem) whose inner keys no
 * shallow allowlist would ever look at.
 */
function assertNoForbiddenField(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenField(entry, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if ((PUBLIC_DYNAMIC_FORBIDDEN_FIELDS as readonly string[]).includes(key)) {
      throw new DynamicViewMetricsError(
        'DYNAMIC_METRICS_FORBIDDEN_FIELD',
        `${path}.${key} is a field the public contract forbids and a metric must never persist`,
      );
    }
    assertNoForbiddenField(nested, `${path}.${key}`);
  }
}

function assertNonEmptyString(value: unknown, path: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DynamicViewMetricsError(
      'DYNAMIC_METRICS_INVALID_VALUE',
      `${path} must be a non-empty string`,
    );
  }
}

function assertNonNegativeInteger(value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new DynamicViewMetricsError(
      'DYNAMIC_METRICS_INVALID_VALUE',
      `${path} must be a non-negative integer`,
    );
  }
}

/**
 * THE AC#5 gate. Every incident passes through this before it is written.
 *
 * Two independent refusals, because they fail for different reasons: an unknown field is
 * a contract drift (someone widened the row), a forbidden field is a leak (someone
 * widened what the row carries). Either one throws, and the throw rolls the whole rebuild
 * back rather than publishing a projection whose diagnostics leaked.
 */
export function assertDynamicViewIncident(value: unknown): asserts value is DynamicViewIncidentRow {
  if (!isPlainObject(value)) {
    throw new DynamicViewMetricsError('DYNAMIC_METRICS_INVALID_SHAPE', 'incident must be an object');
  }
  assertNoForbiddenField(value, 'incident');

  const allowed = new Set<string>(DYNAMIC_INCIDENT_FIELDS);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new DynamicViewMetricsError(
        'DYNAMIC_METRICS_UNKNOWN_FIELD',
        `incident carries field ${key}, which the incident contract does not record`,
      );
    }
  }

  if (value.schemaVersion !== DYNAMIC_VIEW_METRICS_SCHEMA_VERSION) {
    throw new DynamicViewMetricsError(
      'DYNAMIC_METRICS_INVALID_VALUE',
      `incident.schemaVersion must be ${DYNAMIC_VIEW_METRICS_SCHEMA_VERSION}`,
    );
  }
  assertNonEmptyString(value.worldId, 'incident.worldId');
  assertNonEmptyString(value.characterId, 'incident.characterId');
  assertNonEmptyString(value.locationId, 'incident.locationId');
  if (!isDynamicIncidentCode(value.code)) {
    throw new DynamicViewMetricsError(
      'DYNAMIC_METRICS_INVALID_VALUE',
      `incident.code must be one of ${DYNAMIC_INCIDENT_CODES.join(' | ')}`,
    );
  }
  assertNonNegativeInteger(value.snapshotSequence, 'incident.snapshotSequence');
  assertNonNegativeInteger(value.detectedAt, 'incident.detectedAt');
  if (value.canonLocationId !== undefined) {
    assertNonEmptyString(value.canonLocationId, 'incident.canonLocationId');
  }
  if (value.motionSequence !== undefined) {
    assertNonNegativeInteger(value.motionSequence, 'incident.motionSequence');
  }
}

/**
 * Narrow a runtime problem into an incident.
 *
 * The parameter type is structural and names only three fields, so a full
 * {@link VisualRuntimeProblem} is accepted while its `message` is unreachable from inside
 * this function — the drop is enforced by the signature rather than by remembering to omit
 * a key. `motionSequence` is optional because an unbound location means no motion was
 * published at all, and recording `0` would claim the character was seeded in place.
 */
export function toIncident(
  problem: Omit<VisualRuntimeProblem, 'message'>,
  snapshotSequence: number,
  motionSequence?: number,
): DynamicViewIncident {
  return {
    code: problem.code,
    characterId: problem.characterId,
    locationId: problem.locationId,
    snapshotSequence,
    ...(motionSequence === undefined ? {} : { motionSequence }),
  };
}
