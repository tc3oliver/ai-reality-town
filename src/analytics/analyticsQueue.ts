/**
 * The client half of exactly-once logical measurement (ART-47).
 *
 * ## Two different duplicates, two different mechanisms
 *
 * A metric can be inflated in two unrelated ways, and a fix for one does nothing about the other:
 *
 *  1. **The UI emits twice.** A component re-renders, an effect re-runs, a viewer double-taps, a
 *     hook retries a failed vote and succeeds. All of these are ONE logical measurement, and none
 *     of them is a transport problem — the events are genuinely different calls.
 *  2. **The transport sends twice.** A batch is sent, the response is lost, the batch is re-sent.
 *     One logical measurement, two deliveries.
 *
 * This module handles (1) by refusing to enqueue a dedupe key it has already accepted this
 * session, and it handles the CLIENT side of (2) by re-offering the SAME in-flight batch instead
 * of building a new one — so a retry carries byte-identical envelopes, which derive byte-identical
 * keys on the server, which resolves them against a unique index. The server half is what actually
 * makes (2) safe; this half is what makes a retry cheap and what stops the queue reordering
 * itself under failure.
 *
 * ## Why the dedupe set is per SESSION and never cleared
 *
 * A viewer who opens Episode 7, navigates away and comes back has opened one Episode. Every rate
 * in §16.1 is a per-visit rate, so the session is the correct scope, and a set that expired would
 * make the metric depend on how long a page was left open.
 *
 * The set is bounded by {@link MAX_SESSION_DEDUPE_KEYS} because it is fed by viewer interaction
 * and an unbounded one is a memory leak on a page that stays open for hours. Past the bound the
 * queue stops deduplicating and SAYS SO, rather than silently starting to double-count.
 *
 * Deterministic: no clock, no randomness, no I/O. It holds state, which is the point of it.
 */

import {
  analyticsDedupeKey,
  MAX_ANALYTICS_BATCH_SIZE,
  type AnalyticsEvent,
  type AnalyticsEventEnvelope,
} from '../../convex/shared/analyticsContract';

/**
 * How many events may wait to be sent.
 *
 * Reached only when the collector has been unreachable for a while, since a healthy queue drains
 * on every flush. Past it, NEW events are dropped and the oldest are kept: the events that
 * establish a session — the first `home_viewed`, the first Episode open — are the ones every
 * funnel denominator needs, and discarding them to make room for a viewer's fortieth zoom would
 * lose the measurement that mattered.
 */
export const MAX_PENDING_EVENTS = 128;

/** How many distinct logical measurements one session may deduplicate against. */
export const MAX_SESSION_DEDUPE_KEYS = 512;

/** What one flush hands the transport. */
export type AnalyticsBatch = {
  events: readonly AnalyticsEventEnvelope[];
  /**
   * Events this client dropped and will never send, cumulative for the session.
   *
   * Travels WITH the batch so a gap in the data is a recorded fact rather than an absence.
   * Truncation is never silent — a metric computed over a session that dropped forty events must
   * be readable as such, and there is no way to notice that from the surviving rows.
   */
  droppedEventCount: number;
};

export type AnalyticsQueue = {
  /**
   * Offer an event. Returns whether it became a new logical measurement.
   *
   * `false` covers both「這一次量測已經記過了」and「佇列滿了」. The caller has nothing useful to do
   * with the difference — emitting is fire-and-forget by design — so the counts are read off
   * {@link AnalyticsQueue.stats} instead.
   */
  offer(event: AnalyticsEvent, sessionElapsedMs: number): boolean;
  /**
   * The batch to send now, or `null` when there is nothing to send.
   *
   * IDEMPOTENT while a batch is in flight: called again before {@link settle} or {@link fail}, it
   * returns the same batch. That is what makes a transport retry re-send identical envelopes
   * rather than a fresh window over a queue that has moved on.
   */
  take(): AnalyticsBatch | null;
  /** The in-flight batch was accepted. Drop it. */
  settle(): void;
  /** The in-flight batch was not accepted. Keep it for the next {@link take}. */
  fail(): void;
  readonly stats: {
    pending: number;
    inFlight: number;
    dropped: number;
    deduplicated: number;
    /** True once the dedupe set is full, so a metric read can be qualified rather than trusted. */
    dedupeSetSaturated: boolean;
  };
};

export function createAnalyticsQueue(sessionKey: string): AnalyticsQueue {
  const seen = new Set<string>();
  let pending: AnalyticsEventEnvelope[] = [];
  let inFlight: AnalyticsEventEnvelope[] | null = null;
  let dropped = 0;
  let deduplicated = 0;

  return {
    offer(event, sessionElapsedMs) {
      const key = analyticsDedupeKey(sessionKey, event.name, event.payload);
      if (seen.has(key)) {
        deduplicated += 1;
        return false;
      }
      if (pending.length + (inFlight?.length ?? 0) >= MAX_PENDING_EVENTS) {
        dropped += 1;
        return false;
      }
      // Recorded as seen only once it is actually queued. Marking a dropped event as seen would
      // mean the queue draining never let that measurement through again — a full moment would
      // permanently erase an Episode open rather than delaying it.
      if (seen.size < MAX_SESSION_DEDUPE_KEYS) seen.add(key);
      pending.push({
        name: event.name,
        payload: event.payload,
        // Clamped to a non-negative integer here rather than trusted: the caller derives it from
        // two clock readings, and a backwards system clock would otherwise put a negative
        // duration on the wire for the session-length metric to average in.
        sessionElapsedMs: Math.max(0, Math.round(sessionElapsedMs)),
      });
      return true;
    },

    take() {
      if (inFlight !== null) return { events: inFlight, droppedEventCount: dropped };
      if (pending.length === 0) return null;
      inFlight = pending.slice(0, MAX_ANALYTICS_BATCH_SIZE);
      pending = pending.slice(MAX_ANALYTICS_BATCH_SIZE);
      return { events: inFlight, droppedEventCount: dropped };
    },

    settle() {
      inFlight = null;
    },

    fail() {
      // Deliberately a no-op on the data: the batch stays in flight so the next `take` re-offers
      // it. Moving it back to the front of `pending` would be the same thing with more code and
      // one more way to reorder it.
    },

    get stats() {
      return {
        pending: pending.length,
        inFlight: inFlight?.length ?? 0,
        dropped,
        deduplicated,
        dedupeSetSaturated: seen.size >= MAX_SESSION_DEDUPE_KEYS,
      };
    },
  };
}
