/**
 * Exactly-once logical measurement, both halves (§15 / ART-47).
 *
 * Two unrelated ways a rate gets inflated, and a fix for either does nothing about the other:
 *
 *  1. **The UI emits twice.** A re-render, a re-run effect, a double tap, a hook that retries a
 *     failed submission and succeeds. Genuinely different calls, one interaction.
 *  2. **The transport sends twice.** A batch is sent, the response is lost, the batch is re-sent.
 *     One call, two deliveries.
 *
 * This suite covers the CLIENT half of both: the queue refuses a repeated logical measurement, and
 * it re-offers the same in-flight batch rather than a fresh window over a queue that has moved on.
 * The SERVER half — deriving the same key from the same envelope and resolving it on a unique
 * index — is `convex/analytics/analyticsIngest.test.ts`. Neither substitutes for the other, and
 * the reason is here in one sentence: the client cannot know whether a lost response meant the
 * write happened, and the server cannot know that two structurally different batches described one
 * interaction.
 */

import {
  createAnalyticsQueue,
  MAX_PENDING_EVENTS,
  MAX_SESSION_DEDUPE_KEYS,
} from './analyticsQueue';
import {
  createAnalyticsTransport,
  FLUSH_DELAY_MS,
  RETRY_BASE_DELAY_MS,
  type AnalyticsSendRequest,
} from '../components/analytics/transportCore';
import { MAX_ANALYTICS_BATCH_SIZE, type AnalyticsEvent } from '../../convex/shared/analyticsContract';

const event = (name: AnalyticsEvent['name'], payload: AnalyticsEvent['payload'] = { worldId: 'mistwood' }): AnalyticsEvent =>
  ({ name, payload });

describe('the queue counts logical measurements, not calls', () => {
  test('the same measurement offered four times is queued once', () => {
    // The re-render case, which is the common one: an effect that depends on a settling query
    // runs again every time the query resolves.
    const queue = createAnalyticsQueue('session-1');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      queue.offer(event('episode_viewed', { worldId: 'mistwood', worldDay: 7 }), 100);
    }
    expect(queue.stats.pending).toBe(1);
    expect(queue.stats.deduplicated).toBe(3);
  });

  test('a different subject is a different measurement', () => {
    // The under-counting failure the subject list exists to prevent: nine Episode opens must not
    // collapse into one just because they share an event name.
    const queue = createAnalyticsQueue('session-1');
    for (const worldDay of [7, 8, 9]) {
      queue.offer(event('episode_viewed', { worldId: 'mistwood', worldDay }), 100);
    }
    expect(queue.stats.pending).toBe(3);
  });

  test('a field outside the subject does not make a second measurement', () => {
    // `freshness` is not part of `live_view_opened`'s subject and it changes while a viewer sits
    // there. Two emissions carrying different verdicts are one view — and since this is the
    // DENOMINATOR of every §18.1 rate, treating them as two deflates all of them at once.
    const queue = createAnalyticsQueue('session-1');
    queue.offer(event('live_view_opened', { worldId: 'mistwood', freshness: 'live' }), 0);
    queue.offer(event('live_view_opened', { worldId: 'mistwood', freshness: 'stale' }), 5_000);
    expect(queue.stats.pending).toBe(1);
  });

  test('following and then unfollowing is two measurements, not one', () => {
    // `followed` IS in the subject, so the reversal survives. Otherwise the second press would
    // dedupe against the first and the record would keep claiming a follow that was taken back.
    const queue = createAnalyticsQueue('session-1');
    queue.offer(event('character_followed', { worldId: 'mistwood', characterId: 'he-jun', followed: true }), 0);
    queue.offer(event('character_followed', { worldId: 'mistwood', characterId: 'he-jun', followed: false }), 1);
    expect(queue.stats.pending).toBe(2);
  });

  test('two sessions never dedupe against each other', () => {
    const first = createAnalyticsQueue('session-1');
    const second = createAnalyticsQueue('session-2');
    first.offer(event('home_viewed'), 0);
    second.offer(event('home_viewed'), 0);
    expect(first.take()!.events[0]).toEqual(second.take()!.events[0]);
    // Identical ENVELOPES — the session travels on the batch, not in the payload — and yet they
    // are distinct measurements, because the server keys them on the session it received.
    expect(first.stats.pending + second.stats.pending).toBe(0);
  });

  test('a negative or fractional elapsed time is normalised rather than transmitted', () => {
    // Derived from two clock readings at the call site, so a backwards system clock would put a
    // negative duration on the wire for the session-length metric to average in.
    const queue = createAnalyticsQueue('session-1');
    queue.offer(event('home_viewed'), -4_000);
    queue.offer(event('episode_viewed', { worldId: 'mistwood', worldDay: 1 }), 1_500.7);
    expect(queue.take()!.events.map((envelope) => envelope.sessionElapsedMs)).toEqual([0, 1501]);
  });
});

