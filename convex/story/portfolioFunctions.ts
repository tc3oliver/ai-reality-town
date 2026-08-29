import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { isTimeSlot } from '../canon/eventTypes';
import { deriveEventId } from '../shared/ids';
import type { ArcProjectionEvent } from './model';
import type { ArcOverflowRemediation, ArcPortfolioDecision, ArcPortfolioEntry } from './portfolio';
import { applyArcPortfolioControl, ArcPortfolioError } from './portfolio';
import { parseArcProjectionFields, replayArcProjection } from './projection';

function parseRemediation(value: unknown): ArcOverflowRemediation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ArcPortfolioError('ARC_PORTFOLIO_INVALID', 'remediation must be an object');
  const record = value as Record<string, unknown>;
  if (record.type === 'reject' || record.type === 'downgrade') return { type: record.type };
  if (record.type === 'merge' && typeof record.targetArcId === 'string' && record.targetArcId.trim()) {
    return { type: 'merge', targetArcId: record.targetArcId };
  }
  throw new ArcPortfolioError('ARC_PORTFOLIO_INVALID', 'unsupported remediation');
}

/** Internal admission boundary. Every candidate is evaluated before portfolio persistence. */
export const admitArcToPortfolio = internalMutation({
  args: { worldId: v.string(), candidate: v.any(), remediation: v.any(), decidedAt: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.decidedAt)) throw new ArcPortfolioError('ARC_PORTFOLIO_INVALID', 'finite decision time required');
    const candidate = structuredClone(args.candidate) as ArcPortfolioEntry;
    if (candidate.projection?.worldId !== args.worldId) throw new ArcPortfolioError('ARC_PORTFOLIO_INVALID', 'candidate belongs to another world');
    if (!Array.isArray(candidate.sourceEventIds)) {
      throw new ArcPortfolioError('ARC_PORTFOLIO_EVENT_NOT_ACCEPTED', 'every retained source Event must be accepted');
    }
    // `candidate.sourceEventIds` is already the exact, bounded set of ids this check needs — an
    // event id is `deriveEventId(worldId, sequenceNumber)`, so each is a point lookup on
    // `worldId + sequenceNumber` rather than a scan of the world's whole event log. The
    // `deriveEventId` re-check (not just row existence) guards against an id that parses to a
    // real sequence number but was never actually derived from it — e.g. malformed or another
    // world's id — the same defence `story/functions.ts`'s `requireAcceptedEvent` makes.
    const accepted = await Promise.all(candidate.sourceEventIds.map(async (sourceEventId) => {
      const sequenceNumber = Number(sourceEventId.split('#').at(-1));
      if (!Number.isSafeInteger(sequenceNumber)) return false;
      const row = await ctx.db.query('canonEvents')
        .withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId).eq('sequenceNumber', sequenceNumber))
        .unique();
      return row !== null && deriveEventId(args.worldId, sequenceNumber) === sourceEventId;
    }));
    if (accepted.some((isAccepted) => !isAccepted)) {
      throw new ArcPortfolioError('ARC_PORTFOLIO_EVENT_NOT_ACCEPTED', 'every retained source Event must be accepted');
    }
    const existingRow = await ctx.db.query('storyArcPortfolioEntries')
      .withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', candidate.projection.arcId)).unique();
    if (existingRow) throw new ArcPortfolioError('ARC_PORTFOLIO_INVALID', 'candidate arc already exists');
    const rows = await ctx.db.query('storyArcPortfolioEntries')
      .withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId)).collect();
    const current = rows.map((row) => structuredClone(row.entry) as ArcPortfolioEntry);
    const result = applyArcPortfolioControl(current, candidate, parseRemediation(args.remediation));
    const decisionId = `${candidate.projection.arcId}:${candidate.sourceEventIds.join(',')}`;
    const priorDecision = await ctx.db.query('storyArcPortfolioDecisions')
      .withIndex('by_world_and_decision', (q) => q.eq('worldId', args.worldId).eq('decisionId', decisionId)).unique();
    if (priorDecision) return structuredClone(priorDecision.decision as unknown) as ArcPortfolioDecision;
    if (result.decision.action === 'accepted' || result.decision.action === 'downgraded') {
      const admitted = result.entries.find(({ projection }) => projection.arcId === candidate.projection.arcId)!;
      await ctx.db.insert('storyArcPortfolioEntries', {
        worldId: args.worldId, arcId: candidate.projection.arcId, entry: admitted, updatedAt: args.decidedAt,
      });
    } else if (result.decision.action === 'merged') {
      const target = rows.find(({ arcId }) => arcId === result.decision.targetArcId)!;
      const merged = result.entries.find(({ projection }) => projection.arcId === result.decision.targetArcId)!;
      await ctx.db.patch(target._id, { entry: merged, updatedAt: args.decidedAt });
    }
    await ctx.db.insert('storyArcPortfolioDecisions', {
      worldId: args.worldId, decisionId, decision: result.decision, createdAt: args.decidedAt,
    });
    return result.decision;
  },
});

