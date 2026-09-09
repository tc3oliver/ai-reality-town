/**
 * FR-K004 / ART-171 — the administrator's own step in the editorial publication lifecycle.
 *
 * | Command | Capability | Applies | Public content |
 * | --- | --- | --- | --- |
 * | `decideEpisodePublication` | `publication.decide` | `publish` / `withhold` / `resume_to_ready` on one day's Episode record | rebuilt or withdrawn |
 *
 * ## Why this had to exist
 *
 * FR-K004 reserves four actions for an administrator and `assertAuthorized` has enforced that
 * since ART-51. Nothing could invoke them. `advancePublication` is an internalMutation whose only
 * caller is the post-commit pipeline, and that call site is typed
 * `validate | begin_safety_review | pass_safety_review | withhold` — the four a SYSTEM actor may
 * take. So every Episode in every world walked to `ready` and stopped, no record has ever reached
 * `published`, and the administrator half of the lifecycle was a rule with no way to exercise it.
 *
 * That is not a cosmetic gap. It is why ART-169's 觀眾已知秘密 is empty on every character page:
 * a secret becomes viewer-known when a `published` Episode reveals it, and no Episode could be
 * published.
 *
 * ## Nothing about the lifecycle is reimplemented here
 *
 * The transition, the admin-only rule, the audit event and ART-162's publication gate all live in
 * `advancePublication` and the pure module beneath it, and this command calls it. A second copy
 * of "which actions may an administrator take" is the shape of defect this repository has had
 * before: two answers to one question, disagreeing on the day it matters.
 *
 * What this command owns is the part `advancePublication` cannot: authorization against the
 * OPERATOR registry (the lifecycle knows about a `PublicationActor`, not about who is calling),
 * the audit row, and the public surface.
 *
 * ## The surface follows the decision, in the same transaction
 *
 * A `withhold` that leaves the Episode on the public page is not a withhold. Two things run here:
 *
 *  - `rebuildEpisodeProjection` for the day, which since ART-171 reads the publication record and
 *    WITHDRAWS `episode:<day>` — fallbacks included — when the record is withheld or superseded.
 *  - `refreshPublicTextModels`, which carries the decision to every cached public text surface,
 *    including ART-169's per-character viewer-knowledge model. That model is the one whose
 *    contents change most sharply on a publish: a secret that no viewer could see becomes one
 *    they can.
 *
 * Both run in the caller's transaction, so either the decision and its consequences all land or
 * none of them do.
 */

import { mutation } from '../_generated/server';
import { v } from 'convex/values';

import { internalFunctionRef } from '../shared/internalFunctionRef';
import type { advancePublication as advancePublicationExport } from '../editorial/publicationLifecycleFunctions';
import type { rebuildEpisodeProjection as rebuildEpisodeProjectionExport } from '../publicRead/episodeTimelineProjectionFunctions';
import type { rebuildEpisodeIndexProjection as rebuildEpisodeIndexProjectionExport } from '../publicRead/episodeIndexProjectionFunctions';
import { episodeContentRefOf } from '../publicRead/visualReplay';
import { commandArgs, operatorNow, recordAudit, requireOperator } from './opsConsoleFunctions';
import { refreshPublicTextModels } from './publicTextModelRefresh';

const advancePublicationRef = internalFunctionRef<typeof advancePublicationExport>(
  'editorial/publicationLifecycleFunctions:advancePublication',
);
const rebuildEpisodeProjectionRef = internalFunctionRef<typeof rebuildEpisodeProjectionExport>(
  'publicRead/episodeTimelineProjectionFunctions:rebuildEpisodeProjection',
);
const rebuildEpisodeIndexProjectionRef = internalFunctionRef<typeof rebuildEpisodeIndexProjectionExport>(
  'publicRead/episodeIndexProjectionFunctions:rebuildEpisodeIndexProjection',
);

export class PublicationControlError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'PublicationControlError';
  }
}

/**
 * The three administrator actions this command exposes.
 *
 * `regenerate` is deliberately absent. It supersedes the current record AND mints a fresh
 * `generated` one, which is a content operation rather than a visibility decision — it belongs
 * with whatever re-derives the Episode, not with the control that decides who may see the
 * Episode that exists. Exposing it here would let an administrator reset a day's editorial
 * history through a button labelled "publish".
 */
export const PUBLICATION_DECISIONS = ['publish', 'withhold', 'resume_to_ready'] as const;
export type PublicationDecision = (typeof PUBLICATION_DECISIONS)[number];

