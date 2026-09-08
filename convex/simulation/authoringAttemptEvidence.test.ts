/**
 * The LIVE wiring behind §16.2's 「JSON 結構成功率」 (ART-90, FR-M002).
 *
 * `convex/quality/operationalQuality.test.ts` proves the evaluator divides the right numbers. This
 * file proves the numbers it divides are the ones the authoring path actually produces, by driving
 * the REAL {@link simulateWholeScene} retry loop against a real {@link GroupedScene} and collecting
 * what `onAttempt` reported.
 *
 * ## Why this file exists at all
 *
 * The deterministic author never fails a schema. Every existing suite therefore observes a
 * structured-output rate of exactly 1, and a rate that CANNOT fall is not evidence that the §16.2
 * gate works — it is a number that would read 100% through a provider returning nothing but
 * garbage. So the cases below inject each of the three outcomes at its own source:
 *
 *  - `parsed` — the provider answers and the runtime schema accepts the answer;
 *  - `output_rejected` — the provider ANSWERS and the schema refuses it, once per attempt, so an
 *    exhausted scene contributes as many observations as it made calls;
 *  - `provider_failed` — nothing came back to validate.
 *
 * and the last case feeds the collected attempts into the real evaluator to show the gate can
 * FAIL. The transient-then-success case additionally shows the number that must not move: a
 * provider failure followed by a success is 1/1, not 1/2, because a network outage is not a model
 * that cannot follow a schema.
 */

import { FakeWholeSceneProvider, FAKE_SCENE_MODEL } from './fakeSceneNarrator';
import {
  SimulationProviderError,
  type EmbeddingResult,
  type LanguageModelProvider,
  type ProviderTraceMetadata,
  type StructuredChatRequest,
  type StructuredChatResult,
} from './provider';
import type { GroupedScene } from './sceneGrouping';
import { simulateWholeScene, type WholeSceneSimulationOptions } from './sceneSimulation';
import {
  evaluateOperationalQuality,
  type AuthoringAttemptEvidence,
  type OperationalQualityEvidence,
} from '../quality/operationalQuality';

const scene: GroupedScene = {
  schemaVersion: 1, sceneId: 'group-1:scene:1', groupingRunId: 'group-1', directorRunId: 'director-1',
  worldId: 'mistwood', worldDay: 2, timeSlot: 'evening', locationId: 'mistwood-station',
  participantIds: ['lin-yingxue', 'wu-zhen'], sourceIntentIds: ['intent-1', 'intent-2'],
  arcIds: ['arc-station-ledger'], trigger: 'Open the sealed locker', dramaticPressure: 'The mayor arrives at dusk',
};

/** Exactly what the live path's `onAttempt` receives, taken from the real signature. */
type RecordedAttempt = Parameters<NonNullable<WholeSceneSimulationOptions['onAttempt']>>[0];

const collector = (): { recorded: RecordedAttempt[]; onAttempt: (attempt: RecordedAttempt) => void } => {
  const recorded: RecordedAttempt[] = [];
  return { recorded, onAttempt: (attempt) => { recorded.push(attempt); } };
};

const trace = (overrides: Partial<ProviderTraceMetadata> = {}): ProviderTraceMetadata => ({
  provider: 'fake', requestedModel: FAKE_SCENE_MODEL, resolvedModel: FAKE_SCENE_MODEL,
  upstreamProvider: 'fake', rateLimit: null, inputTokens: 10, outputTokens: 20, latencyMs: 1,
  retryCount: 0, ...overrides,
});

/**
 * The real deterministic author, with the transport-retry count of its trace forced.
 *
 * The fake never retries at the transport layer, so a fixture that only used it could not tell a
 * reported `transportRetries` apart from a hard-coded zero.
 */
class TracedFakeProvider implements LanguageModelProvider {
  private readonly inner = new FakeWholeSceneProvider();
  calls = 0;

  constructor(private readonly retryCount: number) {}

  async structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
    this.calls += 1;
    const result = await this.inner.structuredChat(request);
    return { output: result.output, trace: { ...result.trace, retryCount: this.retryCount } };
  }

  embed(text: string): Promise<EmbeddingResult> { return this.inner.embed(text); }
}

