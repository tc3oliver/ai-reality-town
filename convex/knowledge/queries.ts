import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { emptyProjection } from '../canon/model';
import { replayWorldEvents } from '../canon/replay';
import { rowToAcceptedEvent } from '../canon/serialize';
import { readProjectionViaSnapshot } from '../canon/snapshotReplay';
import { authorizeKnowledgeRead } from './authorization';
import { authorizeCharacterRumorList, authorizeRumorRead } from './rumorAuthorization';

const requesterValidator = v.union(
  v.object({ type: v.literal('character'), characterId: v.string() }),
  v.object({ type: v.literal('operations'), operatorId: v.string() }),
);

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

/**
 * FR-E005. One rumor chain, as the requester is entitled to see it. Internal; no public query.
 *
 * Reads through {@link readProjectionViaSnapshot} rather than replaying the whole log, which is
 * sound here for the documented reason: neither `rumors` nor `characterKnowledge` is one of
 * `SEED_BASELINE_FIELDS`, so a snapshot-resumed projection and a full replay agree on everything
 * this read touches.
 */
export const getRumorChain = internalQuery({
  args: { worldId: v.string(), rumorId: v.string(), requester: requesterValidator },
  handler: async (ctx, { worldId, rumorId, requester }) =>
    authorizeRumorRead(await readProjectionViaSnapshot(ctx.db, worldId), rumorId, requester),
});

/** FR-E005. Every rumor one character currently holds. Internal; no public query. */
export const getCharacterRumors = internalQuery({
  args: { worldId: v.string(), targetCharacterId: v.string(), requester: requesterValidator },
  handler: async (ctx, { worldId, targetCharacterId, requester }) =>
    authorizeCharacterRumorList(await readProjectionViaSnapshot(ctx.db, worldId), targetCharacterId, requester),
});
