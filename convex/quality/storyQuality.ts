/**
 * The Story-quality evaluator (FR-M002 Arc Progress, Arc Stagnation, Recap Coverage, Spoiler
 * Violation; PRD §16.2 高重要度摘要覆蓋率 ≥ 95%). ART-89.
 *
 * Pure: no Convex, no clock, no randomness, no I/O. The operator query and the long-run harness
 * hand it the same evidence shapes and get the same numbers.
 *
 * ## The denominator is Canon, not the episodes
 *
 * `recap_coverage`'s denominator is the HIGH-IMPORTANCE ACCEPTED EVENTS of the window, read from
 * Canon by index. Not the events the episodes happen to cite — that would be a ratio of the
 * episodes against themselves. It matters here more than anywhere else in this repository:
 * `buildDailyEpisode` THROWS `EPISODE_IMPORTANT_EVENT_MISSING` when an episode omits a
 * high-importance event, so an episode that would have failed coverage never gets stored. A
 * coverage ratio computed over stored episodes therefore reads 100% by construction and could not
 * fail — the exact tautology CLAUDE.md §9 warns about. Reading Canon independently is what makes
 * the days that produced NO publishable episode — withheld, failed, gate-refused — count as
 * uncovered, which is the whole signal §16.2 is asking for.
 *
 * ## What counts as covered
 *
 * A high-importance accepted event is covered when a RELEASABLE published content in the window
 * cites it. Releasable is the persisted FR-G004 verdict (`episodeCoverageReports.releasable`), so
 * an episode the coverage gate refused does not cover anything — it never reached an audience.
 * An event with a declared exclusion carrying a reviewable reason is EXCLUDED: it counts in neither
 * numerator nor denominator, and the count and the reason travel with the report. §16.2 says
 * "covered OR carries an explicit reviewable exclusion reason", and a metric that folded
 * exclusions into the numerator would report a world that excluded everything as fully covered.
 *
 * ## Why there is no `EXCLUSION_WITHOUT_REASON` code (ART-166)
 *
 * There was one until ART-166, declared `severe` and reported when a stored exclusion's reason was
 * blank. **It could not fire, and the claim it made was wrong.** `buildCoverageExclusion` is the
 * only writer into `coverageExclusions`, and it refuses any reason shorter than
 * `MIN_EXCLUSION_REASON_LENGTH` after trimming — a floor strictly stronger than "not blank". No
 * stored row could reach the branch, so the evaluator advertised a detection it could never
 * perform, and in doing so hid where the guarantee actually lives: at the write boundary, not here.
 * The published `findingCodes` map is a promise about what a report can tell an operator, and a
 * code the evidence cannot produce is a promise that is never kept.
 *
 * The BEHAVIOUR the code accompanied is kept, and is what matters: an exclusion whose reason does
 * not clear that same floor is not honoured, so the event stays in the denominator and, if nothing
 * cites it, is reported as `HIGH_IMPORTANCE_EVENT_UNCOVERED` naming the operator who declared the
 * unusable exclusion. Dropping the branch outright would have been the dangerous edit: an
 * `exclusion !== undefined` test alone would let a blank reason silently shrink the denominator,
 * which turns a broken writer into a better-looking coverage rate.
 *
 * ## Which stagnation threshold
 *
 * `ARC_STAGNATION_WORLD_DAYS` — the one `detectArcStagnation` uses and the one the harness reports.
 * The post-commit ladder carries its own downgrade and wind-down constants for REMEDIATION; those
 * decide what to do about a stagnant arc, not whether it is stagnant, and a metric measured against
 * them would disagree with the detector for arcs between the two numbers.
 *
 * ## Privacy
 *
 * Findings carry event ids, arc ids, content refs and finding codes. Recap prose, secret text and
 * private knowledge never enter: the spoiler metric reads the persisted verdict's CODES, not the
 * text that produced them.
 */

import { MIN_EXCLUSION_REASON_LENGTH } from '../recaps/coverageExclusions';
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

export const STORY_QUALITY_EVALUATOR_ID = 'story_quality';
export const STORY_QUALITY_EVALUATOR_VERSION = 1;

export const STORY_QUALITY_FINDING_CODES = {
  /** A high-importance accepted event no releasable published content cites, and no exclusion covers. */
  HIGH_IMPORTANCE_EVENT_UNCOVERED: 'severe',
  /** A published content whose persisted coverage report carries a spoiler-category finding. */
  SPOILER_VIOLATION: 'severe',
  /** A world day that produced accepted events but no releasable published content at all. */
  WORLD_DAY_UNPUBLISHED: 'minor',
  /** An active arc that has not advanced a projection revision for the stagnation threshold. */
  ARC_STAGNANT: 'severe',
  /** An active arc that advanced no revision inside the window. */
  ARC_WITHOUT_PROGRESS: 'minor',
  /** An arc that reached a terminal status carrying no outcome or no consequence. */
  ARC_RESOLVED_WITHOUT_EVIDENCE: 'severe',
} as const satisfies Record<string, FindingSeverity>;

