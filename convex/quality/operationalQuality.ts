/**
 * The Operational-quality evaluator (FR-M002 Canon Rejection Rate and Safety Withhold Rate;
 * PRD §16.2 JSON 結構成功率 ≥ 98%). ART-90.
 *
 * Pure: no Convex, no clock, no randomness, no I/O.
 *
 * ## Three rates, three different denominators, each named
 *
 * | metric | numerator | denominator | window |
 * | --- | --- | --- | --- |
 * | Canon Rejection Rate | proposals a validation stage rejected | proposals a validation stage judged | world days in the window |
 * | Safety Withhold Rate | scenes the post-generation classifier withheld or sent to review | scenes classified | world days in the window |
 * | 結構成功率 | authoring attempts whose structured output parsed | attempts that GOT an answer to validate | world days in the window |
 *
 * The third denominator is the one that is easy to get wrong. An attempt that timed out, was
 * refused a credential, exhausted its route chain or was refused by the budget never received a
 * model response, so it is not evidence about whether the model can follow a schema. Counting it
 * would report a network outage as a structured-output failure. Those attempts are EXCLUDED and
 * counted, with the reason published beside the rate.
 *
 * ## Retries and duplicate runs cannot inflate anything
 *
 * Every unit here is keyed on an identity a retried slot re-derives:
 *
 *  - a proposal by `(worldId, idempotencyKey, stage)` — its key comes from its scene, which comes
 *    from `(worldId, worldDay, timeSlot)`;
 *  - a scene by `sceneId`, and its classification by `${simulationRunId}:safety`;
 *  - an authoring attempt by `${simulationRunId}:attempt:${n}`.
 *
 * The write boundaries are insert-if-absent on those keys, so a slot run three times contributes
 * one row per logical unit. This evaluator additionally deduplicates by the same keys, so it is
 * correct even against evidence gathered by a caller that did not.
 *
 * ## What a reason dimension is
 *
 * A stable code, and nothing else: `TELEPORTATION_NOT_ALLOWED`, `SCENE_OUTPUT_INVALID`,
 * `EXPLICIT_SEXUAL_CONTENT`. Never a message, never a path, never a payload — a rejected
 * proposal's content and a withheld scene's text are exactly what FR-M002's "without exposing
 * secrets" clause is about, and the surest way not to expose them is for this module never to
 * receive them.
 */

import {
  composeScore,
  dedupeFindings,
  finishReport,
  observeMetric,
  uniqueDays,
  type EvaluationReport,
  type EvaluatorDefinition,
  type EvidenceRef,
  type FindingSeverity,
  type MetricDefinition,
  type QualityFinding,
} from './evaluator';

export const OPERATIONAL_QUALITY_EVALUATOR_ID = 'operational_quality';
export const OPERATIONAL_QUALITY_EVALUATOR_VERSION = 1;

export const OPERATIONAL_QUALITY_FINDING_CODES = {
  /** A proposal a validation stage refused, named by its idempotency key and its Canon code. */
  PROPOSAL_REJECTED: 'minor',
  /** A scene the post-generation classifier withheld or sent to human review. */
  SCENE_WITHHELD: 'minor',
  /** An authoring attempt whose structured output failed runtime schema validation. */
  STRUCTURED_OUTPUT_REJECTED: 'severe',
  /** An attempt that never received an answer: excluded from the structure rate, reported here. */
  PROVIDER_ATTEMPT_FAILED: 'minor',
  /** A scene that reached Canon with no post-generation classification at all. */
  SCENE_UNCLASSIFIED: 'severe',
} as const satisfies Record<string, FindingSeverity>;

export type OperationalQualityFindingCode = keyof typeof OPERATIONAL_QUALITY_FINDING_CODES;

