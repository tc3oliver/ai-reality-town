/**
 * The whole decision layer for analytics ingest (§15 / ART-47).
 *
 * Pure module: no Convex, no clock, no randomness, no I/O. Every rule with a correctness boundary
 * lives here so it can be unit-tested directly, and {@link ./ingestFunctions.ts} is left with
 * nothing but row access. Same split, and for the same reason, as `viewerProgress.ts` and
 * `environmentVote.ts`.
 *
 * ## The client is not trusted, and that is the whole design
 *
 * The browser sanitises before it queues, which makes a mistake cheap to catch in a DOM test.
 * That is all it is worth: anyone holding the deployment URL can post whatever they like at this
 * surface, and none of it went near the emitter. So every rule the emitter applies is applied
 * again here — the SAME rule, from `convex/shared/analyticsContract.ts`, not a second
 * implementation that could drift.
 *
 * ## What this surface structurally cannot do
 *
 * It writes three tables under `convex/analytics` and touches nothing else. It names no Canon
 * writer, no reducer, no replay entry point and no provider — enforced by `analyticsWriteBoundary`
 * in `architecture/module-boundaries.json`, which fails the build on the symbol rather than on
 * the import, so a module that grew its own writer is caught as well as one that imported a
 * writer. `analytics` may depend on `shared` and on nothing else.
 */

import {
  analyticsDedupeKey,
  dayIndexOf,
  isAnalyticsEvent,
  MAX_ANALYTICS_BATCH_SIZE,
  sanitizeAnalyticsPayload,
  type AnalyticsEventName,
  type AnalyticsPayload,
} from '../shared/analyticsContract';
import { opaqueDigest } from '../shared/opaqueDigest';
import { MAX_RETURN_DAY_OFFSETS } from './schema';

export const ANALYTICS_SCHEMA_VERSION = 1;

/**
 * Accepted shape of an opaque browser-minted token.
 *
 * Identical to the ballot's and the progress record's, because all three are the same kind of
 * value. The TOKENS are different: three independent random strings under three storage keys, so
 * no single column joins a viewer's ballots, their reading position and their interaction
 * history. §15's data-minimisation rule is precisely the instruction not to create that join for
 * the product's own convenience.
 */
const ANALYTICS_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;

export const isAnalyticsKey = (value: unknown): value is string =>
  typeof value === 'string' && ANALYTICS_KEY_PATTERN.test(value);

/** The stored key for a browser-minted analytics token. Never the token itself. */
export const analyticsViewerKey = (deviceKey: string): string => `device:${opaqueDigest(deviceKey)}`;

/** The stored key for one visit. Scoped under the viewer so two viewers cannot collide. */
export const analyticsSessionKey = (deviceKey: string, sessionToken: string): string =>
  `session:${opaqueDigest(`${deviceKey}|${sessionToken}`)}`;

/**
 * Logical measurements one world may accept in one UTC day.
 *
 * The bound that stops this surface from being a free write endpoint. Sized far above what a
 * public test produces — a thousand visitors emitting the whole §15 set is well inside it — so
 * reaching it is evidence of abuse rather than of success, and the refusal says which.
 */
export const MAX_EVENTS_PER_WORLD_DAY = 200_000;

/**
 * How long a session may be reported to have lasted.
 *
 * A duration arrives from a client clock and is therefore a claim. A tab left open for a week
 * would otherwise report a six-day session and, on its own, drag the 停留超過三分鐘 rate to
 * meaninglessness. Clamped rather than refused: the events in that session are real.
 */
export const MAX_SESSION_DURATION_MS = 4 * 60 * 60 * 1000;

export type AnalyticsRefusalCode =
  | 'ANALYTICS_INVALID_WORLD'
  | 'ANALYTICS_INVALID_KEY'
  | 'ANALYTICS_EMPTY_BATCH'
  | 'ANALYTICS_BATCH_TOO_LARGE'
  | 'ANALYTICS_DAY_BUDGET_EXHAUSTED';

export type RawAnalyticsEnvelope = {
  name: string;
  payload: unknown;
  sessionElapsedMs: number;
};

export type AnalyticsBatchSubmission = {
  worldId: string;
  deviceKey: string;
  sessionToken: string;
  events: readonly RawAnalyticsEnvelope[];
  droppedEventCount: number;
  now: number;
};

