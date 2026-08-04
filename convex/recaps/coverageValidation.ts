/**
 * Recap coverage and spoiler validation (FR-G004).
 *
 * A pre-release gate: given the Accepted Events of a world day and the recap or
 * episode candidate that is about to become public, it detects
 *
 *   - high-importance Accepted Events that the candidate neither covers nor
 *     explicitly excludes with a reason (AC#1),
 *   - major public relationship changes the candidate fails to mention (AC#2),
 *   - Story Arc turning points the candidate fails to mention (AC#3),
 *   - spoiler violations: content revealed ahead of when it may be revealed —
 *     future world days, private relationship changes, private facts, and
 *     unreleased world secrets (AC#4).
 *
 * Pure module — no Convex imports, no clock, no randomness, no mutation. It
 * reads a derived view of Accepted Events and never writes Canon; the Convex
 * wiring lives in {@link ./coverageValidationFunctions.ts}.
 */

import { HIGH_IMPORTANCE_THRESHOLD } from '../editorial/episode';

export { HIGH_IMPORTANCE_THRESHOLD };

/**
 * Smallest single-dimension relationship movement (on the canon −100..100
 * scale) that counts as a "major relationship change" for FR-G004 AC#2.
 */
export const MAJOR_RELATIONSHIP_DELTA = 20;

/** Minimum secret length considered leakable, mirroring the Episode secret gate. */
export const MIN_SECRET_MATCH_LENGTH = 4;

export type CoverageVisibility = 'private' | 'public';

/** One relationship movement carried by an Accepted Event. */
export type CoverageRelationshipChange = {
  /** Stable identity: see {@link deriveRelationshipChangeId}. */
  changeId: string;
  sourceCharacterId: string;
  targetCharacterId: string;
  /** Largest absolute single-dimension movement; see {@link relationshipChangeMagnitude}. */
  magnitude: number;
  visibility: CoverageVisibility;
};

/**
 * The derived view of one Accepted Event the gate needs. Built by the wiring
 * layer from `canonEvents` plus Story Arc classifications, exactly as
 * `EpisodeSourceEvent` is.
 */
export type CoverageSourceEvent = {
  eventId: string;
  worldDay: number;
  /** Highest Story Arc membership importance for the event; 0 when unclassified. */
  importance: number;
  /** Arcs for which this event is the turning point. */
  turningPointArcIds: string[];
  relationshipChanges: CoverageRelationshipChange[];
  publicFactIds: string[];
  privateFactIds: string[];
};

/** An Accepted Event the editor deliberately keeps out of the candidate. */
export type CoverageExclusion = { eventId: string; reason: string };

/** The recap or episode content about to become public. */
export type CoverageCandidate = {
  worldId: string;
  contentRef: string;
  /** Latest world day the candidate releases; later days are spoilers. */
  worldDay: number;
  /**
   * First world day of the inclusive window the candidate must cover. Equal to
   * {@link worldDay} for a daily episode; earlier for an arc or season recap.
   * Events before it are prior context: citable, but never required.
   */
  coverageFromWorldDay: number;
  citedEventIds: string[];
  mentionedRelationshipChangeIds: string[];
  mentionedFactIds: string[];
  declaredExclusions: CoverageExclusion[];
  /** Full public text of the candidate, used for secret-leak detection. */
  text: string;
};

export const COVERAGE_FINDING_CODES = [
  'COVERAGE_HIGH_IMPORTANCE_OMITTED',
  'COVERAGE_RELATIONSHIP_CHANGE_OMITTED',
  'COVERAGE_TURNING_POINT_OMITTED',
  'COVERAGE_EXCLUSION_UNJUSTIFIED',
  'COVERAGE_SOURCE_NOT_ACCEPTED',
  'SPOILER_FUTURE_EVENT',
  'SPOILER_PRIVATE_RELATIONSHIP',
  'SPOILER_PRIVATE_FACT',
  'SPOILER_UNRELEASED_SECRET',
] as const;
export type CoverageFindingCode = (typeof COVERAGE_FINDING_CODES)[number];

export type CoverageFindingCategory = 'coverage' | 'spoiler';

export type CoverageFinding = {
  code: CoverageFindingCode;
  category: CoverageFindingCategory;
  /** The event, relationship change, or fact the finding is about. */
  subjectId: string;
  detail: string;
};

export type CoverageReport = {
  schemaVersion: 1;
  worldId: string;
  contentRef: string;
  worldDay: number;
  coverageFromWorldDay: number;
  /** Cited high-importance events, ascending by event ID. */
  coveredEventIds: string[];
  /** High-importance events excluded with a reason, ascending by event ID. */
  excludedEventIds: string[];
  findings: CoverageFinding[];
  /** True when no finding was raised; the candidate may proceed to release. */
  releasable: boolean;
};

export class RecapCoverageError extends Error {
  constructor(
    readonly code: CoverageFindingCode | 'COVERAGE_INVALID_SHAPE',
    message: string,
    readonly findings: CoverageFinding[] = [],
  ) {
    super(`[${code}] ${message}`);
    this.name = 'RecapCoverageError';
  }
}