export type PublicationDecisionResult = {
  contentRef: string;
  worldDay: number;
  decision: PublicationDecision;
  /** RE-READ from the transition's own result, never an echo of the request. */
  status: string;
  version: number;
  publicationId: string;
  /** The Episode read model after the decision: republished, or withdrawn with its fallbacks. */
  episodeModelRef: string;
  episodeWithdrawnVersions: number[];
  /**
   * The Episode INDEX, rebuilt beside it (ART-174).
   *
   * Separate from `episodeModelRef` because they are two models and the first version of this
   * command rebuilt only one: withdrawing `episode:<day>` while `episodes:<world>` went on
   * listing the same day's title and headline is a withhold that withholds half the content.
   */
  episodeIndexModelRef: string;
  /** The cached public text surfaces re-derived in the same transaction. */
  liveRefresh: { modelRef: string; version: number };
  onboardingRefresh: { modelRef: string; version: number };
  voteConsequenceRefresh: string[];
  /**
   * The ART-169 viewer-knowledge models re-derived (FR-I005).
   *
   * Reported separately because this is the surface a PUBLISH changes most: a secret that no
   * viewer could see becomes one they can, and an operator releasing a day's story should be able
   * to see that it happened rather than infer it.
   */
  viewerKnowledgeRefresh: string[];
};

/**
 * Apply an administrator's publication decision to one world day's Episode.
 *
 * Addressed by `worldDay` rather than by `contentRef`, because the world day is what an operator
 * has in front of them and the content reference is derived — `episodeContentRefOf` is the same
 * function the pipeline and the Visual Replay use, so there is no second identifier scheme to
 * keep in step.
 */
export const decideEpisodePublication = mutation({
  args: {
    ...commandArgs,
    worldDay: v.number(),
    /**
     * Named `decision`, not `action`.
     *
     * `action` is on `publicReadOnlyGuarantee.test.ts`'s player-control vocabulary — the argument
     * names a retired a16z client would have sent to move or speak as a character — and no public
     * function may DECLARE one, whatever it would have meant here. The test caught this, and
     * renaming is the right answer: an exception would have widened a security pin to accommodate
     * a word.
     */
    decision: v.union(
      v.literal('publish'),
      v.literal('withhold'),
      v.literal('resume_to_ready'),
    ),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PublicationDecisionResult> => {
    const principal = await requireOperator(ctx, 'publication.decide', args);
    const at = operatorNow(args.now);
    // Checked here rather than left to `recordAudit`, for the reason `safetyOverrideFunctions`
    // gives: NFR-005 requires a privileged mutation to be reasoned BEFORE it applies, and "the
    // write is rolled back" is a weaker property to rely on than "the write never happened".
    if (args.reason.trim().length === 0) {
      throw new PublicationControlError('PUBLICATION_REASON_REQUIRED', 'a non-empty reason is required');
    }
    if (!Number.isSafeInteger(args.worldDay) || args.worldDay < 0) {
      throw new PublicationControlError('PUBLICATION_INVALID_DAY', 'worldDay must be a non-negative integer');
    }

    const contentRef = episodeContentRefOf(args.worldId, args.worldDay);
    // The transition itself, through the existing internal mutation. It refuses an unknown
    // content reference, an illegal transition, an action this actor may not take, and a
    // `publish` into a world whose publication gate is closed — none of which is restated here.
    const transition = await ctx.runMutation(advancePublicationRef, {
      worldId: args.worldId,
      contentRef,
      action: args.decision,
      // The verified operator, as the lifecycle's own actor type. `admin` is not a claim this
      // command makes on the caller's behalf: `publication.decide` is an admin-only capability,
      // so `requireOperator` above has already refused anyone who is not one.
      actor: { type: 'admin' as const, id: principal.operatorId },
      reason: args.reason,
      now: at,
    });

    // The Episode read model follows the record. This is the call that makes `withhold` mean
    // something: it withdraws `episode:<day>` and its fallbacks when the record is no longer
    // servable, and republishes it when it is.
    const episode = await ctx.runMutation(rebuildEpisodeProjectionRef, {
      worldId: args.worldId, worldDay: args.worldDay, now: at,
    });
    // ...and the INDEX, which lists the same day's title and headline (ART-174). The two are
    // rebuilt together because a viewer who cannot open the episode but can still read its
    // headline in the list has not had it withheld.
    const episodeIndex = await ctx.runMutation(rebuildEpisodeIndexProjectionRef, {
      worldId: args.worldId, now: at,
    });

    // Every other cached public text surface, through the helper named for the invariant so the
    // next read model that quotes Canon is picked up here without a second edit.
    const refresh = await refreshPublicTextModels(ctx, { worldId: args.worldId, now: at });

    // Audited AFTER the surface work, so the durable record carries what the decision actually
    // reached rather than what it intended to reach.
    await recordAudit(ctx, {
      principal,
      worldId: args.worldId,
      capability: 'publication.decide',
      target: contentRef,
      reason: args.reason,
      outcome: 'applied',
      resultCode: `PUBLICATION_${transition.status.toUpperCase()}`,
      at,
    });

    return {
      contentRef,
      worldDay: args.worldDay,
      decision: args.decision,
      status: transition.status,
      version: transition.version,
      publicationId: transition.publicationId,
      episodeModelRef: episode.modelRef,
      episodeWithdrawnVersions: episode.withdrawnVersions,
      episodeIndexModelRef: episodeIndex.modelRef,
      liveRefresh: refresh.live,
      onboardingRefresh: refresh.onboarding,
      voteConsequenceRefresh: refresh.voteConsequenceModelRefs,
      viewerKnowledgeRefresh: refresh.viewerKnowledgeModelRefs,
    };
  },
});
