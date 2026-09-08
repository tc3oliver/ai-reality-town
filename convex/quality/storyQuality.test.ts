/**
 * The Story-quality evaluator (FR-M002 Arc Progress / Arc Stagnation / Recap Coverage / Spoiler
 * Violation; PRD §16.2 高重要度摘要覆蓋率 ≥ 95%). ART-89.
 *
 * ## Why every case asserts a code AND a numerator AND a denominator
 *
 * A coverage ratio can be wrong in three independent ways: the evaluator can miss the uncovered
 * event, it can report it but roll it into the wrong metric, or it can report both and count the
 * wrong population underneath. The third is invisible to a reader of the rate, and it is the one
 * this evaluator was written to prevent — `buildDailyEpisode` throws when an episode omits a
 * high-importance event, so a ratio taken over STORED episodes reads 100% by construction and
 * cannot fail. Every case below therefore pins the finding code and both sides of the ratio.
 *
 * `denominatorIsCanon` is the fixture that proves it: ten accepted events, four of them
 * high-importance, and a single releasable publication that cites three. An evaluator counting
 * the episodes against themselves reports 3/3; this one reports 3/4 and misses the §16.2 target.
 *
 * ## The fixtures are plain objects, deliberately
 *
 * `evaluateStoryQuality` is pure — no Convex, no clock, no I/O — so the evidence shapes are built
 * here directly rather than through a harness. What the operator query and the long-run harness
 * assemble is asserted where they assemble it; a harness in the middle of these cases would only
 * make a wrong denominator harder to see.
 *
 * ## The threshold boundary is a fixture, not a comment
 *
 * `importance >= highImportanceThreshold`, so the fixture carries an event at exactly 0.7 (in) and
 * one at 0.69 (out). Both are asserted, because a `>` would keep every other case in this file
 * passing while dropping the event §16.2 cares most about.
 */

import type { EvaluationReport, QualityFinding } from './evaluator';
import {
  STORY_QUALITY_EVALUATOR,
  STORY_QUALITY_EVALUATOR_ID,
  STORY_QUALITY_EVALUATOR_VERSION,
  STORY_QUALITY_FINDING_CODES,
  evaluateStoryQuality,
  type ArcEvidence,
  type CoverageExclusionEvidence,
  type PublishedContentEvidence,
  type StoryEventEvidence,
  type StoryQualityEvidence,
} from './storyQuality';

const WORLD_ID = 'mistwood-public';
const OPERATOR = 'operator-qiu';

/** The one day every coverage fixture lives on, so no case accidentally tests day chaining. */
const DAY = 1;

const HIGH_THRESHOLD = 0.7;
const STAGNATION_THRESHOLD = 3;

/** A phrase that exists nowhere but the fixtures, so its absence from a report is checkable. */
const MARKER = '鐘樓鑰匙的下落';
/** An operator's reason, in the zh-Hant an operator would actually type. */
const REAL_REASON = `這一段涉及${MARKER}，依編輯決議不進入公開摘要。`;

// --- fixtures ---------------------------------------------------------------

const storyEvent = (
  input: Partial<StoryEventEvidence> & { eventId: string },
): StoryEventEvidence => ({ worldDay: DAY, importance: 0.1, ...input });

const publication = (
  input: Partial<PublishedContentEvidence> & { contentRef: string },
): PublishedContentEvidence => ({
  worldDay: DAY,
  releasable: true,
  findingCodes: [],
  spoilerFindingCodes: [],
  citedEventIds: [],
  errorCode: null,
  ...input,
});

const exclusion = (
  input: Partial<CoverageExclusionEvidence> & { eventId: string },
): CoverageExclusionEvidence => ({
  worldDay: DAY,
  reason: REAL_REASON,
  operatorId: OPERATOR,
  ...input,
});

const arc = (input: Partial<ArcEvidence> & { arcId: string }): ArcEvidence => ({
  status: 'developing',
  active: true,
  // Defaults to the window end, so an arc is non-stagnant unless a case says otherwise.
  lastProgressWorldDay: DAY,
  revisionsInWindow: 1,
  reachedTerminal: false,
  terminalOutcomeRecorded: false,
  terminalConsequenceCount: 0,
  ...input,
});

const evidence = (overrides: Partial<StoryQualityEvidence> = {}): StoryQualityEvidence => ({
  worldId: WORLD_ID,
  fromWorldDay: DAY,
  toWorldDay: DAY,
  highImportanceThreshold: HIGH_THRESHOLD,
  stagnationThresholdWorldDays: STAGNATION_THRESHOLD,
  events: [],
  publications: [],
  exclusions: [],
  arcs: [],
  scanLimitReached: false,
  ...overrides,
});

/**
 * Ten accepted events on one day. Four are high-importance: one at exactly the threshold, one just
 * below it (`low-6`, at 0.69) to prove the comparison is `>=` and not `>`.
 */
const HIGH_EVENT_IDS = ['high-1', 'high-2', 'high-3', 'high-4'] as const;

const tenEvents = (): StoryEventEvidence[] => [
  storyEvent({ eventId: 'high-1', importance: HIGH_THRESHOLD }),
  storyEvent({ eventId: 'high-2', importance: 0.8 }),
  storyEvent({ eventId: 'high-3', importance: 0.9 }),
  storyEvent({ eventId: 'high-4', importance: 0.95 }),
  storyEvent({ eventId: 'low-1', importance: 0 }),
  storyEvent({ eventId: 'low-2', importance: 0.1 }),
  storyEvent({ eventId: 'low-3', importance: 0.2 }),
  storyEvent({ eventId: 'low-4', importance: 0.4 }),
  storyEvent({ eventId: 'low-5', importance: 0.5 }),
  storyEvent({ eventId: 'low-6', importance: 0.69 }),
];

