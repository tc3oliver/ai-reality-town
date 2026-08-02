import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { deriveEventId } from '../shared/ids';
import type { ArcPortfolioEntry } from './portfolio';
import {
  ArcResolutionError,
  createArcResolutionDecision,
  detectArcStagnation,
  type ArcResolutionDecision,
  type ArcStagnationPrompt,
  type CreateArcResolutionDecision,
} from './resolution';

export const refreshArcStagnationPrompts = internalMutation({
  args: { worldId: v.string(), currentWorldDay: v.number() },
  handler: async (ctx, args) => {
    const entries = await ctx.db.query('storyArcPortfolioEntries')
      .withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId)).collect();
    const prompts = entries.flatMap((row) => {
      const entry = structuredClone(row.entry) as ArcPortfolioEntry;
      const prompt = detectArcStagnation(entry.projection, entry.tier, args.currentWorldDay);
      return prompt ? [prompt] : [];
    });
    for (const prompt of prompts) {
      const existing = await ctx.db.query('storyArcStagnationPrompts')
        .withIndex('by_world_and_prompt', (q) => q.eq('worldId', args.worldId).eq('promptId', prompt.promptId)).unique();
      if (!existing) await ctx.db.insert('storyArcStagnationPrompts', {
        worldId: args.worldId, arcId: prompt.arcId, promptId: prompt.promptId,
        prompt, detectedAtWorldDay: prompt.detectedAtWorldDay,
      });
    }
    return prompts;
  },
});

export const recordArcResolutionDecision = internalMutation({
  args: { worldId: v.string(), decision: v.any() },
  handler: async (ctx, args) => {
    const decision = createArcResolutionDecision(structuredClone(args.decision) as CreateArcResolutionDecision);
    if (decision.worldId !== args.worldId) throw new ArcResolutionError('ARC_RESOLUTION_INVALID', 'decision belongs to another world');
    const accepted = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId)
        .eq('sequenceNumber', decision.sourceEventSequenceNumber)).unique();
    if (!accepted || deriveEventId(args.worldId, decision.sourceEventSequenceNumber) !== decision.sourceEventId) {
      throw new ArcResolutionError('ARC_RESOLUTION_PROVENANCE_INVALID', 'resolution source must be an Accepted Event');
    }
    const lifecycle = await ctx.db.query('storyArcLifecycles')
      .withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', decision.arcId)).unique();
    if (!lifecycle || lifecycle.status !== decision.fromStatus) {
      throw new ArcResolutionError('ARC_RESOLUTION_INVALID_TRANSITION', 'resolution status does not match current lifecycle');
    }
    const prior = await ctx.db.query('storyArcResolutionDecisions')
      .withIndex('by_world_and_decision', (q) => q.eq('worldId', args.worldId).eq('decisionId', decision.decisionId)).unique();
    if (prior) return structuredClone(prior.decision) as ArcResolutionDecision;
    await ctx.db.insert('storyArcResolutionDecisions', {
      worldId: args.worldId, arcId: decision.arcId, decisionId: decision.decisionId,
      decision, sourceEventSequenceNumber: decision.sourceEventSequenceNumber,
    });
    return decision;
  },
});

/** Operator-visible, internal-only prompt queue. */
export const listArcStagnationPrompts = internalQuery({
  args: { worldId: v.string() },
  handler: async (ctx, { worldId }) => {
    const rows = await ctx.db.query('storyArcStagnationPrompts')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId)).collect();
    return rows.map((row) => structuredClone(row.prompt) as ArcStagnationPrompt);
  },
});

/** Durable history and the source-proven consequence contract consumed by ART-82. */
export const listArcResolutionHistory = internalQuery({
  args: { worldId: v.string(), arcId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('storyArcResolutionDecisions')
      .withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId)).collect();
    return rows.map((row) => structuredClone(row.decision) as ArcResolutionDecision);
  },
});
