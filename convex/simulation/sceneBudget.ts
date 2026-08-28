/**
 * The FR-M003 enforcement seam on the live scene-authoring path (ART-59).
 *
 * ## Why enforcement lives HERE and not one level up
 *
 * `simulateWholeScene` owns the semantic retry loop, and a retry is the thing FR-M003's Retry
 * 預算 limits. Gating at the stage above it — around the whole `simulateWholeScene` call — would
 * count a scene that retried twice as one reservation and make the retry budget unenforceable by
 * construction: the second and third provider calls would never be offered to the accountant.
 * So the gate is called once per ATTEMPT, and `attempt > 1` is exactly what makes a call count
 * against the retry budget.
 *
 * ## Reserve, then settle — two moments, not one
 *
 * A reservation is taken BEFORE the call with an upper bound (the configured `maxTokens`); the
 * real spend is booked AFTER it from the provider's own reported usage. Booking at reservation
 * time would charge the bound rather than the spend, and freeing the concurrency slot at
 * reservation time would make 最大並行數 unenforceable. `runBudgetedAttempt` guarantees that
 * every granted reservation is eventually settled or released, including on the throw path —
 * a granted reservation that is never released would leak a concurrency slot for the rest of the
 * world day, which is the failure mode a concurrency limit is least able to survive.
 *
 * ## The one downgrade hop
 *
 * `downgrade_to_fast_model` is FR-M003's own 超額降級策略, and it is carried out here as a single
 * re-reservation against the configured fast class. It is deliberately ONE hop with no ordering:
 * FR-M004's ladder — retry the same model, then a compatible model, then fewer scenes — is ART-91,
 * which depends on this task. If the fast class is also over budget, the second decision refuses
 * and that refusal is what happens; there is no third option to try, and inventing one here would
 * be building ART-91's ladder under another name.
 */

import {
  buildBudgetLedgerEntry,
  emptyBudgetCounters,
  evaluateReservation,
  applyReservationDecision,
  isReplayableGrant,
  releaseReservation,
  settleReservation,
  TOKEN_BUDGET_POLICY_DEFAULTS,
  type BudgetCounters,
  type BudgetDecision,
  type BudgetLedgerEntry,
  type BudgetReservationRequest,
  type BudgetSettlement,
  type TokenBudgetPolicy,
} from '../shared/tokenBudget';
import type { ConfigurableModule } from '../shared/moduleModelConfig';
import type { ProviderTraceMetadata } from './provider';

/**
 * The accountant, as the scene path sees it.
 *
 * Three calls rather than one wrapper, because they happen at three different moments and a
 * single `withBudget(fn)` would have to guess what "spent" means for a call that threw. The
 * Convex adapter binds this to the durable counters and ledger; the long-run harness binds it to
 * the same pure model over in-memory state, so the run being measured is the run being enforced.
 */
export interface SceneBudgetGate {
  /**
   * Evaluate one attempt and DURABLY RECORD the decision, granted or refused.
   *
   * Recording a REFUSAL is as load-bearing as recording a grant: a budget that silently drops
   * work leaves an operator looking at a world that stopped producing scenes with nothing saying
   * why. `decisionId` is caller-derived and stable, so a retried mutation records one decision.
   */
  reserve(request: BudgetReservationRequest, decisionId: string): Promise<BudgetDecision>;
  /**
   * Book the real spend of a granted reservation and free its concurrency slot.
   *
   * Takes the SAME `decisionId` the grant was recorded under, so the settlement can be made
   * idempotent against it: a Convex mutation retried mid-flight would otherwise book one provider
   * call's tokens against the day twice.
   *
   * That idempotency has a sharp edge, and it is why {@link isReplayableGrant} exists. Declining
   * an already-resolved settlement is only safe if the caller could not have been given a stale
   * reservation to settle against — otherwise the failure inverts: a SECOND provider call runs,
   * its settlement is declined as a duplicate, and its spend is dropped. Replay and settlement
   * have to agree on what "already resolved" means, or one of them silently loses a call.
   */
  settle(request: BudgetReservationRequest, decisionId: string, settlement: BudgetSettlement): Promise<void>;
  /**
   * Free a granted reservation's slot when the call produced no usage at all.
   *
   * Distinct from settling zero tokens: a call that threw before the provider reported anything
   * spent nothing AND ran nothing, and counting it as a settled call would inflate the
   * low-importance call census with calls that never happened.
   */
  release(request: BudgetReservationRequest, decisionId: string): Promise<void>;
}

