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
import type { Id } from '../../_generated/dataModel';
import { internalFunctionRef } from '../../shared/internalFunctionRef';
import type {
  prepareQueuedWorldDaySlot as prepareQueuedWorldDaySlotExport,
  runQueuedWorldDaySlot as runQueuedWorldDaySlotExport,
  PreparedSlot,
  WorldDaySlotOutcome,
} from '../worldDayLiveFunctions';
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

const prepareQueuedWorldDaySlotRef = internalFunctionRef<typeof prepareQueuedWorldDaySlotExport>(
  'simulation/worldDayLiveFunctions:prepareQueuedWorldDaySlot',
);
const runQueuedWorldDaySlotRef = internalFunctionRef<typeof runQueuedWorldDaySlotExport>(
  'simulation/worldDayLiveFunctions:runQueuedWorldDaySlot',
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
  const settled: { slots: WorldDaySlotOutcome[] } = await ctx.runMutation(runQueuedWorldDaySlotRef, {
    worldId, slotId: prepared.slotId, maxSlots: 1, sceneAuthor: 'preauthored',
    deploymentModelId: prepared.plan.requestedModel, now,
  });
  return {
    outcome: settled.slots[0],
    authoredScenes,
    ...(authoringErrorCode === undefined ? {} : { authoringErrorCode }),
  };
}

/**
 * Run queued world time slots for one world, authoring their scenes with the CONFIGURED PROVIDER.
 *
 * Requires the deployment environment to carry the provider configuration (`LLM_API_URL`,
 * `LLM_MODEL`, …). `createLiveSceneAuthor` throws a stable `LLM_CONFIG_*` / `LLM_AUTH_REQUIRED`
 * error before any slot is claimed if it does not, so a misconfigured deployment fails on the
 * first call rather than halfway through a world day with a slot already claimed.
 *
 * The deterministic path is untouched and needs none of this: `runQueuedWorldDaySlot` with
 * `sceneAuthor: 'deterministic_fake'` still runs a whole slot in one transaction with no network.
 */
export const runLiveWorldDaySlotWithProvider = internalAction({
  args: {
    worldId: v.string(),
    slotId: v.optional(v.id('scheduledSlots')),
    maxSlots: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ worldId: string; executed: number; slots: LiveSlotOutcome[] }> => {
    const now = args.now ?? Date.now();
    const maxSlots = args.maxSlots ?? 1;
    if (!Number.isSafeInteger(maxSlots) || maxSlots < 1 || maxSlots > TIME_SLOTS.length) {
      throw new Error('INVALID_SLOT_BATCH_SIZE');
    }
    // Built ONCE for the whole call. The chain keeps `lastAttempts` on the instance, and a fresh
    // provider per scene would re-read and re-validate the deployment configuration every time.
    const provider = createLiveSceneAuthor(process.env);
    // The FIRST ROUTE of the chain that was just built — not a second reading of the environment.
    // This is the key the FR-M003 reservation is taken under, and it may well be an alias such as
    // `auto` that names no model; ART-148 settles against whatever the gateway says served the
    // call, so the alias is only ever the key, never the model usage is booked against.
    const deploymentModelId = resolveLiveSceneAuthoringModel(process.env);

    const slots: LiveSlotOutcome[] = [];
    let explicit: Id<'scheduledSlots'> | undefined = args.slotId;
    for (let index = 0; index < maxSlots; index += 1) {
      const prepared: PreparedSlot = await ctx.runMutation(prepareQueuedWorldDaySlotRef, {
        worldId: args.worldId, slotId: explicit, deploymentModelId, now,
      });
      explicit = undefined;
      if (prepared.kind === 'idle') break;
      slots.push(prepared.kind === 'settled'
        // Nothing to author: every scene was already stored, the Director planned none, or a
        // stage before authoring decided the slot.
        ? { outcome: prepared.outcome, authoredScenes: 0 }
        : await authorAndSettle(ctx, provider, prepared, args.worldId, now));
      // Stop on the first slot that did not complete, exactly as the deterministic path does.
      // World time is ordered: running the next slot on top of a failed one would author it
      // against a world state the failed slot was supposed to have advanced.
      if (slots[slots.length - 1].outcome?.status !== 'completed') break;
    }
    return { worldId: args.worldId, executed: slots.length, slots };
  },
});
