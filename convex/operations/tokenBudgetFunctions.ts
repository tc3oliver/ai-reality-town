/**
 * Convex wiring for FR-M003 token budget controls (ART-59).
 *
 * | Command                  | Capability       | Effect                                            |
 * | ------------------------ | ---------------- | ------------------------------------------------- |
 * | `setTokenBudgetPolicy`   | `budget.write`   | appends a versioned world budget policy           |
 * | `inspectTokenBudget`     | `budget.inspect` | the policy, the day's counters, and the §16.3 report |
 * | `listTokenBudgetLedger`  | `budget.inspect` | the audit trail of budget decisions for a world day |
 *
 * ## One gate, not a second one
 *
 * `requireOperator` and `recordAudit` come from `opsConsoleFunctions`, so these commands inherit
 * the WHOLE gate — fail-closed on an unset registry, the identity-over-token precedence, the
 * uniform `OPS_UNAUTHORIZED` denial raised before any row is read, and an audit row written inside
 * the command's own transaction. `pauseWorld` set the ordering (authorize FIRST, act, then audit)
 * and ART-52 followed it; this follows it too.
 *
 * ## Two audit trails, and neither replaces the other
 *
 * `operatorAuditLog` records that a HUMAN changed the budget and why. `tokenBudgetLedger` records
 * what the SYSTEM then did with it — every reservation, granted or refused, with the counters it
 * was measured against. Reconstructing the second from the first is impossible: an audit row
 * carries a reason, not a refusal.
 *
 * ## Not on the public read path, and structurally unable to be
 *
 * Every function here is operator-gated. That is not only policy: `sanitizeForPublic`
 * (`convex/publicRead/readModel.ts`) strips every key matching `/token/i`, so a payload carrying
 * `totalTokens` or `retryTokens` would be silently emptied rather than caught. Budgets are an
 * operator concern and stay one — which is also why the §16.3 "public reads never trigger LLM
 * generation" measurement can honestly report a structural zero.
 */

import { v } from 'convex/values';

import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import {
  commitTokenBudgetPolicy,
  isOverBudgetStrategy,
  resolveEffectiveTokenBudgetPolicy,
  summarizeResourceUsage,
  TOKEN_BUDGET_POLICY_DEFAULTS,
  TokenBudgetError,
  type BudgetCounters,
  type EffectiveTokenBudgetPolicy,
  type OverBudgetStrategy,
  type ResourceUsageReport,
  type StoredBudgetLedgerEntry,
  type StoredTokenBudgetPolicy,
  type TokenBudgetPolicy,
  type TokenBudgetPolicyRecord,
  type TokenBudgetPolicyStore,
} from '../shared/tokenBudget';
import { resolveModuleConfig } from '../simulation/moduleConfig';
import { CONFIGURABLE_MODULES } from '../shared/moduleModelConfig';
import { listBudgetLedger, loadBudgetCounters } from '../simulation/tokenBudgetGate';
import {
  commandArgs,
  credentialArgs,
  operatorNow,
  recordAudit,
  requireOperator,
} from './opsConsoleFunctions';

/** How many world days of counters one report may span. */
const MAX_REPORT_WORLD_DAYS = 90;
/**
 * Total ledger rows one report may read, across every world day in its range.
 *
 * A Convex query refuses to read more than 16,384 documents. This budget is deliberately well
 * under that: the same query also reads one counter row per world day (up to 90), one
 * configuration row per module, and the policy, and a limit set at the platform ceiling would turn
 * a wide inspect into a thrown query rather than a clamped answer.
 */
const MAX_REPORT_LEDGER_ROWS = 8_000;
/** How many ledger rows one read returns, clamped the way `listOperatorAudit` clamps its own. */
const DEFAULT_LEDGER_LIMIT = 50;
const MAX_LEDGER_LIMIT = 500;

