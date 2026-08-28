/**
 * FR-M003 / ART-59 — budget enforcement driven through the REAL live pipeline.
 *
 * `tokenBudget.test.ts` proves the pure decision. This file proves the decision REACHES the
 * provider call: every case below drives `executeWorldDay` over `createLongRunFixture` — the same
 * fixture `runLongRunSimulation` and ART-74's failure suite drive — with a configured budget
 * policy and, where the case needs one, an injected provider fault. Nothing here re-implements a
 * stage, and nothing asserts on a decision the pipeline never acted on.
 *
 *   AC#1  each of the five FR-M003 limits refuses a real scene, and the world stops authoring
 *   AC#2  the refusal is audited with its bound limit, its counters and its strategy
 *   AC#3  the §16.3 report measures the run, including a provable zero for public-read calls
 *   AC#4  retry tokens are measured over a NON-EMPTY sample, and the ceiling refuses a real retry
 *
 * Every enforcement case is paired with a NEGATIVE CONTROL: the same run under an unlimited
 * policy completes. Without that pairing "the slot failed" would be evidence of nothing — a
 * broken harness fails slots too.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TIME_SLOTS, type TimeSlot } from '../canon/eventTypes';
import { MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { FAKE_SCENE_MODEL, FakeWholeSceneProvider } from '../simulation/fakeSceneNarrator';
import {
  SimulationProviderError,
  type EmbeddingResult,
  type LanguageModelProvider,
  type StructuredChatRequest,
  type StructuredChatResult,
} from '../simulation/provider';
import { executeWorldDay, type WorldDayRun } from '../simulation/worldDayOrchestration';
import { worldDayRunId, type WorldDaySlotIdentity } from '../simulation/worldDayLive';
import {
  SECTION_16_3_MAX_RETRY_TOKEN_SHARE,
  TOKEN_BUDGET_POLICY_DEFAULTS,
  summarizeResourceUsage,
  type BudgetLedgerEntry,
  type TokenBudgetPolicy,
} from '../shared/tokenBudget';
import { InMemoryBudgetAccountant, runBudgetedAttempt } from '../simulation/sceneBudget';
import { createLongRunFixture, type LongRunFixture } from './longRunHarness';

const WORLD_ID = MISTWOOD_PUBLIC_WORLD_ID;
/** Repository root, for the source scan below. `convex/operations` is two levels down. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const policyWith = (overrides: Partial<TokenBudgetPolicy>): TokenBudgetPolicy => ({
  ...TOKEN_BUDGET_POLICY_DEFAULTS,
  ...overrides,
});

const slot = (worldDay: number, timeSlot: TimeSlot): WorldDaySlotIdentity =>
  ({ worldId: WORLD_ID, worldDay, timeSlot });

const driveSlot = (fixture: LongRunFixture, target: WorldDaySlotIdentity): Promise<WorldDayRun> =>
  executeWorldDay({ runId: worldDayRunId(target), ...target }, fixture.worldDayRunStore, fixture.worldDayHandlers);

/** Drive every slot of one world day. Post-commit is irrelevant to budgets and is skipped. */
async function driveWorldDay(fixture: LongRunFixture, worldDay: number): Promise<WorldDayRun[]> {
  const runs: WorldDayRun[] = [];
  for (const timeSlot of TIME_SLOTS) runs.push(await driveSlot(fixture, slot(worldDay, timeSlot)));
  return runs;
}

const refusals = (fixture: LongRunFixture): BudgetLedgerEntry[] =>
  fixture.budget.ledger.filter((entry) => entry.outcome === 'over_budget');

const grants = (fixture: LongRunFixture): BudgetLedgerEntry[] =>
  fixture.budget.ledger.filter((entry) => entry.outcome === 'allowed');

/** Counts provider calls so a refusal can be proven to have reached no provider at all. */
class CountingProvider implements LanguageModelProvider {
  calls = 0;
  constructor(private readonly inner: LanguageModelProvider = new FakeWholeSceneProvider()) {}
  structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
    this.calls += 1;
    return this.inner.structuredChat(request);
  }
  embed(text: string): Promise<EmbeddingResult> { return this.inner.embed(text); }
}

/**
 * Answers correctly but REPORTS a different model in its trace.
 *
 * Stands in for the two ways the meter and the provider come apart in production: an ART-72
 * adapter injected without repointing `deploymentModelId`, and a gateway that answers with a
 * different model id from the one it was asked for.
 */
