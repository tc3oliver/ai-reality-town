import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import {
  PostGenerationSafetyError,
  classifyPostGeneration,
  type PostGenerationCandidate,
  type PostGenerationClassification,
} from './postGeneration';

export const classifyAndRecordPostGeneration = internalMutation({
  args: { candidate: v.any(), createdAt: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.createdAt)) throw new PostGenerationSafetyError('SAFETY_INVALID_INPUT', 'finite creation time required');
    const classification = classifyPostGeneration(structuredClone(args.candidate) as PostGenerationCandidate);
    const prior = await ctx.db.query('postGenerationSafetyClassifications')
      .withIndex('by_world_and_classification', (q) => q.eq('worldId', classification.worldId)
        .eq('classificationId', classification.classificationId)).unique();
    if (prior) {
      const existing: PostGenerationClassification = {
        policyVersion: 1, classificationId: prior.classificationId, worldId: prior.worldId,
        sourceId: prior.sourceId, kind: prior.kind, label: prior.label,
        reasonCodes: [...prior.reasonCodes], warningCodes: [...prior.warningCodes],
        classifiedTextHash: prior.classifiedTextHash,
      };
      if (JSON.stringify(existing) !== JSON.stringify(classification)) {
        throw new PostGenerationSafetyError('SAFETY_CLASSIFICATION_CONFLICT', 'classification ID was reused for different content');
      }
      return { classification: existing, deduplicated: true };
    }
    await ctx.db.insert('postGenerationSafetyClassifications', { ...classification, createdAt: args.createdAt });
    return { classification, deduplicated: false };
  },
});

/** Operations-only reason lookup; public artifacts receive only their publication state/warning. */
export const getPostGenerationSafetyReason = internalQuery({
  args: { worldId: v.string(), classificationId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query('postGenerationSafetyClassifications')
      .withIndex('by_world_and_classification', (q) => q.eq('worldId', args.worldId)
        .eq('classificationId', args.classificationId)).unique();
    return row ? {
      classificationId: row.classificationId, label: row.label,
      reasonCodes: [...row.reasonCodes], warningCodes: [...row.warningCodes],
    } : null;
  },
});
