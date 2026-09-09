/**
 * THE live world-day entry point (ART-159): the one place a real model authors a scene.
 *
 * ## What was wrong before this file existed
 *
 * `runQueuedWorldDaySlot` is an `internalMutation`, and a Convex mutation may not perform network
 * I/O. So the live path could not call a provider at all, and `createWorldDayStageHandlers`
 * DEFAULTED to the deterministic `FakeWholeSceneProvider` — which meant the production entry point
 * selected the fake by saying nothing. The adapter (ART-72), the safety gate (ART-156) and the
 * free-route chain (ART-158) were all built, tested, and unreachable: `parseFreeRouteChain` had no
 * caller anywhere in the codebase.
 *
 * That is not a wiring oversight a one-line injection fixes. The provider call has to move out of
 * the transaction, and everything that must stay transactional has to stay behind.
 *
 * ## The split, and what stays inside a transaction
 *
 *   prepareQueuedWorldDaySlot   (mutation)  stages 1–6, claims the slot, stops at the network
 *          ↓  SceneAuthoringPlan
 *   authorSlotScenes            (ACTION)    the provider call, the route chain, the budget
 *          ↓  persisted scenes
 *   runQueuedWorldDaySlot       (mutation)  stages 7–10: structural, Canon, safety, commit
 *
 * Only the provider call left the transaction. Every guarantee the one-pass path had is still
 * enforced inside one, and by the SAME code:
 *
 *  - **Canon Validation** — `validate_canon` runs in the finishing mutation, against a projection
 *    replayed from the seeded baseline, exactly as before.
 *  - **Safety Validation** — twice, and neither is in the action.
 *    `persistValidatedSceneSimulation` re-parses the output and re-runs `finalizeWholeSceneOutput`
 *    (which classifies) before it writes; the finishing pass then re-derives `reviewStatus` from
 *    the stored result and withholds on it. A scene cannot reach Canon without passing a
 *    classifier the action does not run. Pre-generation safety is separately enforced at the PORT,
 *    INSIDE the route chain, so it screens every hop rather than only the first.
 *  - **Idempotency** — unchanged, and load-bearing here. Scene results dedup on `simulationRunId`,
 *    proposals on `idempotencyKey`, budget decisions on `decisionId`, the world-day run on its
 *    checkpoints. A crash anywhere in the sequence re-runs it without double-committing and,
 *    because authored scenes are persisted as they are produced, without paying for them twice.
 *  - **Event Persistence** — `commitProposedEvent`, in the finishing mutation. Nothing in this
 *    file writes to Canon; it writes only `sceneSimulationRuns` and the budget ledger.
 *
 * ## Why the action does not simply drive all ten stages
 *
 * It could — `ctx.runMutation` is available — but `commitProposedEvent` reads Canon, validates
 * against what it read, and appends. That is atomic only because it happens inside ONE mutation.
 * Driving it step by step from an action would leave the three interleavable, which is the race
 * the append-only guarantee exists to exclude.
 *
 * ## Why this file is in `providers/`
 *
 * `architecture/module-boundaries.json` confines adapter construction to this directory, and this
 * is the composition root: the only place that turns deployment configuration into a provider and
 * hands it to the world. Everything it calls takes the vendor-neutral port.
 *
 * The same boundary is why post-commit is NOT run here — `simulation` may not depend on
 * `operations`. That costs nothing, because stages 11–21 were never a callback on this call's
 * commits: `drainLivePostCommit` is a CURSOR over accepted events, so it picks up whatever this
 * committed whenever it next runs.
 *
 *   npx convex run simulation/providers/liveWorldDayActions:runLiveWorldDaySlotWithProvider '{"worldId":"mistwood"}'
 *   npx convex run operations/postCommitLiveFunctions:drainLivePostCommit '{"worldId":"mistwood"}'
 */

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import type { ActionCtx } from '../../_generated/server';
import { internalFunctionRef } from '../../shared/internalFunctionRef';
import type { listDrivableWorlds as listDrivableWorldsExport } from '../schedulerOperations';
import type {
  prepareQueuedWorldDaySlot as prepareQueuedWorldDaySlotExport,
  runQueuedWorldDaySlot as runQueuedWorldDaySlotExport,
  PreparedSlot,
  WorldDaySlotOutcome,
} from '../worldDayLiveFunctions';
import type { recordAuthoringAttempt as recordAuthoringAttemptExport } from '../qualityEvidenceFunctions';
import type {
  findReusableSceneSimulation as findReusableSceneSimulationExport,
  persistValidatedSceneSimulation as persistValidatedSceneSimulationExport,
} from '../sceneSimulationFunctions';
import type {
  reserveSceneBudget as reserveSceneBudgetExport,
  settleSceneBudget as settleSceneBudgetExport,
  releaseSceneBudget as releaseSceneBudgetExport,
} from '../tokenBudgetGateFunctions';
import { TIME_SLOTS } from '../../canon/eventTypes';
import { authorSlotScenes, type SceneAuthoringStore } from '../worldDayLive';
import type { LanguageModelProvider } from '../provider';
import { createLiveSceneAuthor, resolveLiveSceneAuthoringModel } from './liveSceneAuthor';
import { createProviderCallRecorder } from './providerCallRecorder';
import type { recordProviderCall as recordProviderCallExport } from '../providerRateFunctions';
import type { recordSlotOutcome as recordSlotOutcomeExport } from '../degradationFunctions';
import type { DegradationLevel } from '../degradation';

