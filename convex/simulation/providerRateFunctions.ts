/**
 * The Convex seam for wall-clock provider rate metering (ART-158 AC#2).
 *
 * Plumbing only: it reads one bucket row, hands it to the pure fold in
 * `../shared/providerRateWindow.ts`, and writes what the fold decided. The window semantics, what
 * counts as a request, and why the key is the requested route all live there — this file must not
 * be where a reader goes to find out what "RPM" means.
 *
 * ## Written from an ACTION, one call at a time
 *
 * `recordProviderCall` is invoked by the live authoring action once per REAL upstream HTTP call —
 * every transport retry and every route hop, refusals included. It cannot be a mutation the
 * simulation calls once per scene, because a scene can be one call or five and the difference is
 * exactly what a rate is measuring.
 *
 * One indexed point lookup and one write per call. `by_world_route_and_bucket` resolves a single
 * row; nothing here scans a table, and the row it touches is at most one second old.
 *
 * ## The read is bounded by the window, not by the world's age
 *
 * `readProviderRateWindow` reads `by_world_and_bucket` from `windowStartFor(now)` upward. The
 * number of rows that can exist above that bound is (routes in use) × (buckets per window), which
 * does not grow with how long the world has been running. It is still capped, and a truncated read
 * SAYS so — an under-reported rate that looks complete is worse than no rate at all.
 */

import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import type { GenericDatabaseReader } from 'convex/server';
import type { DataModel, Doc } from '../_generated/dataModel';
import {
  bucketStartFor,
  foldProviderCall,
  summarizeProviderRates,
  windowStartFor,
  MAX_BUCKETS_PER_WINDOW,
  type ProviderCallRecord,
  type ProviderRateBucket,
  type ProviderRateSummary,
} from '../shared/providerRateWindow';

type ReadDb = GenericDatabaseReader<DataModel>;

/**
 * Ceiling on rows one window read may take.
 *
 * Sized as "enough for this many distinct routes at full rate". A free-only deployment configures
 * a handful of routes (`LLM_FREE_ROUTE_CHAIN`), so 8 is generous; the cap exists so that a
 * misconfiguration listing dozens of routes degrades into a REPORTED truncation rather than into
 * an unbounded read on an operator query.
 */
const MAX_WINDOW_ROUTES = 8;
export const MAX_RATE_WINDOW_ROWS = MAX_BUCKETS_PER_WINDOW * MAX_WINDOW_ROUTES;

const allowanceValidator = v.union(v.null(), v.object({
  limit: v.number(), remaining: v.number(), resetAtEpochSeconds: v.number(),
}));

const rowToBucket = (row: Doc<'providerRateBuckets'>): ProviderRateBucket => ({
  requestedModel: row.requestedModel,
  bucketStartMs: row.bucketStartMs,
  requests: row.requests,
  served: row.served,
  rateLimited: row.rateLimited,
  failed: row.failed,
  inputTokens: row.inputTokens,
  outputTokens: row.outputTokens,
  callsWithoutUsage: row.callsWithoutUsage,
  resolutions: row.resolutions.map((entry) => ({ ...entry })),
  allowance: row.allowance,
});

/**
 * Record ONE real upstream call.
 *
 * `atMs` is supplied by the caller and is real wall-clock time, NOT the surrounding action's
 * frozen `now`. That distinction is load-bearing: the frozen `now` exists so that a retried slot
 * produces the same identifiers, and using it here would drop every call in a slot into a single
 * bucket and report a minute's work as one instant.
 *
 * Deliberately NOT idempotent on a decision id, and that is correct rather than an omission: this
 * counts HTTP calls that actually happened. A retried mutation re-recording a call would
 * over-count, but a call that happened twice must be counted twice, and only the caller — which
 * made the request — can tell those apart. The caller records after the response, once per fetch.
 */
export const recordProviderCall = internalMutation({
  args: {
    worldId: v.string(),
    requestedModel: v.string(),
    resolvedModel: v.union(v.string(), v.null()),
    upstreamProvider: v.union(v.string(), v.null()),
    outcome: v.union(v.literal('served'), v.literal('rate_limited'), v.literal('failed')),
    /** `null` means the gateway reported no usage. It does NOT mean zero. */
    inputTokens: v.union(v.number(), v.null()),
    outputTokens: v.union(v.number(), v.null()),
    allowance: allowanceValidator,
    atMs: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const bucketStartMs = bucketStartFor(args.atMs);
    const existing = await ctx.db.query('providerRateBuckets')
      .withIndex('by_world_route_and_bucket', (q) => q
        .eq('worldId', args.worldId)
        .eq('requestedModel', args.requestedModel)
        .eq('bucketStartMs', bucketStartMs))
      .unique();

    const record: ProviderCallRecord = {
      requestedModel: args.requestedModel,
      resolvedModel: args.resolvedModel,
      upstreamProvider: args.upstreamProvider,
      outcome: args.outcome,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      allowance: args.allowance,
      atMs: args.atMs,
    };
    const folded = foldProviderCall(existing ? rowToBucket(existing) : null, record);
    const row = {
      schemaVersion: 1 as const,
      worldId: args.worldId,
      requestedModel: folded.requestedModel,
      bucketStartMs: folded.bucketStartMs,
      requests: folded.requests,
      served: folded.served,
      rateLimited: folded.rateLimited,
      failed: folded.failed,
      inputTokens: folded.inputTokens,
      outputTokens: folded.outputTokens,
      callsWithoutUsage: folded.callsWithoutUsage,
      resolutions: folded.resolutions.map((entry) => ({ ...entry })),
      allowance: folded.allowance,
      updatedAt: args.atMs,
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert('providerRateBuckets', row);
  },
});

export type ProviderRateWindow = {
  summaries: ProviderRateSummary[];
  windowStartMs: number;
  windowEndMs: number;
  /** True when the cap was hit, so a reader knows the rates below are a FLOOR, not a total. */
  truncated: boolean;
};

/**
 * Every route's rate over the window ending at `nowMs`.
 *
 * Shared by the operator inspection query and by the tests, so what an operator reads is what a
 * test asserts rather than two summaries that could drift.
 */
export async function readProviderRateWindow(
  db: ReadDb,
  worldId: string,
  nowMs: number,
): Promise<ProviderRateWindow> {
  const rows = await db.query('providerRateBuckets')
    .withIndex('by_world_and_bucket', (q) => q.eq('worldId', worldId).gt('bucketStartMs', windowStartFor(nowMs)))
    .take(MAX_RATE_WINDOW_ROWS + 1);
  const truncated = rows.length > MAX_RATE_WINDOW_ROWS;
  return {
    summaries: summarizeProviderRates(rows.slice(0, MAX_RATE_WINDOW_ROWS).map(rowToBucket), nowMs),
    windowStartMs: windowStartFor(nowMs),
    windowEndMs: nowMs,
    truncated,
  };
}

/** Operator-readable rates. Internal; the gated public surface is `inspectTokenBudget`. */
export const inspectProviderRates = internalQuery({
  args: { worldId: v.string(), nowMs: v.optional(v.number()) },
  handler: (ctx, args): Promise<ProviderRateWindow> =>
    readProviderRateWindow(ctx.db, args.worldId, args.nowMs ?? Date.now()),
});
