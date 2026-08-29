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
import { completedWorldDays, completedWorldDaysBounded } from './postCommitLiveFunctions';

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

/** Run the bounded implementation the way `loadWorldState` wires it, over an event list. */
async function bounded(events: readonly AcceptedEvent[]): Promise<number[]> {
  const days = events.map((candidate) => candidate.worldDay);
  const min = Math.min(...days);
  const max = Math.max(...days);
  return completedWorldDaysBounded(
    { min, max },
    events.filter((candidate) => candidate.worldDay === max),
    (worldDay) => Promise.resolve(events.some((candidate) => candidate.worldDay === worldDay)),
  );
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
  it.each(SHAPES)('agrees with the full-replay implementation: %s', async (_name, events) => {
    expect(await bounded(events)).toEqual(completedWorldDays(events));
  });

  /**
   * The property, not just the examples: over a few hundred generated day shapes the two
   * implementations must never disagree. Deterministic (no Math.random) so a failure is
   * reproducible from the index alone.
   */
  it('agrees with the full-replay implementation over generated day shapes', async () => {
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
      expect(await bounded(events)).toEqual(completedWorldDays(events));
    }
  });

  /**
   * The probe is what makes a skipped day absent. If it were ever stubbed to `true` the bounded
   * version would invent days that produced no event, which `episodeNumberFor` would then number
   * — so this pins that the probe is consulted rather than assumed.
   */
  it('excludes a day the probe says produced no event', async () => {
    const events = [event(0, 1, LAST_TIME_SLOT), event(1, 3, LAST_TIME_SLOT)];
    const probed: number[] = [];
    const result = await completedWorldDaysBounded({ min: 1, max: 3 }, [events[1]], (worldDay) => {
      probed.push(worldDay);
      return Promise.resolve(events.some((candidate) => candidate.worldDay === worldDay));
    });
    expect(probed).toEqual([1, 2, 3]);
    expect(result).toEqual([1, 3]);
  });
});
