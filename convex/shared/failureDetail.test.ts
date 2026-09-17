/**
 * The classifier and the redactor, driven directly (ART-195).
 *
 * `convex/simulation/authoringFailureDiagnosis.test.ts` proves the LIVE path produces these values
 * from a real adapter. This file proves the values are right, including the two properties that are
 * only expressible here: that a credential cannot survive the sanitizer, and that `retryable` is
 * the same predicate the retry loop applies rather than a description written beside it.
 *
 * Every case is a shape that actually reaches this function. The plain `Error`, the `TypeError` and
 * the `PreGenerationSafetyError` are the three that produced the constant `SCENE_ATTEMPT_FAILED` on
 * the acceptance deployment and left a stalled world with no diagnosis.
 */

import {
  MESSAGE_MAX_LENGTH,
  PRE_GENERATION_BLOCKED_CODE,
  REDACTED,
  UNCLASSIFIED_CODE,
  describeFailure,
  formatFailureDetail,
  redactFailureDetail,
  redactSecrets,
  sanitizeFailureText,
  stableFailureCode,
} from './failureDetail';

/** A `SimulationProviderError`, structurally. Imported for real by the simulation-side suite. */
const providerError = (kind: 'transient' | 'permanent', code: string, message: string) => {
  const error = new Error(message) as Error & { kind: string; code: string };
  error.name = 'SimulationProviderError';
  error.kind = kind;
  error.code = code;
  return error;
};

const sceneError = (code: string, message: string) => {
  const error = new Error(`[${code}] ${message}`) as Error & { code: string };
  error.name = 'SceneSimulationError';
  error.code = code;
  return error;
};

// =============================================================================
// Secret safety — the constraint that makes a message field admissible at all
// =============================================================================

describe('sanitizeFailureText refuses to carry a credential', () => {
  it('redacts a bearer token but keeps the word that says what kind of secret it was', () => {
    const sanitized = sanitizeFailureText('request failed: Authorization: Bearer sk-live-9f2b7c11aa04');
    expect(sanitized).toContain('Bearer [REDACTED]');
    expect(sanitized).not.toContain('sk-live-9f2b7c11aa04');
  });

  it('redacts credential-shaped query parameters while leaving the rest of the URL readable', () => {
    const sanitized = sanitizeFailureText('POST https://gw.example/v1/chat?api_key=abc123def456&model=agnes-2.5-flash failed');
    expect(sanitized).toContain('api_key=[REDACTED]');
    expect(sanitized).not.toContain('abc123def456');
    // The diagnosis survives the redaction: an operator still sees which route was asked for.
    expect(sanitized).toContain('model=agnes-2.5-flash');
  });

  it('redacts a long opaque run even when nothing named it a secret', () => {
    // The case the named rules cannot reach: a key pasted into a message with no `Bearer`, no `=`
    // and no field name. Shape is the only signal left.
    const sanitized = sanitizeFailureText('unexpected token near ZmFrZS1rZXktdmFsdWUtMTIzNDU2Nzg5MA in body');
    expect(sanitized).not.toContain('ZmFrZS1rZXktdmFsdWUtMTIzNDU2Nzg5MA');
    expect(sanitized).toContain(REDACTED);
  });

  it('leaves the model ids this deployment actually routes on intact', () => {
    // The bound on the opaque-run rule is chosen against these, not against key formats. If they
    // stopped surviving, every failure message would lose the one field naming the route.
    const sanitized = sanitizeFailureText('route agnes-2.5-flash rejected; tried deepseek-v4-pro');
    expect(sanitized).toContain('agnes-2.5-flash');
    expect(sanitized).toContain('deepseek-v4-pro');
  });

  it('never stringifies a non-string message', () => {
    // The object hanging off a provider error is most often the payload that caused it.
    expect(sanitizeFailureText({ apiKey: 'sk-secret', body: 'prompt text' })).toBe('');
    expect(sanitizeFailureText(undefined)).toBe('');
    expect(sanitizeFailureText(null)).toBe('');
  });

  it('publishes what truncation removed instead of cutting silently', () => {
    // Words, not one long run: an unbroken 300-character token is credential-SHAPED and is
    // redacted whole before truncation ever sees it, which is correct and would make this assert
    // nothing. Redaction runs first by design, so a fixture for truncation has to survive it.
    const long = 'gateway rejected the request '.repeat(20);
    const sanitized = sanitizeFailureText(long);
    const expectedOmitted = long.trim().length - MESSAGE_MAX_LENGTH;
    expect(sanitized).toContain(`${expectedOmitted} more characters omitted`);
    // A message cut at the bound with no marker is indistinguishable from one that was that long.
    expect(sanitized.startsWith(long.slice(0, MESSAGE_MAX_LENGTH))).toBe(true);
  });

  it('collapses a multi-line throw into one readable line', () => {
    expect(sanitizeFailureText('failed\n  at fetch\n  at request')).toBe('failed at fetch at request');
  });
});