describe('a retry re-sends the SAME batch', () => {
  test('take is idempotent while a batch is in flight', () => {
    const queue = createAnalyticsQueue('session-1');
    queue.offer(event('home_viewed'), 0);
    queue.offer(event('vote_viewed', { worldId: 'mistwood', worldDay: 3 }), 0);
    const first = queue.take()!;
    queue.fail();
    const second = queue.take()!;
    // Not merely equal — the same envelopes, in the same order. A fresh window over a queue that
    // had moved on would derive different keys and the server could not recognise the repeat.
    expect(second.events).toEqual(first.events);
  });

  test('an event queued during a failed send does not jump ahead of it', () => {
    const queue = createAnalyticsQueue('session-1');
    queue.offer(event('home_viewed'), 0);
    const inFlight = queue.take()!;
    queue.offer(event('relationship_graph_opened'), 10);
    queue.fail();
    expect(queue.take()!.events).toEqual(inFlight.events);
    queue.settle();
    // Only now does the newer one go.
    expect(queue.take()!.events.map((envelope) => envelope.name)).toEqual(['relationship_graph_opened']);
  });

  test('settling releases the batch, and a settled measurement never returns', () => {
    const queue = createAnalyticsQueue('session-1');
    queue.offer(event('home_viewed'), 0);
    queue.take();
    queue.settle();
    expect(queue.take()).toBeNull();
    // Re-offering after a successful send is still a duplicate: the dedupe set is the session's,
    // not the batch's, so a viewer returning to the homepage does not count twice.
    queue.offer(event('home_viewed'), 30_000);
    expect(queue.take()).toBeNull();
  });

  test('a batch is bounded, and the remainder waits rather than being dropped', () => {
    const queue = createAnalyticsQueue('session-1');
    for (let index = 0; index < MAX_ANALYTICS_BATCH_SIZE + 5; index += 1) {
      queue.offer(event('episode_viewed', { worldId: 'mistwood', worldDay: index }), index);
    }
    expect(queue.take()!.events).toHaveLength(MAX_ANALYTICS_BATCH_SIZE);
    queue.settle();
    expect(queue.take()!.events).toHaveLength(5);
  });
});

