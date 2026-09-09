/**
 * FR-K001 / ART-172 — the operator command that promotes a world to public, and demotes it back.
 *
 * | Command | Capability | Applies |
 * | --- | --- | --- |
 * | `changeWorldMode` | `world.change_mode` | `worldSchedules.mode` ← `development` \| `public` |
 *
 * ## Why this had to exist
 *
 * `worldSchedules.mode` decides which crons touch a world: `tickAllPublicSchedules`, the
 * runtime-snapshot cron and the vote cron all bind `by_mode_and_status` on `("public","running")`.
 * It is the single switch between a private development world and the public acceptance
 * environment.
 *
 * **Nothing could change it.** `configureSchedule` is the only writer of the column and it refuses
 * outright once a schedule exists (`SCHEDULE_ALREADY_EXISTS`); `pauseWorld` and `resumeWorld` move
 * `status`, not `mode`. So promoting Mistwood meant hand-patching the row in the Convex dashboard —
 * unaudited, unreasoned, and invisible to `operatorAuditLog`. Every other privileged world action
 * on this console is authorized, reasoned and audited; the one with the largest blast radius was
 * not reachable at all. ART-138 records the consequence: its AC#10 could not be satisfied by any
 * command this repository offered.
 *
 * ## Admin-only, for the reason `snapshot.create` and `world.emergency_stop` are
 *
 * Promotion starts a sixty-second cron against a world. That is what exhausted the deployment
 * quota once already, and it is a decision about what the public sees, so it sits with the
 * capabilities reserved for an administrator rather than with `world.pause`.
 *
 * ## Nothing about the decision is decided here
 *
 * The rule — promotion requires a running, un-stopped world; demotion is allowed from any state;
 * a repeat is a no-op — is `planScheduleModeChange`'s, a pure function in `simulation/scheduler.ts`
 * tested against state directly. This file owns authorization, the audit row, and nothing else.
 * A second copy of "when may a world be promoted" is the shape of defect this repository has had
 * before: two answers to one question, disagreeing on the day it matters.
 */

import { mutation } from '../_generated/server';
import { v } from 'convex/values';

import { changeWorldScheduleMode } from '../simulation/schedulerOperations';
import { commandArgs, operatorNow, recordAudit, requireOperator } from './opsConsoleFunctions';

export class WorldModeControlError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'WorldModeControlError';
  }
}

export type WorldModeChangeResult = {
  worldId: string;
  /** The mode the world was in, read from the row rather than assumed from the request. */
  previousMode: string;
  /** The mode it is in now. Equal to `previousMode` on a no-op, which is the honest answer. */
  mode: string;
  /** False when the world was already in the target mode. Still audited — see below. */
  changed: boolean;
  resultCode: string;
};

/**
 * Move a world between `development` and `public`.
 *
 * `targetMode` is a two-literal union rather than the schedule's full four. `test` and `warmup`
 * are configuration-time modes a harness sets when it creates a schedule; moving a live world into
 * one would detach it from every cron while reading like an ordinary mode change.
 */
export const changeWorldMode = mutation({
  args: {
    ...commandArgs,
    targetMode: v.union(v.literal('development'), v.literal('public')),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<WorldModeChangeResult> => {
    const principal = await requireOperator(ctx, 'world.change_mode', args);
    const at = operatorNow(args.now);
    // Checked before the write, not left to `recordAudit`: NFR-005 requires a privileged mutation
    // to be reasoned BEFORE it applies, and "the write is rolled back" is a weaker property to
    // rely on than "the write never happened". Same argument `safetyOverrideFunctions` makes.
    if (args.reason.trim().length === 0) {
      throw new WorldModeControlError('WORLD_MODE_REASON_REQUIRED', 'a non-empty reason is required');
    }

    const plan = await changeWorldScheduleMode(ctx.db, args.worldId, {
      targetMode: args.targetMode, now: at,
    });

    // A repeat is audited as a `no_op` rather than dropped. An operator who ran the promotion
    // twice, or two operators who each thought they had, are facts the trail should carry: the
    // alternative is a log in which the second attempt never happened.
    await recordAudit(ctx, {
      principal,
      worldId: args.worldId,
      capability: 'world.change_mode',
      target: args.worldId,
      reason: args.reason,
      outcome: plan.changed ? 'applied' : 'no_op',
      resultCode: plan.resultCode,
      at,
    });

    return {
      worldId: args.worldId,
      previousMode: plan.from,
      mode: plan.changed ? plan.to : plan.from,
      changed: plan.changed,
      resultCode: plan.resultCode,
    };
  },
});