describe('redactSecrets removes a value that looks like nothing in particular', () => {
  it('removes the configured credential wherever it appears', () => {
    // The exact-value pass exists for precisely this: a key with no recognisable shape, which the
    // structural rules above cannot see and which `providers/` is the only module holding.
    const text = 'gateway refused token hunter2horse for model agnes-2.5-flash';
    expect(redactSecrets(text, ['hunter2horse'])).toBe(`gateway refused token ${REDACTED} for model agnes-2.5-flash`);
  });

  it('ignores a value too short to be a credential', () => {
    // A two-character "secret" would match half the message and redact the diagnosis with it.
    expect(redactSecrets('a request failed', ['a'])).toBe('a request failed');
  });

  it('ignores undefined, so an unconfigured variable is not a redaction rule', () => {
    expect(redactSecrets('unchanged text here', [undefined])).toBe('unchanged text here');
  });

  it('redacts both message fields of a detail, not only the outer one', () => {
    const inner = new Error('inner failed with longsecretvalue');
    const outer = new Error('outer failed with longsecretvalue', { cause: inner });
    const redacted = redactFailureDetail(describeFailure(outer), ['longsecretvalue']);
    expect(redacted.message).not.toContain('longsecretvalue');
    expect(redacted.causeMessage).not.toContain('longsecretvalue');
    expect(redacted.causeMessage).toContain(REDACTED);
  });
});

// =============================================================================
// Codes — SCENE_ATTEMPT_FAILED stops being the answer for an error that had one
// =============================================================================

describe('stableFailureCode', () => {
  it('keeps a code the error already carried', () => {
    expect(stableFailureCode(providerError('transient', 'LLM_HTTP_RETRYABLE', 'HTTP 429'))).toBe('LLM_HTTP_RETRYABLE');
    expect(stableFailureCode(sceneError('SCENE_OUTPUT_INVALID', 'bad'))).toBe('SCENE_OUTPUT_INVALID');
  });

  it('reads a pre-generation block, whose code is on `rejection` and not on `code`', () => {
    // This is why a safety refusal was recorded as an unidentified failure: nothing looked there.
    const error = new Error('[PERSONAL_DATA] Personal or identifying data is prohibited.') as Error & {
      rejection: { code: string };
    };
    error.name = 'PreGenerationSafetyError';
    error.rejection = { code: 'PERSONAL_DATA' };
    expect(stableFailureCode(error)).toBe(PRE_GENERATION_BLOCKED_CODE);
  });

  it('derives a code from the class of an error that carried none', () => {
    expect(stableFailureCode(new TypeError('fetch failed'))).toBe('PROVIDER_EXCEPTION_TYPE_ERROR');
    expect(stableFailureCode(new Error('boom'))).toBe('PROVIDER_EXCEPTION_ERROR');
  });

  it('names the type of a throw that was not an Error at all', () => {
    expect(stableFailureCode('just a string')).toBe('PROVIDER_EXCEPTION_STRING');
    expect(stableFailureCode(null)).toBe('PROVIDER_EXCEPTION_NULL');
  });

  it('refuses a code-shaped value that is not a bounded machine code', () => {
    // A `code` field holding model text would otherwise be promoted into `llmTraces.errorCode`,
    // whose whole contract is that it carries none.
    const error = new Error('x') as Error & { code: string };
    error.code = 'provider said: your request was malformed';
    expect(stableFailureCode(error)).toBe('PROVIDER_EXCEPTION_ERROR');
  });

  it('falls back rather than forcing a class name that does not reduce to a code', () => {
    const error = new Error('x');
    Object.defineProperty(error, 'name', { value: '???' });
    expect(stableFailureCode(error)).toBe(UNCLASSIFIED_CODE);
  });
});

// =============================================================================
// Stage and retryability
// =============================================================================

