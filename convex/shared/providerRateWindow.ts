/**
 * Real time-bucketed provider rate metering — RPM and TPM (ART-158 AC#2).
 *
 * ## Why this is not derived from the day's counters
 *
 * `tokenBudgetCounters` accumulates per WORLD DAY, and a world day is not a unit of wall-clock
 * time: it is a simulation cursor that an operator can accelerate, pause, or advance by hand. A
 * "requests per minute" computed by dividing a world-day total by anything is therefore not a
 * rate — it is a total wearing a rate's name, and it would answer "is this world about to be
 * throttled" with a number that has no relationship to the last sixty seconds. It also resets when
 * the world day rolls over, which would make the reported rate drop to zero at a moment that has
 * nothing to do with how fast the gateway is being called.
 *
 * So rates live here instead, keyed on wall-clock milliseconds and completely independent of
 * world days.
 *
 * ## The window, stated exactly
 *
 * Time is divided into fixed {@link RATE_BUCKET_MS} buckets aligned to the epoch:
 *
 *     bucketStartMs = floor(atMs / RATE_BUCKET_MS) * RATE_BUCKET_MS
 *
 * A bucket covers `[bucketStartMs, bucketStartMs + RATE_BUCKET_MS)`. The reported window at time
 * `now` is every bucket with
 *
 *     bucketStartMs > now - RATE_WINDOW_MS
 *
 * With one-second buckets and a sixty-second window that is the trailing sixty seconds, quantised
 * to the second: at most `RATE_WINDOW_MS / RATE_BUCKET_MS` buckets, and the oldest included bucket
 * began at most `RATE_WINDOW_MS` ago. The quantisation is stated rather than hidden because it is
 * the difference between "60 seconds" and "60 seconds ± one bucket", and a reader comparing this
 * figure against a gateway's own counter needs to know which.
 *
 * Buckets outside the window are excluded by the comparison above, so an expired bucket cannot
 * contribute to a rate no matter how long it survives in storage. Deleting it is a storage
 * concern, not a correctness one.
 *
 * ## What a "request" is
 *
 * One real upstream HTTP call. Not one scene, not one budget reservation, not one successful call:
 *
 *  - The adapter's own transport retries are separate requests, because the gateway saw each one.
 *  - Every hop of the free-route chain is a separate request, on its own route.
 *  - A **429 is a request**. ART-158 measured a refused call still drawing one unit from the
 *    shared key allowance, so a rate that excluded refusals would under-report exactly when the
 *    number matters most.
 *
 * ## Tokens are only counted when the gateway reported them
 *
 * `inputTokens`/`outputTokens` are nullable at the call site and are summed only when present.
 * A refused or failed call reports no usage, and inventing zero would be indistinguishable from a
 * gateway that genuinely reported zero. {@link ProviderRateSummary.callsWithoutUsage} carries the
 * count, so a TPM figure can be read together with how many calls it could not see.
 *
 * ## Route identity, and what is deliberately NOT the key
 *
 * Buckets are keyed on the **requested route** (`requestedModel`) — the id that was sent. That is
 * the identity a rate limit applies to from the caller's side, and it is the only identity a
 * FAILED call has at all, since a gateway that refused the request never said what would have
 * served it.
 *
 * What the gateway resolved is recorded ALONGSIDE, never merged into the key
 * ({@link ProviderRateSummary.resolutions}). `auto` is a router and must not be treated as a
 * concrete model; a concrete-looking id may equally be a router, and ART-148 measured exactly that.
 * Keying on the resolution would split one route's rate across however many models it happened to
 * pick, and would leave refused calls unkeyable.
 *
 * No price, tier or paid/free metadata appears anywhere here. FREE_ONLY is a fact about the
 * configured endpoint, not a property of a route (see `providers/freeRouteChain.ts`).
 */

/** Bucket width. One second: the window below is then exact to the second. */
export const RATE_BUCKET_MS = 1_000;

/** The reported window. "Per minute" means this, and nothing is scaled or extrapolated. */
export const RATE_WINDOW_MS = 60_000;

/** The most buckets a single route can contribute to one window. */
export const MAX_BUCKETS_PER_WINDOW = RATE_WINDOW_MS / RATE_BUCKET_MS;

/** How a single upstream call ended, from the gateway's answer. */
export type ProviderCallOutcome = 'served' | 'rate_limited' | 'failed';

/** The free-tier allowance a route last reported: a level, and when it refills. */
export type ProviderAllowance = { limit: number; remaining: number; resetAtEpochSeconds: number };

