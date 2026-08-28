/**
 * The Convex-backed FR-M003 accountant (ART-59) — the read/write seam for budget enforcement.
 *
 * The counterpart of `./moduleConfig.ts`: that file is how a CONFIGURED value reaches a provider
 * call, this one is how a LIMIT does. The chain is
 *
 *   tokenBudgetPolicies row ─┐
 *   moduleModelConfigs row  ─┼→ evaluateReservation → tokenBudgetLedger (audit)
 *   tokenBudgetCounters row ─┘                      → tokenBudgetCounters (grant / refuse)
 *                                                   → the model the provider is actually called with
 *
 * The pure decision lives in `../shared/tokenBudget.ts` and takes no clock and no database. This
 * module is only the plumbing: it reads three rows, hands them to the pure model, and writes what
 * the pure model decided. That split is what makes AC#2's determinism testable without a
 * deployment, and it is the same split ART-52 used between `moduleModelConfig.ts` and
 * `moduleModelConfigFunctions.ts`.
 *
 * ## Every read here is an indexed point lookup
 *
 * This runs once per provider ATTEMPT on the live path. `by_world_current`,
 * `by_world_and_day` and `by_decision_id` each resolve one row; nothing collects a table and
 * nothing scans the world. The version history of a policy and the ledger both only grow, so a
 * scan of either would get slower every day the world runs — which is exactly the shape of bug
 * that does not show up until the world has been running for a month.
 *
 * ## Why the per-module budget is read from ART-52's table
 *
 * `moduleDailyTokenBudget` comes from `resolveModuleConfig`, not from a copy in the policy row.
 * FR-M003's 每模組上限 and FR-K005's `dailyTokenBudget` are the same number, and storing it twice
 * would mean an operator could change it in the console and watch the enforcement keep using the
 * other copy.
 */

import type { GenericDatabaseReader, GenericDatabaseWriter } from 'convex/server';
import type { DataModel, Doc } from '../_generated/dataModel';
import {
  buildBudgetLedgerEntry,
  emptyBudgetCounters,
  evaluateReservation,
  applyReservationDecision,
  isReplayableGrant,
  releaseReservation,
  resolveEffectiveTokenBudgetPolicy,
  settleReservation,
  isOverBudgetStrategy,
  type BudgetCounters,
  type BudgetDecision,
  type BudgetLedgerEntry,
  type StoredBudgetLedgerEntry,
  type BudgetLimit,
  type BudgetReservationRequest,
  type BudgetSettlement,
  type EffectiveTokenBudgetPolicy,
  type OverBudgetStrategy,
  type WorkImportance,
} from '../shared/tokenBudget';
import { resolveModuleConfig } from './moduleConfig';
import type { WorldDayBudgetPort } from './sceneBudget';

type ReadDb = GenericDatabaseReader<DataModel>;
type WriteDb = GenericDatabaseWriter<DataModel>;

/**
 * The world's current budget policy, or the documented defaults.
 *
 * `overBudgetStrategy` is stored as `v.string()` (the enumeration is owned by the pure model) and
 * is narrowed here. A row naming a strategy this build no longer knows resolves to the DEFAULTS
 * rather than throwing, for the reason `resolveEffectiveModuleConfig` does the same: a policy row
 * written by a newer build must not be able to stop an older one simulating.
 */
export async function resolveTokenBudgetPolicy(
  db: ReadDb,
  worldId: string,
): Promise<EffectiveTokenBudgetPolicy> {
  const row = await db
    .query('tokenBudgetPolicies')
    .withIndex('by_world_current', (q) => q.eq('worldId', worldId).eq('isCurrent', true))
    .unique();
  if (!row) return resolveEffectiveTokenBudgetPolicy(null);
  if (!isOverBudgetStrategy(row.overBudgetStrategy)) return resolveEffectiveTokenBudgetPolicy(null);
  return resolveEffectiveTokenBudgetPolicy({
    version: row.version,
    worldDailyTokenBudget: row.worldDailyTokenBudget,
    modelDailyTokenBudgets: row.modelDailyTokenBudgets.map((entry) => ({ ...entry })),
    maxConcurrentCalls: row.maxConcurrentCalls,
    retryTokenBudget: row.retryTokenBudget,
    maxRetryTokenShare: row.maxRetryTokenShare,
    fastModelClass: row.fastModelClass,
    overBudgetStrategy: row.overBudgetStrategy,
  });
}