/** One measurement, validated, sanitised and keyed. Ready to become a row. */
export type PreparedMeasurement = {
  eventName: AnalyticsEventName;
  payload: AnalyticsPayload;
  dedupeKey: string;
  sessionElapsedMs: number;
};

export type PreparedBatch = {
  worldId: string;
  viewerKey: string;
  sessionKey: string;
  dayIndex: number;
  measurements: readonly PreparedMeasurement[];
  /** Envelopes refused before any row was touched: an unknown name, or a malformed duration. */
  rejectedCount: number;
  droppedEventCount: number;
};

export type PreparedBatchOutcome =
  | { prepared: PreparedBatch; code: null }
  | { prepared: null; code: AnalyticsRefusalCode };

/**
 * Validate, sanitise and key one submitted batch.
 *
 * Everything that can be decided without reading a row is decided here, so the handler's row
 * access begins only for a batch that is already known to be well-formed. That ordering is not
 * tidiness: a refusal that had already read rows could be used to probe which worlds and which
 * sessions exist, and the codes below deliberately describe the SUBMISSION rather than anything
 * stored.
 */
export function prepareAnalyticsBatch(
  submission: AnalyticsBatchSubmission,
  acceptedToday: number,
): PreparedBatchOutcome {
  if (typeof submission.worldId !== 'string' || submission.worldId.trim().length === 0) {
    return { prepared: null, code: 'ANALYTICS_INVALID_WORLD' };
  }
  if (!isAnalyticsKey(submission.deviceKey) || !isAnalyticsKey(submission.sessionToken)) {
    return { prepared: null, code: 'ANALYTICS_INVALID_KEY' };
  }
  if (submission.events.length === 0) return { prepared: null, code: 'ANALYTICS_EMPTY_BATCH' };
  if (submission.events.length > MAX_ANALYTICS_BATCH_SIZE) {
    return { prepared: null, code: 'ANALYTICS_BATCH_TOO_LARGE' };
  }
  if (acceptedToday >= MAX_EVENTS_PER_WORLD_DAY) {
    return { prepared: null, code: 'ANALYTICS_DAY_BUDGET_EXHAUSTED' };
  }

  const sessionKey = analyticsSessionKey(submission.deviceKey, submission.sessionToken);
  const measurements: PreparedMeasurement[] = [];
  const seen = new Set<string>();
  let rejectedCount = 0;

  for (const envelope of submission.events) {
    if (typeof envelope?.name !== 'string' || !isAnalyticsEvent(envelope.name)) {
      rejectedCount += 1;
      continue;
    }
    const payload = sanitizeAnalyticsPayload(envelope.payload);
    const dedupeKey = analyticsDedupeKey(sessionKey, envelope.name, payload);
    // Within-batch duplicates are collapsed here rather than left to the unique index, because
    // two rows with one key would otherwise both be inserted: the index is resolved once, before
    // either write, so a batch that repeated itself would defeat it.
    if (seen.has(dedupeKey)) {
      rejectedCount += 1;
      continue;
    }
    seen.add(dedupeKey);
    const elapsed = envelope.sessionElapsedMs;
    measurements.push({
      eventName: envelope.name,
      payload,
      dedupeKey,
      sessionElapsedMs: Number.isFinite(elapsed)
        ? Math.min(Math.max(0, Math.round(elapsed)), MAX_SESSION_DURATION_MS)
        : 0,
    });
  }

  return {
    prepared: {
      worldId: submission.worldId,
      viewerKey: analyticsViewerKey(submission.deviceKey),
      sessionKey,
      dayIndex: dayIndexOf(submission.now),
      measurements,
      rejectedCount,
      droppedEventCount: Number.isFinite(submission.droppedEventCount)
        ? Math.max(0, Math.round(submission.droppedEventCount))
        : 0,
    },
    code: null,
  };
}

// --- the two aggregates -----------------------------------------------------

export type SessionAggregate = {
  worldId: string;
  viewerKey: string;
  sessionKey: string;
  dayIndex: number;
  firstSeenAt: number;
  lastSeenAt: number;
  durationMs: number;
  eventCount: number;
  droppedEventCount: number;
  isFirstSession: boolean;
};

