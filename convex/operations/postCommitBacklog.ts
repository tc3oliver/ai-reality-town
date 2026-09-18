/**
 * What post-commit still owes Canon, as one rule three callers share (ART-202).
 *
 * ## The question this exists to answer
 *
 * `drainLivePostCommit` returned a bare array of outcomes, and an EMPTY array meant two opposite
 * things: "every accepted event has a completed run" and "this call spent its page advancing the
 * cursor over already-settled events and there is more to do — call me again". Nothing
 * distinguished them.
 *
 * That is not a theoretical complaint. The drain reads ONE bounded page —
 * `DEFAULT_MAX_POST_COMMIT_EVENTS` (3) + {@link POST_COMMIT_CURSOR_CATCHUP} (32) = 35 — so a world
 * whose cursor row is absent starts at -1 and needs one call per 35 settled events before it
 * reaches the first unprocessed one. On the acceptance deployment that took three empty-looking
 * calls before the fourth began work. Two of them were read as "the pipeline is caught up", and the
 * conclusion drawn was that the cursor had overshot and 14 events had been silently skipped. The
 * cursor was BEHIND, not ahead, and the pipeline was healthy; the call that says so returned the
 * same value as the call that says the opposite.
 *
 * ## What the cursor means, and what it must never mean
 *
 * `settledThroughSequenceNumber` is the highest Canon sequence for which every accepted event at or
 * below it has a COMPLETED post-commit run. It is not "seen", not "enqueued", not "attempted", and
 * not "settled but unfinished". It advances only over a contiguous completed prefix and must never
 * cross a hole:
 *
 *     75 completed, 76 completed, 77 failed, 78 completed   ->   the cursor may reach 76, no more
 *
 * A cursor that jumped to the highest completed run would strand 77 forever, which is why
 * {@link derivePostCommitBacklog} reports `advanceTo` from the contiguous prefix alone and reports
 * `cursorOvershot` separately rather than quietly repairing it.
 *
 * ## Why a pure module
 *
 * Three callers need the same answer and must not each derive it: the drain advances the cursor,
 * the inspection reports a dry run, and the reconciliation repairs what is missing. Two
 * implementations of "how far is settled" would be two chances to strand an event — the same
 * argument `drainPostCommitBacklog` already makes for having one body.
 */

export const POST_COMMIT_RUN_STATUSES = ['running', 'failed', 'completed'] as const;
export type PostCommitRunStatusLike = (typeof POST_COMMIT_RUN_STATUSES)[number];

/** One accepted event, as the backlog rule needs to see it. */
export type BacklogEvent = { sequenceNumber: number; worldDay: number };

/** One post-commit run, as the backlog rule needs to see it. */
export type BacklogRun = { sourceEventSequenceNumber: number; status: PostCommitRunStatusLike };

/**
 * Why one accepted event still needs work, or that it does not.
 *
 * `missing` and `unfinished` are kept apart because they call for different reading, even though
 * both are repaired identically: `missing` means post-commit has never been attempted for this
 * event, and a run of them means a world nothing is draining. `unfinished` means it was attempted
 * and did not finish, which is a failure to investigate rather than a backlog to work off.
 */
export type BacklogState = 'completed' | 'missing' | 'unfinished';

export type BacklogEntry = {
  sequenceNumber: number;
  worldDay: number;
  state: BacklogState;
  /** The run's own status when there is a run; `null` when there is none. */
  runStatus: PostCommitRunStatusLike | null;
};

export type PostCommitBacklog = {
  /** The cursor as stored. `-1` when the world has no cursor row yet. */
  cursor: number;
  /**
   * The highest sequence the cursor may legally hold, from the contiguous completed prefix.
   *
   * Never less than {@link cursor}: this value is what the cursor may advance TO, and a cursor that
   * is already higher is reported by {@link cursorOvershot} rather than by a negative advance.
   */
  advanceTo: number;
  /**
   * The cursor is above the contiguous completed prefix, so events below it were never processed.
   *
   * The invariant violation this whole module exists to make visible. It has never been observed —
   * the one time it was reported, the cursor was behind and the report was wrong — but an invariant
   * nothing checks is an invariant nobody finds out about.
   */
  cursorOvershot: boolean;
  entries: readonly BacklogEntry[];
  missing: readonly number[];
  unfinished: readonly number[];
  /** Accepted events still owed work. Zero means post-commit has caught up with what was scanned. */
  remaining: number;
  /** Every accepted event in the scanned range has a completed run. */
  caughtUp: boolean;
  /**
   * The scan hit its bound, so `caughtUp` describes the scanned range and not the world.
   *
   * Published rather than folded into `caughtUp`, per this repository's rule that truncation is
   * never silent: a bounded scan that reported "caught up" would be the ambiguity this module was
   * written to remove, in a new place.
   */
  scanTruncated: boolean;
  /**
   * The scan reached down to the cursor, so `advanceTo` and `cursorOvershot` mean what they say.
   *
   * False when the caller started the scan above `cursor + 1`: there is then a range nobody
   * examined, the cursor is not advanced across it, and no overshoot is claimed against it.
   */
  scanCoversCursor: boolean;
  newestScannedSequenceNumber: number | null;
};