const prepareQueuedWorldDaySlotRef = internalFunctionRef<typeof prepareQueuedWorldDaySlotExport>(
  'simulation/worldDayLiveFunctions:prepareQueuedWorldDaySlot',
);
const runQueuedWorldDaySlotRef = internalFunctionRef<typeof runQueuedWorldDaySlotExport>(
  'simulation/worldDayLiveFunctions:runQueuedWorldDaySlot',
);
const recordAuthoringAttemptRef = internalFunctionRef<typeof recordAuthoringAttemptExport>(
  'simulation/qualityEvidenceFunctions:recordAuthoringAttempt',
);
const findReusableSceneSimulationRef = internalFunctionRef<typeof findReusableSceneSimulationExport>(
  'simulation/sceneSimulationFunctions:findReusableSceneSimulation',
);
const persistValidatedSceneSimulationRef = internalFunctionRef<typeof persistValidatedSceneSimulationExport>(
  'simulation/sceneSimulationFunctions:persistValidatedSceneSimulation',
);
const reserveSceneBudgetRef = internalFunctionRef<typeof reserveSceneBudgetExport>(
  'simulation/tokenBudgetGateFunctions:reserveSceneBudget',
);
const settleSceneBudgetRef = internalFunctionRef<typeof settleSceneBudgetExport>(
  'simulation/tokenBudgetGateFunctions:settleSceneBudget',
);
const releaseSceneBudgetRef = internalFunctionRef<typeof releaseSceneBudgetExport>(
  'simulation/tokenBudgetGateFunctions:releaseSceneBudget',
);
const recordSlotOutcomeRef = internalFunctionRef<typeof recordSlotOutcomeExport>(
  'simulation/degradationFunctions:recordSlotOutcome',
);
const recordProviderCallRef = internalFunctionRef<typeof recordProviderCallExport>(
  'simulation/providerRateFunctions:recordProviderCall',
);
const listDrivableWorldsRef = internalFunctionRef<typeof listDrivableWorldsExport>(
  'simulation/schedulerOperations:listDrivableWorlds',
);

/**
 * The authoring store, bound to an action's `ctx` instead of to a `ctx.db`.
 *
 * Every method calls the SAME internal function the transactional path uses. The dedup rules, the
 * ledger writes and the safety re-classification on persist are not re-implemented for actions —
 * they are invoked. That is what makes "the live path is metered and gated" a fact about the
 * deployed code rather than about a second copy written to satisfy this file.
 */
