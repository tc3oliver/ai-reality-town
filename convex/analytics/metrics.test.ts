/**
 * §16.1's product metrics, computed from fixtures (ART-47 AC#5).
 *
 * AC#5 says the task is done when the MEASUREMENT is correct, not when real users hit the targets.
 * So every number below is produced from a hand-built world whose answer is known by construction,
 * and the assertions are about arithmetic and about definitions — which of the eight rates is
 * scoped to a first visit, which denominator each divides by, and what happens when there is
 * nothing to divide.
 *
 * The last of those is the one this suite spends most of its length on, because it is the failure
 * that survives review: a rate with a zero denominator reported as `0%` is not a rounding choice,
 * it is a false statement, and it is the specific false statement that gets a launch diagnosed as
 * a UX problem. 「首次進站後開啟 Episode 0%」 reads as "nobody opened an Episode" and means
 * "nobody arrived".
 */

import {
  NEXT_DAY_OFFSET,
  SEVEN_DAY_OFFSET,
  THREE_MINUTES_MS,
  computeAnalyticsMetrics,
  type AnalyticsEventRow,
  type AnalyticsSessionRow,
  type AnalyticsViewerRow,
  type MetricObservation,
  type MetricsWindow,
} from './metrics';

const TODAY = 20_000;
const WINDOW: MetricsWindow = {
  worldId: 'mistwood', fromDayIndex: TODAY - 29, toDayIndex: TODAY, todayIndex: TODAY,
};

const session = (
  sessionKey: string,
  overrides: Partial<AnalyticsSessionRow> = {},
): AnalyticsSessionRow => ({
  worldId: 'mistwood',
  viewerKey: `device:${sessionKey}`,
  sessionKey,
  dayIndex: TODAY,
  durationMs: 10_000,
  eventCount: 1,
  droppedEventCount: 0,
  isFirstSession: true,
  ...overrides,
});

const row = (
  sessionKey: string,
  eventName: string,
  payload: AnalyticsEventRow['payload'] = {},
): AnalyticsEventRow => ({ sessionKey, eventName, dayIndex: TODAY, payload });

const viewer = (
  viewerKey: string,
  firstDayIndex: number,
  returnDayOffsets: number[] = [],
  returnOffsetsTruncated = false,
): AnalyticsViewerRow => ({ viewerKey, firstDayIndex, returnDayOffsets, returnOffsetsTruncated });

const find = (report: { product: readonly MetricObservation[]; dynamic: readonly MetricObservation[] }, key: string) =>
  [...report.product, ...report.dynamic].find((metric) => metric.key === key)!;

describe('a zero denominator is never reported as zero', () => {
  test('an empty world reports every rate as no_observations, and no target as missed', () => {
    const report = computeAnalyticsMetrics(WINDOW, [], [], []);
    for (const metric of [...report.product, ...report.dynamic]) {
      expect(metric.status).toBe('no_observations');
      expect(metric.rate).toBeNull();
      // A metric nobody could measure has not missed its target. `false` here is what turns an
      // empty launch day into eight red rows and a wrong diagnosis.
      expect(metric.meetsTarget).toBeNull();
      expect(metric.denominator).toBe(0);
    }
    for (const count of report.counts) {
      expect(count.status).toBe('no_observations');
      expect(count.value).toBe(0);
    }
  });

  test('a REAL zero is distinguishable from an absent one', () => {
    // The discriminating half. A hundred viewers who genuinely opened no Episode must report
    // `0`, `measured`, and a MISSED target — otherwise the treatment above would be a way to
    // hide a real failure behind an honest-sounding status.
    const sessions = Array.from({ length: 100 }, (_, index) => session(`s${index}`));
    const report = computeAnalyticsMetrics(WINDOW, sessions, [], []);
    const open = find(report, 'first_session_episode_open');
    expect(open.rate).toBe(0);
    expect(open.status).toBe('measured');
    expect(open.meetsTarget).toBe(false);
    expect(open.denominator).toBe(100);
  });

  test('the difference survives into the count metrics too', () => {
    const report = computeAnalyticsMetrics(WINDOW, [session('s1')], [row('s1', 'home_viewed')], []);
    // Sessions exist, so the viewer count is measured — but nobody opened the live view, so the
    // live-viewer count has no observations rather than a zero.
    expect(report.counts.find((count) => count.key === 'active_viewers')!.status).toBe('measured');
    expect(report.counts.find((count) => count.key === 'active_live_viewers')!.status)
      .toBe('no_observations');
  });
});

