/**
 * Convex wiring for the four FR-G003 recap formats (ART-164).
 *
 * Before this module `recapFormats.ts` had no caller anywhere: `buildMachineSummary`,
 * `buildDeepRecap` and `validateRecapFormats` were built, tested and unreachable, and no table
 * stored their output. So Quick / Standard / Deep / Machine Summary existed for no episode any
 * running world produced.
 *
 * Everything here reads ALREADY-ACCEPTED material — the day's canon events and the daily Episode
 * that was itself derived from them — and writes only `episodeRecapFormats`. No function here
 * touches Canon, and a regeneration re-derives from the same accepted events rather than editing
 * anything.
 */

import { v } from 'convex/values';
import type { GenericMutationCtx } from 'convex/server';
import { internalMutation, internalQuery } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import { rowToAcceptedEvent } from '../canon/serialize';
import type { DailyEpisode } from '../editorial/episode';
import {
  buildDeepRecap, buildMachineSummary, validateRecapFormats,
  type RecapArcContext, type RecapFormats,
} from './recapFormats';
import {
  composeRecaps, RecapCompositionError, RECAP_FORMATTER_VERSION, type RecapComposition,
} from './recapComposition';

/** What a caller gets back, whether the formats composed or the length contract refused them. */
export type RecapFormatOutcome = {
  status: 'ready' | 'failed';
  worldDay: number;
  episodeNumber: number;
  deduplicated: boolean;
  errorCode?: string;
};

type MutationCtx = GenericMutationCtx<DataModel>;
type GenerateArgs = { worldId: string; worldDay: number; createdAt: number };

/**
 * Compose and write one day's formats. Shared by the idempotent path and the explicit
 * regeneration so the two can never disagree about what a recap for a day contains.
 */
async function composeAndPersist(ctx: MutationCtx, args: GenerateArgs): Promise<RecapFormatOutcome> {
    const episodeRow = await ctx.db.query('dailyEpisodes')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId).eq('worldDay', args.worldDay)).unique();
    if (!episodeRow) {
      // No episode, nothing to recap. Not an error row: a world day with no episode has no
      // artifact to be missing, and writing a `failed` row here would make every pre-episode
      // commit look like a defect.
      return { status: 'failed', worldDay: args.worldDay, episodeNumber: 0, deduplicated: false, errorCode: 'RECAP_EPISODE_MISSING' };
    }
    /**
     * A `withheld` or `failed` Episode has no public copy to recap, and recapping one anyway is
     * precisely how withheld material re-enters the public surface by a side door. The row is
     * written so the absence is queryable rather than silent.
     */
    if (episodeRow.status !== 'ready' || !episodeRow.episode) {
      await ctx.db.insert('episodeRecapFormats', {
        schemaVersion: 1, formatterVersion: RECAP_FORMATTER_VERSION, worldId: args.worldId,
        worldDay: args.worldDay, episodeNumber: episodeRow.episodeNumber, status: 'failed',
        sourceEventIds: [], errorCode: 'RECAP_EPISODE_NOT_PUBLISHABLE',
        errorDetails: { episodeStatus: episodeRow.status }, createdAt: args.createdAt,
      });
      return {
        status: 'failed', worldDay: args.worldDay, episodeNumber: episodeRow.episodeNumber,
        deduplicated: false, errorCode: 'RECAP_EPISODE_NOT_PUBLISHABLE',
      };
    }

    const episode = structuredClone(episodeRow.episode) as DailyEpisode;
    // Index-scoped to the world DAY, never the world: this runs once per completed day and must
    // not grow with the world's age (the ART-100 rule).
    const eventRows = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId).eq('worldDay', args.worldDay)).collect();
    const events = eventRows.map(rowToAcceptedEvent);

    try {
      const composed = composeRecaps(episode, events);
      const arcContext: RecapArcContext = {
        newQuestions: [...episode.newQuestions],
        resolvedQuestions: [...episode.resolvedQuestions],
        // Arc progress reads the Episode's own arc list rather than re-deriving from the story
        // projection: the Episode is the artifact being recapped, so its view of which arcs moved
        // is the one a reader is being told about.
        storyArcProgress: episode.arcIds.map((arcId) => ({
          arcId, progress: `第 ${episode.episodeNumber} 集推進了這條故事線。`,
        })),
      };
      const formats: RecapFormats = validateRecapFormats({
        schemaVersion: 1,
        quickRecap: composed.quickRecap,
        standardRecap: composed.standardRecap,
        deepRecap: buildDeepRecap(events),
        machineSummary: buildMachineSummary(events, arcContext),
        sourceEventIds: composed.sourceEventIds,
      }, events);

      await ctx.db.insert('episodeRecapFormats', {
        schemaVersion: 1, formatterVersion: RECAP_FORMATTER_VERSION, worldId: args.worldId,
        worldDay: args.worldDay, episodeNumber: episode.episodeNumber, status: 'ready',
        formats, composition: composed.composition, sourceEventIds: formats.sourceEventIds,
        createdAt: args.createdAt,
      });
      return { status: 'ready', worldDay: args.worldDay, episodeNumber: episode.episodeNumber, deduplicated: false };
    } catch (error) {
      /**
       * A refusal, recorded. The length band is a contract, so a day that cannot meet it is a
       * reportable state and not something to paper over by padding or slicing — see
       * `recapComposition.ts`. Canon is untouched either way; this only records that no publishable
       * recap exists for the day.
       */
      const errorCode = error instanceof RecapCompositionError ? error.code
        : (error as { code?: string }).code ?? 'RECAP_FORMAT_GENERATION_FAILED';
      await ctx.db.insert('episodeRecapFormats', {
        schemaVersion: 1, formatterVersion: RECAP_FORMATTER_VERSION, worldId: args.worldId,
        worldDay: args.worldDay, episodeNumber: episode.episodeNumber, status: 'failed',
        sourceEventIds: [], errorCode,
        errorDetails: error instanceof RecapCompositionError ? (error.details ?? {}) : {},
        createdAt: args.createdAt,
      });
      return { status: 'failed', worldDay: args.worldDay, episodeNumber: episode.episodeNumber, deduplicated: false, errorCode };
    }
}

