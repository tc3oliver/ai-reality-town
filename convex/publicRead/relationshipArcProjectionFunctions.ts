/**
 * Convex wiring for the public Story Arc projection (FR-I006). Gathers accepted events, arc
 * projections, recommended entries, episodes, public facts and consequence summaries; builds the
 * publication-safe projection; publishes it through the public read-model store. Zero canon
 * writes; public reads reuse getPublishedReadModel.
 *
 * It wired the per-pair Relationship projection too until ART-182 retired that publication — the
 * block below this file's imports says what went and why, and the module is named for both halves
 * only because the pure builders still share a file.
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { rowToAcceptedEvent } from '../canon/serialize';
import { parseArcProjectionFields } from '../story/projection';
import type { AcceptedEvent } from '../canon/model';
import {
  ARC_MODEL_KIND,
  RelationshipArcError,
  buildArcProjection,
  type ArcOutcome,
  type ArcSummary,
  type PublicFact,
} from './relationshipArcProjection';
import { readWithheldSceneLabels } from '../safety/effectiveSafetyLabels';
import { sceneEventRows, withheldEventIds } from './liveStateFunctions';
import { commitReadModelVersion } from './readModel';
import { writeStore } from './readModelFunctions';

type ClassificationMembership = { arcId: string; importance: number };

function publicFactsIn(event: AcceptedEvent): PublicFact[] {
  return event.stateChanges.flatMap((change, index) =>
    change.type === 'fact_created' && (change.visibility === 'public' || change.visibility === 'canon')
      ? [{ factId: `${event.eventId}:fact:${index}`, predicate: change.predicate, value: change.value, sourceEventId: event.eventId }]
      : [],
  );
}

/**
 * `rebuildRelationshipProjection` lived here until ART-182, and it is deleted rather than left
 * unused.
 *
 * It published one read model per character PAIR — `relationship:<pairKey>` — on every relationship
 * change, and nothing read it. Both consumers that shipped say so in their own source:
 * `relationshipGraphProjection.ts` builds the FR-I007 graph from Canon, because no published model
 * enumerated the pairs for a client to discover; `src/components/public/characterRoute.ts` reads
 * that graph rather than these models. So this was not a surface waiting for its consumer — two
 * arrived and each reasoned its way past it.
 *
 * The PRD does not ask for it. FR-I006, the clause this module's header cites, is the Story Arc
 * page and lists no relationship field at all. The relationship clauses are FR-I005 (「主要關係」 on
 * the character page) and FR-I007 (the scoped graph), and §13.3 defines Relationship as a
 * product-layer ENTITY, under a section that leaves the database schema to technical design.
 *
 * What went with it: one `commitReadModelVersion` — a content hash, a version allocation, a row and
 * a demoted predecessor — per moved pair per accepted event, on the per-event path CLAUDE.md §9
 * warns about; and an `anonymous` public surface nobody audited because nobody read it, through
 * which any visitor who could guess a `pairKey` could fetch any pair, with none of the scoping
 * FR-I007 puts on the graph that serves the same data.
 *
 * What did NOT go with it: `accumulatePublicRelationshipDimensions` and `RELATIONSHIP_DIMENSIONS`,
 * which the graph builder reuses, and PRD §12 stage 14 「Update Relationships」, which is still a
 * stage of the post-commit pipeline — the state update it names is the deterministic reducer's
 * (`convex/canon/reducer.ts`), replayed at stage 11, and was never this publication.
 */

