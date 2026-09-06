/**
 * ART-100 Slice 6 — the property that makes a Live checkpoint sound, and the equivalence that
 * keeps AC#3 true while it is used.
 *
 * The whole reason `liveFold.ts` exists is the claim `fold(all) === fold(fold(prefix), suffix)`.
 * If that is false at even one split point, a stored checkpoint publishes a different payload from
 * a full replay — silently, in production, on a public surface. So it is not asserted once on a
 * convenient boundary: it is asserted at EVERY split point of a fixture built to exercise all five
 * folded structures at once.
 *
 * Fixtures here assert NON-EMPTINESS before asserting equality. This task has already shipped one
 * test that compared `{}` to `{}` and looked green while proving nothing about the field it named;
 * every equality below is guarded so it cannot pass that way.
 */

import type { AcceptedEvent } from '../canon/model';
import { emptyLiveFold, foldLiveEvents, type LiveFoldState } from './liveFold';
import { buildLiveProjection } from './liveState';
import { excludedCharacterIds } from './publicDynamicProjection';

type Change = AcceptedEvent['stateChanges'][number];

function loc(locationId: string, over: Partial<{ name: string; active: boolean }> = {}): Change {
  return {
    type: 'location_state_changed', locationId, name: over.name ?? `name-${locationId}`,
    description: '', locationType: 'town', capacity: 10, connectedLocationIds: [],
    active: over.active ?? true, reason: 'r',
  } as Change;
}
const move = (characterId: string, toLocationId: string): Change =>
  ({ type: 'character_location_changed', characterId, fromLocationId: 'loc-0', toLocationId } as Change);
const life = (characterId: string, alive: unknown): Change =>
  ({ type: 'character_life_changed', characterId, alive, reason: 'r' } as unknown as Change);
const activeFlag = (characterId: string, toValue: unknown): Change =>
  ({ type: 'character_state_changed', characterId, field: 'active', toValue, fromValue: !toValue } as unknown as Change);

function event(sequenceNumber: number, stateChanges: Change[], over: Partial<AcceptedEvent> = {}): AcceptedEvent {
  return {
    schemaVersion: 1, worldId: 'w1', idempotencyKey: `k${sequenceNumber}`, proposedBy: { type: 'system' },
    worldDay: 1, timeSlot: 'morning', eventType: 'environment', participantIds: [], causedByEventIds: [],
    publicSummary: `summary-${sequenceNumber}`, stateChanges, eventId: `evt-${sequenceNumber}`,
    acceptedAt: 0, sequenceNumber, validationVersion: 1, traceId: 't', ...over,
  } as unknown as AcceptedEvent;
}

/**
 * Exercises all five folded structures, including the cases that make them interesting: a location
 * re-described later (last write wins), a character who moves twice, a character who dies and is
 * later revived (so the exclusion set must REMOVE as well as add), and an `active` flag toggled
 * independently of the life verdict.
 */
const EVENTS: AcceptedEvent[] = [
  event(0, [loc('sq'), move('ana', 'sq')]),
  event(1, [move('bo', 'mill'), life('bo', true)]),
  event(2, [loc('mill', { name: 'the mill' }), activeFlag('cy', false)]),
  event(3, [life('bo', false), move('ana', 'mill')]),
  event(4, [loc('sq', { name: 'the square, rebuilt', active: false })]),
  event(5, [life('bo', true), activeFlag('cy', true), move('dee', 'sq')]),
];

/** Comparable plain data, so a failure prints the differing structure rather than empty Maps. */
function plain(state: LiveFoldState) {
  return {
    locations: [...state.locations.entries()].sort(([a], [b]) => a.localeCompare(b)),
    positions: [...state.positionByCharacter.entries()].sort(([a], [b]) => a.localeCompare(b)),
    alive: [...state.aliveByCharacter.entries()].sort(([a], [b]) => a.localeCompare(b)),
    known: [...state.knownCharacters].sort(),
    excluded: [...state.excludedCharacterIds].sort(),
    lastSequenceNumber: state.lastSequenceNumber,
  };
}

describe('foldLiveEvents — a checkpoint may stand in for the events it covers', () => {
  it('exercises every folded structure, so the equality tests below are not about empty maps', () => {
    const whole = plain(foldLiveEvents(emptyLiveFold(), EVENTS));
    expect(whole.locations.length).toBeGreaterThan(0);
    expect(whole.positions.length).toBeGreaterThan(0);
    expect(whole.alive.length).toBeGreaterThan(0);
    expect(whole.known.length).toBeGreaterThan(0);
    // The revive at sequence 5 clears both exclusions, so this fixture ends with an EMPTY excluded
    // set by design. Asserting the interesting intermediate state instead, at the point where both
    // an `alive: false` and an `active: false` are outstanding.
    expect(whole.excluded).toEqual([]);
    expect(plain(foldLiveEvents(emptyLiveFold(), EVENTS.slice(0, 4))).excluded).toEqual(['bo', 'cy']);
  });

  it('splits at EVERY boundary without changing the result', () => {
    const whole = plain(foldLiveEvents(emptyLiveFold(), EVENTS));
    for (let split = 0; split <= EVENTS.length; split += 1) {
      const resumed = foldLiveEvents(
        foldLiveEvents(emptyLiveFold(), EVENTS.slice(0, split)),
        EVENTS.slice(split),
      );
      expect({ split, state: plain(resumed) }).toEqual({ split, state: whole });
    }
  });

  it('sorts by sequence number rather than trusting arrival order', () => {
    // Last-write-wins is only defined against an order. A caller handing back a tail in reverse
    // must not invert which write won.
    const shuffled = [...EVENTS].reverse();
    expect(plain(foldLiveEvents(emptyLiveFold(), shuffled)))
      .toEqual(plain(foldLiveEvents(emptyLiveFold(), EVENTS)));
  });

  it('never invents a location no event described — the seed-contamination guard', () => {
    // The reason this state is folded from EMPTY rather than resumed from a CanonSnapshot:
    // `locations` is a SEED_BASELINE_FIELD, so a Canon snapshot carries imported seed locations
    // that `buildLiveProjection` has never published.
    const described = new Set(EVENTS.flatMap((e) => e.stateChanges
      .filter((c) => c.type === 'location_state_changed')
      .map((c) => (c as unknown as { locationId: string }).locationId)));
    const folded = new Set(foldLiveEvents(emptyLiveFold(), EVENTS).locations.keys());
    expect([...folded].sort()).toEqual([...described].sort());
  });
});

