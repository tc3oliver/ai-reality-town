import { v } from 'convex/values';
import type { GenericMutationCtx } from 'convex/server';
import { internalMutation, internalQuery } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import {
  PostGenerationSafetyError,
  classifyPostGeneration,
  type PostGenerationCandidate,
  type PostGenerationClassification,
} from './postGeneration';

/**
 * Record a classification in the ledger, once, refusing a reused id that carries different content.
 *
 * A plain function over `ctx.db` rather than only a mutation, because the ledger's conflict check
 * is a table INVARIANT — `convex/safety/schema.ts` says so in as many words — and an invariant
 * that only one entry point enforces is not one. ART-177 found the ledger's single production
 * writer bypassing it with a bare insert while this check had no callers at all, which is a
 * docblock asserting the opposite of shipped behaviour.
 *
 * The dedup is on CONTENT, not on presence: a repeat classification of the same text is idempotent
 * and returns `deduplicated: true`, while the same id over different text throws. That asymmetry
 * is what makes `safetyStatusOverrides` able to be append-only — the row an override revises can
 * never have been rewritten underneath it.
 */
export async function recordPostGenerationClassification(
  db: GenericMutationCtx<DataModel>['db'],
  classification: PostGenerationClassification,
  createdAt: number,
): Promise<{ classification: PostGenerationClassification; deduplicated: boolean }> {
  if (!Number.isFinite(createdAt)) {
    throw new PostGenerationSafetyError('SAFETY_INVALID_INPUT', 'finite creation time required');
  }
  const prior = await db.query('postGenerationSafetyClassifications')
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
  await db.insert('postGenerationSafetyClassifications', { ...classification, createdAt });
  return { classification, deduplicated: false };
}

export const classifyAndRecordPostGeneration = internalMutation({
  args: { candidate: v.any(), createdAt: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.createdAt)) throw new PostGenerationSafetyError('SAFETY_INVALID_INPUT', 'finite creation time required');
    const classification = classifyPostGeneration(structuredClone(args.candidate) as PostGenerationCandidate);
    return recordPostGenerationClassification(ctx.db, classification, args.createdAt);
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
