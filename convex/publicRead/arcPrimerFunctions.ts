/**
 * Convex wiring for the three-minute active-arc primer (FR-H002, ART-38).
 *
 * Independent rebuild entry point: gathers the arc projection fields, the
 * turning-point event's public summary, core-character names, and the arc's
 * recommended entry; composes the bounded primer (pure); and caches it via the
 * public read-model store (modelKind `arc`, modelRef `primer:<arcId>`).
 * Per-visitor reads use the generic getPublishedReadModel and never trigger
 * generation. Zero canon writes. Like the sibling projection writers, it is an
 * internal mutation invoked by the projection rebuild trigger, never by visitors.
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { rowToAcceptedEvent } from '../canon/serialize';
import { parseArcProjectionFields } from '../story/projection';
import { commitReadModelVersion } from './readModel';
import { writeStore } from './readModelFunctions';
import { ArcPrimerError, buildArcPrimer, type PrimerCharacter } from './arcPrimer';

/**
 * Rebuild and publish the active-arc primer. Idempotent: unchanged inputs
 * re-derive an identical payload and deduplicate.
 */
export const rebuildArcPrimer = internalMutation({
  args: { worldId: v.string(), arcId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || args.arcId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new ArcPrimerError('ARC_PRIMER_INVALID', 'worldId, arcId, and a finite now are required');
    }

    const [lifecycleRow, projectionRows, entryRow, canonRows] = await Promise.all([
      ctx.db.query('storyArcLifecycles').withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId)).unique(),
      ctx.db.query('storyArcProjectionEvents').withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId)).collect(),
      ctx.db.query('storyArcRecommendedEntries').withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId)).unique(),
      ctx.db.query('canonEvents').withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId)).collect(),
    ]);
    if (!lifecycleRow) throw new ArcPrimerError('ARC_PRIMER_NOT_FOUND', 'arc has no lifecycle');
    const latestProjection = [...projectionRows].sort((a, b) => b.revision - a.revision)[0];
    if (!latestProjection) throw new ArcPrimerError('ARC_PRIMER_NOT_INITIALIZED', 'arc has no projection');
    const fields = parseArcProjectionFields(latestProjection.fields);

    const events = canonRows.map(rowToAcceptedEvent);

    // Turning point: the public summary of the arc's latest turning-point event.
    const turningPoint = fields.latestTurningPointEventId
      ? (() => {
          const event = events.find((candidate) => candidate.eventId === fields.latestTurningPointEventId);
          return event?.publicSummary && event.publicSummary.trim().length > 0
            ? { eventId: event.eventId, summary: event.publicSummary }
            : null;
        })()
      : null;

    // Core-character names from public character facts (fallback to id; role unknown).
    const nameById = new Map<string, string>();
    for (const event of events) {
      for (const change of event.stateChanges) {
        if (change.type === 'fact_created' && change.subjectType === 'character'
          && (change.visibility === 'public' || change.visibility === 'canon')
          && change.predicate === 'name' && typeof change.value === 'string') {
          nameById.set(change.subjectId, change.value);
        }
      }
    }
    const characters: PrimerCharacter[] = fields.coreCharacterIds.map((characterId) => ({
      characterId: characterId,
      name: nameById.get(characterId) ?? characterId,
      role: null,
    }));

    const recommendedEntry = entryRow?.entry && typeof entryRow.entry === 'object'
      ? { episodeNumber: (entryRow.entry as { episodeNumber: number }).episodeNumber, worldDay: (entryRow.entry as { worldDay: number }).worldDay }
      : null;

    const payload = buildArcPrimer({
      worldId: args.worldId, arcId: args.arcId, title: fields.title,
      cause: fields.premise, turningPoint, characters,
      unresolvedQuestions: fields.unresolvedQuestions, currentQuestion: fields.currentQuestion,
      recommendedEntry,
    });
    const sourceEventIds = [fields.incitingEventId, fields.latestTurningPointEventId].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    const result = await commitReadModelVersion(writeStore(ctx.db), {
      worldId: args.worldId, modelKind: 'arc', modelRef: `primer:${args.arcId}`,
      payload, sourceEventIds, status: 'published', now: args.now,
    });
    return { modelRef: `primer:${args.arcId}`, version: result.version, deduplicated: result.deduplicated };
  },
});
