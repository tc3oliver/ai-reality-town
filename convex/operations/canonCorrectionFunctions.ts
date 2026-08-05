/**
 * FR-K003 audited Canon correction workflows — the authorized caller-facing surface.
 *
 * Three privileged commands, one per remediation type, all reachable by a client and
 * therefore all gated by ART-48's {@link requireOperator} as their FIRST statement.
 * There is NO second authorization mechanism, NO second commit path, and NO second
 * read-model refresh path here:
 *
 * | Command | Capability | Appends | Public content |
 * | --- | --- | --- | --- |
 * | `createCorrectionEvent`   | `canon.correct`    | a `correction` event that supersedes what the cited events said | refreshed |
 * | `createCompensationEvent` | `canon.compensate` | a `compensation` event that offsets state while the cited events still stand | refreshed |
 * | `createRetconEvent`       | `canon.retcon`     | a `retcon` event that rewrites the account, with a mandatory replacement public summary | refreshed |
 *
 * ACCEPTED HISTORY IS NEVER TOUCHED (AC#1)
 * ----------------------------------------
 * Every command appends through the shared {@link commitProposedEvent} pipeline via
 * {@link submitRemediation}. Nothing in this file reads `canonEvents` to decide
 * anything, and nothing patches or deletes a row — the canon store exposes no such
 * operation. Replay after a remediation therefore reproduces the entire log,
 * remediation included, from the same events in the same order (AC#3).
 *
 * OPERATOR + REASON (AC#2, AC#5)
 * ------------------------------
 * `reason` is a required argument, is stamped immutably onto the accepted event as
 * `metadata.remediation`, and is written to `operatorAuditLog` in the same
 * transaction with the verified operator identity, the capability, and the cited
 * event ids as the audit target.
 *
 * PUBLIC CONTENT FOLLOWS THE CORRECTION (AC#4)
 * --------------------------------------------
 * The refresh port calls ART-98's `runPostCommitPipeline` for the sequence number the
 * commit just allocated — the exact pipeline every simulated event runs — so the
 * world, character, relationship, episode, timeline, arc, primer, live and onboarding
 * read models are rebuilt and republished from the corrected history. A post-commit
 * stage failure is recorded on the run and retried by the next call; it never rolls
 * the accepted remediation back.
 */

import { mutation } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import type { GenericMutationCtx } from 'convex/server';
import { v } from 'convex/values';
import { createConvexCanonStore } from '../canon/commit';
import type { RemediationEventType } from '../canon/eventTypes';
import type { StateChange, TimeSlot } from '../canon/model';
import { stateChangeValidator } from '../canon/proposedEvent';
import { REMEDIATION_POLICY, submitRemediation, type RemediationResult } from './canonCorrection';
import { commandArgs, operatorNow, requireOperator } from './opsConsoleFunctions';
import { internalFunctionRef } from '../shared/internalFunctionRef';
import type { PostCommitOutcome, runPostCommitPipeline as runPostCommitPipelineExport } from './postCommitLiveFunctions';

const runPostCommitPipelineRef = internalFunctionRef<typeof runPostCommitPipelineExport>(
  'operations/postCommitLiveFunctions:runPostCommitPipeline',
);

/**
 * What an operator states when remediating Canon. `reason` and `worldId` come from
 * the shared {@link commandArgs}; the rest describes the event to append.
 *
 * `idempotencyKey` is caller-supplied on purpose: a retried submission returns the
 * original remediation instead of appending a second one.
 */
const remediationArgs = {
  ...commandArgs,
  targetEventIds: v.array(v.string()),
  idempotencyKey: v.string(),
  worldDay: v.number(),
  timeSlot: v.string(),
  locationId: v.optional(v.string()),
  participantIds: v.array(v.string()),
  publicSummary: v.optional(v.string()),
  stateChanges: v.array(stateChangeValidator),
  now: v.optional(v.number()),
} as const;