/**
 * Compose and persist the recap formats for one daily Episode. Idempotent per world day.
 *
 * Deduplicating on the ROW rather than on content is deliberate: FR-G003 requires that one
 * Episode never carries two conflicting sets of formats, and the cheapest way to guarantee that
 * is for a second call to return the first call's answer untouched. A deliberate regeneration is
 * {@link regenerateEpisodeRecapFormats}, which is explicit about replacing.
 */
export const generateEpisodeRecapFormats = internalMutation({
  args: { worldId: v.string(), worldDay: v.number(), createdAt: v.number() },
  handler: async (ctx, args): Promise<RecapFormatOutcome> => {
    const prior = await ctx.db.query('episodeRecapFormats')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId).eq('worldDay', args.worldDay)).unique();
    if (prior) {
      return {
        status: prior.status, worldDay: prior.worldDay, episodeNumber: prior.episodeNumber,
        deduplicated: true, ...(prior.errorCode === undefined ? {} : { errorCode: prior.errorCode }),
      };
    }
    return composeAndPersist(ctx, args);
  },
});

/**
 * Re-derive an existing day's formats under the current formatter.
 *
 * Explicit rather than implicit so a regeneration is always an operator's decision: the automatic
 * path deduplicates, which is what keeps one Episode from ever holding two conflicting sets. The
 * inputs are the same accepted events, so this cannot change what happened — only how it reads.
 */
export const regenerateEpisodeRecapFormats = internalMutation({
  args: { worldId: v.string(), worldDay: v.number(), createdAt: v.number() },
  handler: async (ctx, args): Promise<RecapFormatOutcome> => {
    const prior = await ctx.db.query('episodeRecapFormats')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId).eq('worldDay', args.worldDay)).unique();
    if (prior) await ctx.db.delete(prior._id);
    // Calls the shared implementation directly rather than re-entering the registered mutation:
    // one transaction, and the delete above cannot be committed separately from the rewrite.
    return composeAndPersist(ctx, args);
  },
});

/** Internal read. There is deliberately no public query: publication decides what is visible. */
export const getEpisodeRecapFormats = internalQuery({
  args: { worldId: v.string(), worldDay: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query('episodeRecapFormats')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId).eq('worldDay', args.worldDay)).unique();
    if (!row) return null;
    return {
      schemaVersion: row.schemaVersion, formatterVersion: row.formatterVersion,
      worldId: row.worldId, worldDay: row.worldDay, episodeNumber: row.episodeNumber,
      status: row.status, sourceEventIds: [...row.sourceEventIds],
      formats: row.formats ? structuredClone(row.formats) as RecapFormats : null,
      composition: row.composition ? structuredClone(row.composition) as RecapComposition : null,
      errorCode: row.errorCode ?? null,
    };
  },
});
