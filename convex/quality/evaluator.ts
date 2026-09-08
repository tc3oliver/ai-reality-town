/**
 * The shared world-quality evaluator contract (FR-M002, PRD §16.2).
 *
 * ART-58 introduces it for the Continuity evaluator; ART-88 (narrative), ART-89 (arc / recap /
 * spoiler) and ART-90 (rejection / withhold) build on the same shapes, so an operator reads four
 * evaluators through one vocabulary and the harness reports them through one report type.
 *
 * ## What an evaluator IS here
 *
 * A pure function from EVIDENCE to a report. Evidence is what the running system already produced
 * and persisted — accepted events, snapshots, published text, validation and safety outcomes. An
 * evaluator never re-runs a model, never proposes an event, never writes anything, and cannot: the
 * `quality` module is listed in `canonWriteBoundary.forbiddenModules`, so naming a Canon write
 * symbol here is a build failure, not a convention (AC#3 "without becoming Canon").
 *
 * ## The three rules every evaluator obeys
 *
 *  1. **Versioned definition.** `EvaluatorDefinition.version` changes whenever a metric's
 *     numerator, denominator, weights or finding codes change, so two reports can only be compared
 *     when they say the same thing. The definition is DATA, returned with every report, because a
 *     dashboard reading a rate needs to know what the rate is a rate OF.
 *  2. **No observations is not zero.** Every rate is a {@link MetricObservation} from
 *     `convex/shared/metricObservation.ts`; a composite score is `null` when none of its
 *     components measured anything. Four of §16.2's targets are exactly `0` or exactly `100%`, and
 *     an empty world reporting a perfect score is the specific lie this rule exists to prevent.
 *  3. **Findings carry references, never content.** A finding names the accepted event, snapshot,
 *     publication or validation result it was derived from — by id and code — and nothing else.
 *     Secret text, private knowledge, memory content and prompts do not appear in a report, so the
 *     report can be shown to an operator without a second redaction pass.
 *
 * ## Exactly-once
 *
 * Evidence is counted by its durable identity: an accepted event by `eventId`, a day by
 * `worldDay`, a publication by its `contentRef`, a scene by `sceneId`. A retried world-day run or a
 * re-run post-commit pipeline produces the SAME evidence ids (every id on the live path is derived
 * from `(worldId, worldDay, timeSlot)`), so re-evaluating cannot double-count. `dedupeFindings`
 * enforces the same at the finding level.
 */

import {
  observeRate,
  roundRate,
  type MetricObservation,
  type MetricStatus,
  type TargetDirection,
} from '../shared/metricObservation';

/** What a finding or a metric was derived from. Ids and codes only. */
export type EvidenceKind =
  | 'accepted_event'
  | 'validation'
  | 'replay'
  | 'snapshot'
  | 'publication'
  | 'scene'
  | 'arc'
  | 'coverage_report'
  | 'safety_classification'
  | 'world_day_run';

export type EvidenceRef = {
  kind: EvidenceKind;
  /** The durable id: `eventId`, snapshot id, `contentRef`, `sceneId`, arc id, run id … */
  id: string;
  /** A stable code attached to the evidence — a Canon error code, a finding code, a label. */
  code?: string;
  worldDay?: number;
};

export type FindingSeverity = 'severe' | 'minor';

/**
 * One thing the evaluator found wrong. `subjectId` is the thing at fault (an event, a character,
 * a publication); `evidence` is how the evaluator knows. `detail` is a short, fixed-vocabulary
 * sentence built from ids and codes — never from world content.
 */
export type QualityFinding = {
  code: string;
  severity: FindingSeverity;
  subjectId: string;
  worldDay: number;
  evidence: readonly EvidenceRef[];
  detail: string;
};

/** How one metric is computed. Returned with every report, so the number is never alone. */
export type MetricDefinition = {
  key: string;
  /** The PRD's own name (§16.2 / FR-M002), so the mapping is checkable against the table. */
  prdName: string;
  numerator: string;
  denominator: string;
  target: number | null;
  direction: TargetDirection;
};

/** One weighted component of a composite score. */
export type ScoreComponentDefinition = {
  key: string;
  /** The metric this component is derived from. */
  metricKey: string;
  weight: number;
  /**
   * How the metric's rate becomes a component in `[0, 1]` where 1 is best:
   * `rate` uses it as is (a floor-type metric), `complement` uses `1 - rate` (a ceiling-type
   * metric such as conflicts per event).
   */
  transform: 'rate' | 'complement';
};

export type CompositeScoreDefinition = {
  key: string;
  prdName: string;
  components: readonly ScoreComponentDefinition[];
};

export type EvaluatorDefinition = {
  evaluatorId: string;
  version: number;
  metrics: readonly MetricDefinition[];
  score: CompositeScoreDefinition | null;
  /** The finding codes this evaluator can emit, with their fixed severity. */
  findingCodes: Readonly<Record<string, FindingSeverity>>;
};

export type ScoreComponent = {
  key: string;
  metricKey: string;
  weight: number;
  /** `null` when the underlying metric had no observations. */
  value: number | null;
  status: MetricStatus;
};