describe('describeFailure derives the stage from the error rather than the catch site', () => {
  const cases: ReadonlyArray<[string, string]> = [
    ['LLM_CONFIG_MISSING', 'configuration'],
    ['LLM_HTTP_REJECTED', 'provider_transport'],
    ['LLM_HTTP_RETRYABLE', 'provider_transport'],
    ['LLM_TIMEOUT', 'provider_transport'],
    ['LLM_NETWORK_ERROR', 'provider_transport'],
    ['LLM_CHAT_INCOMPATIBLE', 'provider_response'],
    ['LLM_STRUCTURED_OUTPUT_INVALID', 'provider_response'],
    ['LLM_FREE_ROUTES_EXHAUSTED', 'route_chain'],
    ['SCENE_BUDGET_REFUSED', 'budget'],
    ['SCENE_OUTPUT_INVALID', 'output_validation'],
  ];

  it.each(cases)('maps %s to the %s stage', (code, stage) => {
    // `authorSlotScenes` catches a transport error, a budget refusal and a schema rejection at one
    // `catch`, so the stage cannot come from where it was caught.
    expect(describeFailure(providerError('permanent', code, 'x')).stage).toBe(stage);
  });

  it('uses the caller fallback only when the error settles nothing', () => {
    expect(describeFailure(new Error('boom'), 'provider_transport').stage).toBe('provider_transport');
    expect(describeFailure(new Error('boom')).stage).toBe('unknown');
  });

  it('does not let a fallback override a stage the error DID settle', () => {
    expect(describeFailure(providerError('permanent', 'SCENE_BUDGET_REFUSED', 'x'), 'provider_transport').stage)
      .toBe('budget');
  });
});

describe('retryable is the predicate the retry loop applies', () => {
  it('matches the transient/permanent tag on a provider error', () => {
    expect(describeFailure(providerError('transient', 'LLM_HTTP_RETRYABLE', 'x')).retryable).toBe(true);
    expect(describeFailure(providerError('permanent', 'LLM_HTTP_REJECTED', 'x')).retryable).toBe(false);
  });

  it('retries a refused ANSWER, because a second sample of a stochastic model may be accepted', () => {
    expect(describeFailure(sceneError('SCENE_OUTPUT_INVALID', 'x')).retryable).toBe(true);
  });

  it('never retries a budget refusal, whose code also begins SCENE_', () => {
    // The ordering inside `retryabilityOf`: the prefix rule would otherwise claim this one.
    const budget = new Error('[SCENE_BUDGET_REFUSED] over budget') as Error & { code: string };
    budget.name = 'SceneBudgetError';
    budget.code = 'SCENE_BUDGET_REFUSED';
    expect(describeFailure(budget).retryable).toBe(false);
  });

  it('does not retry an unidentified throw', () => {
    // Spending a free-tier allowance on a guess is the more expensive mistake — the same reading
    // `isRouteLevelFailure` takes one layer down.
    expect(describeFailure(new Error('boom')).retryable).toBe(false);
    expect(describeFailure('boom').retryable).toBe(false);
  });
});

// =============================================================================
// The whole detail, and what it reads like
// =============================================================================

describe('describeFailure keeps what the old rule discarded', () => {
  it('names the class, the message and the stage of a raw Error', () => {
    // Under the rule this replaces, all three of these were the single word SCENE_ATTEMPT_FAILED.
    expect(describeFailure(new TypeError('fetch failed'), 'provider_transport')).toEqual({
      code: 'PROVIDER_EXCEPTION_TYPE_ERROR',
      errorName: 'TypeError',
      message: 'fetch failed',
      stage: 'provider_transport',
      causeName: null,
      causeCode: null,
      causeMessage: null,
      retryable: false,
    });
  });

  it('classifies the cause as well as the error', () => {
    const detail = describeFailure(
      new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND gw.example') }),
      'provider_transport',
    );
    expect(detail.causeName).toBe('Error');
    expect(detail.causeCode).toBe('PROVIDER_EXCEPTION_ERROR');
    expect(detail.causeMessage).toBe('getaddrinfo ENOTFOUND gw.example');
  });

  it('carries a non-Error throw without inventing an Error around it', () => {
    expect(describeFailure('gateway exploded')).toMatchObject({
      code: 'PROVIDER_EXCEPTION_STRING', errorName: 'string', message: 'gateway exploded',
    });
  });

  it('formats every field onto one line', () => {
    const line = formatFailureDetail(describeFailure(
      providerError('transient', 'LLM_TIMEOUT', 'provider exceeded 30000ms timeout')));
    expect(line).toContain('[LLM_TIMEOUT]');
    expect(line).toContain('SimulationProviderError');
    expect(line).toContain('provider_transport');
    expect(line).toContain('(retryable)');
    expect(line).toContain('provider exceeded 30000ms timeout');
  });

  it('says so rather than reading as empty when there was no message', () => {
    expect(formatFailureDetail(describeFailure(new Error()))).toContain('(no message)');
  });
});

// =============================================================================
// Corrections found by the first live run this mechanism was built for
// =============================================================================

