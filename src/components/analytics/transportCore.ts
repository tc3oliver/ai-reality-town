/**
 * The transport, as a decision layer with its I/O injected (§15 / ART-47).
 *
 * Named `transportCore` rather than `analyticsTransport` because macOS and Windows resolve paths
 * case-insensitively: a module sitting beside `AnalyticsTransport.tsx` and differing from it only
 * in case can be resolved to its own importer, and the circular import that produces hangs the
 * module loader with no error. It cost an hour here; the rename is the whole fix.
 *
 * {@link ./AnalyticsTransport.tsx} supplies the clock, the timer and the mutation; everything
 * that could be WRONG is here, where a test can drive it without a DOM and without a Convex
 * deployment. The split is the same one `viewerProgress.ts` and `viewerProgressFunctions.ts` use.
 *
 * ## One queue per world, not one queue
 *
 * A batch is submitted for a single `worldId`, because a measurement that cannot be attributed to
 * a world cannot appear in any §16.1 report. Mixing two worlds into one batch would force the
 * ingest to either split it — which breaks the all-or-nothing retry the dedupe keys rely on — or
 * to attribute half of it wrongly. An event whose payload carries no `worldId` is dropped here
 * rather than guessed at.
 *
 * ## Failure is never the viewer's problem
 *
 * Every entry point is wrapped. A collector that is down, a mutation that throws, a queue that is
 * full: all of them end with the page rendering exactly as it would have. That is not politeness
 * — a viewer losing the live map because a telemetry call failed would be a far worse defect than
 * a lost event, and the browser gate proves it against a transport whose call ALWAYS throws.
 *
 * ## Retry does not double-count, twice over
 *
 * A failed send leaves the batch IN FLIGHT, so the next attempt re-offers the same envelopes
 * rather than a fresh window over a queue that has moved on. Those envelopes derive the same
 * dedupe keys on the server, which resolves them against a unique index. Either layer alone would
 * be insufficient: the client cannot know whether a lost response meant the write happened, and
 * the server cannot know that two structurally different batches described one interaction.
 */

import {
  createAnalyticsQueue,
  type AnalyticsBatch,
  type AnalyticsQueue,
} from '../../analytics/analyticsQueue';
import type { AnalyticsEvent } from '../../../convex/shared/analyticsContract';
import type { AnalyticsIdentity } from './analyticsIdentity';

/** What the transport needs from the outside world. All of it injected. */
export type TransportPorts = {
  /** Epoch milliseconds. */
  now(): number;
  /** Submit one batch. Resolves on acceptance, rejects on anything else. */
  send(request: AnalyticsSendRequest): Promise<unknown>;
  /** Ask to be called back in `delayMs`. Returns a canceller. */
  schedule(delayMs: number, run: () => void): () => void;
};

export type AnalyticsSendRequest = {
  worldId: string;
  deviceKey: string;
  sessionToken: string;
  events: AnalyticsBatch['events'];
  droppedEventCount: number;
};

/**
 * How long the queue waits before sending.
 *
 * Long enough that a viewer clicking through four characters produces one request rather than
 * four; short enough that a viewer who leaves after ten seconds has been counted. It is a
 * debounce on the FIRST queued event, not a repeating timer — an idle page schedules nothing,
 * which is what keeps「觀看不產生流量」true for a page nobody is touching.
 */
export const FLUSH_DELAY_MS = 2_000;

/** Backoff after a failed send. Doubles to the cap; a success resets it. */
export const RETRY_BASE_DELAY_MS = 5_000;
export const MAX_RETRY_DELAY_MS = 60_000;

export type AnalyticsTransport = {
  /** Queue one event. Never throws. */
  accept(event: AnalyticsEvent): void;
  /** Send everything queued now — the page is going away. Never throws, never rejects. */
  flush(): Promise<void>;
  /** Cancel any pending timer. Idempotent. */
  stop(): void;
  /** For tests and for the browser gate. */
  readonly stats: { worlds: number; sending: boolean; retryDelayMs: number };
};