function toStored(row: Doc<'tokenBudgetPolicies'>): StoredTokenBudgetPolicy {
  return {
    id: row._id,
    schemaVersion: 1,
    worldId: row.worldId,
    version: row.version,
    worldDailyTokenBudget: row.worldDailyTokenBudget,
    modelDailyTokenBudgets: row.modelDailyTokenBudgets.map((entry) => ({ ...entry })),
    maxConcurrentCalls: row.maxConcurrentCalls,
    retryTokenBudget: row.retryTokenBudget,
    maxRetryTokenShare: row.maxRetryTokenShare,
    fastModelClass: row.fastModelClass,
    // Narrowed here rather than in the schema, for the reason `moduleModelConfigs.module` is:
    // the enumeration is owned by the pure model. A row naming a strategy this build does not
    // know can still be READ — history must stay readable — while `resolveEffectiveTokenBudgetPolicy`
    // decides whether it is safe to ACT on.
    overBudgetStrategy: row.overBudgetStrategy as OverBudgetStrategy,
    contentHash: row.contentHash,
    actor: row.actor,
    reason: row.reason,
    createdAt: row.createdAt,
    isCurrent: row.isCurrent,
  };
}

async function readCurrent(
  ctx: QueryCtx | MutationCtx,
  worldId: string,
): Promise<StoredTokenBudgetPolicy | null> {
  const row = await ctx.db
    .query('tokenBudgetPolicies')
    .withIndex('by_world_current', (q) => q.eq('worldId', worldId).eq('isCurrent', true))
    .unique();
  return row === null ? null : toStored(row);
}

/**
 * Adapt `ctx.db` to the pure model's store.
 *
 * `demote` is the ONLY patch this surface performs, and it touches exactly one boolean. A stored
 * policy's numbers are never edited: a change appends a version, which is what makes the table an
 * account of decisions rather than a snapshot of the latest one.
 */
function createTokenBudgetPolicyStore(ctx: MutationCtx): TokenBudgetPolicyStore {
  return {
    findCurrent: (worldId) => readCurrent(ctx, worldId),
    insertVersion: (row: TokenBudgetPolicyRecord) => ctx.db.insert('tokenBudgetPolicies', {
      ...row,
      modelDailyTokenBudgets: row.modelDailyTokenBudgets.map((entry) => ({ ...entry })),
    }),
    demote: (rowId: string) => ctx.db.patch(rowId as Id<'tokenBudgetPolicies'>, { isCurrent: false }),
  };
}

/**
 * The policy as mutation arguments. Every field is REQUIRED, for the reason ART-52's
 * `settingsArgs` are: a partial update would mean the stored version does not describe a complete
 * policy, and the content hash that makes a resubmission deduplicate would be computed over a
 * merge of the request and whatever happened to be current — so "the same policy" would stop
 * being a property of the request.
 */
const policyArgs = {
  worldDailyTokenBudget: v.union(v.number(), v.null()),
  modelDailyTokenBudgets: v.array(v.object({ model: v.string(), dailyTokenBudget: v.number() })),
  maxConcurrentCalls: v.union(v.number(), v.null()),
  retryTokenBudget: v.union(v.number(), v.null()),
  maxRetryTokenShare: v.union(v.number(), v.null()),
  fastModelClass: v.union(v.string(), v.null()),
  overBudgetStrategy: v.string(),
} as const;

/**
 * FR-M003 AC#2 — configure the world's budget policy, versioned, authorized and audited.
 *
 * Idempotent by content hash: resubmitting a byte-identical policy returns `deduplicated: true`,
 * appends no version, and still records a `no_op` in the operator audit trail — an operator
 * pressing save on an unchanged form is part of the account of what happened.
 */
