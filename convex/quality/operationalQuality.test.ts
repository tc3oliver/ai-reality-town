/**
 * The Operational-quality evaluator (FR-M002 Canon Rejection Rate / Safety Withhold Rate;
 * PRD §16.2 JSON 結構成功率 ≥ 98%). ART-90.
 *
 * ## Why every case pins a numerator AND a denominator
 *
 * All three rates here are ratios whose DENOMINATOR is the interesting half, and a wrong
 * denominator is invisible to a reader of the rate:
 *
 *  - a rejection rate that counts one proposal twice (a retried slot re-records the same verdict)
 *    reports a healthier or sicker world than the one that ran;
 *  - a withhold rate whose denominator is "scenes" rather than "scenes that were CLASSIFIED"
 *    silently reports an unclassified scene as safe;
 *  - a structured-output rate that counts an attempt which never got an answer reports a network
 *    outage as a model that cannot follow a schema — the specific failure §16.2's target would then
 *    be measuring instead of the one it names.
 *
 * So each case below asserts the finding codes and both sides of the ratio, and the
 * `providerFailuresAreNotSchemaFailures` and `dedupe` cases assert the number they must NOT be
 * (1/2 rather than 1/1 or 2/2; `null` rather than `0`).
 *
 * ## The fixtures are plain objects, deliberately
 *
 * `evaluateOperationalQuality` is pure — no Convex, no clock, no I/O — so evidence is built here
 * directly. The LIVE wiring that produces these shapes is proved separately, in
 * `convex/simulation/authoringAttemptEvidence.test.ts`, because a deterministic author never fails
 * a schema and a rate that cannot fall is not evidence that the gate works.
 */

import type { MetricObservation } from '../shared/metricObservation';
import type { EvaluationReport, QualityFinding } from './evaluator';
import {
  OPERATIONAL_QUALITY_EVALUATOR,
  OPERATIONAL_QUALITY_EVALUATOR_ID,
  OPERATIONAL_QUALITY_EVALUATOR_VERSION,
  OPERATIONAL_QUALITY_FINDING_CODES,
  evaluateOperationalQuality,
  type AuthoringAttemptEvidence,
  type OperationalQualityEvidence,
  type ProposalValidationEvidence,
  type SceneSafetyEvidence,
} from './operationalQuality';

const WORLD_ID = 'mistwood-public';
/** The one day every fixture lives on, so no case accidentally tests day chaining. */
const DAY = 1;
const MODEL = 'fake-whole-scene-v2';

/** A phrase that exists nowhere but the fixtures, so its absence from a report is checkable. */
const MARKER = '鐘樓鑰匙藏在站長室的暗格裡';

// --- fixtures ---------------------------------------------------------------

const validation = (
  input: Partial<ProposalValidationEvidence> & { idempotencyKey: string },
): ProposalValidationEvidence => ({
  worldDay: DAY, sceneId: null, stage: 'canon', outcome: 'accepted', errorCode: null, ...input,
});

const attempt = (
  input: Partial<AuthoringAttemptEvidence> & { attemptId: string },
): AuthoringAttemptEvidence => ({
  worldDay: DAY, sceneId: 'group-1:scene:1', outcome: 'parsed', errorCode: null,
  model: MODEL, transportRetries: 0, ...input,
});

const safetyScene = (
  input: Partial<SceneSafetyEvidence> & { sceneId: string },
): SceneSafetyEvidence => ({ worldDay: DAY, label: 'allow', reasonCodes: [], ...input });

const evidence = (overrides: Partial<OperationalQualityEvidence> = {}): OperationalQualityEvidence => ({
  worldId: WORLD_ID, fromWorldDay: DAY, toWorldDay: DAY,
  validations: [], attempts: [], scenes: [], scanLimitReached: false, ...overrides,
});

const metricOf = (report: EvaluationReport, key: string): MetricObservation => {
  const metric = report.metrics.find((row) => row.key === key);
  if (metric === undefined) throw new Error(`report carries no ${key} metric`);
  return metric;
};

const findingsOf = (report: EvaluationReport, code: string): QualityFinding[] =>
  report.findings.filter((finding) => finding.code === code);

