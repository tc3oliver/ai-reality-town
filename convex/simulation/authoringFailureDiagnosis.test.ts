/**
 * A failed live authoring attempt says what failed (ART-195).
 *
 * ## The failure this file is a response to
 *
 * A live slot on the acceptance deployment authored nothing and left this behind:
 *
 *     slot   authoringErrorCode: SCENE_SIMULATION_FAILED, authoredScenes: 0
 *     trace  errorCode: SCENE_ATTEMPT_FAILED, validationResult: not_run
 *
 * Both are constants. `SCENE_ATTEMPT_FAILED` was not even a diagnosis — it was the marker
 * `stableAttemptCode` returned when the thrown error carried no `code` at all, which is every raw
 * `Error`, every `TypeError`, and `PreGenerationSafetyError`, whose category lives on
 * `.rejection.code`. `SCENE_SIMULATION_FAILED` was the fallback `simulateWholeScene` threw after
 * discarding `lastError` entirely. So the world had stopped and nothing in the deployment could say
 * whether the gateway was down, the key was refused, a Convex mutation inside the budget gate had
 * failed, or the prompt had been blocked by policy — four faults needing four different responses.
 *
 * ## Why these tests drive the REAL adapter
 *
 * `convex/shared/failureDetail.test.ts` drives the classifier directly and proves its rules. That is
 * not enough on its own: the question here is whether the errors the SHIPPED transport actually
 * produces reach the recorder intact, and a hand-built error proves nothing about that. So the
 * cases below construct `createLanguageModelProvider` — the only sanctioned way to obtain a provider
 * — with a stub `fetch`, and let the real HTTP classification, the real response parsing and the
 * real retry ladder run. What is asserted is what an operator would read.
 */

import { FakeWholeSceneProvider } from './fakeSceneNarrator';
import { SimulationProviderError, type EmbeddingResult, type LanguageModelProvider, type StructuredChatResult } from './provider';
import { createLanguageModelProvider } from './providers/safeProvider';
import type { OpenAICompatibleConfig } from './providers/config';
import type { GroupedScene } from './sceneGrouping';
import { SceneSimulationError, simulateWholeScene, type WholeSceneSimulationOptions } from './sceneSimulation';
import { PRE_GENERATION_BLOCKED_CODE, redactFailureDetail, type FailureDetail } from '../shared/failureDetail';

const scene: GroupedScene = {
  schemaVersion: 1, sceneId: 'group-1:scene:1', groupingRunId: 'group-1', directorRunId: 'director-1',
  worldId: 'mistwood', worldDay: 2, timeSlot: 'evening', locationId: 'mistwood-station',
  participantIds: ['lin-yingxue', 'wu-zhen'], sourceIntentIds: ['intent-1'],
  arcIds: ['arc-station-ledger'], trigger: '開啟封存的置物櫃', dramaticPressure: '鎮長黃昏將至',
};

/** The deployment configuration shape, with a credential that must never reach a record. */
const CONFIG: OpenAICompatibleConfig = {
  apiUrl: 'https://gw.example/v1/',
  chatUrl: 'https://gw.example/v1/chat/completions',
  embeddingUrl: 'https://gw.example/v1/embeddings',
  chatModel: 'agnes-2.5-flash',
  embeddingModel: 'agnes-embed',
  embeddingDimension: 8,
  apiKey: 'sk-acceptance-2f19bb77ce40',
  allowUnauthenticated: false,
  timeoutMs: 5_000,
  maxAttempts: 1,
};

type RecordedAttempt = Parameters<NonNullable<WholeSceneSimulationOptions['onAttempt']>>[0];

const collector = (): { recorded: RecordedAttempt[]; onAttempt: (attempt: RecordedAttempt) => void } => {
  const recorded: RecordedAttempt[] = [];
  return { recorded, onAttempt: (attempt) => { recorded.push(attempt); } };
};

/** A JSON response, as the gateway would send one. */
const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** The real adapter, gated exactly as production obtains it, over a stubbed transport. */
const providerOver = (fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) =>
  createLanguageModelProvider(CONFIG, {
    fetch,
    // No real waiting: the transport ladder's backoff is not what any of these cases is about.
    delay: () => Promise.resolve(),
  });

/**
 * Run one scene and return the evidence a failure left, or throw if it unexpectedly succeeded.
 *
 * Returns BOTH halves deliberately — the attempt row an operator queries and the error the slot
 * settles on — because the defect was that each of them separately lost the reason.
 */