export function actionAuthoringStore(ctx: ActionCtx, now: number): SceneAuthoringStore {
  return {
    loadPersistedSceneSimulation: (worldId, groupingRunId, simulationRunId) =>
      ctx.runQuery(findReusableSceneSimulationRef, { worldId, groupingRunId, simulationRunId }),
    persistSceneSimulation: async (groupingRunId, result) => {
      await ctx.runMutation(persistValidatedSceneSimulationRef, {
        worldId: result.scene.worldId, simulationRunId: result.simulationRunId, groupingRunId,
        sceneId: result.scene.sceneId, output: result.output, attemptCount: result.attemptCount,
        trace: result.trace, createdAt: now,
      });
    },
    // FR-M002 / ART-90. The action authors, so the action is where a per-attempt record can be
    // written at all — the finishing mutation only ever sees results that already parsed.
    recordAuthoringAttempt: async (attempt) => {
      await ctx.runMutation(recordAuthoringAttemptRef, { ...attempt, now });
    },
    // Three transactions rather than one, because they happen at three moments with a network
    // call between them. That is what `sceneBudget.ts` always described and what a single
    // mutation could not deliver: inside one transaction `maxConcurrentCalls` was unobservable,
    // since a serialized mutation can never see a second call in flight.
    budget: {
      reserve: (request, decisionId) =>
        ctx.runMutation(reserveSceneBudgetRef, { request, decisionId, now }),
      settle: async (request, decisionId, settlement) => {
        await ctx.runMutation(settleSceneBudgetRef, { request, decisionId, settlement, now });
      },
      release: async (request, decisionId, failure = null) => {
        await ctx.runMutation(releaseSceneBudgetRef, { request, decisionId, failure, now });
      },
    },
  };
}

/** One slot's live outcome, plus what the authoring half did before the slot was settled. */
export type LiveSlotOutcome = {
  outcome: WorldDaySlotOutcome | undefined;
  /** Scenes this call put through the provider. Zero means every one was already stored. */
  authoredScenes: number;
  /**
   * The stable code authoring failed with, when it did.
   *
   * Reported separately from the slot's own `errorCode` because the two answer different
   * questions. A slot that could not be authored fails with `SCENE_AUTHORING_DEFERRED` — the
   * scenes were not there — which says nothing about WHY. `LLM_HTTP_RETRYABLE`,
   * `LLM_FREE_ROUTES_EXHAUSTED`, `LLM_CONFIG_MISSING` and `SCENE_BUDGET_REFUSED` call for four
   * different operator responses, and collapsing them into "authoring failed" would lose exactly
   * the distinction the route chain exists to make.
   */
  authoringErrorCode?: string;
  /**
   * FR-M004 (ART-165): the rung this slot ran at, and whether it was the periodic provider probe.
   *
   * `prepareQueuedWorldDaySlot` has returned the level since ART-91 and nothing read it, so the
   * cron's own return value — the thing that makes a run readable without opening the database —
   * never said which rung a slot authored at. A degraded run and a healthy one looked identical.
   */
  degradationLevel: DegradationLevel;
  probe: boolean;
};

/** The stable code an error carries, or a marker saying it carried none. */
const stableCodeOf = (error: unknown): string =>
  error !== null && typeof error === 'object' && 'code' in error
    && typeof (error as { code: unknown }).code === 'string'
    ? (error as { code: string }).code
    : 'SCENE_AUTHORING_FAILED';

/**
 * Author one prepared slot's scenes, then settle the slot.
 *
 * An authoring failure is deliberately NOT swallowed. The finishing pass still runs, and it fails
 * the slot because the scenes it needs are absent — so a slot whose provider refused ends up
 * `failed` rather than silently `completed` with nothing in it. Whatever scenes DID get authored
 * before the failure stay persisted, so the retry pays only for the ones still missing.
 */
