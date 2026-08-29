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
    // Three state changes on purpose, not one. An earlier version of this fixture emitted only
    // `fact_created` on a world subject, which left `relationshipHistory` empty in BOTH
    // projections — so the assertion below that named it as the field the relationship-graph
    // rebuild consumes was comparing {} with {} and could not have failed. A relationship change
    // makes the consumed field real, and a location change makes `locationOccupancy` (a seeded
    // field) and `characterLocations` (a non-seeded one) both non-trivial, so the seed-boundary
    // assertion has something to separate.
    stateChanges: [
      {
        type: 'fact_created', subjectType: 'world', subjectId: WORLD_ID,
        predicate: `day-${day}-complete`, value: true, visibility: 'canon',
      },
      {
        type: 'relationship_changed',
        sourceCharacterId: 'he-jun', targetCharacterId: 'zhao-ming',
        trustDelta: 1, affectionDelta: 0, resentmentDelta: 2, fearDelta: 0,
        dependencyDelta: 0, familiarityDelta: 1,
        reason: `第 ${day} 天的爭執`, visibility: day % 2 === 0 ? 'public' : 'private',
      },
      {
        type: 'character_location_changed',
        characterId: 'he-jun',
        fromLocationId: day % 2 === 0 ? 'mistwood-mill' : 'mistwood-square',
        toLocationId: day % 2 === 0 ? 'mistwood-square' : 'mistwood-mill',
      },
    ],
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

    // Spot-check the consumed fields directly rather than trusting the diff helper — and assert
    // they are NON-EMPTY first, because an equality check between two empty objects passes for
    // the wrong reason and would leave the whole substitution claim untested.
    expect(Object.keys(resumed.relationshipHistory).length).toBeGreaterThan(0);
    expect(resumed.relationshipHistory).toEqual(full.relationshipHistory);
    expect(Object.keys(resumed.characterLocations).length).toBeGreaterThan(0);
    expect(resumed.characterLocations).toEqual(full.characterLocations);
    expect(resumed.facts.length).toBeGreaterThan(0);
    expect(resumed.facts).toEqual(full.facts);

    // The other half of the claim: a seeded field genuinely DOES diverge, so the four-field
    // carve-out is a real boundary and not an unreachable branch.
    expect(resumed.locationOccupancy).not.toEqual(full.locationOccupancy);
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
              // `.order('desc')` reverses; the helper relies on the newest row coming first.
              order: (direction: 'asc' | 'desc') => {
                if (direction === 'desc') rows.reverse();
                return chain;
              },
              take: (n: number) => {
                const taken = rows.slice(0, n);
                if (table === 'canonEvents') canonRowsRead += taken.length;
                return Promise.resolve(taken);
              },
              first: () => {
                if (table === 'canonEvents') canonRowsRead += Math.min(rows.length, 1);
                return Promise.resolve(rows[0] ?? null);
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

  /**
   * `snapshotVersion` and `projectionHash` are optional in the schema, so a partially written
   * row is representable. Before ART-100 these rebuilds never read `canonSnapshots`, so this is
   * a new failure mode — and it lands in stage 19, which is not failure-isolated, meaning a
   * throw here would abort every stage after it. It must degrade to a full replay instead.
   */
  it.each([
    ['a row missing projectionHash', { projectionHash: undefined }],
    ['a row missing snapshotVersion', { snapshotVersion: undefined }],
    ['a manual snapshot', { kind: 'manual' }],
  ])('falls back to a full replay rather than throwing on %s', async (_name, over) => {
    const events = Array.from({ length: 6 }, (_unused, index) => dailyFact(index + 1));
    const seeded = buildWorldImportPlan(mistwoodWorldConfiguration, 0).initialSnapshot.projection;
    const snapshot = buildSnapshot(replayWorldEvents(cloneProjection(seeded), events.slice(0, 5)), 10_000, 5);

    const db = {
      query(table: string) {
        return {
          withIndex(_index: string, bind: (q: unknown) => unknown) {
            let lowerExclusive: number | null = null;
            const q = { eq: () => q, gt: (_f: string, v: number) => { lowerExclusive = v; return q; } };
            bind(q);
            const rows = table === 'canonEvents'
              ? events
                .filter((event) => lowerExclusive === null || event.sequenceNumber > lowerExclusive)
                .map((event) => ({
                  worldId: event.worldId, sequenceNumber: event.sequenceNumber,
                  acceptedAt: event.acceptedAt, validationVersion: event.validationVersion,
                  traceId: event.traceId, payload: event,
                }))
              : [{ ...snapshot, worldId: WORLD_ID, kind: 'daily', ...over }];
            const chain = {
              order: (direction: 'asc' | 'desc') => { if (direction === 'desc') rows.reverse(); return chain; },
              take: (n: number) => Promise.resolve(rows.slice(0, n)),
              first: () => Promise.resolve(rows[0] ?? null),
              collect: () => Promise.resolve(rows),
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
    // The full-replay answer, not a throw and not a partial one.
    expect(projection.facts).toHaveLength(6);
    expect(projection.lastSequenceNumber).toBe(5);
  });
});
