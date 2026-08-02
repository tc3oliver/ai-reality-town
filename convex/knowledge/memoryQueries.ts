import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { emptyProjection } from '../canon/model';
import { replayWorldEvents } from '../canon/replay';
import { rowToAcceptedEvent } from '../canon/serialize';
import { authorizeMemoryRead } from './memoryAuthorization';
import { MAX_RETRIEVED_MEMORIES, retrieveAuthorizedMemories } from './memoryRetrieval';

/** Internal subjective-memory read. Private memories have no public function boundary. */
export const getCharacterMemories = internalQuery({
  args: {
    worldId: v.string(),
    targetCharacterId: v.string(),
    requester: v.union(
      v.object({ type: v.literal('character'), characterId: v.string() }),
      v.object({ type: v.literal('operations'), operatorId: v.string() }),
    ),
  },
  handler: async (ctx, { worldId, targetCharacterId, requester }) => {
    const rows = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).collect();
    const projection = replayWorldEvents(emptyProjection(worldId), rows.map(rowToAcceptedEvent));
    return authorizeMemoryRead(projection.characterMemories, targetCharacterId, requester);
  },
});

/** Bounded cognition retrieval. Only selected memories—not full history—cross this boundary. */
export const retrieveCharacterMemories = internalQuery({
  args: {
    worldId: v.string(),
    targetCharacterId: v.string(),
    requester: v.object({ type: v.literal('character'), characterId: v.string() }),
    query: v.string(),
    limit: v.number(),
    now: v.object({
      worldDay: v.number(),
      timeSlot: v.union(
        v.literal('morning'), v.literal('noon'), v.literal('afternoon'),
        v.literal('evening'), v.literal('night'),
      ),
    }),
    arcRelevantEventIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > MAX_RETRIEVED_MEMORIES) {
      throw new Error(`memory retrieval limit must be an integer from 1 to ${MAX_RETRIEVED_MEMORIES}`);
    }
    const rows = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId)).collect();
    const projection = replayWorldEvents(emptyProjection(args.worldId), rows.map(rowToAcceptedEvent));
    return retrieveAuthorizedMemories(projection.characterMemories, args);
  },
});
