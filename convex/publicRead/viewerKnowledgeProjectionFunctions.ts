/**
 * Convex wiring for the FR-I005 viewer-knowledge read model (ART-169).
 *
 * Gathers the three inputs the pure join needs — Canon's facts and one character's knowledge
 * ledger, the editorial publication lifecycle, and the safety gate — and publishes the result
 * through the ordinary read-model store. Zero Canon writes; nothing here reaches a provider.
 *
 * ## The read budget, and why it is shaped this way
 *
 * A rebuild runs on the per-event post-commit path, so CLAUDE.md §9's rule applies: no read here
 * may grow with the world's history. Three choices follow from that.
 *
 * **The world-level reads happen ONCE for all characters.** {@link rebuildViewerKnowledgeProjections}
 * takes a LIST of character ids rather than one, because the expensive part — the Canon
 * projection, the world's secrets, the published Episodes — is identical for every character in
 * the world, and only the ledger lookup and the pure build are per character. A per-character
 * mutation would have multiplied the whole budget by the number of characters an event touched.
 *
 * **The publication window is bounded to {@link VIEWER_KNOWLEDGE_EPISODE_WINDOW} world days.**
 * The join needs, per accepted event, "which Episode cited you and what is that Episode's
 * publication status". Read from the Episode side, that is two bounded reads per day and no read
 * at all per event: `dailyEpisodes` newest-first, then one point read of each day's current
 * publication record. Read from the event side it would have been a lookup per candidate fact.
 *
 * The cost is a real one and it is PUBLISHED rather than hidden: a secret revealed before the
 * window is not reported as viewer-known, and `consideredWorldDays` / `oldestConsideredWorldDay`
 * in the payload say how far back the answer actually looked. A page that quietly stopped
 * mentioning a secret after thirty days would be telling a viewer something false.
 *
 * **The Scene provenance read is skipped when there is nothing withheld.** Resolving each event's
 * `sceneId` costs one range read per considered day, and it can only ever REMOVE rows. When
 * `readWithheldSceneLabels` returns nothing there is nothing to remove, so the reads are not
 * made. This is an optimisation of a fail-CLOSED shape: the empty withheld set is the case where
 * skipping changes no answer.
 *
 * ## When this runs
 *
 * Two triggers, because the payload has two independent sources of change:
 *
 *  - Every accepted event, from stage 19 of the post-commit pipeline, LAST — downstream of
 *    `rebuildLiveProjection` and `rebuildOnboardingSummary`, for the reason that stage documents
 *    twice already: it is not failure-isolated, so a defect in the newest read model must not be
 *    able to stop a safety withhold from reaching the public surface.
 *  - Every safety override, through `refreshPublicTextModels`, which is the list a new
 *    Canon-text-carrying read model is supposed to be added to.
 *
 * A publication transition is the third trigger and it is the administrator's own path; whatever
 * invokes `advancePublication` with `publish` or `withhold` must refresh this model in the same
 * transaction, exactly as the safety override path does.
 */

import { v } from 'convex/values';
import type { GenericMutationCtx } from 'convex/server';
import { internalMutation } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import type { WorldProjection as CanonWorldProjection } from '../canon/model';
import { rowToAcceptedEvent } from '../canon/serialize';
import { readProjectionViaSnapshot } from '../canon/snapshotReplay';
import { readWithheldSceneLabels } from '../safety/effectiveSafetyLabels';
import { viewerKnowledgeModelRef } from '../shared/viewerKnowledgeRef';
import { commitReadModelVersion } from './readModel';
import { writeStore } from './readModelFunctions';
import { episodeContentRefOf } from './visualReplay';
import {
  VIEWER_KNOWLEDGE_MODEL_KIND,
  ViewerKnowledgeError,
  buildViewerKnowledgeProjection,
  type CitedEventInput,
  type ProjectedFactInput,
  type SecretInput,
} from './viewerKnowledgeProjection';

type Ctx = GenericMutationCtx<DataModel>;
type Db = Ctx['db'];

/**
 * How many of the world's newest Episodes the publication join considers.
 *
 * Bounds the rebuild's reads at 2×this regardless of the world's age. Thirty world days is about
 * a month of story — long enough that a secret revealed in the current arc is still reported, and
 * short enough that the read budget does not drift upward as a world runs. The number that falls
 * outside is reported in the payload rather than assumed to be zero.
 */
