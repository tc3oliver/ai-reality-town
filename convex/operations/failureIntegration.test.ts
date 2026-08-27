/**
 * ART-74 — Simulation and editorial failure integration suite (PRD §19.2 cases 6–10).
 *
 * Every case drives the REAL in-memory pipeline (the same one `runLongRunSimulation`
 * drives) under an injected fault, instead of re-implementing the stages. The reusable
 * fixture (`createLongRunFixture`) wires the real canon store, the real downstream
 * post-commit harness, the real read-model store and the real stage-handler chains to
 * one scene-authoring provider; the only thing this file adds is fault injection.
 *
 *   AC#1 (case 6) provider failure retries safely and records normalized trace evidence
 *   AC#2 (case 7) retry never duplicates an accepted event
 *   AC#3 (case 8) episode generation consumes accepted events only
 *   AC#4 (case 9) canon correction refreshes every affected public projection
 *   AC#5 (case 10) simulation failure leaves last-known-good public content readable
 *
 * Zero cost, no network: scene authoring goes through ART-4's deterministic
 * FakeWholeSceneProvider; the flaky wrapper only decides when to pretend a provider call
 * failed. No Canon, safety, idempotency, authorization or publication control is bypassed.
 */

import { TIME_SLOTS, type TimeSlot } from '../canon/eventTypes';
import { commitProposedEvent } from '../canon/commit';
import { MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { FakeWholeSceneProvider, FAKE_SCENE_MODEL } from '../simulation/fakeSceneNarrator';
import { simulateWholeScene } from '../simulation/sceneSimulation';
import {
  SimulationProviderError,
  type EmbeddingResult,
  type LanguageModelProvider,
  type StructuredChatRequest,
  type StructuredChatResult,
} from '../simulation/provider';
import { executeWorldDay, type WorldDayRun } from '../simulation/worldDayOrchestration';
import { worldDayRunId, type WorldDaySlotIdentity } from '../simulation/worldDayLive';
import { invalidateReadModel, serveReadModel, commitReadModelVersion, SERVABLE_STATUS } from '../publicRead/readModel';
import { LIVE_MODEL_KIND } from '../publicRead/liveState';
import { submitRemediation, type RemediationPorts, type RemediationRequest } from './canonCorrection';
import type { OperatorAuditEntry, OperatorPrincipal } from './operatorAuthorization';
import { executePostCommitPipeline, type PostCommitRunInput } from './postCommitOrchestration';
import { postCommitRunId } from './postCommitLive';
import {
  createLongRunFixture,
  type LongRunFixture,
} from './longRunHarness';

const WORLD_ID = MISTWOOD_PUBLIC_WORLD_ID;
const AT = 1_700_000_000_000;
const ADMIN: OperatorPrincipal = { operatorId: 'ops-admin', role: 'admin', source: 'identity', subject: 'auth|admin' };

// --- fault-injection provider ------------------------------------------------

/**
 * Wraps a real provider and pretends the first `failFirstN` calls fail, then delegates.
 * `failFirstN = 0` means "never fail unless `broken` is set", which is how AC#5 breaks the
 * provider on demand after a healthy run has already published content.
 */
class FlakyWholeSceneProvider implements LanguageModelProvider {
  readonly model = FAKE_SCENE_MODEL;
  private calls = 0;
  /** When set, every subsequent call fails permanently (AC#5 on-demand outage). */
  broken = false;

  constructor(
    private readonly inner: LanguageModelProvider,
    private readonly failFirstN: number,
    private readonly kind: 'transient' | 'permanent' = 'transient',
  ) {}

  get callCount(): number { return this.calls; }

  async structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
    this.calls += 1;
    if (this.broken) {
      throw new SimulationProviderError('permanent', 'PROVIDER_OUTAGE', 'provider is broken on demand');
    }
    if (this.calls <= this.failFirstN) {
      throw new SimulationProviderError(this.kind, 'PROVIDER_SYNTHETIC_FAILURE',
        `synthetic ${this.kind} failure #${this.calls}`);
    }
    return this.inner.structuredChat(request);
  }

  embed(text: string): Promise<EmbeddingResult> { return this.inner.embed(text); }
}