function toCounters(row: Doc<'tokenBudgetCounters'>): BudgetCounters {
  return {
    schemaVersion: 1,
    worldId: row.worldId,
    worldDay: row.worldDay,
    totalTokens: row.totalTokens,
    retryTokens: row.retryTokens,
    tokensByModule: row.tokensByModule.map((entry) => ({ ...entry })),
    tokensByModel: row.tokensByModel.map((entry) => ({ ...entry })),
    inFlight: row.inFlight,
    grantedCalls: row.grantedCalls,
    settledCalls: row.settledCalls,
    refusedCalls: row.refusedCalls,
    lowImportanceCalls: row.lowImportanceCalls,
    lowImportanceCallsOnFastModel: row.lowImportanceCallsOnFastModel,
    modelMeteringMismatches: row.modelMeteringMismatches,
  };
}

/** The day's counters, or a zeroed record. A world day with no row has spent nothing. */
export async function loadBudgetCounters(
  db: ReadDb,
  worldId: string,
  worldDay: number,
): Promise<BudgetCounters> {
  const row = await db
    .query('tokenBudgetCounters')
    .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).eq('worldDay', worldDay))
    .unique();
  return row === null ? emptyBudgetCounters(worldId, worldDay) : toCounters(row);
}

/** Persist counters, inserting the day's row the first time it is needed. */
async function writeCounters(db: WriteDb, counters: BudgetCounters): Promise<void> {
  const existing = await db
    .query('tokenBudgetCounters')
    .withIndex('by_world_and_day', (q) => q.eq('worldId', counters.worldId).eq('worldDay', counters.worldDay))
    .unique();
  const row = {
    schemaVersion: 1 as const,
    worldId: counters.worldId,
    worldDay: counters.worldDay,
    totalTokens: counters.totalTokens,
    retryTokens: counters.retryTokens,
    tokensByModule: counters.tokensByModule.map((entry) => ({ ...entry })),
    tokensByModel: counters.tokensByModel.map((entry) => ({ ...entry })),
    inFlight: counters.inFlight,
    grantedCalls: counters.grantedCalls,
    settledCalls: counters.settledCalls,
    refusedCalls: counters.refusedCalls,
    lowImportanceCalls: counters.lowImportanceCalls,
    lowImportanceCallsOnFastModel: counters.lowImportanceCallsOnFastModel,
    modelMeteringMismatches: counters.modelMeteringMismatches,
  };
  if (existing) await db.patch(existing._id, row);
  else await db.insert('tokenBudgetCounters', row);
}

function toLedgerEntry(row: Doc<'tokenBudgetLedger'>): StoredBudgetLedgerEntry {
  return {
    schemaVersion: 1,
    worldId: row.worldId,
    worldDay: row.worldDay,
    decisionId: row.decisionId,
    module: row.module,
    requestedModel: row.requestedModel,
    model: row.model,
    importance: row.importance as WorkImportance,
    origin: row.origin as BudgetLedgerEntry['origin'],
    attempt: row.attempt,
    countedAsRetry: row.countedAsRetry,
    estimatedTokens: row.estimatedTokens,
    onFastModel: row.onFastModel,
    outcome: row.outcome as BudgetDecision['outcome'],
    strategy: row.strategy as OverBudgetStrategy | null,
    strategyFallbackReason: row.strategyFallbackReason as BudgetLedgerEntry['strategyFallbackReason'],
    routingReason: row.routingReason as BudgetDecision['routingReason'],
    boundLimit: row.boundLimit as BudgetLimit | null,
    breachedLimits: row.breachedLimits as BudgetLimit[],
    observedTotalTokens: row.observedTotalTokens,
    observedRetryTokens: row.observedRetryTokens,
    observedModuleTokens: row.observedModuleTokens,
    observedModelTokens: row.observedModelTokens,
    observedInFlight: row.observedInFlight,
    policyVersion: row.policyVersion,
    recordedAt: row.recordedAt,
    // How it ENDED, carried through to the operator read. A ledger that stopped at the decision
    // could not answer "did this call actually run, and on which model" — which is precisely the
    // question a metering mismatch makes someone ask.
    resolution: row.resolution,
    settledTokens: row.settledTokens,
    settledModel: row.settledModel,
  };
}

