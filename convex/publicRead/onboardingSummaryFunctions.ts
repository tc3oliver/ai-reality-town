/**
 * Convex wiring for the cached onboarding summary (FR-H001). Independent rebuild
 * entry point: gathers accepted events, arc portfolio + recommended entry, and
 * the latest published episode; composes the bounded ~300-中文字 summary; and
 * caches it via the public read-model store (modelKind `world`, modelRef
 * `onboarding:<worldId>`). Per-visitor reads use the generic
 * getPublishedReadModel and never trigger generation (AC#4/#5). The rebuild
 * refreshes after major mainline changes (AC#3). Zero canon writes.
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import type { AcceptedEvent } from '../canon/model';
import { rowToAcceptedEvent } from '../canon/serialize';
import { readWithheldSceneLabels } from '../safety/effectiveSafetyLabels';
import { deriveEventId } from '../shared/ids';
import {
  redactWithheldNarration,
  redactWithheldSummaries,
  sceneEventRows,
  withheldEventIds,
} from './liveStateFunctions';
import { buildOnboardingSummary, type OnboardingCharacter, type OnboardingFact } from './onboardingSummary';
import { commitReadModelVersion } from './readModel';
import { writeStore } from './readModelFunctions';

type ClassificationMembership = { arcId: string; importance: number };

/** A published key scene, as this rebuild reads one. `sourceEventIds` is what the gate keys on. */
type EpisodeKeyScene = { title: string; summary: string; sourceEventIds: string[] };

/**
 * Rebuild and cache the onboarding summary (AC#3/#4).
 *
 * SAFETY GATE (FR-P004 / ART-132, extended by ART-125). This is a public TEXT surface and it had
 * no gate at all — the third instance of the same gap in this epic, after `liveState` (ART-132
 * itself) and the Timeline projection (ART-124). It reads `publicSummary` straight off
 * `canonEvents` and the day's narration straight off `dailyEpisodes.keyScenes`, and BOTH land in
 * `summaryText`, which ART-125 now renders on the live map's story overlay. So a Scene an
 * operator had withheld went on introducing the world with its own refused sentence, to every
 * first-time visitor, on the homepage and the map alike.
 *
 * Closed with ART-132's own machinery rather than a second copy of it: the bounded
 * `readWithheldSceneLabels` sweep, then `sceneEventRows` + `withheldEventIds` +
 * `redactWithheldSummaries` + `redactWithheldNarration` — the exact functions
 * `rebuildLiveProjection` uses, imported rather than re-implemented, so the surfaces cannot come
 * to disagree about which events are refused.
 *
 * Unlike the Timeline, which KEEPS a refused entry and nulls its text, this surface SKIPS a
 * refused event and picks the next candidate. The difference is what each model is: the Timeline
 * is a public history, where dropping a row silently renumbers it, while this is a "here is one
 * event worth knowing about" pick with no positions and no addressing. A summary that led with
 * `(無摘要)` would be strictly worse than one that led with the best showable event.
 */