/**
 * What one world-day slot needs from the accountant.
 *
 * `deploymentModelId` is here rather than on the budget-free part of the port because it exists
 * for one reason: FR-M003's per-MODEL cap has to name a model BEFORE the call, and ART-52's
 * `model` setting is `null` for a module that inherits the deployment's `LLM_MODEL`. Reserving
 * against a placeholder id would leave the per-model cap unenforceable for every unconfigured
 * module while the settlement booked the real id, so the two would never meet. Asking the port
 * instead keeps the reservation and the settlement on the same key: the Convex adapter answers
 * from the deployment configuration, the harness answers with its fake author's model id.
 */
export interface WorldDayBudgetPort extends SceneBudgetGate {
  deploymentModelId(): Promise<string>;
}

export class SceneBudgetError extends Error {
  /**
   * The `{ code, message }` shape `describeWorldDayError` already recognises, so a budget refusal
   * reaches `scheduledSlots.errorCode` as a STABLE code rather than as the generic
   * `WORLD_DAY_STAGE_FAILED` every other thrown Error collapses to. That distinction is the
   * "deterministic over-budget response" this task owes an operator: "the world stopped because
   * it is over budget" and "the world stopped because the provider broke" need different
   * responses, and an operator reading the slot row must not have to guess which happened.
   *
   * Copied from `CanonError` (`convex/shared/errors.ts`) rather than by widening the orchestrator,
   * so the mapping stays one function with one rule.
   */
  readonly error: { code: 'SCENE_BUDGET_REFUSED' | 'SCENE_BUDGET_DEFERRED'; message: string };

  constructor(
    readonly code: 'SCENE_BUDGET_REFUSED' | 'SCENE_BUDGET_DEFERRED',
    readonly decision: BudgetDecision,
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'SceneBudgetError';
    this.error = { code, message };
  }
}

/** The error code an over-budget decision raises, chosen by the strategy that was selected. */
function refusalFor(decision: BudgetDecision): SceneBudgetError {
  const limits = decision.breachedLimits.join(', ');
  return decision.strategy === 'defer_to_next_world_day'
    ? new SceneBudgetError('SCENE_BUDGET_DEFERRED', decision,
      `deferred to the next world day; over budget on: ${limits}`)
    : new SceneBudgetError('SCENE_BUDGET_REFUSED', decision,
      `refused; over budget on: ${limits}`);
}

/**
 * Reserve, run, settle. Returns whatever `run` returned, plus the model the call had to use.
 *
 * `run` receives the routed model rather than the requested one, so AC#5's routing and the
 * downgrade strategy both reach the provider instead of being decided and then ignored. The
 * caller cannot bypass this: the model it would have used is an input, and the model it must use
 * is the return of a decision it did not make.
 *
 * Throws {@link SceneBudgetError} when the reservation is refused — including after the single
 * downgrade hop — and rethrows whatever `run` threw otherwise, after releasing the slot.
 */