export function createAnalyticsTransport(
  identity: AnalyticsIdentity,
  ports: TransportPorts,
): AnalyticsTransport {
  const queues = new Map<string, AnalyticsQueue>();
  const sessionStartedAt = ports.now();
  let cancelTimer: (() => void) | null = null;
  let sending = false;
  let retryDelayMs = RETRY_BASE_DELAY_MS;
  let stopped = false;

  const queueFor = (worldId: string): AnalyticsQueue => {
    const existing = queues.get(worldId);
    if (existing !== undefined) return existing;
    // Scoped by world so two worlds' measurements cannot dedupe against each other — the subject
    // already carries `worldId`, so this is belt and braces, and it is what makes a batch
    // submittable under one world id at all.
    const created = createAnalyticsQueue(`${identity.sessionToken}:${worldId}`);
    queues.set(worldId, created);
    return created;
  };

  const arm = (delayMs: number): void => {
    if (stopped || cancelTimer !== null) return;
    cancelTimer = ports.schedule(delayMs, () => {
      cancelTimer = null;
      void drain();
    });
  };

  async function sendOne(worldId: string, queue: AnalyticsQueue): Promise<boolean> {
    const batch = queue.take();
    if (batch === null) return true;
    try {
      await ports.send({
        worldId,
        deviceKey: identity.deviceKey,
        sessionToken: identity.sessionToken,
        events: batch.events,
        droppedEventCount: batch.droppedEventCount,
      });
      queue.settle();
      return true;
    } catch {
      // The batch stays in flight. The next attempt re-offers these exact envelopes, which is
      // what makes a retry idempotent on the server rather than merely cheap here.
      queue.fail();
      return false;
    }
  }

  async function drain(): Promise<void> {
    if (sending || stopped) return;
    sending = true;
    let allSent = true;
    try {
      for (const [worldId, queue] of queues) {
        // Sequential rather than concurrent: two in-flight batches from one session can be
        // accepted out of order, and the session row's duration takes the LARGER elapsed value,
        // so ordering does not corrupt it — but a burst of parallel mutations from a page that
        // is merely being watched is exactly the traffic pattern this surface must not produce.
        // eslint-disable-next-line no-await-in-loop
        const sent = await sendOne(worldId, queue);
        if (!sent) allSent = false;
      }
    } catch {
      allSent = false;
    } finally {
      sending = false;
    }
    if (allSent) {
      retryDelayMs = RETRY_BASE_DELAY_MS;
      // Anything queued while a send was in flight.
      if ([...queues.values()].some((queue) => queue.stats.pending > 0)) arm(FLUSH_DELAY_MS);
      return;
    }
    const delay = retryDelayMs;
    retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
    arm(delay);
  }

  return {
    accept(event) {
      try {
        if (stopped) return;
        const worldId = event.payload.worldId;
        // Unattributable, so unmeasurable. Dropped rather than filed under a placeholder world,
        // which would put a row in a report for a world that does not exist.
        if (typeof worldId !== 'string' || worldId.length === 0) return;
        if (queueFor(worldId).offer(event, ports.now() - sessionStartedAt)) arm(FLUSH_DELAY_MS);
      } catch {
        // See the failure-isolation note above.
      }
    },

    async flush() {
      try {
        if (cancelTimer !== null) {
          cancelTimer();
          cancelTimer = null;
        }
        await drain();
      } catch {
        // Never rejects: this is called from a `visibilitychange` handler, and an unhandled
        // rejection during a page transition is a console error a viewer can see.
      }
    },

    stop() {
      stopped = true;
      if (cancelTimer !== null) {
        cancelTimer();
        cancelTimer = null;
      }
    },

    get stats() {
      return { worlds: queues.size, sending, retryDelayMs };
    },
  };
}
