/**
 * ART-100: the bounded `completedWorldDays` must agree with the full-replay one, always.
 *
 * This set decides episode NUMBERING — `episodeNumberFor` takes the position of a day within it
 * (`postCommitLive.ts:404-405`) — so a disagreement does not degrade a payload, it renumbers
 * published episodes. That is why the original implementation is kept and exported rather than
 * deleted: it is the specification, and this file holds the new one against it over every day
 * shape I could construct, rather than over one happy path.
 */

import { TIME_SLOTS } from '../canon/eventTypes';
import type { AcceptedEvent } from '../canon/model';
import { completedWorldDays, completedWorldDaysOf, finalSlotStarted } from './postCommitLiveFunctions';

const LAST_TIME_SLOT = TIME_SLOTS[TIME_SLOTS.length - 1];
const FIRST_TIME_SLOT = TIME_SLOTS[0];

function event(sequenceNumber: number, worldDay: number, timeSlot: string): AcceptedEvent {
  return {
    schemaVersion: 1,
    worldId: 'mistwood',
    idempotencyKey: `event-${sequenceNumber}`,
    proposedBy: { type: 'system' },
    worldDay,
    timeSlot,
    eventType: 'world_event',
    participantIds: [],
    causedByEventIds: [],
    stateChanges: [],
    eventId: `mistwood#event#${sequenceNumber}`,
    sequenceNumber,
    acceptedAt: 1_000 + sequenceNumber,
    validationVersion: 'canon-v1',
    traceId: `trace-${sequenceNumber}`,
  } as AcceptedEvent;
}

/**
 * The day list exactly as `worldDayLedgers` maintains it: the distinct `worldDay`s named by the
 * accepted events, and nothing else. Written out here rather than imported so this file remains
 * an INDEPENDENT statement of what the ledger is supposed to contain — a test fed the ledger's own
 * derivation would agree with it by construction, which is the tautology CLAUDE.md §9 warns about.
 */
function ledgerWorldDays(events: readonly AcceptedEvent[]): number[] {
  return [...new Set(events.map(({ worldDay }) => worldDay))].sort((left, right) => left - right);
}

/** Run the bounded implementation the way `loadWorldState` wires it, over an event list. */
function bounded(events: readonly AcceptedEvent[]): number[] {
  const latestWorldDay = Math.max(...events.map((candidate) => candidate.worldDay));
  return completedWorldDaysOf(ledgerWorldDays(events), latestWorldDay);
}

/** Day shapes chosen to hit the boundaries, not to be representative. */
const SHAPES: Array<[string, AcceptedEvent[]]> = [
  ['one unfinished day', [event(0, 1, FIRST_TIME_SLOT)]],
  ['one finished day', [event(0, 1, LAST_TIME_SLOT)]],
  ['latest day unfinished', [
    event(0, 1, LAST_TIME_SLOT), event(1, 2, LAST_TIME_SLOT), event(2, 3, FIRST_TIME_SLOT),
  ]],
  ['latest day finished', [
    event(0, 1, LAST_TIME_SLOT), event(1, 2, LAST_TIME_SLOT), event(2, 3, LAST_TIME_SLOT),
  ]],
  ['an earlier day never reached its last slot but is finished anyway', [
    event(0, 1, FIRST_TIME_SLOT), event(1, 2, FIRST_TIME_SLOT), event(2, 3, FIRST_TIME_SLOT),
  ]],
  ['a gap: day 2 produced no event at all', [
    event(0, 1, LAST_TIME_SLOT), event(1, 3, LAST_TIME_SLOT), event(2, 4, FIRST_TIME_SLOT),
  ]],
  ['several gaps', [
    event(0, 0, LAST_TIME_SLOT), event(1, 5, LAST_TIME_SLOT), event(2, 9, LAST_TIME_SLOT),
  ]],
  ['day 0 exists', [event(0, 0, FIRST_TIME_SLOT), event(1, 1, FIRST_TIME_SLOT)]],
  ['many events on one day', [
    event(0, 1, FIRST_TIME_SLOT), event(1, 1, FIRST_TIME_SLOT), event(2, 1, LAST_TIME_SLOT),
  ]],
];

