/**
 * PRD 1.0 §16.1's product metrics, and the dynamic-surface rates that were never measured
 * (ART-47; closes the `client_external` gap ART-140 recorded).
 *
 * Pure module: no Convex, no clock, no randomness, no I/O. It is handed rows and returns numbers,
 * so every definition below is directly testable against a fixture — which is what §16.1 AC#5
 * asks for: correct measurement FROM FIXTURES, not achievement of real-user targets.
 *
 * ## The rule that shapes every type here: zero is not the same as nothing
 *
 * A rate whose denominator is zero has no value. Reporting it as `0%` is not a rounding choice,
 * it is a false statement, and it is the specific false statement that gets a launch diagnosed as
 * a UX failure: 「首次進站後開啟 Episode 0%」 reads as "nobody opened an Episode" when it means
 * "nobody arrived". So {@link MetricObservation.rate} is `number | null`, `status` says which, and
 * `meetsTarget` is `null` rather than `false` when there is nothing to compare.
 *
 * The same rule applies one level up. A retention cohort that has not aged far enough to answer
 * "did they come back on day 7" is EXCLUDED from the denominator and counted in `excluded` — it
 * is not a viewer who failed to return. A cohort measured the other way reports a D7 that climbs
 * for a week after every launch and is wrong the whole time.
 */

import { MS_PER_DAY, type AnalyticsEventName } from '../shared/analyticsContract';

/** Whether a target is a floor (most of §16.1) or a ceiling (§18.1's renderer error rate). */
export type TargetDirection = 'atLeast' | 'atMost';

export type MetricObservation = {
  key: string;
  /** The PRD's own name for the metric, so a report is readable beside the table it comes from. */
  label: string;
  numerator: number;
  denominator: number;
  /** `null` exactly when `denominator === 0`. Never `0` in that case. */
  rate: number | null;
  status: 'measured' | 'no_observations';
  target: number | null;
  direction: TargetDirection;
  /** `null` when the metric was not measured. A missing measurement is not a missed target. */
  meetsTarget: boolean | null;
  /**
   * Observations deliberately left out of the denominator, and why.
   *
   * Non-zero for the retention metrics, whose cohorts must have aged past the window before they
   * can answer it, and for viewers whose recorded return offsets were truncated. Published rather
   * than absorbed: a D7 computed over a third of the cohort is a different number from one
   * computed over all of it, and there is no way to see that from the rate alone.
   */
  excluded: number;
  excludedReason: string | null;
};

/** A count rather than a rate — 「有多少人在看」 has no denominator. */
export type MetricCount = {
  key: string;
  label: string;
  value: number;
  status: 'measured' | 'no_observations';
};

export type AnalyticsSessionRow = {
  worldId: string;
  viewerKey: string;
  sessionKey: string;
  dayIndex: number;
  durationMs: number;
  eventCount: number;
  droppedEventCount: number;
  isFirstSession: boolean;
};

export type AnalyticsEventRow = {
  sessionKey: string;
  eventName: string;
  dayIndex: number;
  payload: Readonly<Record<string, string | number | boolean | undefined>>;
};

export type AnalyticsViewerRow = {
  viewerKey: string;
  firstDayIndex: number;
  returnDayOffsets: readonly number[];
  returnOffsetsTruncated: boolean;
};

export type MetricsWindow = {
  worldId: string;
  fromDayIndex: number;
  toDayIndex: number;
  /** The UTC day the report is being produced on. What decides whether a cohort has matured. */
  todayIndex: number;
};

export type AnalyticsMetricsReport = {
  window: MetricsWindow;
  /** §16.1's eight, in the order the PRD tables them. */
  product: readonly MetricObservation[];
  /** The dynamic-surface rates `docs/dynamic-view-observability.md` listed as unmeasured. */
  dynamic: readonly MetricObservation[];
  counts: readonly MetricCount[];
  /**
   * Coverage of the measurement itself, so a rate is never read without knowing what fed it.
   *
   * `droppedEvents` is the number the CLIENT admitted throwing away. A report whose sessions
   * dropped events is measuring less than it looks like it is measuring, and this is the only
   * place that fact survives.
   */
  coverage: {
    sessions: number;
    firstSessions: number;
    viewers: number;
    events: number;
    droppedEvents: number;
    sessionsWithDroppedEvents: number;
  };
};

/** §16.1's 停留超過三分鐘. */
export const THREE_MINUTES_MS = 3 * 60 * 1000;

