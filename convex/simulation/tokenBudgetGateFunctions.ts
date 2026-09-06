/**
 * The FR-M003 accountant, reachable from an action (ART-159).
 *
 * ## Why the live path needs this and the deterministic path does not
 *
 * `createConvexBudgetPort` binds the accountant to a mutation's `ctx.db`, which is exactly right
 * while scene authoring happens inside the mutation. It cannot be right for the live path: a
 * Convex mutation may not perform network I/O, so the provider call happens in an ACTION, and an
 * action has no `ctx.db` at all. The three moments the accountant needs — reserve before the call,
 * settle or release after it — therefore become three separate transactions.
 *
 * That is not a weakening. It is what the design already described: `sceneBudget.ts` says the
 * reservation is taken BEFORE the call and the spend booked AFTER it from the provider's own
 * reported usage. Inside one mutation those two moments were indistinguishable in wall-clock
 * terms, which made `maxConcurrentCalls` unobservable — a serialized transaction can never see a
 * second call in flight. Split across three transactions with a real network call between them,
 * `inFlight` finally counts something real.
 *
 * ## Nothing is re-implemented here
 *
 * Each mutation is a one-line delegation to `createConvexBudgetPort`. The pure decision still
 * lives in `../shared/tokenBudget.ts`, the ledger and counter writes are still the ones the
 * deterministic path uses, and the idempotency rules — replay a pending grant, re-evaluate a
 * resolved one, decline a duplicate settlement — are unchanged. A second accountant that agreed
 * with the tests and disagreed with the deployed path is the specific mistake this avoids.
 *
 * `deploymentModelId` is deliberately absent: it is resolved by the caller before reserving (see
 * `SceneAuthoringPlan.requestedModel`) precisely so the reservation and the settlement name the
 * same key, and re-answering it here would give the two moments two chances to disagree.
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import type {
  BudgetDecision,
  BudgetReservationRequest,
  BudgetSettlement,
  RouteFailure,
} from '../shared/tokenBudget';
import { createConvexBudgetPort } from './tokenBudgetGate';

/**
 * The reservation request, as an action sends it.
 *
 * Spelled out field by field rather than `v.any()`: this crosses a trust boundary between two
 * Convex functions, and `module`, `importance` and `origin` are the three fields the pure model
 * narrows to unions it will not check again. A `v.any()` here would let a typo reach
 * `evaluateReservation` as a module nobody has a cap for, which reads as "unlimited".
 */
const reservationValidator = v.object({
  worldId: v.string(),
  worldDay: v.number(),
  module: v.string(),
  requestedModel: v.string(),
  importance: v.string(),
  estimatedTokens: v.number(),
  attempt: v.number(),
  origin: v.string(),
});

/** `null` for a gateway that reported no allowance, which is a state and not a missing value. */
const allowanceValidator = v.union(v.null(), v.object({
  limit: v.number(),
  remaining: v.number(),
  resetAtEpochSeconds: v.number(),
}));

export const reserveSceneBudget = internalMutation({
  args: { request: reservationValidator, decisionId: v.string(), now: v.optional(v.number()) },
  handler: (ctx, args): Promise<BudgetDecision> => createConvexBudgetPort(
    ctx.db,
    args.now ?? Date.now(),
    // Unreachable on this path and made loud rather than plausible. `requestedModel` is resolved
    // before the plan is built, so a call arriving here without one is a caller that skipped that
    // step — and answering with any placeholder would key the per-model cap on a bucket nothing
    // spends from, which is the exact failure `sceneBudgetProviderPin.test.ts` exists to prevent.
    () => Promise.reject(new Error('BUDGET_DEPLOYMENT_MODEL_NOT_RESOLVED')),
  ).reserve(args.request as BudgetReservationRequest, args.decisionId),
});

export const settleSceneBudget = internalMutation({
  args: {
    request: reservationValidator,
    decisionId: v.string(),
    settlement: v.object({
      module: v.string(),
      model: v.string(),
      resolvedModel: v.union(v.null(), v.string()),
      upstreamProvider: v.union(v.null(), v.string()),
      allowance: allowanceValidator,
      importance: v.string(),
      tokens: v.number(),
      countedAsRetry: v.boolean(),
      onFastModel: v.boolean(),
    }),
    now: v.optional(v.number()),
  },
  handler: (ctx, args): Promise<void> => createConvexBudgetPort(
    ctx.db, args.now ?? Date.now(),
    () => Promise.reject(new Error('BUDGET_DEPLOYMENT_MODEL_NOT_RESOLVED')),
  ).settle(
    args.request as BudgetReservationRequest,
    args.decisionId,
    args.settlement as BudgetSettlement,
  ),
});

export const releaseSceneBudget = internalMutation({
  args: {
    request: reservationValidator,
    decisionId: v.string(),
    /**
     * Which route failed, or `null` when the caller could not say.
     *
     * ART-158 AC#8: a released call books no tokens and no request — it ran nothing — but a route
     * that keeps erroring has to be visible as failing rather than as quiet, so the attribution
     * travels even though the spend does not.
     */
    failure: v.union(v.null(), v.object({
      provider: v.union(v.null(), v.string()),
      model: v.union(v.null(), v.string()),
      kind: v.string(),
    })),
    now: v.optional(v.number()),
  },
  handler: (ctx, args): Promise<void> => createConvexBudgetPort(
    ctx.db, args.now ?? Date.now(),
    () => Promise.reject(new Error('BUDGET_DEPLOYMENT_MODEL_NOT_RESOLVED')),
  ).release(
    args.request as BudgetReservationRequest,
    args.decisionId,
    args.failure as RouteFailure | null,
  ),
});