/** `n` parsed attempts, so a case only has to name the ones that failed. */
const parsedAttempts = (count: number, prefix = 'ok'): AuthoringAttemptEvidence[] =>
  Array.from({ length: count }, (_, index) => attempt({ attemptId: `${prefix}:attempt:${index + 1}` }));

// =============================================================================
// The definition travels with the number
// =============================================================================

describe('FR-M002 operational: the evaluator definition', () => {
  it('names all four metrics and pins §16.2 structured-output target as an inclusive floor', () => {
    expect(OPERATIONAL_QUALITY_EVALUATOR.evaluatorId).toBe(OPERATIONAL_QUALITY_EVALUATOR_ID);
    expect(OPERATIONAL_QUALITY_EVALUATOR.version).toBe(OPERATIONAL_QUALITY_EVALUATOR_VERSION);
    expect(OPERATIONAL_QUALITY_EVALUATOR.metrics.map(({ key }) => key)).toEqual([
      'canon_rejection_rate', 'safety_withhold_rate', 'structured_output_success_rate',
      'scene_classification_coverage',
    ]);

    const structured = OPERATIONAL_QUALITY_EVALUATOR.metrics.find(({ key }) => key === 'structured_output_success_rate')!;
    expect(structured.target).toBe(0.98);
    expect(structured.direction).toBe('atLeast');
    // The denominator's exclusion is part of the DEFINITION, not an implementation detail.
    expect(structured.denominator).toContain('excluded');

    const report = evaluateOperationalQuality(evidence());
    expect(report.report.evaluatorId).toBe(OPERATIONAL_QUALITY_EVALUATOR_ID);
    expect(report.report.evaluatorVersion).toBe(OPERATIONAL_QUALITY_EVALUATOR_VERSION);
    expect(report.report.metrics.map(({ key }) => key))
      .toEqual(OPERATIONAL_QUALITY_EVALUATOR.metrics.map(({ key }) => key));
  });
});

// =============================================================================
// Canon Rejection Rate
// =============================================================================