describe('the eight §16.1 rates, against the PRD targets', () => {
  test('the report carries exactly the eight the PRD tables, with their targets', () => {
    const report = computeAnalyticsMetrics(WINDOW, [], [], []);
    expect(report.product.map((metric) => [metric.key, metric.target])).toEqual([
      ['first_session_episode_open', 0.4],
      ['first_session_over_three_minutes', 0.3],
      ['next_day_return', 0.15],
      ['seven_day_return', 0.08],
      ['vote_participation', 0.1],
      ['follow_character_or_arc', 0.08],
      ['primer_expansion', 0.2],
      ['recommended_entry_click', 0.2],
    ]);
  });

  test('the Episode open rate is scoped to FIRST sessions, and counts either route in', () => {
    const sessions = [
      session('first-a'), session('first-b'), session('first-c'), session('first-d'),
      // A returning visit. It is not part of the「首次進站」denominator and must not dilute it.
      session('return-a', { isFirstSession: false, viewerKey: 'device:first-a' }),
    ];
    const events = [
      row('first-a', 'episode_viewed', { worldDay: 7 }),
      // Opening the recommended entry counts as opening an Episode: it IS one, and a viewer who
      // took the product's own suggestion is the case the metric most wants to see.
      row('first-b', 'recommended_episode_opened', { worldDay: 3 }),
      // In a returning session, so it belongs to no first-session numerator.
      row('return-a', 'episode_viewed', { worldDay: 9 }),
    ];
    const open = find(computeAnalyticsMetrics(WINDOW, sessions, events, []), 'first_session_episode_open');
    expect(open.numerator).toBe(2);
    expect(open.denominator).toBe(4);
    expect(open.rate).toBe(0.5);
    expect(open.meetsTarget).toBe(true);
  });

  test('the three-minute rate is a strict threshold on the first visit', () => {
    const sessions = [
      session('a', { durationMs: THREE_MINUTES_MS + 1 }),
      // Exactly three minutes is NOT 「超過 3 分鐘」. Stated as a test because an inclusive
      // comparison here would be invisible and would move the rate at every boundary session.
      session('b', { durationMs: THREE_MINUTES_MS }),
      session('c', { durationMs: 1_000 }),
      session('d', { durationMs: THREE_MINUTES_MS * 10, isFirstSession: false }),
    ];
    const dwell = find(computeAnalyticsMetrics(WINDOW, sessions, [], []), 'first_session_over_three_minutes');
    expect(dwell.numerator).toBe(1);
    expect(dwell.denominator).toBe(3);
  });

  test('participation, follow, primer and recommendation divide by ALL sessions', () => {
    // Not by first sessions: §16.1 scopes only the first two rates to 首次進站, and applying that
    // scope to the rest would silently exclude every returning viewer — the people most likely to
    // vote and to follow.
    const sessions = [session('a'), session('b', { isFirstSession: false }), session('c', { isFirstSession: false })];
    const events = [
      row('b', 'vote_submitted', { worldDay: 4 }),
      row('b', 'character_followed', { characterId: 'he-jun', followed: true }),
      row('c', 'current_situation_expanded'),
      row('c', 'recommended_episode_opened', { worldDay: 3 }),
    ];
    const report = computeAnalyticsMetrics(WINDOW, sessions, events, []);
    for (const key of ['vote_participation', 'follow_character_or_arc', 'primer_expansion', 'recommended_entry_click']) {
      expect([key, find(report, key).denominator]).toEqual([key, 3]);
      expect([key, find(report, key).numerator]).toEqual([key, 1]);
    }
  });

  test('an UNFOLLOW is not a follow', () => {
    // `followed` is part of the event's subject, so both survive deduplication and both reach the
    // metric. Counting the event NAME would report a viewer who tried following and changed their
    // mind as a follower — and 追蹤角色或 Arc is a statement about people who follow something.
    const sessions = [session('a'), session('b')];
    const events = [
      row('a', 'character_followed', { characterId: 'he-jun', followed: false }),
      row('b', 'story_arc_followed', { arcId: 'arc-1', followed: true }),
    ];
    const follow = find(computeAnalyticsMetrics(WINDOW, sessions, events, []), 'follow_character_or_arc');
    expect(follow.numerator).toBe(1);
    expect(follow.denominator).toBe(2);
  });

  test('a session that emitted one event twice still counts once', () => {
    // Defence in depth. Dedup happens at the client and again at the ingest, so a duplicate row
    // should not exist — and if one ever did, a rate must not double. The metric counts distinct
    // SESSIONS, which makes that structural rather than a third dedup.
    const events = [row('a', 'vote_submitted', { worldDay: 1 }), row('a', 'vote_submitted', { worldDay: 1 })];
    const vote = find(computeAnalyticsMetrics(WINDOW, [session('a')], events, []), 'vote_participation');
    expect(vote.numerator).toBe(1);
  });
});