/** A provider that ANSWERS, with an answer the runtime schema will refuse. */
class MalformedOutputProvider implements LanguageModelProvider {
  calls = 0;

  constructor(private readonly output: unknown) {}

  structuredChat(): Promise<StructuredChatResult> {
    this.calls += 1;
    return Promise.resolve({ output: this.output, trace: trace() });
  }

  embed(): Promise<EmbeddingResult> { return Promise.reject(new Error('not used')); }
}

/**
 * Wraps a real provider and pretends the first `failFirstN` calls failed, then delegates.
 * The same shape `convex/operations/failureIntegration.test.ts` injects provider faults with.
 */
class FlakyWholeSceneProvider implements LanguageModelProvider {
  private calls = 0;

  constructor(
    private readonly inner: LanguageModelProvider,
    private readonly failFirstN: number,
    private readonly kind: 'transient' | 'permanent' = 'transient',
  ) {}

  get callCount(): number { return this.calls; }

  structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
    this.calls += 1;
    if (this.calls <= this.failFirstN) {
      return Promise.reject(new SimulationProviderError(this.kind, 'PROVIDER_SYNTHETIC_FAILURE',
        `synthetic ${this.kind} failure #${this.calls}`));
    }
    return this.inner.structuredChat(request);
  }

  embed(text: string): Promise<EmbeddingResult> { return this.inner.embed(text); }
}

/**
 * The mapping `convex/simulation/qualityEvidenceFunctions.ts` performs when it stores an attempt:
 * the durable id is `${simulationRunId}:attempt:${n}`, and the model booked against the attempt is
 * what the gateway RESOLVED, falling back to what was requested when it did not say.
 */
const asEvidence = (
  simulationRunId: string, recorded: readonly RecordedAttempt[],
): AuthoringAttemptEvidence[] => recorded.map((row) => ({
  worldDay: scene.worldDay,
  sceneId: scene.sceneId,
  attemptId: `${simulationRunId}:attempt:${row.attempt}`,
  outcome: row.outcome,
  errorCode: row.errorCode,
  model: row.resolvedModel ?? row.requestedModel,
  transportRetries: row.transportRetries,
}));

const evidenceOf = (attempts: AuthoringAttemptEvidence[]): OperationalQualityEvidence => ({
  worldId: scene.worldId, fromWorldDay: scene.worldDay, toWorldDay: scene.worldDay,
  validations: [], attempts, scenes: [], scanLimitReached: false,
});

const structuredRateOf = (attempts: AuthoringAttemptEvidence[]) => {
  const metric = evaluateOperationalQuality(evidenceOf(attempts)).report.metrics
    .find(({ key }) => key === 'structured_output_success_rate');
  if (metric === undefined) throw new Error('report carries no structured_output_success_rate metric');
  return metric;
};

// =============================================================================
// parsed
// =============================================================================

describe('ART-90 authoring attempts: a provider that answers correctly', () => {
  it('records exactly one parsed attempt, with no code and the transport retries from the trace', async () => {
    const provider = new TracedFakeProvider(2);
    const { recorded, onAttempt } = collector();

    const result = await simulateWholeScene(provider, 'group-1:scene:1:simulation', scene, {
      maxAttempts: 2, model: FAKE_SCENE_MODEL, onAttempt,
    });

    expect(provider.calls).toBe(1);
    expect(result.attemptCount).toBe(1);
    expect(recorded).toEqual([{
      attempt: 1,
      outcome: 'parsed',
      errorCode: null,
      requestedModel: FAKE_SCENE_MODEL,
      resolvedModel: FAKE_SCENE_MODEL,
      // Read from the trace, not assumed: the transport retried twice inside this one
      // SEMANTIC attempt, and the two layers are counted separately.
      transportRetries: 2,
    }]);

    expect(structuredRateOf(asEvidence('group-1:scene:1:simulation', recorded)))
      .toMatchObject({ numerator: 1, denominator: 1, rate: 1, excluded: 0, meetsTarget: true });
  });

  it('reports the model as unknown-until-resolved rather than inventing one', async () => {
    const { recorded, onAttempt } = collector();
    await simulateWholeScene(new TracedFakeProvider(0), 'sim:no-model', scene, { onAttempt });

    // No configured model and no budget reservation to take one from: the request inherited the
    // provider instance's model, and saying `unknown` is the only honest thing to record.
    expect(recorded[0].requestedModel).toBe('unknown');
    expect(recorded[0].resolvedModel).toBe(FAKE_SCENE_MODEL);
  });
});