// --- driving helpers ---------------------------------------------------------

const slot = (worldDay: number, timeSlot: TimeSlot): WorldDaySlotIdentity =>
  ({ worldId: WORLD_ID, worldDay, timeSlot });

async function driveSlot(fixture: LongRunFixture, target: WorldDaySlotIdentity): Promise<WorldDayRun> {
  return executeWorldDay({ runId: worldDayRunId(target), ...target }, fixture.worldDayRunStore, fixture.worldDayHandlers);
}

/** Run the post-commit pipeline for every accepted event not yet processed (canon order). */
async function drainPostCommit(fixture: LongRunFixture, processed: { value: number }): Promise<void> {
  const accepted = fixture.canon.committedEvents();
  for (const event of accepted.slice(processed.value)) {
    const input: PostCommitRunInput = {
      runId: postCommitRunId(WORLD_ID, event.sequenceNumber),
      worldId: WORLD_ID,
      sourceEventId: event.eventId,
      sourceEventSequenceNumber: event.sequenceNumber,
      worldDay: event.worldDay,
    };
    await executePostCommitPipeline(input, fixture.postCommitRunStore, fixture.postCommitHandlers, event.traceId);
  }
  processed.value = accepted.length;
}

/** Drive every time slot of one world day, running post-commit after each slot. */
async function driveWorldDay(fixture: LongRunFixture, worldDay: number, processed: { value: number }): Promise<void> {
  for (const timeSlot of TIME_SLOTS) {
    await driveSlot(fixture, slot(worldDay, timeSlot));
    await drainPostCommit(fixture, processed);
  }
}

const versionsOf = (fixture: LongRunFixture, modelKind: string): number =>
  fixture.readStore.rows.filter((row) => row.modelKind === modelKind).length;

const currentRow = (fixture: LongRunFixture, modelKind: string, modelRef: string) =>
  fixture.readStore.rows.find((row) => row.modelKind === modelKind && row.modelRef === modelRef && row.isCurrent) ?? null;

// =============================================================================
// AC#1 — Provider failure retries safely and records normalized trace evidence
// =============================================================================

describe('ART-74 AC#1 — provider failure retries safely', () => {
  // Capture one real grouped scene from a healthy slot so the retry tests run against
  // a scene the pipeline actually produced.
  async function captureScene() {
    const fixture = createLongRunFixture();
    const processed = { value: 0 };
    await driveSlot(fixture, slot(0, 'morning'));
    await drainPostCommit(fixture, processed);
    const scene = fixture.observations.simulations[0]?.scene;
    if (!scene) throw new Error('fixture produced no scene to retry against');
    return scene;
  }

  it('retries a transient provider failure and records the retry in a normalized trace', async () => {
    const scene = await captureScene();
    // Fail the first call transiently, then succeed.
    const flaky = new FlakyWholeSceneProvider(new FakeWholeSceneProvider(), 1, 'transient');
    const result = await simulateWholeScene(flaky, 'sim:retry', scene, { maxAttempts: 2 });

    expect(result.attemptCount).toBe(2);              // succeeded on the second attempt
    expect(flaky.callCount).toBe(2);                  // the failed call was retried, not swallowed
    expect(result.trace.retryCount).toBeGreaterThanOrEqual(1); // retry surfaced in the trace
    expect(result.trace.provider).toBe('fake');       // trace is the normalized shape, not a raw error
    expect(result.trace.model).toBe(FAKE_SCENE_MODEL);
    expect(Number.isFinite(result.trace.inputTokens) && result.trace.inputTokens >= 0).toBe(true);
    expect(Number.isFinite(result.trace.outputTokens) && result.trace.outputTokens >= 0).toBe(true);
  });

  it('does not retry a permanent provider failure', async () => {
    const scene = await captureScene();
    const permanent = new FlakyWholeSceneProvider(new FakeWholeSceneProvider(), 1, 'permanent');
    await expect(simulateWholeScene(permanent, 'sim:perm', scene, { maxAttempts: 2 })).rejects.toThrow(SimulationProviderError);
    expect(permanent.callCount).toBe(1); // permanent errors are not retried
  });

  it('succeeds with no retry when the provider is healthy', async () => {
    const scene = await captureScene();
    const healthy = new FlakyWholeSceneProvider(new FakeWholeSceneProvider(), 0);
    const result = await simulateWholeScene(healthy, 'sim:ok', scene, { maxAttempts: 2 });
    expect(result.attemptCount).toBe(1);
    expect(result.trace.retryCount).toBe(0);
    expect(healthy.callCount).toBe(1);
  });
});