export const VIEWER_KNOWLEDGE_EPISODE_WINDOW = 30;

/** A `worldSecrets` payload, which is `v.any()` in the schema. */
function secretFromRow(row: { secretId: string; payload: unknown }): SecretInput | null {
  const payload = row.payload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const { content, initialKnowerCharacterIds } = payload as {
    content?: unknown; initialKnowerCharacterIds?: unknown;
  };
  if (typeof content !== 'string' || content.length === 0) return null;
  const holders = Array.isArray(initialKnowerCharacterIds)
    ? initialKnowerCharacterIds.filter((id): id is string => typeof id === 'string')
    : [];
  return { secretId: row.secretId, content, holderCharacterIds: holders };
}

const factsFrom = (projection: CanonWorldProjection): ProjectedFactInput[] =>
  projection.facts.map((fact) => ({
    factId: fact.factId,
    subjectType: fact.subjectType,
    subjectId: fact.subjectId,
    predicate: fact.predicate,
    value: fact.value,
    visibility: fact.visibility,
    validFromEventId: fact.validFromEventId,
    validUntilEventId: fact.validUntilEventId,
  }));

/**
 * The accepted events the world's newest Episodes cite, each carrying the CURRENT publication
 * status of the Episode that cited it.
 *
 * The status is carried rather than filtered on here on purpose: the rule that only `published`
 * releases anything belongs to the pure layer, where breaking it turns a named test red. Reading
 * only the already-published rows through `by_world_and_status` would have been one read cheaper
 * and would have made that rule unfalsifiable from this side.
 */
async function citedEventsFrom(db: Db, worldId: string): Promise<{
  cited: CitedEventInput[];
  consideredWorldDays: number[];
}> {
  const episodes = await db
    .query('dailyEpisodes')
    .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId))
    .order('desc')
    .take(VIEWER_KNOWLEDGE_EPISODE_WINDOW);

  const cited: CitedEventInput[] = [];
  const consideredWorldDays: number[] = [];
  for (const episode of episodes) {
    const publicationRef = episodeContentRefOf(worldId, episode.worldDay);
    const record = await db
      .query('publicationRecords')
      .withIndex('by_current', (q) => q
        .eq('worldId', worldId).eq('contentRef', publicationRef).eq('isCurrent', true))
      .unique();
    // No current record at all is the same answer as an unpublished one, and it is a real state:
    // an Episode the coverage gate refused never gets past `generated`, and a world that ran
    // before the lifecycle existed has none.
    const publicationStatus = record?.status ?? 'absent';
    consideredWorldDays.push(episode.worldDay);
    for (const eventId of episode.sourceEventIds) {
      cited.push({ eventId, worldDay: episode.worldDay, publicationRef, publicationStatus, sceneId: null });
    }
  }
  return { cited, consideredWorldDays };
}

/**
 * Stamp each cited event with the Scene that produced it, so a withheld Scene can be excluded.
 *
 * Only called when something in the world is actually withheld — see this module's header. Reads
 * `metadata.sceneId` exactly as `sceneEventRows` in `liveStateFunctions.ts` does: `metadata` is
 * untyped storage, so anything that is not a non-empty string is absent, and an absent Scene is
 * not withheld (ART-132's convention).
 */
async function withSceneProvenance(
  db: Db,
  worldId: string,
  cited: readonly CitedEventInput[],
  consideredWorldDays: readonly number[],
): Promise<CitedEventInput[]> {
  const sceneByEventId = new Map<string, string>();
  for (const worldDay of consideredWorldDays) {
    const rows = await db
      .query('canonEvents')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).eq('worldDay', worldDay))
      .collect();
    for (const row of rows) {
      const event = rowToAcceptedEvent(row);
      const sceneId = event.metadata?.sceneId;
      if (typeof sceneId === 'string' && sceneId.length > 0) sceneByEventId.set(event.eventId, sceneId);
    }
  }
  return cited.map((event) => ({ ...event, sceneId: sceneByEventId.get(event.eventId) ?? null }));
}

