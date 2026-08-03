/**
 * Arc resolution consequence-summary integration (FR-F005).
 *
 * Derives per-subject consequence summaries (character + world) from a resolved
 * arc's resolution decision and its accepted source events. Pure module — no
 * Convex imports, no clock, no randomness, no Canon mutation.
 *
 * The summaries are DERIVED ARTIFACTS tagged with full provenance (arc +
 * resolution event + accepted source events). They are persisted idempotently by
 * the wiring layer ({@link ./consequenceSummaryFunctions.ts}) and never edit or
 * delete accepted Canon history. A refresh failure is non-destructive and safely
 * retryable (AC#3): derivation is deterministic and persistence is an idempotent
 * upsert keyed by {@link ConsequenceSummary.summaryId}.
 */

import type { AcceptedEvent } from '../canon/model';
import type { ArcResolutionDecision } from './resolution';

export const CONSEQUENCE_SUMMARY_SCHEMA_VERSION = 1;

/** Subject id used for world-scope summaries. */
export const WORLD_SUMMARY_SUBJECT = 'world';

export type ConsequenceSummaryScope = 'character' | 'world';

export type ConsequenceSummary = {
  schemaVersion: typeof CONSEQUENCE_SUMMARY_SCHEMA_VERSION;
  /** Deterministic id: `${arcId}:consequence:${consequenceId}:${scope}:${subjectId}`. */
  summaryId: string;
  worldId: string;
  /** Provenance: the resolved arc. */
  arcId: string;
  scope: ConsequenceSummaryScope;
  /** characterId for character scope; {@link WORLD_SUMMARY_SUBJECT} for world scope. */
  subjectId: string;
  /** The arc resolution outcome text (shared context for every derived summary). */
  outcome: string;
  /** Provenance: which consequence of the decision produced this summary. */
  consequenceId: string;
  /** The consequence summary text applied to this subject. */
  summary: string;
  /** Provenance: the resolution Accepted Event (primary source). */
  sourceEventId: string;
  /** Provenance: every accepted event the summaries rest on. */
  sourceEventIds: string[];
  resolutionSequenceNumber: number;
  /** Monotonic per-arc resolution revision; a re-derivation bumps this. */
  revision: number;
};

export class ConsequenceSummaryError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'ConsequenceSummaryError';
  }
}

function isTerminalDecision(decision: ArcResolutionDecision): boolean {
  return decision.resultingStatus === 'resolved' || decision.resultingStatus === 'archived';
}

/** Deterministic summary id for a (arc, consequence, scope, subject) tuple. */
export function consequenceSummaryId(
  arcId: string,
  consequenceId: string,
  scope: ConsequenceSummaryScope,
  subjectId: string,
): string {
  return `${arcId}:consequence:${consequenceId}:${scope}:${subjectId}`;
}

/**
 * Derive per-subject consequence summaries from a resolved arc's decision and
 * its accepted source events (AC#1). Each consequence expands to one world-scope
 * summary (when {@link ArcConsequence.affectsWorldSummary}) plus one
 * character-scope summary per affected character. Every summary carries arc +
 * event provenance (AC#2). The resolution event must be among the supplied
 * accepted sources.
 */
