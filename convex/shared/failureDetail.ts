/**
 * What a failed provider call is allowed to say about itself (ART-195).
 *
 * ## The defect this replaces
 *
 * A live authoring failure reached an operator as the word `SCENE_SIMULATION_FAILED` and nothing
 * else. `simulateWholeScene` ended with
 *
 *     throw new SceneSimulationError('SCENE_SIMULATION_FAILED', 'whole-scene provider failed');
 *
 * which discarded `lastError` entirely — its class, its message, its cause and the stage it came
 * from. Two more layers repeated the shape: `stableAttemptCode` and `stableCodeOf` both read only
 * `error.code`, so anything that carried none collapsed to a second constant,
 * `SCENE_ATTEMPT_FAILED`. The result was a world that had stopped advancing and a record that could
 * not say whether the gateway was down, the key was refused, a Convex mutation had failed, or the
 * pre-generation policy had blocked the prompt — four faults with four different responses.
 *
 * ## What is derived here rather than passed in
 *
 * {@link describeFailure} works out the STAGE and the RETRYABILITY from the error itself. Both were
 * tempting to accept as arguments, and both would then have been claims a caller could get wrong.
 * `retryable` in particular is consumed by `simulateWholeScene`'s own retry decision, so it is the
 * predicate rather than a description of it — a recorded `retryable: true` beside an attempt that
 * was not retried is not expressible.
 *
 * ## Secret safety is structural, and there are two passes
 *
 * This module never sees a credential, so it cannot redact one by value. It redacts by SHAPE:
 * bearer tokens, credential-looking query parameters, and any long opaque run that could be a key.
 * The second pass — {@link redactSecrets}, exact-value — belongs to the caller that actually holds
 * the configured key, which in this repository is the provider composition root under
 * `convex/simulation/providers/`. Neither pass subsumes the other: shape-matching catches a
 * credential this deployment does not know about, and value-matching catches one that does not look
 * like anything.
 *
 * What is NOT here, deliberately: no request body, no prompt, no provider response. A non-string
 * `message` yields the empty string rather than being stringified, because the one thing an
 * arbitrary object on an error is likely to be is the payload that caused it.
 */

/**
 * Where in the authoring pipeline a failure happened.
 *
 * A closed vocabulary, because it is the field an operator routes on. `unknown` is a real member
 * and not a defect: an exception whose origin cannot be established from its own identity is
 * exactly the case this task exists for, and giving it a confident stage would be the old problem
 * in a new field.
 */
export const FAILURE_STAGES = [
  'configuration',
  'pre_generation_safety',
  'provider_transport',
  'provider_response',
  'route_chain',
  'budget',
  'output_validation',
  'unknown',
] as const;

export type FailureStage = (typeof FAILURE_STAGES)[number];

/** A failure, reduced to what is safe to keep and useful to read. */
export type FailureDetail = {
  /** Stable, bounded, upper case. Safe to group by, and accepted by the `llmTraces` code field. */
  code: string;
  /** The thrown value's own `name`, or `typeof` it for a throw that was not an Error at all. */
  errorName: string;
  /** Redacted and bounded. Empty when the throw carried no string message. */
  message: string;
  stage: FailureStage;
  /** `error.cause`, classified by the same rules. `null` when there was none. */
  causeName: string | null;
  causeCode: string | null;
  causeMessage: string | null;
  /**
   * Whether retrying this exact call could plausibly succeed.
   *
   * Consumed by `simulateWholeScene` as its retry decision, so this is the predicate itself.
   */
  retryable: boolean;
};

/** The code for an error that identified itself in no usable way at all. */
export const UNCLASSIFIED_CODE = 'PROVIDER_EXCEPTION_UNCLASSIFIED';

/** The code a pre-generation policy refusal is reported under. Its category rides in the message. */
export const PRE_GENERATION_BLOCKED_CODE = 'LLM_PRE_GENERATION_BLOCKED';

/** How much sanitized message is kept. Beyond this the remainder is COUNTED, never dropped silently. */
export const MESSAGE_MAX_LENGTH = 300;

/** A stable machine code: the same shape `convex/observability/llmTrace.ts` will accept. */
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;

/**
 * An opaque run long enough to be a credential.
 *
 * 24 is chosen against the things that must SURVIVE rather than against key formats: the model ids
 * this deployment routes on (`agnes-2.5-flash`, `deepseek-v4-pro`) and the repository's own codes
 * are all shorter, while an API key, a bearer token and a session id are all longer. Over-redaction
 * costs a reader one substring; under-redaction writes a credential into a durable row.
 */
