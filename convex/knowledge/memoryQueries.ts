import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { emptyProjection } from '../canon/model';
import { replayWorldEvents } from '../canon/replay';
import { rowToAcceptedEvent } from '../canon/serialize';
import { authorizeMemoryRead } from './memoryAuthorization';
import { compressCharacterMemories, type MemoryEventContext } from './memoryCompression';
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

/**
 * Long-term memory compression (FR-E004). A read, deliberately: it returns a derived digest and
 * writes nothing, so a failure here cannot cost the world a memory.
 *
 * Arc membership arrives as an argument rather than being read here, because `knowledge` may not
 * depend on `story` (`architecture/module-boundaries.json`) — the same contract
 * `retrieveCharacterMemories` uses for `arcRelevantEventIds`.
 */
export const compressCharacterMemoryHistory = internalQuery({
  args: {
    worldId: v.string(),
    targetCharacterId: v.string(),
    requester: v.union(
      v.object({ type: v.literal('character'), characterId: v.string() }),
      v.object({ type: v.literal('operations'), operatorId: v.string() }),
    ),
    horizonDays: v.number(),
    now: v.object({
      worldDay: v.number(),
      timeSlot: v.union(
        v.literal('morning'), v.literal('noon'), v.literal('afternoon'),
        v.literal('evening'), v.literal('night'),
      ),
    }),
    arcMemberships: v.optional(v.array(v.object({
      eventId: v.string(),
      arcIds: v.array(v.string()),
    }))),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId)).collect();
    const events = rows.map(rowToAcceptedEvent);
    const projection = replayWorldEvents(emptyProjection(args.worldId), events);
    const memories = authorizeMemoryRead(
      projection.characterMemories, args.targetCharacterId, args.requester,
    );
    // Narrow to the events this character actually remembers before any of them leave the
    // replay. `compressCharacterMemories` rejects a wider context than this, so an accidental
    // widening here fails loudly instead of quietly handing over other people's scenes.
    const remembered = new Set(memories.map((memory) => memory.sourceEventId));
    const arcIdsByEventId = new Map(
      (args.arcMemberships ?? []).map(({ eventId, arcIds }) => [eventId, arcIds]),
    );
    const eventContexts: MemoryEventContext[] = events
      .filter((event) => remembered.has(event.eventId))
      .map((event) => ({
        eventId: event.eventId,
        participantCharacterIds: event.participantIds,
        ...(event.locationId === undefined ? {} : { locationId: event.locationId }),
        arcIds: arcIdsByEventId.get(event.eventId) ?? [],
      }));
    return compressCharacterMemories(memories, {
      characterId: args.targetCharacterId,
      now: args.now,
      horizonDays: args.horizonDays,
      eventContexts,
    });
  },
});