/** The window's single episode, citing whichever accepted events the case says it accounts for. */
const episode = (
  citedEventIds: readonly string[],
  overrides: Partial<PublishedContentEvidence> = {},
): PublishedContentEvidence =>
  publication({ contentRef: 'episode:day-1', citedEventIds, ...overrides });

// --- readers ----------------------------------------------------------------

const codes = (findings: readonly QualityFinding[]): string[] => findings.map(({ code }) => code);

const metricOf = (report: EvaluationReport, key: string) => {
  const observation = report.metrics.find((entry) => entry.key === key);
  if (!observation) throw new Error(`report carries no metric '${key}'`);
  return observation;
};

const componentOf = (report: EvaluationReport, key: string) => {
  const component = report.score?.components.find((entry) => entry.key === key);
  if (!component) throw new Error(`report carries no score component '${key}'`);
  return component;
};

const findingOf = (findings: readonly QualityFinding[], code: string): QualityFinding => {
  const found = findings.find((entry) => entry.code === code);
  if (!found) throw new Error(`findings carry no '${code}': ${JSON.stringify(codes(findings))}`);
  return found;
};

const findingsWith = (report: EvaluationReport, code: string): QualityFinding[] =>
  report.findings.filter((entry) => entry.code === code);

/** `numerator/denominator` as one value, so a case cannot assert half of a ratio. */
const ratio = (report: EvaluationReport, key: string): [number, number] => {
  const observation = metricOf(report, key);
  return [observation.numerator, observation.denominator];
};

describe('the story-quality definition it publishes with every report', () => {
  it('fixes the severity of every finding code it can emit', () => {
    expect(STORY_QUALITY_FINDING_CODES).toEqual({
      HIGH_IMPORTANCE_EVENT_UNCOVERED: 'severe',
      SPOILER_VIOLATION: 'severe',
      WORLD_DAY_UNPUBLISHED: 'minor',
      ARC_STAGNANT: 'severe',
      ARC_WITHOUT_PROGRESS: 'minor',
      ARC_RESOLVED_WITHOUT_EVIDENCE: 'severe',
    });
  });

  it('states the §16.2 coverage target and the direction it is read in', () => {
    const coverage = STORY_QUALITY_EVALUATOR.metrics.find((metric) => metric.key === 'recap_coverage');

    expect(coverage?.prdName).toBe('高重要度摘要覆蓋率');
    expect(coverage?.target).toBe(0.95);
    expect(coverage?.direction).toBe('atLeast');
    // The denominator is DECLARED, so a dashboard reading the rate can tell what it is a rate of.
    expect(coverage?.denominator).toContain('high-importance accepted events in the window');
  });

  it('stamps every report with its own id and version', () => {
    const report = evaluateStoryQuality(evidence());

    expect(report.evaluatorId).toBe(STORY_QUALITY_EVALUATOR_ID);
    expect(report.evaluatorVersion).toBe(STORY_QUALITY_EVALUATOR_VERSION);
    expect(report.window).toEqual({ fromWorldDay: DAY, toWorldDay: DAY });
  });
});