/**
 * Fold a batch into a session row.
 *
 * `durationMs` is the LARGEST `sessionElapsedMs` reported, not `lastSeenAt - firstSeenAt`. The
 * two differ whenever a batch is delayed or retried, and the server-clock version would credit a
 * session with the time its own request spent queued — a viewer who closed the tab and whose last
 * batch arrived four minutes later would be recorded as having stayed four minutes.
 *
 * It is monotonic: a late batch carrying a smaller elapsed value cannot shorten a session.
 */
export function foldSession(
  existing: SessionAggregate | null,
  prepared: PreparedBatch,
  now: number,
): SessionAggregate {
  const maxElapsed = prepared.measurements.reduce(
    (longest, measurement) => Math.max(longest, measurement.sessionElapsedMs), 0,
  );
  if (existing === null) {
    return {
      worldId: prepared.worldId,
      viewerKey: prepared.viewerKey,
      sessionKey: prepared.sessionKey,
      dayIndex: prepared.dayIndex,
      firstSeenAt: now,
      lastSeenAt: now,
      durationMs: Math.min(maxElapsed, MAX_SESSION_DURATION_MS),
      eventCount: prepared.measurements.length,
      droppedEventCount: prepared.droppedEventCount,
      // Decided by the caller, which knows whether the viewer row already existed.
      isFirstSession: false,
    };
  }
  return {
    ...existing,
    lastSeenAt: Math.max(existing.lastSeenAt, now),
    durationMs: Math.min(Math.max(existing.durationMs, maxElapsed), MAX_SESSION_DURATION_MS),
    eventCount: existing.eventCount + prepared.measurements.length,
    // The client reports a CUMULATIVE drop count, so the larger reading is the current one. Adding
    // them would count the same dropped event once per remaining batch.
    droppedEventCount: Math.max(existing.droppedEventCount, prepared.droppedEventCount),
  };
}

export type ViewerAggregate = {
  worldId: string;
  viewerKey: string;
  firstDayIndex: number;
  lastDayIndex: number;
  sessionCount: number;
  returnDayOffsets: readonly number[];
  returnOffsetsTruncated: boolean;
};

/**
 * Fold a day into a viewer row. Called ONCE PER SESSION, never once per batch.
 *
 * That is what makes `sessionCount` a count of visits rather than of network requests, and it is
 * why a session that runs past midnight is attributed wholly to the day it STARTED: the session
 * row's `dayIndex` is fixed when the row is created, and this never sees the later day. A visit
 * spanning midnight is one visit, and calling it a next-day return would report retention for a
 * viewer who never left.
 *
 * The offset is measured from `firstDayIndex`, so offset 0 is the acquisition day and is never
 * recorded — a viewer is not a "return" on the day they arrived, and including it would make
 * every cohort's D0 100% and tempt someone into reading it as retention.
 *
 * A viewer whose first-seen day somehow moves EARLIER — which a clock skew across two devices
 * sharing a token can produce — has every recorded offset rebased rather than reinterpreted. The
 * alternative is offsets measured from two different origins on one row, which reads as a viewer
 * who returned on day −1.
 */
export function foldViewer(
  existing: ViewerAggregate | null,
  worldId: string,
  viewerKey: string,
  dayIndex: number,
): ViewerAggregate {
  if (existing === null) {
    return {
      worldId, viewerKey,
      firstDayIndex: dayIndex,
      lastDayIndex: dayIndex,
      sessionCount: 1,
      returnDayOffsets: [],
      returnOffsetsTruncated: false,
    };
  }
  const firstDayIndex = Math.min(existing.firstDayIndex, dayIndex);
  const rebase = existing.firstDayIndex - firstDayIndex;
  const offsets = new Set(existing.returnDayOffsets.map((offset) => offset + rebase));
  if (rebase > 0) offsets.add(rebase);

  const offset = dayIndex - firstDayIndex;
  let truncated = existing.returnOffsetsTruncated;
  if (offset > 0 && !offsets.has(offset)) {
    // Truncation is never silent. Past the bound the row stops recording offsets and SAYS so, and
    // the retention metric excludes it from the denominator rather than counting it as a viewer
    // who did not come back.
    if (offsets.size >= MAX_RETURN_DAY_OFFSETS) truncated = true;
    else offsets.add(offset);
  }
  return {
    worldId, viewerKey, firstDayIndex,
    lastDayIndex: Math.max(existing.lastDayIndex, dayIndex),
    sessionCount: existing.sessionCount + 1,
    returnDayOffsets: [...offsets].sort((left, right) => left - right),
    returnOffsetsTruncated: truncated,
  };
}