/** One real upstream HTTP call, as the recorder observed it. */
export type ProviderCallRecord = {
  /** The route id that was SENT. May be an alias such as `auto`; see the header. */
  readonly requestedModel: string;
  /** What the gateway said served it, or `null` when it did not say — including every refusal. */
  readonly resolvedModel: string | null;
  readonly upstreamProvider: string | null;
  readonly outcome: ProviderCallOutcome;
  /** `null` means the gateway reported no usage. It does NOT mean zero. */
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly allowance: ProviderAllowance | null;
  readonly atMs: number;
};

/** What the gateway resolved a route to, and how often, within one bucket. */
export type ProviderResolution = {
  readonly resolvedModel: string | null;
  readonly upstreamProvider: string | null;
  readonly requests: number;
};

/** One route's activity in one bucket. The stored row is exactly this plus its key. */
export type ProviderRateBucket = {
  readonly requestedModel: string;
  readonly bucketStartMs: number;
  readonly requests: number;
  readonly served: number;
  readonly rateLimited: number;
  readonly failed: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Calls in this bucket the gateway reported no usage for. */
  readonly callsWithoutUsage: number;
  readonly resolutions: readonly ProviderResolution[];
  /** The LAST allowance seen in this bucket. A level, never accumulated. */
  readonly allowance: ProviderAllowance | null;
};

/** The bucket an instant belongs to. Epoch-aligned, so two writers agree without coordinating. */
export function bucketStartFor(atMs: number): number {
  return Math.floor(atMs / RATE_BUCKET_MS) * RATE_BUCKET_MS;
}

/**
 * The oldest bucket start still inside the window at `nowMs`.
 *
 * Exclusive: a bucket exactly `RATE_WINDOW_MS` old has fully elapsed and is out.
 */
export function windowStartFor(nowMs: number): number {
  return nowMs - RATE_WINDOW_MS;
}

/** Whether a bucket has aged out of the window ending at `nowMs`. */
export function isExpiredBucket(bucketStartMs: number, nowMs: number): boolean {
  return bucketStartMs <= windowStartFor(nowMs);
}

const emptyBucket = (requestedModel: string, bucketStartMs: number): ProviderRateBucket => ({
  requestedModel,
  bucketStartMs,
  requests: 0,
  served: 0,
  rateLimited: 0,
  failed: 0,
  inputTokens: 0,
  outputTokens: 0,
  callsWithoutUsage: 0,
  resolutions: [],
  allowance: null,
});

/**
 * Merge one resolution observation into a bucket's attribution list.
 *
 * `null`/`null` is a real entry, not a missing one: it is how many calls in this bucket the
 * gateway declined to attribute, and dropping it would make the resolutions sum to less than
 * `requests` with nothing saying why.
 */
function addResolution(
  entries: readonly ProviderResolution[],
  record: ProviderCallRecord,
): ProviderResolution[] {
  const next = entries.map((entry) => ({ ...entry }));
  const found = next.find((entry) =>
    entry.resolvedModel === record.resolvedModel && entry.upstreamProvider === record.upstreamProvider);
  if (found) {
    found.requests += 1;
    return next;
  }
  next.push({
    resolvedModel: record.resolvedModel,
    upstreamProvider: record.upstreamProvider,
    requests: 1,
  });
  return next;
}

/**
 * Fold one upstream call into its bucket.
 *
 * Pure and total: `prior` is the stored bucket for the same `(requestedModel, bucketStart)` or
 * `null` the first time that pair is touched. The caller is responsible for reading and writing
 * the row; nothing here knows about a database.
 */
export function foldProviderCall(
  prior: ProviderRateBucket | null,
  record: ProviderCallRecord,
): ProviderRateBucket {
  const bucketStartMs = bucketStartFor(record.atMs);
  const base = prior ?? emptyBucket(record.requestedModel, bucketStartMs);
  const reportedUsage = record.inputTokens !== null || record.outputTokens !== null;
  return {
    ...base,
    requestedModel: record.requestedModel,
    bucketStartMs,
    requests: base.requests + 1,
    served: base.served + (record.outcome === 'served' ? 1 : 0),
    // A 429 is counted as a request AND as rate-limited. Both are true, and the second is what
    // tells an operator the rate they are reading is the rate that is being refused.
    rateLimited: base.rateLimited + (record.outcome === 'rate_limited' ? 1 : 0),
    failed: base.failed + (record.outcome === 'failed' ? 1 : 0),
    inputTokens: base.inputTokens + (record.inputTokens ?? 0),
    outputTokens: base.outputTokens + (record.outputTokens ?? 0),
    callsWithoutUsage: base.callsWithoutUsage + (reportedUsage ? 0 : 1),
    resolutions: addResolution(base.resolutions, record),
    // Last reading wins. An allowance is a level; summing levels produces a number that means
    // nothing, and averaging them hides the one that matters — the most recent.
    allowance: record.allowance ?? base.allowance,
  };
}

