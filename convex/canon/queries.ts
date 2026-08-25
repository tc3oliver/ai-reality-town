/**
 * Read models over the canon event store. Projections are derived on demand from the
 * accepted-event log using the pure reducer, so the read model can never diverge from
 * the source of truth. (Snapshot acceleration is a future optimization; the foundation
 * always reduces from the full log for correctness.)
 */

import { internalQuery } from '../_generated/server';
import { v } from 'convex/values';
import { emptyProjection, type AcceptedEvent, type WorldProjection } from './model';
import { buildCharacterSummaries, personaAnchorFromSeed, type CharacterSummary } from './personaDeviation';
import { replayWorldEvents } from './replay';
import { rowToAcceptedEvent } from './serialize';

/** List accepted events for a world in sequence order. */
export const listEvents = internalQuery({
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
export const getWorldProjection = internalQuery({
  args: { worldId: v.string() },
  handler: async (ctx, { worldId }): Promise<WorldProjection> => {
    const rows = await ctx.db
      .query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId))
      .collect();
    return replayWorldEvents(emptyProjection(worldId), rows.map(rowToAcceptedEvent));
  },
});

/** Private current character state, derived only from accepted events. */
export const getCharacterStates = internalQuery({
  args: { worldId: v.string() },
  handler: async (ctx, { worldId }) => {
    const rows = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).collect();
    return replayWorldEvents(emptyProjection(worldId), rows.map(rowToAcceptedEvent)).characterStates;
  },
});

/** Private relationship state and causal history; publication is owned by ART-95. */
export const getRelationshipProjection = internalQuery({
  args: { worldId: v.string() },
  handler: async (ctx, { worldId }) => {
    const rows = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).collect();
    const projection = replayWorldEvents(emptyProjection(worldId), rows.map(rowToAcceptedEvent));
    return { relationships: projection.relationships, history: projection.relationshipHistory };
  },
});

/**
 * FR-B003 character summaries: the seeded persona plus every accepted moment that changed it.
 *
 * Internal, and it must stay internal. A flag names who a character turned on and by how much,
 * which is the same private causal detail `getRelationshipProjection` is internal for — a public
 * reader who could see that a character's trust in someone inverted would learn a private
 * relationship fact the public projection deliberately withholds.
 *
 * Derived on demand from the event log, so it cannot drift from Canon and never triggers
 * generation of any kind.
 */
export const getCharacterSummaries = internalQuery({
  args: { worldId: v.string() },
  handler: async (ctx, { worldId }): Promise<Record<string, CharacterSummary>> => {
    const [events, characters] = await Promise.all([
      ctx.db.query('canonEvents')
        .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).collect(),
      ctx.db.query('worldCharacters')
        .withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
    ]);
    const anchors = Object.fromEntries(characters.flatMap((row) => {
      const anchor = personaAnchorFromSeed(row.characterId, row.payload);
      return anchor ? [[row.characterId, anchor] as const] : [];
    }));
    return buildCharacterSummaries(emptyProjection(worldId), events.map(rowToAcceptedEvent), anchors);
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