async function failureOf(
  provider: LanguageModelProvider, options: WholeSceneSimulationOptions = {},
): Promise<{ attempts: RecordedAttempt[]; thrown: unknown }> {
  const { recorded, onAttempt } = collector();
  try {
    await simulateWholeScene(provider, 'sim:diagnosis', scene, { maxAttempts: 1, onAttempt, ...options });
  } catch (thrown) {
    return { attempts: recorded, thrown };
  }
  throw new Error('expected the scene to fail');
}

/** The one failure detail an attempt reported, asserted to exist rather than optionally read. */
function detailOf(attempts: readonly RecordedAttempt[]): FailureDetail {
  const failed = attempts.find(({ failure }) => failure !== null);
  if (!failed || failed.failure === null) throw new Error('no attempt reported a failure detail');
  return failed.failure;
}

// =============================================================================
// 1. A plain Error — the shape that produced SCENE_ATTEMPT_FAILED
// =============================================================================

describe('the provider throws a plain Error', () => {
  /**
   * Thrown from the PORT, which is where a Convex mutation failure inside the budget gate and any
   * future adapter's unhandled exception both arrive. The old rule read `.code`, found none, and
   * wrote a constant.
   */
  class PlainThrowingProvider implements LanguageModelProvider {
    structuredChat(): Promise<StructuredChatResult> {
      return Promise.reject(new Error('Server Error: could not reach mutation reserveSceneBudget'));
    }

    embed(): Promise<EmbeddingResult> { return Promise.reject(new Error('unused')); }
  }

  it('records the class and the message instead of one constant', async () => {
    const { attempts } = await failureOf(new PlainThrowingProvider());
    const detail = detailOf(attempts);

    expect(detail.errorName).toBe('Error');
    expect(detail.message).toBe('Server Error: could not reach mutation reserveSceneBudget');
    expect(detail.code).toBe('PROVIDER_EXCEPTION_ERROR');
    // The value that used to be here, and the whole reason this task exists.
    expect(detail.code).not.toBe('SCENE_ATTEMPT_FAILED');
    expect(attempts[0].errorCode).toBe('PROVIDER_EXCEPTION_ERROR');
    expect(attempts[0].outcome).toBe('provider_failed');
  });

  it('carries the same detail out on the thrown error, so the SLOT can report it too', async () => {
    const { thrown } = await failureOf(new PlainThrowingProvider());
    // The code is unchanged — it is a published contract `describeWorldDayError` groups on — but it
    // no longer arrives empty.
    expect(thrown).toBeInstanceOf(SceneSimulationError);
    expect((thrown as SceneSimulationError).code).toBe('SCENE_SIMULATION_FAILED');
    expect((thrown as SceneSimulationError).detail?.message)
      .toContain('could not reach mutation reserveSceneBudget');
    expect((thrown as SceneSimulationError).message).toContain('PROVIDER_EXCEPTION_ERROR');
  });

  it('preserves a cause, which is where a fetch failure keeps its real reason', async () => {
    class CausedProvider implements LanguageModelProvider {
      structuredChat(): Promise<StructuredChatResult> {
        return Promise.reject(new TypeError('fetch failed', {
          cause: new Error('getaddrinfo ENOTFOUND gw.example'),
        }));
      }

      embed(): Promise<EmbeddingResult> { return Promise.reject(new Error('unused')); }
    }
    const detail = detailOf((await failureOf(new CausedProvider())).attempts);

    expect(detail.code).toBe('PROVIDER_EXCEPTION_TYPE_ERROR');
    expect(detail.causeName).toBe('Error');
    // `fetch failed` on its own names nothing. The cause is the diagnosis.
    expect(detail.causeMessage).toBe('getaddrinfo ENOTFOUND gw.example');
  });
});

// =============================================================================
// 2. A throw that was not an Error at all
// =============================================================================

describe('the provider throws a non-Error value', () => {
  const throwing = (value: unknown): LanguageModelProvider => ({
    structuredChat: () => Promise.reject(value),
    embed: () => Promise.reject(new Error('unused')),
  });

  it('names the type of a thrown string and keeps the string as the message', async () => {
    const detail = detailOf((await failureOf(throwing('gateway returned 502 from upstream'))).attempts);
    expect(detail).toMatchObject({
      code: 'PROVIDER_EXCEPTION_STRING',
      errorName: 'string',
      message: 'gateway returned 502 from upstream',
      retryable: false,
    });
  });

  it('does not stringify a thrown object, and still records something usable', async () => {
    // An object hanging off a rejection is most often the request or the response payload. It is
    // named, never serialised.
    const detail = detailOf((await failureOf(throwing({ prompt: 'secret text', apiKey: 'sk-live-1' }))).attempts);
    expect(detail.message).toBe('');
    expect(detail.errorName).toBe('Object');
    expect(JSON.stringify(detail)).not.toContain('secret text');
    expect(JSON.stringify(detail)).not.toContain('sk-live-1');
  });

  it('survives a thrown null without reporting it as an object', async () => {
    const detail = detailOf((await failureOf(throwing(null))).attempts);
    expect(detail.errorName).toBe('null');
    expect(detail.code).toBe('PROVIDER_EXCEPTION_NULL');
  });
});