describe('FR-M002 operational: Canon Rejection Rate', () => {
  /** Six judged proposals, two of which a validation stage refused. */
  const sixJudged = (): ProposalValidationEvidence[] => [
    validation({ idempotencyKey: 'key-1', sceneId: 'group-1:scene:1' }),
    validation({ idempotencyKey: 'key-2', sceneId: 'group-1:scene:1' }),
    validation({
      idempotencyKey: 'key-3', sceneId: 'group-1:scene:2',
      outcome: 'rejected', errorCode: 'TELEPORTATION_NOT_ALLOWED',
    }),
    validation({ idempotencyKey: 'key-4', sceneId: 'group-1:scene:2' }),
    validation({
      idempotencyKey: 'key-5', sceneId: 'group-1:scene:3',
      outcome: 'rejected', errorCode: 'UNKNOWN_LOCATION_REFERENCE',
    }),
    validation({ idempotencyKey: 'key-6', sceneId: 'group-1:scene:3' }),
  ];

  it('divides rejected proposals by JUDGED proposals and names each refusal by key and code', () => {
    const { report } = evaluateOperationalQuality(evidence({ validations: sixJudged() }));
    const metric = metricOf(report, 'canon_rejection_rate');

    expect(metric.numerator).toBe(2);
    expect(metric.denominator).toBe(6);
    expect(metric.rate).toBeCloseTo(2 / 6, 4);
    expect(metric.status).toBe('measured');

    const rejections = findingsOf(report, 'PROPOSAL_REJECTED');
    expect(rejections.map(({ subjectId }) => subjectId)).toEqual(['key-3', 'key-5']);
    expect(rejections[0].severity).toBe(OPERATIONAL_QUALITY_FINDING_CODES.PROPOSAL_REJECTED);
    expect(rejections[0].evidence).toEqual([
      { kind: 'validation', id: 'key-3:canon', code: 'TELEPORTATION_NOT_ALLOWED', worldDay: DAY },
      { kind: 'scene', id: 'group-1:scene:2', worldDay: DAY },
    ]);
    expect(rejections[1].evidence).toContainEqual(
      { kind: 'validation', id: 'key-5:canon', code: 'UNKNOWN_LOCATION_REFERENCE', worldDay: DAY },
    );
    // An accepted proposal is never a finding: the rate's denominator is not its numerator.
    expect(JSON.stringify(report.findings)).not.toContain('key-1');
  });

  it('tallies the rejection reason dimensions in descending count order', () => {
    const { breakdown } = evaluateOperationalQuality(evidence({
      validations: [
        validation({ idempotencyKey: 'a', outcome: 'rejected', errorCode: 'UNKNOWN_LOCATION_REFERENCE' }),
        validation({ idempotencyKey: 'b', outcome: 'rejected', errorCode: 'UNKNOWN_LOCATION_REFERENCE' }),
        validation({ idempotencyKey: 'c', outcome: 'rejected', errorCode: 'UNKNOWN_LOCATION_REFERENCE' }),
        validation({ idempotencyKey: 'd', outcome: 'rejected', errorCode: 'TELEPORTATION_NOT_ALLOWED' }),
        validation({ idempotencyKey: 'e' }),
      ],
    }));

    expect(breakdown.rejectionReasons).toEqual([
      { code: 'UNKNOWN_LOCATION_REFERENCE', count: 3 },
      { code: 'TELEPORTATION_NOT_ALLOWED', count: 1 },
    ]);
  });

  it('counts a rejection that carried no code, under a name that says so', () => {
    const { report, breakdown } = evaluateOperationalQuality(evidence({
      validations: [
        validation({ idempotencyKey: 'nameless', outcome: 'rejected', errorCode: null }),
        validation({ idempotencyKey: 'fine' }),
      ],
    }));

    expect(metricOf(report, 'canon_rejection_rate').numerator).toBe(1);
    expect(breakdown.rejectionReasons).toEqual([{ code: 'UNCLASSIFIED_REJECTION', count: 1 }]);
    expect(findingsOf(report, 'PROPOSAL_REJECTED')[0].evidence[0].code).toBe('UNCLASSIFIED_REJECTION');
  });

  it('is null rather than zero when no proposal was judged at all', () => {
    const metric = metricOf(evaluateOperationalQuality(evidence()).report, 'canon_rejection_rate');
    expect(metric.denominator).toBe(0);
    expect(metric.status).toBe('no_observations');
    expect(metric.rate).toBeNull();
    expect(metric.rate).not.toBe(0);
  });
});

// =============================================================================
// Dedupe: a retried slot re-records the same verdicts and must not re-count them
// =============================================================================

describe('FR-M002 operational: (idempotencyKey, stage) is the proposal identity', () => {
  it('counts a repeated (key, stage) once and the SAME key at the other stage separately', () => {
    const { report } = evaluateOperationalQuality(evidence({
      validations: [
        // The retried slot re-derived the same key and re-recorded the same structural verdict.
        validation({
          idempotencyKey: 'key-1', stage: 'structural',
          outcome: 'rejected', errorCode: 'INVALID_EVENT_SHAPE',
        }),
        validation({
          idempotencyKey: 'key-1', stage: 'structural',
          outcome: 'rejected', errorCode: 'INVALID_EVENT_SHAPE',
        }),
        // The same proposal, judged by the OTHER gate. Two gates, two verdicts, two observations.
        validation({ idempotencyKey: 'key-1', stage: 'canon', outcome: 'accepted' }),
      ],
    }));

    const metric = metricOf(report, 'canon_rejection_rate');
    // 1/1 would mean the two stages collapsed into one; 2/2 would mean the repeat inflated both.
    expect(metric.numerator).toBe(1);
    expect(metric.denominator).toBe(2);
    expect(metric.rate).toBe(0.5);
    expect(findingsOf(report, 'PROPOSAL_REJECTED')).toHaveLength(1);
  });

  it('counts an authoring attempt once per attemptId', () => {
    const { report } = evaluateOperationalQuality(evidence({
      attempts: [
        attempt({ attemptId: 'sim:attempt:1' }),
        // The same durable identity, re-reported. It is one attempt, whatever it is re-labelled as.
        attempt({ attemptId: 'sim:attempt:1', outcome: 'output_rejected', errorCode: 'SCENE_OUTPUT_INVALID' }),
        attempt({ attemptId: 'sim:attempt:2', outcome: 'output_rejected', errorCode: 'SCENE_OUTPUT_INVALID' }),
      ],
    }));

    const metric = metricOf(report, 'structured_output_success_rate');
    expect(metric.numerator).toBe(1);
    expect(metric.denominator).toBe(2);
    expect(findingsOf(report, 'STRUCTURED_OUTPUT_REJECTED').map(({ subjectId }) => subjectId))
      .toEqual(['sim:attempt:2']);
  });

  it('counts a scene once per sceneId', () => {
    const { report } = evaluateOperationalQuality(evidence({
      scenes: [
        safetyScene({ sceneId: 'group-1:scene:1', label: 'withhold', reasonCodes: ['EXTREME_VIOLENCE_DETAIL'] }),
        safetyScene({ sceneId: 'group-1:scene:1', label: 'withhold', reasonCodes: ['EXTREME_VIOLENCE_DETAIL'] }),
        safetyScene({ sceneId: 'group-1:scene:2' }),
      ],
    }));

    const metric = metricOf(report, 'safety_withhold_rate');
    expect(metric.numerator).toBe(1);
    expect(metric.denominator).toBe(2);
    expect(findingsOf(report, 'SCENE_WITHHELD')).toHaveLength(1);
  });
});

