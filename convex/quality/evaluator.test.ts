/**
 * The shared evaluator contract (FR-M002, PRD §16.2). ART-58.
 *
 * Four evaluators will report through these shapes, so what is pinned here is the VOCABULARY
 * rather than any one evaluator's arithmetic:
 *
 *  - a rate with no denominator is `null`, never `0` — the whole reason
 *    `convex/shared/metricObservation.ts` exists, and the reason an empty world cannot report
 *    「嚴重 Canon 衝突 0」and pass a gate;
 *  - a composite score is renormalised by the weight that was actually MEASURED, and says how much
 *    of its definition that was, so a score built from one component out of five is visibly not
 *    the same number as a score built from all five;
 *  - a finding is unique per `(code, subjectId, worldDay)`, so re-evaluating a day cannot report a
 *    fault twice;
 *  - the digest is canonical over key order, so two evaluations of the same evidence produce one
 *    digest and a changed value produces a different one.
 */

import {
  composeScore,
  dedupeFindings,
  finishReport,
  observeMetric,
  reportDigest,
  uniqueDays,
  type CompositeScoreDefinition,
  type EvaluationReport,
  type MetricDefinition,
  type QualityFinding,
} from './evaluator';

/** A ceiling-type metric: 0 is best, so its score component is the complement of its rate. */
const CEILING: MetricDefinition = {
  key: 'severe_conflicts',
  prdName: '嚴重 Canon 衝突',
  numerator: 'accepted events carrying a severe finding',
  denominator: 'accepted events in the window',
  target: 0,
  direction: 'atMost',
};

/** A floor-type metric: 100% is best, so its score component is its rate. */
const FLOOR: MetricDefinition = {
  key: 'replay_consistency',
  prdName: 'Event Replay 一致率',
  numerator: 'days whose fold matches the stored snapshot',
  denominator: 'days carrying a daily snapshot',
  target: 1,
  direction: 'atLeast',
};

/**
 * Deliberately lopsided weights. With 0.75/0.25 a renormalised score and a raw weighted sum are
 * different numbers, so the assertion can tell them apart; with 0.5/0.5 they would agree on the
 * one case that matters and the test would prove nothing.
 */
const SCORE: CompositeScoreDefinition = {
  key: 'test_score',
  prdName: 'Test Score',
  components: [
    { key: 'conflict_integrity', metricKey: CEILING.key, weight: 0.75, transform: 'complement' },
    { key: 'replay_integrity', metricKey: FLOOR.key, weight: 0.25, transform: 'rate' },
  ],
};

const finding = (
  code: string,
  subjectId: string,
  worldDay: number,
  detail = 'detail',
): QualityFinding => ({ code, severity: 'severe', subjectId, worldDay, evidence: [], detail });

const reportBody = (
  overrides: Partial<Omit<EvaluationReport, 'digest' | 'schemaVersion'>> = {},
): Omit<EvaluationReport, 'digest' | 'schemaVersion'> => ({
  evaluatorId: 'continuity',
  evaluatorVersion: 1,
  worldId: 'mistwood',
  window: { fromWorldDay: 0, toWorldDay: 2 },
  metrics: [observeMetric(CEILING, 0, 4)],
  score: null,
  findings: [],
  coverage: { worldDaysEvaluated: [0, 1, 2], worldDaysWithoutEvidence: [], scanLimitReached: false },
  ...overrides,
});

describe('FR-M002 observeMetric', () => {
  it('reports no observations rather than 0% when the denominator is zero', () => {
    const observation = observeMetric(FLOOR, 0, 0);

    expect(observation.rate).toBeNull();
    // The specific lie this rule exists to prevent: a 100% target reported as met by a world that
    // measured nothing, and a 0 target reported as met by a rate that was never computed.
    expect(observation.rate).not.toBe(0);
    expect(observation.status).toBe('no_observations');
    expect(observation.meetsTarget).toBeNull();
    expect(observation.numerator).toBe(0);
    expect(observation.denominator).toBe(0);
  });

  it('distinguishes a measured zero from nothing measured', () => {
    const measured = observeMetric(CEILING, 0, 200);

    expect(measured.rate).toBe(0);
    expect(measured.status).toBe('measured');
    // A ceiling target of 0 that was actually observed over 200 events IS met.
    expect(measured.meetsTarget).toBe(true);
    expect(observeMetric(CEILING, 0, 0).meetsTarget).toBeNull();
  });

  it('carries the definition so the number is never read without its meaning', () => {
    const observation = observeMetric(FLOOR, 3, 4);

    expect(observation.key).toBe(FLOOR.key);
    expect(observation.label).toBe(FLOOR.prdName);
    expect(observation.target).toBe(1);
    expect(observation.direction).toBe('atLeast');
    expect(observation.rate).toBe(0.75);
    expect(observation.meetsTarget).toBe(false);
  });

  it('publishes exclusions rather than absorbing them into the denominator', () => {
    const observation = observeMetric(FLOOR, 2, 2, 5, 'days with no snapshot to replay against');

    expect(observation.denominator).toBe(2);
    expect(observation.excluded).toBe(5);
    expect(observation.excludedReason).toBe('days with no snapshot to replay against');
    expect(observation.rate).toBe(1);
  });
});