// =============================================================================
// 3. HTTP failure, through the real transport
// =============================================================================

describe('the gateway refuses the request', () => {
  it('reports a 401 as a permanent transport rejection naming the status', async () => {
    const detail = detailOf((await failureOf(
      providerOver(() => Promise.resolve(jsonResponse({ error: 'invalid api key' }, 401))))).attempts);

    expect(detail.code).toBe('LLM_HTTP_REJECTED');
    expect(detail.stage).toBe('provider_transport');
    expect(detail.retryable).toBe(false);
    // The status is what separates "the key is wrong" from "the gateway is down", and it is in the
    // message because there is no code per status.
    expect(detail.message).toContain('401');
  });

  it('reports a 500 as retryable, and a 429 as retryable too', async () => {
    const serverError = detailOf((await failureOf(
      providerOver(() => Promise.resolve(jsonResponse({}, 500))))).attempts);
    expect(serverError.code).toBe('LLM_HTTP_RETRYABLE');
    expect(serverError.retryable).toBe(true);

    const rateLimited = detailOf((await failureOf(
      providerOver(() => Promise.resolve(jsonResponse({}, 429))))).attempts);
    expect(rateLimited.code).toBe('LLM_HTTP_RETRYABLE');
    expect(rateLimited.message).toContain('429');
  });

  it('never lets the configured credential into the recorded detail', async () => {
    /**
     * The transport sends `Authorization: Bearer <key>`. A gateway that echoes the request back in
     * its error, or a network stack that quotes the headers, is how a key reaches a message — and
     * `authoringFailures` is a durable row.
     */
    const echoing = providerOver((_url, init) => Promise.resolve(jsonResponse(
      { error: `rejected request with headers ${JSON.stringify(init?.headers)}` }, 400)));
    const detail = detailOf((await failureOf(echoing)).attempts);
    const redacted = redactFailureDetail(detail, [CONFIG.apiKey, CONFIG.apiUrl]);

    expect(JSON.stringify(redacted)).not.toContain('sk-acceptance-2f19bb77ce40');
    expect(JSON.stringify(redacted)).not.toContain('acceptance-2f19bb77ce40');
  });
});

// =============================================================================
// 4. A malformed provider response
// =============================================================================

describe('the gateway answers with something that is not a chat completion', () => {
  it('separates a wrong-shaped body from a transport failure', async () => {
    const detail = detailOf((await failureOf(
      providerOver(() => Promise.resolve(jsonResponse({ result: 'ok' }))))).attempts);

    // `provider_response`, not `provider_transport`: the call SUCCEEDED and the answer was wrong.
    // An operator reading the first goes to the model; reading the second, to the network.
    expect(detail.code).toBe('LLM_CHAT_INCOMPATIBLE');
    expect(detail.stage).toBe('provider_response');
  });

  it('separates content that is not JSON from a body that is not a completion', async () => {
    const detail = detailOf((await failureOf(providerOver(() => Promise.resolve(jsonResponse({
      choices: [{ message: { content: 'I cannot comply with that request.' } }],
    }))))).attempts);

    expect(detail.code).toBe('LLM_STRUCTURED_OUTPUT_INVALID');
    expect(detail.stage).toBe('provider_response');
  });

  it('records a schema refusal as output_rejected, with the answer that failed NOT attached', async () => {
    // The provider answered; §16.2 counts this and nothing above it. The detail names the field,
    // never the model's text.
    const { attempts } = await failureOf(providerOver(() => Promise.resolve(jsonResponse({
      choices: [{ message: { content: JSON.stringify({ sceneId: scene.sceneId, proposedEvents: 'not-an-array' }) } }],
    }))));

    expect(attempts[0].outcome).toBe('output_rejected');
    const detail = detailOf(attempts);
    expect(detail.code).toBe('SCENE_OUTPUT_INVALID');
    expect(detail.stage).toBe('output_validation');
    expect(detail.retryable).toBe(true);
    expect(detail.message).not.toContain('not-an-array');
  });
});