// =============================================================================
// Safety Withhold Rate
// =============================================================================

describe('FR-M002 operational: Safety Withhold Rate', () => {
  /** Four classified scenes plus one that reached Canon carrying no classification at all. */
  const fiveScenes = (): SceneSafetyEvidence[] => [
    safetyScene({ sceneId: 'scene-withheld', label: 'withhold', reasonCodes: ['EXTREME_VIOLENCE_DETAIL'] }),
    safetyScene({ sceneId: 'scene-review', label: 'human_review_required', reasonCodes: ['SELF_HARM_DETAIL'] }),
    // `allow_with_warning` is PUBLISHED. It is a warning on served content, not a withhold.
    safetyScene({ sceneId: 'scene-warned', label: 'allow_with_warning', reasonCodes: ['MILD_VIOLENCE'] }),
    safetyScene({ sceneId: 'scene-allowed', label: 'allow' }),
    safetyScene({ sceneId: 'scene-unclassified', label: null }),
  ];

  it('counts withhold and human_review_required, over CLASSIFIED scenes only', () => {
    const { report } = evaluateOperationalQuality(evidence({ scenes: fiveScenes() }));
    const metric = metricOf(report, 'safety_withhold_rate');

    expect(metric.numerator).toBe(2);
    expect(metric.denominator).toBe(4);
    expect(metric.rate).toBe(0.5);
    expect(metric.status).toBe('measured');

    const withheld = findingsOf(report, 'SCENE_WITHHELD').map(({ subjectId }) => subjectId);
    expect(withheld).toEqual(['scene-review', 'scene-withheld']);
    // The warning is served content. Counting it as withheld would report a published scene as
    // suppressed, and would move the rate the operator reads as "how much did we drop".
    expect(withheld).not.toContain('scene-warned');
  });

  it('excludes the unclassified scene from the withhold denominator, with a published reason', () => {
    const { report } = evaluateOperationalQuality(evidence({ scenes: fiveScenes() }));
    const metric = metricOf(report, 'safety_withhold_rate');

    expect(metric.excluded).toBe(1);
    expect(metric.excludedReason).toContain('no post-generation classification');

    const unclassified = findingsOf(report, 'SCENE_UNCLASSIFIED');
    expect(unclassified.map(({ subjectId }) => subjectId)).toEqual(['scene-unclassified']);
    expect(unclassified[0].severity).toBe('severe');
    expect(unclassified[0].evidence).toEqual([
      { kind: 'scene', id: 'scene-unclassified', worldDay: DAY },
    ]);
  });

  it('reports classification coverage over every scene, so the exclusion is itself measured', () => {
    const metric = metricOf(evaluateOperationalQuality(evidence({ scenes: fiveScenes() })).report,
      'scene_classification_coverage');

    expect(metric.numerator).toBe(4);
    expect(metric.denominator).toBe(5);
    expect(metric.rate).toBe(0.8);
    expect(metric.target).toBe(1);
    expect(metric.meetsTarget).toBe(false);
  });

  it('tallies withhold reasons by the classifier code, never by the text it was found in', () => {
    const { breakdown } = evaluateOperationalQuality(evidence({
      scenes: [
        safetyScene({ sceneId: 's1', label: 'withhold', reasonCodes: ['EXTREME_VIOLENCE_DETAIL'] }),
        safetyScene({ sceneId: 's2', label: 'withhold', reasonCodes: ['EXTREME_VIOLENCE_DETAIL', 'SELF_HARM_DETAIL'] }),
        safetyScene({ sceneId: 's3', label: 'human_review_required', reasonCodes: [] }),
      ],
    }));

    expect(breakdown.withholdReasons).toEqual([
      { code: 'EXTREME_VIOLENCE_DETAIL', count: 2 },
      // Equal counts break the tie by code, so the order is stable across runs.
      // A withhold with no reason code is still a withhold, named by its label rather than dropped.
      { code: 'human_review_required', count: 1 },
      { code: 'SELF_HARM_DETAIL', count: 1 },
    ]);
  });

  it('is null rather than zero when nothing was classified', () => {
    const metric = metricOf(
      evaluateOperationalQuality(evidence({ scenes: [safetyScene({ sceneId: 'only', label: null })] })).report,
      'safety_withhold_rate');
    expect(metric.denominator).toBe(0);
    expect(metric.rate).toBeNull();
    expect(metric.rate).not.toBe(0);
    expect(metric.status).toBe('no_observations');
  });
});