describe('what the queue admits when it cannot keep up', () => {
  test('past the bound NEW events are dropped and the count travels with the batch', () => {
    const queue = createAnalyticsQueue('session-1');
    for (let index = 0; index < MAX_PENDING_EVENTS + 7; index += 1) {
      queue.offer(event('episode_viewed', { worldId: 'mistwood', worldDay: index }), index);
    }
    expect(queue.stats.dropped).toBe(7);
    // Truncation is never silent. The number rides on the batch, so a session that lost events is
    // readable as such — there is no way to notice it from the surviving rows.
    expect(queue.take()!.droppedEventCount).toBe(7);
  });

  test('the OLDEST events survive, because they are the ones every denominator needs', () => {
    const queue = createAnalyticsQueue('session-1');
    queue.offer(event('home_viewed'), 0);
    for (let index = 0; index < MAX_PENDING_EVENTS + 20; index += 1) {
      queue.offer(event('live_zoom_used', { worldId: 'mistwood', zoomStep: index }), index);
    }
    // Discarding `home_viewed` to make room for a viewer's fortieth zoom would lose the
    // measurement five of §16.1's eight rates divide by.
    expect(queue.take()!.events[0].name).toBe('home_viewed');
  });

  test('a dropped event is not recorded as seen, so it can still be counted later', () => {
    // Marking a dropped measurement as seen would make a momentarily-full queue erase an Episode
    // open permanently rather than delaying it.
    const queue = createAnalyticsQueue('session-1');
    for (let index = 0; index < MAX_PENDING_EVENTS; index += 1) {
      queue.offer(event('live_zoom_used', { worldId: 'mistwood', zoomStep: index }), index);
    }
    expect(queue.offer(event('vote_submitted', { worldId: 'mistwood', worldDay: 1 }), 0)).toBe(false);
    queue.take();
    queue.settle();
    expect(queue.offer(event('vote_submitted', { worldId: 'mistwood', worldDay: 1 }), 0)).toBe(true);
  });

  test('a saturated dedupe set is reported rather than silently stopping deduplication', () => {
    const queue = createAnalyticsQueue('session-1');
    for (let index = 0; index < MAX_SESSION_DEDUPE_KEYS + 1; index += 1) {
      queue.offer(event('live_zoom_used', { worldId: 'mistwood', zoomStep: index }), index);
      queue.take();
      queue.settle();
    }
    expect(queue.stats.dedupeSetSaturated).toBe(true);
  });
});