export const setTokenBudgetPolicy = mutation({
  args: { ...commandArgs, ...policyArgs, now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const principal = await requireOperator(ctx, 'budget.write', args);
    const at = operatorNow(args.now);
    if (!isOverBudgetStrategy(args.overBudgetStrategy)) {
      throw new TokenBudgetError(
        'TOKEN_BUDGET_INVALID',
        `unknown overBudgetStrategy: ${args.overBudgetStrategy}`,
      );
    }
    const policy: TokenBudgetPolicy = {
      worldDailyTokenBudget: args.worldDailyTokenBudget,
      modelDailyTokenBudgets: args.modelDailyTokenBudgets,
      maxConcurrentCalls: args.maxConcurrentCalls,
      retryTokenBudget: args.retryTokenBudget,
      maxRetryTokenShare: args.maxRetryTokenShare,
      fastModelClass: args.fastModelClass,
      overBudgetStrategy: args.overBudgetStrategy,
    };
    const result = await commitTokenBudgetPolicy(createTokenBudgetPolicyStore(ctx), {
      worldId: args.worldId,
      policy,
      actor: principal.operatorId,
      reason: args.reason,
      now: at,
    });
    await recordAudit(ctx, {
      principal,
      worldId: args.worldId,
      capability: 'budget.write',
      target: `budget:v${result.version}`,
      reason: args.reason,
      outcome: result.deduplicated ? 'no_op' : 'applied',
      resultCode: result.deduplicated ? 'OPS_NO_OP' : 'OPS_OK',
      at,
    });
    return { version: result.version, contentHash: result.contentHash, deduplicated: result.deduplicated };
  },
});

export type TokenBudgetInspection = {
  worldId: string;
  policy: EffectiveTokenBudgetPolicy & {
    contentHash: string | null;
    actor: string | null;
    reason: string | null;
    createdAt: number | null;
  };
  /** ART-52's per-module caps, shown beside the world policy so the delegation is visible. */
  moduleDailyTokenBudgets: ReadonlyArray<{ module: string; dailyTokenBudget: number | null }>;
  counters: readonly BudgetCounters[];
  report: ResourceUsageReport;
};

/**
 * FR-M003 AC#3 — what this world may spend, what it has spent, and the §16.3 measurements.
 *
 * The per-module caps are returned NEXT TO the world policy rather than folded into it, because
 * they are ART-52's and are read from ART-52's table. Merging them would make the console look
 * like one configuration surface and leave an operator unable to tell which console screen
 * changes which number.
 *
 * The window is a world-day RANGE, not a wall-clock one, because that is the unit every limit is
 * enforced in — a report windowed by hours could not answer "was the daily cap complied with".
 * The range is clamped to {@link MAX_REPORT_WORLD_DAYS} and the clamp is REPORTED, never applied
 * silently: a truncated report that looked complete would understate spend.
 */
