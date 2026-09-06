/**
 * The RPM/TPM window (ART-158 AC#2), as a specification.
 *
 * Every test below states a property AC#2 names, and several exist specifically because the
 * obvious wrong implementation — dividing a world-day cumulative counter by something — passes a
 * naive "does RPM return a number" check while being wrong in all of them.
 */

import {
  RATE_BUCKET_MS,
  RATE_WINDOW_MS,
  bucketStartFor,
  foldProviderCall,
  isExpiredBucket,
  summarizeProviderRates,
  windowStartFor,
  type ProviderCallRecord,
  type ProviderRateBucket,
} from './providerRateWindow';

const T0 = 1_700_000_000_000;

const call = (over: Partial<ProviderCallRecord> = {}): ProviderCallRecord => ({
  requestedModel: 'auto',
  resolvedModel: 'deepseek-v4-pro',
  upstreamProvider: 'xkiro',
  outcome: 'served',
  inputTokens: 100,
  outputTokens: 20,
  allowance: { limit: 120, remaining: 118, resetAtEpochSeconds: 1_800_000_000 },
  atMs: T0,
  ...over,
});

/** Fold a list of calls into buckets, exactly as the mutation does one row at a time. */
function foldAll(records: readonly ProviderCallRecord[]): ProviderRateBucket[] {
  const byKey = new Map<string, ProviderRateBucket>();
  for (const record of records) {
    const key = `${record.requestedModel}:${bucketStartFor(record.atMs)}`;
    byKey.set(key, foldProviderCall(byKey.get(key) ?? null, record));
  }
  return [...byKey.values()];
}

describe('bucket boundaries are defined, not incidental', () => {
  it('aligns buckets to the epoch, so two writers agree without coordinating', () => {
    expect(bucketStartFor(T0)).toBe(T0);
    expect(bucketStartFor(T0 + 1)).toBe(T0);
    expect(bucketStartFor(T0 + RATE_BUCKET_MS - 1)).toBe(T0);
    expect(bucketStartFor(T0 + RATE_BUCKET_MS)).toBe(T0 + RATE_BUCKET_MS);
  });

  it('covers a half-open interval, so no instant lands in two buckets', () => {
    const starts = new Set<number>();
    for (let offset = 0; offset < RATE_BUCKET_MS * 3; offset += 137) {
      starts.add(bucketStartFor(T0 + offset));
    }
    expect([...starts].sort((a, b) => a - b))
      .toEqual([T0, T0 + RATE_BUCKET_MS, T0 + RATE_BUCKET_MS * 2]);
  });

  it('expires a bucket exactly one window old, and keeps the one after it', () => {
    const now = T0 + RATE_WINDOW_MS;
    expect(windowStartFor(now)).toBe(T0);
    expect(isExpiredBucket(T0, now)).toBe(true);
    expect(isExpiredBucket(T0 + RATE_BUCKET_MS, now)).toBe(false);
  });
});

describe('AC#2 — RPM and TPM are a window, not a total', () => {
  it('counts only the requests inside the window', () => {
    const buckets = foldAll([
      call({ atMs: T0 }),
      call({ atMs: T0 + 30_000 }),
      call({ atMs: T0 + 59_000 }),
    ]);

    // Read 59s after the first call: all three are inside.
    const inside = summarizeProviderRates(buckets, T0 + 59_500);
    expect(inside[0].requestsPerMinute).toBe(3);

    // Read 61s after the first: it has aged out, the other two have not.
    const later = summarizeProviderRates(buckets, T0 + 61_000);
    expect(later[0].requestsPerMinute).toBe(2);
  });

  it('drops to zero once every bucket has aged out, instead of retaining a cumulative total', () => {
    const buckets = foldAll([call({ atMs: T0 }), call({ atMs: T0 + 1_000 })]);

    expect(summarizeProviderRates(buckets, T0 + 1_500)[0].requestsPerMinute).toBe(2);
    // The property a cumulative counter cannot have: after a quiet minute the rate is zero, and
    // the route disappears from the window entirely rather than reporting its lifetime total.
    expect(summarizeProviderRates(buckets, T0 + 5 * RATE_WINDOW_MS)).toEqual([]);
  });

  it('excludes an expired bucket even when it is handed to the summary', () => {
    // The stale-row case: a vacuum has not run, so an old bucket is still readable. Expiry is a
    // comparison here rather than a promise about storage, so the rate is unaffected.
    const stale = foldAll([call({ atMs: T0 - 10 * RATE_WINDOW_MS })]);
    const fresh = foldAll([call({ atMs: T0 })]);

    expect(summarizeProviderRates([...stale, ...fresh], T0 + 500)[0].requestsPerMinute).toBe(1);
  });

  it('is unaffected by anything a world day does, because it never sees one', () => {
    // AC#2's central requirement. A world day can be accelerated, paused or hand-advanced; the
    // fold takes no worldDay at all, so there is no path by which one could reset a rate.
    const record = call();
    expect(Object.keys(record)).not.toContain('worldDay');
    expect(foldProviderCall(null, record)).not.toHaveProperty('worldDay');
  });
});