const METRIC_REJECTION: MetricDefinition = {
  key: 'canon_rejection_rate',
  prdName: 'Canon Rejection Rate',
  numerator: 'distinct proposals a validation stage rejected, by (idempotencyKey, stage)',
  denominator: 'distinct proposals a validation stage judged, by (idempotencyKey, stage)',
  target: null,
  direction: 'atMost',
};
const METRIC_WITHHOLD: MetricDefinition = {
  key: 'safety_withhold_rate',
  prdName: 'Safety Withhold Rate',
  numerator: 'distinct scenes whose post-generation label was withhold or human_review_required',
  denominator: 'distinct scenes carrying a post-generation classification',
  target: null,
  direction: 'atMost',
};
const METRIC_STRUCTURED: MetricDefinition = {
  key: 'structured_output_success_rate',
  prdName: 'JSON 結構成功率',
  numerator: 'authoring attempts whose structured output passed runtime schema validation',
  denominator: 'authoring attempts that received a model response to validate (attempts that never got one are excluded)',
  target: 0.98,
  direction: 'atLeast',
};
const METRIC_CLASSIFIED: MetricDefinition = {
  key: 'scene_classification_coverage',
  prdName: 'Safety 分類覆蓋率',
  numerator: 'scenes carrying a post-generation classification',
  denominator: 'scenes authored in the window',
  target: 1,
  direction: 'atLeast',
};

export const OPERATIONAL_QUALITY_EVALUATOR: EvaluatorDefinition = {
  evaluatorId: OPERATIONAL_QUALITY_EVALUATOR_ID,
  version: OPERATIONAL_QUALITY_EVALUATOR_VERSION,
  metrics: [METRIC_REJECTION, METRIC_WITHHOLD, METRIC_STRUCTURED, METRIC_CLASSIFIED],
  score: {
    key: 'operational_health',
    prdName: 'Operational Health',
    components: [
      { key: 'structured_output', metricKey: METRIC_STRUCTURED.key, weight: 0.5, transform: 'rate' },
      { key: 'canon_acceptance', metricKey: METRIC_REJECTION.key, weight: 0.3, transform: 'complement' },
      { key: 'classification_coverage', metricKey: METRIC_CLASSIFIED.key, weight: 0.2, transform: 'rate' },
    ],
  },
  findingCodes: OPERATIONAL_QUALITY_FINDING_CODES,
};

// --- evidence ---------------------------------------------------------------

export type ProposalValidationEvidence = {
  worldDay: number;
  idempotencyKey: string;
  sceneId: string | null;
  stage: 'structural' | 'canon';
  outcome: 'accepted' | 'rejected';
  /** A stable Canon error code; null when accepted. */
  errorCode: string | null;
};

export type AuthoringAttemptEvidence = {
  worldDay: number;
  sceneId: string;
  /** `${simulationRunId}:attempt:${n}` — the identity a retried slot re-derives. */
  attemptId: string;
  outcome: 'parsed' | 'output_rejected' | 'provider_failed';
  errorCode: string | null;
  model: string;
  transportRetries: number;
};

export type SceneSafetyEvidence = {
  worldDay: number;
  sceneId: string;
  /** `null` when the scene carries no classification at all — itself a finding. */
  label: 'allow' | 'allow_with_warning' | 'withhold' | 'human_review_required' | null;
  /** The classifier's own category codes. Never the text they were found in. */
  reasonCodes: readonly string[];
};

export type OperationalQualityEvidence = {
  worldId: string;
  fromWorldDay: number;
  toWorldDay: number;
  validations: readonly ProposalValidationEvidence[];
  attempts: readonly AuthoringAttemptEvidence[];
  scenes: readonly SceneSafetyEvidence[];
  scanLimitReached: boolean;
};

/** Reason dimensions: a stable code and how often it was the reason. */
export type ReasonDimension = { code: string; count: number };

export type OperationalQualityBreakdown = {
  rejectionReasons: readonly ReasonDimension[];
  withholdReasons: readonly ReasonDimension[];
  structuredOutputReasons: readonly ReasonDimension[];
  providerFailureReasons: readonly ReasonDimension[];
  /** Models the attempts were served by, so a rate can be read per model when it matters. */
  models: readonly ReasonDimension[];
};

