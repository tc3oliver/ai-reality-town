/**
 * ART-100: guards for snapshot-resumed replay.
 *
 * The load-bearing claim is that resuming from a snapshot is not an approximation of a full
 * replay but is exactly equal to it — everywhere except the fields a seeded world's `initial`
 * snapshot populates. These tests pin both halves of that claim, and pin the boundary itself
 * so it cannot move without someone noticing.
 */

import { emptyProjection, type AcceptedEvent, type WorldProjection } from './model';
import { replayWorldEvents } from './replay';
import { buildSnapshot, cloneProjection, replayFromSnapshot } from './snapshots';
import { SEED_BASELINE_FIELDS, readProjectionViaSnapshot } from './snapshotReplay';
import { buildWorldImportPlan } from './worldConfig';
import { mistwoodWorldConfiguration } from './mistwoodSeed';

const WORLD_ID = mistwoodWorldConfiguration.world.id;

function dailyFact(day: number): AcceptedEvent {
  const sequenceNumber = day - 1;
  return {
    schemaVersion: 1,
    worldId: WORLD_ID,
    idempotencyKey: `day-${day}`,
    proposedBy: { type: 'system' },
    worldDay: day,
    timeSlot: 'night',
    eventType: 'world_event',
    participantIds: [],
    causedByEventIds: [],
    stateChanges: [{
      type: 'fact_created', subjectType: 'world', subjectId: WORLD_ID,
      predicate: `day-${day}-complete`, value: true, visibility: 'canon',
    }],
    eventId: `${WORLD_ID}#event#${sequenceNumber}`,
    sequenceNumber,
    acceptedAt: 1_000 + day,
    validationVersion: 'canon-v1',
    traceId: `trace-${day}`,
  };
}

function differingFields(left: WorldProjection, right: WorldProjection): string[] {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys]
    .filter((key) => key !== 'lastSequenceNumber')
    .filter((key) => JSON.stringify(
      (left as unknown as Record<string, unknown>)[key],
    ) !== JSON.stringify(
      (right as unknown as Record<string, unknown>)[key],
    ))
    .sort();
}

describe('ART-100 snapshot-resumed replay', () => {
  /**
   * The precondition every caller of `readProjectionViaSnapshot` relies on.
   *
   * If the world seed ever starts populating a fifth projection field, this test fails and
   * whoever added it has to decide what that means for the rebuilds that resumed from a
   * snapshot on the strength of this list. That is the entire point — the alternative is a
   * silent divergence in a published payload.
   */
  it('the seeded baseline populates exactly the fields SEED_BASELINE_FIELDS names', () => {
    const plan = buildWorldImportPlan(mistwoodWorldConfiguration, 0);
    const seeded = plan.initialSnapshot.projection;

    expect(differingFields(seeded, emptyProjection(WORLD_ID))).toEqual([...SEED_BASELINE_FIELDS].sort());
  });

  /**
   * Equality, not similarity: for a seeded world, resuming from a mid-history snapshot agrees
   * with a full replay from empty on every field outside the seeded set.
   */
  it('agrees with full replay from empty on every non-seeded field', () => {
    const seeded = buildWorldImportPlan(mistwoodWorldConfiguration, 0).initialSnapshot.projection;
    const events = Array.from({ length: 12 }, (_, index) => dailyFact(index + 1));

    // A day-7 snapshot, built the way `createDailySnapshot` builds one: resumed from the
    // seeded baseline, not from empty.
    const throughDaySeven = events.filter((event) => event.worldDay <= 7);
    const snapshot = buildSnapshot(
      replayWorldEvents(cloneProjection(seeded), throughDaySeven),
      10_000,
      7,
    );
    const tail = events.filter((event) => event.sequenceNumber > snapshot.lastSequenceNumber);

    const resumed = replayFromSnapshot(snapshot, tail);
    const full = replayWorldEvents(emptyProjection(WORLD_ID), events);

    expect(differingFields(resumed, full)).toEqual([...SEED_BASELINE_FIELDS].sort());
    expect(resumed.lastSequenceNumber).toBe(full.lastSequenceNumber);
    // Spot-check the field the rebuilds actually consume rather than trusting the diff helper.
    expect(resumed.facts).toEqual(full.facts);
    expect(resumed.relationshipHistory).toEqual(full.relationshipHistory);
  });

  /**
   * AC#1 in miniature: the read is bounded by the tail, not by total canon size.
   *
   * The double models the index binding rather than ignoring it — a query bound only on
   * `worldId` returns everything, and one that also binds `sequenceNumber` returns only the
   * suffix. A regression to an unbounded collect therefore shows up as a read count that
   * grows with history, which is exactly what this asserts against.
   */
  it('reads only the events after the snapshot, not the whole log', async () => {
    const events = Array.from({ length: 200 }, (_, index) => dailyFact(index + 1));
    const seeded = buildWorldImportPlan(mistwoodWorldConfiguration, 0).initialSnapshot.projection;
    const throughDay199 = events.filter((event) => event.worldDay <= 199);
    const snapshot = buildSnapshot(replayWorldEvents(cloneProjection(seeded), throughDay199), 10_000, 199);

    let canonRowsRead = 0;
    const db = {
      query(table: string) {
        return {
          withIndex(_index: string, bind: (q: unknown) => unknown) {
            let lowerExclusive: number | null = null;
            const q = {
              eq: () => q,
              gt: (_field: string, value: number) => { lowerExclusive = value; return q; },
            };
            bind(q);
            // Rows must carry the stored shape, not the domain shape: `rowToAcceptedEvent`
            // reads the event out of `row.payload` (`convex/canon/serialize.ts:26-36`).
            const rows = table === 'canonEvents'
              ? events
                .filter((event) => lowerExclusive === null || event.sequenceNumber > lowerExclusive)
                .map((event) => ({
                  worldId: event.worldId,
                  sequenceNumber: event.sequenceNumber,
                  acceptedAt: event.acceptedAt,
                  validationVersion: event.validationVersion,
                  traceId: event.traceId,
                  payload: event,
                }))
              : [{ ...snapshot, worldId: WORLD_ID }];
            const chain = {
              order: () => chain,
              first: () => {
                if (table === 'canonEvents') canonRowsRead += Math.min(rows.length, 1);
                return Promise.resolve(rows[rows.length - 1] ?? null);
              },
              collect: () => {
                if (table === 'canonEvents') canonRowsRead += rows.length;
                return Promise.resolve(rows);
              },
            };
            return chain;
          },
        };
      },
    };

    const projection = await readProjectionViaSnapshot(
      db as unknown as Parameters<typeof readProjectionViaSnapshot>[0],
      WORLD_ID,
    );

    expect(canonRowsRead).toBe(1);
    expect(projection.lastSequenceNumber).toBe(199);
    expect(projection.facts).toHaveLength(200);
  });
});