export async function runBudgetedAttempt<T>(
  gate: SceneBudgetGate,
  input: {
    request: BudgetReservationRequest;
    decisionId: string;
    run: (model: string) => Promise<{ value: T; trace: ProviderTraceMetadata }>;
  },
): Promise<{ value: T; trace: ProviderTraceMetadata; decision: BudgetDecision }> {
  let request = input.request;
  let decisionId = input.decisionId;
  let decision = await gate.reserve(request, decisionId);

  if (decision.outcome === 'over_budget') {
    if (decision.strategy !== 'downgrade_to_fast_model') throw refusalFor(decision);
    // The one hop. Re-requested as an ordinary reservation against the fast class, so every cap
    // that model carries binds exactly as it would have for a first-choice request — a downgrade
    // is a cheaper call, not an exemption. It gets its OWN decision id, so the audit trail keeps
    // both the refusal that triggered the downgrade and the decision that replaced it.
    request = { ...request, requestedModel: decision.model };
    decisionId = `${input.decisionId}:downgraded`;
    decision = await gate.reserve(request, decisionId);
    if (decision.outcome === 'over_budget') throw refusalFor(decision);
  }

  const granted = decision;
  let result: { value: T; trace: ProviderTraceMetadata };
  try {
    result = await input.run(granted.model);
  } catch (error) {
    // The slot is freed on EVERY exit from a granted reservation. A leaked in-flight count does
    // not merely mis-report: it permanently consumes one of `maxConcurrentCalls` for the world
    // day, so a world with a limit of 2 stops simulating entirely after two provider failures.
    await gate.release(request, decisionId);
    throw error;
  }
  const settlement: BudgetSettlement = {
    module: request.module,
    model: granted.model,
    // The provider's own answer to "which model ran this", captured at the only moment both ids
    // exist. `settleReservation` compares the two and counts the divergence; see
    // `BudgetSettlement.reportedModel` for why that comparison is worth making at all.
    reportedModel: result.trace.model,
    importance: request.importance,
    tokens: result.trace.inputTokens + result.trace.outputTokens,
    countedAsRetry: granted.countedAsRetry,
    // Read off the DECISION, not re-derived from `routingReason`. A low-importance call that
    // already named the fast class is not re-routed and still runs on it, so `routingReason !==
    // null` answered the wrong question and reported a fabricated AC#5 violation.
    onFastModel: granted.onFastModel,
  };
  await gate.settle(request, decisionId, settlement);
  return { ...result, decision: granted };
}

/**
 * A fully working accountant over in-memory state, using the SAME pure model the Convex
 * adapter uses.
 *
 * This is what makes the long-run harness's §16.3 numbers evidence rather than illustration: the
 * run being measured is the run being enforced, through `evaluateReservation` and
 * `settleReservation` themselves, not through a re-implementation that could agree with the tests
 * and disagree with production. `createConvexBudgetPort` and this class differ only in where the
 * three records are kept.
 *
 * Deterministic: `recordedAt` counts decisions rather than reading a clock, so a run's ledger is
 * byte-identical across runs of the same seed and can be hashed into the run digest.
 */
export class InMemoryBudgetAccountant implements WorldDayBudgetPort {
  private readonly counters = new Map<string, BudgetCounters>();
  private readonly entries = new Map<string, BudgetLedgerEntry>();
  private readonly resolved = new Set<string>();
  private sequence = 0;

  constructor(
    private readonly modelId: string,
    private readonly policy: TokenBudgetPolicy = TOKEN_BUDGET_POLICY_DEFAULTS,
    /** ART-52's per-module cap, delegated exactly as the Convex adapter delegates it. */
    private readonly moduleDailyTokenBudget: (module: ConfigurableModule) => number | null = () => null,
    /** The configured policy version, for the audit row. `null` means running on defaults. */
    private readonly policyVersion: number | null = null,
  ) {}

  deploymentModelId(): Promise<string> {
    return Promise.resolve(this.modelId);
  }

  /** Counters for every world day touched, ascending — the report's settled-spend input. */
  get allCounters(): BudgetCounters[] {
    return [...this.counters.values()].sort((left, right) => left.worldDay - right.worldDay);
  }

  /** Every decision recorded, in the order it was taken — the report's decision input. */
  get ledger(): BudgetLedgerEntry[] {
    return [...this.entries.values()].sort((left, right) => left.recordedAt - right.recordedAt);
  }

  private countersFor(worldId: string, worldDay: number): BudgetCounters {
    return this.counters.get(`${worldId}:${worldDay}`) ?? emptyBudgetCounters(worldId, worldDay);
  }

  private put(counters: BudgetCounters): void {
    this.counters.set(`${counters.worldId}:${counters.worldDay}`, counters);
  }