/**
 * Reduce one world's accepted events and post-commit runs to what is still owed.
 *
 * `events` must be ascending by sequence number and may be a bounded page; `runs` need not be
 * ordered and need not form a prefix, because `runPostCommitPipeline` can be invoked directly for
 * any single event and complete out of order.
 */
export function derivePostCommitBacklog(input: {
  cursor: number;
  events: readonly BacklogEvent[];
  runs: readonly BacklogRun[];
  scanTruncated?: boolean;
}): PostCommitBacklog {
  const bySequence = new Map<number, PostCommitRunStatusLike>();
  for (const run of input.runs) {
    const prior = bySequence.get(run.sourceEventSequenceNumber);
    // A completed run wins over any other status for the same event: `patchRun` refuses to move a
    // run OUT of `completed`, so completion is terminal and a second row could only be staler.
    if (prior === 'completed') continue;
    bySequence.set(run.sourceEventSequenceNumber, run.status);
  }

  const entries: BacklogEntry[] = input.events.map((event) => {
    const runStatus = bySequence.get(event.sequenceNumber) ?? null;
    return {
      sequenceNumber: event.sequenceNumber,
      worldDay: event.worldDay,
      state: runStatus === 'completed' ? 'completed' : runStatus === null ? 'missing' : 'unfinished',
      runStatus,
    };
  });

  /**
   * The contiguous completed prefix, walked from the START of the scan rather than from the cursor.
   *
   * Starting at the cursor would make the answer depend on the value being checked, which is
   * exactly the tautology this repository's conventions warn about: a cursor that had overshot
   * would be confirmed by a scan that began where it pointed. Scanning from the bottom of the range
   * is what lets {@link cursorOvershot} be detectable at all.
   */
  const scanStart = entries.length > 0 ? entries[0].sequenceNumber : null;
  /**
   * Whether the scan actually reaches down to where the cursor sits.
   *
   * A scan starting above `cursor + 1` leaves a range nobody looked at, and seeding the prefix at
   * `scanStart - 1` would silently assert that range is complete. The cursor may not be advanced
   * across events that were never examined, and an overshoot cannot be claimed against them
   * either — "I did not look" is not "it is fine", and it is not "it is broken".
   */
  const scanCoversCursor = scanStart === null || scanStart <= input.cursor + 1;
  let contiguousThrough = scanStart === null ? input.cursor : scanStart - 1;
  for (const entry of entries) {
    if (entry.state !== 'completed') break;
    contiguousThrough = entry.sequenceNumber;
  }

  const missing = entries.filter((entry) => entry.state === 'missing').map(({ sequenceNumber }) => sequenceNumber);
  const unfinished = entries.filter((entry) => entry.state === 'unfinished').map(({ sequenceNumber }) => sequenceNumber);
  const remaining = missing.length + unfinished.length;

  return {
    cursor: input.cursor,
    // Never below the stored cursor: this is where the cursor may move TO. An overshoot is reported
    // as a fact, not as an instruction to move backwards — rewinding a cursor is a repair with its
    // own consequences and is not this function's decision to make.
    advanceTo: scanCoversCursor ? Math.max(input.cursor, contiguousThrough) : input.cursor,
    cursorOvershot: scanCoversCursor && entries.length > 0 && input.cursor > contiguousThrough,
    scanCoversCursor,
    entries,
    missing,
    unfinished,
    remaining,
    caughtUp: remaining === 0,
    scanTruncated: input.scanTruncated ?? false,
    newestScannedSequenceNumber: entries.length > 0 ? entries[entries.length - 1].sequenceNumber : null,
  };
}

/**
 * How far the cursor may advance given one bounded page STARTING at the cursor.
 *
 * The drain's own rule, extracted so the drain and the inspection cannot disagree about it. Unlike
 * {@link derivePostCommitBacklog} this deliberately begins at the cursor — the drain is advancing
 * it, not auditing it — and the two are separate functions so that neither use is mistaken for the
 * other.
 */
export function advanceCursorOver(
  cursor: number,
  events: readonly BacklogEvent[],
  runs: readonly BacklogRun[],
): number {
  const completed = new Set(runs.filter(({ status }) => status === 'completed')
    .map(({ sourceEventSequenceNumber }) => sourceEventSequenceNumber));
  let settledThrough = cursor;
  for (const event of events) {
    if (!completed.has(event.sequenceNumber)) break;
    settledThrough = event.sequenceNumber;
  }
  return settledThrough;
}
