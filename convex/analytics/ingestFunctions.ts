/**
 * The analytics ingest — the one telemetry write in the deployment (§15 / ART-47).
 *
 * ## Why this is NOT a viewer write, and why that distinction is load-bearing
 *
 * `viewerWriteBoundary` already admits two writes a viewer can reach: ART-45's ballot and
 * ART-39's progress record. Both are DELIBERATE ACTS — a viewer pressed something meaning to
 * change stored state — and both change what the product shows somebody. That is the argument
 * `docs/daily-environment-vote.md` §2 makes for why they are not「觀看」, and it is the argument
 * that lets PRD 2.0 §22.16 stay true.
 *
 * Telemetry is not that, and folding it into the same gate would break the argument in both
 * directions: it would let the世界-mutation cap grow to cover something that mutates no world
 * state, and it would let a future telemetry field claim the ballot's justification. So it gets
 * its own gate (`telemetry`), its own boundary (`analyticsWriteBoundary`), its own module and its
 * own cap. `viewerWriteBoundary.maxViewerMutations` stays at **2** — analytics spends none of the
 * world-mutation budget, and `publicReadOnlyGuarantee.test.ts` asserts exactly that.
 *
 * The separation is a property of the policy, not a claim in a docblock: this module may not name
 * a Canon writer, a reducer, a replay entry point, a simulation symbol or a provider, and the
 * build fails on the SYMBOL rather than on the import — so a module that grew its own writer is
 * caught as well as one that imported somebody else's.
 *
 * ## What a caller can and cannot do here
 *
 * Anyone holding the deployment URL can post at this function. What that buys them is bounded:
 *
 *  - **Nothing they send is stored verbatim.** Every payload goes through the SAME sanitiser the
 *    browser uses, from `convex/shared/analyticsContract.ts`, so the allowlist is enforced on the
 *    untrusted side too. A field outside it does not reach a row.
 *  - **They cannot choose a dedupe key.** It is derived here from `(session, name, sanitised
 *    payload)`. A caller-supplied key would let anyone suppress a measurement by claiming an
 *    existing one, or inflate a rate by varying it, and neither is detectable afterwards.
 *  - **They cannot invent a world.** A world that has published nothing is refused before any
 *    row is written, so this is not a way to allocate rows in an unbounded number of worlds.
 *  - **They are metered on ATTEMPTS.** A refused batch costs the same as an accepted one, so
 *    probing the surface is not cheaper than using it.
 *  - **They learn nothing.** The result is a count of what this caller's own submission did.
 *    No stored value is echoed and no other session is observable.
 */

import { v } from 'convex/values';
import type { GenericMutationCtx } from 'convex/server';

import { mutation } from '../_generated/server';
import type { DataModel, Doc } from '../_generated/dataModel';
import { ALLOWED_PAYLOAD_KEYS, MAX_ANALYTICS_BATCH_SIZE } from '../shared/analyticsContract';
import {
  ANALYTICS_SCHEMA_VERSION,
  foldSession,
  foldViewer,
  prepareAnalyticsBatch,
  type PreparedBatch,
} from './ingest';

/**
 * The declared payload shape, built FROM the allowlist.
 *
 * Convex validates arguments before the handler runs, so this is a third enforcement of the same
 * one list — and the only one that can refuse a request without executing any of our code. It is
 * generated rather than hand-written for the reason the table's validator is: a mirror drifts,
 * and a drift here admits a field the sanitiser would have dropped.
 */
const payloadValidator = v.object(Object.fromEntries(
  ALLOWED_PAYLOAD_KEYS.map((key) => [key, v.optional(v.union(v.string(), v.float64(), v.boolean()))]),
) as Record<string, ReturnType<typeof v.optional>>);

const ingestResultValidator = v.object({
  accepted: v.boolean(),
  /** New logical measurements written by this call. */
  recorded: v.number(),
  /** Measurements this call re-sent that were already recorded. A retry reports these. */
  duplicates: v.number(),
  code: v.union(v.string(), v.null()),
});