/** Derive the canonical changeId for the `relationship_changed` change at `index`. */
export function deriveRelationshipChangeId(eventId: string, index: number): string {
  return `${eventId}:relationship:${index}`;
}

/**
 * Magnitude of a relationship movement: the largest absolute single-dimension
 * delta. Omitted additive v1 dimensions count as zero, matching the reducer.
 */
export function relationshipChangeMagnitude(deltas: {
  trustDelta: number;
  affectionDelta: number;
  resentmentDelta: number;
  fearDelta?: number;
  dependencyDelta?: number;
  familiarityDelta?: number;
}): number {
  return Math.max(
    Math.abs(deltas.trustDelta),
    Math.abs(deltas.affectionDelta),
    Math.abs(deltas.resentmentDelta),
    Math.abs(deltas.fearDelta ?? 0),
    Math.abs(deltas.dependencyDelta ?? 0),
    Math.abs(deltas.familiarityDelta ?? 0),
  );
}

/** Whether a relationship movement is a "major relationship change" (AC#2). */
export function isMajorRelationshipChange(change: CoverageRelationshipChange): boolean {
  return change.magnitude >= MAJOR_RELATIONSHIP_DELTA;
}

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function assertShape(candidate: CoverageCandidate, sources: readonly CoverageSourceEvent[]): void {
  if (!nonempty(candidate.worldId) || !nonempty(candidate.contentRef)
      || !Number.isSafeInteger(candidate.worldDay) || candidate.worldDay < 0
      || !Number.isSafeInteger(candidate.coverageFromWorldDay) || candidate.coverageFromWorldDay < 0
      || candidate.coverageFromWorldDay > candidate.worldDay) {
    throw new RecapCoverageError('COVERAGE_INVALID_SHAPE', 'invalid coverage candidate envelope');
  }
  for (const source of sources) {
    if (!nonempty(source.eventId) || !Number.isSafeInteger(source.worldDay) || source.worldDay < 0
        || !Number.isFinite(source.importance)) {
      throw new RecapCoverageError('COVERAGE_INVALID_SHAPE', 'invalid coverage source event');
    }
  }
  if (new Set(sources.map(({ eventId }) => eventId)).size !== sources.length) {
    throw new RecapCoverageError('COVERAGE_INVALID_SHAPE', 'coverage source event IDs must be unique');
  }
}

/**
 * Detect every FR-G004 coverage gap and spoiler violation in a release
 * candidate. Never throws on a violation — it returns a report so the same
 * result can gate release and feed the FR-M002 Recap Coverage / Spoiler
 * Violation world-quality metrics. Only malformed input throws.
 *
 * `sources` is the complete set of Accepted Events the candidate may draw on;
 * it may include later world days so that forward references are detectable.
 */