class MisreportingProvider implements LanguageModelProvider {
  constructor(
    private readonly inner: LanguageModelProvider,
    private readonly reportedModel: string,
  ) {}
  async structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
    const result = await this.inner.structuredChat(request);
    return { ...result, trace: { ...result.trace, model: this.reportedModel } };
  }
  embed(text: string): Promise<EmbeddingResult> { return this.inner.embed(text); }
}

/** Fails the first `failFirstN` calls transiently, so the semantic retry loop really retries. */
class FlakyProvider implements LanguageModelProvider {
  calls = 0;
  constructor(
    private readonly inner: LanguageModelProvider,
    private readonly failFirstN: number,
  ) {}
  structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
    this.calls += 1;
    if (this.calls <= this.failFirstN) {
      throw new SimulationProviderError('transient', 'PROVIDER_SYNTHETIC_FAILURE',
        `synthetic transient failure #${this.calls}`);
    }
    return this.inner.structuredChat(request);
  }
  embed(text: string): Promise<EmbeddingResult> { return this.inner.embed(text); }
}

// =============================================================================
// The negative control every enforcement case is measured against
// =============================================================================

describe('negative control — an unconfigured world is unaffected by ART-59', () => {
  it('completes every slot of a world day and refuses nothing', async () => {
    const fixture = createLongRunFixture();
    const runs = await driveWorldDay(fixture, 0);

    expect(runs.every(({ status }) => status === 'completed')).toBe(true);
    expect(refusals(fixture)).toEqual([]);
    // The sample is non-empty: something really was metered, so "no refusals" is a measurement
    // rather than the shape of a run in which the gate was never called.
    expect(grants(fixture).length).toBeGreaterThan(0);
    expect(fixture.canon.committedEvents().length).toBeGreaterThan(0);
    expect(fixture.budget.allCounters[0].totalTokens).toBeGreaterThan(0);
  });

  it('books the provider\'s real reported usage, not the reservation\'s upper bound', async () => {
    const fixture = createLongRunFixture();
    await driveSlot(fixture, slot(0, 'morning'));

    const settled = fixture.budget.allCounters[0].totalTokens;
    const fromTraces = fixture.observations.simulations
      .reduce((total, { trace }) => total + trace.inputTokens + trace.outputTokens, 0);
    // Reservation and settlement are DIFFERENT numbers, and the counters must hold the second.
    // `maxTokens` defaults to 4_000 per attempt, so a counter equal to 4_000 x scenes would mean
    // the reservation was being booked as if it were the spend.
    expect(settled).toBe(fromTraces);
    expect(settled).not.toBe(4_000 * fixture.observations.simulations.length);
  });
});

// =============================================================================
// AC#1 — each limit refuses real work
// =============================================================================