describe('FR-M002 composeScore', () => {
  it('renormalises by the measured weight and reports how much of the definition that was', () => {
    const score = composeScore(SCORE, [observeMetric(CEILING, 1, 2), observeMetric(FLOOR, 0, 0)]);

    // 1 - 0.5 = 0.5 over the only component that measured anything.
    expect(score.value).toBe(0.5);
    // Not the raw weighted sum, which would silently score the unmeasured component as zero.
    expect(score.value).not.toBe(0.375);
    expect(score.status).toBe('measured');
    expect(score.weightMeasured).toBe(0.75);
    expect(score.weightTotal).toBe(1);
    expect(score.components).toEqual([
      { key: 'conflict_integrity', metricKey: CEILING.key, weight: 0.75, value: 0.5, status: 'measured' },
      { key: 'replay_integrity', metricKey: FLOOR.key, weight: 0.25, value: null, status: 'no_observations' },
    ]);
  });

  it('is null when nothing was measured', () => {
    const score = composeScore(SCORE, [observeMetric(CEILING, 0, 0), observeMetric(FLOOR, 0, 0)]);

    expect(score.value).toBeNull();
    expect(score.status).toBe('no_observations');
    expect(score.weightMeasured).toBe(0);
    expect(score.weightTotal).toBe(1);
    expect(score.components.every((component) => component.value === null)).toBe(true);
    expect(score.components.every((component) => component.status === 'no_observations')).toBe(true);
  });

  it('applies complement to ceiling metrics and rate to floor metrics', () => {
    const score = composeScore(SCORE, [observeMetric(CEILING, 1, 4), observeMetric(FLOOR, 1, 4)]);

    const [conflict, replay] = score.components;
    expect(conflict.value).toBe(0.75);
    expect(replay.value).toBe(0.25);
    expect(score.value).toBe(0.625);
    expect(score.weightMeasured).toBe(1);
  });

  it('treats a component whose metric is absent as unmeasured', () => {
    const score = composeScore(SCORE, [observeMetric(CEILING, 0, 4)]);

    expect(score.components[1].value).toBeNull();
    expect(score.weightMeasured).toBe(0.75);
    expect(score.value).toBe(1);
  });
});

describe('FR-M002 dedupeFindings', () => {
  it('collapses one fault per (code, subjectId, worldDay) and keeps the first', () => {
    const deduped = dedupeFindings([
      finding('SEVERE_CANON_CONFLICT', 'mistwood#event#3', 1, 'first'),
      finding('SEVERE_CANON_CONFLICT', 'mistwood#event#3', 1, 'second'),
      finding('SEVERE_CANON_CONFLICT', 'mistwood#event#3', 2, 'other day'),
      finding('SEVERE_CANON_CONFLICT', 'mistwood#event#4', 1, 'other subject'),
      finding('CANON_CONFLICT', 'mistwood#event#3', 1, 'other code'),
    ]);

    expect(deduped).toHaveLength(4);
    expect(deduped.filter((entry) => entry.detail === 'second')).toEqual([]);
    expect(deduped.find((entry) => entry.subjectId === 'mistwood#event#3' && entry.worldDay === 1
      && entry.code === 'SEVERE_CANON_CONFLICT')?.detail).toBe('first');
  });

  it('sorts by world day, then code, then subject', () => {
    const deduped = dedupeFindings([
      finding('B_CODE', 'subject-b', 1),
      finding('A_CODE', 'subject-b', 1),
      finding('A_CODE', 'subject-a', 1),
      finding('B_CODE', 'subject-a', 0),
    ]);

    expect(deduped.map((entry) => `${entry.worldDay}/${entry.code}/${entry.subjectId}`)).toEqual([
      '0/B_CODE/subject-a',
      '1/A_CODE/subject-a',
      '1/A_CODE/subject-b',
      '1/B_CODE/subject-b',
    ]);
  });
});

describe('FR-M002 uniqueDays', () => {
  it('returns sorted, unique days', () => {
    expect(uniqueDays([3, 1, 3, 0, 1])).toEqual([0, 1, 3]);
  });
});

describe('FR-M002 reportDigest', () => {
  it('is stable across object key order', () => {
    expect(reportDigest({ a: 1, b: { c: 2, d: [3, { e: 4, f: 5 }] } }))
      .toBe(reportDigest({ b: { d: [3, { f: 5, e: 4 }], c: 2 }, a: 1 }));
  });

  it('changes when a value changes', () => {
    expect(reportDigest({ a: 1, b: 2 })).not.toBe(reportDigest({ a: 1, b: 3 }));
    expect(reportDigest({ a: 1, b: 2 })).not.toBe(reportDigest({ a: 1, b: '2' }));
  });

  it('is order-sensitive for arrays, because event order is evidence', () => {
    expect(reportDigest([1, 2])).not.toBe(reportDigest([2, 1]));
  });
});

describe('FR-M002 finishReport', () => {
  it('stamps schemaVersion 1 and a digest of everything else in the report', () => {
    const body = reportBody();
    const report = finishReport(body);

    expect(report.schemaVersion).toBe(1);
    const { digest, ...withoutDigest } = report;
    expect(digest).toBe(reportDigest(withoutDigest));
    // The digest covers the version stamp too: an unversioned body digests differently.
    expect(digest).not.toBe(reportDigest(body));
  });

  it('gives one digest to two reports over the same evidence', () => {
    expect(finishReport(reportBody()).digest).toBe(finishReport(reportBody()).digest);
  });

  it('gives a different digest when any part of the body changes', () => {
    const base = finishReport(reportBody()).digest;

    expect(finishReport(reportBody({ worldId: 'other' })).digest).not.toBe(base);
    expect(finishReport(reportBody({ window: { fromWorldDay: 0, toWorldDay: 3 } })).digest).not.toBe(base);
    expect(finishReport(reportBody({ metrics: [observeMetric(CEILING, 1, 4)] })).digest).not.toBe(base);
    expect(finishReport(reportBody({ findings: [finding('CANON_CONFLICT', 'mistwood#event#0', 0)] })).digest)
      .not.toBe(base);
    expect(finishReport(reportBody({
      coverage: { worldDaysEvaluated: [0, 1, 2], worldDaysWithoutEvidence: [], scanLimitReached: true },
    })).digest).not.toBe(base);
  });
});