/**
 * A weighted composite. `value` is the weighted mean over the components that MEASURED something,
 * renormalised by their weights; `weightMeasured` says how much of the definition's weight that
 * was, so a score built from one component out of five is visibly not the same score.
 */
export type CompositeScore = {
  key: string;
  prdName: string;
  value: number | null;
  status: MetricStatus;
  components: readonly ScoreComponent[];
  weightMeasured: number;
  weightTotal: number;
};

/** The world-day window a report covers, inclusive. */
export type EvaluationWindow = { fromWorldDay: number; toWorldDay: number };

/** What the report was computed over, so a reader can tell a small sample from a small world. */
export type EvaluationCoverage = {
  /** Days that carried evidence and were evaluated. */
  worldDaysEvaluated: readonly number[];
  /** Days inside the window with no evidence at all. Reported, not folded into a rate. */
  worldDaysWithoutEvidence: readonly number[];
  /** The evidence read stopped at a bound. A report over a truncated read is not the report it claims to be. */
  scanLimitReached: boolean;
};

export type EvaluationReport = {
  schemaVersion: 1;
  evaluatorId: string;
  evaluatorVersion: number;
  worldId: string;
  window: EvaluationWindow;
  metrics: readonly MetricObservation[];
  score: CompositeScore | null;
  findings: readonly QualityFinding[];
  coverage: EvaluationCoverage;
  /** A canonical digest of everything above. Two evaluations of the same evidence produce one digest. */
  digest: string;
};

// --- helpers every evaluator uses -----------------------------------------

/** Build a metric observation from a definition, so the number always carries its own meaning. */
export function observeMetric(
  definition: MetricDefinition,
  numerator: number,
  denominator: number,
  excluded = 0,
  excludedReason: string | null = null,
): MetricObservation {
  return observeRate(
    definition.key, definition.prdName, numerator, denominator,
    definition.target, definition.direction, excluded, excludedReason,
  );
}

/**
 * Compose a score from its metrics. A component whose metric has no observations contributes
 * nothing and is reported as such; a score with no measured component is `null`.
 */
export function composeScore(
  definition: CompositeScoreDefinition,
  metrics: readonly MetricObservation[],
): CompositeScore {
  const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
  const components: ScoreComponent[] = definition.components.map((component) => {
    const metric = byKey.get(component.metricKey);
    const rate = metric?.rate ?? null;
    const value = rate === null ? null : roundRate(component.transform === 'rate' ? rate : 1 - rate);
    return {
      key: component.key, metricKey: component.metricKey, weight: component.weight,
      value, status: value === null ? 'no_observations' : 'measured',
    };
  });
  const weightTotal = components.reduce((total, { weight }) => total + weight, 0);
  const measured = components.filter((component) => component.value !== null);
  const weightMeasured = measured.reduce((total, { weight }) => total + weight, 0);
  const value = weightMeasured > 0
    ? roundRate(measured.reduce((total, component) => total + component.weight * (component.value as number), 0) / weightMeasured)
    : null;
  return {
    key: definition.key, prdName: definition.prdName, value,
    status: value === null ? 'no_observations' : 'measured',
    components, weightMeasured: roundRate(weightMeasured), weightTotal: roundRate(weightTotal),
  };
}

/** One finding per `(code, subjectId, worldDay)`: a re-evaluated day cannot report a fault twice. */
export function dedupeFindings(findings: readonly QualityFinding[]): QualityFinding[] {
  const seen = new Map<string, QualityFinding>();
  for (const finding of findings) {
    const key = `${finding.code} ${finding.subjectId} ${finding.worldDay}`;
    if (!seen.has(key)) seen.set(key, finding);
  }
  return [...seen.values()].sort((left, right) =>
    left.worldDay - right.worldDay
    || left.code.localeCompare(right.code)
    || left.subjectId.localeCompare(right.subjectId));
}

/** Sorted, unique world days. */
export const uniqueDays = (days: Iterable<number>): number[] =>
  [...new Set(days)].sort((left, right) => left - right);

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function fnv1a(value: string, offsetBasis: number): number {
  let hash = offsetBasis >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * A 64-bit canonical digest of a report body. Pure JS so the module carries no node builtin;
 * two seeded FNV-1a passes, the same construction `convex/shared/opaqueDigest.ts` uses. It is
 * a reproducibility check, not a secret.
 */
export function reportDigest(body: unknown): string {
  const text = canonicalJson(body);
  const low = fnv1a(text, 0x811c9dc5).toString(16).padStart(8, '0');
  const high = fnv1a(text, 0x811c9dc5 ^ 0x5bf03635).toString(16).padStart(8, '0');
  return `fnv1a64:${high}${low}`;
}

/** Assemble the report and stamp its digest. Every evaluator returns through here. */
export function finishReport(body: Omit<EvaluationReport, 'digest' | 'schemaVersion'>): EvaluationReport {
  const withVersion = { schemaVersion: 1 as const, ...body };
  return { ...withVersion, digest: reportDigest(withVersion) };
}
