/**
 * The SERVER half of exactly-once, and the two aggregates every metric is defined over
 * (§15 / ART-47).
 *
 * The client half (`src/analytics/analyticsIdempotency.test.ts`) proves a retry re-sends identical
 * envelopes. That is necessary and not sufficient: the client cannot know whether a lost response
 * meant the write happened, so the server has to be able to receive the same batch twice and store
 * it once. This suite covers the derivation that makes that possible, and the folds that turn a
 * stream of batches into sessions and viewers.
 *
 * Pure throughout: `prepareAnalyticsBatch`, `foldSession` and `foldViewer` take rows and return
 * rows. The Convex handler that calls them is a thin adapter, and its own body is unreachable
 * under jest — it needs a deployment — which is stated here rather than left as a gap a reader
 * has to discover.
 */

import { analyticsDedupeKey, MAX_RETURN_DAY_OFFSETS } from '../shared/analyticsContract';
import {
  MAX_SESSION_DURATION_MS,
  analyticsSessionKey,
  foldSession,
  foldViewer,
  prepareAnalyticsBatch,
  type PreparedBatch,
  type SessionAggregate,
  type ViewerAggregate,
} from './ingest';

const DEVICE = 'device-token-aaaaaaaa';
const SESSION = 'session-token-bbbbbbbb';
const NOW = 1_760_000_000_000;

const prepare = (
  events: Array<{ name: string; payload: unknown; sessionElapsedMs?: number }>,
  overrides: { now?: number; droppedEventCount?: number } = {},
): PreparedBatch => {
  const outcome = prepareAnalyticsBatch(
    {
      worldId: 'mistwood', deviceKey: DEVICE, sessionToken: SESSION,
      events: events.map((event) => ({ ...event, sessionElapsedMs: event.sessionElapsedMs ?? 0 })),
      droppedEventCount: overrides.droppedEventCount ?? 0,
      now: overrides.now ?? NOW,
    },
    0,
  );
  if (outcome.prepared === null) throw new Error(`refused: ${outcome.code}`);
  return outcome.prepared;
};

describe('the dedupe key is derived, never received', () => {
  test('the same batch prepared twice yields the same keys', () => {
    // The whole mechanism. A transport that sends, loses the response and re-sends submits these
    // exact envelopes, and the handler resolves them against a unique index — so the second call
    // inserts nothing. Nothing about the ORDER of preparation enters the key.
    const first = prepare([
      { name: 'home_viewed', payload: { worldId: 'mistwood' } },
      { name: 'episode_viewed', payload: { worldId: 'mistwood', worldDay: 7 } },
    ]);
    const second = prepare([
      { name: 'home_viewed', payload: { worldId: 'mistwood' } },
      { name: 'episode_viewed', payload: { worldId: 'mistwood', worldDay: 7 } },
    ], { now: NOW + 45_000 });
    expect(second.measurements.map((m) => m.dedupeKey))
      .toEqual(first.measurements.map((m) => m.dedupeKey));
  });

  test('a caller cannot choose or influence the key beyond the declared subject', () => {
    // A caller-supplied key would let anyone suppress a measurement by claiming an existing one,
    // or inflate a rate by varying one, and neither is detectable afterwards. So the key is
    // computed from `(session, name, SANITISED payload)` — and the sanitiser has already dropped
    // everything a caller might have hoped to vary it with.
    const honest = prepare([{ name: 'home_viewed', payload: { worldId: 'mistwood' } }]);
    const forged = prepare([{
      name: 'home_viewed',
      payload: { worldId: 'mistwood', dedupeKey: 'anything-i-like', nonce: Math.PI, viewerId: 'x' },
    }]);
    expect(forged.measurements[0].dedupeKey).toBe(honest.measurements[0].dedupeKey);
    expect(honest.measurements[0].dedupeKey)
      .toBe(analyticsDedupeKey(analyticsSessionKey(DEVICE, SESSION), 'home_viewed', { worldId: 'mistwood' }));
  });

  test('a batch that repeats itself is collapsed before any write', () => {
    // The unique index is resolved once, BEFORE either insert, so two rows carrying one key would
    // both be written. Collapsing here is what closes that — and it is a real submission shape:
    // a client whose dedupe set was saturated sends exactly this.
    const prepared = prepare([
      { name: 'episode_viewed', payload: { worldId: 'mistwood', worldDay: 7 } },
      { name: 'episode_viewed', payload: { worldId: 'mistwood', worldDay: 7 } },
      { name: 'episode_viewed', payload: { worldId: 'mistwood', worldDay: 8 } },
    ]);
    expect(prepared.measurements).toHaveLength(2);
    expect(prepared.rejectedCount).toBe(1);
  });

  test('two devices presenting the same session token still get different keys', () => {
    // The session key is derived from BOTH tokens, so a session token guessed or copied from
    // somebody else does not merge two viewers' measurements into one session.
    const mine = analyticsSessionKey(DEVICE, SESSION);
    const theirs = analyticsSessionKey('device-token-cccccccc', SESSION);
    expect(mine).not.toBe(theirs);
  });
});