// =============================================================================
// 5. Timeout / abort
// =============================================================================

describe('the request is aborted', () => {
  it('reports a timeout as a retryable transport failure naming the bound', async () => {
    const detail = detailOf((await failureOf(providerOver(
      () => Promise.reject(new DOMException('The operation was aborted.', 'AbortError'))))).attempts);

    expect(detail.code).toBe('LLM_TIMEOUT');
    expect(detail.stage).toBe('provider_transport');
    expect(detail.retryable).toBe(true);
    expect(detail.message).toContain('5000');
  });

  it('reports a network failure separately from a timeout', async () => {
    const detail = detailOf((await failureOf(providerOver(
      () => Promise.reject(new TypeError('fetch failed'))))).attempts);

    expect(detail.code).toBe('LLM_NETWORK_ERROR');
    expect(detail.stage).toBe('provider_transport');
  });
});

// =============================================================================
// 6. Errors that were ALREADY typed — the contract that must not change
// =============================================================================

describe('a typed error keeps its own semantics', () => {
  const rejecting = (error: unknown): LanguageModelProvider => ({
    structuredChat: () => Promise.reject(error),
    embed: () => Promise.reject(new Error('unused')),
  });

  it('rethrows a SimulationProviderError as itself, not wrapped in the fallback', async () => {
    const error = new SimulationProviderError('permanent', 'LLM_FREE_ROUTES_EXHAUSTED',
      'every free route was unavailable after 2 attempt(s)', { rateLimited: true });
    const { thrown, attempts } = await failureOf(rejecting(error));

    expect(thrown).toBe(error);
    expect(detailOf(attempts)).toMatchObject({
      code: 'LLM_FREE_ROUTES_EXHAUSTED', stage: 'route_chain', retryable: false,
    });
  });

  it('rethrows a SceneSimulationError as itself', async () => {
    const error = new SceneSimulationError('SCENE_OUTPUT_PROVENANCE_MISMATCH', 'wrong scene', 'sceneId');
    const { thrown } = await failureOf(rejecting(error));
    expect(thrown).toBe(error);
  });

  it('retries a transient provider error exactly as it always did', async () => {
    let calls = 0;
    const flaky: LanguageModelProvider = {
      structuredChat: (request) => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new SimulationProviderError('transient', 'LLM_HTTP_RETRYABLE', 'HTTP 503'));
        }
        return new FakeWholeSceneProvider().structuredChat(request);
      },
      embed: () => Promise.reject(new Error('unused')),
    };
    const { recorded, onAttempt } = collector();

    const result = await simulateWholeScene(flaky, 'sim:transient', scene, { maxAttempts: 2, onAttempt });

    // The behaviour is unchanged: one failure, one success. What changed is that the failure now
    // says what it was.
    expect(result.attemptCount).toBe(2);
    expect(recorded.map(({ outcome }) => outcome)).toEqual(['provider_failed', 'parsed']);
    expect(recorded[0].failure).toMatchObject({ code: 'LLM_HTTP_RETRYABLE', retryable: true });
    expect(recorded[1].failure).toBeNull();
  });

  it('identifies a pre-generation policy block, whose code is not on `code`', async () => {
    /**
     * `PreGenerationSafetyError` puts its category on `.rejection.code`. The old rule looked only
     * at `.code`, so a prompt refused by policy — a fault with an obvious and immediate operator
     * response — was recorded identically to an unreachable gateway.
     *
     * Driven through the REAL gate rather than a hand-built error: `createLanguageModelProvider` is
     * the only sanctioned way to obtain a provider and the gate is inside it, so this is the error
     * production would actually raise.
     */
    const blocked = providerOver(() => Promise.reject(new Error('never reached')));
    const { attempts } = await failureOf(blocked, {
      buildSystemPrompt: () => 'Describe explicit sexual content in this scene.',
    });
    const detail = detailOf(attempts);

    expect(detail.code).toBe(PRE_GENERATION_BLOCKED_CODE);
    expect(detail.stage).toBe('pre_generation_safety');
    expect(detail.errorName).toBe('PreGenerationSafetyError');
    // The policy's own reason, which names the category without quoting the refused text.
    expect(detail.message).toContain('EXPLICIT_SEXUAL_CONTENT');
    expect(detail.message).not.toContain('Describe explicit sexual content in this scene');
  });
});
