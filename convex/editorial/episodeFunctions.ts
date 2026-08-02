import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { rowToAcceptedEvent } from '../canon/serialize';
import { deriveEventId } from '../shared/ids';
import { classifyPostGeneration } from '../safety/postGeneration';
import { buildDailyEpisode, dailyEpisodePublicText, EpisodeError, validateDailyEpisode, type EpisodeSourceEvent } from './episode';
import { parseArcEventClassification } from '../story/classification';
import type { ArcEventClassification } from '../story/model';

function secretContent(payload: unknown): string | null {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    && typeof (payload as Record<string, unknown>).content === 'string'
    ? (payload as Record<string, unknown>).content as string : null;
}

export const generateAcceptedEventEpisode = internalMutation({
  args: { worldId: v.string(), worldDay: v.number(), episodeNumber: v.number(), createdAt: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.worldDay) || args.worldDay < 0 || !Number.isSafeInteger(args.episodeNumber)
        || args.episodeNumber < 1 || !Number.isFinite(args.createdAt)) throw new EpisodeError('EPISODE_INVALID_SHAPE', 'invalid generation request');
    const prior = await ctx.db.query('dailyEpisodes').withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId).eq('worldDay', args.worldDay)).unique();
    if (prior) return { status: prior.status, episodeNumber: prior.episodeNumber, deduplicated: true };
    const [rows, classificationRows, secrets, projectionRows] = await Promise.all([
      ctx.db.query('canonEvents').withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId).eq('worldDay', args.worldDay)).collect(),
      ctx.db.query('storyArcEventClassifications').withIndex('by_world', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('worldSecrets').withIndex('by_world_id', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('storyArcProjectionEvents').withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', args.worldId)).collect(),
    ]);
    const classifications = new Map<number, ArcEventClassification>(classificationRows.map((row) => [row.sourceEventSequenceNumber,
      parseArcEventClassification({ schemaVersion: row.schemaVersion, worldId: row.worldId, sourceEventId: row.sourceEventId,
        sourceEventSequenceNumber: row.sourceEventSequenceNumber, memberships: row.memberships as unknown, newArc: row.newArc as unknown })]));
    const currentQuestions = new Map<string, string>();
    [...projectionRows].sort((a, b) => a.revision - b.revision).forEach((row) => {
      const fields = row.fields as unknown;
      if (fields && typeof fields === 'object' && !Array.isArray(fields)
          && typeof (fields as Record<string, unknown>).currentQuestion === 'string') {
        currentQuestions.set(row.arcId, (fields as Record<string, unknown>).currentQuestion as string);
      }
    });
    const sources: EpisodeSourceEvent[] = rows.map((row) => {
      const event = rowToAcceptedEvent(row);
      const classification = classifications.get(row.sequenceNumber);
      const memberships = classification?.memberships ?? [];
      return {
        eventId: event.eventId, publicSummary: event.publicSummary ?? null,
        participantIds: [...event.participantIds], arcIds: memberships.map(({ arcId }) => arcId),
        importance: memberships.reduce((maximum, item) => Math.max(maximum, item.importance), 0),
        publicFactIds: event.stateChanges.flatMap((change, index) => change.type === 'fact_created' && change.visibility === 'public'
          ? [`${event.eventId}:fact:${index}`] : []),
        publicRelationshipChanges: event.stateChanges.flatMap((change) => change.type === 'relationship_changed' && change.visibility === 'public'
          ? [`Relationship changed between ${change.sourceCharacterId} and ${change.targetCharacterId}.`] : []),
        newQuestions: classification?.newArc ? [classification.newArc.currentQuestion] : [],
        resolvedQuestions: memberships.filter(({ role }) => role === 'resolution').flatMap(({ arcId }) => {
          const question = currentQuestions.get(arcId); return question ? [question] : [];
        }),
      };
    });
    const secretValues = secrets.map(({ payload }) => secretContent(payload)).filter((value): value is string => value !== null);
    try {
      const episode = validateDailyEpisode(buildDailyEpisode(args.worldId, args.worldDay, args.episodeNumber, sources), sources, secretValues);
      const safety = classifyPostGeneration({ classificationId: `episode:${args.worldId}:${args.worldDay}`,
        worldId: args.worldId, sourceId: `episode:${args.episodeNumber}`, kind: 'public_artifact',
        text: dailyEpisodePublicText(episode),
        coreFactIds: episode.sourceEventIds });
      const safe = safety.label === 'allow' || safety.label === 'allow_with_warning';
      await ctx.db.insert('dailyEpisodes', { schemaVersion: 1, worldId: args.worldId, worldDay: args.worldDay,
        episodeNumber: args.episodeNumber, status: safe ? 'ready' : 'withheld', ...(safe ? { episode } : {}),
        safetyClassificationId: safety.classificationId, sourceEventIds: episode.sourceEventIds, createdAt: args.createdAt });
      return { status: safe ? 'ready' as const : 'withheld' as const, episodeNumber: args.episodeNumber, deduplicated: false };
    } catch (error) {
      const errorCode = error instanceof EpisodeError ? error.code : 'EPISODE_GENERATION_FAILED';
      await ctx.db.insert('dailyEpisodes', { schemaVersion: 1, worldId: args.worldId, worldDay: args.worldDay,
        episodeNumber: args.episodeNumber, status: 'failed', errorCode,
        sourceEventIds: rows.map((row) => deriveEventId(args.worldId, row.sequenceNumber)), createdAt: args.createdAt });
      return { status: 'failed' as const, episodeNumber: args.episodeNumber, errorCode, deduplicated: false };
    }
  },
});

export const getDailyEpisodeInternal = internalQuery({
  args: { worldId: v.string(), worldDay: v.number() },
  handler: (ctx, args) => ctx.db.query('dailyEpisodes').withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId).eq('worldDay', args.worldDay)).unique(),
});