// =============================================================================
// §16.2 JSON 結構成功率 — the denominator that is easy to get wrong
// =============================================================================

describe('PRD §16.2 operational: structured-output success rate', () => {
  it('divides parsed attempts by attempts that GOT an answer, excluding the ones that did not', () => {
    const { report } = evaluateOperationalQuality(evidence({
      attempts: [
        ...parsedAttempts(8),
        attempt({ attemptId: 'bad:attempt:1', outcome: 'output_rejected', errorCode: 'SCENE_OUTPUT_INVALID' }),
        attempt({ attemptId: 'gone:attempt:1', outcome: 'provider_failed', errorCode: 'LLM_HTTP_TIMEOUT' }),
      ],
    }));
    const metric = metricOf(report, 'structured_output_success_rate');

    expect(metric.numerator).toBe(8);
    expect(metric.denominator).toBe(9);
    expect(metric.excluded).toBe(1);
    expect(metric.excludedReason).toContain('never received a model response');
    expect(metric.rate).toBeCloseTo(8 / 9, 4);
    expect(metric.meetsTarget).toBe(false);

    expect(findingsOf(report, 'STRUCTURED_OUTPUT_REJECTED').map(({ subjectId }) => subjectId))
      .toEqual(['bad:attempt:1']);
    expect(findingsOf(report, 'STRUCTURED_OUTPUT_REJECTED')[0].severity).toBe('severe');
    // The unanswered attempt is still REPORTED — under its own code, off the rate.
    expect(findingsOf(report, 'PROVIDER_ATTEMPT_FAILED').map(({ subjectId }) => subjectId))
      .toEqual(['gone:attempt:1']);
  });

  it('meets the target at exactly 0.98, because the §16.2 floor is inclusive', () => {
    const hundred = (parsed: number, rejected: number): AuthoringAttemptEvidence[] => [
      ...parsedAttempts(parsed),
      ...Array.from({ length: rejected }, (_, index) => attempt({
        attemptId: `bad:attempt:${index + 1}`, outcome: 'output_rejected', errorCode: 'SCENE_OUTPUT_INVALID',
      })),
    ];

    const boundary = metricOf(
      evaluateOperationalQuality(evidence({ attempts: hundred(98, 2) })).report,
      'structured_output_success_rate');
    expect(boundary.numerator).toBe(98);
    expect(boundary.denominator).toBe(100);
    expect(boundary.rate).toBe(0.98);
    expect(boundary.meetsTarget).toBe(true);

    // One rejection lower is the same fixture with a different verdict, so the boundary
    // assertion above is a claim about `>=` rather than about the fixture.
    const below = metricOf(
      evaluateOperationalQuality(evidence({ attempts: hundred(97, 3) })).report,
      'structured_output_success_rate');
    expect(below.rate).toBe(0.97);
    expect(below.meetsTarget).toBe(false);
  });

  it('leaves the rate unmeasured through a total outage, rather than reporting a schema failure', () => {
    const { report, breakdown } = evaluateOperationalQuality(evidence({
      attempts: Array.from({ length: 5 }, (_, index) => attempt({
        attemptId: `outage:attempt:${index + 1}`, outcome: 'provider_failed', errorCode: 'LLM_ROUTE_CHAIN_EXHAUSTED',
      })),
    }));
    const metric = metricOf(report, 'structured_output_success_rate');

    expect(metric.numerator).toBe(0);
    expect(metric.denominator).toBe(0);
    expect(metric.status).toBe('no_observations');
    expect(metric.rate).toBeNull();
    // The whole point: an outage must not read as a model that cannot follow a schema.
    expect(metric.rate).not.toBe(0);
    expect(metric.meetsTarget).toBeNull();
    expect(metric.excluded).toBe(5);

    expect(findingsOf(report, 'PROVIDER_ATTEMPT_FAILED')).toHaveLength(5);
    expect(findingsOf(report, 'STRUCTURED_OUTPUT_REJECTED')).toHaveLength(0);
    expect(breakdown.providerFailureReasons).toEqual([{ code: 'LLM_ROUTE_CHAIN_EXHAUSTED', count: 5 }]);
    expect(breakdown.structuredOutputReasons).toEqual([]);
  });

  it('tallies schema refusals and the models that served them, separately from provider failures', () => {
    const { breakdown } = evaluateOperationalQuality(evidence({
      attempts: [
        attempt({ attemptId: 'a:1', outcome: 'output_rejected', errorCode: 'SCENE_OUTPUT_INVALID' }),
        attempt({ attemptId: 'a:2', outcome: 'output_rejected', errorCode: 'SCENE_OUTPUT_INVALID' }),
        attempt({ attemptId: 'a:3', outcome: 'output_rejected', errorCode: 'SCENE_OUTPUT_PROVENANCE_MISMATCH' }),
        attempt({ attemptId: 'a:4', outcome: 'provider_failed', errorCode: 'LLM_HTTP_TIMEOUT', model: 'other-model' }),
        attempt({ attemptId: 'a:5' }),
      ],
    }));

    expect(breakdown.structuredOutputReasons).toEqual([
      { code: 'SCENE_OUTPUT_INVALID', count: 2 },
      { code: 'SCENE_OUTPUT_PROVENANCE_MISMATCH', count: 1 },
    ]);
    expect(breakdown.providerFailureReasons).toEqual([{ code: 'LLM_HTTP_TIMEOUT', count: 1 }]);
    expect(breakdown.models).toEqual([{ code: MODEL, count: 4 }, { code: 'other-model', count: 1 }]);
  });
});