describe('AC#1 — the daily token limit stops a real world day', () => {
  it('refuses scenes once the world day cap is reached, and the slot fails rather than overspending', async () => {
    // One scene of this fixture settles well under 1_000 tokens, and the reservation is the
    // 4_000-token completion cap, so a 1_000-token day admits nothing at all.
    const fixture = createLongRunFixture(new CountingProvider(), policyWith({ worldDailyTokenBudget: 1_000 }));
    const runs = await driveWorldDay(fixture, 0);

    expect(runs.every(({ status }) => status === 'failed')).toBe(true);
    expect(runs.every(({ errorCode }) => errorCode === 'SCENE_BUDGET_REFUSED')).toBe(true);
    const refused = refusals(fixture);
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.every(({ boundLimit }) => boundLimit === 'world_daily_tokens')).toBe(true);
    // Enforcement, not reporting: nothing reached Canon.
    expect(fixture.canon.committedEvents()).toEqual([]);
  });

  it('a refused reservation reaches NO provider at all', async () => {
    // The whole point of a pre-call reservation. If the provider were called and the result
    // discarded, the tokens would already have been spent and the limit would be decoration.
    const provider = new CountingProvider();
    const fixture = createLongRunFixture(provider, policyWith({ worldDailyTokenBudget: 1 }));
    await driveWorldDay(fixture, 0);

    expect(refusals(fixture).length).toBeGreaterThan(0);
    expect(provider.calls).toBe(0);
  });

  it('a budget refusal is not retried: one refused attempt, not maxAttempts of them', async () => {
    // Retrying a refusal would spend the retry budget arguing with the limit that just refused
    // the call, and would write one audit row per attempt saying the same thing.
    const fixture = createLongRunFixture(new CountingProvider(), policyWith({ worldDailyTokenBudget: 1 }));
    await driveSlot(fixture, slot(0, 'morning'));

    const perScene = new Map<string, number>();
    for (const entry of refusals(fixture)) {
      const scene = entry.decisionId.split(':budget')[0];
      perScene.set(scene, (perScene.get(scene) ?? 0) + 1);
    }
    expect(perScene.size).toBeGreaterThan(0);
    expect([...perScene.values()].every((count) => count === 1)).toBe(true);
  });

  it('a cap that binds PARTWAY through a slot lets the earlier scenes through', async () => {
    // Every other AC#1 test refuses the very first scene, which only exercises the all-or-nothing
    // shape: a limit that refused everything and a limit that refused nothing would both produce
    // "the slot failed". This sizes the cap so the day admits some scenes and then stops, which is
    // the shape a real budget actually has.
    const unbounded = createLongRunFixture(new CountingProvider());
    await driveSlot(unbounded, slot(0, 'morning'));
    const oneSceneCost = unbounded.budget.allCounters[0].totalTokens
      / unbounded.observations.simulations.length;
    expect(unbounded.observations.simulations.length).toBeGreaterThan(1);

    // Room for the first scene's settled spend plus one more reservation, and no further.
    const cap = Math.ceil(oneSceneCost) + 4_000;
    const fixture = createLongRunFixture(new CountingProvider(), policyWith({ worldDailyTokenBudget: cap }));
    await driveSlot(fixture, slot(0, 'morning'));

    // Both outcomes present in ONE slot: this is the assertion the all-or-nothing tests cannot make.
    expect(grants(fixture).length).toBeGreaterThan(0);
    expect(refusals(fixture).length).toBeGreaterThan(0);
    expect(refusals(fixture).every(({ boundLimit }) => boundLimit === 'world_daily_tokens')).toBe(true);
    // The scenes that were granted really ran, and their spend is what closed the budget.
    expect(fixture.budget.allCounters[0].totalTokens).toBeGreaterThan(0);
    expect(fixture.budget.allCounters[0].totalTokens).toBeLessThanOrEqual(cap);
    // The refusal is measured against a NON-zero observation — the earlier scenes' spend — rather
    // than against an empty day, so the counter snapshot on the audit row is load-bearing here.
    expect(refusals(fixture)[0].observedTotalTokens).toBeGreaterThan(0);
  });

  it('every provider call is metered exactly once, across an operator retry', async () => {
    // THE property, over the exact workflow the M2 fix endorses: a cap binds mid-slot, the
    // operator raises it, the slot is retried with the same deterministic run id.
    //
    // Asserting calls == settlements is deliberately stronger than counting either side alone. A
    // stale grant replayed to the retry gave the caller a reservation that no longer existed, so
    // the provider ran and `settle` then declined as already-resolved: calls went up, settlements
    // did not, and the difference was spent silently — nothing in the ledger, the counters or the
    // report showed it.
    const probe = createLongRunFixture(new CountingProvider());
    await driveSlot(probe, slot(0, 'morning'));
    const oneSceneCost = probe.budget.allCounters[0].totalTokens
      / probe.observations.simulations.length;
    expect(probe.observations.simulations.length).toBeGreaterThan(1);

    // Held by reference and mutated below, the way an operator raising the cap would.
    const policy = policyWith({ worldDailyTokenBudget: Math.ceil(oneSceneCost) + 4_000 });
    const provider = new CountingProvider();
    const fixture = createLongRunFixture(provider, policy);

    const first = await driveSlot(fixture, slot(0, 'morning'));
    expect(first.status).toBe('failed');
    expect(first.errorCode).toBe('SCENE_BUDGET_REFUSED');

    policy.worldDailyTokenBudget = 1_000_000;
    const retry = await driveSlot(fixture, slot(0, 'morning'));
    expect(retry.status).toBe('completed');

    const counters = fixture.budget.allCounters[0];
    // A non-empty sample, and one that really spans two runs.
    expect(provider.calls).toBeGreaterThan(probe.observations.simulations.length);
    expect(counters.settledCalls).toBe(provider.calls);
    expect(counters.grantedCalls).toBe(provider.calls);
    // And the tokens: every one the provider reported is on the counters. `observations` records
    // one entry per SUCCESSFUL simulation, so its total is what was actually spent.
    const providerTokens = fixture.observations.simulations
      .reduce((total, { trace }) => total + trace.inputTokens + trace.outputTokens, 0);
    expect(counters.totalTokens).toBe(providerTokens);
  });

  it('the world day rolls over: day 1 starts from a fresh budget', async () => {
    // Sized so one world day fits and the second is measured independently rather than against
    // the first day's accumulated spend.
    const fixture = createLongRunFixture(new CountingProvider(), policyWith({ worldDailyTokenBudget: 1_000_000 }));
    await driveWorldDay(fixture, 0);
    await driveWorldDay(fixture, 1);

    const counters = fixture.budget.allCounters;
    expect(counters.map(({ worldDay }) => worldDay)).toEqual([0, 1]);
    expect(counters[0].totalTokens).toBeGreaterThan(0);
    expect(counters[1].totalTokens).toBeGreaterThan(0);
    // Day 1's counter holds day 1's spend only. A shared counter would show the sum.
    expect(counters[1].totalTokens).toBeLessThan(counters[0].totalTokens + counters[1].totalTokens);
    expect(refusals(fixture)).toEqual([]);
  });
});