export async function authorAndSettle(
  ctx: ActionCtx,
  provider: LanguageModelProvider,
  prepared: Extract<PreparedSlot, { kind: 'awaiting_authoring' }>,
  worldId: string,
  now: number,
): Promise<LiveSlotOutcome> {
  let authoredScenes = 0;
  let authoringErrorCode: string | undefined;
  try {
    const authored = await authorSlotScenes(provider, actionAuthoringStore(ctx, now), prepared.plan);
    authoredScenes = authored.length;
  } catch (error) {
    authoringErrorCode = stableCodeOf(error);
  }
  /**
   * FR-M004 (ART-91). The ladder is fed here, and only here, because this is the one place that
   * knows whether the PROVIDER worked — the finishing mutation sees only whether the scenes it
   * needed were present, which is the same symptom for an outage and for a slot never authored.
   *
   * Recorded before the slot is settled, so a world whose provider has now failed twice is already
   * on the next rung when the next tick claims it. The write is idempotent on a derived transition
   * id, so a retried slot re-reaches the same decision without walking the ladder.
   */
  await ctx.runMutation(recordSlotOutcomeRef, {
    worldId,
    worldDay: prepared.plan.slot.worldDay,
    timeSlot: prepared.plan.slot.timeSlot,
    authored: authoringErrorCode === undefined,
    // This branch exists because the slot needed a provider, so it called one (ART-165).
    usedProvider: true,
    // ART-167: the attempt, so a retried slot's second failure counts as a second failure.
    attempt: prepared.attempt,
    errorCode: authoringErrorCode ?? null,
    now,
  });
  const settled: { slots: WorldDaySlotOutcome[] } = await ctx.runMutation(runQueuedWorldDaySlotRef, {
    worldId, slotId: prepared.slotId, maxSlots: 1, sceneAuthor: 'preauthored',
    deploymentModelId: prepared.plan.requestedModel, now,
  });
  return {
    outcome: settled.slots[0],
    authoredScenes,
    degradationLevel: prepared.degradationLevel,
    probe: prepared.probe,
    ...(authoringErrorCode === undefined ? {} : { authoringErrorCode }),
  };
}

/**
 * Advance ONE world by up to `maxSlots` slots, through the full live sequence.
 *
 * Shared by the cron driver and the manual entry point, so "how a slot is driven" has exactly one
 * implementation. A second copy would be free to disagree about the `busy` stop or the
 * stop-on-failure rule, and both of those are correctness properties rather than conveniences.
 */
async function driveOneWorld(ctx: ActionCtx, input: {
  provider: LanguageModelProvider;
  worldId: string;
  maxSlots: number;
  now: number;
  deploymentModelId: string;
}): Promise<DrivenWorld> {
  const slots: LiveSlotOutcome[] = [];
  let skipped: string | undefined;

  for (let index = 0; index < input.maxSlots; index += 1) {
    const prepared: PreparedSlot = await ctx.runMutation(prepareQueuedWorldDaySlotRef, {
      worldId: input.worldId, deploymentModelId: input.deploymentModelId, now: input.now,
    });
    if (prepared.kind === 'idle') break;
    if (prepared.kind === 'busy') {
      // Another driver holds this world. Stop — do NOT move on to the next queued slot: world
      // time is ordered, and authoring slot N+1 against a world that slot N has not finished
      // advancing would produce scenes about a state that never existed.
      skipped = 'SLOT_LEASE_HELD';
      break;
    }
    if (prepared.kind === 'settled') {
      /**
       * Nothing to author: every scene was already stored, the Director planned none, a stage
       * before authoring decided the slot, or the world is on a rules-only rung. Not one of those
       * called a model, so the ladder is told exactly that (ART-165).
       *
       * It used to be told `authored: true`, which credited a rules-only slot with an authoring it
       * had not performed and climbed the world straight back out of `rules_only` — making
       * `deferred_summaries` and `paused` unreachable by any outage. The slot still feeds the
       * ladder, because that is how a no-provider world counts its way to the next probe.
       */
      await ctx.runMutation(recordSlotOutcomeRef, {
        worldId: input.worldId, worldDay: prepared.outcome.worldDay, timeSlot: prepared.outcome.timeSlot,
        authored: prepared.outcome.status === 'completed', usedProvider: false,
        attempt: prepared.outcome.attemptCount, errorCode: null, now: input.now,
      });
      slots.push({
        outcome: prepared.outcome, authoredScenes: 0,
        // A settled slot ran at the world's rung and was never a probe: a probe needs a provider,
        // and this branch is every way a slot finishes without one.
        degradationLevel: prepared.degradationLevel, probe: false,
      });
    } else {
      slots.push(await authorAndSettle(ctx, input.provider, prepared, input.worldId, input.now));
    }
    // Stop on the first slot that did not complete, exactly as the deterministic path does.
    if (slots[slots.length - 1].outcome?.status !== 'completed') break;
  }

  return { worldId: input.worldId, executed: slots.length, slots, ...(skipped ? { skipped } : {}) };
}

