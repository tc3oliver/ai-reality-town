import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { deriveEventId } from '../shared/ids';
import type { ArcOverflowRemediation, ArcPortfolioDecision, ArcPortfolioEntry } from './portfolio';
import { applyArcPortfolioControl, ArcPortfolioError } from './portfolio';

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
    const accepted = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId)).collect();
    const acceptedIds = new Set(accepted.map((row) => deriveEventId(args.worldId, row.sequenceNumber)));
    if (!Array.isArray(candidate.sourceEventIds) || candidate.sourceEventIds.some((id) => !acceptedIds.has(id))) {
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

export const listArcPortfolio = internalQuery({
  args: { worldId: v.string() },
  handler: async (ctx, { worldId }) => {
    const rows = await ctx.db.query('storyArcPortfolioEntries')
      .withIndex('by_world_and_arc', (q) => q.eq('worldId', worldId)).collect();
    return rows.map((row) => structuredClone(row.entry as unknown) as ArcPortfolioEntry);
  },
});
