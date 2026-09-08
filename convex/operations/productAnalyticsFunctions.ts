/**
 * The operator read surface for §16.1's product metrics (ART-47).
 *
 * ## Why this is in `operations` and not in `analytics`
 *
 * The same reason `dynamicViewMetricsFunctions.ts` is: the gate lives here. `requireOperator`
 * reads the deployment's operator registry, and `analytics` may depend on `shared` and
 * `publicRead` and on nothing else — deliberately, because the module that accepts untrusted
 * telemetry should not be able to reach the console's authorization, the simulation or the Canon
 * store. So the pure computation lives in `convex/analytics/metrics.ts`, this file reads rows and
 * applies the gate, and the ingest module stays as small as it can be.
 *
 * ## READ-ONLY, and gated on an existing capability
 *
 * `schedule.inspect`, reused rather than extended, for the reason ART-133 reused it: minting a
 * capability is a decision about the operator role model, and this task reports numbers.
 *
 * ## Why an operator gate at all, when the rows carry no personal data
 *
 * Because an aggregate is not automatically anonymous. A rate over one session is that session,
 * and 「這個世界昨天有幾個人」 is commercially and operationally sensitive whether or not any row
 * names anyone. §15's data-minimisation rule bounds what is COLLECTED; the gate bounds who reads
 * it, and the two are separate defences.
 */

import { v } from 'convex/values';
import type { GenericQueryCtx } from 'convex/server';

import { query } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import { dayIndexOf, MS_PER_DAY } from '../shared/analyticsContract';
import {
  computeAnalyticsMetrics,
  MAX_METRICS_WINDOW_DAYS,
  type AnalyticsEventRow,
  type AnalyticsSessionRow,
  type AnalyticsViewerRow,
} from '../analytics/metrics';
import { credentialArgs, requireOperator } from './opsConsoleFunctions';

type QueryCtx = GenericQueryCtx<DataModel>;

/** The default report window. Long enough to contain a matured D7 cohort. */
const DEFAULT_WINDOW_DAYS = 30;

/**
 * How many rows one report will read per table before it stops.
 *
 * The read is already index-scoped to `(world, day)` and bounded by the window, so this is the
 * second bound rather than the only one: a single very busy day could still exceed what an
 * operator query should pull. Reaching it is reported as `scanLimitReached`, which is a
 * distinguishable answer rather than a quietly wrong one — a metric computed over a truncated
 * read is not the metric it claims to be.
 */
const SCAN_LIMIT = 20_000;

const observationValidator = v.object({
  key: v.string(),
  label: v.string(),
  numerator: v.number(),
  denominator: v.number(),
  rate: v.union(v.number(), v.null()),
  status: v.string(),
  target: v.union(v.number(), v.null()),
  direction: v.string(),
  meetsTarget: v.union(v.boolean(), v.null()),
  excluded: v.number(),
  excludedReason: v.union(v.string(), v.null()),
});

/**
 * §16.1's product metrics for one world over one window.
 *
 * Every rate carries its numerator, its denominator and its status, so a reader never has to
 * infer whether `0` means「沒有人做」or「沒有資料」. That is not a courtesy — the report is the
 * only place the difference exists, because both cases produce the same absence of rows.
 */