describe('FR-M002 story: the coverage denominator is Canon, not the episodes', () => {
  const denominatorIsCanon = (): EvaluationReport => evaluateStoryQuality(evidence({
    events: tenEvents(),
    publications: [episode(['high-1', 'high-2', 'high-3', 'low-1'])],
  }));

  it('reports 3/4 against the four high-importance events Canon accepted', () => {
    const report = denominatorIsCanon();

    // The whole point: the episode cites three high-importance events, so an evaluator counting
    // the episodes against themselves reports 3/3 and passes. Canon holds four.
    expect(ratio(report, 'recap_coverage')).toEqual([3, 4]);
    expect(metricOf(report, 'recap_coverage').rate).toBe(0.75);
    expect(metricOf(report, 'recap_coverage').status).toBe('measured');
    expect(metricOf(report, 'recap_coverage').target).toBe(0.95);
    expect(metricOf(report, 'recap_coverage').meetsTarget).toBe(false);
    // Six low-importance events and one cited low-importance event move neither side.
    expect(metricOf(report, 'recap_coverage').excluded).toBe(0);
    expect(metricOf(report, 'recap_coverage').excludedReason).toBeNull();
  });

  it('names the one event that was left out, and only that one', () => {
    const report = denominatorIsCanon();
    const uncovered = findingsWith(report, 'HIGH_IMPORTANCE_EVENT_UNCOVERED');

    expect(uncovered).toHaveLength(1);
    expect(uncovered[0].severity).toBe('severe');
    expect(uncovered[0].subjectId).toBe('high-4');
    expect(uncovered[0].worldDay).toBe(DAY);
    expect(uncovered[0].evidence).toContainEqual({
      kind: 'accepted_event', id: 'high-4', worldDay: DAY, code: '0.95',
    });
    expect(uncovered[0].detail).toContain('high-4');
    // The day published a releasable episode, so the day itself is not at fault.
    expect(codes(report.findings)).not.toContain('WORLD_DAY_UNPUBLISHED');
    expect(codes(report.findings)).toEqual(['HIGH_IMPORTANCE_EVENT_UNCOVERED']);
  });

  it('meets the target and reports nothing once every high-importance event is cited', () => {
    const report = evaluateStoryQuality(evidence({
      events: tenEvents(),
      publications: [episode([...HIGH_EVENT_IDS])],
    }));

    expect(ratio(report, 'recap_coverage')).toEqual([4, 4]);
    expect(metricOf(report, 'recap_coverage').rate).toBe(1);
    expect(metricOf(report, 'recap_coverage').meetsTarget).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it('reads the threshold as `at least`, so the event exactly on it is in the denominator', () => {
    // `high-1` sits at exactly 0.7 and `low-6` at 0.69. Citing neither, a `>` comparison would
    // report 3/3 here; `>=` reports 3/4 and charges `high-1`.
    const report = evaluateStoryQuality(evidence({
      events: tenEvents(),
      publications: [episode(['high-2', 'high-3', 'high-4'])],
    }));

    expect(ratio(report, 'recap_coverage')).toEqual([3, 4]);
    expect(findingOf(report.findings, 'HIGH_IMPORTANCE_EVENT_UNCOVERED').subjectId).toBe('high-1');
    expect(JSON.stringify(report)).not.toContain('low-6');
  });
});

describe('FR-M002 story: a publication the coverage gate refused covers nothing', () => {
  const refused = (overrides: Partial<PublishedContentEvidence> = {}): EvaluationReport =>
    evaluateStoryQuality(evidence({
      events: tenEvents(),
      publications: [episode([...HIGH_EVENT_IDS], { releasable: false, ...overrides })],
    }));

  it('counts an episode that never reached an audience as covering nothing', () => {
    const report = refused({ findingCodes: ['COVERAGE_EVENT_OMITTED'] });

    // The SAME citations that scored 4/4 when releasable score 0/4 when the gate refused them.
    expect(ratio(report, 'recap_coverage')).toEqual([0, 4]);
    expect(metricOf(report, 'recap_coverage').rate).toBe(0);
    expect(metricOf(report, 'recap_coverage').status).toBe('measured');
    expect(metricOf(report, 'recap_coverage').meetsTarget).toBe(false);
    expect(findingsWith(report, 'HIGH_IMPORTANCE_EVENT_UNCOVERED').map(({ subjectId }) => subjectId))
      .toEqual([...HIGH_EVENT_IDS]);
  });

  it('names the day, carrying the refused publication’s finding code as the evidence', () => {
    const report = refused({ findingCodes: ['COVERAGE_EVENT_OMITTED'] });
    const day = findingOf(report.findings, 'WORLD_DAY_UNPUBLISHED');

    expect(day.severity).toBe('minor');
    expect(day.subjectId).toBe(`${WORLD_ID}:${DAY}`);
    expect(day.worldDay).toBe(DAY);
    expect(day.evidence).toEqual([{
      kind: 'publication', id: 'episode:day-1', worldDay: DAY, code: 'COVERAGE_EVENT_OMITTED',
    }]);
    expect(day.detail).toContain('1 attempted');
  });

  it('prefers the error code when the gate could not run at all', () => {
    const report = refused({ errorCode: 'COVERAGE_REPORT_MISSING', findingCodes: ['COVERAGE_EVENT_OMITTED'] });

    // Ran-and-refused and could-not-run are different failures; the error code wins because it
    // says the verdict is absent rather than negative.
    expect(findingOf(report.findings, 'WORLD_DAY_UNPUBLISHED').evidence).toContainEqual({
      kind: 'publication', id: 'episode:day-1', worldDay: DAY, code: 'COVERAGE_REPORT_MISSING',
    });
  });

  it('falls back to a fixed code when the refusal carries neither', () => {
    expect(findingOf(refused().findings, 'WORLD_DAY_UNPUBLISHED').evidence).toContainEqual({
      kind: 'publication', id: 'episode:day-1', worldDay: DAY, code: 'NOT_RELEASABLE',
    });
  });

  it('names a day that produced no publication at all', () => {
    const report = evaluateStoryQuality(evidence({ events: tenEvents() }));
    const day = findingOf(report.findings, 'WORLD_DAY_UNPUBLISHED');

    expect(day.evidence).toEqual([]);
    expect(day.detail).toContain('0 attempted');
    expect(ratio(report, 'recap_coverage')).toEqual([0, 4]);
  });
});

describe('FR-M002 story: an exclusion is only an exclusion when it carries a reason', () => {
  it('removes the excluded event from the denominator, and publishes the count', () => {
    const report = evaluateStoryQuality(evidence({
      events: tenEvents(),
      publications: [episode(['high-1', 'high-2', 'high-3'])],
      exclusions: [exclusion({ eventId: 'high-4' })],
    }));

    // Neither numerator nor denominator: a world that excluded everything must not read as fully
    // covered, which folding exclusions into the numerator would do.
    expect(ratio(report, 'recap_coverage')).toEqual([3, 3]);
    expect(metricOf(report, 'recap_coverage').rate).toBe(1);
    expect(metricOf(report, 'recap_coverage').meetsTarget).toBe(true);
    expect(metricOf(report, 'recap_coverage').excluded).toBe(1);
    expect(metricOf(report, 'recap_coverage').excludedReason).toContain('exclusion reason');
    expect(report.findings).toEqual([]);
  });

  /**
   * ART-166. These cases used to assert an `EXCLUSION_WITHOUT_REASON` finding as well. That code
   * was removed because `buildCoverageExclusion` — the only writer into `coverageExclusions` —
   * refuses any reason below `MIN_EXCLUSION_REASON_LENGTH`, so no stored row could ever produce
   * it, and a report that advertises a detection it cannot perform is a false claim about the
   * evidence. `coverageExclusions.test.ts` holds the guarantee at the boundary that enforces it.
   *
   * What these cases still pin is the part that matters and is NOT enforced at the writer: an
   * unusable exclusion must not shrink the denominator. That is the fail-open a bare
   * `exclusion !== undefined` test would introduce, and it would make a broken writer look like a
   * better coverage rate.
   */
  for (const [label, reason] of [
    ['empty', ''],
    ['whitespace', '   \n\t  '],
    ['below the write boundary’s floor', '太短'],
  ] as const) {
    it(`refuses to honour an exclusion whose reason is ${label}, and keeps the event counted`, () => {
      const report = evaluateStoryQuality(evidence({
        events: tenEvents(),
        publications: [episode(['high-1', 'high-2', 'high-3'])],
        exclusions: [exclusion({ eventId: 'high-4', reason })],
      }));

      // The event is STILL in the denominator — an unusable reason must not quietly shrink it —
      // and it is still charged as uncovered.
      expect(ratio(report, 'recap_coverage')).toEqual([3, 4]);
      expect(metricOf(report, 'recap_coverage').excluded).toBe(0);
      expect(metricOf(report, 'recap_coverage').meetsTarget).toBe(false);

      const uncovered = findingOf(report.findings, 'HIGH_IMPORTANCE_EVENT_UNCOVERED');
      expect(uncovered.subjectId).toBe('high-4');
      // The operator who declared the unusable exclusion is named, so the report says which
      // omission was attempted rather than reporting a bare uncovered event.
      expect(uncovered.evidence).toContainEqual({
        kind: 'publication', id: 'exclusion:high-4', code: OPERATOR,
      });
      expect(uncovered.detail).toContain(OPERATOR);
    });
  }

  it('does not report an unusable exclusion on an event that IS covered', () => {
    // Nothing is missing from the public record here, so there is nothing for §16.2 to report.
    // The event must not be dropped on its way through the un-honoured branch either.
    const report = evaluateStoryQuality(evidence({
      events: tenEvents(),
      publications: [episode([...HIGH_EVENT_IDS])],
      exclusions: [exclusion({ eventId: 'high-2', reason: ' ' })],
    }));

    expect(codes(report.findings)).toEqual([]);
    expect(ratio(report, 'recap_coverage')).toEqual([4, 4]);
  });

  it('declares no finding code the stored evidence cannot produce', () => {
    // Every declared code, and the fixture that produces it from evidence a writer can store.
    // `EXCLUSION_WITHOUT_REASON` had no such fixture and could not have had one, which is why it
    // is gone. Adding a code without adding its producer fails here.
    // Typed loosely on purpose. A `Record<keyof typeof STORY_QUALITY_FINDING_CODES, …>` would
    // catch a newly declared code too, but as a COMPILE error — which jest reports as
    // `Tests: 0 total`, indistinguishable from a clean pass in a filtered summary (CLAUDE.md §9).
    // The `satisfies` keeps a typo'd key a type error; exhaustiveness is asserted at runtime, so
    // the failure is a named red test.
    const producible = {
      HIGH_IMPORTANCE_EVENT_UNCOVERED: evidence({ events: tenEvents() }),
      WORLD_DAY_UNPUBLISHED: evidence({ events: tenEvents() }),
      SPOILER_VIOLATION: evidence({
        events: tenEvents(),
        publications: [publication({
          contentRef: 'episode:day-1', citedEventIds: [...HIGH_EVENT_IDS],
          findingCodes: ['SPOILER_FUTURE_EVENT'], spoilerFindingCodes: ['SPOILER_FUTURE_EVENT'],
        })],
      }),
      ARC_WITHOUT_PROGRESS: evidence({ arcs: [arc({ arcId: 'arc-1', revisionsInWindow: 0 })] }),
      ARC_STAGNANT: evidence({ arcs: [arc({ arcId: 'arc-1', lastProgressWorldDay: DAY - STAGNATION_THRESHOLD })] }),
      ARC_RESOLVED_WITHOUT_EVIDENCE: evidence({
        arcs: [arc({ arcId: 'arc-1', status: 'resolved', active: false, reachedTerminal: true })],
      }),
    } satisfies Partial<Record<keyof typeof STORY_QUALITY_FINDING_CODES, StoryQualityEvidence>>;

    expect(Object.keys(producible).sort()).toEqual(Object.keys(STORY_QUALITY_FINDING_CODES).sort());
    for (const [code, fixture] of Object.entries(producible)) {
      expect(codes(evaluateStoryQuality(fixture).findings)).toContain(code);
    }
  });
});

describe('FR-M002 story: a day whose published content is not due yet', () => {
  /** Day 1 published; day 2's Episode is composed on day 3's first commit, so it is pending. */
  const twoDays = (pendingWorldDays: readonly number[]): StoryQualityEvidence => evidence({
    fromWorldDay: 1,
    toWorldDay: 2,
    events: [
      storyEvent({ eventId: 'high-1', worldDay: 1, importance: 0.8 }),
      storyEvent({ eventId: 'high-2', worldDay: 1, importance: 0.9 }),
      storyEvent({ eventId: 'high-3', worldDay: 2, importance: 0.8 }),
      storyEvent({ eventId: 'high-4', worldDay: 2, importance: 0.9 }),
    ],
    publications: [publication({ contentRef: 'episode:day-1', worldDay: 1, citedEventIds: ['high-1', 'high-2'] })],
    pendingWorldDays,
  });

  it('excludes the pending day’s events rather than charging them as uncovered', () => {
    const report = evaluateStoryQuality(twoDays([2]));

    expect(ratio(report, 'recap_coverage')).toEqual([2, 2]);
    expect(metricOf(report, 'recap_coverage').rate).toBe(1);
    expect(metricOf(report, 'recap_coverage').excluded).toBe(2);
    expect(metricOf(report, 'recap_coverage').excludedReason).toContain('not due yet');
    // An observation that cannot yet answer the question is not one that answered it badly.
    expect(report.findings).toEqual([]);
    expect(JSON.stringify(report.findings)).not.toContain('high-3');
  });

  it('charges the very same day once its published content is due', () => {
    const report = evaluateStoryQuality(twoDays([]));

    expect(ratio(report, 'recap_coverage')).toEqual([2, 4]);
    expect(metricOf(report, 'recap_coverage').excluded).toBe(0);
    expect(findingsWith(report, 'HIGH_IMPORTANCE_EVENT_UNCOVERED').map(({ subjectId }) => subjectId))
      .toEqual(['high-3', 'high-4']);
    expect(findingOf(report.findings, 'WORLD_DAY_UNPUBLISHED').subjectId).toBe(`${WORLD_ID}:2`);
  });

  it('measures nothing, rather than reporting zero, when every day is pending', () => {
    const report = evaluateStoryQuality(twoDays([1, 2]));
    const coverage = metricOf(report, 'recap_coverage');

    expect(coverage.status).toBe('no_observations');
    expect(coverage.denominator).toBe(0);
    expect(coverage.rate).toBeNull();
    // The specific lie the rule exists to prevent: a world whose recaps are all still pending
    // reporting 「高重要度摘要覆蓋率 0%」 — or, through the complement, passing a gate on nothing.
    expect(coverage.rate).not.toBe(0);
    expect(coverage.meetsTarget).toBeNull();
    expect(coverage.excluded).toBe(4);
    expect(report.findings).toEqual([]);

    // Coverage carries 0.4 of the composite. Unmeasured, it leaves the spoiler component alone.
    expect(componentOf(report, 'coverage').value).toBeNull();
    expect(componentOf(report, 'coverage').status).toBe('no_observations');
    expect(report.score?.weightMeasured).toBe(0.3);
    expect(report.score?.weightTotal).toBe(1);
    expect(evaluateStoryQuality(twoDays([])).score?.weightMeasured).toBe(0.7);
  });
});

describe('FR-M002 story: spoiler violations, read from the verdict and not the text', () => {
  const withSpoilers = (spoilerFindingCodes: readonly string[]): EvaluationReport =>
    evaluateStoryQuality(evidence({
      events: tenEvents(),
      publications: [
        episode([...HIGH_EVENT_IDS]),
        publication({ contentRef: 'recap:day-1', spoilerFindingCodes, findingCodes: [...spoilerFindingCodes] }),
      ],
    }));

  it('charges the publication whose persisted verdict carries a spoiler finding', () => {
    const report = withSpoilers(['SPOILER_UNREVEALED_ARC_OUTCOME', 'SPOILER_PRIVATE_KNOWLEDGE']);
    const finding = findingOf(report.findings, 'SPOILER_VIOLATION');

    expect(finding.severity).toBe('severe');
    expect(finding.subjectId).toBe('recap:day-1');
    expect(finding.evidence).toContainEqual({ kind: 'publication', id: 'recap:day-1', worldDay: DAY });
    for (const code of ['SPOILER_UNREVEALED_ARC_OUTCOME', 'SPOILER_PRIVATE_KNOWLEDGE']) {
      expect(finding.evidence).toContainEqual({ kind: 'coverage_report', id: 'recap:day-1', code });
    }
    // Charged once per publication, not once per code.
    expect(findingsWith(report, 'SPOILER_VIOLATION')).toHaveLength(1);

    expect(ratio(report, 'spoiler_violation_rate')).toEqual([1, 2]);
    expect(metricOf(report, 'spoiler_violation_rate').rate).toBe(0.5);
    expect(metricOf(report, 'spoiler_violation_rate').target).toBe(0);
    expect(metricOf(report, 'spoiler_violation_rate').direction).toBe('atMost');
    expect(metricOf(report, 'spoiler_violation_rate').meetsTarget).toBe(false);
  });

  it('reports a measured zero when no verdict carries one', () => {
    const report = withSpoilers([]);

    expect(codes(report.findings)).not.toContain('SPOILER_VIOLATION');
    expect(ratio(report, 'spoiler_violation_rate')).toEqual([0, 2]);
    expect(metricOf(report, 'spoiler_violation_rate').status).toBe('measured');
    expect(metricOf(report, 'spoiler_violation_rate').rate).toBe(0);
    expect(metricOf(report, 'spoiler_violation_rate').meetsTarget).toBe(true);
  });

  it('measures every publication with a verdict, releasable or not', () => {
    // The denominator is publications with a persisted verdict — a refused publication was still
    // examined for spoilers, and dropping it would let a world hide violations by refusing them.
    const report = evaluateStoryQuality(evidence({
      events: tenEvents(),
      publications: [
        episode([...HIGH_EVENT_IDS]),
        publication({ contentRef: 'recap:day-1', releasable: false, spoilerFindingCodes: ['SPOILER_PRIVATE_KNOWLEDGE'] }),
      ],
    }));

    expect(ratio(report, 'spoiler_violation_rate')).toEqual([1, 2]);
    expect(findingOf(report.findings, 'SPOILER_VIOLATION').subjectId).toBe('recap:day-1');
  });
});

describe('FR-M002 story: arc progress and stagnation', () => {
  const arcWindow = (arcs: readonly ArcEvidence[]): EvaluationReport =>
    evaluateStoryQuality(evidence({ fromWorldDay: 0, toWorldDay: 10, arcs }));

  it('charges the active arc that appended no revision in the window', () => {
    const report = arcWindow([
      arc({ arcId: 'arc-mill', lastProgressWorldDay: 10, revisionsInWindow: 2 }),
      arc({ arcId: 'arc-ledger', lastProgressWorldDay: 9, revisionsInWindow: 0, status: 'rising' }),
    ]);
    const finding = findingOf(report.findings, 'ARC_WITHOUT_PROGRESS');

    expect(finding.severity).toBe('minor');
    expect(finding.subjectId).toBe('arc-ledger');
    expect(finding.worldDay).toBe(10);
    expect(finding.evidence).toEqual([{ kind: 'arc', id: 'arc-ledger', code: 'rising' }]);

    expect(ratio(report, 'arc_progress_rate')).toEqual([1, 2]);
    expect(metricOf(report, 'arc_progress_rate').rate).toBe(0.5);
    // No PRD target on progress: it is read, not gated.
    expect(metricOf(report, 'arc_progress_rate').target).toBeNull();
    expect(metricOf(report, 'arc_progress_rate').meetsTarget).toBeNull();
    // Nine days short of the threshold on one arc, one on the other: neither is stagnant.
    expect(codes(report.findings)).not.toContain('ARC_STAGNANT');
    expect(ratio(report, 'arc_stagnation_rate')).toEqual([0, 2]);
  });

  it('fires at exactly the stagnation threshold and not one day before it', () => {
    // `toWorldDay` 10, threshold 3. Last progress on day 8 is two days ago; day 7 is three.
    const belowThreshold = arcWindow([arc({ arcId: 'arc-ledger', lastProgressWorldDay: 8, revisionsInWindow: 1 })]);
    const atThreshold = arcWindow([arc({ arcId: 'arc-ledger', lastProgressWorldDay: 7, revisionsInWindow: 1 })]);

    expect(codes(belowThreshold.findings)).not.toContain('ARC_STAGNANT');
    expect(ratio(belowThreshold, 'arc_stagnation_rate')).toEqual([0, 1]);
    expect(metricOf(belowThreshold, 'arc_stagnation_rate').meetsTarget).toBe(true);

    const finding = findingOf(atThreshold.findings, 'ARC_STAGNANT');
    expect(finding.severity).toBe('severe');
    expect(finding.subjectId).toBe('arc-ledger');
    expect(finding.detail).toContain('3 world days');
    expect(finding.detail).toContain(`threshold ${STAGNATION_THRESHOLD}`);
    expect(ratio(atThreshold, 'arc_stagnation_rate')).toEqual([1, 1]);
    expect(metricOf(atThreshold, 'arc_stagnation_rate').rate).toBe(1);
    expect(metricOf(atThreshold, 'arc_stagnation_rate').target).toBe(0);
    expect(metricOf(atThreshold, 'arc_stagnation_rate').meetsTarget).toBe(false);
  });

  it('reports an arc that is both stagnant and without progress under both codes', () => {
    const report = arcWindow([arc({ arcId: 'arc-ledger', lastProgressWorldDay: 0, revisionsInWindow: 0 })]);

    expect(codes(report.findings).sort()).toEqual(['ARC_STAGNANT', 'ARC_WITHOUT_PROGRESS']);
    expect(ratio(report, 'arc_progress_rate')).toEqual([0, 1]);
    expect(ratio(report, 'arc_stagnation_rate')).toEqual([1, 1]);
  });

  it('keeps a non-active arc out of both denominators, and reports nothing about it', () => {
    const report = arcWindow([
      arc({ arcId: 'arc-mill', revisionsInWindow: 2, lastProgressWorldDay: 10 }),
      arc({ arcId: 'arc-ledger', revisionsInWindow: 0, lastProgressWorldDay: 9, status: 'rising' }),
      // Dormant, unadvanced and long-stale — everything the two checks look for, except active.
      arc({ arcId: 'arc-dormant', active: false, status: 'dormant', revisionsInWindow: 0, lastProgressWorldDay: 0 }),
    ]);

    expect(ratio(report, 'arc_progress_rate')).toEqual([1, 2]);
    expect(ratio(report, 'arc_stagnation_rate')).toEqual([0, 2]);
    expect(JSON.stringify(report)).not.toContain('arc-dormant');
  });

  it('measures nothing, rather than reporting a perfect pace, for a world with no active arc', () => {
    const report = arcWindow([arc({ arcId: 'arc-dormant', active: false, revisionsInWindow: 0, lastProgressWorldDay: 0 })]);

    for (const key of ['arc_progress_rate', 'arc_stagnation_rate']) {
      expect(metricOf(report, key).status).toBe('no_observations');
      expect(metricOf(report, key).denominator).toBe(0);
      expect(metricOf(report, key).rate).toBeNull();
      expect(metricOf(report, key).rate).not.toBe(0);
      expect(metricOf(report, key).meetsTarget).toBeNull();
    }
  });
});

describe('FR-M002 story: an arc that ended without saying what it ended as', () => {
  const terminal = (arcs: readonly ArcEvidence[]): EvaluationReport =>
    evaluateStoryQuality(evidence({ fromWorldDay: 0, toWorldDay: 10, arcs }));

  const resolved = (input: Partial<ArcEvidence> & { arcId: string }): ArcEvidence =>
    arc({ status: 'resolved', active: false, reachedTerminal: true, revisionsInWindow: 0, ...input });

  it('charges the resolution that carries no outcome, and not the one that does', () => {
    const report = terminal([
      resolved({ arcId: 'arc-mill', terminalOutcomeRecorded: true, terminalConsequenceCount: 2 }),
      resolved({ arcId: 'arc-ledger', terminalOutcomeRecorded: false, terminalConsequenceCount: 3 }),
    ]);
    const finding = findingOf(report.findings, 'ARC_RESOLVED_WITHOUT_EVIDENCE');

    expect(finding.severity).toBe('severe');
    expect(finding.subjectId).toBe('arc-ledger');
    expect(finding.evidence).toEqual([{ kind: 'arc', id: 'arc-ledger', code: 'resolved' }]);
    expect(finding.detail).toContain('no recorded outcome');

    expect(ratio(report, 'arc_resolution_evidence')).toEqual([1, 2]);
    expect(metricOf(report, 'arc_resolution_evidence').rate).toBe(0.5);
    expect(metricOf(report, 'arc_resolution_evidence').target).toBe(1);
    expect(metricOf(report, 'arc_resolution_evidence').meetsTarget).toBe(false);
  });

  it('charges an outcome recorded with no consequence at all', () => {
    const report = terminal([
      resolved({ arcId: 'arc-mill', terminalOutcomeRecorded: true, terminalConsequenceCount: 1 }),
      resolved({ arcId: 'arc-ledger', status: 'archived', terminalOutcomeRecorded: true, terminalConsequenceCount: 0 }),
    ]);
    const finding = findingOf(report.findings, 'ARC_RESOLVED_WITHOUT_EVIDENCE');

    expect(finding.subjectId).toBe('arc-ledger');
    expect(finding.detail).toContain('no consequence');
    expect(finding.detail).toContain('archived');
    expect(ratio(report, 'arc_resolution_evidence')).toEqual([1, 2]);
  });

  it('leaves the resolution metric unmeasured when no arc reached a terminal status', () => {
    const report = terminal([arc({ arcId: 'arc-mill', lastProgressWorldDay: 10 })]);

    expect(metricOf(report, 'arc_resolution_evidence').status).toBe('no_observations');
    expect(metricOf(report, 'arc_resolution_evidence').denominator).toBe(0);
    expect(metricOf(report, 'arc_resolution_evidence').rate).toBeNull();
    expect(metricOf(report, 'arc_resolution_evidence').meetsTarget).toBeNull();
  });
});

describe('FR-M002 story: the story-health composite', () => {
  it('weights coverage 0.4, spoiler safety 0.3, arc progress 0.2 and pacing 0.1', () => {
    expect(STORY_QUALITY_EVALUATOR.score?.components).toEqual([
      { key: 'coverage', metricKey: 'recap_coverage', weight: 0.4, transform: 'rate' },
      { key: 'spoiler_safety', metricKey: 'spoiler_violation_rate', weight: 0.3, transform: 'complement' },
      { key: 'arc_progress', metricKey: 'arc_progress_rate', weight: 0.2, transform: 'rate' },
      { key: 'arc_pacing', metricKey: 'arc_stagnation_rate', weight: 0.1, transform: 'complement' },
    ]);
  });

  it('composes a hand-computed value from four measured components', () => {
    const report = evaluateStoryQuality(evidence({
      events: tenEvents(),
      publications: [
        episode(['high-1', 'high-2', 'high-3']),
        publication({ contentRef: 'recap:day-1' }),
      ],
      arcs: [
        arc({ arcId: 'arc-mill', revisionsInWindow: 2 }),
        arc({ arcId: 'arc-ledger', revisionsInWindow: 0 }),
      ],
    }));

    expect(componentOf(report, 'coverage')).toMatchObject({ value: 0.75, status: 'measured' });
    // A ceiling metric enters as its complement: 0 violations out of 2 is a 1.
    expect(componentOf(report, 'spoiler_safety')).toMatchObject({ value: 1, status: 'measured' });
    expect(componentOf(report, 'arc_progress')).toMatchObject({ value: 0.5, status: 'measured' });
    expect(componentOf(report, 'arc_pacing')).toMatchObject({ value: 1, status: 'measured' });

    // 0.4×0.75 + 0.3×1 + 0.2×0.5 + 0.1×1 = 0.3 + 0.3 + 0.1 + 0.1.
    expect(report.score?.key).toBe('story_health');
    expect(report.score?.value).toBe(0.8);
    expect(report.score?.status).toBe('measured');
    expect(report.score?.weightMeasured).toBe(1);
    expect(report.score?.weightTotal).toBe(1);
  });

  it('lowers the measured weight, not the value, when a component measures nothing', () => {
    // Every measured component is a 1, so dropping the arcs cannot move the renormalised mean —
    // which is what makes `weightMeasured` the assertion that carries the claim.
    const clean = (arcs: readonly ArcEvidence[]) => evaluateStoryQuality(evidence({
      events: tenEvents(),
      publications: [episode([...HIGH_EVENT_IDS]), publication({ contentRef: 'recap:day-1' })],
      arcs,
    }));
    const withArcs = clean([arc({ arcId: 'arc-mill', revisionsInWindow: 2 }), arc({ arcId: 'arc-ledger', revisionsInWindow: 1 })]);
    const withoutArcs = clean([]);

    expect(withArcs.score?.value).toBe(1);
    expect(withArcs.score?.weightMeasured).toBe(1);

    expect(withoutArcs.score?.value).toBe(1);
    // 0.4 coverage + 0.3 spoiler safety. A score built from two components out of four is
    // visibly not the same score, even though it reads the same number.
    expect(withoutArcs.score?.weightMeasured).toBe(0.7);
    expect(withoutArcs.score?.weightTotal).toBe(1);
    expect(componentOf(withoutArcs, 'arc_progress').value).toBeNull();
    expect(componentOf(withoutArcs, 'arc_pacing').value).toBeNull();
  });

  it('reports a null score for a window carrying no evidence at all', () => {
    const report = evaluateStoryQuality(evidence({ fromWorldDay: 0, toWorldDay: 2 }));

    expect(report.metrics).toHaveLength(5);
    for (const observation of report.metrics) {
      expect(observation.status).toBe('no_observations');
      expect(observation.rate).toBeNull();
      expect(observation.rate).not.toBe(0);
      expect(observation.meetsTarget).toBeNull();
    }
    expect(report.score?.value).toBeNull();
    expect(report.score?.status).toBe('no_observations');
    expect(report.score?.weightMeasured).toBe(0);
    expect(report.coverage.worldDaysEvaluated).toEqual([]);
    expect(report.coverage.worldDaysWithoutEvidence).toEqual([0, 1, 2]);
  });
});

describe('FR-M002 story: a report carries references, never prose', () => {
  const leaky = (): EvaluationReport => evaluateStoryQuality(evidence({
    events: tenEvents(),
    publications: [
      episode(['high-1', 'high-2']),
      publication({ contentRef: 'recap:day-1', spoilerFindingCodes: ['SPOILER_UNREVEALED_ARC_OUTCOME'] }),
    ],
    // `high-3` is excluded with a real, reviewable reason; `high-4` is simply uncovered.
    exclusions: [exclusion({ eventId: 'high-3' })],
  }));

  it('names the evidence by id and code', () => {
    const report = leaky();
    const serialised = JSON.stringify(report);

    expect(new Set(codes(report.findings))).toEqual(new Set([
      'HIGH_IMPORTANCE_EVENT_UNCOVERED', 'SPOILER_VIOLATION',
    ]));
    expect(serialised).toContain('high-4');
    expect(serialised).toContain('recap:day-1');
    expect(serialised).toContain('SPOILER_UNREVEALED_ARC_OUTCOME');
    expect(ratio(report, 'recap_coverage')).toEqual([2, 3]);
  });

  it('never copies the operator’s exclusion reason into the report', () => {
    const report = leaky();

    // The reason is the operator's own words about world content. The report says HOW MANY events
    // were excluded and that a reason existed; the sentence itself stays where it was written.
    expect(JSON.stringify(report)).not.toContain(MARKER);
    expect(JSON.stringify(report)).not.toContain(REAL_REASON);
    // Including in the metric's own excluded reason, which is fixed vocabulary and a count.
    expect(metricOf(report, 'recap_coverage').excludedReason).not.toContain(MARKER);
    expect(metricOf(report, 'recap_coverage').excluded).toBe(1);

    // Every detail sentence is built from ids, numbers and fixed vocabulary only.
    for (const finding of report.findings) {
      expect(finding.detail).not.toContain(MARKER);
      expect(finding.detail).not.toContain(REAL_REASON);
    }
  });

  it('reports nothing at all about the event it excluded', () => {
    expect(JSON.stringify(leaky().findings)).not.toContain('high-3');
  });
});

describe('FR-M002 story: the window and the digest', () => {
  const windowed = (outsideDay: number): StoryQualityEvidence => evidence({
    fromWorldDay: 1,
    toWorldDay: 3,
    events: [
      storyEvent({ eventId: 'high-1', worldDay: 1, importance: 0.8 }),
      storyEvent({ eventId: 'high-2', worldDay: 3, importance: 0.9 }),
      storyEvent({ eventId: 'high-outside', worldDay: outsideDay, importance: 0.9 }),
    ],
    publications: [
      publication({ contentRef: 'episode:day-1', worldDay: 1, citedEventIds: ['high-1'] }),
      publication({ contentRef: 'episode:day-3', worldDay: 3, citedEventIds: ['high-2'] }),
    ],
  });

  it('neither counts nor reports an event outside the window, and names the empty day', () => {
    const report = evaluateStoryQuality(windowed(9));

    expect(report.findings).toEqual([]);
    expect(ratio(report, 'recap_coverage')).toEqual([2, 2]);
    // Out of window is not the same as excluded: an excluded event was in scope and left out,
    // this one was never in scope, so it must not inflate the excluded count either.
    expect(metricOf(report, 'recap_coverage').excluded).toBe(0);
    expect(metricOf(report, 'recap_coverage').excludedReason).toBeNull();
    expect(report.coverage.worldDaysEvaluated).toEqual([1, 3]);
    expect(report.coverage.worldDaysWithoutEvidence).toEqual([2]);
    expect(JSON.stringify(report)).not.toContain('high-outside');
  });

  it('charges the very same event once it falls inside the window', () => {
    const report = evaluateStoryQuality(windowed(2));

    expect(findingOf(report.findings, 'HIGH_IMPORTANCE_EVENT_UNCOVERED').subjectId).toBe('high-outside');
    expect(findingOf(report.findings, 'WORLD_DAY_UNPUBLISHED').subjectId).toBe(`${WORLD_ID}:2`);
    expect(ratio(report, 'recap_coverage')).toEqual([2, 3]);
    expect(report.coverage.worldDaysEvaluated).toEqual([1, 2, 3]);
    expect(report.coverage.worldDaysWithoutEvidence).toEqual([]);
  });

  it('drops an out-of-window publication from the spoiler denominator', () => {
    const report = evaluateStoryQuality({
      ...windowed(9),
      publications: [
        publication({ contentRef: 'episode:day-1', worldDay: 1, citedEventIds: ['high-1'] }),
        publication({ contentRef: 'episode:day-3', worldDay: 3, citedEventIds: ['high-2'] }),
        publication({ contentRef: 'episode:day-9', worldDay: 9, spoilerFindingCodes: ['SPOILER_PRIVATE_KNOWLEDGE'] }),
      ],
    });

    expect(ratio(report, 'spoiler_violation_rate')).toEqual([0, 2]);
    expect(codes(report.findings)).not.toContain('SPOILER_VIOLATION');
  });

  it('gives one digest to two evaluations of the same evidence', () => {
    expect(evaluateStoryQuality(windowed(9)).digest).toBe(evaluateStoryQuality(windowed(9)).digest);
    expect(evaluateStoryQuality(windowed(2)).digest).not.toBe(evaluateStoryQuality(windowed(9)).digest);
  });

  it('carries the truncation flag through, so a partial read is never read as a whole one', () => {
    expect(evaluateStoryQuality({ ...windowed(9), scanLimitReached: true }).coverage.scanLimitReached).toBe(true);
    expect(evaluateStoryQuality(windowed(9)).coverage.scanLimitReached).toBe(false);
  });

  it('reports one finding per fault however often the evidence repeats it', () => {
    // Re-evaluating a window, or reading the same accepted event through two publications, must
    // not turn one uncovered event into two findings.
    const report = evaluateStoryQuality(evidence({
      events: [...tenEvents(), ...tenEvents()],
      publications: [episode(['high-1', 'high-2', 'high-3'])],
    }));

    expect(findingsWith(report, 'HIGH_IMPORTANCE_EVENT_UNCOVERED')).toHaveLength(1);
    expect(findingsWith(report, 'WORLD_DAY_UNPUBLISHED')).toHaveLength(0);
  });
});
