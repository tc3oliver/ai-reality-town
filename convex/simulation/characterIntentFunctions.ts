import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { emptyProjection } from '../canon/model';
import { replayWorldEvents } from '../canon/replay';
import { rowToAcceptedEvent } from '../canon/serialize';
import { CharacterIntentError, assertCharacterIntentContextAuthorization, parseCharacterIntentContext, validateCharacterIntent } from './characterIntent';

export const persistCharacterIntent = internalMutation({
  args: { context: v.any(), intent: v.any(), createdAt: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.createdAt)) throw new CharacterIntentError('INTENT_INVALID_SHAPE', 'finite creation time required');
    const parsedContext = parseCharacterIntentContext(args.context);
    const [events, seedKnowledge, seedAssets, seedCharacter] = await Promise.all([
      ctx.db.query('canonEvents').withIndex('by_world_and_sequence', (q) => q.eq('worldId', parsedContext.worldId)).collect(),
      ctx.db.query('worldCharacterKnowledge').withIndex('by_world_and_character', (q) => q.eq('worldId', parsedContext.worldId).eq('characterId', parsedContext.characterId)).collect(),
      ctx.db.query('worldAssets').withIndex('by_world_and_owner', (q) => q.eq('worldId', parsedContext.worldId).eq('ownerCharacterId', parsedContext.characterId)).collect(),
      ctx.db.query('worldCharacters').withIndex('by_world_and_character', (q) => q.eq('worldId', parsedContext.worldId).eq('characterId', parsedContext.characterId)).unique(),
    ]);
    if (!seedCharacter) throw new CharacterIntentError('INTENT_CONTEXT_ACCESS_DENIED', 'target character does not exist');
    const projection = replayWorldEvents(emptyProjection(parsedContext.worldId), events.map(rowToAcceptedEvent));
    const payload = seedCharacter.payload as unknown;
    const seedLocation = payload && typeof payload === 'object' && !Array.isArray(payload)
      && typeof (payload as Record<string, unknown>).initialLocationId === 'string'
      ? (payload as Record<string, unknown>).initialLocationId as string : null;
    const currentLocationId = projection.characterLocations[parsedContext.characterId] ?? seedLocation;
    if (!currentLocationId) throw new CharacterIntentError('INTENT_CONTEXT_STALE', 'character has no current location');
    const projectedAssetIds = Object.entries(projection.itemOwners).filter(([, owner]) => owner === parsedContext.characterId).map(([id]) => id);
    const context = assertCharacterIntentContextAuthorization(parsedContext, {
      knowledgeIds: new Set([...seedKnowledge.map(({ knowledgeId }) => knowledgeId), ...(projection.characterKnowledge[parsedContext.characterId] ?? []).map(({ knowledgeId }) => knowledgeId)]),
      memoryIds: new Set((projection.characterMemories[parsedContext.characterId] ?? []).map(({ memoryId }) => memoryId)),
      assetIds: new Set([
        ...seedAssets.map(({ assetId }) => assetId).filter((assetId) =>
          projection.itemOwners[assetId] === undefined || projection.itemOwners[assetId] === parsedContext.characterId),
        ...projectedAssetIds,
      ]), currentLocationId,
    });
    const result = validateCharacterIntent(args.intent, context);
    const director = await ctx.db.query('directorPlans').withIndex('by_world_and_run', (q) => q.eq('worldId', context.worldId).eq('directorRunId', context.directorRunId)).unique();
    if (!director) throw new CharacterIntentError('INTENT_RUN_CONFLICT', 'Director Run is not persisted');
    const prior = await ctx.db.query('characterIntents').withIndex('by_world_and_run', (q) => q.eq('worldId', context.worldId).eq('intentRunId', context.intentRunId)).unique();
    if (prior) {
      const priorContext = parseCharacterIntentContext(prior.context);
      const priorResult = validateCharacterIntent(prior.intent, priorContext);
      if (JSON.stringify(priorContext) !== JSON.stringify(context) || JSON.stringify(priorResult) !== JSON.stringify(result)) throw new CharacterIntentError('INTENT_RUN_CONFLICT', 'Intent Run ID was reused');
      return { ...priorResult, deduplicated: true };
    }
    await ctx.db.insert('characterIntents', { schemaVersion: 1, worldId: context.worldId, intentRunId: context.intentRunId,
      directorRunId: context.directorRunId, characterId: context.characterId, context, intent: result.intent,
      disposition: result.disposition, createdAt: args.createdAt });
    return { ...result, deduplicated: false };
  },
});

export const listCharacterIntentsForDirectorRun = internalQuery({
  args: { worldId: v.string(), directorRunId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('characterIntents').withIndex('by_director_run', (q) => q.eq('worldId', args.worldId).eq('directorRunId', args.directorRunId)).collect();
    return rows.map((row) => {
      const context = parseCharacterIntentContext(row.context);
      return validateCharacterIntent(row.intent, context);
    });
  },
});