/** Every ledger row for one world day, oldest first. Index-scoped; never a whole-table read. */
export async function listBudgetLedger(
  db: ReadDb,
  worldId: string,
  worldDay: number,
  limit: number,
): Promise<StoredBudgetLedgerEntry[]> {
  const rows = await db
    .query('tokenBudgetLedger')
    .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).eq('worldDay', worldDay))
    .take(limit);
  return rows.map(toLedgerEntry);
}

/**
 * The ledger row for `decisionId` if — and only if — it is still awaiting resolution.
 *
 * `null` for a row already settled or released, which is what makes settlement idempotent: a
 * retried Convex mutation re-runs the whole scene attempt, and a settlement that could not
 * recognise its own second run would book one provider call's tokens twice. `null` for a MISSING
 * row too, because a settlement with no reservation is not a spend this system granted, and
 * booking it would let an unreserved call add to the day's totals.
 */
async function resolvablePending(
  db: WriteDb,
  decisionId: string,
): Promise<Doc<'tokenBudgetLedger'> | null> {
  const row = await db
    .query('tokenBudgetLedger')
    .withIndex('by_decision_id', (q) => q.eq('decisionId', decisionId))
    .unique();
  return row !== null && row.resolution === 'pending' ? row : null;
}

/**
 * Rebuild the stored decision from its ledger row, for the grant-replay path.
 *
 * Every field comes off the row, including the counter snapshot: a replay must return what was
 * DECIDED, not what a fresh look at the counters would decide now. That is the whole point of
 * replaying rather than re-evaluating.
 */
function replayDecision(row: Doc<'tokenBudgetLedger'>): BudgetDecision {
  const entry = toLedgerEntry(row);
  return {
    schemaVersion: 1,
    outcome: entry.outcome,
    model: entry.model,
    routingReason: entry.routingReason,
    onFastModel: entry.onFastModel,
    strategy: entry.strategy,
    strategyFallbackReason: entry.strategyFallbackReason,
    boundLimit: entry.boundLimit,
    breachedLimits: entry.breachedLimits,
    countedAsRetry: entry.countedAsRetry,
    estimatedTokens: entry.estimatedTokens,
    observed: {
      totalTokens: entry.observedTotalTokens,
      retryTokens: entry.observedRetryTokens,
      moduleTokens: entry.observedModuleTokens,
      modelTokens: entry.observedModelTokens,
      inFlight: entry.observedInFlight,
    },
  };
}

/**
 * Bind the pure accountant to `ctx.db` for one mutation.
 *
 * `now` is a parameter of the surrounding mutation, exactly as `operatorNow` is for the console.
 * It reaches ONLY `recordedAt` on the audit row — never the decision — so the same reservation
 * evaluated twice a day apart still names the same bound limit and the same strategy (AC#2).
 */