/**
 * Rebuild and publish the viewer-knowledge model for each of `characterIds`.
 *
 * Returns the refs it published. A character with nothing to say still gets a row: an empty
 * payload is the honest answer to 「觀眾知道這個角色的什麼秘密」 and it is a different answer from
 * a missing model, which the page renders as "still loading".
 */
async function rebuildFor(
  ctx: Ctx,
  args: { worldId: string; characterIds: readonly string[]; now: number },
): Promise<string[]> {
  if (args.characterIds.length === 0) return [];

  const [projection, secretRows, withheldSceneLabels] = await Promise.all([
    readProjectionViaSnapshot(ctx.db, args.worldId),
    ctx.db.query('worldSecrets').withIndex('by_world_id', (q) => q.eq('worldId', args.worldId)).collect(),
    readWithheldSceneLabels(ctx.db, args.worldId),
  ]);

  const secrets = secretRows
    .map((row) => secretFromRow(row))
    .filter((secret): secret is SecretInput => secret !== null);
  const facts = factsFrom(projection);

  const { cited, consideredWorldDays } = await citedEventsFrom(ctx.db, args.worldId);
  const withheldSceneIds = new Set(Object.keys(withheldSceneLabels));
  const citedEvents = withheldSceneIds.size === 0
    ? cited
    : await withSceneProvenance(ctx.db, args.worldId, cited, consideredWorldDays);

  const modelRefs: string[] = [];
  // Sorted, so the transaction's write order is deterministic whatever order the caller passed.
  for (const characterId of [...new Set(args.characterIds)].sort((left, right) => left.localeCompare(right))) {
    const characterKnownFactIds = new Set(
      (projection.characterKnowledge[characterId] ?? []).map((record) => record.factId));
    const { projection: payload } = buildViewerKnowledgeProjection({
      worldId: args.worldId,
      characterId,
      secrets,
      facts,
      citedEvents,
      withheldSceneIds,
      characterKnownFactIds,
    });
    const modelRef = viewerKnowledgeModelRef(characterId);
    await commitReadModelVersion(writeStore(ctx.db), {
      worldId: args.worldId,
      modelKind: VIEWER_KNOWLEDGE_MODEL_KIND,
      modelRef,
      payload,
      sourceEventIds: payload.viewerKnownSecrets.map((secret) => secret.revealingEventId),
      status: 'published',
      now: args.now,
    });
    modelRefs.push(modelRef);
  }
  return modelRefs;
}

/** Post-commit entry point: rebuild the characters this event touched. */
export const rebuildViewerKnowledgeProjections = internalMutation({
  args: { worldId: v.string(), characterIds: v.array(v.string()), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new ViewerKnowledgeError('VIEWER_KNOWLEDGE_INVALID', 'worldId and a finite now are required');
    }
    const modelRefs = await rebuildFor(ctx, args);
    return { modelRefs, rebuiltCharacterCount: modelRefs.length };
  },
});

/**
 * Safety / publication entry point: rebuild every character that already has one of these models.
 *
 * The target set comes from the read-model store rather than from the world's character list, for
 * the reason `refreshVoteConsequenceProjections` derives ITS day set the same way: a model that
 * was never published has nothing on the public surface to withdraw, and enumerating the world's
 * characters would make an operator's withhold cost a rebuild per character in the world.
 */
export const refreshViewerKnowledgeProjections = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new ViewerKnowledgeError('VIEWER_KNOWLEDGE_INVALID', 'worldId and a finite now are required');
    }
    const rows = await ctx.db.query('publishedReadModels')
      .withIndex('by_status', (q) => q
        .eq('worldId', args.worldId).eq('modelKind', VIEWER_KNOWLEDGE_MODEL_KIND).eq('status', 'published'))
      .collect();
    const characterIds = new Set<string>();
    for (const row of rows) {
      const characterId = (row.payload as { characterId?: unknown } | null)?.characterId;
      // Defensive: `payload` is `v.any()`. A row this build cannot read is skipped rather than
      // crashing an operator's withhold — the surfaces that DO rebuild must still take effect.
      if (typeof characterId === 'string' && characterId.length > 0) characterIds.add(characterId);
    }
    const modelRefs = await rebuildFor(ctx, { worldId: args.worldId, characterIds: [...characterIds], now: args.now });
    return { modelRefs, rebuiltCharacterCount: modelRefs.length };
  },
});