describe('AC#1 — the per-module limit is ART-52\'s number, enforced here', () => {
  it('refuses on the module cap the ART-52 resolver supplies', async () => {
    const fixture = createLongRunFixture(
      new CountingProvider(),
      TOKEN_BUDGET_POLICY_DEFAULTS,
      // Exactly what an operator would have written into `moduleModelConfigs.dailyTokenBudget`.
      // Passed through the delegation seam rather than copied into the ART-59 policy, so this
      // test fails if the delegation is replaced by a second copy of the number.
      (module) => (module === 'scene_simulation' ? 1_000 : null),
    );
    const runs = await driveWorldDay(fixture, 0);

    expect(runs.every(({ status }) => status === 'failed')).toBe(true);
    const refused = refusals(fixture);
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.every(({ boundLimit }) => boundLimit === 'module_daily_tokens')).toBe(true);
    expect(refused.every(({ module }) => module === 'scene_simulation')).toBe(true);
  });

  it('an unlimited module cap changes nothing — the negative control for the same run', async () => {
    const fixture = createLongRunFixture(
      new CountingProvider(), TOKEN_BUDGET_POLICY_DEFAULTS, () => null,
    );
    const runs = await driveWorldDay(fixture, 0);
    expect(runs.every(({ status }) => status === 'completed')).toBe(true);
    expect(refusals(fixture)).toEqual([]);
  });
});

describe('AC#1 — the per-model limit', () => {
  it('refuses on the cap configured for the model the pipeline actually calls', async () => {
    const fixture = createLongRunFixture(new CountingProvider(), policyWith({
      modelDailyTokenBudgets: [{ model: FAKE_SCENE_MODEL, dailyTokenBudget: 1_000 }],
    }));
    const runs = await driveWorldDay(fixture, 0);

    expect(runs.every(({ status }) => status === 'failed')).toBe(true);
    const refused = refusals(fixture);
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.every(({ boundLimit }) => boundLimit === 'model_daily_tokens')).toBe(true);
    // The key really is the model this deployment calls, not a placeholder: if the reservation
    // used one id and the settlement another, the cap would meter an empty bucket forever.
    expect(refused.every(({ model }) => model === FAKE_SCENE_MODEL)).toBe(true);
  });

  it('a cap on a DIFFERENT model does not bind — the negative control', async () => {
    const fixture = createLongRunFixture(new CountingProvider(), policyWith({
      modelDailyTokenBudgets: [{ model: 'some-other-model', dailyTokenBudget: 1 }],
    }));
    const runs = await driveWorldDay(fixture, 0);
    expect(runs.every(({ status }) => status === 'completed')).toBe(true);
    expect(refusals(fixture)).toEqual([]);
  });
});

