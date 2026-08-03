/**
 * Convex wiring for arc resolution consequence summaries (FR-F005).
 *
 * Derives per-subject consequence summaries from a persisted resolution decision
 * + its accepted resolution event, and idempotently upserts them into
 * `arcConsequenceSummaries`. The derivation is deterministic and the upsert is
 * keyed by summaryId, so a refresh failure is non-destructive and safely
 * retryable (AC#3). No function here reads or writes accepted Canon history —
 * the resolution event is only READ to provenance-tag the derived summaries.
 */

import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { rowToAcceptedEvent } from '../canon/serialize';
import { deriveEventId } from '../shared/ids';
import {
  ArcResolutionError,
  type ArcResolutionDecision,
} from './resolution';
import {
  ConsequenceSummaryError,
  deriveConsequenceSummaries,
  type ConsequenceSummary,
} from './consequenceSummary';

/**
 * Apply (or re-apply) the consequence summaries for a persisted resolution
 * decision. Loads the decision + its accepted resolution event, derives the
 * per-subject summaries, and idempotently upserts each. Safe to retry: identical
 * input produces identical summaryIds and a no-op re-apply.
 */
export const applyArcResolutionConsequences = internalMutation({
  args: { worldId: v.string(), decisionId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || args.decisionId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new ConsequenceSummaryError('CONSEQUENCE_INVALID', 'worldId, decisionId, and a finite now are required');
    }
    const decisionRow = await ctx.db
      .query('storyArcResolutionDecisions')
      .withIndex('by_world_and_decision', (q) => q.eq('worldId', args.worldId).eq('decisionId', args.decisionId))
      .unique();
    if (!decisionRow) throw new ConsequenceSummaryError('CONSEQUENCE_DECISION_NOT_FOUND', 'resolution decision is not persisted');

    const decision = structuredClone(decisionRow.decision) as ArcResolutionDecision;
    const eventRow = await ctx.db
      .query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId).eq('sequenceNumber', decision.sourceEventSequenceNumber))
      .unique();
    if (!eventRow || deriveEventId(args.worldId, decision.sourceEventSequenceNumber) !== decision.sourceEventId) {
      throw new ArcResolutionError('ARC_RESOLUTION_PROVENANCE_INVALID', 'resolution source must be an Accepted Event');
    }
    const resolutionEvent = rowToAcceptedEvent(eventRow);

    const summaries = deriveConsequenceSummaries(decision, [resolutionEvent]);

    // Idempotent upsert keyed by summaryId. Load existing rows for this arc to
    // decide insert vs patch in one pass (retry-safe; never touches Canon).
    const existingRows = await ctx.db
      .query('arcConsequenceSummaries')
      .withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', decision.arcId))
      .collect();
    const existingBySummaryId = new Map(existingRows.map((row) => [row.summaryId, row]));

    let applied = 0;
    for (const summary of summaries) {
      const existing = existingBySummaryId.get(summary.summaryId);
      if (existing) {
        if (existing.revision > summary.revision) continue; // a newer revision already won
        await ctx.db.patch(existing._id, {
          outcome: summary.outcome,
          summary: summary.summary,
          sourceEventId: summary.sourceEventId,
          sourceEventIds: summary.sourceEventIds,
          resolutionSequenceNumber: summary.resolutionSequenceNumber,
          revision: summary.revision,
          updatedAt: args.now,
        });
      } else {
        await ctx.db.insert('arcConsequenceSummaries', {
          schemaVersion: summary.schemaVersion,
          worldId: summary.worldId,
          arcId: summary.arcId,
          summaryId: summary.summaryId,
          scope: summary.scope,
          subjectId: summary.subjectId,
          outcome: summary.outcome,
          consequenceId: summary.consequenceId,
          summary: summary.summary,
          sourceEventId: summary.sourceEventId,
          sourceEventIds: summary.sourceEventIds,
          resolutionSequenceNumber: summary.resolutionSequenceNumber,
          revision: summary.revision,
          createdAt: args.now,
          updatedAt: args.now,
        });
      }
      applied += 1;
    }
    return { arcId: decision.arcId, applied, revision: decision.sourceEventSequenceNumber };
  },
});

/** Internal: consequence summaries for an arc (newest revision first). */
export const listArcConsequenceSummaries = internalQuery({
  args: { worldId: v.string(), arcId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('arcConsequenceSummaries')
      .withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId))
      .collect();
    return rows
      .sort((a, b) => b.revision - a.revision || a.summaryId.localeCompare(b.summaryId))
      .map((row) => ({
        schemaVersion: row.schemaVersion, worldId: row.worldId, summaryId: row.summaryId,
        arcId: row.arcId, scope: row.scope, subjectId: row.subjectId,
        outcome: row.outcome, consequenceId: row.consequenceId, summary: row.summary,
        sourceEventId: row.sourceEventId, sourceEventIds: row.sourceEventIds,
        resolutionSequenceNumber: row.resolutionSequenceNumber, revision: row.revision,
      } satisfies ConsequenceSummary));
  },
});

/** Internal: consequence summaries affecting a subject (a character or the world). */
export const getSubjectConsequenceSummaries = internalQuery({
  args: { worldId: v.string(), scope: v.union(v.literal('character'), v.literal('world')), subjectId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('arcConsequenceSummaries')
      .withIndex('by_subject', (q) => q.eq('worldId', args.worldId).eq('scope', args.scope).eq('subjectId', args.subjectId))
      .collect();
    return rows
      .sort((a, b) => b.revision - a.revision || a.summaryId.localeCompare(b.summaryId))
      .map((row) => ({
        schemaVersion: row.schemaVersion, worldId: row.worldId, summaryId: row.summaryId,
        arcId: row.arcId, scope: row.scope, subjectId: row.subjectId,
        outcome: row.outcome, consequenceId: row.consequenceId, summary: row.summary,
        sourceEventId: row.sourceEventId, sourceEventIds: row.sourceEventIds,
        resolutionSequenceNumber: row.resolutionSequenceNumber, revision: row.revision,
      } satisfies ConsequenceSummary));
  },
});
