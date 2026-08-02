/**
 * Read models over the canon event store. Projections are derived on demand from the
 * accepted-event log using the pure reducer, so the read model can never diverge from
 * the source of truth. (Snapshot acceleration is a future optimization; the foundation
 * always reduces from the full log for correctness.)
 */

import { internalQuery, query } from '../_generated/server';
import { v } from 'convex/values';
import { emptyProjection, type AcceptedEvent, type WorldProjection } from './model';
import { replayWorldEvents } from './replay';
import { rowToAcceptedEvent } from './serialize';

/** List accepted events for a world in sequence order. */
export const listEvents = query({
  args: { worldId: v.string() },
  handler: async (ctx, { worldId }): Promise<AcceptedEvent[]> => {
    const rows = await ctx.db
      .query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId))
      .collect();
    return rows.map(rowToAcceptedEvent);
  },
});

/** Derive the current world projection by reducing the full event log. */
export const getWorldProjection = query({
  args: { worldId: v.string() },
  handler: async (ctx, { worldId }): Promise<WorldProjection> => {
    const rows = await ctx.db
      .query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId))
      .collect();
    return replayWorldEvents(emptyProjection(worldId), rows.map(rowToAcceptedEvent));
  },
});

/** The latest persisted snapshot for a world, or null. */
export const getLatestSnapshot = internalQuery({
  args: { worldId: v.string() },
  handler: async (ctx, { worldId }) => {
    const row = await ctx.db
      .query('canonSnapshots')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId))
      .order('desc')
      .first();
    return row ?? null;
  },
});
