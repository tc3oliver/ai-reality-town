/**
 * The one place that re-derives EVERY cached public text surface after a safety decision
 * (FR-P004 / ART-132, extended by ART-125 and ART-46).
 *
 * ## Why this exists as a helper rather than as three calls in the override handler
 *
 * The public surface is not one read model, it is a growing set of them, and every one that is
 * built from an accepted event's `publicSummary` has to be rebuilt when an operator withholds a
 * Scene — otherwise the operator watches the sentence vanish from the map while a second cache
 * goes on serving it. That has now happened twice for the same structural reason:
 *
 *   - ART-125 added the onboarding summary, and it had to be retro-fitted into the override
 *     handler after the fact.
 *   - ART-46 added `voteConsequence`, and the same gap reappeared — worse, because that model is
 *     keyed per world day and the pipeline only refreshes a bounded trailing window, so a
 *     withheld day-7 sentence would have stayed published forever once the world reached day 9.
 *
 * Three call sites in one handler is a list someone has to remember to extend. One helper, named
 * for the invariant, is a list the next task will find. If you add a public read model that
 * carries Canon text, add it HERE and every safety path picks it up.
 *
 * Everything runs in the CALLER'S transaction, which is what makes the guarantee atomic: either
 * the override row and all the rebuilds land, or none of them do.
 */

import type { GenericMutationCtx } from 'convex/server';
import type { DataModel } from '../_generated/dataModel';
import { internalFunctionRef } from '../shared/internalFunctionRef';
import type { rebuildLiveProjection as rebuildLiveProjectionExport } from '../publicRead/liveStateFunctions';
import type { rebuildOnboardingSummary as rebuildOnboardingSummaryExport } from '../publicRead/onboardingSummaryFunctions';
import type { refreshVoteConsequenceProjections as refreshVoteConsequenceProjectionsExport } from '../publicRead/voteConsequenceProjectionFunctions';
import type { refreshViewerKnowledgeProjections as refreshViewerKnowledgeProjectionsExport } from '../publicRead/viewerKnowledgeProjectionFunctions';
import type { refreshArcPrimers as refreshArcPrimersExport } from '../publicRead/arcPrimerFunctions';

const rebuildLiveProjectionRef = internalFunctionRef<typeof rebuildLiveProjectionExport>(
  'publicRead/liveStateFunctions:rebuildLiveProjection',
);
const rebuildOnboardingSummaryRef = internalFunctionRef<typeof rebuildOnboardingSummaryExport>(
  'publicRead/onboardingSummaryFunctions:rebuildOnboardingSummary',
);
const refreshVoteConsequenceProjectionsRef =
  internalFunctionRef<typeof refreshVoteConsequenceProjectionsExport>(
    'publicRead/voteConsequenceProjectionFunctions:refreshVoteConsequenceProjections',
  );
const refreshViewerKnowledgeProjectionsRef =
  internalFunctionRef<typeof refreshViewerKnowledgeProjectionsExport>(
    'publicRead/viewerKnowledgeProjectionFunctions:refreshViewerKnowledgeProjections',
  );
const refreshArcPrimersRef = internalFunctionRef<typeof refreshArcPrimersExport>(
  'publicRead/arcPrimerFunctions:refreshArcPrimers',
);

export type PublicTextModelRefreshResult = {
  /** How many accepted events the decision actually reached. Zero is a real answer. */
  correlatedEventCount: number;
  live: { modelRef: string; version: number };
  onboarding: { modelRef: string; version: number };
  /** Which `voteConsequence` world days were re-derived. Empty when the world published none. */
  voteConsequenceModelRefs: string[];
  /**
   * Which `viewerKnowledge` characters were re-derived (ART-169). Empty when the world published
   * none.
   *
   * This model carries Canon text — a secret's own words — so it belongs to the list this helper
   * exists to be. It is also the only one here whose contents depend on the editorial publication
   * lifecycle, which is why a withhold has to reach it: an operator refusing a Scene must not
   * leave the secret that Scene revealed sitting on a character page.
   */
  viewerKnowledgeModelRefs: string[];
  /**
   * The FR-H002 arc primers re-derived (ART-176). Empty when the world published none.
   *
   * The primer publishes an accepted event's `publicSummary` verbatim, and it was absent from
   * this list entirely — so a withheld Scene narrated itself on `primer:<arcId>` for as long as
   * the arc stayed still, which for a resolved arc is forever.
   */
  arcPrimerModelRefs: string[];
};

/**
 * Rebuild every public read model that can quote an accepted event's `publicSummary`.
 *
 * `correlateSceneId` is passed through to the live rebuild so the caller can report how much
 * content the decision governed; the other two surfaces need no such hint because they re-derive
 * the whole world.
 */
export async function refreshPublicTextModels(
  ctx: GenericMutationCtx<DataModel>,
  args: { worldId: string; now: number; correlateSceneId?: string },
): Promise<PublicTextModelRefreshResult> {
  const live = await ctx.runMutation(rebuildLiveProjectionRef, {
    worldId: args.worldId,
    now: args.now,
    ...(args.correlateSceneId === undefined ? {} : { correlateSceneId: args.correlateSceneId }),
  });
  const onboarding = await ctx.runMutation(
    rebuildOnboardingSummaryRef, { worldId: args.worldId, now: args.now });
  // Per world day, and therefore per published model rather than once for the world: see
  // `refreshVoteConsequenceProjections` on why the day set comes from the read-model store.
  const consequence = await ctx.runMutation(
    refreshVoteConsequenceProjectionsRef, { worldId: args.worldId, now: args.now });
  // Per character, and derived from the read-model store rather than from the world's character
  // list — see `refreshViewerKnowledgeProjections` on why a model nobody published has nothing
  // to withdraw.
  const viewerKnowledge = await ctx.runMutation(
    refreshViewerKnowledgeProjectionsRef, { worldId: args.worldId, now: args.now });
  // Per arc, and derived from the read-model store for the same reason the two above are: a
  // primer nobody published has nothing to withdraw.
  const arcPrimers = await ctx.runMutation(
    refreshArcPrimersRef, { worldId: args.worldId, now: args.now });
  return {
    correlatedEventCount: live.correlatedEventCount ?? 0,
    live: { modelRef: live.modelRef, version: live.version },
    onboarding: { modelRef: onboarding.modelRef, version: onboarding.version },
    voteConsequenceModelRefs: consequence.modelRefs,
    viewerKnowledgeModelRefs: viewerKnowledge.modelRefs,
    arcPrimerModelRefs: arcPrimers.modelRefs,
  };
}