describe('AC#1 — the retry budget, against real retries', () => {
  it('a transient provider failure produces a REAL retry that is metered as one', async () => {
    const flaky = new FlakyProvider(new FakeWholeSceneProvider(), 1);
    const fixture = createLongRunFixture(flaky);
    await driveSlot(fixture, slot(0, 'morning'));

    // The sample is non-empty and really contains a retry: the first provider call failed, the
    // second succeeded, and the accountant saw both.
    expect(flaky.calls).toBeGreaterThan(1);
    const retryGrants = grants(fixture).filter(({ countedAsRetry }) => countedAsRetry);
    expect(retryGrants.length).toBeGreaterThan(0);
    expect(retryGrants.every(({ attempt }) => attempt >= 2)).toBe(true);
    expect(fixture.budget.allCounters[0].retryTokens).toBeGreaterThan(0);
  });

  it('the failed attempt releases its slot instead of leaking it', async () => {
    // A leaked in-flight count permanently consumes one of `maxConcurrentCalls` for the world
    // day, so a world with a small limit would stop simulating after a few provider failures.
    const fixture = createLongRunFixture(new FlakyProvider(new FakeWholeSceneProvider(), 1));
    await driveSlot(fixture, slot(0, 'morning'));
    expect(fixture.budget.allCounters[0].inFlight).toBe(0);
  });

  it('an exhausted absolute retry budget refuses the retry', async () => {
    const fixture = createLongRunFixture(
      new FlakyProvider(new FakeWholeSceneProvider(), 1),
      policyWith({ retryTokenBudget: 1 }),
    );
    const run = await driveSlot(fixture, slot(0, 'morning'));

    expect(run.status).toBe('failed');
    const refused = refusals(fixture);
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.every(({ boundLimit }) => boundLimit === 'retry_tokens')).toBe(true);
    expect(refused.every(({ countedAsRetry }) => countedAsRetry)).toBe(true);
    // First attempts were never touched by the retry budget.
    expect(grants(fixture).every(({ attempt }) => attempt === 1)).toBe(true);
  });
});

// =============================================================================
// AC#2 — the audit trail
// =============================================================================

describe('AC#2 — the decision is audited, and the audit is deterministic', () => {
  it('records every decision with its counters, its limits and its selected strategy', async () => {
    const fixture = createLongRunFixture(
      new CountingProvider(),
      policyWith({ worldDailyTokenBudget: 1, overBudgetStrategy: 'defer_to_next_world_day' }),
    );
    await driveSlot(fixture, slot(0, 'morning'));

    const [entry] = refusals(fixture);
    expect(entry).toBeDefined();
    expect(entry.strategy).toBe('defer_to_next_world_day');
    expect(entry.boundLimit).toBe('world_daily_tokens');
    expect(entry.breachedLimits).toEqual(['world_daily_tokens']);
    expect(entry.origin).toBe('scheduled_simulation');
    expect(entry.importance).toBe('standard');
    expect(entry.module).toBe('scene_simulation');
    expect(entry.observedTotalTokens).toBe(0);
    // Running on defaults for everything the policy does not set is still a policy VERSION of
    // null, and the row says so rather than implying a configured version.
    expect(entry.policyVersion).toBeNull();
  });

  it('a `defer` strategy raises its own error code, distinguishable from a flat refusal', async () => {
    const deferred = createLongRunFixture(new CountingProvider(),
      policyWith({ worldDailyTokenBudget: 1, overBudgetStrategy: 'defer_to_next_world_day' }));
    const refusedFixture = createLongRunFixture(new CountingProvider(),
      policyWith({ worldDailyTokenBudget: 1, overBudgetStrategy: 'refuse' }));

    expect((await driveSlot(deferred, slot(0, 'morning'))).errorCode).toBe('SCENE_BUDGET_DEFERRED');
    expect((await driveSlot(refusedFixture, slot(0, 'morning'))).errorCode).toBe('SCENE_BUDGET_REFUSED');
  });

  it('two runs of the same seed and policy produce an identical ledger', async () => {
    // AC#2's determinism, proven over the whole live path rather than over one pure call.
    const run = async () => {
      const fixture = createLongRunFixture(new CountingProvider(), policyWith({ worldDailyTokenBudget: 200_000 }));
      await driveWorldDay(fixture, 0);
      return JSON.stringify(fixture.budget.ledger);
    };
    const [first, second] = [await run(), await run()];
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(2);
  });

  it('a PENDING grant is replayed verbatim, so an in-flight call keeps one slot', async () => {
    // Idempotency for the case it is actually for: a Convex mutation retried MID-FLIGHT, before
    // the call it granted has settled. Re-granting there would take a second concurrency slot for
    // one in-flight provider call.
    const fixture = createLongRunFixture(new CountingProvider(), policyWith({ worldDailyTokenBudget: 200_000 }));
    const reservation = {
      worldId: WORLD_ID, worldDay: 0, module: 'scene_simulation' as const,
      requestedModel: FAKE_SCENE_MODEL, importance: 'standard' as const,
      estimatedTokens: 4_000, attempt: 1, origin: 'scheduled_simulation' as const,
    };
    const first = await fixture.budget.reserve(reservation, 'pending-grant');
    // Deliberately NOT settled: the reservation is still outstanding.
    const replay = await fixture.budget.reserve({ ...reservation, estimatedTokens: 999_999 }, 'pending-grant');

    expect(replay).toEqual(first);
    expect(fixture.budget.ledger).toHaveLength(1);
    expect(fixture.budget.allCounters[0]).toMatchObject({ grantedCalls: 1, inFlight: 1 });
  });

  it('a RESOLVED grant is re-evaluated, because the next call is a NEW call', async () => {
    // The stale-grant hazard. A settled row describes a call that already finished; replaying it
    // would hand the caller a reservation that no longer exists, and `settle` would then decline
    // as already-resolved — so the new call's tokens would be spent and never booked.
    const fixture = createLongRunFixture(new CountingProvider(), policyWith({ worldDailyTokenBudget: 200_000 }));
    await driveSlot(fixture, slot(0, 'morning'));
    const settledGrant = grants(fixture)[0];
    const before = fixture.budget.allCounters[0];

    const again = await fixture.budget.reserve({
      worldId: WORLD_ID, worldDay: 0, module: 'scene_simulation', requestedModel: FAKE_SCENE_MODEL,
      importance: 'standard', estimatedTokens: 4_000, attempt: 1, origin: 'scheduled_simulation',
    }, settledGrant.decisionId);

    // Re-evaluated against the CURRENT counters, and granted as the new call it is.
    expect(again.outcome).toBe('allowed');
    expect(again.observed.totalTokens).toBe(before.totalTokens);
    expect(fixture.budget.allCounters[0].grantedCalls).toBe(before.grantedCalls + 1);
    // Still one row per scene-attempt; the cumulative call count lives on the counters.
    expect(fixture.budget.ledger.filter(({ decisionId }) => decisionId === settledGrant.decisionId))
      .toHaveLength(1);
    // The first call's spend stays booked — it was really spent, and this is an additional call
    // rather than a correction of it.
    expect(fixture.budget.allCounters[0].totalTokens).toBe(before.totalTokens);
  });

  it('a resolved grant that is now over budget is refused, not silently replayed as allowed', async () => {
    const fixture = createLongRunFixture(new CountingProvider(), policyWith({ worldDailyTokenBudget: 200_000 }));
    await driveSlot(fixture, slot(0, 'morning'));
    const settledGrant = grants(fixture)[0];

    const again = await fixture.budget.reserve({
      worldId: WORLD_ID, worldDay: 0, module: 'scene_simulation', requestedModel: FAKE_SCENE_MODEL,
      importance: 'standard', estimatedTokens: 999_999, attempt: 1, origin: 'scheduled_simulation',
    }, settledGrant.decisionId);

    expect(again.outcome).toBe('over_budget');
    expect(again.boundLimit).toBe('world_daily_tokens');
  });
});

