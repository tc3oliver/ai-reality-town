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
import { isViewerServablePublicationStatus } from '../editorial/publicationLifecycle';
import { episodeContentRefOf } from './visualReplay';
import { EpisodeTimelineError, buildEpisodeProjection, buildTimelineProjection, EPISODE_MODEL_KIND, TIMELINE_MAJOR_IMPORTANCE, TIMELINE_MODEL_KIND, type TimelineEntryInput } from './episodeTimelineProjection';
import { sceneEventRows, withheldEventIds } from './liveStateFunctions';
import { commitReadModelVersion, withdrawReadModel } from './readModel';
import { writeStore } from './readModelFunctions';

type ClassificationMembership = { arcId: string; importance: number };

/**
 * Rebuild and publish the Episode projection for a world-day (AC#1/#3).
 *
 * ## It asks the publication record, and did not use to (ART-171)
 *
 * This rebuild read only `dailyEpisodes.status` — a SAFETY decision — and never looked at the
 * editorial publication record that FR-K004 says governs whether derived content is visible.
 * That was consistent right up until ART-171, and only by accident: the sole path to a `withheld`
 * record was the pipeline's own, which fires exactly when the episode row is not `ready`, and
 * this rebuild is skipped in that case.
 *
 * Giving an administrator an INDEPENDENT withhold breaks that coupling. Without the check below,
 * an operator would withhold an Episode, watch it disappear, and see the next accepted event
 * republish it — a withhold that withholds for as long as the world happens to be idle.
 *
 * A withheld record WITHDRAWS the target rather than publishing an empty payload, and withdraws
 * its fallbacks with it: serving the last known good version of withheld content is the outcome
 * the withhold exists to prevent. See {@link withdrawReadModel}.
 */