/**
 * The run returned, verbatim:
 *
 *     "[SCENE_SIMULATION_FAILED] whole-scene provider failed: [[REDACTED]] CanonError at
 *      provider_transport: [INVALID_EVENT_SHAPE] stateChanges must not be empty"
 *
 * Three things were wrong with that line, and all three are pinned below. The diagnosis it carried
 * was nevertheless correct and actionable, which is the point — but a redacted code, a wrong stage
 * and a class-derived code where the error had a real one are each a step back toward the constant
 * this task replaced.
 */
describe('ART-195 corrections: what the first live failure exposed', () => {
  /** A `CanonError`, structurally: its verdict is nested on `.error`, not on `.code`. */
  const canonError = (code: string, message: string) => {
    const error = new Error(`[${code}] ${message}`) as Error & { error: { code: string; message: string } };
    error.name = 'CanonError';
    error.error = { code, message };
    return error;
  };

  it('does not redact the machine codes it just derived', () => {
    // `PROVIDER_EXCEPTION_CANON_ERROR` is 30 characters of exactly the alphabet an opaque run is
    // made of, and `PROVIDER_EXCEPTION_ERROR` is 24 — the most common derived code of all.
    expect(sanitizeFailureText('failed with PROVIDER_EXCEPTION_CANON_ERROR at stage'))
      .toContain('PROVIDER_EXCEPTION_CANON_ERROR');
    expect(sanitizeFailureText('failed with PROVIDER_EXCEPTION_ERROR'))
      .toContain('PROVIDER_EXCEPTION_ERROR');
  });

  it('still redacts a credential of the same length, so the exemption is not a hole', () => {
    // The exemption requires upper case, digits and an underscore. None of these qualifies.
    for (const secret of [
      'ZmFrZS1rZXktdmFsdWUtMTIzNDU2Nzg5MA',
      'sk-live-abcdef0123456789abcdef',
      'AbCdEfGhIjKlMnOpQrStUvWxYz012345',
    ]) {
      expect(sanitizeFailureText(`token ${secret} refused`)).not.toContain(secret);
    }
  });

  it('keeps the canon code a CanonError nests on `.error`, rather than naming its class', () => {
    // This is the failure the live run actually hit. Reporting it as
    // `PROVIDER_EXCEPTION_CANON_ERROR` names the class and loses WHICH rule refused the proposal.
    const detail = describeFailure(canonError('INVALID_EVENT_SHAPE', 'stateChanges must not be empty'));
    expect(detail.code).toBe('INVALID_EVENT_SHAPE');
    expect(detail.errorName).toBe('CanonError');
    expect(detail.message).toContain('stateChanges must not be empty');
  });

  it('puts a canon refusal at output_validation, not at the caller’s transport fallback', () => {
    // The live line said `provider_transport`, which sends an operator to the network for a fault
    // that is entirely in the model's answer.
    expect(describeFailure(canonError('INVALID_EVENT_SHAPE', 'x'), 'provider_transport').stage)
      .toBe('output_validation');
  });

  it('inherits the stage from a stand-in error that already carries a detail', () => {
    /**
     * `SCENE_SIMULATION_FAILED` names no stage of its own — it is the stand-in for an error of an
     * unrecognised class — so without this it takes whatever fallback the caller passed. A
     * confidently wrong stage is worse than `unknown`.
     */
    const inner = describeFailure(canonError('INVALID_EVENT_SHAPE', 'x'));
    const outer = new Error('[SCENE_SIMULATION_FAILED] whole-scene provider failed') as Error & {
      code: string; detail: typeof inner;
    };
    outer.name = 'SceneSimulationError';
    outer.code = 'SCENE_SIMULATION_FAILED';
    outer.detail = inner;

    expect(describeFailure(outer, 'provider_transport').stage).toBe('output_validation');
  });

  it('still honours the caller fallback when there is no detail to inherit', () => {
    const outer = new Error('[SCENE_SIMULATION_FAILED] whole-scene provider failed') as Error & { code: string };
    outer.name = 'SceneSimulationError';
    outer.code = 'SCENE_SIMULATION_FAILED';
    expect(describeFailure(outer, 'provider_transport').stage).toBe('provider_transport');
  });

  it('never lets an inherited stage override one the error itself settled', () => {
    const wrong = describeFailure(new Error('x'));
    const outer = new Error('timeout') as Error & { code: string; kind: string; detail: typeof wrong };
    outer.name = 'SimulationProviderError';
    outer.code = 'LLM_TIMEOUT';
    outer.kind = 'transient';
    outer.detail = { ...wrong, stage: 'budget' };
    expect(describeFailure(outer).stage).toBe('provider_transport');
  });
});