export type StoryQualityFindingCode = keyof typeof STORY_QUALITY_FINDING_CODES;

const METRIC_COVERAGE: MetricDefinition = {
  key: 'recap_coverage',
  prdName: '高重要度摘要覆蓋率',
  numerator: 'high-importance accepted events cited by at least one releasable published content in the window',
  denominator: 'high-importance accepted events in the window, less those excluded with a reason and those on a world day whose published content is not due yet',
  target: 0.95,
  direction: 'atLeast',
};
const METRIC_SPOILER: MetricDefinition = {
  key: 'spoiler_violation_rate',
  prdName: 'Spoiler Violation',
  numerator: 'published contents whose persisted FR-G004 verdict carries a spoiler-category finding',
  denominator: 'published contents with a persisted coverage verdict in the window',
  target: 0,
  direction: 'atMost',
};
const METRIC_ARC_PROGRESS: MetricDefinition = {
  key: 'arc_progress_rate',
  prdName: 'Arc Progress',
  numerator: 'active-family arcs that appended at least one projection revision inside the window',
  denominator: 'active-family arcs alive during the window',
  target: null,
  direction: 'atLeast',
};
const METRIC_ARC_STAGNATION: MetricDefinition = {
  key: 'arc_stagnation_rate',
  prdName: 'Arc Stagnation',
  numerator: 'active-family arcs whose last progress is at least the stagnation threshold before the window end',
  denominator: 'active-family arcs alive during the window',
  target: 0,
  direction: 'atMost',
};
const METRIC_ARC_RESOLUTION: MetricDefinition = {
  key: 'arc_resolution_evidence',
  prdName: 'Arc Resolution',
  numerator: 'arcs reaching a terminal status that carry both an outcome and at least one consequence',
  denominator: 'arcs reaching a terminal status in the window',
  target: 1,
  direction: 'atLeast',
};

export const STORY_QUALITY_EVALUATOR: EvaluatorDefinition = {
  evaluatorId: STORY_QUALITY_EVALUATOR_ID,
  version: STORY_QUALITY_EVALUATOR_VERSION,
  metrics: [METRIC_COVERAGE, METRIC_SPOILER, METRIC_ARC_PROGRESS, METRIC_ARC_STAGNATION, METRIC_ARC_RESOLUTION],
  score: {
    key: 'story_health',
    prdName: 'Story Health',
    components: [
      { key: 'coverage', metricKey: METRIC_COVERAGE.key, weight: 0.4, transform: 'rate' },
      { key: 'spoiler_safety', metricKey: METRIC_SPOILER.key, weight: 0.3, transform: 'complement' },
      { key: 'arc_progress', metricKey: METRIC_ARC_PROGRESS.key, weight: 0.2, transform: 'rate' },
      { key: 'arc_pacing', metricKey: METRIC_ARC_STAGNATION.key, weight: 0.1, transform: 'complement' },
    ],
  },
  findingCodes: STORY_QUALITY_FINDING_CODES,
};

// --- evidence ---------------------------------------------------------------

/** One accepted event, reduced to what this evaluator needs. */
export type StoryEventEvidence = {
  eventId: string;
  worldDay: number;
  /** Highest story-arc membership importance; 0 when no arc classified it. */
  importance: number;
};

/** One published content and the persisted FR-G004 verdict for it. */
export type PublishedContentEvidence = {
  contentRef: string;
  worldDay: number;
  /** The persisted `episodeCoverageReports.releasable`. */
  releasable: boolean;
  /** The persisted finding codes, and which of them are spoiler-category. */
  findingCodes: readonly string[];
  spoilerFindingCodes: readonly string[];
  /** Accepted events this content accounts for. */
  citedEventIds: readonly string[];
  /** Set when the gate could not run at all, as opposed to running and refusing. */
  errorCode: string | null;
};

/** An operator's declared exclusion, as stored. */
export type CoverageExclusionEvidence = {
  eventId: string;
  worldDay: number;
  reason: string;
  operatorId: string;
};

/** One arc's state over the window. */
export type ArcEvidence = {
  arcId: string;
  status: string;
  /** True while the arc is in the active family (emerging → climax); see `isActiveArcStatus`. */
  active: boolean;
  /** World day of the newest projection revision. */
  lastProgressWorldDay: number;
  /** Projection revisions appended inside the window. */
  revisionsInWindow: number;
  /** True when the arc reached `resolved` or `archived` inside the window. */
  reachedTerminal: boolean;
  /** For a terminal arc: whether its resolution decision carried an outcome and consequences. */
  terminalOutcomeRecorded: boolean;
  terminalConsequenceCount: number;
};

