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
import type { GenericMutationCtx } from 'convex/server';
import { internalMutation } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import { rowToAcceptedEvent } from '../canon/serialize';
import { parseArcProjectionFields } from '../story/projection';
import { deriveEventId } from '../shared/ids';
import { readWithheldSceneLabels } from '../safety/effectiveSafetyLabels';
import { sceneEventRows, withheldEventIds } from './liveStateFunctions';
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
    return rebuildPrimerFor(ctx, args.worldId, args.arcId, args.now);
  },
});

/** The `modelRef` family this rebuild owns, inside the shared `arc` model kind. */
const PRIMER_MODEL_REF_PREFIX = 'primer:';

/** The rebuild itself, shared by both entry points so neither can drift from the other. */
async function rebuildPrimerFor(
  ctx: GenericMutationCtx<DataModel>,
  worldId: string,
  arcId: string,
  now: number,
): Promise<{ modelRef: string; version: number; deduplicated: boolean }> {

  const [lifecycleRow, projectionRows, entryRow, withheldSceneLabels] = await Promise.all([
    ctx.db.query('storyArcLifecycles').withIndex('by_world_and_arc', (q) => q.eq('worldId', worldId).eq('arcId', arcId)).unique(),
    ctx.db.query('storyArcProjectionEvents').withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', worldId).eq('arcId', arcId)).collect(),
    ctx.db.query('storyArcRecommendedEntries').withIndex('by_world_and_arc', (q) => q.eq('worldId', worldId).eq('arcId', arcId)).unique(),
    /**
     * The safety gate this rebuild did not have (ART-176). It publishes an accepted event's
     * `publicSummary` verbatim — it was the last unguarded consumer of that field under
     * `convex/publicRead/`, and nothing re-derived it after an override either, because it is
     * not on `publicTextModelRefresh.ts`'s list. A withheld Scene narrated itself here forever.
     */
    readWithheldSceneLabels(ctx.db, worldId),
  ]);
  if (!lifecycleRow) throw new ArcPrimerError('ARC_PRIMER_NOT_FOUND', 'arc has no lifecycle');
  const latestProjection = [...projectionRows].sort((a, b) => b.revision - a.revision)[0];
  if (!latestProjection) throw new ArcPrimerError('ARC_PRIMER_NOT_INITIALIZED', 'arc has no projection');
  const fields = parseArcProjectionFields(latestProjection.fields);

  /**
   * Exactly the events this primer names, as point lookups (ART-176).
   *
   * This used to `.collect()` the whole accepted-event log — `by_world_and_sequence` bound only
   * on `worldId` — on a per-commit path, which is the hazard CLAUDE.md §9 names outright. It
   * read every event in the world to use at most a handful. The turning point is a known id and
   * the core characters are a known list, so the sibling `rebuildArcProjection`'s shape applies:
   * look up exactly what you are about to read.
   *
   * The cost of the narrowing is stated rather than hidden: character NAMES are now resolved
   * only from the events this primer already reads, so a character whose `name` fact was
   * created by some other event falls back to their id — which is what the builder did for an
   * unnamed character all along.
   */
  const namedEventIds = [...new Set([fields.incitingEventId, fields.latestTurningPointEventId]
    .filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const canonRows = (await Promise.all(namedEventIds.map(async (eventId) => {
    const sequenceNumber = Number(eventId.split('#').at(-1));
    if (!Number.isSafeInteger(sequenceNumber)) return null;
    const row = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId).eq('sequenceNumber', sequenceNumber))
      .unique();
    // The id must round-trip: a malformed reference must not resolve to whatever event happens
    // to sit at the number it parsed to.
    return row && deriveEventId(worldId, sequenceNumber) === eventId ? row : null;
  }))).filter((row): row is NonNullable<typeof row> => row !== null);

  const events = canonRows.map(rowToAcceptedEvent);
  const withheldEvents = withheldEventIds(sceneEventRows(events), new Set(Object.keys(withheldSceneLabels)));

  // Turning point: the public summary of the arc's latest turning-point event, unless the
  // safety gate currently refuses the Scene that produced it. A refused summary yields `null`,
  // which is the same shape the builder already handles for an arc that has no turning point.
  const turningPoint = fields.latestTurningPointEventId
    ? (() => {
        const event = events.find((candidate) => candidate.eventId === fields.latestTurningPointEventId);
        if (!event || withheldEvents.has(event.eventId)) return null;
        return event.publicSummary && event.publicSummary.trim().length > 0
          ? { eventId: event.eventId, summary: event.publicSummary }
          : null;
      })()
    : null;

  // Core-character names from public character facts (fallback to id; role unknown). A refused
  // Scene's facts are skipped for the reason `characterSourceFrom` skips them: the biography a
  // withheld Scene wrote is withheld too.
  const nameById = new Map<string, string>();
  for (const event of events) {
    if (withheldEvents.has(event.eventId)) continue;
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
    worldId: worldId, arcId: arcId, title: fields.title,
    cause: fields.premise, turningPoint, characters,
    unresolvedQuestions: fields.unresolvedQuestions, currentQuestion: fields.currentQuestion,
    recommendedEntry,
  });
  const sourceEventIds = [fields.incitingEventId, fields.latestTurningPointEventId].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  const result = await commitReadModelVersion(writeStore(ctx.db), {
    worldId: worldId, modelKind: 'arc', modelRef: `primer:${arcId}`,
    payload, sourceEventIds, status: 'published', now: now,
  });
  return { modelRef: `primer:${arcId}`, version: result.version, deduplicated: result.deduplicated };
}

/**
 * Re-derive every arc primer this world has already published (ART-176).
 *
 * The safety-path entry point, and the reason the primer needed one: `rebuildArcPrimer` is called
 * only from the post-commit publication stage, and only for the arcs the committed event MOVED. An
 * arc that has stopped moving — a resolved one, or any arc on a paused world — is never rebuilt
 * again, so a Scene withheld after the fact would have gone on narrating itself there forever.
 *
 * The target set comes from the read-model STORE rather than from the arc lifecycle table, for the
 * reason `refreshVoteConsequenceProjections` derives its day set the same way: a primer that was
 * never published has nothing on the public surface to withdraw, and enumerating every arc in the
 * world would make an operator's withhold cost a rebuild per arc.
 */
export const refreshArcPrimers = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new ArcPrimerError('ARC_PRIMER_INVALID', 'worldId and a finite now are required');
    }
    const rows = await ctx.db.query('publishedReadModels')
      .withIndex('by_status', (q) => q
        .eq('worldId', args.worldId).eq('modelKind', 'arc').eq('status', 'published'))
      .collect();
    const arcIds = new Set<string>();
    for (const row of rows) {
      // The `arc` kind carries two model families — `arc:<id>` and `primer:<id>`. Only the second
      // is this rebuild's, and reading the ref is how they are told apart.
      if (!row.modelRef.startsWith(PRIMER_MODEL_REF_PREFIX)) continue;
      const arcId = row.modelRef.slice(PRIMER_MODEL_REF_PREFIX.length);
      if (arcId.length > 0) arcIds.add(arcId);
    }
    const modelRefs: string[] = [];
    // Sorted, so the transaction's write order is deterministic.
    for (const arcId of [...arcIds].sort((left, right) => left.localeCompare(right))) {
      const { modelRef } = await rebuildPrimerFor(ctx, args.worldId, arcId, args.now);
      modelRefs.push(modelRef);
    }
    return { modelRefs, rebuiltArcCount: modelRefs.length };
  },
});
