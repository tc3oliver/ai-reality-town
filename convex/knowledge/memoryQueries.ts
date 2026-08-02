import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { emptyProjection } from '../canon/model';
import { replayWorldEvents } from '../canon/replay';
import { rowToAcceptedEvent } from '../canon/serialize';
import { authorizeMemoryRead } from './memoryAuthorization';

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