export type StoryQualityEvidence = {
  worldId: string;
  fromWorldDay: number;
  toWorldDay: number;
  highImportanceThreshold: number;
  stagnationThresholdWorldDays: number;
  events: readonly StoryEventEvidence[];
  publications: readonly PublishedContentEvidence[];
  exclusions: readonly CoverageExclusionEvidence[];
  arcs: readonly ArcEvidence[];
  /**
   * World days whose published content is not due yet — the newest day, whose Episode is composed
   * on the next day's first commit (see `completedWorldDaysOf`).
   *
   * Their events are EXCLUDED from the coverage denominator with a reason rather than counted as
   * uncovered. The rule is ART-47's: an observation that cannot yet answer the question is not an
   * observation that answered it badly. A world that stops forever leaves its last day excluded
   * permanently, and the excluded count says so.
   */
  pendingWorldDays?: readonly number[];
  scanLimitReached: boolean;
};

const eventRef = (eventId: string, worldDay: number, code?: string): EvidenceRef =>
  ({ kind: 'accepted_event', id: eventId, worldDay, ...(code ? { code } : {}) });

/** Evaluate one window of arc, recap and publication evidence. */
export function evaluateStoryQuality(evidence: StoryQualityEvidence): EvaluationReport {
  const { worldId, fromWorldDay, toWorldDay } = evidence;
  const findings: QualityFinding[] = [];
  const push = (code: StoryQualityFindingCode, subjectId: string, worldDay: number, refs: EvidenceRef[], detail: string) => {
    findings.push({ code, severity: STORY_QUALITY_FINDING_CODES[code], subjectId, worldDay, evidence: refs, detail });
  };
  const inWindow = <T extends { worldDay: number }>(rows: readonly T[]): T[] =>
    rows.filter((row) => row.worldDay >= fromWorldDay && row.worldDay <= toWorldDay);

  const events = inWindow(evidence.events);
  const publications = inWindow(evidence.publications);
  const exclusions = inWindow(evidence.exclusions);

  // --- recap coverage --------------------------------------------------------
  const releasable = publications.filter((publication) => publication.releasable);
  const covered = new Set(releasable.flatMap(({ citedEventIds }) => citedEventIds));
  const excluded = new Map(exclusions.map((exclusion) => [exclusion.eventId, exclusion]));
  const highImportance = events.filter(({ importance }) => importance >= evidence.highImportanceThreshold);

  const pending = new Set(evidence.pendingWorldDays ?? []);
  let coveredCount = 0;
  let excludedCount = 0;
  let pendingCount = 0;
  for (const event of highImportance) {
    if (pending.has(event.worldDay)) {
      pendingCount += 1;
      continue;
    }
    // An exclusion is honoured only if its reason clears the SAME floor the write boundary
    // applies. Below it the exclusion is not an exclusion: the event stays in the denominator and
    // falls through to the uncovered branch, so an unusable reason can never quietly shrink what
    // §16.2 is a rate of. See the module note for why this branch has no finding code of its own.
    const exclusion = excluded.get(event.eventId);
    const honoured = exclusion !== undefined && exclusion.reason.trim().length >= MIN_EXCLUSION_REASON_LENGTH;
    if (honoured) {
      excludedCount += 1;
      continue;
    }
    if (covered.has(event.eventId)) {
      coveredCount += 1;
      continue;
    }
    push('HIGH_IMPORTANCE_EVENT_UNCOVERED', event.eventId, event.worldDay,
      [eventRef(event.eventId, event.worldDay, String(event.importance)),
        ...(exclusion === undefined ? []
          : [{ kind: 'publication' as const, id: `exclusion:${event.eventId}`, code: exclusion.operatorId }])],
      exclusion === undefined
        ? `high-importance event ${event.eventId} (importance ${event.importance}) is cited by no releasable published content and carries no exclusion reason`
        : `high-importance event ${event.eventId} (importance ${event.importance}) is cited by no releasable published content, and the exclusion ${exclusion.operatorId} declared for it carries no reviewable reason`);
  }
  const coverageDenominator = highImportance.length - excludedCount - pendingCount;

  // A day with accepted events and no releasable publication is where uncovered events come from,
  // so it is named rather than left to be inferred from a rate.
  const daysWithEvents = uniqueDays(events.map(({ worldDay }) => worldDay));
  const daysWithReleasable = new Set(releasable.map(({ worldDay }) => worldDay));
  for (const worldDay of daysWithEvents) {
    if (daysWithReleasable.has(worldDay) || pending.has(worldDay)) continue;
    const attempted = publications.filter((publication) => publication.worldDay === worldDay);
    push('WORLD_DAY_UNPUBLISHED', `${worldId}:${worldDay}`, worldDay,
      attempted.map((publication) => ({ kind: 'publication' as const, id: publication.contentRef, worldDay, code: publication.errorCode ?? publication.findingCodes[0] ?? 'NOT_RELEASABLE' })),
      `world day ${worldDay} carries accepted events and no releasable published content (${attempted.length} attempted)`);
  }

  // --- spoiler violations ----------------------------------------------------
  let spoilerContents = 0;
  for (const publication of publications) {
    if (publication.spoilerFindingCodes.length === 0) continue;
    spoilerContents += 1;
    push('SPOILER_VIOLATION', publication.contentRef, publication.worldDay,
      [{ kind: 'publication', id: publication.contentRef, worldDay: publication.worldDay },
        ...publication.spoilerFindingCodes.map((code) => ({ kind: 'coverage_report' as const, id: publication.contentRef, code }))],
      `published content ${publication.contentRef} carries ${publication.spoilerFindingCodes.length} spoiler finding(s)`);
  }

  // --- arcs -------------------------------------------------------------------
  const activeArcs = evidence.arcs.filter(({ active }) => active);
  let arcsWithProgress = 0;
  let stagnantArcs = 0;
  for (const arc of activeArcs) {
    if (arc.revisionsInWindow > 0) {
      arcsWithProgress += 1;
    } else {
      push('ARC_WITHOUT_PROGRESS', arc.arcId, toWorldDay, [{ kind: 'arc', id: arc.arcId, code: arc.status }],
        `active arc ${arc.arcId} appended no projection revision between world days ${fromWorldDay} and ${toWorldDay}`);
    }
    const stagnantWorldDays = toWorldDay - arc.lastProgressWorldDay;
    if (stagnantWorldDays >= evidence.stagnationThresholdWorldDays) {
      stagnantArcs += 1;
      push('ARC_STAGNANT', arc.arcId, toWorldDay, [{ kind: 'arc', id: arc.arcId, code: arc.status }],
        `active arc ${arc.arcId} has not progressed for ${stagnantWorldDays} world days (threshold ${evidence.stagnationThresholdWorldDays})`);
    }
  }
  const terminalArcs = evidence.arcs.filter(({ reachedTerminal }) => reachedTerminal);
  let terminalWithEvidence = 0;
  for (const arc of terminalArcs) {
    if (arc.terminalOutcomeRecorded && arc.terminalConsequenceCount > 0) {
      terminalWithEvidence += 1;
      continue;
    }
    push('ARC_RESOLVED_WITHOUT_EVIDENCE', arc.arcId, toWorldDay, [{ kind: 'arc', id: arc.arcId, code: arc.status }],
      `arc ${arc.arcId} reached ${arc.status} with ${arc.terminalOutcomeRecorded ? 'no consequence' : 'no recorded outcome'}`);
  }

  const metrics = [
    observeMetric(METRIC_COVERAGE, coveredCount, coverageDenominator, excludedCount + pendingCount,
      excludedCount + pendingCount === 0 ? null
        : `${excludedCount} carrying an explicit, reviewable exclusion reason; ${pendingCount} on a world day whose published content is not due yet`),
    observeMetric(METRIC_SPOILER, spoilerContents, publications.length),
    observeMetric(METRIC_ARC_PROGRESS, arcsWithProgress, activeArcs.length),
    observeMetric(METRIC_ARC_STAGNATION, stagnantArcs, activeArcs.length),
    observeMetric(METRIC_ARC_RESOLUTION, terminalWithEvidence, terminalArcs.length),
  ];

  const allDays: number[] = [];
  for (let day = fromWorldDay; day <= toWorldDay; day += 1) allDays.push(day);
  const evaluatedSet = new Set(daysWithEvents);

  return finishReport({
    evaluatorId: STORY_QUALITY_EVALUATOR_ID,
    evaluatorVersion: STORY_QUALITY_EVALUATOR_VERSION,
    worldId,
    window: { fromWorldDay, toWorldDay },
    metrics,
    score: composeScore(STORY_QUALITY_EVALUATOR.score!, metrics),
    findings: dedupeFindings(findings),
    coverage: {
      worldDaysEvaluated: daysWithEvents,
      worldDaysWithoutEvidence: allDays.filter((day) => !evaluatedSet.has(day)),
      scanLimitReached: evidence.scanLimitReached,
    },
  });
}
