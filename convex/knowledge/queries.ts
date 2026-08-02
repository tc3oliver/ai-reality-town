import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { emptyProjection } from '../canon/model';
import { replayWorldEvents } from '../canon/replay';
import { rowToAcceptedEvent } from '../canon/serialize';
import { authorizeKnowledgeRead } from './authorization';

/** Internal authorized cognition/operations read. There is intentionally no public query. */
export const getCharacterKnowledge = internalQuery({
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
    return authorizeKnowledgeRead(projection.characterKnowledge, targetCharacterId, requester);
  },
});