// =============================================================================
// AC#2 — Retry never duplicates an accepted event
// =============================================================================

describe('ART-74 AC#2 — retry never duplicates an accepted event', () => {
  it('a transiently-failing slot fails, then resumes and commits each event exactly once', async () => {
    // Fail the first two provider calls (one full simulateWholeScene invocation at
    // maxAttempts=2), so the slot's world-day run fails on attempt 1 before any commit.
    const flaky = new FlakyWholeSceneProvider(new FakeWholeSceneProvider(), 2, 'transient');
    const fixture = createLongRunFixture(flaky);
    const target = slot(0, 'morning');

    const first = await driveSlot(fixture, target);
    expect(first.status).toBe('failed');                    // failed at simulate_scenes
    expect(fixture.canon.committedEvents()).toHaveLength(0); // commit is the last stage: nothing committed

    // Retry the SAME slot: the run resumes from the failed stage and now succeeds.
    const resumed = await driveSlot(fixture, target);
    expect(resumed.status).toBe('completed');
    const accepted = fixture.canon.committedEvents();
    expect(accepted.length).toBeGreaterThanOrEqual(1);

    // Every accepted event id and idempotency key is unique — the retry did not duplicate.
    const ids = new Set(accepted.map(({ eventId }) => eventId));
    const keys = new Set(accepted.map(({ idempotencyKey }) => idempotencyKey));
    expect(ids.size).toBe(accepted.length);
    expect(keys.size).toBe(accepted.length);

    // Driving the now-completed slot a third time short-circuits and appends nothing.
    const before = fixture.canon.committedEvents().length;
    const third = await driveSlot(fixture, target);
    expect(third.status).toBe('completed');
    expect(fixture.canon.committedEvents()).toHaveLength(before);
  });

  it('commitProposedEvent is idempotent: a retried commit deduplicates instead of appending', async () => {
    const fixture = createLongRunFixture();
    const processed = { value: 0 };
    await driveSlot(fixture, slot(0, 'morning'));
    await drainPostCommit(fixture, processed);

    const alreadyCommitted = fixture.observations.simulations[0].output.proposedEvents[0];
    const before = fixture.canon.committedEvents().length;

    // Re-submit the identical proposal (same idempotency key) the way a retry would.
    const retried = await commitProposedEvent(fixture.canon, { proposed: alreadyCommitted, traceId: 'retry' });

    expect(retried.deduplicated).toBe(true);
    expect(fixture.canon.committedEvents()).toHaveLength(before); // no second row
  });
});

// =============================================================================
// AC#3 — Episode generation consumes accepted events only
// =============================================================================

