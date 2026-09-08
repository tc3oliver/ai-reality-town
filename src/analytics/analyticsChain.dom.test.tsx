/**
 * The whole chain, end to end, with nothing stubbed but the network (§15 / ART-47).
 *
 * ## What this exists to catch
 *
 * Every other suite in this task tests one link. That is exactly the shape of defect ART-159,
 * ART-163 and ART-164 each turned out to be: a capability fully implemented, fully unit-tested,
 * registered — and called by nothing. A sanitiser that is never reached, a queue nothing feeds, a
 * metric with no rows behind it all pass their own tests and produce no analytics at all.
 *
 * So this drives the REAL shipped components with REAL DOM events, through the REAL emitter, the
 * REAL sanitiser, the REAL queue and the REAL transport, takes the envelopes that come out and
 * feeds those exact objects to the REAL ingest decision layer and the REAL metric computation.
 * Nothing is hand-written between the click and the number.
 *
 * ## The two links it does NOT cover, stated rather than left to be discovered
 *
 *  - **The browser.** jsdom is not a browser. `e2e/dynamicView.spec.ts`'s ART-47 block drives
 *    Chromium and Pixel 5 and reads the real transport's arguments back off the page.
 *  - **`recordAnalyticsEvents`'s row access.** A Convex handler body needs a deployment and never
 *    executes under jest. Everything it DECIDES is delegated to `prepareAnalyticsBatch`,
 *    `foldSession` and `foldViewer`, which are exercised here; what remains unexercised is
 *    `ctx.db.insert` and `ctx.db.patch`. That is a limitation of this repo's test strategy, not
 *    of this task, and it is why the fault-injection log records which injections cannot redden.
 */

import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { EpisodeDetailView, type EpisodeProjection } from '../components/public/EpisodeDetail';
import { resetAnalyticsSink, setAnalyticsSink } from './analyticsSink';
import { createAnalyticsTransport, FLUSH_DELAY_MS, type AnalyticsSendRequest } from '../components/analytics/transportCore';
import {
  emitCharacterFollowed,
  emitCurrentSituationExpanded,
  emitHomeViewed,
  emitRecommendedEpisodeOpened,
  emitTimelineFiltered,
  emitVoteSubmitted,
} from './productEvents';
import {
  foldSession,
  foldViewer,
  prepareAnalyticsBatch,
  type SessionAggregate,
  type ViewerAggregate,
} from '../../convex/analytics/ingest';
import {
  computeAnalyticsMetrics,
  type AnalyticsEventRow,
  type AnalyticsSessionRow,
} from '../../convex/analytics/metrics';
import { dayIndexOf } from '../../convex/shared/analyticsContract';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const WORLD_ID = 'mistwood';
const DEVICE = 'device-token-aaaaaaaa';
const SESSION = 'session-token-bbbbbbbb';
const NOW = 1_760_000_000_000;

function episodeProjection(): EpisodeProjection {
  return {
    episodeNumber: 5,
    worldDay: 4,
    title: '帳目之爭',
    headline: '趙明要求公開審計。',
    oneLineSummary: '磨坊的帳目被攤在鎮民面前。',
    keyScenes: [
      { title: '帳房對質', summary: '兩人在帳房前對質。', sourceEventIds: ['mistwood#event#74'] },
    ],
    relationshipChanges: [{ summary: '何俊與趙明關係惡化。', sourceEventId: 'mistwood#event#74' }],
    newQuestions: ['審計會揭露什麼?'],
    resolvedQuestions: ['磨坊為何停工?'],
    arcIds: ['arc:mistwood:50'],
    characterIds: ['he-jun', 'zhao-ming'],
    nextEpisodeTease: '審計的結果即將公開。',
  } as EpisodeProjection;
}