/** §16.1's two return windows, as day offsets from a viewer's acquisition day. */
export const NEXT_DAY_OFFSET = 1;
export const SEVEN_DAY_OFFSET = 7;

function observe(
  key: string,
  label: string,
  numerator: number,
  denominator: number,
  target: number | null,
  direction: TargetDirection = 'atLeast',
  excluded = 0,
  excludedReason: string | null = null,
): MetricObservation {
  // The one branch this whole module is organised around.
  const measured = denominator > 0;
  const rate = measured ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
  return {
    key, label, numerator, denominator, rate,
    status: measured ? 'measured' : 'no_observations',
    target, direction,
    meetsTarget: rate === null || target === null
      ? null
      : (direction === 'atLeast' ? rate >= target : rate <= target),
    excluded, excludedReason,
  };
}

/** Session keys that carry at least one event satisfying `matches`. */
function sessionsWith(
  events: readonly AnalyticsEventRow[],
  matches: (event: AnalyticsEventRow) => boolean,
): Set<string> {
  const keys = new Set<string>();
  for (const event of events) if (matches(event)) keys.add(event.sessionKey);
  return keys;
}

const named = (...names: AnalyticsEventName[]) =>
  (event: AnalyticsEventRow): boolean => (names as readonly string[]).includes(event.eventName);

/**
 * Retention for one window offset.
 *
 * The cohort is viewers ACQUIRED inside the reporting window. Maturity is checked per viewer
 * rather than per window: a report covering seven days contains cohorts of seven different ages,
 * and one maturity test for the whole window would either discard six usable cohorts or count six
 * unfinished ones as failures.
 */
function retention(
  key: string,
  label: string,
  viewers: readonly AnalyticsViewerRow[],
  window: MetricsWindow,
  offset: number,
  target: number,
): MetricObservation {
  const cohort = viewers.filter(
    (viewer) => viewer.firstDayIndex >= window.fromDayIndex && viewer.firstDayIndex <= window.toDayIndex,
  );
  let denominator = 0;
  let numerator = 0;
  let excluded = 0;
  for (const viewer of cohort) {
    // Not yet answerable. `firstDayIndex + offset` is the day the question is ABOUT, so a cohort
    // acquired today cannot be asked about tomorrow.
    if (viewer.firstDayIndex + offset > window.todayIndex) {
      excluded += 1;
      continue;
    }
    // A row that stopped recording offsets cannot answer either, and counting it as a non-return
    // would report a heavy returner as churn — the exact inversion of what it is.
    if (viewer.returnOffsetsTruncated && !viewer.returnDayOffsets.includes(offset)) {
      excluded += 1;
      continue;
    }
    denominator += 1;
    if (viewer.returnDayOffsets.includes(offset)) numerator += 1;
  }
  return observe(
    key, label, numerator, denominator, target, 'atLeast', excluded,
    excluded === 0 ? null : 'cohort has not matured past the window, or its offsets were truncated',
  );
}