export function createConvexBudgetPort(
  db: WriteDb,
  now: number,
  deploymentModel: () => Promise<string>,
): WorldDayBudgetPort {
  return {
    deploymentModelId: deploymentModel,

    async reserve(request: BudgetReservationRequest, decisionId: string): Promise<BudgetDecision> {
      const existing = await db
        .query('tokenBudgetLedger')
        .withIndex('by_decision_id', (q) => q.eq('decisionId', decisionId))
        .unique();
      // Projected once, so `outcome` and `resolution` are the pure model's narrowed unions rather
      // than the schema's `v.string()`. Both are decided by the pure model, so both are read
      // through its own projection rather than re-narrowed by hand here.
      const prior = existing === null ? null : toLedgerEntry(existing);

      // Replay ONLY a grant that is still pending. `decisionId` is derived from the scene, so the
      // same id recurs across the original run and any later operator `run.retry`, and the three
      // cases need three different answers:
      //
      // - PENDING GRANT — replay verbatim. A Convex mutation can be retried mid-flight, and
      //   re-granting would take a second concurrency slot for one in-flight provider call.
      // - REFUSAL — re-evaluate. Replaying it made the refusal permanent, so neither retrying the
      //   slot nor raising the cap could clear it (M2). It booked no spend and holds no slot.
      // - RESOLVED GRANT — re-evaluate. This is the case that made the retry path spend unmetered
      //   tokens. The row describes a call that already COMPLETED; the caller asking again is
      //   about to make a NEW provider call. Handing back the old grant gave it a reservation that
      //   no longer existed, and `settle` then declined as already-resolved — so the call happened
      //   and its tokens were never booked. Silently: no row, no counter, nothing in the report.
      //   Re-evaluating counts it like the new call it is.
      if (existing && prior && isReplayableGrant(prior)) return replayDecision(existing);

      const policy = await resolveTokenBudgetPolicy(db, request.worldId);
      // ART-52 owns the per-module cap. Read from there, never copied into the policy row.
      const moduleConfig = await resolveModuleConfig(db, request.worldId, request.module);
      const counters = await loadBudgetCounters(db, request.worldId, request.worldDay);
      const decision = evaluateReservation({
        policy,
        moduleDailyTokenBudget: moduleConfig.dailyTokenBudget,
        counters,
        request,
      });

      const granted = decision.outcome === 'allowed';
      const row = {
        ...buildBudgetLedgerEntry({
          request,
          decision,
          decisionId,
          policyVersion: policy.version,
          recordedAt: now,
        }),
        breachedLimits: [...decision.breachedLimits],
        schemaVersion: 1 as const,
        // A refusal granted nothing, so there is nothing left to resolve and it is born settled
        // with zero tokens. Leaving it `pending` would leave the ledger full of rows that look
        // like calls still in flight.
        resolution: granted ? ('pending' as const) : ('settled' as const),
        settledTokens: granted ? null : 0,
        settledModel: null,
      };

      if (existing) {
        // The row is REPLACED rather than appended beside, so `refusedCalls` keeps equalling the
        // number of `over_budget` rows instead of counting how many times an operator pressed
        // retry. One row per scene-attempt, always describing its most recent decision; the
        // cumulative call counts live in the counters, which is where they can exceed 1.
        await db.patch(existing._id, row);
        await writeCounters(db, applyReservationDecision(counters, decision,
          prior?.outcome === 'over_budget' ? 'refusal' : 'resolved_grant'));
        return decision;
      }

      await db.insert('tokenBudgetLedger', row);
      await writeCounters(db, applyReservationDecision(counters, decision, 'none'));
      return decision;
    },

    async settle(
      request: BudgetReservationRequest,
      decisionId: string,
      settlement: BudgetSettlement,
    ): Promise<void> {
      const row = await resolvablePending(db, decisionId);
      if (!row) return;
      const counters = await loadBudgetCounters(db, request.worldId, request.worldDay);
      await writeCounters(db, settleReservation(counters, settlement));
      await db.patch(row._id, {
        resolution: 'settled',
        settledTokens: settlement.tokens,
        settledModel: settlement.reportedModel,
      });
    },

    async release(request: BudgetReservationRequest, decisionId: string): Promise<void> {
      const row = await resolvablePending(db, decisionId);
      if (!row) return;
      const counters = await loadBudgetCounters(db, request.worldId, request.worldDay);
      await writeCounters(db, releaseReservation(counters));
      await db.patch(row._id, { resolution: 'released', settledTokens: null, settledModel: null });
    },
  };
}
