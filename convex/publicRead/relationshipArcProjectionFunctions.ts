/**
 * Convex wiring for the public Relationship and Story Arc projections (PRD
 * §13.3, FR-I006). Independent rebuild entry points: gather accepted events,
 * arc projections, recommended entries, episodes, public facts, and consequence
 * summaries; build publication-safe projections; publish via the public
 * read-model store. Zero canon writes; public reads reuse getPublishedReadModel.
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { rowToAcceptedEvent } from '../canon/serialize';
import { parseArcProjectionFields } from '../story/projection';
import type { AcceptedEvent } from '../canon/model';
import {
  ARC_MODEL_KIND,
  RELATIONSHIP_MODEL_KIND,
  RelationshipArcError,
  accumulatePublicRelationshipDimensions,
  buildArcProjection,
  buildRelationshipProjection,
  type ArcOutcome,
  type ArcSummary,
  type PublicFact,
  type RelationshipChange,
  type RelationshipDeltaInput,
} from './relationshipArcProjection';
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

/** Rebuild and publish a Relationship projection (AC#1/#3). */
export const rebuildRelationshipProjection = internalMutation({
  args: { worldId: v.string(), sourceCharacterId: v.string(), targetCharacterId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || args.sourceCharacterId.trim().length === 0
        || args.targetCharacterId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new RelationshipArcError('RELATIONSHIP_INVALID', 'worldId, both character ids, and a finite now are required');
    }
    const rows = await ctx.db.query('canonEvents').withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId)).collect();
    const events = rows.map(rowToAcceptedEvent);
    const isPair = (source: string, target: string) =>
      (source === args.sourceCharacterId && target === args.targetCharacterId)
      || (source === args.targetCharacterId && target === args.sourceCharacterId);

    /**
     * The pair's identity and the id of the event that last moved it. NOT its dimensions.
     *
     * ART-95: this record used to carry the six dimensions too, assigned from the current
     * event's DELTAS on every iteration, so the published levels were whatever the last change
     * happened to be worth. The levels are now folded across the whole public history by
     * `accumulatePublicRelationshipDimensions`, and this holds only the two things that
     * genuinely are "the latest": which way round the pair was named, and which event it was.
     */
    let latest: { source: string; target: string; lastUpdatedEventId: string } | null = null;
    const history: RelationshipChange[] = [];
    /**
     * All six deltas, alongside the three-delta published history.
     *
     * A separate list rather than a widened `RelationshipChange`: the accumulation needs every
     * dimension, and the published payload's shape is deliberately untouched by this fix — see
     * the type's docblock. Both are appended in the same iteration, so they cannot fall out of
     * step with each other.
     */
    const deltas: RelationshipDeltaInput[] = [];
    for (const event of events) {
      for (const change of event.stateChanges) {
        if (change.type === 'relationship_changed' && isPair(change.sourceCharacterId, change.targetCharacterId)) {
          if (change.visibility === 'public') {
            history.push({
              eventId: event.eventId, reason: change.reason,
              trustDelta: change.trustDelta, affectionDelta: change.affectionDelta, resentmentDelta: change.resentmentDelta,
            });
            deltas.push({
              trustDelta: change.trustDelta,
              affectionDelta: change.affectionDelta,
              resentmentDelta: change.resentmentDelta,
              fearDelta: change.fearDelta ?? 0,
              dependencyDelta: change.dependencyDelta ?? 0,
              familiarityDelta: change.familiarityDelta ?? 0,
            });
            latest = {
              source: change.sourceCharacterId, target: change.targetCharacterId,
              lastUpdatedEventId: event.eventId,
            };
          }
        }
      }
    }
    if (!latest) throw new RelationshipArcError('RELATIONSHIP_NOT_FOUND', 'no public relationship between this pair');
    // Levels, folded over every public change in order. `events` is read on
    // `by_world_and_sequence`, so "in order" is Canon's own accepted order rather than an
    // assumption about how the rows came back.
    const dimensions = accumulatePublicRelationshipDimensions(deltas);
    const payload = buildRelationshipProjection({
      worldId: args.worldId,
      sourceCharacterId: latest.source, targetCharacterId: latest.target,
      ...dimensions,
      visibility: 'public', lastUpdatedEventId: latest.lastUpdatedEventId, changeHistory: history,
    });
    const result = await commitReadModelVersion(writeStore(ctx.db), {
      worldId: args.worldId, modelKind: RELATIONSHIP_MODEL_KIND,
      modelRef: `relationship:${payload.pairKey}`, payload, sourceEventIds: history.map((change) => change.eventId),
      status: 'published', now: args.now,
    });
    return { modelRef: `relationship:${payload.pairKey}`, version: result.version, deduplicated: result.deduplicated };
  },
});

/** Rebuild and publish a Story Arc projection (AC#2/#3). */
export const rebuildArcProjection = internalMutation({
  args: { worldId: v.string(), arcId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || args.arcId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new RelationshipArcError('ARC_INVALID', 'worldId, arcId, and a finite now are required');
    }
    const [lifecycleRow, projectionRows, entryRow, episodeRows, consequenceRows, classificationRows, canonRows] = await Promise.all([
      ctx.db.query('storyArcLifecycles').withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId)).unique(),
      ctx.db.query('storyArcProjectionEvents').withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId)).collect(),
      ctx.db.query('storyArcRecommendedEntries').withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId)).unique(),
      ctx.db.query('dailyEpisodes').withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('arcConsequenceSummaries').withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId)).collect(),
      ctx.db.query('storyArcEventClassifications').withIndex('by_world', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('canonEvents').withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId)).collect(),
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
    const arcEvents = canonRows.filter((row) => arcSourceSequences.has(row.sequenceNumber)).map(rowToAcceptedEvent);
    const facts: PublicFact[] = arcEvents.flatMap(publicFactsIn);

    const outcomeEntries = consequenceRows
      .filter((row) => row.scope === 'world')
      .sort((a, b) => b.revision - a.revision);
    const outcome: ArcOutcome | null = outcomeEntries.length > 0
      ? { summary: outcomeEntries[0].outcome, sourceEventIds: outcomeEntries[0].sourceEventIds }
      : null;

    const payload = buildArcProjection({
      worldId: args.worldId, arc: arcSummary,
      essentialBackstory: facts.slice(0, 5), recommendedEntry, relatedEpisodes, knownClues: facts, outcome,
    });
    const result = await commitReadModelVersion(writeStore(ctx.db), {
      worldId: args.worldId, modelKind: ARC_MODEL_KIND, modelRef: `arc:${args.arcId}`,
      payload, sourceEventIds: arcEvents.slice(-20).map((event) => event.eventId), status: 'published', now: args.now,
    });
    return { modelRef: `arc:${args.arcId}`, version: result.version, deduplicated: result.deduplicated };
  },
});