describe('retention, and the cohorts that cannot answer yet', () => {
  test('D1 and D7 are the day EXACTLY one and seven after acquisition', () => {
    const viewers = [
      viewer('v1', TODAY - 10, [1, 7]),
      viewer('v2', TODAY - 10, [1]),
      // Returned on day 6 and day 8, which is neither window. 「七日回訪」 is a bucket, not a
      // cumulative "came back at some point in a week" — the second is a different metric with a
      // much higher value, and reporting it under this name would overstate retention.
      viewer('v3', TODAY - 10, [6, 8]),
      viewer('v4', TODAY - 10, []),
    ];
    const report = computeAnalyticsMetrics(WINDOW, [], [], viewers);
    expect(find(report, 'next_day_return').numerator).toBe(2);
    expect(find(report, 'next_day_return').denominator).toBe(4);
    expect(find(report, 'seven_day_return').numerator).toBe(1);
    expect(find(report, 'seven_day_return').denominator).toBe(4);
  });

  test('an immature cohort is EXCLUDED, not counted as a non-return', () => {
    // The failure this prevents: a D7 that climbs for a week after every launch and is wrong the
    // whole time, because a viewer acquired yesterday is recorded as having failed to return in
    // seven days.
    const viewers = [
      viewer('mature', TODAY - 8, [7]),
      viewer('acquired-today', TODAY, []),
      viewer('acquired-yesterday', TODAY - 1, [1]),
    ];
    const seven = find(computeAnalyticsMetrics(WINDOW, [], [], viewers), 'seven_day_return');
    expect(seven.denominator).toBe(1);
    expect(seven.numerator).toBe(1);
    expect(seven.rate).toBe(1);
    expect(seven.excluded).toBe(2);
    // Published rather than absorbed: a D7 computed over a third of the cohort is a different
    // number from one computed over all of it, and the rate alone cannot show that.
    expect(seven.excludedReason).not.toBeNull();
  });

  test('a cohort acquired exactly `offset` days ago IS mature', () => {
    // The boundary, both sides. Off by one here shifts every retention number in the product,
    // and it is invisible: the rate stays plausible either way.
    const dueToday = [viewer('v', TODAY - SEVEN_DAY_OFFSET, [SEVEN_DAY_OFFSET])];
    expect(find(computeAnalyticsMetrics(WINDOW, [], [], dueToday), 'seven_day_return').denominator).toBe(1);
    const dueTomorrow = [viewer('v', TODAY - SEVEN_DAY_OFFSET + 1, [])];
    expect(find(computeAnalyticsMetrics(WINDOW, [], [], dueTomorrow), 'seven_day_return').denominator).toBe(0);
    // And the same rule with the shorter window, so the two are not accidentally coupled.
    const d1DueToday = [viewer('v', TODAY - NEXT_DAY_OFFSET, [NEXT_DAY_OFFSET])];
    expect(find(computeAnalyticsMetrics(WINDOW, [], [], d1DueToday), 'next_day_return').denominator).toBe(1);
    expect(find(computeAnalyticsMetrics(WINDOW, [], [], [viewer('v', TODAY, [])]), 'next_day_return').denominator)
      .toBe(0);
  });

  test('a truncated viewer row is excluded rather than counted as churn', () => {
    // The row stopped recording offsets, so it cannot answer the question. Counting it as a
    // non-return would report the heaviest returners in the product as the ones who left — the
    // exact inversion of what they are.
    const viewers = [
      viewer('heavy', TODAY - 10, [1, 2, 3], true),
      viewer('ordinary', TODAY - 10, [1]),
    ];
    const seven = find(computeAnalyticsMetrics(WINDOW, [], [], viewers), 'seven_day_return');
    expect(seven.denominator).toBe(1);
    expect(seven.excluded).toBe(1);
    // A truncated row that DID record the offset can still answer, so it is not excluded blindly.
    const answerable = [viewer('heavy', TODAY - 10, [1, 7], true)];
    expect(find(computeAnalyticsMetrics(WINDOW, [], [], answerable), 'seven_day_return').denominator).toBe(1);
  });

  test('the cohort is viewers ACQUIRED in the window, not viewers active in it', () => {
    const viewers = [viewer('inside', TODAY - 5, [1]), viewer('outside', TODAY - 400, [1])];
    expect(find(computeAnalyticsMetrics(WINDOW, [], [], viewers), 'next_day_return').denominator).toBe(1);
  });
});