describe('the session fold', () => {
  const seed = (elapsed: number, dropped = 0): PreparedBatch =>
    prepare([{ name: 'home_viewed', payload: { worldId: 'mistwood' }, sessionElapsedMs: elapsed }],
      { droppedEventCount: dropped });

  test('duration is the largest CLIENT elapsed value, not server wall time', () => {
    // The two differ whenever a batch is delayed or retried, and the server-clock version would
    // credit a session with the time its own request spent queued: a viewer who closed the tab
    // and whose last batch arrived four minutes later would be recorded as having stayed four
    // minutes.
    const first = foldSession(null, seed(30_000), NOW);
    const second = foldSession(first, seed(90_000), NOW + 8 * 60_000);
    expect(second.durationMs).toBe(90_000);
    expect(second.lastSeenAt).toBe(NOW + 8 * 60_000);
  });

  test('a late batch carrying a smaller elapsed value cannot shorten a session', () => {
    const first = foldSession(null, seed(120_000), NOW);
    expect(foldSession(first, seed(5_000), NOW + 1_000).durationMs).toBe(120_000);
  });

  test('duration is clamped, because it is a claim made by a client clock', () => {
    expect(foldSession(null, seed(9e12), NOW).durationMs).toBe(MAX_SESSION_DURATION_MS);
  });

  test('the dropped count is the larger reading, not a running sum', () => {
    // The client reports a CUMULATIVE total, so adding them would count one dropped event once
    // per remaining batch and make a session look far lossier than it was.
    const first = foldSession(null, seed(0, 3), NOW);
    expect(foldSession(first, seed(0, 5), NOW + 1).droppedEventCount).toBe(5);
    expect(foldSession(first, seed(0, 5), NOW + 1).eventCount).toBe(2);
  });
});

describe('the viewer fold, which is what D1 and D7 are computed from', () => {
  const viewer = (firstDay: number): ViewerAggregate =>
    foldViewer(null, 'mistwood', 'device:x', firstDay);

  test('the acquisition day is not a return', () => {
    // Offset 0 would make every cohort's D0 100% and tempt someone into reading it as retention.
    const day0 = viewer(100);
    expect(day0.returnDayOffsets).toEqual([]);
    expect(foldViewer(day0, 'mistwood', 'device:x', 100).returnDayOffsets).toEqual([]);
  });

  test('returning on the next day and a week later records both offsets', () => {
    let row = viewer(100);
    row = foldViewer(row, 'mistwood', 'device:x', 101);
    row = foldViewer(row, 'mistwood', 'device:x', 107);
    expect(row.returnDayOffsets).toEqual([1, 7]);
    expect(row.sessionCount).toBe(3);
  });

  test('two sessions on one day are two visits and one offset', () => {
    let row = viewer(100);
    row = foldViewer(row, 'mistwood', 'device:x', 103);
    row = foldViewer(row, 'mistwood', 'device:x', 103);
    expect(row.returnDayOffsets).toEqual([3]);
    expect(row.sessionCount).toBe(3);
  });

  test('an earlier first-seen day rebases the recorded offsets rather than reinterpreting them', () => {
    // Two devices sharing a token across a clock skew can produce this. Leaving the offsets alone
    // would mean one row carrying offsets measured from two different origins, which reads as a
    // viewer who returned on day −1.
    let row = viewer(100);
    row = foldViewer(row, 'mistwood', 'device:x', 105);
    expect(row.returnDayOffsets).toEqual([5]);
    row = foldViewer(row, 'mistwood', 'device:x', 98);
    expect(row.firstDayIndex).toBe(98);
    // 100 and 105 are now 2 and 7 days after acquisition, and the arrival day itself is not one.
    expect(row.returnDayOffsets).toEqual([2, 7]);
    expect(row.returnDayOffsets.every((offset) => offset > 0)).toBe(true);
  });

  test('past the bound the row says it stopped recording rather than silently dropping', () => {
    let row = viewer(0);
    for (let day = 1; day <= MAX_RETURN_DAY_OFFSETS + 5; day += 1) {
      row = foldViewer(row, 'mistwood', 'device:x', day);
    }
    expect(row.returnDayOffsets).toHaveLength(MAX_RETURN_DAY_OFFSETS);
    // A truncated row cannot answer 「第七天有沒有回來」 for offsets it never recorded, so the
    // retention metric excludes it rather than counting it as churn — which would report the
    // heaviest returners in the product as the ones who left.
    expect(row.returnOffsetsTruncated).toBe(true);
    // A viewer who returns every day still has their EARLY offsets, so D1 and D7 stay answerable.
    expect(row.returnDayOffsets).toContain(1);
    expect(row.returnDayOffsets).toContain(7);
  });

  test('a day already recorded does not consume more of the bound', () => {
    let row = viewer(0);
    for (let repeat = 0; repeat < 200; repeat += 1) {
      row = foldViewer(row, 'mistwood', 'device:x', 1);
    }
    expect(row.returnDayOffsets).toEqual([1]);
    expect(row.returnOffsetsTruncated).toBe(false);
  });
});

describe('what these pure folds do NOT prove', () => {
  test('the Convex handler body is not exercised here, and that is recorded rather than hidden', () => {
    // `recordAnalyticsEvents` needs a deployment: its handler never runs under jest, so a defect
    // introduced INSIDE it — a wrong table name, a patch that dropped a field — would not redden
    // this suite. That is a limitation of the repo's existing test strategy, not of this task, and
    // it is why the browser gate asserts the real transport's arguments end to end.
    //
    // What IS covered here is every decision the handler delegates, which is all of them: the
    // handler holds row access and nothing else.
    const prepared = prepare([{ name: 'home_viewed', payload: { worldId: 'mistwood' } }]);
    const session: SessionAggregate = foldSession(null, prepared, NOW);
    expect(session.isFirstSession).toBe(false);
    // The flag is the CALLER's to set, because only the caller knows whether a viewer row already
    // existed. Asserted so the default is a deliberate `false` rather than an accident: a fold
    // that defaulted to `true` would make every session a first session and every §16.1
    // first-visit rate a whole-population rate.
  });
});