/**
 * Whether this deployment can author live at all.
 *
 * Checked BEFORE anything is claimed, so a deployment with no provider configuration reports a
 * reason once per tick instead of throwing `LLM_CONFIG_MISSING` out of a cron every minute. A cron
 * that always errors is a cron nobody reads, and this failure has to stay legible: it is exactly
 * what "the world stopped advancing" looks like from the outside.
 */
function liveAuthoringConfiguration(): { ok: true; deploymentModelId: string } | { ok: false; reason: string } {
  try {
    return { ok: true, deploymentModelId: resolveLiveSceneAuthoringModel(process.env) };
  } catch (error) {
    return { ok: false, reason: stableCodeOf(error) };
  }
}

/** What one world's tick did, so a cron run is readable without reading the database. */
export type DrivenWorld = {
  worldId: string;
  executed: number;
  slots: LiveSlotOutcome[];
  /**
   * Why this world was not advanced further, when it was not.
   *
   * `SLOT_LEASE_HELD` is a NORMAL outcome, not a fault: another driver holds the world's claim,
   * and a tick reporting it is a tick that correctly declined to double-author. A stable error
   * code means the world itself refused — `WORLD_EMERGENCY_STOPPED` and a paused schedule both
   * arrive here.
   */
  skipped?: string;
};

/**
 * Build the live author for one world, with its calls metered (ART-158 AC#2).
 *
 * One provider per world rather than one for the whole tick, because the rate recorder has to
 * attribute each upstream call to the world that made it — and `worldId` is the only part of that
 * attribution the transport cannot see for itself.
 */
function liveAuthorFor(ctx: ActionCtx, worldId: string, fallbackModel: string) {
  const recorder = createProviderCallRecorder({
    inner: globalThis.fetch.bind(globalThis),
    fallbackModel,
    // `Date.now` and not the frozen `now`: the frozen value exists so a retried slot regenerates
    // identical run ids, and using it here would drop a whole slot's calls into one bucket.
    clock: () => Date.now(),
    sink: (record) => ctx.runMutation(recordProviderCallRef, { worldId, ...record }),
  });
  return { provider: createLiveSceneAuthor(process.env, { fetch: recorder.fetch }), recorder };
}

/**
 * THE automatic live driver (ART-160), invoked by cron.
 *
 * Every running public world is advanced through the full prepare → author → finalize sequence
 * with no operator in the loop. The minute cron that already RESERVES due slots
 * (`tickAllPublicSchedules`) now has the counterpart that DRAINS them.
 *
 * ## Failure is per world, not per tick
 *
 * A world that is emergency-stopped, paused between the listing and the claim, or otherwise
 * refuses throws out of `prepareQueuedWorldDaySlot`. That is caught per world and recorded, so one
 * broken world cannot stop every other world from advancing — the shape a shared cron failure
 * would otherwise take.
 *
 * ## Post-commit is deliberately NOT run here
 *
 * `architecture/module-boundaries.json` forbids `simulation` depending on `operations`, and this
 * file is the provider composition root. That costs nothing: stages 11–21 were never a callback on
 * a slot's commits — `drainLivePostCommit` is a CURSOR over accepted events — so its own cron
 * picks up whatever this committed, in canon order, whenever it next runs.
 */