// =============================================================================
// output_rejected — the provider answered, and the schema refused the answer
// =============================================================================

describe('ART-90 authoring attempts: an answer the schema refuses', () => {
  it('records one output_rejected per attempt, so an exhausted scene reports TWO observations', async () => {
    // A well-formed envelope with the body missing: `proposedEvents` is not an array.
    const provider = new MalformedOutputProvider({ schemaVersion: 1, sceneId: scene.sceneId });
    const { recorded, onAttempt } = collector();

    await expect(simulateWholeScene(provider, 'sim:malformed', scene, { maxAttempts: 2, onAttempt }))
      .rejects.toMatchObject({ code: 'SCENE_OUTPUT_INVALID' });

    expect(provider.calls).toBe(2);
    expect(recorded).toHaveLength(2);
    expect(recorded.map(({ attempt, outcome, errorCode }) => ({ attempt, outcome, errorCode }))).toEqual([
      { attempt: 1, outcome: 'output_rejected', errorCode: 'SCENE_OUTPUT_INVALID' },
      { attempt: 2, outcome: 'output_rejected', errorCode: 'SCENE_OUTPUT_INVALID' },
    ]);
    // The answer WAS received, so neither attempt is a provider failure.
    expect(recorded.some(({ outcome }) => outcome === 'provider_failed')).toBe(false);

    expect(structuredRateOf(asEvidence('sim:malformed', recorded)))
      .toMatchObject({ numerator: 0, denominator: 2, rate: 0, excluded: 0, meetsTarget: false });
  });

  it('carries the specific SCENE_OUTPUT_* code the schema refused it with', async () => {
    const provider = new MalformedOutputProvider({ schemaVersion: 1, sceneId: 'someone-elses-scene' });
    const { recorded, onAttempt } = collector();

    await expect(simulateWholeScene(provider, 'sim:provenance', scene, { maxAttempts: 1, onAttempt }))
      .rejects.toMatchObject({ code: 'SCENE_OUTPUT_PROVENANCE_MISMATCH' });

    expect(recorded).toEqual([expect.objectContaining({
      attempt: 1, outcome: 'output_rejected', errorCode: 'SCENE_OUTPUT_PROVENANCE_MISMATCH',
    })]);
  });
});

// =============================================================================
// provider_failed — nothing came back to validate
// =============================================================================