const OPAQUE_RUN = /[A-Za-z0-9+/=_-]{24,}/gu;

/**
 * An UPPER_SNAKE machine code, which {@link OPAQUE_RUN} must not eat.
 *
 * Found on the acceptance deployment, by the first run this mechanism was built for: the failure
 * read `[[REDACTED]] CanonError at …` because `PROVIDER_EXCEPTION_CANON_ERROR` is 30 characters of
 * exactly the alphabet an opaque run is made of. The sanitizer was redacting the codes the
 * classifier had just derived — and `PROVIDER_EXCEPTION_ERROR`, at 24 characters, is the most
 * common one of all.
 *
 * The exemption is narrow on purpose: upper case, digits and AT LEAST ONE underscore, nothing else.
 * A base64 key, a hex digest and a `sk-` token all fail it — the first two carry lower case or
 * mixed case, and none of the three is underscore-separated.
 */
const MACHINE_CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/u;

/** `Authorization: Bearer …`, in a message or in a stringified header dump. */
const BEARER = /\b(bearer)\s+\S+/giu;

/** `?api_key=…`, `&token=…`, and the rest of the family, in a URL a network error quoted back. */
const CREDENTIAL_PARAM = /\b(api[-_]?key|access[-_]?token|auth[-_]?token|token|secret|password|passwd|pwd|key)=[^&\s"']+/giu;

export const REDACTED = '[REDACTED]';

/**
 * Strip anything credential-shaped from one line of text, then bound it.
 *
 * Order matters: the named forms run before {@link OPAQUE_RUN}, so a redacted bearer token reads
 * `Bearer [REDACTED]` rather than losing the word that says what kind of secret it was.
 *
 * Truncation publishes what it removed, per this repository's rule that truncation is never silent.
 * A message cut at 300 characters with no marker is indistinguishable from a message that was 300
 * characters long, and the difference matters when the tail is the part naming the host.
 */
export function sanitizeFailureText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const redacted = value
    .replace(BEARER, `$1 ${REDACTED}`)
    .replace(CREDENTIAL_PARAM, (_match, name: string) => `${name}=${REDACTED}`)
    .replace(OPAQUE_RUN, (run) => (MACHINE_CODE.test(run) ? run : REDACTED))
    // Newlines and runs of space collapse so one failure is one readable line. A stack trace that
    // arrived inside a message becomes a single line rather than reformatting every reader.
    .replace(/\s+/gu, ' ')
    .trim();
  if (redacted.length <= MESSAGE_MAX_LENGTH) return redacted;
  const omitted = redacted.length - MESSAGE_MAX_LENGTH;
  return `${redacted.slice(0, MESSAGE_MAX_LENGTH)} […${omitted} more characters omitted]`;
}

/**
 * Replace every occurrence of a known secret VALUE, whatever it looks like.
 *
 * The second pass described in this module's header, applied by whoever holds the configured
 * credential. Short values are ignored: a one- or two-character "secret" would match half the
 * message and redact the diagnosis along with it, and a credential that short is not one.
 */
export function redactSecrets(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.trim().length < 8) continue;
    out = out.split(secret.trim()).join(REDACTED);
  }
  return out;
}

