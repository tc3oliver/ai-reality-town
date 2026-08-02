/**
 * Foundation simulation workflow.
 *
 * Phase 0 uses a deterministic fake provider that needs no network, so the workflow is a
 * single Convex mutation: it creates a `simulationRuns` row, runs the provider, commits
 * the proposal through the canon pipeline (same transaction → atomic + idempotent), and
 * records the outcome. The orchestration itself is a pure helper ({@link executeFoundationRun})
 * tested with mock dependencies.
 *
 * Retry semantics: transient PROVIDER failures are retried a bounded number of times
 * inside the run (a provider failure happens before commit, so retrying never
 * duplicates an event). Convex also auto-retries the whole mutation on transient DB
 * errors; because the commit is idempotent on `idempotencyKey`, such a retry still
 * produces exactly one event.
 *
 * Future durable workflow: when a real (network-calling) LLM provider is introduced the
 * workflow should move to `@convex-dev/workflow` (compatible with the current Convex
 * version; see `docs/upstream.md`). That is intentionally out of scope for Phase 0.
 */

import { mutation } from '../_generated/server';
import { v } from 'convex/values';
import { isCanonError } from '../shared/errors';
import {
  commitProposedEvent,
  createConvexCanonStore,
  type CommitResult,
} from '../canon/commit';
import type { ProposedEvent } from '../canon/model';
import { normalizeProposedEventOutput } from '../canon/proposedEvent';
import {
  FakeSimulationProvider,
} from './fakeProvider';
import { SimulationProviderError, isTransientProviderError } from './provider';
import type { FoundationRunOutcome, SimulationInput } from './model';

/** Maximum attempts for a transient provider failure within one run. */
export const MAX_PROVIDER_ATTEMPTS = 3;

/** Dependencies injected into the pure orchestration (mockable in tests). */
export type FoundationRunDeps = {
  propose: (input: SimulationInput) => Promise<unknown>;
  commit: (proposed: ProposedEvent, traceId: string) => Promise<CommitResult>;
};

/** Reduce any thrown value to a stable {code, message}. */
export function describeRunError(e: unknown): {
  code: string;
  message: string;
  path?: string;
  details?: Record<string, unknown>;
} {
  if (isCanonError(e)) return {
    code: e.error.code,
    message: e.error.message,
    ...(e.error.path === undefined ? {} : { path: e.error.path }),
    ...(e.error.details === undefined ? {} : { details: e.error.details }),
  };
  if (e instanceof SimulationProviderError) return { code: e.code, message: e.message };
  if (e instanceof Error) return { code: 'UNKNOWN', message: e.message };
  return { code: 'UNKNOWN', message: String(e) };
}

/**
 * Pure orchestration of one foundation run: propose → commit, with bounded retry on
 * transient provider failures. Returns a {@link FoundationRunOutcome}; never throws.
 */
export async function executeFoundationRun(
  input: SimulationInput,
  deps: FoundationRunDeps,
): Promise<FoundationRunOutcome> {
  let lastError: unknown = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt++) {
    attempts = attempt;
    try {
      const proposed = normalizeProposedEventOutput(await deps.propose(input));
      const result = await deps.commit(proposed, input.traceId);
      return {
        status: 'completed',
        eventId: result.eventId,
        sequenceNumber: result.sequenceNumber,
        deduplicated: result.deduplicated,
        attempts,
      };
    } catch (e) {
      lastError = e;
      // Only transient PROVIDER errors (which occur before commit) are retried.
      if (isTransientProviderError(e) && attempt < MAX_PROVIDER_ATTEMPTS) continue;
      break;
    }
  }
  const { code, message, path, details } = describeRunError(lastError);
  return {
    status: 'failed',
    errorCode: code,
    errorMessage: message,
    ...(path === undefined ? {} : { errorPath: path }),
    ...(details === undefined ? {} : { errorDetails: details }),
    attempts,
  };
}

// --- Convex args validator -------------------------------------------------

export const simulationInputArgs = v.object({
  seed: v.number(),
  worldId: v.string(),
  worldDay: v.number(),
  timeSlot: v.string(),
  idempotencyKey: v.string(),
  traceId: v.string(),
  scenario: v.string(),
  proposedBy: v.object({
    type: v.string(),
    id: v.optional(v.string()),
  }),
  characterId: v.string(),
  fromLocationId: v.string(),
  toLocationId: v.string(),
  partnerCharacterId: v.string(),
});

// --- Convex mutation -------------------------------------------------------

export const runFoundationSimulation = mutation({
  args: { input: simulationInputArgs },
  handler: async (ctx, { input }): Promise<{ runId: string } & FoundationRunOutcome> => {
    // Convex validators use `v.string()` for literal-union fields; cast to the strict
    // domain type here (the fake provider and commit pipeline validate at runtime).
    const simulationInput = input as unknown as SimulationInput;
    const startedAt = Date.now();
    const runId = await ctx.db.insert('simulationRuns', {
      worldId: simulationInput.worldId,
      runType: 'foundation',
      status: 'pending',
      startedAt,
      provider: 'fake',
      traceId: simulationInput.traceId,
    });
    await ctx.db.patch(runId, { status: 'running' });

    const provider = new FakeSimulationProvider();
    const store = createConvexCanonStore(ctx.db);
    const outcome = await executeFoundationRun(simulationInput, {
      propose: (i) => provider.proposeEvent(i),
      commit: (proposed, traceId) => commitProposedEvent(store, { proposed, traceId }),
    });

    const completedAt = Date.now();
    if (outcome.status === 'completed') {
      await ctx.db.patch(runId, {
        status: 'completed',
        completedAt,
        committedEventId: outcome.eventId,
        sequenceNumber: outcome.sequenceNumber,
      });
    } else {
      await ctx.db.patch(runId, {
        status: 'failed',
        completedAt,
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
        errorPath: outcome.errorPath,
        errorDetails: outcome.errorDetails,
      });
    }
    return { runId, ...outcome };
  },
});