export const getProductAnalyticsMetrics = query({
  args: {
    ...credentialArgs,
    worldId: v.string(),
    /** Inclusive window end. Defaults to today. Supplied so a report is reproducible. */
    toDayIndex: v.optional(v.number()),
    windowDays: v.optional(v.number()),
  },
  returns: v.object({
    window: v.object({
      worldId: v.string(), fromDayIndex: v.number(), toDayIndex: v.number(), todayIndex: v.number(),
    }),
    product: v.array(observationValidator),
    dynamic: v.array(observationValidator),
    counts: v.array(v.object({
      key: v.string(), label: v.string(), value: v.number(), status: v.string(),
    })),
    coverage: v.object({
      sessions: v.number(), firstSessions: v.number(), viewers: v.number(), events: v.number(),
      droppedEvents: v.number(), sessionsWithDroppedEvents: v.number(),
    }),
    scanLimitReached: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireOperator(ctx, 'schedule.inspect', args);

    const todayIndex = dayIndexOf(Date.now());
    const toDayIndex = args.toDayIndex ?? todayIndex;
    const windowDays = Math.min(
      Math.max(1, Math.floor(args.windowDays ?? DEFAULT_WINDOW_DAYS)),
      MAX_METRICS_WINDOW_DAYS,
    );
    const fromDayIndex = toDayIndex - windowDays + 1;

    const sessionRows = await ctx.db
      .query('analyticsSessions')
      .withIndex('by_world_and_day', (q) =>
        q.eq('worldId', args.worldId).gte('dayIndex', fromDayIndex).lte('dayIndex', toDayIndex))
      .take(SCAN_LIMIT + 1);
    const sessions: AnalyticsSessionRow[] = sessionRows.slice(0, SCAN_LIMIT).map((row) => ({
      worldId: row.worldId, viewerKey: row.viewerKey, sessionKey: row.sessionKey,
      dayIndex: row.dayIndex, durationMs: row.durationMs, eventCount: row.eventCount,
      droppedEventCount: row.droppedEventCount, isFirstSession: row.isFirstSession,
    }));

    const eventRows = await ctx.db
      .query('analyticsEvents')
      .withIndex('by_world_and_day', (q) =>
        q.eq('worldId', args.worldId).gte('dayIndex', fromDayIndex).lte('dayIndex', toDayIndex))
      .take(SCAN_LIMIT + 1);
    const events: AnalyticsEventRow[] = eventRows.slice(0, SCAN_LIMIT).map((row) => ({
      sessionKey: row.sessionKey, eventName: row.eventName, dayIndex: row.dayIndex,
      payload: row.payload,
    }));

    // Viewers are read by ACQUISITION day, not by activity: the retention cohort is defined by
    // when a viewer arrived, and a viewer acquired inside the window who has not come back has no
    // session in it at all. Reading them by activity would silently drop exactly the viewers a
    // retention rate is about.
    const viewerRows = await ctx.db
      .query('analyticsViewers')
      .withIndex('by_world_and_first_day', (q) =>
        q.eq('worldId', args.worldId).gte('firstDayIndex', fromDayIndex).lte('firstDayIndex', toDayIndex))
      .take(SCAN_LIMIT + 1);
    const viewers: AnalyticsViewerRow[] = viewerRows.slice(0, SCAN_LIMIT).map((row) => ({
      viewerKey: row.viewerKey,
      firstDayIndex: row.firstDayIndex,
      returnDayOffsets: row.returnDayOffsets,
      returnOffsetsTruncated: row.returnOffsetsTruncated,
    }));

    const report = computeAnalyticsMetrics(
      { worldId: args.worldId, fromDayIndex, toDayIndex, todayIndex },
      sessions, events, viewers,
    );

    return {
      window: report.window,
      // Spread into mutable arrays: Convex's `returns` validator describes the wire shape, and
      // the pure module hands back `readonly` ones so a caller cannot edit a computed report.
      product: [...report.product],
      dynamic: [...report.dynamic],
      counts: [...report.counts],
      coverage: report.coverage,
      // Every one of the three reads can truncate independently, and a report built on a
      // truncated read is not the report it claims to be — so the flag is the OR of all three
      // rather than a property of whichever happened to be checked.
      scanLimitReached: sessionRows.length > SCAN_LIMIT
        || eventRows.length > SCAN_LIMIT
        || viewerRows.length > SCAN_LIMIT,
    };
  },
});

/** Exported for the docs and the report UI: the window a default report covers, in ms. */
export const DEFAULT_METRICS_WINDOW_MS = DEFAULT_WINDOW_DAYS * MS_PER_DAY;