/**
 * Re-derive a portfolio entry's projection snapshot from the authoritative arc lifecycle
 * and the append-only arc projection stream, and record the accepted event that caused
 * the refresh.
 *
 * Admission ({@link admitArcToPortfolio}) captures the arc as it was at inciting time.
 * Everything that reads portfolio tiers afterwards — FR-F003 count control, FR-H003 entry
 * recommendation, the homepage arc selector — needs the CURRENT status, so the live
 * post-commit pipeline calls this after each classification. It re-derives, never invents:
 * the projection comes from {@link replayArcProjection} and the status from the lifecycle
 * row. Tier, priority and published flags are the admission decision and are left alone.
 */
export const syncArcPortfolioEntry = internalMutation({
  args: { worldId: v.string(), arcId: v.string(), sourceEventId: v.string(), updatedAt: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.updatedAt)) throw new ArcPortfolioError('ARC_PORTFOLIO_INVALID', 'finite update time required');
    const row = await ctx.db.query('storyArcPortfolioEntries')
      .withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId)).unique();
    if (!row) return { synced: false };
    const [lifecycle, projectionRows] = await Promise.all([
      ctx.db.query('storyArcLifecycles')
        .withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId)).unique(),
      ctx.db.query('storyArcProjectionEvents')
        .withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId)).collect(),
    ]);
    if (!lifecycle || projectionRows.length === 0) return { synced: false };
    const events: ArcProjectionEvent[] = [...projectionRows]
      .sort((left, right) => left.revision - right.revision)
      .map((projectionRow) => {
        if (!isTimeSlot(projectionRow.timeSlot)) throw new ArcPortfolioError('ARC_PORTFOLIO_INVALID', 'stored time slot is invalid');
        return {
          schemaVersion: 1, worldId: projectionRow.worldId, arcId: projectionRow.arcId,
          revision: projectionRow.revision, kind: projectionRow.kind,
          fields: parseArcProjectionFields(projectionRow.fields),
          sourceEventId: projectionRow.sourceEventId,
          sourceEventSequenceNumber: projectionRow.sourceEventSequenceNumber,
          worldDay: projectionRow.worldDay, timeSlot: projectionRow.timeSlot,
        };
      });
    const entry = structuredClone(row.entry) as ArcPortfolioEntry;
    const next: ArcPortfolioEntry = {
      ...entry,
      projection: replayArcProjection(events, lifecycle.status),
      sourceEventIds: [...new Set([...entry.sourceEventIds, args.sourceEventId])].sort(),
    };
    await ctx.db.patch(row._id, { entry: next, updatedAt: args.updatedAt });
    return { synced: true, status: next.projection.status, revision: next.projection.revision };
  },
});

export const listArcPortfolio = internalQuery({
  args: { worldId: v.string() },
  handler: async (ctx, { worldId }) => {
    const rows = await ctx.db.query('storyArcPortfolioEntries')
      .withIndex('by_world_and_arc', (q) => q.eq('worldId', worldId)).collect();
    return rows.map((row) => structuredClone(row.entry as unknown) as ArcPortfolioEntry);
  },
});