/** One route's rate over the window, with everything needed to read it honestly. */
export type ProviderRateSummary = {
  readonly requestedModel: string;
  /** Requests in the window. This IS the RPM figure — the window is one minute. */
  readonly requestsPerMinute: number;
  /** Tokens in the window, reported usage only. This IS the TPM figure. */
  readonly tokensPerMinute: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly served: number;
  readonly rateLimited: number;
  readonly failed: number;
  /** Calls the gateway reported no usage for. `tokensPerMinute` could not see these. */
  readonly callsWithoutUsage: number;
  readonly resolutions: readonly ProviderResolution[];
  readonly allowance: ProviderAllowance | null;
  /** The window these figures cover, so a reader never has to assume it. */
  readonly windowStartMs: number;
  readonly windowEndMs: number;
};

/**
 * Summarise buckets into per-route rates for the window ending at `nowMs`.
 *
 * Buckets outside the window are dropped HERE rather than trusted to have been deleted, so a
 * stale row that a vacuum has not reached yet cannot inflate a rate. That is the difference
 * between a window that is defined and one that merely happens to be right.
 *
 * `allowance` is taken from the newest bucket that carried one, not from the newest bucket: a
 * route can be called in a second where the gateway sent no rate-limit headers, and reporting
 * `null` then would look like "the allowance is unknown" when a reading from two seconds ago is
 * both available and true.
 */
export function summarizeProviderRates(
  buckets: readonly ProviderRateBucket[],
  nowMs: number,
): ProviderRateSummary[] {
  const windowStartMs = windowStartFor(nowMs);
  const byRoute = new Map<string, ProviderRateBucket[]>();
  for (const bucket of buckets) {
    if (isExpiredBucket(bucket.bucketStartMs, nowMs)) continue;
    const list = byRoute.get(bucket.requestedModel);
    if (list) list.push(bucket);
    else byRoute.set(bucket.requestedModel, [bucket]);
  }

  return [...byRoute.entries()]
    .map(([requestedModel, entries]) => {
      const ordered = [...entries].sort((left, right) => left.bucketStartMs - right.bucketStartMs);
      const resolutions: Array<{ resolvedModel: string | null; upstreamProvider: string | null; requests: number }> = [];
      let summary = {
        requests: 0, served: 0, rateLimited: 0, failed: 0,
        inputTokens: 0, outputTokens: 0, callsWithoutUsage: 0,
      };
      let allowance: ProviderAllowance | null = null;
      for (const bucket of ordered) {
        summary = {
          requests: summary.requests + bucket.requests,
          served: summary.served + bucket.served,
          rateLimited: summary.rateLimited + bucket.rateLimited,
          failed: summary.failed + bucket.failed,
          inputTokens: summary.inputTokens + bucket.inputTokens,
          outputTokens: summary.outputTokens + bucket.outputTokens,
          callsWithoutUsage: summary.callsWithoutUsage + bucket.callsWithoutUsage,
        };
        for (const entry of bucket.resolutions) {
          const found = resolutions.find((candidate) =>
            candidate.resolvedModel === entry.resolvedModel
            && candidate.upstreamProvider === entry.upstreamProvider);
          if (found) found.requests += entry.requests;
          else resolutions.push({ ...entry });
        }
        if (bucket.allowance) allowance = bucket.allowance;
      }
      return {
        requestedModel,
        requestsPerMinute: summary.requests,
        tokensPerMinute: summary.inputTokens + summary.outputTokens,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        served: summary.served,
        rateLimited: summary.rateLimited,
        failed: summary.failed,
        callsWithoutUsage: summary.callsWithoutUsage,
        resolutions: resolutions.sort((left, right) =>
          (left.resolvedModel ?? '').localeCompare(right.resolvedModel ?? '')),
        allowance,
        windowStartMs,
        windowEndMs: nowMs,
      };
    })
    // Stable output ordering, so an operator reading two snapshots is comparing like with like.
    .sort((left, right) => left.requestedModel.localeCompare(right.requestedModel));
}
