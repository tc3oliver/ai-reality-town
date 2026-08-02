import { internalQuery } from '../_generated/server';
import { v } from 'convex/values';

/** Internal operations view of structured Canon/provider rejection reasons. */
export const listValidationFailures = internalQuery({
  args: { worldId: v.string(), limit: v.number() },
  handler: async (ctx, { worldId, limit }) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('INVALID_FAILURE_QUERY_LIMIT');
    }
    const rows = await ctx.db
      .query('simulationRuns')
      .withIndex('by_world_and_status', (q) => q.eq('worldId', worldId).eq('status', 'failed'))
      .order('desc')
      .take(limit);
    return rows.map((row) => {
      const errorDetails: unknown = row.errorDetails;
      return {
        runId: row._id,
        worldId: row.worldId,
        traceId: row.traceId,
        provider: row.provider,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        errorCode: row.errorCode,
        errorMessage: row.errorMessage,
        errorPath: row.errorPath,
        errorDetails,
      };
    });
  },
});