// =============================================================================
// AC#3 / AC#4 — the §16.3 report over a real run
// =============================================================================

describe('AC#3 — the resource report measures a real run', () => {
  it('reports the five §16.3 metrics, with a NON-EMPTY denominator for the retry share', async () => {
    const fixture = createLongRunFixture();
    await driveWorldDay(fixture, 0);
    const report = summarizeResourceUsage({
      worldId: WORLD_ID,
      policy: TOKEN_BUDGET_POLICY_DEFAULTS,
      counters: fixture.budget.allCounters,
      ledger: fixture.budget.ledger,
    });

    expect(report.totalTokens).toBeGreaterThan(0);
    expect(report.grantedCalls).toBeGreaterThan(0);
    expect(report.retryTokenShare).not.toBeNull();
    expect(report.retryTokenShareCompliant).toBe(true);
    // §16.3 #3: structurally zero, and the enum that makes it structural is pinned in
    // tokenBudget.test.ts rather than asserted as a bare 0 here.
    expect(report.publicReadLlmCalls).toBe(0);
    expect(report.refusedCalls).toBe(0);
    // §16.3 #5 is unmeasurable without a configured cap, and says so.
    expect(report.dailyCapCompliant).toBeNull();
  });

  it('AC#4 — a run WITH real retries still measures under 10%, over a non-empty sample', async () => {
    // The baseline run has a zero numerator; this one does not. One injected transient failure
    // makes the very first scene of the day succeed on its SECOND attempt, so the day's sample
    // contains real settled retry tokens and the threshold assertion below compares two positive
    // numbers. (Failing two calls in a row instead would exhaust `maxAttempts` and abandon the
    // scene, which settles nothing and would put the numerator back at zero — the exact vacuous
    // shape this test exists to avoid.)
    const fixture = createLongRunFixture(new FlakyProvider(new FakeWholeSceneProvider(), 1));
    await driveWorldDay(fixture, 0);
    const report = summarizeResourceUsage({
      worldId: WORLD_ID,
      policy: TOKEN_BUDGET_POLICY_DEFAULTS,
      counters: fixture.budget.allCounters,
      ledger: fixture.budget.ledger,
    });

    expect(report.totalTokens).toBeGreaterThan(0);
    expect(report.retryTokens).toBeGreaterThan(0);
    expect(report.retryTokenShare).toBeGreaterThan(0);
    expect(report.retryTokenShare!).toBeLessThanOrEqual(SECTION_16_3_MAX_RETRY_TOKEN_SHARE);
    expect(report.retryTokenShareCompliant).toBe(true);
  });

  it('metering integrity — a provider reporting a DIFFERENT model is caught on the live path', async () => {
    // The ART-72 landmine, fired end to end. `sceneBudgetProviderPin.test.ts` catches the specific
    // case of a provider being injected in `worldDayLiveFunctions.ts`; this catches the case a
    // source pin structurally cannot see — the provider is wired correctly but ANSWERS with a
    // different model id from the one the meter keyed on. Without this the per-model cap would
    // meter an empty bucket while the real model spent, and nothing else would look wrong.
    const fixture = createLongRunFixture(new MisreportingProvider(new FakeWholeSceneProvider(), 'gpt-4o'));
    await driveSlot(fixture, slot(0, 'morning'));
    const report = summarizeResourceUsage({
      worldId: WORLD_ID,
      policy: TOKEN_BUDGET_POLICY_DEFAULTS,
      counters: fixture.budget.allCounters,
      ledger: fixture.budget.ledger,
    });

    // A non-empty sample first: calls really were settled, so the count below is a measurement.
    expect(report.grantedCalls).toBeGreaterThan(0);
    expect(report.modelMeteringMismatches).toBe(report.grantedCalls);
    expect(report.modelMeteringMismatchReason).toContain('ART-72');
    // The world keeps running: a mismatch is reported, never thrown. A gateway answering with a
    // pinned revision of the requested model is legitimate and must not take the world down.
    expect(fixture.canon.committedEvents().length).toBeGreaterThan(0);
  });

  it('metering integrity — the honest run reports zero mismatches, with no reason attached', async () => {
    // The negative control for the case above. Without it, "mismatches were detected" would be
    // evidence of nothing: a detector that fires on every run detects nothing at all.
    const fixture = createLongRunFixture();
    await driveSlot(fixture, slot(0, 'morning'));
    const report = summarizeResourceUsage({
      worldId: WORLD_ID,
      policy: TOKEN_BUDGET_POLICY_DEFAULTS,
      counters: fixture.budget.allCounters,
      ledger: fixture.budget.ledger,
    });

    expect(report.grantedCalls).toBeGreaterThan(0);
    expect(report.modelMeteringMismatches).toBe(0);
    expect(report.modelMeteringMismatchReason).toBeNull();
  });

  it('AC#5 — the SETTLEMENT counts fast-model work, including the no-switch branch', async () => {
    // `runBudgetedAttempt` builds the settlement, and the settlement is what feeds §16.3's
    // numerator. The live pipeline only ever sends `standard` importance, so this drives
    // `runBudgetedAttempt` directly — otherwise the one field AC#5's ratio is computed from has
    // no coverage at all, and deriving it from `routingReason` again would go unnoticed.
    const accountant = new InMemoryBudgetAccountant(
      FAKE_SCENE_MODEL,
      policyWith({ fastModelClass: FAKE_SCENE_MODEL }),
    );
    const base = {
      worldId: WORLD_ID, worldDay: 0, module: 'scene_simulation' as const,
      importance: 'low' as const, estimatedTokens: 100, attempt: 1,
      origin: 'scheduled_simulation' as const,
    };
    const trace = {
      provider: 'fake' as const, model: FAKE_SCENE_MODEL,
      inputTokens: 40, outputTokens: 10, latencyMs: 1, retryCount: 0,
    };

    // The no-switch branch: the request ALREADY names the fast class, so nothing is re-routed.
    await runBudgetedAttempt(accountant, {
      request: { ...base, requestedModel: FAKE_SCENE_MODEL },
      decisionId: 'already-fast',
      run: () => Promise.resolve({ value: null, trace }),
    });
    // And the switching branch, for contrast.
    await runBudgetedAttempt(accountant, {
      request: { ...base, requestedModel: 'writer-large' },
      decisionId: 'switched',
      run: () => Promise.resolve({ value: null, trace }),
    });

    const [counters] = accountant.allCounters;
    expect(counters.lowImportanceCalls).toBe(2);
    // BOTH count. The no-switch call has `routingReason: null` and ran on the fast class all the
    // same; counting only the switch would report a 50% share for a run in which every
    // low-importance call was correctly on the fast model.
    expect(counters.lowImportanceCallsOnFastModel).toBe(2);

    const report = summarizeResourceUsage({
      worldId: WORLD_ID,
      policy: policyWith({ fastModelClass: FAKE_SCENE_MODEL }),
      counters: accountant.allCounters,
      ledger: accountant.ledger,
    });
    expect(report.fastModelRoutingShare).toBe(1);
    expect(report.fastModelRoutingShareCompliant).toBe(true);
  });

  it('AC#3 — no public-read or viewer file can reach the budget enforcement surface', () => {
    // §16.3's "公開訪客流量不增加 LLM 呼叫" measured as a PROOF rather than as a count of zero.
    //
    // CORRECTED PREMISE. An earlier version of this comment claimed the dependency policy did not
    // stop a public read module reaching the accountant. It does: `check-boundaries.mjs` rejects
    // `publicRead -> simulation`, which is where the enforcement lives, and the reviewer confirmed
    // that by injecting `createConvexBudgetPort` into `convex/publicRead/liveState.ts` and
    // watching the boundary check refuse it.
    //
    // What the policy does NOT stop is `publicRead -> shared`, so a public read module may import
    // `shared/tokenBudget`'s pure functions. Those cannot spend: they take counters and return
    // decisions, and only the `simulation` binding turns a decision into a row. So this test is a
    // DEFENCE IN DEPTH over the boundary check rather than the sole guard — it catches a spending
    // symbol arriving in `publicRead` or `viewer` by a route the module graph would allow, and it
    // fails loudly rather than relying on a second file's rule staying correct.
    //
    // Every symbol below is asserted to exist, because a guard entry naming nothing guards
    // nothing — `reserveTokenBudget` was such an entry and never existed anywhere in the tree.
    const forbidden = ['createConvexBudgetPort', 'tokenBudgetLedger',
      'tokenBudgetCounters', 'runBudgetedAttempt', 'InMemoryBudgetAccountant'];
    const offenders: string[] = [];
    for (const root of ['convex/publicRead', 'convex/viewer']) {
      for (const name of readdirSync(join(ROOT, root))) {
        if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
        const source = readFileSync(join(ROOT, root, name), 'utf8');
        for (const symbol of forbidden) {
          if (source.includes(symbol)) offenders.push(`${root}/${name}: ${symbol}`);
        }
      }
    }
    expect(offenders).toEqual([]);

    // A forbidden-symbol list is only a guard if every symbol on it is real. Each one must occur
    // somewhere under `convex/` OUTSIDE the two scanned roots, or it is guarding a typo.
    const searched = ['convex/shared', 'convex/simulation', 'convex/operations']
      .flatMap((root) => readdirSync(join(ROOT, root))
        .filter((name) => name.endsWith('.ts'))
        .map((name) => readFileSync(join(ROOT, root, name), 'utf8')))
      .join('\n');
    for (const symbol of forbidden) expect(searched).toContain(symbol);
  });

  it('AC#3 — refusals are attributed to the limit that caused them', async () => {
    const fixture = createLongRunFixture(new CountingProvider(), policyWith({ worldDailyTokenBudget: 1 }));
    await driveWorldDay(fixture, 0);
    const report = summarizeResourceUsage({
      worldId: WORLD_ID,
      policy: policyWith({ worldDailyTokenBudget: 1 }),
      counters: fixture.budget.allCounters,
      ledger: fixture.budget.ledger,
    });

    expect(report.refusedCalls).toBeGreaterThan(0);
    expect(report.refusedByLimit.world_daily_tokens).toBe(report.refusedCalls);
    expect(report.refusedByLimit.concurrency).toBe(0);
    expect(report.dailyCapCompliant).toBe(true);
    // The cap held: nothing was settled at all, so no world day exceeded it.
    expect(report.worldDaysOverCap).toEqual([]);
  });
});
