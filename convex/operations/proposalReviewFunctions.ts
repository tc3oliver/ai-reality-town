/**
 * The authenticated proposed-event review surface (FR-K002, NFR-005).
 *
 * These are the only caller-facing entry points for event review. Both are
 * public Convex `query` functions — reachable by a client — and both call
 * {@link authorizeOperator} as their FIRST statement, before any row is read, so
 * an unauthorized caller cannot learn whether a world, scene, or proposal exists
 * (the console's uniform-denial rule, FR-K001 AC#3).
 *
 * AUTHORIZATION IS ART-48'S, UNCHANGED
 * ------------------------------------
 * Review reuses the operations console's single decision point verbatim: the
 * `SIMULATION_OPS_OPERATORS` registry, the `viewer < operator < admin` role
 * order, the identity-then-ops-token principal resolution, and the uniform
 * `OPS_UNAUTHORIZED` denial. Review is a READ, so it is gated on the existing
 * `world.inspect` capability rather than a new one — a role that may already
 * inspect world state is exactly the role that may read why an event was
 * accepted or rejected.
 *
 * NOTHING HERE MUTATES
 * --------------------
 * Review never writes, so it appends no `operatorAuditLog` row: that table
 * records privileged *mutations*, and a read that logged would let any caller
 * grow the audit trail. Reads remain observable in the Convex function logs.
 *
 * REDACTION IS ROLE-DRIVEN (AC#2)
 * -------------------------------
 * The trace projection is chosen from the AUTHENTICATED principal's role, never
 * from caller input: a read-only `viewer` receives the ART-57 public trace
 * projection and no provider-supplied proposal metadata, `operator`/`admin`
 * receive the full ART-57 accounting record, which by ART-57's write-side
 * contract can never contain a prompt, a response body, or a secret.
 */

import { query } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import type { GenericQueryCtx } from 'convex/server';
import { v } from 'convex/values';
import {
  authorizeOperator,
  parseOperatorRegistry,
  type OperatorPrincipal,
} from './operatorAuthorization';
import type { ProposalReviewFilter } from './proposalReview';
import { listProposalReviews, readProposalReview } from './proposalReviewStore';

type QueryCtx = GenericQueryCtx<DataModel>;

/**
 * Credentials every review call carries, identical to the console's. A verified
 * `ctx.auth` identity is preferred; the ops token is the bootstrap path used
 * until the deployment has an identity provider.
 */
const credentialArgs = {
  operatorId: v.optional(v.string()),
  operatorToken: v.optional(v.string()),
} as const;

/**
 * THE gate. Identical to the console's: verified Convex identity plus the
 * server-only registry, with the whole decision delegated to the pure policy
 * module. Review is read-only, so it requires `world.inspect`.
 */
async function requireReviewer(
  ctx: QueryCtx,
  args: { worldId: string; operatorId?: string; operatorToken?: string },
): Promise<OperatorPrincipal> {
  const identity = await ctx.auth.getUserIdentity();
  return authorizeOperator({
    credentials: { identity, token: args.operatorToken, operatorId: args.operatorId },
    registry: parseOperatorRegistry(process.env.SIMULATION_OPS_OPERATORS),
    capability: 'world.inspect',
    worldId: args.worldId,
  });
}

/**
 * Server-side filters (AC#2). Every filter is an exact match on an already
 * structured field — a world day, a slot, a stable code, an id — so filtering
 * never needs to interpret free text.
 */
const filterArgs = {
  worldDay: v.optional(v.number()),
  timeSlot: v.optional(v.string()),
  sceneId: v.optional(v.string()),
  eventType: v.optional(v.string()),
  disposition: v.optional(v.union(
    v.literal('committed'), v.literal('rejected'), v.literal('withheld'), v.literal('pending'),
  )),
  validationResult: v.optional(v.union(
    v.literal('accepted'), v.literal('rejected'), v.literal('not_run'),
  )),
  safetyLabel: v.optional(v.union(
    v.literal('allow'), v.literal('allow_with_warning'),
    v.literal('withhold'), v.literal('human_review_required'),
  )),
  reasonCode: v.optional(v.string()),
  participantId: v.optional(v.string()),
  arcId: v.optional(v.string()),
} as const;

/**
 * FR-K002: the reviewable proposals for a world, newest world time first.
 *
 * One row per proposed event, each carrying its Validation Result, Rejection
 * Reason code, Model Trace, Participants, State Changes, Related Arcs, and
 * Safety Label.
 */
export const listProposedEventReviews = query({
  args: { ...credentialArgs, worldId: v.string(), ...filterArgs, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const principal = await requireReviewer(ctx, args);
    const filter: ProposalReviewFilter = {
      ...(args.worldDay === undefined ? {} : { worldDay: args.worldDay }),
      ...(args.timeSlot === undefined ? {} : { timeSlot: args.timeSlot }),
      ...(args.sceneId === undefined ? {} : { sceneId: args.sceneId }),
      ...(args.eventType === undefined ? {} : { eventType: args.eventType }),
      ...(args.disposition === undefined ? {} : { disposition: args.disposition }),
      ...(args.validationResult === undefined ? {} : { validationResult: args.validationResult }),
      ...(args.safetyLabel === undefined ? {} : { safetyLabel: args.safetyLabel }),
      ...(args.reasonCode === undefined ? {} : { reasonCode: args.reasonCode }),
      ...(args.participantId === undefined ? {} : { participantId: args.participantId }),
      ...(args.arcId === undefined ? {} : { arcId: args.arcId }),
    };
    return listProposalReviews(ctx.db, {
      worldId: args.worldId, role: principal.role, filter, limit: args.limit,
    });
  },
});

/** FR-K002: the full review record for one proposal, addressed by its idempotency key. */
export const reviewProposedEvent = query({
  args: { ...credentialArgs, worldId: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireReviewer(ctx, args);
    return readProposalReview(ctx.db, {
      worldId: args.worldId, role: principal.role, idempotencyKey: args.idempotencyKey,
    });
  },
});
