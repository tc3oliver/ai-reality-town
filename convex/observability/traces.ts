import { internalMutation, internalQuery, query } from '../_generated/server';
import { v } from 'convex/values';
import type { DataModel } from '../_generated/dataModel';
import type { GenericMutationCtx } from 'convex/server';
import {
  publicLlmTrace,
  recordLlmTrace,
  type LlmTraceRecord,
  type LlmTraceStore,
} from './llmTrace';
import { llmTraceDraftValidator } from './schema';

function convexTraceStore(db: GenericMutationCtx<DataModel>['db']): LlmTraceStore {
  return {
    async find(traceId) {
      const row = await db.query('llmTraces').withIndex('by_trace_id', (q) => q.eq('traceId', traceId)).unique();
      if (!row) return null;
      const { _id: _id, _creationTime: _creationTime, ...record } = row;
      return record as LlmTraceRecord;
    },
    async insertIfAbsent(record) {
      const existing = await db.query('llmTraces').withIndex('by_trace_id', (q) => q.eq('traceId', record.traceId)).unique();
      if (existing) {
        const { _id: _id, _creationTime: _creationTime, ...existingRecord } = existing;
        return existingRecord as LlmTraceRecord;
      }
      await db.insert('llmTraces', record);
      return null;
    },
  };
}

/** Server-only write boundary; callers cannot attach prompt, response, or secret fields. */
export const recordTrace = internalMutation({
  args: { draft: llmTraceDraftValidator },
  handler: (ctx, { draft }) => recordLlmTrace(convexTraceStore(ctx.db), draft, Date.now()),
});

/** Full accounting metadata is server-only and reserved for authorized operations paths. */
export const getTraceInternal = internalQuery({
  args: { traceId: v.string() },
  handler: async (ctx, { traceId }): Promise<LlmTraceRecord | null> => {
    const row = await ctx.db.query('llmTraces').withIndex('by_trace_id', (q) => q.eq('traceId', traceId)).unique();
    if (!row) return null;
    const { _id: _id, _creationTime: _creationTime, ...record } = row;
    return record as LlmTraceRecord;
  },
});

/** Unauthorized/public access receives only correlation and final-status metadata. */
export const getTracePublic = query({
  args: { traceId: v.string() },
  handler: async (ctx, { traceId }) => {
    const row = await ctx.db.query('llmTraces').withIndex('by_trace_id', (q) => q.eq('traceId', traceId)).unique();
    if (!row) return null;
    const { _id: _id, _creationTime: _creationTime, ...record } = row;
    return publicLlmTrace(record as LlmTraceRecord);
  },
});
