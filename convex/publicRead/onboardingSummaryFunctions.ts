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
import { rowToAcceptedEvent } from '../canon/serialize';
import { buildOnboardingSummary, type OnboardingCharacter, type OnboardingFact } from './onboardingSummary';
import { commitReadModelVersion } from './readModel';
import { writeStore } from './readModelFunctions';

type ClassificationMembership = { arcId: string; importance: number };

/** Rebuild and cache the onboarding summary (AC#3/#4). */
export const rebuildOnboardingSummary = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isFinite(args.now)) throw new Error('ONBOARDING_INVALID');
    const [canonRows, classificationRows, portfolioRows, entryRows, episodeRows] = await Promise.all([
      ctx.db.query('canonEvents').withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('storyArcEventClassifications').withIndex('by_world', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('storyArcPortfolioEntries').withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('storyArcRecommendedEntries').withIndex('by_world', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('dailyEpisodes').withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId)).collect(),
    ]);

    const events = canonRows.map(rowToAcceptedEvent);
    const importanceBySequence = new Map<number, number>();
    for (const row of classificationRows) {
      const memberships = row.memberships as ClassificationMembership[] | undefined;
      if (Array.isArray(memberships)) {
        importanceBySequence.set(row.sourceEventSequenceNumber,
          memberships.reduce((max, membership) => Math.max(max, membership.importance), 0));
      }
    }

    // Major event: the most recent event that carries a public summary.
    const majorEventRow = [...canonRows].reverse().find((row) => {
      const event = rowToAcceptedEvent(row);
      return event.publicSummary && event.publicSummary.trim().length > 0;
    });
    const majorEvent = majorEventRow ? (() => {
      const event = rowToAcceptedEvent(majorEventRow);
      return { eventId: event.eventId, publicSummary: event.publicSummary as string };
    })() : null;
    const majorImportance = majorEventRow ? (importanceBySequence.get(majorEventRow.sequenceNumber) ?? 0) : 0;

    const characters: OnboardingCharacter[] = [];
    if (majorEventRow) {
      const event = rowToAcceptedEvent(majorEventRow);
      for (const participantId of event.participantIds) {
        if (characters.length >= 4) break;
        characters.push({ characterId: participantId, name: participantId });
      }
    }

    const facts: OnboardingFact[] = [];
    for (const event of [...events].reverse()) {
      event.stateChanges.forEach((change, index) => {
        if (facts.length >= 3) return;
        if (change.type === 'fact_created' && (change.visibility === 'public' || change.visibility === 'canon')
          && (change.subjectType === 'world' || change.subjectType === 'character')) {
          facts.push({ factId: `${event.eventId}:fact:${index}`, predicate: change.predicate, value: change.value });
        }
      });
      if (facts.length >= 3) break;
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
    const latestEpisodeData = latestEpisode?.episode as { keyScenes?: Array<{ title: string; summary: string }> } | undefined;
    const firstScene = latestEpisodeData?.keyScenes?.[0];
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
