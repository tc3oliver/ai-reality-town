/**
 * What post-commit owes Canon, and the two questions nothing could answer (ART-202).
 *
 * ## The wrong diagnosis this exists to prevent
 *
 * `drainLivePostCommit` was called twice against the acceptance deployment, returned `[]` both
 * times, and was read as "the pipeline is caught up". It was not: the drain reads one bounded page
 * of 35, and a page that is entirely settled advances the cursor and returns `[]` WITHOUT doing any
 * work. The world's cursor row was absent, so it took three such calls to walk the settled prefix
 * of events 0–74 before the fourth reached event 75. All fourteen outstanding events then processed
 * cleanly.
 *
 * The conclusion drawn from those two empty arrays was that the cursor had overshot and events had
 * been silently skipped, and it was recorded as a CRITICAL defect. The cursor was three pages
 * BEHIND. An empty array meant two opposite things and the tests could not tell them apart either.
 *
 * So these cases pin both halves: that the cursor rule is what the schema says it is, and that a
 * call which merely advanced the cursor is distinguishable from one with nothing left to do.
 */

import {
  advanceCursorOver,
  derivePostCommitBacklog,
  type BacklogEvent,
  type BacklogRun,
} from './postCommitBacklog';

const events = (...sequenceNumbers: number[]): BacklogEvent[] =>
  sequenceNumbers.map((sequenceNumber) => ({ sequenceNumber, worldDay: Math.floor(sequenceNumber / 5) }));

const completed = (...sequenceNumbers: number[]): BacklogRun[] =>
  sequenceNumbers.map((sourceEventSequenceNumber) => ({ sourceEventSequenceNumber, status: 'completed' }));

// =============================================================================
// The cursor rule
// =============================================================================

describe('the cursor advances only over a contiguous completed prefix', () => {
  it('stops below a hole rather than jumping to the highest completed run', () => {
    /**
     * The schema's own statement of the invariant, as a value: 75 ✓, 76 ✓, 77 ✗, 78 ✓ means the
     * cursor may reach 76 and no further. A cursor that jumped to 78 would strand 77 permanently —
     * nothing below the cursor is ever looked at again.
     */
    const backlog = derivePostCommitBacklog({
      cursor: 74,
      events: events(75, 76, 77, 78),
      runs: [...completed(75, 76, 78), { sourceEventSequenceNumber: 77, status: 'failed' }],
    });

    expect(backlog.advanceTo).toBe(76);
    expect(backlog.unfinished).toEqual([77]);
    expect(backlog.caughtUp).toBe(false);
    expect(backlog.remaining).toBe(1);
  });

  it('advances over a fully completed range', () => {
    const backlog = derivePostCommitBacklog({
      cursor: 74, events: events(75, 76, 77), runs: completed(75, 76, 77),
    });
    expect(backlog.advanceTo).toBe(77);
    expect(backlog.caughtUp).toBe(true);
    expect(backlog.remaining).toBe(0);
  });

  it('never moves the cursor backwards, even when the prefix is shorter', () => {
    // Rewinding a cursor is a repair with its own consequences. This function reports the
    // discrepancy; it does not decide to undo it.
    const backlog = derivePostCommitBacklog({
      cursor: 80, events: events(75, 76, 77), runs: completed(75),
    });
    expect(backlog.advanceTo).toBe(80);
  });
});

// =============================================================================
// Overshoot detection — the invariant violation that was wrongly reported
// =============================================================================

describe('a cursor above the contiguous completed prefix is reported', () => {
  it('detects the state that was claimed on acceptance but never existed', () => {
    /**
     * Exactly the shape the ART-202 report asserted: runs complete through 74, Canon accepted
     * through 88, and a cursor at 88. It is detectable — and when the real deployment was scanned
     * this way, it was false. An invariant nothing checks is an invariant nobody finds out about,
     * in either direction.
     */
    const backlog = derivePostCommitBacklog({
      cursor: 88,
      events: events(73, 74, 75, 76),
      runs: completed(73, 74),
    });

    expect(backlog.cursorOvershot).toBe(true);
    expect(backlog.missing).toEqual([75, 76]);
  });

  it('does NOT report an overshoot for a cursor that is merely behind', () => {
    // The real acceptance state, and the negative control for the case above. A cursor at -1 with
    // everything completed is three pages of catching up, not a violation.
    const backlog = derivePostCommitBacklog({
      cursor: -1, events: events(0, 1, 2), runs: completed(0, 1, 2),
    });
    expect(backlog.cursorOvershot).toBe(false);
    expect(backlog.advanceTo).toBe(2);
  });

  it('scans from the bottom of the range, so the check is not a tautology', () => {
    /**
     * Deriving the prefix from the cursor would make a cursor confirm itself: the scan would begin
     * where it pointed and find nothing below to contradict it. This asserts the prefix is computed
     * from the events, independently of the value being audited.
     */
    const overshot = derivePostCommitBacklog({
      cursor: 100, events: events(10, 11, 12), runs: completed(10, 11, 12),
    });
    // Everything scanned completed, yet the cursor claims 100 — which the scan cannot corroborate.
    expect(overshot.cursorOvershot).toBe(true);
    expect(overshot.remaining).toBe(0);
  });

  it('reports no overshoot when there is nothing to compare against', () => {
    const empty = derivePostCommitBacklog({ cursor: 50, events: [], runs: [] });
    expect(empty.cursorOvershot).toBe(false);
    expect(empty.caughtUp).toBe(true);
    expect(empty.newestScannedSequenceNumber).toBeNull();
  });
});

