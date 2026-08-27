/**
 * FR-P004 / ART-132 — the audited safety-status override, the one way a human changes what the
 * public dynamic surface is allowed to say.
 *
 * | Command | Capability | Appends | Public content |
 * | --- | --- | --- | --- |
 * | `overridePostGenerationSafetyLabel` | `safety.override` | a `safetyStatusOverrides` row revising a classification's label | rebuilt |
 *
 * THE CLASSIFIER'S VERDICT IS NEVER OVERWRITTEN
 * ---------------------------------------------
 * `postGenerationSafetyClassifications` is written once per classification and defended by a
 * conflict check that refuses a reused id carrying different content. This command does not
 * patch it, and could not: it appends to a separate ledger, and the effective label is derived
 * from the pair (`resolveEffectiveSafetyLabel`). What the classifier decided, what every
 * operator revised it to, and who revised it therefore all survive — an override is an
 * addition to the record, never an erasure of it.
 *
 * OPERATOR + REASON, AUTHORIZED FIRST
 * -----------------------------------
 * This is a public `mutation` — reachable by a client — so {@link requireOperator} is its FIRST
 * statement, before the classification is even looked up: an unauthorized caller must not be
 * able to learn which classifications exist. `reason` is required, is stored on the override
 * row, and is written to `operatorAuditLog` in the same transaction with the verified operator
 * identity, the capability and the classification id as the audit target.
 *
 * PUBLIC CONTENT FOLLOWS THE OVERRIDE (AC#3)
 * ------------------------------------------
 * The handler finishes by running `rebuildLiveProjection` for the world, which re-derives the
 * dynamic surface against the new effective label — so a withhold removes the affected text
 * from the published projection immediately rather than at the next Canon commit. Canon is
 * untouched on this path: nothing here reads or writes `canonEvents`.
 *
 * `rebuildOnboardingSummary` runs beside it (ART-125). The onboarding summary is a SECOND cached
 * public text surface built from the same Canon summaries and the same episode narration, and it
 * is served to every first-time visitor on the homepage and — since FR-O007 — on the live map's
 * story overlay. Gating its rebuild without re-running it here would leave the refused sentence
 * published until the next natural Canon commit, which on a paused or finished world is never:
 * the operator would see the dynamic surface go clean while the world's own introduction kept
 * quoting the text they withheld. Both run in this transaction, so either both take effect or
 * the override row itself is rolled back.
 */

import { mutation } from '../_generated/server';
import { v } from 'convex/values';

import { POST_GENERATION_LABELS } from '../safety/postGeneration';
import { readEffectiveSafetyLabel } from '../safety/effectiveSafetyLabels';
import { commandArgs, operatorNow, recordAudit, requireOperator } from './opsConsoleFunctions';
import { refreshPublicTextModels } from './publicTextModelRefresh';

export class SafetyOverrideError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'SafetyOverrideError';
  }
}

export type SafetyOverrideResult = {
  classificationId: string;
  /** The Scene the decision was recorded against — `classification.sourceId`. */
  sourceId: string;
  /** The classifier's original verdict, unchanged by this call and returned so it stays visible. */
  originalLabel: string;
  /** RE-READ from the ledger after the append, never an echo of the request. */
  effectiveLabel: string;
  createdAt: number;
  /**
   * How many accepted events this Scene actually governs in the world right now.
   *
   * Zero is a real and expected answer: `metadata.sceneId` is stamped only on events committed
   * after ART-132 shipped, so a Scene whose events predate it correlates to nothing and the
   * override changes nothing observable. Reporting it is the difference between an operator
   * knowing that and believing they have withheld something.
   */
  correlatedEventCount: number;
  refresh: { modelRef: string; version: number };
  /**
   * The onboarding summary rebuilt in the same transaction (ART-125).
   *
   * Reported separately rather than folded into `refresh`, because they are two independent
   * read models: an operator who withholds a Scene needs to see that BOTH public text surfaces
   * were re-derived, not just the one this command originally refreshed.
   */
  onboardingRefresh: { modelRef: string; version: number };
  /**
   * The FR-J002 consequence models re-derived in the same transaction (ART-46).
   *
   * A LIST, not a single ref: `voteConsequence` is keyed per world day, so one withhold can
   * touch several of them — and unlike the two surfaces above, nothing else would ever rebuild
   * a past day, because the commit pipeline only refreshes a bounded trailing window.
   * Empty is a real answer for a world that has published none.
   */
  voteConsequenceRefresh: string[];
};

/**
 * Revise the safety label governing one Scene.
 *
 * `label` is the full post-generation vocabulary rather than a withhold/release pair: an
 * operator downgrading `withhold` to `allow_with_warning` is a different decision from
 * releasing it outright, and the ledger should record which one was made.
 *
 * Addressed by `classificationId`, because that is what an operator has in front of them from
 * `getPostGenerationSafetyReason` — but RECORDED against the classification's `sourceId`, the
 * Scene. The decision is about content, not about a classification run, and keying the ledger
 * on the run would silently orphan the decision the moment a slot retry re-classified the same
 * Scene under a new run id.
 */