/**
 * Record a batch of logical measurements (§15, §16.1).
 *
 * IDEMPOTENT BY CONSTRUCTION. A transport that sends a batch, loses the response and sends it
 * again submits byte-identical envelopes, which derive identical dedupe keys, which resolve
 * against `by_dedupe_key` — so the second call writes nothing and reports `duplicates`. That is
 * the SERVER half of exactly-once; the client half (a re-render or a UI retry emitting twice) is
 * `src/analytics/analyticsQueue.ts`, and neither substitutes for the other.
 */
export const recordAnalyticsEvents = mutation({
  args: {
    worldId: v.string(),
    deviceKey: v.string(),
    sessionToken: v.string(),
    events: v.array(v.object({
      name: v.string(),
      payload: payloadValidator,
      sessionElapsedMs: v.number(),
    })),
    droppedEventCount: v.number(),
  },
  returns: ingestResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now();

    // Before anything is read about this caller. An unbounded `events` array would be an
    // unbounded write, and Convex has already validated the shape, so this is the size.
    if (args.events.length === 0 || args.events.length > MAX_ANALYTICS_BATCH_SIZE) {
      return { accepted: false, recorded: 0, duplicates: 0, code: 'ANALYTICS_BATCH_TOO_LARGE' };
    }

    // A world that has published nothing is not a world. Index-scoped and `.first()`, so this is
    // a point lookup rather than a scan, and it is what stops the surface from being a way to
    // allocate counter rows in an unbounded number of invented worlds — the same hole
    // `viewerProgress` closed by requiring a published episode index.
    const published = await ctx.db
      .query('publishedReadModels')
      .withIndex('by_current', (q) => q.eq('worldId', args.worldId))
      .first();
    if (published === null) {
      return { accepted: false, recorded: 0, duplicates: 0, code: 'ANALYTICS_INVALID_WORLD' };
    }

    const dayIndex = Math.floor(now / 86_400_000);
    const counter = await ctx.db
      .query('analyticsIngestCounters')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId).eq('dayIndex', dayIndex))
      .unique();

    const outcome = prepareAnalyticsBatch(
      {
        worldId: args.worldId,
        deviceKey: args.deviceKey,
        sessionToken: args.sessionToken,
        events: args.events,
        droppedEventCount: args.droppedEventCount,
        now,
      },
      counter?.acceptedEvents ?? 0,
    );

    if (outcome.prepared === null) {
      // The attempt is metered even though nothing was stored. A refusal that cost nothing would
      // make the budget decorative and turn the endpoint into a free oracle.
      await bumpCounter(ctx, counter, args.worldId, dayIndex, {
        attemptedEvents: args.events.length, refusedEvents: args.events.length,
      });
      return { accepted: false, recorded: 0, duplicates: 0, code: outcome.code };
    }

    const prepared: PreparedBatch = outcome.prepared;

    let recorded = 0;
    let duplicates = 0;
    for (const measurement of prepared.measurements) {
      const existing = await ctx.db
        .query('analyticsEvents')
        .withIndex('by_dedupe_key', (q) => q.eq('dedupeKey', measurement.dedupeKey))
        .first();
      if (existing !== null) {
        duplicates += 1;
        continue;
      }
      await ctx.db.insert('analyticsEvents', {
        schemaVersion: ANALYTICS_SCHEMA_VERSION,
        worldId: prepared.worldId,
        viewerKey: prepared.viewerKey,
        sessionKey: prepared.sessionKey,
        eventName: measurement.eventName,
        payload: measurement.payload,
        dedupeKey: measurement.dedupeKey,
        receivedAt: now,
        dayIndex: prepared.dayIndex,
        sessionElapsedMs: measurement.sessionElapsedMs,
      } as never);
      recorded += 1;
    }

    const sessionRow = await ctx.db
      .query('analyticsSessions')
      .withIndex('by_session', (q) => q.eq('sessionKey', prepared.sessionKey))
      .unique();
    const viewerRow = await ctx.db
      .query('analyticsViewers')
      .withIndex('by_world_and_viewer', (q) =>
        q.eq('worldId', prepared.worldId).eq('viewerKey', prepared.viewerKey))
      .unique();

    let sessionsCreated = 0;
    let viewersCreated = 0;
    if (sessionRow === null) {
      sessionsCreated = 1;
      const folded = foldSession(null, prepared, now);
      await ctx.db.insert('analyticsSessions', {
        schemaVersion: ANALYTICS_SCHEMA_VERSION,
        ...folded,
        // Decided ONCE, here, and never recomputed. A viewer with no row yet is arriving for the
        // first time; §16.1's two 首次進站 metrics are scoped on this flag rather than on a
        // query-time "was this the earliest session", which is a scan and which changes its
        // answer under clock skew.
        isFirstSession: viewerRow === null,
      } as never);
      // Once per SESSION, never once per batch — see `foldViewer`.
      const foldedViewer = foldViewer(viewerRow, prepared.worldId, prepared.viewerKey, prepared.dayIndex);
      if (viewerRow === null) {
        viewersCreated = 1;
        await ctx.db.insert('analyticsViewers', {
          schemaVersion: ANALYTICS_SCHEMA_VERSION, ...foldedViewer,
          returnDayOffsets: [...foldedViewer.returnDayOffsets],
        } as never);
      } else {
        await ctx.db.patch(viewerRow._id, {
          firstDayIndex: foldedViewer.firstDayIndex,
          lastDayIndex: foldedViewer.lastDayIndex,
          sessionCount: foldedViewer.sessionCount,
          returnDayOffsets: [...foldedViewer.returnDayOffsets],
          returnOffsetsTruncated: foldedViewer.returnOffsetsTruncated,
        });
      }
    } else {
      const folded = foldSession(sessionRow, prepared, now);
      await ctx.db.patch(sessionRow._id, {
        lastSeenAt: folded.lastSeenAt,
        durationMs: folded.durationMs,
        eventCount: folded.eventCount,
        droppedEventCount: folded.droppedEventCount,
      });
    }

    await bumpCounter(ctx, counter, args.worldId, dayIndex, {
      attemptedEvents: args.events.length,
      acceptedEvents: recorded,
      duplicateEvents: duplicates,
      refusedEvents: prepared.rejectedCount,
      sessionsCreated,
      viewersCreated,
    });

    return { accepted: true, recorded, duplicates, code: null };
  },
});