/** Rebuild and publish a Story Arc projection (AC#2/#3). */
export const rebuildArcProjection = internalMutation({
  args: { worldId: v.string(), arcId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || args.arcId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new RelationshipArcError('ARC_INVALID', 'worldId, arcId, and a finite now are required');
    }
    const [lifecycleRow, projectionRows, entryRow, episodeRows, consequenceRows, classificationRows,
      withheldSceneLabels] = await Promise.all([
      ctx.db.query('storyArcLifecycles').withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId)).unique(),
      ctx.db.query('storyArcProjectionEvents').withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId)).collect(),
      ctx.db.query('storyArcRecommendedEntries').withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId)).unique(),
      ctx.db.query('dailyEpisodes').withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('arcConsequenceSummaries').withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId)).collect(),
      ctx.db.query('storyArcEventClassifications').withIndex('by_world', (q) => q.eq('worldId', args.worldId)).collect(),
      // The inverted, history-independent question (ART-132). See `effectiveSafetyLabels.ts`.
      readWithheldSceneLabels(ctx.db, args.worldId),
    ]);
    if (!lifecycleRow) throw new RelationshipArcError('ARC_NOT_FOUND', 'arc has no lifecycle');
    const latestProjection = [...projectionRows].sort((a, b) => b.revision - a.revision)[0];
    if (!latestProjection) throw new RelationshipArcError('ARC_NOT_INITIALIZED', 'arc has no projection');
    const fields = parseArcProjectionFields(latestProjection.fields);
    const arcSummary: ArcSummary = {
      arcId: args.arcId, title: fields.title, premise: fields.premise, currentQuestion: fields.currentQuestion,
      status: lifecycleRow.status, coreCharacterIds: fields.coreCharacterIds, incitingEventId: fields.incitingEventId,
      latestTurningPointEventId: fields.latestTurningPointEventId, unresolvedQuestions: fields.unresolvedQuestions,
    };

    const recommendedEntry = entryRow?.entry && typeof entryRow.entry === 'object'
      ? { episodeNumber: (entryRow.entry as { episodeNumber: number }).episodeNumber, worldDay: (entryRow.entry as { worldDay: number }).worldDay }
      : null;
    const relatedEpisodes = episodeRows
      .filter((row) => (row.episode as { arcIds?: string[] } | undefined)?.arcIds?.includes(args.arcId))
      .map((row) => ({ episodeNumber: row.episodeNumber, worldDay: row.worldDay }));

    const arcSourceSequences = new Set(
      classificationRows
        .filter((row) => (row.memberships as ClassificationMembership[] | undefined)?.some((membership) => membership.arcId === args.arcId))
        .map((row) => row.sourceEventSequenceNumber),
    );
    // `arcSourceSequences` is the exact, already-known set of sequence numbers this arc's events
    // live at, so each is a point lookup on `worldId + sequenceNumber` rather than a scan of the
    // world's whole event log. `by_world_and_sequence` bound only on `worldId` (the prior read)
    // walked every accepted event in the world to keep the handful that matched.
    const canonRows = (await Promise.all(
      [...arcSourceSequences].map((sequenceNumber) =>
        ctx.db.query('canonEvents')
          .withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId).eq('sequenceNumber', sequenceNumber))
          .unique()),
    )).filter((row): row is NonNullable<typeof row> => row !== null);
    // Sorted explicitly: the point lookups above resolve in `Promise.all` order (Set iteration
    // order), not accepted order, and `facts`/`sourceEventIds` below are sequence-ordered.
    const arcEvents = canonRows
      .map(rowToAcceptedEvent)
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber);
    /**
     * The safety gate this rebuild did not have (ART-176).
     *
     * `knownClues` and `essentialBackstory` are LLM-authored `predicate`/`value` pairs from
     * `fact_created` changes — exactly the changes `characterSourceFrom` skips for a withheld
     * Scene (`worldCharacterProjectionFunctions.ts`). Two public surfaces were disagreeing about
     * whether a fact from a refused Scene is showable, and this was the permissive one.
     *
     * An event with no Scene provenance is not withheld, which is ART-132's stated convention.
     */
    const withheldEvents = withheldEventIds(
      sceneEventRows(arcEvents), new Set(Object.keys(withheldSceneLabels)));
    const facts: PublicFact[] = arcEvents
      .filter((event) => !withheldEvents.has(event.eventId))
      .flatMap(publicFactsIn);

    const outcomeEntries = consequenceRows
      .filter((row) => row.scope === 'world')
      .sort((a, b) => b.revision - a.revision);
    const outcome: ArcOutcome | null = outcomeEntries.length > 0
      ? { summary: outcomeEntries[0].outcome, sourceEventIds: outcomeEntries[0].sourceEventIds }
      : null;

    const payload = buildArcProjection({
      worldId: args.worldId, arc: arcSummary,
      essentialBackstory: facts, recommendedEntry, relatedEpisodes, knownClues: facts, outcome,
    });
    const result = await commitReadModelVersion(writeStore(ctx.db), {
      worldId: args.worldId, modelKind: ARC_MODEL_KIND, modelRef: `arc:${args.arcId}`,
      payload, sourceEventIds: arcEvents.slice(-20).map((event) => event.eventId), status: 'published', now: args.now,
    });
    return { modelRef: `arc:${args.arcId}`, version: result.version, deduplicated: result.deduplicated };
  },
});