export function validateRecapCoverage(
  candidate: CoverageCandidate,
  sources: readonly CoverageSourceEvent[],
  unreleasedSecretValues: readonly string[] = [],
): CoverageReport {
  assertShape(candidate, sources);
  const findings: CoverageFinding[] = [];
  const byEventId = new Map(sources.map((source) => [source.eventId, source]));
  const cited = new Set(candidate.citedEventIds);
  const excluded = new Map(candidate.declaredExclusions.map(({ eventId, reason }) => [eventId, reason]));
  const mentionedChanges = new Set(candidate.mentionedRelationshipChangeIds);
  const mentionedFacts = new Set(candidate.mentionedFactIds);

  for (const eventId of sorted(cited)) {
    const source = byEventId.get(eventId);
    if (!source) {
      findings.push({
        code: 'COVERAGE_SOURCE_NOT_ACCEPTED', category: 'coverage', subjectId: eventId,
        detail: 'candidate cites an event that is not in the accepted source set',
      });
      continue;
    }
    if (source.worldDay > candidate.worldDay) {
      findings.push({
        code: 'SPOILER_FUTURE_EVENT', category: 'spoiler', subjectId: eventId,
        detail: `event belongs to world day ${source.worldDay}, after the released day ${candidate.worldDay}`,
      });
    }
  }

  const revealed = sources.filter((source) => source.worldDay <= candidate.worldDay);
  const obliged = revealed.filter((source) => source.worldDay >= candidate.coverageFromWorldDay);

  // AC#1 — every high-importance event of the covered window is cited or explicitly excluded.
  const highImportance = obliged.filter(({ importance }) => importance >= HIGH_IMPORTANCE_THRESHOLD);
  for (const source of highImportance) {
    if (cited.has(source.eventId)) continue;
    const reason = excluded.get(source.eventId);
    if (reason === undefined) {
      findings.push({
        code: 'COVERAGE_HIGH_IMPORTANCE_OMITTED', category: 'coverage', subjectId: source.eventId,
        detail: `high-importance event (${source.importance}) is neither covered nor explicitly excluded`,
      });
    } else if (!nonempty(reason)) {
      findings.push({
        code: 'COVERAGE_EXCLUSION_UNJUSTIFIED', category: 'coverage', subjectId: source.eventId,
        detail: 'an explicit exclusion must carry a non-empty reason',
      });
    }
  }

  for (const source of obliged) {
    // AC#3 — an arc turning point must be mentioned.
    if (source.turningPointArcIds.length > 0 && !cited.has(source.eventId)) {
      findings.push({
        code: 'COVERAGE_TURNING_POINT_OMITTED', category: 'coverage', subjectId: source.eventId,
        detail: `turning point of arc(s) ${sorted(source.turningPointArcIds).join(', ')} is not mentioned`,
      });
    }
    // AC#2 — a major public relationship change must be mentioned.
    for (const change of source.relationshipChanges) {
      if (change.visibility === 'public' && isMajorRelationshipChange(change)
          && !mentionedChanges.has(change.changeId)) {
        findings.push({
          code: 'COVERAGE_RELATIONSHIP_CHANGE_OMITTED', category: 'coverage', subjectId: change.changeId,
          detail: `major relationship change between ${change.sourceCharacterId} and ${change.targetCharacterId} (magnitude ${change.magnitude}) is not mentioned`,
        });
      }
    }
  }

  // AC#4 — a private relationship movement may never be revealed, on any day.
  for (const source of sources) {
    for (const change of source.relationshipChanges) {
      if (change.visibility === 'private' && mentionedChanges.has(change.changeId)) {
        findings.push({
          code: 'SPOILER_PRIVATE_RELATIONSHIP', category: 'spoiler', subjectId: change.changeId,
          detail: `private relationship change between ${change.sourceCharacterId} and ${change.targetCharacterId} is revealed`,
        });
      }
    }
  }

  // AC#4 — private facts and future relationship movements may never be revealed.
  const publicFacts = new Set(revealed.flatMap(({ publicFactIds }) => publicFactIds));
  const privateFacts = new Set(sources.flatMap(({ privateFactIds }) => privateFactIds));
  const future = sources.filter((source) => source.worldDay > candidate.worldDay);
  const futureChanges = new Set(
    future.flatMap(({ relationshipChanges }) => relationshipChanges.map(({ changeId }) => changeId)),
  );
  const futurePublicFacts = new Set(future.flatMap(({ publicFactIds }) => publicFactIds));
  for (const factId of sorted(mentionedFacts)) {
    if (publicFacts.has(factId)) continue;
    if (futurePublicFacts.has(factId)) {
      findings.push({
        code: 'SPOILER_FUTURE_EVENT', category: 'spoiler', subjectId: factId,
        detail: 'candidate reveals a fact that becomes public only on a later world day',
      });
      continue;
    }
    findings.push({
      code: 'SPOILER_PRIVATE_FACT', category: 'spoiler', subjectId: factId,
      detail: privateFacts.has(factId)
        ? 'candidate reveals a fact that is not public'
        : 'candidate reveals a fact that is not a released public fact',
    });
  }
  for (const changeId of sorted(mentionedChanges)) {
    if (futureChanges.has(changeId)) {
      findings.push({
        code: 'SPOILER_FUTURE_EVENT', category: 'spoiler', subjectId: changeId,
        detail: 'candidate reveals a relationship change from a later world day',
      });
    }
  }

  // AC#4 — unreleased world-secret text may never appear in public content.
  const text = candidate.text.toLocaleLowerCase();
  for (const secret of unreleasedSecretValues) {
    const needle = secret.trim().toLocaleLowerCase();
    if (needle.length >= MIN_SECRET_MATCH_LENGTH && text.includes(needle)) {
      findings.push({
        code: 'SPOILER_UNRELEASED_SECRET', category: 'spoiler', subjectId: candidate.contentRef,
        detail: 'candidate text contains unreleased Canon secret content',
      });
    }
  }

  return {
    schemaVersion: 1,
    worldId: candidate.worldId,
    contentRef: candidate.contentRef,
    worldDay: candidate.worldDay,
    coverageFromWorldDay: candidate.coverageFromWorldDay,
    coveredEventIds: sorted(highImportance.filter(({ eventId }) => cited.has(eventId)).map(({ eventId }) => eventId)),
    excludedEventIds: sorted(
      highImportance.filter(({ eventId }) => !cited.has(eventId) && nonempty(excluded.get(eventId)))
        .map(({ eventId }) => eventId),
    ),
    findings,
    releasable: findings.length === 0,
  };
}

/**
 * Hard gate: run {@link validateRecapCoverage} and throw
 * {@link RecapCoverageError} carrying every finding when the candidate is not
 * releasable. Returns the report otherwise.
 */
export function assertRecapCoverage(
  candidate: CoverageCandidate,
  sources: readonly CoverageSourceEvent[],
  unreleasedSecretValues: readonly string[] = [],
): CoverageReport {
  const report = validateRecapCoverage(candidate, sources, unreleasedSecretValues);
  if (!report.releasable) {
    const codes = [...new Set(report.findings.map(({ code }) => code))].join(', ');
    throw new RecapCoverageError(report.findings[0].code, `coverage validation failed: ${codes}`, report.findings);
  }
  return report;
}
