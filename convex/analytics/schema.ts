import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { ALLOWED_PAYLOAD_KEYS } from '../shared/analyticsContract';

/**
 * Tables owned by `analytics` (§15 / §16.1, ART-47).
 *
 * ## What is deliberately NOT stored
 *
 * No IP, no user agent, no account identity, no raw token, no free text, and no reference to any
 * Canon row. What identifies a viewer is a 64-bit digest of a random string their browser minted
 * for this surface alone, under its own storage key, so these rows cannot be joined against the
 * ballot's or the return recap's — the property `viewerProgressKey.ts` already paid for twice.
 *
 * ## Why there are three tables and not one
 *
 * `analyticsEvents` alone would answer every §16.1 question, and every answer would require
 * reading a world's whole event history. Sessions and viewers are the two aggregates the metrics
 * are actually defined over — a rate per VISIT, a retention per VIEWER — and both are cheap to
 * maintain on the write path and expensive to derive on the read path. `analyticsViewers` in
 * particular is what makes D1/D7 a bounded read: the offsets a viewer returned on are a short
 * array on one row, rather than a scan of every session they ever had.
 */
export const analyticsTables = {
  /**
   * One row per LOGICAL MEASUREMENT — `(session, event, subject)` — never one per interaction.
   *
   * `dedupeKey` is derived server-side by {@link ../shared/analyticsContract.analyticsDedupeKey}
   * from the envelope, never read off it. A caller-supplied key would let anyone suppress a row
   * by claiming an existing key or inflate a metric by varying one, and neither is detectable
   * afterwards. The unique resolution on `by_dedupe_key` is what makes a retried batch — the same
   * envelopes, sent again because a response was lost — insert nothing new.
   */
  analyticsEvents: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    /** `device:<digest>`. Never the token, and never an account. */
    viewerKey: v.string(),
    sessionKey: v.string(),
    /**
     * `v.string()` rather than a literal union of the thirty-three names, for the reason
     * `moduleModelConfigs.module` is: the enumeration is owned by the pure contract, which
     * validates on write, and duplicating it in the schema would make adding a §15 event a
     * migration to read old rows.
     */
    eventName: v.string(),
    payload: v.object(Object.fromEntries(
      // Built FROM the allowlist rather than beside it. A hand-written mirror is a second
      // payload filter wearing a schema as a disguise, and it would drift the moment the two
      // lists disagreed — silently, since both halves would still validate.
      ALLOWED_PAYLOAD_KEYS.map((key) => [key, v.optional(v.union(v.string(), v.float64(), v.boolean()))]),
    ) as Record<string, ReturnType<typeof v.optional>>),
    dedupeKey: v.string(),
    receivedAt: v.number(),
    /** UTC day of `receivedAt`. Every retention and funnel window is bucketed on this. */
    dayIndex: v.number(),
    /** Milliseconds since the session's first event, as the client measured it. A duration. */
    sessionElapsedMs: v.number(),
  })
    // The write path: does this measurement already exist?
    .index('by_dedupe_key', ['dedupeKey'])
    // The read path: a metric window is always (world, day range).
    .index('by_world_and_day', ['worldId', 'dayIndex'])
    .index('by_world_and_session', ['worldId', 'sessionKey']),

  /**
   * One row per visit. The denominator of every §16.1 rate.
   *
   * `isFirstSession` is decided ONCE, when the viewer row is created, and never recomputed. The
   * two metrics §16.1 scopes to 首次進站 would otherwise need to ask "was this the earliest
   * session" at query time, which is a scan, and which gives a different answer as soon as a
   * clock skew puts two sessions in the wrong order.
   *
   * `durationMs` is time-to-last-interaction, not dwell time. The limitation is real and is
   * recorded in `docs/product-analytics.md` §6 rather than hidden behind the field name.
   */
  analyticsSessions: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    viewerKey: v.string(),
    sessionKey: v.string(),
    dayIndex: v.number(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    durationMs: v.number(),
    eventCount: v.number(),
    /** Events the CLIENT dropped and never sent. A coverage gap, recorded rather than absent. */
    droppedEventCount: v.number(),
    isFirstSession: v.boolean(),
  })
    .index('by_session', ['sessionKey'])
    .index('by_world_and_day', ['worldId', 'dayIndex'])
    .index('by_world_and_viewer', ['worldId', 'viewerKey']),

  /**
   * One row per (world, viewer). What D1 and D7 are computed from.
   *
   * `returnDayOffsets` holds the distinct day offsets from `firstDayIndex` on which this viewer
   * had a session, bounded by {@link MAX_RETURN_DAY_OFFSETS}. Bounded because a viewer who
   * returns every day for a year would otherwise grow one row without limit on a per-batch write
   * path — the rule this repo already applies to every per-event read.
   *
   * `returnOffsetsTruncated` is what keeps the bound honest. A truncated row cannot answer "did
   * they return on day 7", so it is EXCLUDED from the retention denominator rather than counted
   * as a non-return, and the metric reports how many it excluded.
   */
  analyticsViewers: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    viewerKey: v.string(),
    firstDayIndex: v.number(),
    lastDayIndex: v.number(),
    sessionCount: v.number(),
    returnDayOffsets: v.array(v.number()),
    returnOffsetsTruncated: v.boolean(),
  })
    .index('by_world_and_viewer', ['worldId', 'viewerKey'])
    .index('by_world_and_first_day', ['worldId', 'firstDayIndex']),

  /**
   * Per (world, UTC day) ingest budget and tally.
   *
   * MUTABLE BY DESIGN, and for the reason `tokenBudgetCounters` is: a counter is a running total,
   * and appending a row per batch would make the per-batch read that enforces the cap an
   * unbounded scan. Day rollover is structural — a new day starts from a row that does not exist
   * yet, so nothing runs at midnight and nothing reads a clock to decide which budget applies.
   *
   * The cap counts ATTEMPTS rather than accepted rows, so probing the surface with invented
   * sessions costs a caller exactly what honest reporting costs them.
   */
  analyticsIngestCounters: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    dayIndex: v.number(),
    attemptedEvents: v.number(),
    acceptedEvents: v.number(),
    duplicateEvents: v.number(),
    refusedEvents: v.number(),
    sessionsCreated: v.number(),
    viewersCreated: v.number(),
  })
    .index('by_world_and_day', ['worldId', 'dayIndex']),
};

/**
 * How many distinct return-day offsets one viewer row records.
 *
 * Sized well past D7 — the furthest window §16.1 defines — so a truncated row is a viewer far
 * outside anything the PRD measures rather than a routine occurrence.
 */
export const MAX_RETURN_DAY_OFFSETS = 32;