describe('ART-74 AC#3 — episodes consume accepted events only', () => {
  it('every episode sourceEventId is an accepted (canon-committed) event on the same day', async () => {
    const fixture = createLongRunFixture();
    const processed = { value: 0 };
    await driveWorldDay(fixture, 0, processed);
    await driveWorldDay(fixture, 1, processed);

    const acceptedByDay = new Map<number, Set<string>>();
    for (const event of fixture.canon.committedEvents()) {
      const set = acceptedByDay.get(event.worldDay) ?? new Set<string>();
      set.add(event.eventId);
      acceptedByDay.set(event.worldDay, set);
    }
    const allAccepted = new Set([...acceptedByDay.values()].flatMap((set) => [...set]));

    const episodes = [...fixture.harness.episodes.entries()].filter(([, row]) => row.episode);
    expect(episodes.length).toBeGreaterThan(0);

    for (const [worldDay, row] of episodes) {
      const episode = row.episode!;
      // Every cited source is an accepted event (never a raw/rejected proposal).
      for (const sourceEventId of episode.sourceEventIds) {
        expect(allAccepted.has(sourceEventId)).toBe(true);
        // Episodes are day-scoped: a source must belong to the episode's own world day.
        expect(acceptedByDay.get(worldDay)?.has(sourceEventId)).toBe(true);
      }
    }

    // A fabricated, never-committed id never appears in any episode (negative case).
    const phantom = 'never-committed-phantom-event';
    const referencedPhantom = episodes.some(([, row]) => row.episode!.sourceEventIds.includes(phantom));
    expect(referencedPhantom).toBe(false);
  });
});

// =============================================================================
// AC#4 — Canon correction refreshes every affected public projection
// =============================================================================

describe('ART-74 AC#4 — canon correction refreshes affected public projections', () => {
  it('a retcon runs the post-commit refresh and republishes the affected live projection', async () => {
    const fixture = createLongRunFixture();
    const processed = { value: 0 };
    await driveWorldDay(fixture, 0, processed);
    await driveWorldDay(fixture, 1, processed);

    const target = fixture.canon.committedEvents()[0];
    expect(target).toBeTruthy();
    // Remediation is appended after the latest accepted day, the way a real operator
    // corrects the record after the fact (mirrors canonCorrection.test.ts).
    const latestWorldDay = fixture.canon.committedEvents().reduce((max, event) => Math.max(max, event.worldDay), 0);

    const liveBefore = versionsOf(fixture, LIVE_MODEL_KIND);
    const liveCurrentBefore = currentRow(fixture, LIVE_MODEL_KIND, `live:${WORLD_ID}`);

    const audits: OperatorAuditEntry[] = [];
    const ports: RemediationPorts = {
      canonStore: fixture.canon,
      appendAudit: (entry) => { audits.push(entry); return Promise.resolve(); },
      // Mirrors canonCorrectionFunctions: re-run the SAME post-commit pipeline the
      // commit just allocated a sequence number for, so projections rebuild from the
      // corrected history through the ordinary publication path.
      refreshPublicContent: async (worldId, sequenceNumber) => {
        const event = fixture.canon.committedEvents().find((row) => row.sequenceNumber === sequenceNumber)!;
        const input: PostCommitRunInput = {
          runId: postCommitRunId(worldId, sequenceNumber), worldId,
          sourceEventId: event.eventId, sourceEventSequenceNumber: sequenceNumber, worldDay: event.worldDay,
        };
        const run = await executePostCommitPipeline(input, fixture.postCommitRunStore, fixture.postCommitHandlers,
          `art74:retcon:${sequenceNumber}`);
        return { runId: input.runId, status: run.status };
      },
    };

    const request: RemediationRequest = {
      worldId: WORLD_ID,
      remediationType: 'retcon',
      targetEventIds: [target.eventId],
      reason: 'ART-74: retcon proves affected public projections refresh',
      idempotencyKey: `art74:retcon:${target.eventId}`,
      worldDay: latestWorldDay + 1,
      timeSlot: 'morning',
      // Participantless fact restatement (the shape canonCorrection.test.ts proved the
      // validators accept) so the retcon cannot trip a participant-location rule.
      participantIds: [],
      publicSummary: 'CORRECTED: the public account of this event was retconned.',
      stateChanges: [{
        type: 'fact_created', subjectType: 'world', subjectId: WORLD_ID,
        predicate: 'art74RetconAccount', value: 'restated by retcon', visibility: 'public',
      }],
    };

    const result = await submitRemediation(ports, { principal: ADMIN, request, traceId: 'art74:retcon', at: AT });

    expect(result.deduplicated).toBe(false);                 // a new remediation event was appended
    expect(result.refresh.status).toBe('completed');         // the refresh pipeline ran to completion
    expect(audits).toHaveLength(1);                          // the operator action was audited
    expect(fixture.canon.committedEvents().map(({ eventId }) => eventId)).toContain(result.eventId);

    // AC#4: the correction's refresh republished the AFFECTED public read model. The live
    // projection surfaces the latest accepted events, so the retcon reaches it: a new
    // version was committed and its provenance carries the correction event. (Projections
    // the correction does not move — e.g. the importance-filtered timeline — correctly
    // dedupe and stay put; "affected" is the operative word in the acceptance criterion.)
    expect(versionsOf(fixture, LIVE_MODEL_KIND)).toBeGreaterThan(liveBefore);
    const liveCurrentAfter = currentRow(fixture, LIVE_MODEL_KIND, `live:${WORLD_ID}`);
    expect(liveCurrentAfter).not.toBeNull();
    expect(liveCurrentAfter!.version).toBeGreaterThan(liveCurrentBefore?.version ?? 0);
    expect(liveCurrentAfter!.sourceEventIds).toContain(result.eventId);
  });
});