// =============================================================================
// missing vs unfinished
// =============================================================================

describe('why an event still owes work', () => {
  it('separates an event never attempted from one that did not finish', () => {
    /**
     * Both are repaired identically and they read completely differently. A run of `missing` is a
     * world nothing is draining — which is what the acceptance world actually was, because
     * `drivableWorldIds` selects `mode: 'public'` and it was in development mode. A run of
     * `unfinished` is a pipeline failing, which is a different investigation.
     */
    const backlog = derivePostCommitBacklog({
      cursor: -1,
      events: events(1, 2, 3),
      runs: [{ sourceEventSequenceNumber: 2, status: 'failed' }],
    });

    expect(backlog.missing).toEqual([1, 3]);
    expect(backlog.unfinished).toEqual([2]);
    expect(backlog.entries.map(({ state }) => state)).toEqual(['missing', 'unfinished', 'missing']);
  });

  it('treats a still-running run as unfinished, not as settled', () => {
    // A crash leaves `running`. Counting it as settled would carry the cursor over an event whose
    // stages never completed — the overshoot this module exists to make impossible.
    const backlog = derivePostCommitBacklog({
      cursor: -1, events: events(1), runs: [{ sourceEventSequenceNumber: 1, status: 'running' }],
    });
    expect(backlog.unfinished).toEqual([1]);
    expect(backlog.advanceTo).toBe(-1);
  });

  it('will not advance across a range the scan never looked at', () => {
    /**
     * Found by this suite, in this module's own code. Seeding the contiguous prefix at
     * `scanStart - 1` silently asserted that everything below the scan was complete, so a caller
     * who scanned from 75 with the cursor at -1 would have been told the cursor could move to 74 —
     * on the strength of 75 events nobody read. "I did not look" is not "it is fine".
     */
    const backlog = derivePostCommitBacklog({
      cursor: -1, events: events(75, 76), runs: completed(75, 76),
    });
    expect(backlog.scanCoversCursor).toBe(false);
    expect(backlog.advanceTo).toBe(-1);
    // Nor is it called an overshoot: the range below is unknown, not known-bad.
    expect(backlog.cursorOvershot).toBe(false);
  });

  it('does advance when the scan starts exactly at the cursor’s next event', () => {
    const backlog = derivePostCommitBacklog({
      cursor: 74, events: events(75, 76), runs: completed(75, 76),
    });
    expect(backlog.scanCoversCursor).toBe(true);
    expect(backlog.advanceTo).toBe(76);
  });

  it('lets a completed run win over a stale row for the same event', () => {
    // `patchRun` refuses to move a run out of `completed`, so completion is terminal and a
    // non-completed row for the same sequence can only be staler.
    const backlog = derivePostCommitBacklog({
      cursor: -1,
      events: events(1),
      runs: [{ sourceEventSequenceNumber: 1, status: 'completed' },
        { sourceEventSequenceNumber: 1, status: 'failed' }],
    });
    expect(backlog.caughtUp).toBe(true);
  });
});

// =============================================================================
// Truncation is published
// =============================================================================

describe('a bounded scan says that it was bounded', () => {
  it('carries scanTruncated through rather than folding it into caughtUp', () => {
    /**
     * A bounded scan reporting "caught up" would be the original ambiguity in a new place: the
     * caller could not tell "this world is done" from "this page is done". Truncation is never
     * silent here.
     */
    const backlog = derivePostCommitBacklog({
      cursor: -1, events: events(1, 2), runs: completed(1, 2), scanTruncated: true,
    });
    expect(backlog.caughtUp).toBe(true);
    expect(backlog.scanTruncated).toBe(true);
  });
});

// =============================================================================
// The drain's own advance rule
// =============================================================================

describe('advanceCursorOver is the rule the drain applies', () => {
  it('advances across a fully settled page without doing any work — the misread behaviour', () => {
    /**
     * This is precisely what produced two empty arrays on acceptance. The call is not idle: it
     * moves the cursor 35 events and returns nothing. Pinned as a VALUE so the behaviour is
     * documented rather than surprising, because it is correct and it is what must be reported.
     */
    expect(advanceCursorOver(-1, events(0, 1, 2, 3), completed(0, 1, 2, 3))).toBe(3);
  });

  it('stops at the first event with no completed run', () => {
    expect(advanceCursorOver(74, events(75, 76, 77), completed(75))).toBe(75);
  });

  it('does not move when the very first candidate is unsettled', () => {
    expect(advanceCursorOver(74, events(75, 76), completed(76))).toBe(74);
  });

  it('agrees with derivePostCommitBacklog when the scan starts at the cursor', () => {
    // Two functions, one rule. They are separate because one advances and one audits, and a drift
    // between them would put the cursor somewhere the audit would then call an overshoot.
    const scanned = events(75, 76, 77, 78);
    const runs = [...completed(75, 76, 78), { sourceEventSequenceNumber: 77, status: 'failed' as const }];
    expect(advanceCursorOver(74, scanned, runs))
      .toBe(derivePostCommitBacklog({ cursor: 74, events: scanned, runs }).advanceTo);
  });
});
