/**
 * Convex wiring for recommended active-arc entry points (FR-H003).
 *
 * Reassesses an explainable entry episode for a major active arc after major
 * changes and persists it idempotently. Reads-only over accepted events (to mark
 * the reassess point) and the published episode set; performs zero Canon writes.
 * Visitor reads use the query below and never trigger generation.
 */

import { v } from 'convex/values';
import type { GenericMutationCtx } from 'convex/server';
import { internalMutation, internalQuery } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import { isActiveArcStatus } from './lifecycle';
import type { ArcPortfolioEntry } from './portfolio';
import {
  EntryRecommendationError,
  recommendArcEntry,
  validateRecommendedArcEntry,
  type ArcEpisodeRef,
  type RecommendedArcEntry,
} from './entryRecommendation';

type Ctx = GenericMutationCtx<DataModel>;

function toEpisodeRef(row: DataModel['dailyEpisodes']['document']): ArcEpisodeRef | null {
  if (!row.episode) return null;
  return { episodeNumber: row.episodeNumber, worldDay: row.worldDay, sourceEventIds: row.sourceEventIds };
}

function arcEpisodesFor(worldEpisodes: readonly ArcEpisodeRef[], episodeRows: readonly DataModel['dailyEpisodes']['document'][], arcId: string): ArcEpisodeRef[] {
  const numbers = new Set(
    episodeRows
      .filter((row) => {
        const arcIds = (row.episode as { arcIds?: string[] } | undefined)?.arcIds ?? [];
        return arcIds.includes(arcId);
      })
      .map((row) => row.episodeNumber),
  );
  return worldEpisodes.filter((episode) => numbers.has(episode.episodeNumber));
}

async function reassessOne(ctx: Ctx, worldId: string, arcId: string, now: number): Promise<RecommendedArcEntry | null> {
  const portfolioRow = await ctx.db
    .query('storyArcPortfolioEntries')
    .withIndex('by_world_and_arc', (q) => q.eq('worldId', worldId).eq('arcId', arcId))
    .unique();
  if (!portfolioRow) throw new EntryRecommendationError('ENTRY_ARC_NOT_FOUND', 'arc has no portfolio entry');
  const portfolio = structuredClone(portfolioRow.entry) as ArcPortfolioEntry;
  if (portfolio.tier !== 'major' || !isActiveArcStatus(portfolio.projection.status)) return null;

  // Only the single HIGHEST sequence number is ever used below, so this is the last row on
  // `by_world_and_sequence` rather than a collect of the world's whole event log.
  const [episodeRows, latestCanonRow] = await Promise.all([
    ctx.db.query('dailyEpisodes').withIndex('by_world_and_day', (q) => q.eq('worldId', worldId)).collect(),
    ctx.db.query('canonEvents').withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).order('desc').first(),
  ]);
  const worldEpisodes = episodeRows.map(toEpisodeRef).filter((value): value is ArcEpisodeRef => value !== null);
  const latestSequenceNumber = latestCanonRow?.sequenceNumber ?? 0;
  const arcEpisodes = arcEpisodesFor(worldEpisodes, episodeRows, arcId);

  const entry = recommendArcEntry({
    worldId, arcId, projection: portfolio.projection,
    arcEpisodes, worldEpisodes, latestSequenceNumber,
  });

  const existing = await ctx.db
    .query('storyArcRecommendedEntries')
    .withIndex('by_world_and_arc', (q) => q.eq('worldId', worldId).eq('arcId', arcId))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, { entry, reassessedAtSequenceNumber: entry.reassessedAtSequenceNumber, updatedAt: now });
  } else {
    await ctx.db.insert('storyArcRecommendedEntries', {
      worldId, arcId, entry, reassessedAtSequenceNumber: entry.reassessedAtSequenceNumber, updatedAt: now,
    });
  }
  return entry;
}

/** Reassess the recommended entry for a single arc (idempotent; AC#3). */
export const reassessArcEntryRecommendation = internalMutation({
  args: { worldId: v.string(), arcId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || args.arcId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new EntryRecommendationError('ENTRY_INVALID', 'worldId, arcId, and a finite now are required');
    }
    const entry = await reassessOne(ctx, args.worldId, args.arcId, args.now);
    return entry
      ? { arcId: args.arcId, reassessed: true, reassessedAtSequenceNumber: entry.reassessedAtSequenceNumber }
      : { arcId: args.arcId, reassessed: false, reassessedAtSequenceNumber: null };
  },
});

/** Reassess entries for every major active arc in a world (AC#1 coverage). */
export const reassessMajorActiveArcEntries = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new EntryRecommendationError('ENTRY_INVALID', 'worldId and a finite now are required');
    }
    const rows = await ctx.db
      .query('storyArcPortfolioEntries').withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId)).collect();
    const reassessed: string[] = [];
    for (const row of rows) {
      const portfolio = structuredClone(row.entry) as ArcPortfolioEntry;
      if (portfolio.tier !== 'major' || !isActiveArcStatus(portfolio.projection.status)) continue;
      const entry = await reassessOne(ctx, args.worldId, row.arcId, args.now);
      if (entry) reassessed.push(row.arcId);
    }
    return { reassessed };
  },
});

/** Visitor-readable recommendation for an arc, including the explainable reason (AC#2). */
export const getRecommendedArcEntry = internalQuery({
  args: { worldId: v.string(), arcId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('storyArcRecommendedEntries')
      .withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId))
      .unique();
    return row ? validateRecommendedArcEntry(row.entry) : null;
  },
});