export const rebuildEpisodeProjection = internalMutation({
  args: { worldId: v.string(), worldDay: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isSafeInteger(args.worldDay) || args.worldDay < 0 || !Number.isFinite(args.now)) {
      throw new EpisodeTimelineError('EPISODE_INVALID', 'worldId, a non-negative worldDay, and a finite now are required');
    }
    const modelRef = `episode:${args.worldDay}`;
    const contentRef = episodeContentRefOf(args.worldId, args.worldDay);
    // A point read on `by_current`, not a scan: one lookup per rebuild regardless of how many
    // versions the record has been through.
    const record = await ctx.db
      .query('publicationRecords')
      .withIndex('by_current', (q) => q
        .eq('worldId', args.worldId).eq('contentRef', contentRef).eq('isCurrent', true))
      .unique();
    // NO record is not a refusal. Episodes accepted before the lifecycle existed have none, and
    // the pipeline creates the record after generating the Episode — treating silence as a
    // withhold would blank the public episode page for every world that predates FR-K004.
    if (record && !isViewerServablePublicationStatus(record.status)) {
      const { withdrawnVersions } = await withdrawReadModel(writeStore(ctx.db), {
        worldId: args.worldId, modelKind: EPISODE_MODEL_KIND, modelRef, now: args.now,
      });
      return { modelRef, version: 0, deduplicated: false, withdrawnVersions, publicationStatus: record.status };
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
      worldId: args.worldId, modelKind: EPISODE_MODEL_KIND, modelRef,
      payload, sourceEventIds: payload.sourceEventIds, status: 'published', now: args.now,
    });
    return {
      modelRef, version: result.version, deduplicated: result.deduplicated,
      withdrawnVersions: [] as number[], publicationStatus: record?.status ?? null,
    };
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
 *
 * CANON READ (ART-100). This used to `collect()` the world's whole `canonEvents` log — one of
 * the last full-replay sites on the post-commit path, since this rebuild runs after every
 * accepted event. It no longer needs to: every field this projection reads off a canon row
 * (`worldDay`, `timeSlot`, `eventType`, `publicSummary`, `participantIds`) is a property of that
 * ROW alone, not a fold over history, and `buildTimelineProjection`'s default `minImportance`
 * means an event can never appear in the published Timeline unless its classification already
 * clears `TIMELINE_MAJOR_IMPORTANCE`. `storyArcEventClassifications` is read in full regardless
 * (unchanged from before this task; it is not the log this task was asked to bound), which makes
 * its already-known qualifying sequence numbers the exact, small set to look Canon rows up by —
 * one `worldId + sequenceNumber` point query each, the same WINDOW pattern
 * `relationshipArcProjectionFunctions.ts` uses for `rebuildArcProjection` — rather than a scan of
 * the world's whole event log to keep the handful that matter.
 *
 * This is not append-then-invalidate: `entries` is still rebuilt FROM SCRATCH on every call,
 * exactly as it was before, from data (`classificationRows`, `episodeRows`,
 * `withheldSceneLabels`) that is ALSO read fresh and in full on every call. So a reclassification
 * that moves an old event's importance across the threshold in either direction, an episode
 * renumbering that changes `episodeNumberByDay` for a past world day, and a safety override that
 * changes which Scenes are withheld are all picked up correctly on the very next rebuild — the
 * same as a full replay would show, because nothing here is cached or diffed against the prior
 * publish. Only the CANON ROW READS for events that were never going to qualify are avoided.
 */
export const rebuildTimelineProjection = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new EpisodeTimelineError('TIMELINE_INVALID', 'worldId and a finite now are required');
    }
    const [classificationRows, withheldSceneLabels] = await Promise.all([
      ctx.db.query('storyArcEventClassifications').withIndex('by_world', (q) => q.eq('worldId', args.worldId)).collect(),
      // The inverted, history-independent question. See `effectiveSafetyLabels.ts` on why a
      // rebuild must never ask this Scene by Scene.
      readWithheldSceneLabels(ctx.db, args.worldId),
    ]);

    const membershipsBySequence = new Map<number, ClassificationMembership[]>();
    const importanceBySequence = new Map<number, number>();
    for (const row of classificationRows) {
      const memberships = row.memberships as ClassificationMembership[] | undefined;
      if (!Array.isArray(memberships)) continue;
      membershipsBySequence.set(row.sourceEventSequenceNumber, memberships);
      importanceBySequence.set(
        row.sourceEventSequenceNumber,
        memberships.reduce((max, membership) => Math.max(max, membership.importance), 0),
      );
    }
    // The already-known set of sequence numbers a Canon row is worth reading for — see the
    // docblock above. An event absent from `importanceBySequence` (no classification row, or one
    // whose `memberships` failed the shape check) defaults to importance 0 exactly as the old
    // full-scan code did via `?? []`, so it is excluded here rather than fetched and filtered out
    // downstream — same outcome, fewer reads.
    const majorSequenceNumbers = [...importanceBySequence.entries()]
      .filter(([, importance]) => importance >= TIMELINE_MAJOR_IMPORTANCE)
      .map(([sequenceNumber]) => sequenceNumber);

    const canonRows = (await Promise.all(
      majorSequenceNumbers.map((sequenceNumber) =>
        ctx.db.query('canonEvents')
          .withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId).eq('sequenceNumber', sequenceNumber))
          .unique()),
    ))
      .filter((row): row is NonNullable<typeof row> => row !== null)
      // Point lookups resolve in `Promise.all`/Map-insertion order, not accepted order; entries
      // below and `withheldEventIds` above both need Canon's actual sequence order.
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber);

    const acceptedEvents = canonRows.map(rowToAcceptedEvent);

    /**
     * Episode numbers for exactly the days this timeline names (ART-100).
     *
     * `episodeNumberByDay` is consulted only for the `worldDay` of the events that qualified
     * above, and a timeline holds a handful of major events — so sweeping every daily-episode row
     * the world has ever had was an O(world days) read serving a handful of lookups. Read AFTER
     * the events are parsed rather than alongside the classifications, because which days matter
     * is not known until then, and `worldDay` is a field of the PARSED event rather than of the
     * stored row.
     *
     * Renumbering is still picked up on the next rebuild: nothing is cached, the rows are re-read
     * every time, and a day whose episode was renumbered reports its new number exactly as the
     * sweep did. There is a test for that.
     */
    const episodeNumberByDay = new Map<number, number>();
    for (const worldDay of new Set(acceptedEvents.map((event) => event.worldDay))) {
      const episodeRow = await ctx.db.query('dailyEpisodes')
        .withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId).eq('worldDay', worldDay))
        .unique();
      if (episodeRow?.episode) episodeNumberByDay.set(episodeRow.worldDay, episodeRow.episodeNumber);
    }
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
      return {
        eventId: event.eventId,
        worldDay: event.worldDay,
        timeSlot: event.timeSlot,
        eventType: event.eventType,
        publicSummary: withheldEvents.has(event.eventId) ? null : (event.publicSummary ?? null),
        importance: importanceBySequence.get(row.sequenceNumber) ?? 0,
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
