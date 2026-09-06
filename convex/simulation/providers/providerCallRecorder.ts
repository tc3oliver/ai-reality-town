/**
 * Counting real upstream calls, at the only place they are all visible (ART-158 AC#2).
 *
 * ## Why the seam is `fetch` and not the port
 *
 * AC#2 asks for RPM and TPM, and a rate is only meaningful if "one request" means one thing. There
 * are four candidate seams above this one, and every one of them undercounts:
 *
 *  - one per SCENE — a scene is one call, or three if the output failed to parse and the semantic
 *    retry loop ran.
 *  - one per budget RESERVATION — `runBudgetedAttempt` reserves once per scene attempt, and the
 *    route chain can make several gateway calls inside one reservation.
 *  - one per `structuredChat` on the PORT — the free-route chain makes one call per hop underneath.
 *  - one per chain HOP — the adapter's own transport ladder retries a 429 or a 5xx several times
 *    inside a single hop, and the gateway saw, and charged for, every one.
 *
 * `fetch` is the floor. One invocation is exactly one HTTP request the gateway received, which is
 * what a per-minute rate is counting and what the key allowance is actually drained by. Wrapping it
 * also means the count cannot drift from behaviour when a retry ladder changes shape, because there
 * is nothing left between this and the socket.
 *
 * ## What it reads, and what it refuses to invent
 *
 * The response is `clone()`d so the adapter still receives an unread body. Usage, route attribution
 * and the allowance headers are parsed with the adapter's OWN exported parsers rather than
 * re-implemented here — a second opinion about whether a malformed `x-ratelimit-remaining` means
 * zero or unknown would be indistinguishable downstream while meaning the opposite thing.
 *
 * Tokens stay `null` when the gateway reported none. A refusal and a failure report no usage at
 * all, and writing zero for them would be a claim the gateway never made.
 *
 * ## A metering failure must not destroy paid work
 *
 * Recording happens after the response, so a provider call has already been made and its allowance
 * already spent by the time the write is attempted. If that write fails, throwing would discard an
 * authored scene to protect a counter. So a failed record is COUNTED in {@link ProviderCallRecorder.dropped}
 * and surfaced by the caller — the rate is then knowably a floor, rather than quietly wrong.
 */

import type { Fetch } from './openAICompatible';
import { readProviderRateLimit, readProviderRoute, readProviderUsage } from './openAICompatible';
import type { ProviderCallOutcome, ProviderCallRecord } from '../../shared/providerRateWindow';

/** Where a recorded call goes. The live action binds this to `recordProviderCall`. */
export type ProviderCallSink = (record: ProviderCallRecord) => Promise<void>;

export type ProviderCallRecorder = {
  /** Drop-in replacement for the adapter's transport. */
  readonly fetch: Fetch;
  /** Records the sink refused. Non-zero means the reported rate is a FLOOR, not a total. */
  readonly dropped: () => number;
};

/**
 * The route this request asked for, read from the body that is about to be sent.
 *
 * `fallbackModel` covers the one case where the body carries no `model`: ART-52 requires that a
 * module inheriting the deployment's `LLM_MODEL` sends NO override, because a present key always
 * beats the provider instance. The gateway then routes on its own default, which is that same
 * configured id — so attributing the call to it is what actually happened, not a guess.
 */
function requestedModelOf(body: BodyInit | null | undefined, fallbackModel: string): string {
  if (typeof body !== 'string') return fallbackModel;
  try {
    const parsed = JSON.parse(body) as { model?: unknown };
    return typeof parsed.model === 'string' && parsed.model.trim().length > 0
      ? parsed.model.trim()
      : fallbackModel;
  } catch {
    return fallbackModel;
  }
}

/** 200 served, 429 refused for allowance, anything else broke. Nothing infers a 429 from a code. */
const outcomeOf = (status: number): ProviderCallOutcome =>
  status === 429 ? 'rate_limited' : status >= 200 && status < 300 ? 'served' : 'failed';

/**
 * Wrap a transport so every request it makes is metered.
 *
 * `clock` is real wall-clock time and deliberately NOT the surrounding action's frozen `now`. The
 * frozen value exists so a retried slot regenerates identical run ids; using it here would drop a
 * whole slot's calls into one bucket and report a minute of work as a single instant.
 */
export function createProviderCallRecorder(input: {
  readonly inner: Fetch;
  readonly sink: ProviderCallSink;
  readonly fallbackModel: string;
  readonly clock: () => number;
}): ProviderCallRecorder {
  let dropped = 0;

  const emit = async (record: ProviderCallRecord): Promise<void> => {
    try {
      await input.sink(record);
    } catch {
      // See the header: the call is already paid for, so the counter yields rather than the work.
      dropped += 1;
    }
  };

  const fetch: Fetch = async (url, init) => {
    const requestedModel = requestedModelOf(init?.body, input.fallbackModel);
    let response: Response;
    try {
      response = await input.inner(url, init);
    } catch (error) {
      // The gateway may or may not have received this. It is recorded as a real attempt because a
      // request that left the process and produced no answer is exactly what a caller experiences
      // as a failed call, and omitting it would make a broken network look like an idle one.
      await emit({
        requestedModel, resolvedModel: null, upstreamProvider: null, outcome: 'failed',
        inputTokens: null, outputTokens: null, allowance: null, atMs: input.clock(),
      });
      throw error;
    }

    // Cloned BEFORE anything reads it, so the adapter still receives an unconsumed body.
    let root: Record<string, unknown> = {};
    try {
      const parsed = await response.clone().json() as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        root = parsed as Record<string, unknown>;
      }
    } catch {
      // A non-JSON body (an HTML error page, an empty 429) is still a real request. It simply
      // reports no usage and no route, which is the honest reading rather than a defect.
    }

    const usage = readProviderUsage(root);
    const route = readProviderRoute(root);
    await emit({
      requestedModel,
      // A refusal has no resolution — the gateway never said what would have served it — so these
      // stay null rather than echoing the route that was asked for.
      resolvedModel: route.resolvedModel,
      upstreamProvider: route.upstreamProvider,
      outcome: outcomeOf(response.status),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      allowance: readProviderRateLimit(response.headers),
      atMs: input.clock(),
    });
    return response;
  };

  return { fetch, dropped: () => dropped };
}