type CounterDelta = Partial<Record<
  'attemptedEvents' | 'acceptedEvents' | 'duplicateEvents' | 'refusedEvents'
  | 'sessionsCreated' | 'viewersCreated', number>>;

/**
 * Add to the day's tally, creating the row on first use.
 *
 * Day rollover is structural: the row is keyed on `dayIndex`, so a new day starts from a row that
 * does not exist yet and therefore from zero. Nothing runs at midnight, and nothing reads a clock
 * to decide which budget applies.
 */
async function bumpCounter(
  ctx: GenericMutationCtx<DataModel>,
  existing: Doc<'analyticsIngestCounters'> | null,
  worldId: string,
  dayIndex: number,
  delta: CounterDelta,
): Promise<void> {
  const base = {
    attemptedEvents: 0, acceptedEvents: 0, duplicateEvents: 0, refusedEvents: 0,
    sessionsCreated: 0, viewersCreated: 0,
  };
  if (existing === null) {
    await ctx.db.insert('analyticsIngestCounters', {
      schemaVersion: ANALYTICS_SCHEMA_VERSION, worldId, dayIndex, ...base, ...delta,
    });
    return;
  }
  await ctx.db.patch(existing._id, {
    attemptedEvents: existing.attemptedEvents + (delta.attemptedEvents ?? 0),
    acceptedEvents: existing.acceptedEvents + (delta.acceptedEvents ?? 0),
    duplicateEvents: existing.duplicateEvents + (delta.duplicateEvents ?? 0),
    refusedEvents: existing.refusedEvents + (delta.refusedEvents ?? 0),
    sessionsCreated: existing.sessionsCreated + (delta.sessionsCreated ?? 0),
    viewersCreated: existing.viewersCreated + (delta.viewersCreated ?? 0),
  });
}