export function computeAnalyticsMetrics(
  window: MetricsWindow,
  sessions: readonly AnalyticsSessionRow[],
  events: readonly AnalyticsEventRow[],
  viewers: readonly AnalyticsViewerRow[],
): AnalyticsMetricsReport {
  const firstSessions = sessions.filter((session) => session.isFirstSession);
  const firstSessionKeys = new Set(firstSessions.map((session) => session.sessionKey));

  const episodeOpened = sessionsWith(events, named('episode_viewed', 'recommended_episode_opened'));
  const primerExpanded = sessionsWith(events, named('current_situation_expanded'));
  const recommendedOpened = sessionsWith(events, named('recommended_episode_opened'));
  const voted = sessionsWith(events, named('vote_submitted'));
  // An UNFOLLOW is not a follow. `followed` is in the subject, so both survive deduplication and
  // a metric that counted the event name alone would report a viewer who tried following and
  // changed their mind as a follower.
  const followed = sessionsWith(
    events,
    (event) => named('character_followed', 'story_arc_followed')(event) && event.payload.followed === true,
  );

  const liveOpened = sessionsWith(events, named('live_view_opened'));
  const mapFailed = sessionsWith(events, named('live_map_failed'));
  const fallbackUsed = sessionsWith(events, named('live_fallback_used'));
  const replayStarted = sessionsWith(events, named('live_replay_started'));
  const replayCompleted = sessionsWith(events, named('live_replay_completed'));
  const replaySkipped = sessionsWith(events, named('live_replay_skipped'));
  const liveInteracted = sessionsWith(events, named(
    'live_character_selected', 'live_scene_selected', 'live_arc_opened', 'live_episode_opened',
  ));

  const inFirstSessions = (keys: Set<string>) =>
    firstSessions.filter((session) => keys.has(session.sessionKey)).length;

  const product: MetricObservation[] = [
    observe(
      'first_session_episode_open', '首次進站後開啟 Episode',
      inFirstSessions(episodeOpened), firstSessions.length, 0.4,
    ),
    observe(
      'first_session_over_three_minutes', '首次進站停留超過 3 分鐘',
      firstSessions.filter((session) => session.durationMs > THREE_MINUTES_MS).length,
      firstSessions.length, 0.3,
    ),
    retention('next_day_return', '次日回訪率', viewers, window, NEXT_DAY_OFFSET, 0.15),
    retention('seven_day_return', '七日回訪率', viewers, window, SEVEN_DAY_OFFSET, 0.08),
    observe('vote_participation', '投票參與率', voted.size, sessions.length, 0.1),
    observe('follow_character_or_arc', '追蹤角色或 Arc', followed.size, sessions.length, 0.08),
    observe('primer_expansion', '三分鐘前情展開率', primerExpanded.size, sessions.length, 0.2),
    observe(
      'recommended_entry_click', '推薦入坑 Episode 點擊率',
      recommendedOpened.size, sessions.length, 0.2,
    ),
  ];

  const dynamic: MetricObservation[] = [
    // PRD 2.0 §18.1 sets this one as a CEILING, so its direction is inverted. A metric table
    // whose every row read「越高越好」would report a 40% renderer error rate as a triumph.
    observe(
      'renderer_error_rate', '動態 Renderer Error Rate',
      mapFailed.size, liveOpened.size, 0.02, 'atMost',
    ),
    observe('fallback_usage_rate', '降級使用率', fallbackUsed.size, liveOpened.size, null),
    observe('replay_play_rate', 'Replay 播放率', replayStarted.size, liveOpened.size, null),
    // Denominator is STARTS, not opens: a skip rate over views would answer a different question
    // and would fall whenever fewer replays played.
    observe('replay_skip_rate', 'Replay 略過率', replaySkipped.size, replayStarted.size, null),
    observe(
      'replay_completion_rate', 'Replay 完成率', replayCompleted.size, replayStarted.size, null,
    ),
    observe(
      'live_interaction_rate', 'Live 互動點擊率', liveInteracted.size, liveOpened.size, null,
    ),
  ];

  const droppedEvents = sessions.reduce((total, session) => total + session.droppedEventCount, 0);

  return {
    window,
    product,
    dynamic,
    counts: [
      {
        // 「同時在線」 is not derivable from an event stream without a heartbeat, and inventing
        // one would widen tracking for a number nobody set a target for. This is the honest
        // measurement the §15 events support: distinct viewers who opened the live view inside
        // the window. `docs/product-analytics.md` §6 states the difference.
        key: 'active_live_viewers',
        label: 'Live View 活躍觀眾（區間內不重複）',
        value: new Set(
          sessions.filter((session) => liveOpened.has(session.sessionKey))
            .map((session) => session.viewerKey),
        ).size,
        status: liveOpened.size === 0 ? 'no_observations' : 'measured',
      },
      {
        key: 'active_viewers',
        label: '活躍觀眾（區間內不重複）',
        value: new Set(sessions.map((session) => session.viewerKey)).size,
        status: sessions.length === 0 ? 'no_observations' : 'measured',
      },
    ],
    coverage: {
      sessions: sessions.length,
      firstSessions: firstSessionKeys.size,
      viewers: new Set(sessions.map((session) => session.viewerKey)).size,
      events: events.length,
      droppedEvents,
      sessionsWithDroppedEvents: sessions.filter((session) => session.droppedEventCount > 0).length,
    },
  };
}

/**
 * The widest window one report may cover.
 *
 * The read is index-scoped to `(world, day)` and therefore bounded by the window itself, so the
 * bound on the window IS the bound on the read — the house rule against an unbounded scan applied
 * where it actually binds.
 */
export const MAX_METRICS_WINDOW_DAYS = 92;

export const windowDaysOf = (fromMs: number, toMs: number): number =>
  Math.floor((toMs - fromMs) / MS_PER_DAY) + 1;