// =============================================================================
// A finding carries ids and codes. Nothing else.
// =============================================================================

describe('FR-M002 operational: findings carry no payload', () => {
  /**
   * Evidence rows as a careless caller might build them: the declared fields plus the content the
   * row was derived FROM. The evaluator must read only what it declared, so none of the extra
   * fields can reach the report even though they were handed to it.
   */
  const withPayload = <T extends object>(row: T, payload: Record<string, unknown>): T =>
    ({ ...row, ...payload } as T);

  it('never echoes a field it did not declare, and details name only ids and codes', () => {
    const { report } = evaluateOperationalQuality(evidence({
      validations: [withPayload(
        validation({
          idempotencyKey: 'key-3', sceneId: 'group-1:scene:2',
          outcome: 'rejected', errorCode: 'TELEPORTATION_NOT_ALLOWED',
        }),
        { proposalSummary: MARKER, stateChanges: [{ reason: MARKER }], rejectionMessage: MARKER },
      )],
      scenes: [withPayload(
        safetyScene({ sceneId: 'group-1:scene:2', label: 'withhold', reasonCodes: ['EXTREME_VIOLENCE_DETAIL'] }),
        { classifiedText: MARKER, sceneSummary: MARKER },
      )],
      attempts: [withPayload(
        attempt({
          attemptId: 'sim:attempt:1', sceneId: 'group-1:scene:2',
          outcome: 'output_rejected', errorCode: 'SCENE_OUTPUT_INVALID',
        }),
        { prompt: MARKER, rawOutput: { sceneSummary: MARKER }, apiKey: MARKER },
      )],
    }));

    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain(MARKER);
    expect(serialised).not.toContain('rawOutput');
    expect(serialised).not.toContain('prompt');
    expect(serialised).not.toContain('apiKey');
    expect(serialised).not.toContain('classifiedText');

    // Everything a finding DOES name is an id or a code that the caller supplied as such.
    const allowedIds = new Set(['key-3', 'key-3:canon', 'group-1:scene:2', 'sim:attempt:1']);
    const allowedCodes = new Set([
      'TELEPORTATION_NOT_ALLOWED', 'EXTREME_VIOLENCE_DETAIL', 'withhold', 'SCENE_OUTPUT_INVALID',
    ]);
    expect(report.findings.length).toBeGreaterThan(0);
    for (const finding of report.findings) {
      expect(allowedIds.has(finding.subjectId)).toBe(true);
      expect(finding.detail).not.toContain(MARKER);
      for (const ref of finding.evidence) {
        expect(allowedIds.has(ref.id)).toBe(true);
        if (ref.code !== undefined) expect(allowedCodes.has(ref.code)).toBe(true);
      }
    }
  });
});