describe('the dynamic-surface rates observability listed as unmeasured', () => {
  const liveWorld = () => {
    const sessions = Array.from({ length: 10 }, (_, index) => session(`live-${index}`));
    const events = sessions.flatMap((current, index) => [
      row(current.sessionKey, 'live_view_opened'),
      ...(index === 0 ? [row(current.sessionKey, 'live_map_failed', { reason: 'webgl_unavailable' })] : []),
      ...(index < 2 ? [row(current.sessionKey, 'live_fallback_used', { degradationLevel: 'static' })] : []),
      ...(index < 4 ? [row(current.sessionKey, 'live_replay_started', { replayId: 'r1' })] : []),
      ...(index < 2 ? [row(current.sessionKey, 'live_replay_completed', { replayId: 'r1' })] : []),
      ...(index === 3 ? [row(current.sessionKey, 'live_replay_skipped', { replayId: 'r1' })] : []),
      ...(index < 5 ? [row(current.sessionKey, 'live_character_selected', { characterId: 'he-jun' })] : []),
    ]);
    return computeAnalyticsMetrics(WINDOW, sessions, events, []);
  };

  test('renderer error rate, fallback usage, replay play/skip/completion and live CTR all resolve', () => {
    const report = liveWorld();
    expect(find(report, 'renderer_error_rate').rate).toBe(0.1);
    expect(find(report, 'fallback_usage_rate').rate).toBe(0.2);
    expect(find(report, 'replay_play_rate').rate).toBe(0.4);
    // Skips and completions divide by STARTS, not by views: a skip rate over views would fall
    // whenever fewer replays played, which answers a different question.
    expect(find(report, 'replay_skip_rate').denominator).toBe(4);
    expect(find(report, 'replay_skip_rate').rate).toBe(0.25);
    expect(find(report, 'replay_completion_rate').rate).toBe(0.5);
    expect(find(report, 'live_interaction_rate').rate).toBe(0.5);
    expect(report.counts.find((count) => count.key === 'active_live_viewers')!.value).toBe(10);
  });

  test('the renderer error rate is a CEILING, so a high value is a miss', () => {
    // PRD 2.0 §18.1 sets it at < 2%. A metric table whose every row read 「越高越好」 would
    // report a 10% renderer error rate as a triumph.
    const errors = find(liveWorld(), 'renderer_error_rate');
    expect(errors.direction).toBe('atMost');
    expect(errors.meetsTarget).toBe(false);
    const sessions = Array.from({ length: 100 }, (_, index) => session(`live-${index}`));
    const clean = computeAnalyticsMetrics(
      WINDOW, sessions, sessions.map((current) => row(current.sessionKey, 'live_view_opened')), [],
    );
    expect(find(clean, 'renderer_error_rate').rate).toBe(0);
    expect(find(clean, 'renderer_error_rate').meetsTarget).toBe(true);
  });
});

describe('coverage travels with the report', () => {
  test('events the client admitted dropping are published, not absorbed', () => {
    // A report whose sessions dropped events is measuring less than it looks like it is
    // measuring, and this is the only place that fact survives — the missing rows leave no trace.
    const sessions = [session('a', { droppedEventCount: 12 }), session('b')];
    const report = computeAnalyticsMetrics(WINDOW, sessions, [row('a', 'home_viewed')], []);
    expect(report.coverage).toEqual({
      sessions: 2, firstSessions: 2, viewers: 2, events: 1,
      droppedEvents: 12, sessionsWithDroppedEvents: 1,
    });
  });

  test('the window it was computed over is returned with it', () => {
    // A rate is meaningless without the window. Returning it makes a stored report reproducible
    // and stops two reports over different windows from being compared as if they were the same.
    expect(computeAnalyticsMetrics(WINDOW, [], [], []).window).toEqual(WINDOW);
  });
});
