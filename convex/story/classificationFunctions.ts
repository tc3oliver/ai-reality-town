import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { deriveEventId } from '../shared/ids';
import { ArcClassificationError, parseArcEventClassification, validateArcClassificationReferences } from './classification';

export const recordArcEventClassification = internalMutation({
  args: { classification: v.any() },
  handler: async (ctx, { classification: raw }) => {
    const classification = parseArcEventClassification(raw);
    const source = await ctx.db.query('canonEvents').withIndex('by_world_and_sequence', (q) => q
      .eq('worldId', classification.worldId).eq('sequenceNumber', classification.sourceEventSequenceNumber)).unique();
    if (!source || deriveEventId(classification.worldId, classification.sourceEventSequenceNumber) !== classification.sourceEventId) {
      throw new ArcClassificationError('ARC_CLASSIFICATION_SOURCE_NOT_ACCEPTED', 'source event is not accepted', 'sourceEventId');
    }
    const existing = await ctx.db.query('storyArcEventClassifications')
      .withIndex('by_world_and_source_event', (q) => q.eq('worldId', classification.worldId)
        .eq('sourceEventSequenceNumber', classification.sourceEventSequenceNumber)).unique();
    if (existing) {
      const stored = parseArcEventClassification({
        schemaVersion: existing.schemaVersion, worldId: existing.worldId,
        sourceEventId: existing.sourceEventId, sourceEventSequenceNumber: existing.sourceEventSequenceNumber,
        memberships: existing.memberships as unknown, newArc: existing.newArc as unknown,
      });
      if (JSON.stringify(stored) !== JSON.stringify(classification)) {
        throw new ArcClassificationError('ARC_CLASSIFICATION_CONFLICT', 'accepted event already has a different classification');
      }
      return { created: false, sourceEventId: classification.sourceEventId };
    }
    const [lifecycles, characters] = await Promise.all([
      ctx.db.query('storyArcLifecycles').withIndex('by_world_and_arc', (q) => q.eq('worldId', classification.worldId)).collect(),
      ctx.db.query('worldCharacters').withIndex('by_world_id', (q) => q.eq('worldId', classification.worldId)).collect(),
    ]);
    validateArcClassificationReferences(classification, new Set(lifecycles.map(({ arcId }) => arcId)), new Set(characters.map(({ characterId }) => characterId)));
    if (classification.newArc && lifecycles.some(({ arcId }) => arcId === classification.newArc?.arcId)) {
      throw new ArcClassificationError('ARC_CLASSIFICATION_CONFLICT', 'new arc already exists', 'newArc.arcId');
    }
    await ctx.db.insert('storyArcEventClassifications', { ...classification, createdAt: source.acceptedAt });
    if (classification.newArc) {
      const proposed = classification.newArc;
      const membership = classification.memberships.find(({ arcId }) => arcId === proposed.arcId)!;
      await ctx.db.insert('storyArcLifecycles', {
        schemaVersion: 1, worldId: classification.worldId, arcId: proposed.arcId,
        status: 'emerging', revision: 0, createdAt: source.acceptedAt, updatedAt: source.acceptedAt,
      });
      await ctx.db.insert('storyArcLifecycleTransitions', {
        worldId: classification.worldId, arcId: proposed.arcId, transitionId: `${proposed.arcId}:lifecycle:0`, revision: 0,
        toStatus: 'emerging', sourceEventId: classification.sourceEventId,
        sourceEventSequenceNumber: classification.sourceEventSequenceNumber,
        reason: 'accepted event classified as inciting incident', changedAt: source.acceptedAt,
      });
      await ctx.db.insert('storyArcProjectionEvents', {
        schemaVersion: 1, worldId: classification.worldId, arcId: proposed.arcId, revision: 0, kind: 'initialized',
        fields: {
          title: proposed.title, premise: proposed.premise, currentQuestion: proposed.currentQuestion,
          coreCharacterIds: proposed.coreCharacterIds, incitingEventId: classification.sourceEventId,
          latestTurningPointEventId: null, essentialFactIds: [], unresolvedQuestions: [proposed.currentQuestion],
          resolvedQuestions: [], recommendedEntryEventId: null, heatScore: Math.round(membership.importance * 100),
        },
        sourceEventId: classification.sourceEventId, sourceEventSequenceNumber: classification.sourceEventSequenceNumber,
        worldDay: source.worldDay, timeSlot: source.timeSlot,
      });
    }
    return { created: true, sourceEventId: classification.sourceEventId };
  },
});

export const getArcEventClassification = internalQuery({
  args: { worldId: v.string(), sourceEventSequenceNumber: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query('storyArcEventClassifications')
      .withIndex('by_world_and_source_event', (q) => q.eq('worldId', args.worldId)
        .eq('sourceEventSequenceNumber', args.sourceEventSequenceNumber)).unique();
    return row ? parseArcEventClassification({
      schemaVersion: row.schemaVersion, worldId: row.worldId,
      sourceEventId: row.sourceEventId, sourceEventSequenceNumber: row.sourceEventSequenceNumber,
      memberships: row.memberships as unknown, newArc: row.newArc as unknown,
    }) : null;
  },
});