describe('AC#2 — what counts as a request', () => {
  it('counts a 429 as a real request, and separately as rate limited', () => {
    const buckets = foldAll([
      call({ atMs: T0, outcome: 'rate_limited', resolvedModel: null, upstreamProvider: null,
        inputTokens: null, outputTokens: null }),
      call({ atMs: T0 + 100 }),
    ]);
    const [summary] = summarizeProviderRates(buckets, T0 + 500);

    // ART-158 measured a refused call still drawing one unit of the shared key allowance, so
    // excluding it would under-report exactly when the number matters most.
    expect(summary.requestsPerMinute).toBe(2);
    expect(summary.rateLimited).toBe(1);
    expect(summary.served).toBe(1);
  });

  it('counts a failure as a request without counting it as rate limited', () => {
    const buckets = foldAll([call({ outcome: 'failed', resolvedModel: null, upstreamProvider: null,
      inputTokens: null, outputTokens: null })]);
    const [summary] = summarizeProviderRates(buckets, T0 + 500);

    expect(summary.requestsPerMinute).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.rateLimited).toBe(0);
  });

  it('counts retries of the same logical call separately', () => {
    // Three transport attempts for one scene: the gateway saw three requests and charged for
    // three, so the rate is three.
    const buckets = foldAll([
      call({ atMs: T0, outcome: 'failed', inputTokens: null, outputTokens: null }),
      call({ atMs: T0 + 100, outcome: 'failed', inputTokens: null, outputTokens: null }),
      call({ atMs: T0 + 200 }),
    ]);

    expect(summarizeProviderRates(buckets, T0 + 500)[0].requestsPerMinute).toBe(3);
  });
});

describe('AC#2 — tokens are never invented', () => {
  it('adds nothing for a call the gateway reported no usage for, and says how many', () => {
    const buckets = foldAll([
      call({ atMs: T0, inputTokens: 10, outputTokens: 5 }),
      call({ atMs: T0 + 10, outcome: 'rate_limited', inputTokens: null, outputTokens: null }),
    ]);
    const [summary] = summarizeProviderRates(buckets, T0 + 500);

    expect(summary.tokensPerMinute).toBe(15);
    // The blind spot is reported rather than hidden: a TPM read without this cannot be
    // distinguished from one where every call reported usage.
    expect(summary.callsWithoutUsage).toBe(1);
  });

  it('distinguishes a genuine zero from an absent report', () => {
    const reportedZero = foldAll([call({ inputTokens: 0, outputTokens: 0 })]);
    const absent = foldAll([call({ inputTokens: null, outputTokens: null })]);

    expect(summarizeProviderRates(reportedZero, T0 + 500)[0].callsWithoutUsage).toBe(0);
    expect(summarizeProviderRates(absent, T0 + 500)[0].callsWithoutUsage).toBe(1);
    // Both contribute zero tokens; only one of them is a measurement.
    expect(summarizeProviderRates(reportedZero, T0 + 500)[0].tokensPerMinute).toBe(0);
    expect(summarizeProviderRates(absent, T0 + 500)[0].tokensPerMinute).toBe(0);
  });

  it('reports input and output separately as well as summed', () => {
    const buckets = foldAll([call({ inputTokens: 100, outputTokens: 20 })]);
    const [summary] = summarizeProviderRates(buckets, T0 + 500);

    expect(summary).toMatchObject({ inputTokens: 100, outputTokens: 20, tokensPerMinute: 120 });
  });
});