export const driveLiveWorlds = internalAction({
  args: {
    /** Slots per world per tick. One matches the clock's own rate; more is a catch-up. */
    maxSlotsPerWorld: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    worlds: DrivenWorld[]; skipped: string | null; meteringDropped: number;
  }> => {
    const configuration = liveAuthoringConfiguration();
    // No provider configured. Reported, not thrown — see `liveAuthoringConfiguration`. The
    // deterministic path is unaffected and still needs none of this.
    if (!configuration.ok) return { worlds: [], skipped: configuration.reason, meteringDropped: 0 };

    const now = args.now ?? Date.now();
    const maxSlots = args.maxSlotsPerWorld ?? 1;
    if (!Number.isSafeInteger(maxSlots) || maxSlots < 1 || maxSlots > TIME_SLOTS.length) {
      throw new Error('INVALID_SLOT_BATCH_SIZE');
    }
    const worldIds: string[] = await ctx.runQuery(listDrivableWorldsRef, {});

    const worlds: DrivenWorld[] = [];
    let meteringDropped = 0;
    for (const worldId of worldIds) {
      const { provider, recorder } = liveAuthorFor(ctx, worldId, configuration.deploymentModelId);
      try {
        worlds.push(await driveOneWorld(ctx, {
          provider, worldId, maxSlots, now, deploymentModelId: configuration.deploymentModelId,
        }));
      } catch (error) {
        worlds.push({ worldId, executed: 0, slots: [], skipped: stableCodeOf(error) });
      }
      meteringDropped += recorder.dropped();
    }
    return { worlds, skipped: null, meteringDropped };
  },
});

/**
 * Run queued world time slots for ONE named world, authoring with the configured provider.
 *
 * The manual counterpart of {@link driveLiveWorlds}, for an operator driving a single world:
 *
 *   npx convex run simulation/providers/liveWorldDayActions:runLiveWorldDaySlotWithProvider '{"worldId":"mistwood"}'
 *
 * Requires the deployment environment to carry the provider configuration (`LLM_API_URL`,
 * `LLM_MODEL`, …). Unlike the cron driver this THROWS when that is missing, because an operator
 * who asked for a live run needs to be told why it did not happen.
 *
 * The deterministic path is untouched and needs none of it: `runQueuedWorldDaySlot` with
 * `sceneAuthor: 'deterministic_fake'` still runs a whole slot in one transaction with no network.
 */
export const runLiveWorldDaySlotWithProvider = internalAction({
  args: {
    worldId: v.string(),
    maxSlots: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<DrivenWorld & { meteringDropped: number }> => {
    const now = args.now ?? Date.now();
    const maxSlots = args.maxSlots ?? 1;
    if (!Number.isSafeInteger(maxSlots) || maxSlots < 1 || maxSlots > TIME_SLOTS.length) {
      throw new Error('INVALID_SLOT_BATCH_SIZE');
    }
    // The FIRST ROUTE of the chain about to be built. This is the key the FR-M003 reservation is
    // taken under, and it may well be an alias such as `auto` that names no model; ART-148 settles
    // against whatever the gateway says served the call.
    const deploymentModelId = resolveLiveSceneAuthoringModel(process.env);
    const { provider, recorder } = liveAuthorFor(ctx, args.worldId, deploymentModelId);

    const driven = await driveOneWorld(ctx, {
      provider, worldId: args.worldId, maxSlots, now, deploymentModelId,
    });
    // Non-zero means the rate metering sink refused a write, so this call's RPM/TPM figures are a
    // floor. Reported rather than swallowed: a provider call is already paid for by the time it is
    // recorded, so the counter yields to the work — but not silently.
    return { ...driven, meteringDropped: recorder.dropped() };
  },
});