/** The real transport, wired to a recorder instead of a deployment. */
function installTransport() {
  const sent: AnalyticsSendRequest[] = [];
  let now = NOW;
  const timers: Array<{ at: number; run: () => void }> = [];
  const transport = createAnalyticsTransport(
    { deviceKey: DEVICE, sessionToken: SESSION },
    {
      now: () => now,
      send: (request) => {
        sent.push(request);
        return Promise.resolve({});
      },
      schedule: (delayMs, run) => {
        const timer = { at: now + delayMs, run };
        timers.push(timer);
        return () => {
          const index = timers.indexOf(timer);
          if (index >= 0) timers.splice(index, 1);
        };
      },
    },
  );
  setAnalyticsSink((event) => transport.accept(event));
  return {
    sent,
    advance: async (ms: number) => {
      now += ms;
      const due = timers.filter((timer) => timer.at <= now);
      for (const timer of due) timers.splice(timers.indexOf(timer), 1);
      for (const timer of due) timer.run();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetAnalyticsSink();
});

describe('a real click reaches a real envelope', () => {
  test('opening an Episode and copying its link produces exactly two sanitised envelopes', async () => {
    const { sent, advance } = installTransport();
    act(() => {
      root.render(
        <EpisodeDetailView worldId={WORLD_ID} worldDay={4} episode={episodeProjection()} />,
      );
    });

    // The share control, found by its rendered text rather than by a test id: a button nobody can
    // find is a button nobody presses, and the metric would be zero for a reason no test saw.
    const share = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('複製這一集的連結'));
    expect(share).toBeDefined();
    act(() => {
      share!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // The Episode open itself comes from the page's effect, which only the data-fetching export
    // runs; here it is emitted directly, which is the same call the effect makes.
    emitHomeViewed(WORLD_ID);

    await act(async () => { await advance(FLUSH_DELAY_MS); });

    expect(sent).toHaveLength(1);
    expect(sent[0].worldId).toBe(WORLD_ID);
    expect(sent[0].events.map((event) => event.name).sort()).toEqual(['home_viewed', 'share_action']);
    // The envelope carries the world, the surface and the share target — and nothing else. Not
    // the headline, not the title, not the summary, all of which were in scope at the call site.
    const shareEnvelope = sent[0].events.find((event) => event.name === 'share_action')!;
    expect(shareEnvelope.payload).toEqual({
      worldId: WORLD_ID, surface: 'episode', shareTarget: 'link',
    });
    expect(JSON.stringify(sent[0])).not.toContain('帳目之爭');
    expect(JSON.stringify(sent[0])).not.toContain('趙明要求公開審計');
    // And the raw tokens are on the batch, not in any payload — one place, digested server-side.
    expect(sent[0].deviceKey).toBe(DEVICE);
    for (const envelope of sent[0].events) {
      expect(Object.keys(envelope.payload)).not.toContain('deviceKey');
    }
  });

  test('pressing the same control twice sends one measurement', async () => {
    const { sent, advance } = installTransport();
    act(() => {
      root.render(
        <EpisodeDetailView worldId={WORLD_ID} worldDay={4} episode={episodeProjection()} />,
      );
    });
    const share = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('複製這一集的連結'))!;
    act(() => {
      // A viewer double-tapping, which is the ordinary case rather than an exotic one.
      share.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      share.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      share.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => { await advance(FLUSH_DELAY_MS); });
    expect(sent[0].events.filter((event) => event.name === 'share_action')).toHaveLength(1);
  });

  test('a re-rendered page does not re-report its view', async () => {
    const { sent, advance } = installTransport();
    // What an effect depending on a settling `useQuery` actually does: run again each time the
    // query resolves. Three renders, one visit.
    for (let render = 0; render < 3; render += 1) emitHomeViewed(WORLD_ID);
    await act(async () => { await advance(FLUSH_DELAY_MS); });
    expect(sent[0].events.filter((event) => event.name === 'home_viewed')).toHaveLength(1);
  });
});

describe('those exact envelopes produce the §16.1 numbers', () => {
  /**
   * Replay a captured batch through the ingest, then compute metrics over what it stored.
   *
   * This is the join. The envelopes are not re-typed: the objects the transport produced are the
   * objects handed to `prepareAnalyticsBatch`, so a payload the transport stopped sending, or one
   * the ingest stopped accepting, breaks the chain here rather than in a suite that made up its
   * own input.
   */
  function ingest(batches: readonly AnalyticsSendRequest[], now = NOW, reportNow = NOW) {
    const events: AnalyticsEventRow[] = [];
    const sessions = new Map<string, SessionAggregate>();
    const viewers = new Map<string, ViewerAggregate>();
    const seenKeys = new Set<string>();

    for (const batch of batches) {
      const outcome = prepareAnalyticsBatch(
        {
          worldId: batch.worldId,
          deviceKey: batch.deviceKey,
          sessionToken: batch.sessionToken,
          events: batch.events,
          droppedEventCount: batch.droppedEventCount,
          now,
        },
        0,
      );
      const prepared = outcome.prepared;
      if (prepared === null) continue;
      for (const measurement of prepared.measurements) {
        // The unique index, as the handler resolves it.
        if (seenKeys.has(measurement.dedupeKey)) continue;
        seenKeys.add(measurement.dedupeKey);
        events.push({
          sessionKey: prepared.sessionKey,
          eventName: measurement.eventName,
          dayIndex: prepared.dayIndex,
          payload: measurement.payload,
        });
      }
      const existingSession = sessions.get(prepared.sessionKey) ?? null;
      const existingViewer = viewers.get(prepared.viewerKey) ?? null;
      if (existingSession === null) {
        sessions.set(prepared.sessionKey, {
          ...foldSession(null, prepared, now),
          isFirstSession: existingViewer === null,
        });
        viewers.set(
          prepared.viewerKey,
          foldViewer(existingViewer, prepared.worldId, prepared.viewerKey, prepared.dayIndex),
        );
      } else {
        sessions.set(prepared.sessionKey, foldSession(existingSession, prepared, now));
      }
    }
    const sessionRows: AnalyticsSessionRow[] = [...sessions.values()];
    // The window ends TODAY even when the visit was ingested days ago. Deriving `todayIndex`
    // from the ingest clock instead would make every cohort permanently immature — the report
    // would be asking 「他們明天回來了嗎」 on the day they arrived, forever.
    const dayIndex = dayIndexOf(reportNow);
    return computeAnalyticsMetrics(
      { worldId: WORLD_ID, fromDayIndex: dayIndex - 29, toDayIndex: dayIndex, todayIndex: dayIndex },
      sessionRows,
      events,
      [...viewers.values()].map((row) => ({
        viewerKey: row.viewerKey,
        firstDayIndex: row.firstDayIndex,
        returnDayOffsets: row.returnDayOffsets,
        returnOffsetsTruncated: row.returnOffsetsTruncated,
      })),
    );
  }

  test('one visitor who does everything reports 100% on every first-visit rate', async () => {
    const { sent, advance } = installTransport();
    // Every §16.1 numerator, emitted through the same helpers the pages call.
    emitHomeViewed(WORLD_ID);
    emitCurrentSituationExpanded(WORLD_ID);
    emitRecommendedEpisodeOpened(WORLD_ID, 4, 0);
    emitVoteSubmitted(WORLD_ID, 4);
    emitCharacterFollowed(WORLD_ID, 'he-jun', true);
    emitTimelineFiltered(WORLD_ID, 'arc');
    await act(async () => { await advance(FLUSH_DELAY_MS); });

    const report = ingest(sent);
    const rate = (key: string) => report.product.find((metric) => metric.key === key)!;
    expect(rate('first_session_episode_open').rate).toBe(1);
    expect(rate('primer_expansion').rate).toBe(1);
    expect(rate('recommended_entry_click').rate).toBe(1);
    expect(rate('vote_participation').rate).toBe(1);
    expect(rate('follow_character_or_arc').rate).toBe(1);
    expect(report.coverage.sessions).toBe(1);
    expect(report.coverage.firstSessions).toBe(1);
    // Retention has nothing to say about a viewer acquired today, and says so rather than
    // reporting a viewer who has not had the chance to return as one who did not.
    expect(rate('next_day_return').status).toBe('no_observations');
    expect(rate('next_day_return').excluded).toBe(1);
  });

  test('replaying the whole capture twice changes not one number', async () => {
    // The property a lost response depends on. Every rate, every count and every coverage figure
    // must be identical, because the second delivery describes the same interactions.
    const { sent, advance } = installTransport();
    emitHomeViewed(WORLD_ID);
    emitVoteSubmitted(WORLD_ID, 4);
    await act(async () => { await advance(FLUSH_DELAY_MS); });

    const once = ingest(sent);
    const twice = ingest([...sent, ...sent, ...sent]);
    expect(twice).toEqual(once);
    expect(once.product.find((metric) => metric.key === 'vote_participation')!.numerator).toBe(1);
  });

  test('a viewer who never came back is a measured zero, not a missing rate', async () => {
    const { sent, advance } = installTransport();
    emitHomeViewed(WORLD_ID);
    await act(async () => { await advance(FLUSH_DELAY_MS); });
    // Ingested as if the visit had happened two days ago, and reported today — so the D1 window
    // has matured and the viewer's silence is an ANSWER rather than an absence of one.
    const report = ingest(sent, NOW - 2 * 86_400_000, NOW);
    const nextDay = report.product.find((metric) => metric.key === 'next_day_return')!;
    expect(nextDay.status).toBe('measured');
    expect(nextDay.rate).toBe(0);
    expect(nextDay.meetsTarget).toBe(false);
  });
});