/** Apply {@link redactSecrets} to every text-bearing field of a detail. */
export function redactFailureDetail(
  detail: FailureDetail, secrets: readonly (string | null | undefined)[],
): FailureDetail {
  return {
    ...detail,
    message: redactSecrets(detail.message, secrets),
    causeMessage: detail.causeMessage === null ? null : redactSecrets(detail.causeMessage, secrets),
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

/** The `name` an error reports, or the `typeof` of a throw that was not one. */
function nameOf(error: unknown): string {
  // Ahead of the `typeof` fallback, which answers `'object'` for null and would report a thrown
  // null as an object that simply declined to identify itself.
  if (error === null) return 'null';
  if (isObject(error) && typeof (error as { name?: unknown }).name === 'string') {
    const name = (error as { name: string }).name.trim();
    if (name.length > 0 && name.length <= 64) return name;
  }
  if (isObject(error)) {
    const constructorName = (error as { constructor?: { name?: unknown } }).constructor?.name;
    if (typeof constructorName === 'string' && constructorName.length > 0) return constructorName;
  }
  return typeof error;
}

/**
 * A class name as a machine code: `TypeError` → `PROVIDER_EXCEPTION_TYPE_ERROR`.
 *
 * Promoting a NAME to a code is safe in a way that promoting a message is not. A constructor name
 * is a code-side constant — it comes from a class declaration in this repository or in the runtime,
 * never from a model response or a gateway body — so it cannot smuggle text into a field whose
 * whole contract is that it carries none. Anything that does not reduce to the bounded pattern
 * falls back to {@link UNCLASSIFIED_CODE} rather than being forced through.
 */
function codeFromName(name: string): string {
  const snake = name
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/[^A-Za-z0-9]+/gu, '_')
    .toUpperCase()
    .replace(/^_+|_+$/gu, '');
  // `snake` is checked for emptiness SEPARATELY: a name of pure punctuation reduces to nothing, and
  // `PROVIDER_EXCEPTION_` satisfies the pattern perfectly well while naming no class at all.
  if (snake.length === 0) return UNCLASSIFIED_CODE;
  const code = `PROVIDER_EXCEPTION_${snake}`;
  return CODE_PATTERN.test(code) ? code : UNCLASSIFIED_CODE;
}

/**
 * The stable code an error carries, or one derived from its identity.
 *
 * Three sources, in order of how much the error itself said:
 *
 *  1. `error.code`, when it is already a bounded machine code. Every `SimulationProviderError`,
 *     `SceneSimulationError`, `SceneBudgetError` and `CanonError` in this repository has one.
 *  2. `error.error.code` — `CanonError` nests its verdict one level down, so the code that names
 *     WHICH canon rule refused a proposal is not on `code` at all. The first live run after this
 *     mechanism shipped was a `CanonError`, and it was reported as an unidentified exception
 *     because nothing looked here.
 *  3. `error.rejection.code` — `PreGenerationSafetyError` puts its category THERE rather than on
 *     `code`, which is why a policy refusal used to read as an unidentified failure.
 *  4. The constructor name, via {@link codeFromName}.
 */
export function stableFailureCode(error: unknown): string {
  if (isObject(error)) {
    const own = (error as { code?: unknown }).code;
    if (typeof own === 'string' && CODE_PATTERN.test(own)) return own;
    const nested = (error as { error?: unknown }).error;
    if (isObject(nested)) {
      const nestedCode = (nested as { code?: unknown }).code;
      if (typeof nestedCode === 'string' && CODE_PATTERN.test(nestedCode)) return nestedCode;
    }
    const rejection = (error as { rejection?: unknown }).rejection;
    if (isObject(rejection) && typeof (rejection as { code?: unknown }).code === 'string') {
      return PRE_GENERATION_BLOCKED_CODE;
    }
  }
  return codeFromName(nameOf(error));
}

/**
 * Which stage a code belongs to.
 *
 * Derived from the code rather than from where the error was caught, because the catch sites are
 * several layers above the thing that failed: `authorSlotScenes` catches a transport error, a
 * budget refusal and a schema rejection at the same `catch`, and can distinguish them only by
 * asking the error. The prefixes below are the adapter's own vocabulary
 * (`convex/simulation/providers/openAICompatible.ts`) and the scene parser's.
 */
function stageForCode(code: string, errorName: string): FailureStage {
  if (code === PRE_GENERATION_BLOCKED_CODE || errorName === 'PreGenerationSafetyError') {
    return 'pre_generation_safety';
  }
  if (code === 'LLM_CONFIG_MISSING' || code === 'LLM_CONFIG_INVALID') return 'configuration';
  if (code === 'LLM_FREE_ROUTES_EXHAUSTED') return 'route_chain';
  if (code === 'LLM_HTTP_REJECTED' || code === 'LLM_HTTP_RETRYABLE'
    || code === 'LLM_TIMEOUT' || code === 'LLM_NETWORK_ERROR') return 'provider_transport';
  if (code.startsWith('LLM_')) return 'provider_response';
  if (code.startsWith('SCENE_BUDGET_')) return 'budget';
  if (code.startsWith('SCENE_OUTPUT_')) return 'output_validation';
  // A `CanonError` reaching the authoring path is `normalizeProposedEventOutput` refusing a
  // proposal the model wrote, which is validation of the OUTPUT however far down it was thrown.
  // Its codes are canon's own vocabulary (`INVALID_EVENT_SHAPE`, `UNKNOWN_LOCATION_REFERENCE`) and
  // share no prefix with anything above, so the class is what identifies them.
  if (errorName === 'CanonError') return 'output_validation';
  return 'unknown';
}

/**
 * Whether the whole-scene retry loop should try this error again.
 *
 * This is `simulateWholeScene`'s decision, moved here so the recorded field and the behaviour are
 * one thing. The rules are the ones that loop already applied:
 *
 *  - a `SceneSimulationError` means the provider ANSWERED and the answer was refused, and a second
 *    sample of a stochastic model may well be accepted — retried. Its codes all begin `SCENE_`;
 *  - a `SimulationProviderError` is retried only when it tagged itself `transient`, which is the
 *    `kind` field read below;
 *  - a budget refusal is never retried: retrying spends the retry budget arguing with the limit
 *    that just refused the call. Checked FIRST, because `SceneBudgetError`'s codes also begin
 *    `SCENE_` and the prefix rule would otherwise claim it;
 *  - anything unidentified is NOT retried. Spending a free-tier allowance on a guess is the more
 *    expensive mistake, and it is the same reading `isRouteLevelFailure` takes one layer down.
 *
 * Matched case for case against the `instanceof` chain it replaces, which is what makes it safe to
 * have `simulateWholeScene` call this instead of repeating the rule.
 */
function retryabilityOf(error: unknown, code: string): boolean {
  if (code.startsWith('SCENE_BUDGET_')) return false;
  if (isObject(error)) {
    const kind = (error as { kind?: unknown }).kind;
    if (kind === 'transient') return true;
    if (kind === 'permanent') return false;
  }
  return code.startsWith('SCENE_');
}

/**
 * Reduce any thrown value to something safe to record and specific enough to act on.
 *
 * `fallbackStage` is used only when the error's own identity settles nothing — an unidentified
 * throw caught at a site that nevertheless knows what it was doing. Callers that know no better
 * should leave it alone; `unknown` is an honest answer and a wrong stage is not.
 */
export function describeFailure(error: unknown, fallbackStage: FailureStage = 'unknown'): FailureDetail {
  const code = stableFailureCode(error);
  const errorName = nameOf(error);
  /**
   * An error that already carries a detail knows better than this function does.
   *
   * `SCENE_SIMULATION_FAILED` is the stand-in `simulateWholeScene` throws for an error of a class
   * it does not recognise, so it names no stage of its own and would otherwise take the caller's
   * fallback. On the first live run after this shipped that fallback read `provider_transport` for
   * a failure that was in fact `output_validation` — a confidently wrong stage, which is worse than
   * `unknown` because it sends an operator to the network instead of to the model.
   */
  const inherited = isObject(error) ? (error as { detail?: unknown }).detail : undefined;
  const inheritedStage = isObject(inherited)
    && typeof (inherited as { stage?: unknown }).stage === 'string'
    && (FAILURE_STAGES as readonly string[]).includes((inherited as { stage: string }).stage)
    ? (inherited as { stage: FailureStage }).stage
    : null;
  const derived = stageForCode(code, errorName);
  const cause = isObject(error) ? (error as { cause?: unknown }).cause : undefined;
  const hasCause = cause !== undefined && cause !== null;
  return {
    code,
    errorName,
    message: sanitizeFailureText(isObject(error) ? (error as { message?: unknown }).message : error),
    stage: derived !== 'unknown' ? derived : inheritedStage ?? fallbackStage,
    causeName: hasCause ? nameOf(cause) : null,
    causeCode: hasCause ? stableFailureCode(cause) : null,
    causeMessage: hasCause
      ? sanitizeFailureText(isObject(cause) ? (cause as { message?: unknown }).message : cause)
      : null,
    retryable: retryabilityOf(error, code),
  };
}

/** One line, for a log or a CLI return value. Every field, nothing else. */
export function formatFailureDetail(detail: FailureDetail): string {
  const cause = detail.causeName === null
    ? ''
    : ` caused by ${detail.causeName}(${detail.causeCode ?? '-'})${detail.causeMessage ? `: ${detail.causeMessage}` : ''}`;
  return `[${detail.code}] ${detail.errorName} at ${detail.stage}`
    + `${detail.retryable ? ' (retryable)' : ''}: ${detail.message || '(no message)'}${cause}`;
}