export const overridePostGenerationSafetyLabel = mutation({
  args: {
    ...commandArgs,
    classificationId: v.string(),
    label: v.union(
      v.literal('allow'),
      v.literal('allow_with_warning'),
      v.literal('withhold'),
      v.literal('human_review_required'),
    ),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SafetyOverrideResult> => {
    const principal = await requireOperator(ctx, 'safety.override', args);
    const at = operatorNow(args.now);
    // Checked HERE and not left to `recordAudit`, which rejects the same thing later. Both
    // rows are written in one transaction, so a late throw would still roll the ledger row
    // back — but "the write is undone" is a much weaker property to depend on than "the write
    // never happened", and NFR-005's requirement is that a privileged mutation be reasoned
    // before it applies, not that an unreasoned one be retracted.
    if (args.reason.trim().length === 0) {
      throw new SafetyOverrideError('SAFETY_REASON_REQUIRED', 'a non-empty reason is required');
    }

    const classification = await ctx.db
      .query('postGenerationSafetyClassifications')
      .withIndex('by_world_and_classification', (q) =>
        q.eq('worldId', args.worldId).eq('classificationId', args.classificationId))
      .unique();
    // There is nothing to revise, and inventing an override row for an unknown classification
    // would create a label that governs no content and can never be reconciled with one.
    if (!classification) {
      throw new SafetyOverrideError(
        'SAFETY_CLASSIFICATION_NOT_FOUND',
        `no post-generation classification ${args.classificationId} in world ${args.worldId}`,
      );
    }
    if (!(POST_GENERATION_LABELS as readonly string[]).includes(args.label)) {
      throw new SafetyOverrideError('SAFETY_INVALID_LABEL', `unsupported safety label ${args.label}`);
    }

    await ctx.db.insert('safetyStatusOverrides', {
      worldId: args.worldId,
      sourceId: classification.sourceId,
      classificationId: args.classificationId,
      label: args.label,
      reason: args.reason,
      actor: principal.operatorId,
      createdAt: at,
    });

    // RE-READ, never echo. `createdAt` comes from the caller's `now`, and "latest wins" is
    // decided by `createdAt`: a backdated or replayed `now` at or below an existing override's
    // timestamp appends a row that loses the comparison and changes nothing. Returning
    // `args.label` would have reported that as a success while the content stayed fully
    // public — the single worst outcome available to a safety control, because the operator
    // stops looking. Asking the ledger what it now says turns that into a loud refusal.
    const effectiveLabel = await readEffectiveSafetyLabel(ctx.db, args.worldId, classification.sourceId);
    if (effectiveLabel !== args.label) {
      throw new SafetyOverrideError(
        'SAFETY_OVERRIDE_NOT_APPLIED',
        `override of ${classification.sourceId} did not take effect: the Scene still resolves to `
        + `${effectiveLabel}. A later override already governs it; submit with a current timestamp.`,
      );
    }

    // Same transaction as the override row: a projection that still showed withheld text after
    // the ledger said otherwise would be the exact failure FR-P004 exists to prevent.
    //
    // ONE call for ALL of them, through `refreshPublicTextModels`. This used to be two inline
    // rebuilds, and a third public text surface (ART-46's `voteConsequence`) was added without
    // either of them noticing — which is precisely the failure a hand-kept list of call sites
    // produces. The helper is named for the invariant, so the next read model that quotes Canon
    // is added in one place and every safety path picks it up.
    const refresh = await refreshPublicTextModels(ctx, {
      worldId: args.worldId,
      now: at,
      correlateSceneId: classification.sourceId,
    });
    const correlatedEventCount = refresh.correlatedEventCount;

    // Audited AFTER the rebuild so the durable record carries whether the decision reached any
    // content at all. An override that correlates to nothing is not a failure — it is a
    // legitimate decision about a Scene whose events predate the provenance stamp — but it must
    // not be indistinguishable from one that took effect.
    await recordAudit(ctx, {
      principal,
      worldId: args.worldId,
      capability: 'safety.override',
      target: classification.sourceId,
      reason: args.reason,
      outcome: correlatedEventCount > 0 ? 'applied' : 'no_op',
      resultCode: correlatedEventCount > 0
        ? `SAFETY_LABEL_${args.label.toUpperCase()}`
        : `SAFETY_LABEL_${args.label.toUpperCase()}_UNCORRELATED`,
      at,
    });

    return {
      classificationId: args.classificationId,
      sourceId: classification.sourceId,
      originalLabel: classification.label,
      effectiveLabel,
      correlatedEventCount,
      createdAt: at,
      refresh: refresh.live,
      onboardingRefresh: refresh.onboarding,
      voteConsequenceRefresh: refresh.voteConsequenceModelRefs,
    };
  },
});