// =============================================================================
// AC#5 — Simulation failure leaves last-known-good public content readable
// =============================================================================

describe('ART-74 AC#5 — simulation failure leaves last-known-good content readable', () => {
  it('a failed simulation slot commits nothing, so the already-published live view still serves', async () => {
    const flaky = new FlakyWholeSceneProvider(new FakeWholeSceneProvider(), 0); // healthy until broken
    const fixture = createLongRunFixture(flaky);
    const processed = { value: 0 };
    await driveWorldDay(fixture, 0, processed); // publishes the live projection

    const liveRef = `live:${WORLD_ID}`;
    const servedBefore = await serveReadModel(fixture.readStore, WORLD_ID, LIVE_MODEL_KIND, liveRef);
    expect(servedBefore).not.toBeNull();
    const acceptedBefore = fixture.canon.committedEvents().length;

    // Break the provider and attempt the next slot: the run fails at simulate_scenes.
    flaky.broken = true;
    const failed = await driveSlot(fixture, slot(1, 'morning'));
    expect(failed.status).toBe('failed');
    // A failed run never reaches the commit stage, so accepted history is untouched.
    expect(fixture.canon.committedEvents()).toHaveLength(acceptedBefore);

    // Public reads still serve the pre-computed snapshot — they never touch simulation.
    const servedAfter = await serveReadModel(fixture.readStore, WORLD_ID, LIVE_MODEL_KIND, liveRef);
    expect(servedAfter).not.toBeNull();
    expect(servedAfter?.servedFrom).toBe('current');
  });

  it('when the current version is invalidated, reads fall back to last-known-good', async () => {
    const fixture = createLongRunFixture();
    const processed = { value: 0 };
    await driveWorldDay(fixture, 0, processed);

    const liveRef = `live:${WORLD_ID}`;
    // Simulate a re-publication: a second published version demotes the first to last-known-good.
    await commitReadModelVersion(fixture.readStore, {
      worldId: WORLD_ID, modelKind: LIVE_MODEL_KIND, modelRef: liveRef,
      payload: { marker: 'art74-v2' }, sourceEventIds: ['art74:marker'],
      status: SERVABLE_STATUS, now: AT,
    });
    // Invalidate the current version (e.g. the latest publication failed a safety gate).
    await invalidateReadModel(fixture.readStore, {
      worldId: WORLD_ID, modelKind: LIVE_MODEL_KIND, modelRef: liveRef, status: 'failed', now: AT + 1,
    });

    const served = await serveReadModel(fixture.readStore, WORLD_ID, LIVE_MODEL_KIND, liveRef);
    expect(served).not.toBeNull();
    expect(served?.servedFrom).toBe('last_known_good'); // prior good content still readable
  });
});
