/**
 * Convex wiring for the public Episode and Timeline projections (PRD §13.10/§13.8,
 * FR-I003). Independent rebuild entry points: gather published editorial episodes
 * + accepted events (with arc importance) and publish the projections through the
 * public read-model store. Both remain last-known-good during simulation failure
 * (AC#3). Zero canon writes; public reads reuse ART-40's getPublishedReadModel.
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import type { DailyEpisode } from '../editorial/episode';
import { rowToAcceptedEvent } from '../canon/serialize';
import { EpisodeTimelineError, buildEpisodeProjection, buildTimelineProjection, EPISODE_MODEL_KIND, TIMELINE_MODEL_KIND, type TimelineEntryInput } from './episodeTimelineProjection';
import { commitReadModelVersion } from './readModel';
import { writeStore } from './readModelFunctions';

type ClassificationMembership = { arcId: string; importance: number };

/** Rebuild and publish the Episode projection for a world-day (AC#1/#3). */
export const rebuildEpisodeProjection = internalMutation({
  args: { worldId: v.string(), worldDay: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isSafeInteger(args.worldDay) || args.worldDay < 0 || !Number.isFinite(args.now)) {
      throw new EpisodeTimelineError('EPISODE_INVALID', 'worldId, a non-negative worldDay, and a finite now are required');
    }
    const row = await ctx.db
      .query('dailyEpisodes')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId).eq('worldDay', args.worldDay))
      .unique();
    if (!row || !row.episode) {
      throw new EpisodeTimelineError('EPISODE_NOT_ELIGIBLE', 'no published episode for this world-day');
    }
    const payload = buildEpisodeProjection({ worldId: args.worldId, episode: row.episode as DailyEpisode, status: row.status });
    const result = await commitReadModelVersion(writeStore(ctx.db), {
      worldId: args.worldId, modelKind: EPISODE_MODEL_KIND, modelRef: `episode:${args.worldDay}`,
      payload, sourceEventIds: payload.sourceEventIds, status: 'published', now: args.now,
    });
    return { modelRef: `episode:${args.worldDay}`, version: result.version, deduplicated: result.deduplicated };
  },
});

/** Rebuild and publish the major-event Timeline projection for a world (AC#2/#3). */
export const rebuildTimelineProjection = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new EpisodeTimelineError('TIMELINE_INVALID', 'worldId and a finite now are required');
    }
    const [canonRows, classificationRows, episodeRows] = await Promise.all([
      ctx.db.query('canonEvents').withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('storyArcEventClassifications').withIndex('by_world', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('dailyEpisodes').withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId)).collect(),
    ]);

    const membershipsBySequence = new Map<number, ClassificationMembership[]>();
    for (const row of classificationRows) {
      const memberships = row.memberships as ClassificationMembership[] | undefined;
      if (Array.isArray(memberships)) membershipsBySequence.set(row.sourceEventSequenceNumber, memberships);
    }
    const episodeNumberByDay = new Map<number, number>();
    for (const row of episodeRows) {
      if (row.episode) episodeNumberByDay.set(row.worldDay, row.episodeNumber);
    }

    const entries: TimelineEntryInput[] = canonRows.map((row) => {
      const event = rowToAcceptedEvent(row);
      const memberships = membershipsBySequence.get(row.sequenceNumber) ?? [];
      const importance = memberships.reduce((max, membership) => Math.max(max, membership.importance), 0);
      return {
        eventId: event.eventId,
        worldDay: event.worldDay,
        timeSlot: event.timeSlot,
        eventType: event.eventType,
        publicSummary: event.publicSummary ?? null,
        importance,
        arcIds: memberships.map((membership) => membership.arcId),
        characterIds: [...event.participantIds],
        episodeNumber: episodeNumberByDay.get(event.worldDay) ?? null,
      };
    });

    const payload = buildTimelineProjection({ worldId: args.worldId, entries });
    const result = await commitReadModelVersion(writeStore(ctx.db), {
      worldId: args.worldId, modelKind: TIMELINE_MODEL_KIND, modelRef: `timeline:${args.worldId}`,
      payload, sourceEventIds: payload.entries.map((entry) => entry.eventId), status: 'published', now: args.now,
    });
    return { modelRef: `timeline:${args.worldId}`, version: result.version, deduplicated: result.deduplicated };
  },
});
