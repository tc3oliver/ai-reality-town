/**
 * §16.2's structured-output success rate, measured against the REAL gateway (ART-90).
 *
 * ## Why this file has to exist at all
 *
 * The fixed-seed harness authors with the deterministic provider, which returns a valid
 * `whole_scene_output` every time. Its structured-output rate is therefore 1.0 by construction,
 * and a rate that cannot fall is not evidence about whether a MODEL can follow a schema — it is a
 * statement about a fixture. `operationalQuality.test.ts` proves the metric can fall, and
 * `authoringAttemptEvidence.test.ts` proves the live path records the attempts. Neither can say
 * anything about the gateway this deployment is actually configured against, and §16.2's 98% is a
 * claim about that.
 *
 * So: a small number of real structured calls, through the same provider the live world-day path
 * builds, scored by the same evaluator the operator query runs. Whatever it measures is what it
 * reports — a run that comes in under 98% FAILS, and that failure is the honest answer for this
 * deployment on this day rather than a number carried over from a fixture.
 *
 *   ART90_LIVE_STRUCTURE=1 npm run test:live-structure
 *
 * ## What it costs and why the sample is small
 *
 * Each attempt spends a real per-key allowance unit — ART-158 measured the free pool at 120, and a
 * REFUSED call costs one too. {@link SAMPLE_SIZE} calls is enough to catch a gateway that cannot
 * honour `response_format` at all, which is the failure this is for; it is nowhere near enough to
 * estimate a 98% rate to two significant figures, and the assertions say so rather than pretending
 * otherwise. A deployment that wants a real estimate runs this with a larger sample and records
 * the number, which is why the size is a constant and the denominator is printed.
 *
 * A skipped run is NOT evidence: without the flag this is `describe.skip`, which reports zero
 * tests rather than a pass.
 */

import { loadOpenAICompatibleConfig } from './config';
import { createLiveSceneAuthor, resolveLiveSceneAuthoringModel } from './liveSceneAuthor';
import { SimulationProviderError } from '../provider';
import {
  evaluateOperationalQuality,
  OPERATIONAL_QUALITY_EVALUATOR_VERSION,
  type AuthoringAttemptEvidence,
} from '../../quality/operationalQuality';

const describeLive = process.env.ART90_LIVE_STRUCTURE === '1' ? describe : describe.skip;

/** Real calls this file makes. Every one spends allowance; see the module note. */
const SAMPLE_SIZE = 8;

/**
 * A structured request shaped like the one the world-day path sends: a nested object, a required
 * array of objects, and `additionalProperties: false` throughout.
 *
 * Deliberately not the trivial `{"ok":true}` probe `liveGatewaySmoke.test.ts` uses. That one
 * proves the endpoint answers; this one has to be hard enough that a gateway which ignores
 * `response_format` and free-writes prose gets it wrong, because that is the failure §16.2's rate
 * is about. It is still small: one scene-shaped object, two actions.
 */
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sceneSummary', 'keyActions'],
  properties: {
    sceneSummary: { type: 'string' },
    keyActions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['characterId', 'action'],
        properties: { characterId: { type: 'string' }, action: { type: 'string' } },
      },
    },
  },
} as const;

const request = (index: number) => ({
  messages: [
    { role: 'system' as const, content: 'You return JSON matching the schema. No prose, no markdown fence.' },
    {
      role: 'user' as const,
      content: `Scene ${index}: two residents of a fictional river town discuss a disputed record. `
        + 'Return a sceneSummary and one keyAction per resident, with characterId "a" and "b".',
    },
  ],
  schemaName: 'whole_scene_output',
  jsonSchema: SCHEMA as unknown as Record<string, unknown>,
  temperature: 0,
  maxTokens: 400,
});

/** The runtime validation this deployment would apply to the answer. */
function parses(output: unknown): boolean {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) return false;
  const record = output as Record<string, unknown>;
  if (typeof record.sceneSummary !== 'string' || record.sceneSummary.trim().length === 0) return false;
  if (!Array.isArray(record.keyActions) || record.keyActions.length === 0) return false;
  return record.keyActions.every((entry) => typeof entry === 'object' && entry !== null
    && typeof (entry as Record<string, unknown>).characterId === 'string'
    && typeof (entry as Record<string, unknown>).action === 'string');
}

describeLive('ART-90 live structured-output evidence', () => {
  it('the deployment is configured to make a structured call at all', () => {
    const config = loadOpenAICompatibleConfig(process.env);
    expect(config.chatUrl).toMatch(/^https?:\/\//u);
    expect(resolveLiveSceneAuthoringModel(process.env).trim().length).toBeGreaterThan(0);
  });

  it('measures §16.2 JSON 結構成功率 against the real gateway, and reports the denominator', async () => {
    const provider = createLiveSceneAuthor(process.env);
    const attempts: AuthoringAttemptEvidence[] = [];

    for (let index = 0; index < SAMPLE_SIZE; index += 1) {
      const attemptId = `live:structure:attempt:${index}`;
      try {
        const result = await provider.structuredChat(request(index));
        attempts.push({
          worldDay: 0, sceneId: `live:structure:${index}`, attemptId,
          outcome: parses(result.output) ? 'parsed' : 'output_rejected',
          errorCode: parses(result.output) ? null : 'SCENE_OUTPUT_INVALID',
          model: result.trace.resolvedModel ?? result.trace.requestedModel,
          transportRetries: result.trace.retryCount,
        });
      } catch (error) {
        // No answer to validate. Excluded from the rate by the evaluator, and reported — a gateway
        // that is down is not a model that cannot follow a schema.
        attempts.push({
          worldDay: 0, sceneId: `live:structure:${index}`, attemptId,
          outcome: 'provider_failed',
          errorCode: error instanceof SimulationProviderError ? error.code : 'SCENE_ATTEMPT_FAILED',
          model: resolveLiveSceneAuthoringModel(process.env),
          transportRetries: 0,
        });
      }
    }

    const { report, breakdown } = evaluateOperationalQuality({
      worldId: 'live-structure-probe', fromWorldDay: 0, toWorldDay: 0,
      validations: [], scenes: [], attempts, scanLimitReached: false,
    });
    const metric = report.metrics.find(({ key }) => key === 'structured_output_success_rate');
    if (!metric) throw new Error('structured_output_success_rate missing');

    // The denominator first, and the exclusions with it: a rate over an empty sample is not a
    // measurement, and a run where every call failed to connect must not read as 98% or as 0%.
    // eslint-disable-next-line no-console
    console.log('[ART-90 live] evaluator=v%d parsed=%d/%d excluded=%d rate=%s models=%s rejections=%s failures=%s',
      OPERATIONAL_QUALITY_EVALUATOR_VERSION, metric.numerator, metric.denominator, metric.excluded,
      metric.rate === null ? 'no_observations' : metric.rate.toFixed(4),
      JSON.stringify(breakdown.models), JSON.stringify(breakdown.structuredOutputReasons),
      JSON.stringify(breakdown.providerFailureReasons));

    expect(attempts).toHaveLength(SAMPLE_SIZE);
    // Every call refused at the transport is a deployment problem, not a schema measurement, and
    // it is reported as one rather than silently passing an empty rate.
    expect(metric.denominator).toBeGreaterThan(0);
    expect(metric.status).toBe('measured');
    expect(metric.target).toBe(0.98);
    // The claim this file exists to make. It fails when the configured gateway cannot hold the
    // contract, which is the only honest thing to do with a live measurement.
    expect(metric.meetsTarget).toBe(true);
  }, 300_000);
});