// =============================================================================
// The operational_health composite
// =============================================================================

describe('FR-M002 operational: the operational_health composite', () => {
  /**
   * structured 9/10 = 0.9 (weight 0.5), rejection 2/10 = 0.2 so acceptance 0.8 (weight 0.3),
   * classification 4/5 = 0.8 (weight 0.2).
   *
   *   0.5 × 0.9 + 0.3 × 0.8 + 0.2 × 0.8 = 0.45 + 0.24 + 0.16 = 0.85
   */
  const fullyMeasured = (): OperationalQualityEvidence => evidence({
    attempts: [
      ...parsedAttempts(9),
      attempt({ attemptId: 'bad:attempt:1', outcome: 'output_rejected', errorCode: 'SCENE_OUTPUT_INVALID' }),
    ],
    validations: [
      ...Array.from({ length: 8 }, (_, index) => validation({ idempotencyKey: `ok-${index}` })),
      validation({ idempotencyKey: 'no-1', outcome: 'rejected', errorCode: 'TELEPORTATION_NOT_ALLOWED' }),
      validation({ idempotencyKey: 'no-2', outcome: 'rejected', errorCode: 'TELEPORTATION_NOT_ALLOWED' }),
    ],
    scenes: [
      safetyScene({ sceneId: 'c1' }), safetyScene({ sceneId: 'c2' }),
      safetyScene({ sceneId: 'c3' }), safetyScene({ sceneId: 'c4' }),
      safetyScene({ sceneId: 'c5', label: null }),
    ],
  });

  it('weights structured 0.5, canon acceptance 0.3 (complement) and coverage 0.2', () => {
    const { report } = evaluateOperationalQuality(fullyMeasured());
    const score = report.score!;

    expect(score.key).toBe('operational_health');
    expect(score.value).toBe(0.85);
    expect(score.status).toBe('measured');
    expect(score.weightMeasured).toBe(1);
    expect(score.weightTotal).toBe(1);
    expect(score.components).toEqual([
      { key: 'structured_output', metricKey: 'structured_output_success_rate', weight: 0.5, value: 0.9, status: 'measured' },
      // The complement: a 0.2 rejection rate is 0.8 acceptance.
      { key: 'canon_acceptance', metricKey: 'canon_rejection_rate', weight: 0.3, value: 0.8, status: 'measured' },
      { key: 'classification_coverage', metricKey: 'scene_classification_coverage', weight: 0.2, value: 0.8, status: 'measured' },
    ]);
  });

  it('drops weightMeasured, and renormalises, when a component measured nothing', () => {
    const { report } = evaluateOperationalQuality({ ...fullyMeasured(), scenes: [] });
    const score = report.score!;

    expect(score.weightMeasured).toBe(0.8);
    expect(score.weightTotal).toBe(1);
    // (0.5 × 0.9 + 0.3 × 0.8) / 0.8 = 0.69 / 0.8
    expect(score.value).toBe(0.8625);
    expect(score.components.find(({ key }) => key === 'classification_coverage'))
      .toMatchObject({ value: null, status: 'no_observations' });
  });

  it('is null, not zero, for a window that measured nothing at all', () => {
    const score = evaluateOperationalQuality(evidence()).report.score!;
    expect(score.value).toBeNull();
    expect(score.value).not.toBe(0);
    expect(score.status).toBe('no_observations');
    expect(score.weightMeasured).toBe(0);
  });
});