describe('AC#2 — route identity, and what is kept apart from it', () => {
  it('keys on the REQUESTED route, so one route is one rate', () => {
    const buckets = foldAll([
      call({ requestedModel: 'auto', resolvedModel: 'deepseek-v4-pro' }),
      call({ requestedModel: 'auto', resolvedModel: 'qwen-3-max', atMs: T0 + 10 }),
    ]);
    const summaries = summarizeProviderRates(buckets, T0 + 500);

    // One route, one rate — NOT one rate per model the router happened to pick. Keying on the
    // resolution would split `auto`'s rate arbitrarily and would leave refusals unkeyable.
    expect(summaries).toHaveLength(1);
    expect(summaries[0].requestedModel).toBe('auto');
    expect(summaries[0].requestsPerMinute).toBe(2);
  });

  it('keeps every resolution visible alongside the key, summing to the request count', () => {
    const buckets = foldAll([
      call({ resolvedModel: 'deepseek-v4-pro' }),
      call({ resolvedModel: 'deepseek-v4-pro', atMs: T0 + 10 }),
      call({ resolvedModel: 'qwen-3-max', atMs: T0 + 20 }),
      call({ resolvedModel: null, upstreamProvider: null, outcome: 'rate_limited', atMs: T0 + 30 }),
    ]);
    const [summary] = summarizeProviderRates(buckets, T0 + 500);

    // `null` is a real entry: it is how many calls the gateway declined to attribute. Dropping it
    // would make the resolutions sum to less than `requests` with nothing saying why.
    expect(summary.resolutions.reduce((total, entry) => total + entry.requests, 0))
      .toBe(summary.requestsPerMinute);
    expect(summary.resolutions).toEqual(expect.arrayContaining([
      { resolvedModel: null, upstreamProvider: null, requests: 1 },
    ]));
  });

  it('treats a concrete-LOOKING route id as a router too', () => {
    // ART-148 measured a gateway answering a concrete-looking id with a different model. Nothing
    // may assume the two agree merely because the requested id is not `auto`.
    const buckets = foldAll([
      call({ requestedModel: 'gemini-2.5-flash', resolvedModel: 'gemini-2.5-flash-8b-001' }),
    ]);
    const [summary] = summarizeProviderRates(buckets, T0 + 500);

    expect(summary.requestedModel).toBe('gemini-2.5-flash');
    expect(summary.resolutions[0].resolvedModel).toBe('gemini-2.5-flash-8b-001');
  });

  it('reports each route separately when several are used', () => {
    const buckets = foldAll([
      call({ requestedModel: 'auto' }),
      call({ requestedModel: 'gemini-2.5-flash', atMs: T0 + 10 }),
      call({ requestedModel: 'gemini-2.5-flash', atMs: T0 + 20 }),
    ]);
    const summaries = summarizeProviderRates(buckets, T0 + 500);

    expect(summaries.map(({ requestedModel, requestsPerMinute }) => [requestedModel, requestsPerMinute]))
      .toEqual([['auto', 1], ['gemini-2.5-flash', 2]]);
  });

  it('models no price, tier or paid/free metadata anywhere', () => {
    const bucket = foldProviderCall(null, call());
    const text = JSON.stringify(bucket).toLowerCase();
    for (const forbidden of ['price', 'cost', 'tier', 'paid', 'currency', 'usd']) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe('AC#2 — allowance is a level, and reset is readable', () => {
  it('keeps the LAST allowance rather than accumulating levels', () => {
    const buckets = foldAll([
      call({ atMs: T0, allowance: { limit: 120, remaining: 119, resetAtEpochSeconds: 1_800_000_000 } }),
      call({ atMs: T0 + 10, allowance: { limit: 120, remaining: 117, resetAtEpochSeconds: 1_800_000_000 } }),
    ]);
    const [summary] = summarizeProviderRates(buckets, T0 + 500);

    // Summing levels produces a number that means nothing; averaging hides the one that matters.
    expect(summary.allowance).toEqual({ limit: 120, remaining: 117, resetAtEpochSeconds: 1_800_000_000 });
  });

  it('carries the last allowance forward across a bucket that reported none', () => {
    const buckets = foldAll([
      call({ atMs: T0, allowance: { limit: 120, remaining: 100, resetAtEpochSeconds: 1_800_000_000 } }),
      call({ atMs: T0 + 2_000, allowance: null }),
    ]);
    const [summary] = summarizeProviderRates(buckets, T0 + 2_500);

    // Reporting `null` here would read as "the allowance is unknown" when a true reading from two
    // seconds ago is available.
    expect(summary.allowance?.remaining).toBe(100);
  });

  it('reports the window it covers, so no reader has to assume it', () => {
    const [summary] = summarizeProviderRates(foldAll([call()]), T0 + 500);

    expect(summary.windowEndMs).toBe(T0 + 500);
    expect(summary.windowStartMs).toBe(T0 + 500 - RATE_WINDOW_MS);
    expect(summary.windowEndMs - summary.windowStartMs).toBe(RATE_WINDOW_MS);
  });
});

describe('the fold is a fold', () => {
  it('is order-independent for counts within a bucket', () => {
    const records = [
      call({ atMs: T0, outcome: 'served' }),
      call({ atMs: T0 + 1, outcome: 'rate_limited', inputTokens: null, outputTokens: null }),
      call({ atMs: T0 + 2, outcome: 'failed', inputTokens: null, outputTokens: null }),
    ];
    const forward = foldAll(records);
    const backward = foldAll([...records].reverse());

    for (const field of ['requests', 'served', 'rateLimited', 'failed', 'inputTokens', 'outputTokens'] as const) {
      expect(forward[0][field]).toBe(backward[0][field]);
    }
  });

  it('splits a call at a bucket boundary into two buckets that sum to the same rate', () => {
    const buckets = foldAll([call({ atMs: T0 + RATE_BUCKET_MS - 1 }), call({ atMs: T0 + RATE_BUCKET_MS })]);

    expect(buckets).toHaveLength(2);
    expect(summarizeProviderRates(buckets, T0 + RATE_BUCKET_MS + 500)[0].requestsPerMinute).toBe(2);
  });
});