describe('ART-90 authoring attempts: a provider that never answered', () => {
  it('records the failed attempt and the retry that succeeded, under different outcomes', async () => {
    const provider = new FlakyWholeSceneProvider(new FakeWholeSceneProvider(), 1, 'transient');
    const { recorded, onAttempt } = collector();

    const result = await simulateWholeScene(provider, 'sim:transient', scene, { maxAttempts: 2, onAttempt });

    expect(provider.callCount).toBe(2);
    expect(result.attemptCount).toBe(2);
    expect(recorded.map(({ attempt, outcome, errorCode }) => ({ attempt, outcome, errorCode }))).toEqual([
      { attempt: 1, outcome: 'provider_failed', errorCode: 'PROVIDER_SYNTHETIC_FAILURE' },
      { attempt: 2, outcome: 'parsed', errorCode: null },
    ]);
    // Nothing came back on the first attempt, so there is no resolved model to name.
    expect(recorded[0].resolvedModel).toBeNull();
    expect(recorded[1].resolvedModel).toBe(FAKE_SCENE_MODEL);
  });

  it('does not let that failure count against the structured-output rate', async () => {
    const provider = new FlakyWholeSceneProvider(new FakeWholeSceneProvider(), 1, 'transient');
    const { recorded, onAttempt } = collector();
    await simulateWholeScene(provider, 'sim:transient', scene, { maxAttempts: 2, onAttempt });

    const metric = structuredRateOf(asEvidence('sim:transient', recorded));
    // 1/1, not 1/2: the transport failure is excluded and published, not counted as a schema
    // failure. 1/2 here would mean an outage reads as a model that cannot follow a schema.
    expect(metric.numerator).toBe(1);
    expect(metric.denominator).toBe(1);
    expect(metric.rate).toBe(1);
    expect(metric.excluded).toBe(1);
    expect(metric.excludedReason).toContain('never received a model response');
    expect(metric.meetsTarget).toBe(true);
  });

  it('records one attempt for a permanent failure, and the call still throws', async () => {
    const provider = new FlakyWholeSceneProvider(new FakeWholeSceneProvider(), 1, 'permanent');
    const { recorded, onAttempt } = collector();

    await expect(simulateWholeScene(provider, 'sim:permanent', scene, { maxAttempts: 2, onAttempt }))
      .rejects.toBeInstanceOf(SimulationProviderError);

    expect(provider.callCount).toBe(1); // a permanent failure is not retried
    expect(recorded).toEqual([expect.objectContaining({
      attempt: 1, outcome: 'provider_failed', errorCode: 'PROVIDER_SYNTHETIC_FAILURE',
    })]);

    const metric = structuredRateOf(asEvidence('sim:permanent', recorded));
    expect(metric.denominator).toBe(0);
    expect(metric.status).toBe('no_observations');
    expect(metric.rate).toBeNull();
    expect(metric.rate).not.toBe(0);
  });
});

// =============================================================================
// The §16.2 gate can actually fail
// =============================================================================

describe('PRD §16.2: the structured-output gate can fail on real authoring evidence', () => {
  it('falls below 0.98 once a real run answered with output the schema refused', async () => {
    const healthy = collector();
    await simulateWholeScene(new TracedFakeProvider(0), 'sim:healthy', scene, {
      maxAttempts: 1, onAttempt: healthy.onAttempt,
    });

    const malformed = collector();
    await expect(simulateWholeScene(
      new MalformedOutputProvider({ schemaVersion: 1, sceneId: scene.sceneId }),
      'sim:refused', scene, { maxAttempts: 2, onAttempt: malformed.onAttempt },
    )).rejects.toMatchObject({ code: 'SCENE_OUTPUT_INVALID' });

    const outage = collector();
    await expect(simulateWholeScene(
      new FlakyWholeSceneProvider(new FakeWholeSceneProvider(), 1, 'permanent'),
      'sim:outage', scene, { maxAttempts: 2, onAttempt: outage.onAttempt },
    )).rejects.toBeInstanceOf(SimulationProviderError);

    const attempts = [
      ...asEvidence('sim:healthy', healthy.recorded),
      ...asEvidence('sim:refused', malformed.recorded),
      ...asEvidence('sim:outage', outage.recorded),
    ];
    expect(attempts).toHaveLength(4);

    const metric = structuredRateOf(attempts);
    expect(metric.numerator).toBe(1);
    expect(metric.denominator).toBe(3);
    expect(metric.excluded).toBe(1);
    expect(metric.rate).toBeLessThan(0.98);
    expect(metric.meetsTarget).toBe(false);

    const { report, breakdown } = evaluateOperationalQuality(evidenceOf(attempts));
    expect(report.findings.filter(({ code }) => code === 'STRUCTURED_OUTPUT_REJECTED')).toHaveLength(2);
    expect(report.findings.filter(({ code }) => code === 'PROVIDER_ATTEMPT_FAILED')).toHaveLength(1);
    expect(breakdown.structuredOutputReasons).toEqual([{ code: 'SCENE_OUTPUT_INVALID', count: 2 }]);
    expect(breakdown.providerFailureReasons).toEqual([{ code: 'PROVIDER_SYNTHETIC_FAILURE', count: 1 }]);
  });
});