// =============================================================================
// The window, the coverage and the digest
// =============================================================================

describe('FR-M002 operational: the window and the digest', () => {
  const windowed = (): OperationalQualityEvidence => ({
    worldId: WORLD_ID,
    fromWorldDay: 2,
    toWorldDay: 4,
    validations: [
      validation({ idempotencyKey: 'before-window', worldDay: 1, outcome: 'rejected', errorCode: 'SEQUENCE_GAP' }),
      validation({ idempotencyKey: 'inside-2', worldDay: 2 }),
      validation({ idempotencyKey: 'inside-4', worldDay: 4, outcome: 'rejected', errorCode: 'TELEPORTATION_NOT_ALLOWED' }),
      validation({ idempotencyKey: 'after-window', worldDay: 5, outcome: 'rejected', errorCode: 'SEQUENCE_GAP' }),
    ],
    attempts: [
      attempt({ attemptId: 'before:attempt:1', worldDay: 1, outcome: 'output_rejected', errorCode: 'SCENE_OUTPUT_INVALID' }),
      attempt({ attemptId: 'inside:attempt:1', worldDay: 2 }),
    ],
    scenes: [
      safetyScene({ sceneId: 'scene-before', worldDay: 1, label: 'withhold', reasonCodes: ['EXTREME_VIOLENCE_DETAIL'] }),
      safetyScene({ sceneId: 'scene-inside', worldDay: 4 }),
    ],
    scanLimitReached: false,
  });

  it('counts only evidence inside the inclusive window, and never names what it dropped', () => {
    const { report, breakdown } = evaluateOperationalQuality(windowed());

    expect(metricOf(report, 'canon_rejection_rate')).toMatchObject({ numerator: 1, denominator: 2 });
    expect(metricOf(report, 'structured_output_success_rate')).toMatchObject({ numerator: 1, denominator: 1 });
    expect(metricOf(report, 'safety_withhold_rate')).toMatchObject({ numerator: 0, denominator: 1 });
    expect(breakdown.rejectionReasons).toEqual([{ code: 'TELEPORTATION_NOT_ALLOWED', count: 1 }]);

    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain('before-window');
    expect(serialised).not.toContain('after-window');
    expect(serialised).not.toContain('scene-before');
  });

  it('reports the days it evaluated and the days inside the window that carried no evidence', () => {
    const { report } = evaluateOperationalQuality(windowed());

    expect(report.window).toEqual({ fromWorldDay: 2, toWorldDay: 4 });
    expect(report.coverage.worldDaysEvaluated).toEqual([2, 4]);
    expect(report.coverage.worldDaysWithoutEvidence).toEqual([3]);
    expect(report.coverage.scanLimitReached).toBe(false);
  });

  it('carries a truncated read through, rather than reporting a partial rate as a whole one', () => {
    const truncated = evaluateOperationalQuality({ ...windowed(), scanLimitReached: true }).report;
    expect(truncated.coverage.scanLimitReached).toBe(true);
    expect(truncated.digest).not.toBe(evaluateOperationalQuality(windowed()).report.digest);
  });

  it('gives one digest to two evaluations of the same evidence, and two to different evidence', () => {
    expect(evaluateOperationalQuality(windowed()).report.digest)
      .toBe(evaluateOperationalQuality(windowed()).report.digest);
    expect(evaluateOperationalQuality({ ...windowed(), toWorldDay: 3 }).report.digest)
      .not.toBe(evaluateOperationalQuality(windowed()).report.digest);
  });
});
