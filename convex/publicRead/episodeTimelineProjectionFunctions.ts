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
import { readWithheldSceneLabels } from '../safety/effectiveSafetyLabels';
import { EpisodeTimelineError, buildEpisodeProjection, buildTimelineProjection, EPISODE_MODEL_KIND, TIMELINE_MODEL_KIND, type TimelineEntryInput } from './episodeTimelineProjection';
import { sceneEventRows, withheldEventIds } from './liveStateFunctions';
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

/**
 * Rebuild and publish the major-event Timeline projection for a world (AC#2/#3).
 *
 * SAFETY GATE (FR-P004 / ART-132, extended by ART-124). This projection is a public TEXT surface:
 * every entry carries the accepted event's `publicSummary`, and it is read by the character page
 * and — since ART-124 — by the character card's "recent major events" list on the live map. It
 * had no safety gate at all, so a Scene an operator withheld went on narrating itself here long
 * after `rebuildLiveProjection` had removed the same sentence from the dynamic surface.
 *
 * Closed with ART-132's own machinery rather than a second copy of it: the bounded
 * `readWithheldSceneLabels` sweep, then `sceneEventRows` + `withheldEventIds` — the exact
 * functions `rebuildLiveProjection` uses, imported rather than re-implemented, so the two
 * surfaces cannot come to disagree about which events are refused.
 *
 * A refused entry is KEPT and loses only its `publicSummary`, matching `redactWithheldSummaries`:
 * the event happened, its participants and arc membership are structural facts the timeline is
 * about, and dropping the row would silently renumber a public history. `publicSummary: null` is
 * an existing, already-handled state on both consumers — the character page prints `(無摘要)`
 * and the card does the same — so no client change is needed.
 */
export const rebuildTimelineProjection = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new EpisodeTimelineError('TIMELINE_INVALID', 'worldId and a finite now are required');
    }
    const [canonRows, classificationRows, episodeRows, withheldSceneLabels] = await Promise.all([
      ctx.db.query('canonEvents').withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('storyArcEventClassifications').withIndex('by_world', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('dailyEpisodes').withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId)).collect(),
      // The inverted, history-independent question. See `effectiveSafetyLabels.ts` on why a
      // rebuild must never ask this Scene by Scene.
      readWithheldSceneLabels(ctx.db, args.worldId),
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

    const acceptedEvents = canonRows.map(rowToAcceptedEvent);
    // Keyed on the EVENT ID, never on a position in a parallel array — the reason
    // `withheldEventIds` returns ids at all. Index correlation works today and would start
    // redacting events against their neighbour's verdict the day anyone filters upstream.
    const withheldEvents = withheldEventIds(
      sceneEventRows(acceptedEvents),
      new Map(Object.entries(withheldSceneLabels)),
    );

    const entries: TimelineEntryInput[] = canonRows.map((row, index) => {
      const event = acceptedEvents[index];
      const memberships = membershipsBySequence.get(row.sequenceNumber) ?? [];
      const importance = memberships.reduce((max, membership) => Math.max(max, membership.importance), 0);
      return {
        eventId: event.eventId,
        worldDay: event.worldDay,
        timeSlot: event.timeSlot,
        eventType: event.eventType,
        publicSummary: withheldEvents.has(event.eventId) ? null : (event.publicSummary ?? null),
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
