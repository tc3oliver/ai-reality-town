/**
 * Convex persistence for arc heat compositions (FR-F006 AC#1, AC#3 / ART-32).
 *
 * Thin, exactly as `projectionFunctions.ts` is: the score and every component are computed by the
 * pure module in `./heat.ts`, and this file only writes what it was handed and reads it back. The
 * scorer is a pure function of its inputs, so a stored composition can be recomputed and compared
 * — which is what makes AC#1 「Score 計算可追蹤」 a checkable claim rather than a stored assertion.
 *
 * The row is UPSERTED per arc. See `storyArcHeatScores` in `./schema.ts` for why the history lives
 * in the projection stream rather than here.
 */

import { internalMutation, internalQuery } from '../_generated/server';
import { v } from 'convex/values';
import { ARC_HEAT_DEFINITION_VERSION, type ArcHeatScore } from './heat';

/** One arc's stored composition, as an operator surface reads it. */
export type StoredArcHeat = {
  arcId: string;
  definitionVersion: number;
  score: number;
  measuredWeight: number;
  components: ArcHeatScore['components'];
  digest: string;
  sourceEventId: string;
  recordedAt: number;
  /**
   * Whether this row was written by the CURRENT definition (ART-32).
   *
   * Published rather than filtered: an operator comparing two arcs needs to know if one of them
   * was last scored under an older definition, and silently hiding the row would make the arc look
   * as though it had never been scored at all.
   */
  currentDefinition: boolean;
};

export const recordArcHeat = internalMutation({
  args: { heat: v.any(), recordedAt: v.number() },
  handler: async (ctx, args) => {
    const heat = args.heat as ArcHeatScore;
    const sourceEventId = heat.components
      .find((component) => component.key === 'recent_importance')
      ?.evidence.sourceEventId;
    const existing = await ctx.db
      .query('storyArcHeatScores')
      .withIndex('by_world_and_arc', (q) => q.eq('worldId', heat.worldId).eq('arcId', heat.arcId))
      .unique();
    const row = {
      schemaVersion: 1 as const,
      worldId: heat.worldId,
      arcId: heat.arcId,
      definitionVersion: heat.definitionVersion,
      score: heat.score,
      measuredWeight: heat.measuredWeight,
      components: heat.components,
      digest: heat.digest,
      sourceEventId: typeof sourceEventId === 'string' ? sourceEventId : '',
      recordedAt: args.recordedAt,
    };
    if (existing === null) {
      await ctx.db.insert('storyArcHeatScores', row);
      return { arcId: heat.arcId, score: heat.score, created: true };
    }
    await ctx.db.patch(existing._id, row);
    return { arcId: heat.arcId, score: heat.score, created: false };
  },
});

/**
 * Every arc's heat composition for a world, hottest first.
 *
 * Read by the authorized operations console (`inspectArcHeat`), never by a public read path: the
 * composition is operator evidence, and the ordering it explains is already published as
 * `heatScore` on the arc projection.
 */
export const listArcHeatCompositions = internalQuery({
  args: { worldId: v.string() },
  handler: async (ctx, { worldId }): Promise<StoredArcHeat[]> => {
    const rows = await ctx.db
      .query('storyArcHeatScores')
      .withIndex('by_world', (q) => q.eq('worldId', worldId))
      .collect();
    return rows
      .map((row): StoredArcHeat => ({
        arcId: row.arcId,
        definitionVersion: row.definitionVersion,
        score: row.score,
        measuredWeight: row.measuredWeight,
        components: row.components as ArcHeatScore['components'],
        digest: row.digest,
        sourceEventId: row.sourceEventId,
        recordedAt: row.recordedAt,
        currentDefinition: row.definitionVersion === ARC_HEAT_DEFINITION_VERSION,
      }))
      // Hottest first, ties on arc id — the same total order `compareArcsByHeat` gives the
      // homepage, so an operator reads the arcs in the order a viewer sees them.
      .sort((left, right) => right.score - left.score || left.arcId.localeCompare(right.arcId));
  },
});