  reserve(request: BudgetReservationRequest, decisionId: string): Promise<BudgetDecision> {
    const existing = this.entries.get(decisionId);
    // The SAME rule `createConvexBudgetPort` applies, through the SAME pure predicate — it has to
    // be, or this double stops being evidence about the deployed path. `this.resolved` is exactly
    // the stored row's `resolution !== 'pending'`: refusals join it at reserve, grants at settle
    // or release.
    const priorResolution = existing === undefined
      ? 'pending'
      : this.resolved.has(decisionId) ? 'settled' as const : 'pending' as const;
    if (existing && isReplayableGrant({ outcome: existing.outcome, resolution: priorResolution })) {
      return Promise.resolve({
        schemaVersion: 1,
        outcome: existing.outcome,
        model: existing.model,
        routingReason: existing.routingReason,
        onFastModel: existing.onFastModel,
        strategy: existing.strategy,
        strategyFallbackReason: existing.strategyFallbackReason,
        boundLimit: existing.boundLimit,
        breachedLimits: existing.breachedLimits,
        countedAsRetry: existing.countedAsRetry,
        estimatedTokens: existing.estimatedTokens,
        observed: {
          totalTokens: existing.observedTotalTokens,
          retryTokens: existing.observedRetryTokens,
          moduleTokens: existing.observedModuleTokens,
          modelTokens: existing.observedModelTokens,
          inFlight: existing.observedInFlight,
        },
      });
    }
    const counters = this.countersFor(request.worldId, request.worldDay);
    const decision = evaluateReservation({
      policy: this.policy,
      moduleDailyTokenBudget: this.moduleDailyTokenBudget(request.module),
      counters,
      request,
    });
    this.sequence += 1;
    // Replaces the prior refusal's row rather than appending beside it, so `refusedCalls` keeps
    // equalling the number of `over_budget` entries.
    this.entries.set(decisionId, buildBudgetLedgerEntry({
      request, decision, decisionId, policyVersion: this.policyVersion, recordedAt: this.sequence,
    }));
    // A fresh grant is pending again; a refusal is born resolved because it granted nothing.
    if (decision.outcome === 'allowed') this.resolved.delete(decisionId);
    else this.resolved.add(decisionId);
    this.put(applyReservationDecision(counters, decision, existing === undefined
      ? 'none'
      : existing.outcome === 'over_budget' ? 'refusal' : 'resolved_grant'));
    return Promise.resolve(decision);
  }

  settle(request: BudgetReservationRequest, decisionId: string, settlement: BudgetSettlement): Promise<void> {
    if (!this.entries.has(decisionId) || this.resolved.has(decisionId)) return Promise.resolve();
    this.resolved.add(decisionId);
    this.put(settleReservation(this.countersFor(request.worldId, request.worldDay), settlement));
    return Promise.resolve();
  }

  release(request: BudgetReservationRequest, decisionId: string): Promise<void> {
    if (!this.entries.has(decisionId) || this.resolved.has(decisionId)) return Promise.resolve();
    this.resolved.add(decisionId);
    this.put(releaseReservation(this.countersFor(request.worldId, request.worldDay)));
    return Promise.resolve();
  }
}

/**
 * A port that grants everything and records nothing.
 *
 * Exported and NAMED rather than expressed as an optional port field, so that "this caller does
 * not meter spend" is a decision a reader can see at the binding site instead of an omission
 * nobody notices. Every unit fixture that does not care about budgets binds this explicitly, and
 * the compiler requires a choice from anything that constructs the port — which is the point: an
 * optional field would let a NEW production binding forget the gate and enforce nothing, silently.
 */
export function unmeteredWorldDayBudgetPort(modelId = 'unmetered'): WorldDayBudgetPort {
  return {
    deploymentModelId: () => Promise.resolve(modelId),
    reserve: (request) => Promise.resolve({
      schemaVersion: 1,
      outcome: 'allowed',
      model: request.requestedModel,
      routingReason: null,
      // Nothing is metered here, so nothing is claimed about the fast class either. Reporting
      // `true` would put unmetered calls into the AC#5 numerator.
      onFastModel: false,
      strategy: null,
      strategyFallbackReason: null,
      boundLimit: null,
      breachedLimits: [],
      countedAsRetry: request.attempt > 1,
      estimatedTokens: request.estimatedTokens,
      observed: { totalTokens: 0, retryTokens: 0, moduleTokens: 0, modelTokens: 0, inFlight: 0 },
    }),
    settle: () => Promise.resolve(),
    release: () => Promise.resolve(),
  };
}