type RemediationArgs = {
  worldId: string;
  reason: string;
  operatorId?: string;
  operatorToken?: string;
  targetEventIds: string[];
  idempotencyKey: string;
  worldDay: number;
  timeSlot: string;
  locationId?: string;
  participantIds: string[];
  publicSummary?: string;
  stateChanges: StateChange[];
  now?: number;
};

export type RemediationCommandResult = {
  eventId: string;
  sequenceNumber: number;
  deduplicated: boolean;
  remediationType: RemediationEventType;
  supersedes: string[];
  offsets: string[];
  refresh: { runId: string; status: string };
};

/**
 * The one handler all three commands share. Authorize with the remediation type's own
 * capability, append the event, audit it, refresh public content.
 */
async function handleRemediation(
  ctx: GenericMutationCtx<DataModel>,
  args: RemediationArgs,
  remediationType: RemediationEventType,
): Promise<RemediationCommandResult> {
  const principal = await requireOperator(ctx, REMEDIATION_POLICY[remediationType].capability, args);
  const at = operatorNow(args.now);
  const result: RemediationResult = await submitRemediation(
    {
      canonStore: createConvexCanonStore(ctx.db),
      appendAudit: async (entry) => {
        await ctx.db.insert('operatorAuditLog', entry);
      },
      refreshPublicContent: async (worldId, sequenceNumber) => {
        const run: PostCommitOutcome = await ctx.runMutation(
          runPostCommitPipelineRef,
          { worldId, sourceEventSequenceNumber: sequenceNumber, now: at },
        );
        return { runId: run.runId, status: run.status };
      },
    },
    {
      principal,
      request: {
        worldId: args.worldId,
        remediationType,
        targetEventIds: args.targetEventIds,
        reason: args.reason,
        idempotencyKey: args.idempotencyKey,
        worldDay: args.worldDay,
        // Convex validators use `v.string()` for the literal-union fields, exactly as
        // the canon commit mutation does; `validateEventStructure` re-checks it.
        timeSlot: args.timeSlot as TimeSlot,
        ...(args.locationId === undefined ? {} : { locationId: args.locationId }),
        participantIds: args.participantIds,
        ...(args.publicSummary === undefined ? {} : { publicSummary: args.publicSummary }),
        stateChanges: args.stateChanges,
      },
      traceId: `ops-${remediationType}-${args.idempotencyKey}`,
      at,
    },
  );
  return {
    eventId: result.eventId,
    sequenceNumber: result.sequenceNumber,
    deduplicated: result.deduplicated,
    remediationType: result.remediationType,
    supersedes: result.supersedes,
    offsets: result.offsets,
    refresh: result.refresh,
  };
}

/**
 * Correct accepted Canon: append an event that supersedes what the cited events said.
 *
 * Use when the record is factually wrong. Because a correction restates history rather
 * than continuing it, canon validation lets it involve a character the record wrongly
 * killed and restore that life state — by APPENDING, never by editing.
 */
export const createCorrectionEvent = mutation({
  args: remediationArgs,
  handler: (ctx, args): Promise<RemediationCommandResult> =>
    handleRemediation(ctx, args as RemediationArgs, 'correction'),
});

/**
 * Compensate for accepted Canon: append an event that offsets state going forward.
 *
 * Use when the cited events genuinely happened but left the world in a state that must
 * be made whole. Their account still stands, so a compensation is held to EVERY normal
 * canon rule — it cannot resurrect anyone or act through a dead character.
 */
export const createCompensationEvent = mutation({
  args: remediationArgs,
  handler: (ctx, args): Promise<RemediationCommandResult> =>
    handleRemediation(ctx, args as RemediationArgs, 'compensation'),
});

/**
 * Retcon accepted Canon: append an event that rewrites the canonical account.
 *
 * The heaviest remediation, and the only one that REQUIRES a replacement
 * `publicSummary`, because a retcon changes the story the public was told and FR-K003
 * requires public content to follow the correction.
 */
export const createRetconEvent = mutation({
  args: remediationArgs,
  handler: (ctx, args): Promise<RemediationCommandResult> =>
    handleRemediation(ctx, args as RemediationArgs, 'retcon'),
});
