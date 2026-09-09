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
import { rowToAcceptedEvent, type CanonEventRow } from '../canon/serialize';
import { readWithheldSceneLabels } from '../safety/effectiveSafetyLabels';
import { readWithheldPublicationWorldDays } from './withheldPublicationDays';
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
 * The hard ceiling on how many accepted events one rebuild may scan backwards (ART-100 AC#1).
 *
 * Exported so a test can pin the behaviour at the boundary rather than restating the number. See
 * the tail-paging loop in {@link rebuildOnboardingSummary} for why a ceiling exists at all and
 * what is given up by having one.
 */
export const MAX_SCANNED_EVENTS = 200;

/**
 * How many of the newest daily-episode rows are examined when looking for the one to quote.
 *
 * A world narrates roughly one episode a day, so the newest row is normally the answer and this
 * is slack for a run of days whose narration was withheld or failed. Exported so a test can pin
 * the boundary rather than restate the number.
 */
export const MAX_EPISODE_SCAN = 8;

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
    const [classificationRows, portfolioRows, entryRows, episodeRows, withheldSceneRecord,
      withheldPublicationDays] = await Promise.all([
      ctx.db.query('storyArcEventClassifications').withIndex('by_world', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('storyArcPortfolioEntries').withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('storyArcRecommendedEntries').withIndex('by_world', (q) => q.eq('worldId', args.worldId)).collect(),
      /**
       * The newest days' episode rows, not the world's (ART-100 AC#1).
       *
       * `latestEpisode` below is the ONLY thing read off these — the newest row that carries an
       * episode body — so sweeping every day the world has ever had was reading O(days) rows to
       * use one. A descending page answers it directly.
       *
       * The page is bounded rather than "scan until one is found", and reaching the bound is
       * reported (`latestEpisodeScanExhausted`) rather than silently becoming "no episode": a
       * world whose last {@link MAX_EPISODE_SCAN} days all failed narration is a fact about the
       * world, not a routine truncation.
       */
      ctx.db.query('dailyEpisodes').withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId))
        .order('desc').take(MAX_EPISODE_SCAN),
      // The inverted, history-independent question. See `effectiveSafetyLabels.ts` on why a
      // rebuild must never ask this Scene by Scene.
      readWithheldSceneLabels(ctx.db, args.worldId),
      /**
       * The SECOND gate, and this summary had only the first (ART-176).
       *
       * `redactWithheldNarration` below answers the SAFETY question — did a classifier or an
       * operator refuse this Scene's text. It cannot answer the EDITORIAL one: FR-K004's
       * publication record is what decides whether a day's story has been released, an
       * administrator moves it independently (reachable since ART-171), and a publication
       * withhold leaves `dailyEpisodes.status` at `ready` with the body intact.
       *
       * Without this the regression was live and immediate: `decideEpisodePublication` calls
       * `refreshPublicTextModels`, which calls THIS rebuild — so withholding a day withdrew
       * `episode:<day>` and republished that same Episode's narration onto the homepage and the
       * ART-125 story overlay in the same transaction.
       */
      readWithheldPublicationWorldDays(ctx.db, args.worldId),
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
     * everything it needs never reads past that page. A world that doesn't asks for the NEXT
     * page instead — `.lt('sequenceNumber', lowestSeenSoFar)` — rather than re-taking the same
     * tail at double the size, so every row is read at most once and accumulates across
     * iterations. Total reads across the whole loop are therefore bounded by the log size N,
     * with equality only in the pathological case where the loop pages all the way to
     * exhaustion without ever satisfying both consumers — never the `Σ min(pageSize·2ⁱ, N)`
     * over-read a re-take from the tail would produce, and never worse than the old
     * unconditional collect's N.
     *
     * ## Why the scan is also capped (ART-100 AC#1)
     *
     * "Bounded by N" is still O(N), and that pathological case is REACHABLE, not theoretical: the
     * fact harvest wants three `fact_created` changes, and a world that has only ever produced two
     * pages to exhaustion on EVERY accepted event, forever. That is precisely the read-cost shape
     * this task exists to remove, and it sits on the post-commit transaction's byte budget.
     *
     * {@link MAX_SCANNED_EVENTS} caps it. The cost of the cap is a real, deliberate behaviour
     * change: past it, this summary reports the major event and facts it found in the recent tail
     * rather than the ones that exist arbitrarily deep in history. That is defensible for THIS
     * payload specifically — it is the "current situation" onboarding summary (PRD §13, FR-H001),
     * whose whole purpose is to describe where the world is now. A fact 400 events ago is not a
     * worse answer to that question, it is an answer to a different one. It would NOT be
     * defensible for a projection that claims completeness over history, and this cap must not be
     * copied into one.
     *
     * The cap is set far above where a healthy world settles (a simulated event carries a
     * `publicSummary`, so the major-event pick resolves on page one) so that reaching it is a
     * signal about the world, not a routine truncation.
     */
    const START_WINDOW = 25;
    let pageSize = START_WINDOW;
    let majorEventSource: AcceptedEvent | null = null;
    let majorImportance = 0;
    let facts: OnboardingFact[] = [];
    const rowsDescSoFar: CanonEventRow[] = [];
    let lowestSequenceSeen: number | undefined;
    for (;;) {
      const cursor = lowestSequenceSeen;
      const pageQuery = cursor === undefined
        ? ctx.db.query('canonEvents').withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId))
        : ctx.db.query('canonEvents')
          .withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId).lt('sequenceNumber', cursor));
      // Never read past the cap, even mid-page: `take` is where the rows are actually charged.
      const budget = Math.min(pageSize, MAX_SCANNED_EVENTS - rowsDescSoFar.length);
      const pageRowsDesc = await pageQuery.order('desc').take(budget);
      const exhausted = pageRowsDesc.length < budget;
      if (pageRowsDesc.length > 0) {
        lowestSequenceSeen = pageRowsDesc[pageRowsDesc.length - 1].sequenceNumber;
      }
      rowsDescSoFar.push(...pageRowsDesc);
      const acceptedEvents = [...rowsDescSoFar].reverse().map(rowToAcceptedEvent);
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
      if (rowsDescSoFar.length >= MAX_SCANNED_EVENTS) break;
      pageSize *= 2;
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

    // `episodeRows` arrives newest-first off the index, so the first row with a body IS the
    // newest one — the sort the old whole-table read needed is now the index's job.
    const latestEpisode = episodeRows.find((row) => row.episode && !withheldPublicationDays.has(row.worldDay));
    const latestEpisodeScanExhausted =
      latestEpisode === undefined && episodeRows.length === MAX_EPISODE_SCAN;
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
    return {
      modelRef: `onboarding:${args.worldId}`,
      version: result.version,
      deduplicated: result.deduplicated,
      // Reported, not swallowed: "no narrated episode exists" and "gave up looking" are different
      // facts about the world, and only one of them is a defect. See MAX_EPISODE_SCAN.
      latestEpisodeScanExhausted,
    };
  },
});