export const inspectTokenBudget = query({
  args: {
    ...credentialArgs,
    worldId: v.string(),
    fromWorldDay: v.number(),
    toWorldDay: v.number(),
  },
  handler: async (ctx, args): Promise<
    TokenBudgetInspection & { clampedToWorldDay: number | null; ledgerScanLimitReached: boolean }
  > => {
    await requireOperator(ctx, 'budget.inspect', args);
    const from = Math.trunc(args.fromWorldDay);
    const requestedTo = Math.trunc(args.toWorldDay);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(requestedTo) || from < 0 || requestedTo < from) {
      throw new TokenBudgetError('TOKEN_BUDGET_INVALID', 'world day range must be ascending and non-negative');
    }
    const to = Math.min(requestedTo, from + MAX_REPORT_WORLD_DAYS - 1);

    const current = await readCurrent(ctx, args.worldId);
    const effective = resolveEffectiveTokenBudgetPolicy(current);

    const counters: BudgetCounters[] = [];
    for (let worldDay = from; worldDay <= to; worldDay += 1) {
      const row = await loadBudgetCounters(ctx.db, args.worldId, worldDay);
      // A day with no row has spent nothing, and that IS a measurement: dropping it would make a
      // quiet day indistinguishable from a day outside the window.
      counters.push(row);
    }

    // The ledger fan-out is bounded ACROSS the whole range, not per day. Convex refuses a query
    // that reads more than 16,384 documents, and 90 world days x MAX_LEDGER_LIMIT would ask for
    // 45,000 — so a wide inspect on a busy world used to THROW rather than answer. A total budget
    // well under the platform ceiling leaves headroom for the counter and configuration reads
    // above, and the flag makes a truncated answer distinguishable from a complete one.
    const ledgerRows: StoredBudgetLedgerEntry[] = [];
    let ledgerScanLimitReached = false;
    for (const { worldDay } of counters) {
      const remaining = MAX_REPORT_LEDGER_ROWS - ledgerRows.length;
      if (remaining <= 0) { ledgerScanLimitReached = true; break; }
      const rows = await listBudgetLedger(ctx.db, args.worldId, worldDay, remaining + 1);
      if (rows.length > remaining) {
        ledgerRows.push(...rows.slice(0, remaining));
        ledgerScanLimitReached = true;
        break;
      }
      ledgerRows.push(...rows);
    }

    const moduleDailyTokenBudgets = [];
    for (const module of CONFIGURABLE_MODULES) {
      const config = await resolveModuleConfig(ctx.db, args.worldId, module);
      moduleDailyTokenBudgets.push({ module, dailyTokenBudget: config.dailyTokenBudget });
    }

    return {
      worldId: args.worldId,
      policy: {
        ...effective,
        contentHash: current?.contentHash ?? null,
        actor: current?.actor ?? null,
        reason: current?.reason ?? null,
        createdAt: current?.createdAt ?? null,
      },
      moduleDailyTokenBudgets,
      counters,
      report: summarizeResourceUsage({
        worldId: args.worldId,
        policy: effective,
        counters,
        ledger: ledgerRows,
      }),
      clampedToWorldDay: to === requestedTo ? null : to,
      /**
       * True when the ledger fan-out hit {@link MAX_REPORT_LEDGER_ROWS} before reading every day
       * in the range, so the report's REFUSAL counts describe a prefix of the window.
       *
       * The settled-spend numbers are unaffected — those come from the counters, one row per world
       * day — but a truncated refusal count is a different statement from a complete one, and
       * reporting it as complete is the failure this flag exists to prevent.
       */
      ledgerScanLimitReached,
    };
  },
});

/**
 * FR-M003 AC#2 — the audit trail of budget decisions for one world day.
 *
 * Scoped to a single world day and index-bound, so this is never a whole-table read on a table
 * that grows once per provider attempt forever. `truncated` is reported rather than inferred from
 * the row count: a caller cannot tell a day with exactly `limit` decisions from a day with more.
 */
export const listTokenBudgetLedger = query({
  args: {
    ...credentialArgs,
    worldId: v.string(),
    worldDay: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx, 'budget.inspect', args);
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? DEFAULT_LEDGER_LIMIT), 1), MAX_LEDGER_LIMIT);
    // One row over the limit, so "there are more" is observed rather than guessed.
    const rows = await listBudgetLedger(ctx.db, args.worldId, Math.trunc(args.worldDay), limit + 1);
    return {
      worldId: args.worldId,
      worldDay: Math.trunc(args.worldDay),
      entries: rows.slice(0, limit),
      truncated: rows.length > limit,
    };
  },
});

/**
 * The documented defaults, so a console can show what "unconfigured" means without a world.
 *
 * Behind the same gate as everything else — these are not secret, but the console must not be
 * enumerable anonymously, which is the rule `describeOperatorSession` established and
 * `describeModuleModelDefaults` followed.
 */
export const describeTokenBudgetDefaults = query({
  args: { ...credentialArgs, worldId: v.string() },
  handler: async (ctx, args) => {
    await requireOperator(ctx, 'budget.inspect', args);
    return { defaults: TOKEN_BUDGET_POLICY_DEFAULTS };
  },
});