describe('ART-100 bounded completedWorldDays', () => {
  it.each(SHAPES)('agrees with the full-replay implementation: %s', (_name, events) => {
    expect(bounded(events)).toEqual(completedWorldDays(events));
  });

  /**
   * The property, not just the examples: over a few hundred generated day shapes the two
   * implementations must never disagree. Deterministic (no Math.random) so a failure is
   * reproducible from the index alone.
   */
  it('agrees with the full-replay implementation over generated day shapes', () => {
    for (let seed = 0; seed < 300; seed += 1) {
      const events: AcceptedEvent[] = [];
      let sequenceNumber = 0;
      for (let day = 0; day <= seed % 11; day += 1) {
        // A deterministic pseudo-shuffle: some days are skipped, some end on the last slot.
        if ((seed * 7 + day * 13) % 5 === 0) continue;
        const endsDay = (seed * 3 + day * 11) % 3 === 0;
        events.push(event(sequenceNumber++, day, endsDay ? LAST_TIME_SLOT : FIRST_TIME_SLOT));
      }
      if (events.length === 0) continue;
      expect(bounded(events)).toEqual(completedWorldDays(events));
    }
  });

  /**
   * A day nothing happened on must not appear. `episodeNumberFor` numbers episodes by POSITION in
   * this list, so an invented day shifts every later episode's number — the failure this whole
   * file exists to prevent, now expressed against the ledger's day list rather than a probe.
   */
  it('excludes a day that produced no event', () => {
    const events = [event(0, 1, LAST_TIME_SLOT), event(1, 3, LAST_TIME_SLOT)];
    expect(ledgerWorldDays(events)).toEqual([1, 3]);
    // Day 3 is the latest, so it is not finished however far into it the world has got (ART-89).
    expect(completedWorldDaysOf([1, 3], 3)).toEqual([1]);
    // ...and a day that DID produce events appears, so the assertion above is a real exclusion
    // rather than a list that happens to be short.
    expect(completedWorldDaysOf([1, 2, 3], 3)).toEqual([1, 2]);
  });

  /**
   * ART-89. A day is over when the world has moved past it, not when its final slot begins.
   *
   * `completedWorldDaysOf` used to admit the latest day as soon as one of its events carried the
   * final time slot, and the episode stage read it — so every day's Episode was assembled from a
   * partial final slot and the rest of that slot reached no Episode, recap or publication. The
   * daily snapshot, which may only be taken while its day is still the latest, keeps that
   * condition under its own name.
   */
  it('never calls the latest day finished, however far into it the world is', () => {
    const events = [event(0, 4, FIRST_TIME_SLOT), event(1, 4, LAST_TIME_SLOT)];
    expect(completedWorldDaysOf([4], 4)).toEqual([]);
    expect(finalSlotStarted([events[0]])).toBe(false);
    expect(finalSlotStarted(events)).toBe(true);
    // And the day becomes finished exactly when a later day accepts an event.
    expect(completedWorldDaysOf([4, 5], 5)).toEqual([4]);
  });

  /**
   * The ledger's catch-up property (ART-100): advancing it by a suffix must equal deriving it
   * from the whole log. Accepted Canon is append-only, so this is what lets a stored day list
   * stand in for a read of every event — and it is asserted at EVERY split point rather than at
   * one convenient boundary, because an off-by-one in the cursor would survive a single split.
   */
  it('advancing the ledger by a suffix equals deriving it from the whole log', () => {
    for (const [, events] of SHAPES) {
      for (let split = 0; split <= events.length; split += 1) {
        const prefix = events.slice(0, split);
        const suffix = events.slice(split);
        const incremental = [...new Set([...ledgerWorldDays(prefix), ...suffix.map((e) => e.worldDay)])]
          .sort((left, right) => left - right);
        expect(incremental).toEqual(ledgerWorldDays(events));
      }
    }
    // Non-vacuity: the shapes really do have more than one day to split across, so the loop above
    // is not asserting `[] === []` a few dozen times.
    expect(Math.max(...SHAPES.map(([, events]) => ledgerWorldDays(events).length))).toBeGreaterThan(1);
  });

  /**
   * Days do NOT have to arrive in ascending order for the ledger to be right. Nothing enforces
   * that `worldDay` rises with `sequenceNumber` — `dayBounds`' own docblock says so — and a
   * cursor that assumed it would silently drop a back-dated day, renumbering episodes.
   */
  it('catches up a day that arrives out of sequence order', () => {
    const outOfOrder = [event(0, 5, LAST_TIME_SLOT), event(1, 2, LAST_TIME_SLOT), event(2, 7, FIRST_TIME_SLOT)];
    expect(ledgerWorldDays(outOfOrder)).toEqual([2, 5, 7]);
    expect(bounded(outOfOrder)).toEqual(completedWorldDays(outOfOrder));
  });
});