const tally = (codes: readonly (string | null)[]): ReasonDimension[] => {
  const counts = new Map<string, number>();
  for (const code of codes) {
    if (code === null) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
};

const WITHHELD_LABELS = new Set(['withhold', 'human_review_required']);

export type OperationalQualityResult = {
  report: EvaluationReport;
  breakdown: OperationalQualityBreakdown;
};

/** Evaluate one window of validation, authoring and safety evidence. */
export function evaluateOperationalQuality(evidence: OperationalQualityEvidence): OperationalQualityResult {
  const { worldId, fromWorldDay, toWorldDay } = evidence;
  const findings: QualityFinding[] = [];
  const push = (code: OperationalQualityFindingCode, subjectId: string, worldDay: number, refs: EvidenceRef[], detail: string) => {
    findings.push({ code, severity: OPERATIONAL_QUALITY_FINDING_CODES[code], subjectId, worldDay, evidence: refs, detail });
  };
  const inWindow = <T extends { worldDay: number }>(rows: readonly T[]): T[] =>
    rows.filter((row) => row.worldDay >= fromWorldDay && row.worldDay <= toWorldDay);

  // --- Canon rejection --------------------------------------------------------
  const validations = new Map<string, ProposalValidationEvidence>();
  for (const validation of inWindow(evidence.validations)) {
    const key = `${validation.idempotencyKey}|${validation.stage}`;
    if (!validations.has(key)) validations.set(key, validation);
  }
  const judged = [...validations.values()];
  const rejected = judged.filter(({ outcome }) => outcome === 'rejected');
  for (const validation of rejected) {
    push('PROPOSAL_REJECTED', validation.idempotencyKey, validation.worldDay,
      [{ kind: 'validation', id: `${validation.idempotencyKey}:${validation.stage}`, code: validation.errorCode ?? 'UNCLASSIFIED_REJECTION', worldDay: validation.worldDay },
        ...(validation.sceneId === null ? [] : [{ kind: 'scene' as const, id: validation.sceneId, worldDay: validation.worldDay }])],
      `${validation.stage} validation rejected ${validation.idempotencyKey} with ${validation.errorCode ?? 'no code'}`);
  }

  // --- safety withhold --------------------------------------------------------
  const scenes = new Map<string, SceneSafetyEvidence>();
  for (const scene of inWindow(evidence.scenes)) {
    if (!scenes.has(scene.sceneId)) scenes.set(scene.sceneId, scene);
  }
  const allScenes = [...scenes.values()];
  const classified = allScenes.filter(({ label }) => label !== null);
  const withheld = classified.filter(({ label }) => WITHHELD_LABELS.has(label as string));
  for (const scene of withheld) {
    push('SCENE_WITHHELD', scene.sceneId, scene.worldDay,
      [{ kind: 'safety_classification', id: scene.sceneId, code: scene.label ?? 'unknown', worldDay: scene.worldDay },
        ...scene.reasonCodes.map((code) => ({ kind: 'safety_classification' as const, id: scene.sceneId, code }))],
      `scene ${scene.sceneId} was ${scene.label} for ${scene.reasonCodes.length} reason(s)`);
  }
  for (const scene of allScenes) {
    if (scene.label !== null) continue;
    push('SCENE_UNCLASSIFIED', scene.sceneId, scene.worldDay,
      [{ kind: 'scene', id: scene.sceneId, worldDay: scene.worldDay }],
      `scene ${scene.sceneId} carries no post-generation classification`);
  }

  // --- structured output ------------------------------------------------------
  const attempts = new Map<string, AuthoringAttemptEvidence>();
  for (const attempt of inWindow(evidence.attempts)) {
    if (!attempts.has(attempt.attemptId)) attempts.set(attempt.attemptId, attempt);
  }
  const allAttempts = [...attempts.values()];
  const answered = allAttempts.filter(({ outcome }) => outcome !== 'provider_failed');
  const parsed = answered.filter(({ outcome }) => outcome === 'parsed');
  const unanswered = allAttempts.length - answered.length;
  for (const attempt of answered) {
    if (attempt.outcome !== 'output_rejected') continue;
    push('STRUCTURED_OUTPUT_REJECTED', attempt.attemptId, attempt.worldDay,
      [{ kind: 'scene', id: attempt.sceneId, worldDay: attempt.worldDay },
        { kind: 'validation', id: attempt.attemptId, code: attempt.errorCode ?? 'SCENE_OUTPUT_INVALID' }],
      `attempt ${attempt.attemptId} on ${attempt.model} returned output the schema refused (${attempt.errorCode ?? 'no code'})`);
  }
  for (const attempt of allAttempts) {
    if (attempt.outcome !== 'provider_failed') continue;
    push('PROVIDER_ATTEMPT_FAILED', attempt.attemptId, attempt.worldDay,
      [{ kind: 'scene', id: attempt.sceneId, worldDay: attempt.worldDay },
        { kind: 'validation', id: attempt.attemptId, code: attempt.errorCode ?? 'SCENE_ATTEMPT_FAILED' }],
      `attempt ${attempt.attemptId} never received a response to validate (${attempt.errorCode ?? 'no code'})`);
  }

  const metrics = [
    observeMetric(METRIC_REJECTION, rejected.length, judged.length),
    observeMetric(METRIC_WITHHOLD, withheld.length, classified.length,
      allScenes.length - classified.length,
      allScenes.length === classified.length ? null : 'scenes carrying no post-generation classification'),
    observeMetric(METRIC_STRUCTURED, parsed.length, answered.length, unanswered,
      unanswered === 0 ? null : 'attempts that never received a model response, so they are not evidence about schema compliance'),
    observeMetric(METRIC_CLASSIFIED, classified.length, allScenes.length),
  ];

  const evaluatedDays = uniqueDays([
    ...judged.map(({ worldDay }) => worldDay),
    ...allScenes.map(({ worldDay }) => worldDay),
    ...allAttempts.map(({ worldDay }) => worldDay),
  ]);
  const allDays: number[] = [];
  for (let day = fromWorldDay; day <= toWorldDay; day += 1) allDays.push(day);
  const evaluatedSet = new Set(evaluatedDays);

  return {
    report: finishReport({
      evaluatorId: OPERATIONAL_QUALITY_EVALUATOR_ID,
      evaluatorVersion: OPERATIONAL_QUALITY_EVALUATOR_VERSION,
      worldId,
      window: { fromWorldDay, toWorldDay },
      metrics,
      score: composeScore(OPERATIONAL_QUALITY_EVALUATOR.score!, metrics),
      findings: dedupeFindings(findings),
      coverage: {
        worldDaysEvaluated: evaluatedDays,
        worldDaysWithoutEvidence: allDays.filter((day) => !evaluatedSet.has(day)),
        scanLimitReached: evidence.scanLimitReached,
      },
    }),
    breakdown: {
      rejectionReasons: tally(rejected.map(({ errorCode }) => errorCode ?? 'UNCLASSIFIED_REJECTION')),
      withholdReasons: tally(withheld.flatMap(({ reasonCodes, label }) =>
        reasonCodes.length > 0 ? [...reasonCodes] : [label ?? 'UNCLASSIFIED_WITHHOLD'])),
      structuredOutputReasons: tally(answered
        .filter(({ outcome }) => outcome === 'output_rejected')
        .map(({ errorCode }) => errorCode ?? 'SCENE_OUTPUT_INVALID')),
      providerFailureReasons: tally(allAttempts
        .filter(({ outcome }) => outcome === 'provider_failed')
        .map(({ errorCode }) => errorCode ?? 'SCENE_ATTEMPT_FAILED')),
      models: tally(allAttempts.map(({ model }) => model)),
    },
  };
}