export const rebuildOnboardingSummary = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isFinite(args.now)) throw new Error('ONBOARDING_INVALID');
    const [classificationRows, portfolioRows, entryRows, episodeRows, withheldSceneRecord] = await Promise.all([
      ctx.db.query('storyArcEventClassifications').withIndex('by_world', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('storyArcPortfolioEntries').withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('storyArcRecommendedEntries').withIndex('by_world', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('dailyEpisodes').withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId)).collect(),
      // The inverted, history-independent question. See `effectiveSafetyLabels.ts` on why a
      // rebuild must never ask this Scene by Scene.
      readWithheldSceneLabels(ctx.db, args.worldId),
    ]);
    const withheldSceneMap = new Map(Object.entries(withheldSceneRecord));
    const importanceBySequence = new Map<number, number>();
    for (const row of classificationRows) {
      const memberships = row.memberships as ClassificationMembership[] | undefined;
      if (Array.isArray(memberships)) {
        importanceBySequence.set(row.sourceEventSequenceNumber,
          memberships.reduce((max, membership) => Math.max(max, membership.importance), 0));
      }
    }

    /**
     * Both consumers below only ever look at the TAIL of Canon: the major-event pick is
     * `[...events].reverse().find(...)`, and the fact harvest is a reverse loop that `break`s
     * once it has 3. Neither folds over the whole log, so `canonEvents` no longer needs to be
     * `by_world_and_sequence` bound on `worldId` alone (a full-log read) — the tail is paged in
     * with `.order('desc')` and the window only grows until BOTH consumers are satisfied or
     * Canon is exhausted.
     *
     * The two consumers can need different depths — a world can run out of qualifying facts long
     * before (or long after) it finds a showable major event — so the loop keeps growing until
     * BOTH are settled rather than assuming one bounded window serves both. `START_WINDOW` is a
     * paging chunk size, not a correctness bound: a world whose last N events give the loop
     * everything it needs never reads past that page, and one that doesn't just doubles the
     * window and tries again, so the worst case (nothing ever satisfies both) still reads the
     * whole log once, at ~2x cost, exactly as the old unconditional collect always did.
     */
    const START_WINDOW = 25;
    let windowSize = START_WINDOW;
    let majorEventSource: AcceptedEvent | null = null;
    let majorImportance = 0;
    let facts: OnboardingFact[] = [];
    for (;;) {
      const rowsDesc = await ctx.db.query('canonEvents')
        .withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId))
        .order('desc')
        .take(windowSize);
      const exhausted = rowsDesc.length < windowSize;
      const acceptedEvents = [...rowsDesc].reverse().map(rowToAcceptedEvent);
      // Keyed on the EVENT ID, never on a position in a parallel array — the reason
      // `withheldEventIds` returns ids at all.
      const withheldEvents = withheldEventIds(sceneEventRows(acceptedEvents), withheldSceneMap);
      // Every read of a public summary below goes through this array, so a refused sentence has
      // no route into the payload even if a later edit adds another consumer.
      const events = redactWithheldSummaries(acceptedEvents, withheldEvents);

      // Major event: the most recent event that carries a public summary. Read off the REDACTED
      // array, so a withheld event carries none and the search simply continues to the next
      // showable one rather than leading the world's introduction with refused text.
      const majorEventCandidate = [...events].reverse().find(
        (event) => event.publicSummary && event.publicSummary.trim().length > 0,
      );
      majorEventSource = majorEventCandidate ?? null;
      majorImportance = majorEventSource
        ? (importanceBySequence.get(majorEventSource.sequenceNumber) ?? 0)
        : 0;

      facts = [];
      for (const event of [...events].reverse()) {
        // A fact's predicate and value are LLM-authored public text that ART-124 brought inside
        // the post-generation classifier's input for exactly this reason. `redactWithheldSummaries`
        // only drops `publicSummary`, so the skip is explicit here.
        if (withheldEvents.has(event.eventId)) continue;
        event.stateChanges.forEach((change, index) => {
          if (facts.length >= 3) return;
          if (change.type === 'fact_created' && (change.visibility === 'public' || change.visibility === 'canon')
            && (change.subjectType === 'world' || change.subjectType === 'character')) {
            facts.push({ factId: `${event.eventId}:fact:${index}`, predicate: change.predicate, value: change.value });
          }
        });
        if (facts.length >= 3) break;
      }

      if (exhausted || (majorEventSource !== null && facts.length >= 3)) break;
      windowSize *= 2;
    }

    const majorEvent = majorEventSource
      ? { eventId: majorEventSource.eventId, publicSummary: majorEventSource.publicSummary as string }
      : null;

    const characters: OnboardingCharacter[] = [];
    if (majorEventSource) {
      for (const participantId of majorEventSource.participantIds) {
        if (characters.length >= 4) break;
        characters.push({ characterId: participantId, name: participantId });
      }
    }

    // An active major arc question + its recommended entry episode.
    const activeMajorArc = portfolioRows
      .map((row) => ({ arcId: row.arcId, entry: row.entry as { tier?: string; projection?: { status?: string; currentQuestion?: string } } }))
      .find((candidate) => candidate.entry?.tier === 'major'
        && ['active', 'escalating', 'climax', 'resolving'].includes(candidate.entry?.projection?.status ?? ''));
    const question = activeMajorArc?.entry?.projection?.currentQuestion ?? null;
    const recommendedEntryRow = activeMajorArc
      ? entryRows.find((row) => row.arcId === activeMajorArc.arcId)
      : undefined;
    const recommendedEpisode = recommendedEntryRow?.entry && typeof recommendedEntryRow.entry === 'object'
      ? { episodeNumber: (recommendedEntryRow.entry as { episodeNumber: number }).episodeNumber, worldDay: (recommendedEntryRow.entry as { worldDay: number }).worldDay }
      : null;

    const latestEpisode = [...episodeRows]
      .filter((row) => row.episode)
      .sort((a, b) => b.worldDay - a.worldDay)[0];
    const latestEpisodeData = latestEpisode?.episode as { keyScenes?: EpisodeKeyScene[] } | undefined;
    const rawKeyScenes = (latestEpisodeData?.keyScenes ?? []).map((scene) => ({
      title: scene.title ?? '',
      summary: scene.summary ?? '',
      sourceEventIds: scene.sourceEventIds ?? [],
    }));
    /**
     * A key scene can narrate an event OLDER than the tail window above resolved (the window
     * only grows until the major-event pick and the fact harvest are settled, and a day's key
     * scenes are not bounded by either of those). So `withheldEvents` from the loop cannot be
     * reused here without risking a false "not withheld" for a source event outside that window.
     * Each `sourceEventId` a key scene actually names is already a known, bounded reference —
     * the same "look up exactly what you're about to check" shape as the arc/portfolio
     * reference validators — so this is point lookups on `worldId + sequenceNumber`, never a
     * second full-log read.
     */
    const keySceneEventIds = [...new Set(rawKeyScenes.flatMap((scene) => scene.sourceEventIds))];
    const keySceneCanonRows = (await Promise.all(
      keySceneEventIds.map(async (eventId) => {
        const sequenceNumber = Number(eventId.split('#').at(-1));
        if (!Number.isSafeInteger(sequenceNumber)) return null;
        const row = await ctx.db.query('canonEvents')
          .withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId).eq('sequenceNumber', sequenceNumber))
          .unique();
        return row && deriveEventId(args.worldId, sequenceNumber) === eventId ? row : null;
      }),
    )).filter((row): row is NonNullable<typeof row> => row !== null);
    const keySceneWithheldEvents = withheldEventIds(
      sceneEventRows(keySceneCanonRows.map(rowToAcceptedEvent)),
      withheldSceneMap,
    );
    // The day's narration is gated alongside the events' own summaries, because a key scene
    // narrates SEVERAL events at once: dropping the contributing event's `publicSummary` while
    // publishing the paragraph that retells it would close nothing. `redactWithheldNarration`
    // neutralises such a scene to empty strings, so the search below skips it and falls through
    // to the next showable scene of the same episode.
    const keyScenes = redactWithheldNarration(rawKeyScenes, keySceneWithheldEvents);
    const firstScene = keyScenes.find((candidate) => candidate.summary.trim().length > 0);
    const scene = firstScene ? { title: firstScene.title, summary: firstScene.summary } : null;

    const payload = buildOnboardingSummary({
      worldId: args.worldId, majorEvent, importance: majorImportance, characters, facts,
      question, recommendedEpisode, scene,
    });
    const result = await commitReadModelVersion(writeStore(ctx.db), {
      worldId: args.worldId, modelKind: 'world', modelRef: `onboarding:${args.worldId}`,
      payload, sourceEventIds: majorEvent ? [majorEvent.eventId] : [], status: 'published', now: args.now,
    });
    return { modelRef: `onboarding:${args.worldId}`, version: result.version, deduplicated: result.deduplicated };
  },
});