describe('foldLiveEvents — the two former implementations kept their distinct rules', () => {
  it('records a malformed `alive` in aliveByCharacter but does NOT let it exclude anyone', () => {
    // The asymmetry that existed in production before the two walkers were merged:
    // `buildLiveProjection` stored whatever `alive` held, while `excludedCharacterIds` type-checked
    // it first. Merging them must not quietly pick one — the exclusion set drives what a viewer
    // sees, so a malformed change must leave the previous verdict standing.
    // The malformed value must be FALSY. A truthy one would take the `delete` branch even without
    // the guard and leave the exclusion set empty either way — the assertion would hold for the
    // wrong reason and a removed guard would go unnoticed. (It did, the first time this was
    // written: `'not-a-boolean'` is truthy, and injecting the guard's removal kept the suite green.)
    const state = foldLiveEvents(emptyLiveFold(), [
      event(0, [life('eve', true)]),
      event(1, [life('eve', null)]),
    ]);
    expect(state.aliveByCharacter.get('eve')).toBeNull();
    expect([...state.excludedCharacterIds]).toEqual([]);
  });

  it('also ignores a TRUTHY malformed `alive`, rather than reading it as "revived"', () => {
    // The other half. Without the type check, a non-boolean would take the revive branch and
    // silently un-exclude a character an earlier `alive: false` had properly hidden.
    const state = foldLiveEvents(emptyLiveFold(), [
      event(0, [life('eve', false)]),
      event(1, [life('eve', 'not-a-boolean')]),
    ]);
    expect([...state.excludedCharacterIds]).toEqual(['eve']);
  });

  it('does not let an `active` flag alone introduce a character to the Live projection', () => {
    // `knownCharacters` drives `payload.characters`. `character_state_changed` never populated it
    // and must not start: a character nothing has placed has no position to draw.
    const state = foldLiveEvents(emptyLiveFold(), [event(0, [activeFlag('ghost', false)])]);
    expect([...state.knownCharacters]).toEqual([]);
    expect([...state.excludedCharacterIds]).toEqual(['ghost']);
  });

  it('excludedCharacterIds still answers exactly what it used to', () => {
    // The public entry point, now a thin call onto the shared fold. Pinned independently of the
    // fold's own tests so the wiring is covered, not just the algorithm.
    expect([...excludedCharacterIds(EVENTS.slice(0, 4))].sort()).toEqual(['bo', 'cy']);
    expect([...excludedCharacterIds(EVENTS)].sort()).toEqual([]);
  });
});

describe('buildLiveProjection — resuming from a checkpoint publishes the same bytes (AC#3)', () => {
  const payloadFor = (events: readonly AcceptedEvent[], priorFold?: LiveFoldState) =>
    buildLiveProjection({ worldId: 'w1', acceptedEvents: events, arcs: [], publishedEpisode: null, priorFold });

  it('is byte-identical to the full replay at every split point', () => {
    const full = JSON.stringify(payloadFor(EVENTS));
    // Guards against a vacuous comparison: the payload must actually carry the folded fields.
    const parsed = JSON.parse(full) as { locations: unknown[]; characters: unknown[] };
    expect(parsed.locations.length).toBeGreaterThan(0);
    expect(parsed.characters.length).toBeGreaterThan(0);

    for (let split = 0; split <= EVENTS.length; split += 1) {
      const prior = foldLiveEvents(emptyLiveFold(), EVENTS.slice(0, split));
      // `recentEvents` and `worldTime` come from the events passed in, not from the fold, so a
      // resumed call must still be given the events it reports on. This test therefore passes the
      // WHOLE list with a prior fold covering a prefix — which is also the shape that would catch
      // double-counting, since every event in the prefix is folded twice.
      expect({ split, payload: JSON.stringify(payloadFor(EVENTS, prior)) }).toEqual({ split, payload: full });
    }
  });

  it('still rejects an event from another world when resuming', () => {
    // The worldId check is a validation of the input, deliberately kept outside the fold. If it
    // had been folded in, a resumed call would silently stop performing it.
    const foreign = event(6, [move('zed', 'sq')], { worldId: 'other' } as Partial<AcceptedEvent>);
    const prior = foldLiveEvents(emptyLiveFold(), EVENTS);
    expect(() => payloadFor([...EVENTS, foreign], prior)).toThrow(/worldId mismatch/);
  });
});