export function deriveConsequenceSummaries(
  decision: ArcResolutionDecision,
  arcSourceEvents: readonly AcceptedEvent[],
): ConsequenceSummary[] {
  if (decision.worldId.trim().length === 0) {
    throw new ConsequenceSummaryError('CONSEQUENCE_INVALID', 'worldId must be non-empty');
  }
  if (!isTerminalDecision(decision)) {
    throw new ConsequenceSummaryError(
      'CONSEQUENCE_NOT_TERMINAL',
      'only resolved or archived arcs produce consequence summaries',
    );
  }
  if (decision.outcome === null || decision.outcome.trim().length === 0 || decision.consequences.length === 0) {
    throw new ConsequenceSummaryError(
      'CONSEQUENCE_OUTCOME_REQUIRED',
      'terminal resolution requires a non-empty outcome and at least one consequence',
    );
  }

  const accepted = new Map(arcSourceEvents.map((event) => [event.eventId, event]));
  const resolutionEvent = accepted.get(decision.sourceEventId);
  if (!resolutionEvent) {
    throw new ConsequenceSummaryError(
      'CONSEQUENCE_SOURCE_NOT_ACCEPTED',
      'the resolution source event must be among the supplied accepted events',
    );
  }
  if (resolutionEvent.worldId !== decision.worldId) {
    throw new ConsequenceSummaryError('CONSEQUENCE_PROVENANCE_INVALID', 'resolution event worldId mismatch');
  }

  const sourceEventIds = [...new Set(arcSourceEvents.map((event) => event.eventId))];
  const summaries: ConsequenceSummary[] = [];
  const seen = new Set<string>();

  const expand = (
    consequenceId: string,
    consequenceSummary: string,
    scope: ConsequenceSummaryScope,
    subjectId: string,
  ): void => {
    const summaryId = consequenceSummaryId(decision.arcId, consequenceId, scope, subjectId);
    if (seen.has(summaryId)) {
      throw new ConsequenceSummaryError('CONSEQUENCE_DUPLICATE', `duplicate consequence summary: ${summaryId}`);
    }
    seen.add(summaryId);
    summaries.push({
      schemaVersion: CONSEQUENCE_SUMMARY_SCHEMA_VERSION,
      summaryId,
      worldId: decision.worldId,
      arcId: decision.arcId,
      scope,
      subjectId,
      outcome: decision.outcome as string,
      consequenceId,
      summary: consequenceSummary,
      sourceEventId: decision.sourceEventId,
      sourceEventIds,
      resolutionSequenceNumber: decision.sourceEventSequenceNumber,
      revision: decision.sourceEventSequenceNumber,
    });
  };

  for (const consequence of decision.consequences) {
    if (consequence.sourceEventId !== decision.sourceEventId) {
      throw new ConsequenceSummaryError(
        'CONSEQUENCE_PROVENANCE_INVALID',
        'every consequence must reference the resolution Accepted Event',
      );
    }
    if (consequence.affectsWorldSummary) {
      expand(consequence.consequenceId, consequence.summary, 'world', WORLD_SUMMARY_SUBJECT);
    }
    for (const characterId of consequence.affectedCharacterIds) {
      expand(consequence.consequenceId, consequence.summary, 'character', characterId);
    }
  }

  if (summaries.length === 0) {
    throw new ConsequenceSummaryError(
      'CONSEQUENCE_NO_TARGETS',
      'resolution consequences must affect the world summary or at least one character',
    );
  }
  return summaries;
}

/**
 * Validate a set of consequence summaries against accepted events (AC#2
 * provenance). Every sourceEventId and sourceEventIds entry must resolve to an
 * accepted event. Returns a deep clone on success.
 */
export function validateConsequenceSummaries(
  summaries: readonly ConsequenceSummary[],
  acceptedEvents: readonly AcceptedEvent[],
): ConsequenceSummary[] {
  if (summaries.length === 0) {
    throw new ConsequenceSummaryError('CONSEQUENCE_INVALID', 'at least one summary is required');
  }
  const accepted = new Set(acceptedEvents.map((event) => event.eventId));
  const seen = new Set<string>();
  for (const summary of summaries) {
    if (summary.schemaVersion !== CONSEQUENCE_SUMMARY_SCHEMA_VERSION) {
      throw new ConsequenceSummaryError('CONSEQUENCE_INVALID', 'unsupported schema version');
    }
    if (summary.worldId.trim().length === 0 || summary.arcId.trim().length === 0
        || summary.summaryId.trim().length === 0 || summary.outcome.trim().length === 0
        || summary.summary.trim().length === 0) {
      throw new ConsequenceSummaryError('CONSEQUENCE_INVALID', 'summary envelope must be complete');
    }
    if (summary.sourceEventIds.length === 0 || !accepted.has(summary.sourceEventId)) {
      throw new ConsequenceSummaryError('CONSEQUENCE_SOURCE_NOT_ACCEPTED', 'primary source must be an accepted event');
    }
    if (summary.sourceEventIds.some((id) => !accepted.has(id))) {
      throw new ConsequenceSummaryError(
        'CONSEQUENCE_SOURCE_NOT_ACCEPTED',
        'sourceEventIds must resolve only to accepted events',
      );
    }
    if (seen.has(summary.summaryId)) {
      throw new ConsequenceSummaryError('CONSEQUENCE_DUPLICATE', `duplicate consequence summary: ${summary.summaryId}`);
    }
    seen.add(summary.summaryId);
  }
  return structuredClone(summaries) as ConsequenceSummary[];
}