describe('the transport under a collector that fails', () => {
  /** A controllable clock and timer, so nothing here waits on wall time. */
  function harness(send: (request: AnalyticsSendRequest) => Promise<unknown>) {
    let now = 1_000;
    const timers: Array<{ at: number; run: () => void }> = [];
    const transport = createAnalyticsTransport(
      { deviceKey: 'device-aaaaaaaa', sessionToken: 'session-bbbbbbbb' },
      {
        now: () => now,
        send,
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
    return {
      transport,
      advance: async (ms: number) => {
        now += ms;
        const due = timers.filter((timer) => timer.at <= now);
        for (const timer of due) timers.splice(timers.indexOf(timer), 1);
        for (const timer of due) timer.run();
        // Let the transport's own promise chain settle before the assertion reads it.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      },
      pending: () => timers.length,
    };
  }

  test('a lost response re-sends byte-identical envelopes', async () => {
    const sent: AnalyticsSendRequest[] = [];
    let fail = true;
    const { transport, advance } = harness((request) => {
      sent.push(JSON.parse(JSON.stringify(request)) as AnalyticsSendRequest);
      return fail ? Promise.reject(new Error('collector unreachable')) : Promise.resolve({});
    });

    transport.accept(event('home_viewed'));
    await advance(FLUSH_DELAY_MS);
    expect(sent).toHaveLength(1);

    fail = false;
    await advance(RETRY_BASE_DELAY_MS);
    expect(sent).toHaveLength(2);
    // The whole point: identical, so the server derives identical keys and inserts nothing new.
    expect(sent[1]).toEqual(sent[0]);
  });

  test('a collector that never answers does not resend faster and faster', async () => {
    const attempts: number[] = [];
    const { transport, advance } = harness(() => {
      attempts.push(attempts.length);
      return Promise.reject(new Error('down'));
    });
    transport.accept(event('home_viewed'));
    await advance(FLUSH_DELAY_MS);
    expect(attempts).toHaveLength(1);
    // Backoff doubles, so the next attempt is NOT due at the base delay any more.
    await advance(RETRY_BASE_DELAY_MS);
    expect(attempts).toHaveLength(2);
    await advance(RETRY_BASE_DELAY_MS);
    expect(attempts).toHaveLength(2);
    await advance(RETRY_BASE_DELAY_MS);
    expect(attempts).toHaveLength(3);
  });

  test('a throwing collector never reaches the caller', () => {
    const { transport } = harness(() => {
      throw new Error('collector exploded synchronously');
    });
    // Analytics is the least important thing on the page. A viewer losing the live map because a
    // telemetry call failed would be a far worse defect than a missing event.
    expect(() => transport.accept(event('home_viewed'))).not.toThrow();
  });

  test('a flush during a page transition never rejects', async () => {
    const { transport, advance } = harness(() => Promise.reject(new Error('down')));
    transport.accept(event('home_viewed'));
    // An unhandled rejection in a `visibilitychange` handler is a console error a viewer can see.
    await expect(transport.flush()).resolves.toBeUndefined();
    await advance(0);
  });

  test('an event with no world is dropped rather than filed under a placeholder', async () => {
    const sent: AnalyticsSendRequest[] = [];
    const { transport, advance } = harness((request) => {
      sent.push(request);
      return Promise.resolve({});
    });
    transport.accept({ name: 'home_viewed', payload: {} });
    await advance(FLUSH_DELAY_MS);
    // Unattributable is unmeasurable. A placeholder world would put rows in a report for a world
    // that does not exist.
    expect(sent).toEqual([]);
    expect(transport.stats.worlds).toBe(0);
  });

  test('two worlds are batched separately, because a batch is submitted for one', async () => {
    const sent: AnalyticsSendRequest[] = [];
    const { transport, advance } = harness((request) => {
      sent.push(request);
      return Promise.resolve({});
    });
    transport.accept(event('home_viewed', { worldId: 'mistwood' }));
    transport.accept(event('home_viewed', { worldId: 'other-town' }));
    await advance(FLUSH_DELAY_MS);
    expect(sent.map((request) => request.worldId).sort()).toEqual(['mistwood', 'other-town']);
  });

  test('an idle page holds no timer, so watching schedules nothing', async () => {
    const { transport, advance, pending } = harness(() => Promise.resolve({}));
    expect(pending()).toBe(0);
    transport.accept(event('home_viewed'));
    expect(pending()).toBe(1);
    await advance(FLUSH_DELAY_MS);
    // Drained and gone. The flush is a debounce on the first queued event, not a repeating timer,
    // which is what keeps 「觀看不產生流量」 true for a page nobody is touching.
    expect(pending()).toBe(0);
  });

  test('a flush that falls due mid-send is remembered, not dropped', async () => {
    /**
     * The deadlock the browser gate found, pinned here where it is cheap to run.
     *
     * A send is in flight; the flush timer for the NEXT batch fires. `drain` used to return
     * immediately because `sending` was true — which also cleared `cancelTimer` on the way in, so
     * `accept` would never arm another one and everything queued afterwards sat in memory
     * forever. This holds the send open across the second flush to reproduce exactly that window.
     */
    const sent: AnalyticsSendRequest[] = [];
    let release: (() => void) | null = null;
    const { transport, advance } = harness((request) => {
      sent.push(request);
      if (sent.length > 1) return Promise.resolve({});
      return new Promise<unknown>((resolve) => { release = () => resolve({}); });
    });

    transport.accept(event('home_viewed'));
    await advance(FLUSH_DELAY_MS);
    expect(sent).toHaveLength(1);

    // Queued and flushed WHILE the first send is still open.
    transport.accept(event('relationship_graph_opened'));
    await advance(FLUSH_DELAY_MS);
    expect(sent).toHaveLength(1);

    release!();
    // Twice: the first lets the in-flight send's promise chain settle and re-arm, the second
    // runs the timer it armed. One call would read the timer list before it had been added to.
    await advance(0);
    await advance(0);
    // The remembered flush ran. Before the fix this stayed at one forever, and no later event
    // could revive it.
    expect(sent).toHaveLength(2);
    expect(sent[1].events.map((envelope) => envelope.name)).toEqual(['relationship_graph_opened']);
  });

  test('stop cancels the pending flush and refuses further events', async () => {
    const sent: AnalyticsSendRequest[] = [];
    const { transport, advance } = harness((request) => {
      sent.push(request);
      return Promise.resolve({});
    });
    transport.accept(event('home_viewed'));
    transport.stop();
    transport.accept(event('relationship_graph_opened'));
    await advance(FLUSH_DELAY_MS * 4);
    expect(sent).toEqual([]);
  });
});
