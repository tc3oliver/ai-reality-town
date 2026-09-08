/**
 * Rung 4 of the FR-M004 ladder: the deterministic rules-only author (ART-91).
 *
 * Two things are being tested here, and the second is the one that matters.
 *
 * **It is deterministic.** Same context, same events, same idempotency keys — so a retried slot
 * re-derives keys `commitProposedEvent` deduplicates rather than appending a second copy of the
 * outage's record.
 *
 * **Its output is something Canon would actually accept.** FR-M004 forbids skipping Canon
 * Validation, and a rung-4 generator that produced events the validators refuse would fail every
 * slot of an outage while looking correct in isolation — the rung meant to keep the world moving
 * would be the rung that stops it. So the events are put through the REAL
 * `validateEventStructure` and the REAL `validateCanon`, against the seeded `initialSnapshot`
 * projection and the same rule context the commit pipeline loads, exactly as
 * `convex/quality/continuity.test.ts` does. Against `emptyProjection` those checks skip almost
 * everything they exist for (CLAUDE.md §9, `resolveWorldBaseline`), so a fixture that started from
 * empty would report a clean pass while measuring nothing.
 *
 * The other half of the rung's contract is negative: a rules-only event must assert nothing the
 * world does not already imply. No relationship change, no memory, no knowledge, no rumor — every
 * one of those is an interpretation, and there is no model here qualified to make one. That is
 * asserted as an exhaustive statement about `stateChanges`, not as four separate absences, because
 * a fifth interpretive change type added later must fail this test rather than slip past a list.
 */

import { mistwoodCharacterSeed, mistwoodWorldConfiguration, MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { validateCanon, validateEventStructure } from '../canon/validators';
import { buildWorldImportPlan } from '../canon/worldConfig';
import type { CanonRuleContext } from '../canon/model';
import type { TimeSlot } from '../canon/eventTypes';
import { MAX_PUBLIC_SUMMARY_LENGTH } from '../shared/constants';
import { countChineseCharacters } from '../shared/publicText';
import {
  MAX_RULES_ONLY_EVENTS_PER_SLOT,
  deriveRulesOnlyEvents,
  type RulesOnlyContext,
} from './rulesOnlyAuthor';

const WORLD_ID = MISTWOOD_PUBLIC_WORLD_ID;
const RUN_ID = 'director:mistwood-public:3:morning';

const activeLocations = mistwoodWorldConfiguration.locations.filter(({ active }) => active);

/** Where the seed puts every resident before any event moves them. */
const seedPlacements = (): RulesOnlyContext['placements'] =>
  mistwoodCharacterSeed.characters.map(({ id, initialLocationId }) =>
    ({ characterId: id, locationId: initialLocationId }));

const context = (overrides: Partial<RulesOnlyContext> = {}): RulesOnlyContext => ({
  worldId: WORLD_ID,
  worldDay: 3,
  timeSlot: 'morning',
  directorRunId: RUN_ID,
  placements: seedPlacements(),
  ...overrides,
});

/**
 * The world's rule context as the commit pipeline loads it. `characterPersonas` is deliberately
 * omitted for the reason the continuity fixtures omit it: persona anchors are absent-means-inert,
 * and including them would make these assertions depend on FR-B003's deviation assessor.
 */
const ruleContext = (): CanonRuleContext => ({
  worldId: WORLD_ID,
  rules: mistwoodWorldConfiguration.immutableRules,
  characterIds: mistwoodCharacterSeed.characters.map(({ id }) => id),
  locationIds: activeLocations.map(({ id }) => id),
  itemIds: mistwoodCharacterSeed.assets.map(({ id }) => id),
  organizationIds: mistwoodWorldConfiguration.organizations.map(({ id }) => id),
  initialCharacterAlive: Object.fromEntries(mistwoodCharacterSeed.characters.map(({ id }) => [id, true])),
  initialItemOwners: Object.fromEntries(mistwoodCharacterSeed.assets.map(({ id, ownerCharacterId }) => [id, ownerCharacterId])),
  initialCharacterLocations: Object.fromEntries(mistwoodCharacterSeed.characters.map(({ id, initialLocationId }) => [id, initialLocationId])),
  locationConnections: Object.fromEntries(activeLocations.map(({ id, connectedLocationIds }) => [id, connectedLocationIds])),
});

/** The seeded `initial` snapshot the world import writes — locations and organizations, no events. */
const seededProjection = () => buildWorldImportPlan(mistwoodWorldConfiguration, 0).initialSnapshot.projection;

/** Occupancy of each seeded location, so the ordering expectations are derived rather than typed. */
const seedOccupancy = (): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const { locationId } of seedPlacements()) counts.set(locationId, (counts.get(locationId) ?? 0) + 1);
  return counts;
};

// --- determinism -------------------------------------------------------------

describe('deriveRulesOnlyEvents is deterministic', () => {
  it('produces deeply equal events for the same context, twice', () => {
    expect(deriveRulesOnlyEvents(context())).toEqual(deriveRulesOnlyEvents(context()));
  });

  it('does not depend on the order the caller listed placements in', () => {
    // The snapshot's character order is an implementation detail of whoever built the list; the
    // events must not be. Reversing the input is the cheapest way to make that observable.
    const forward = deriveRulesOnlyEvents(context());
    const reversed = deriveRulesOnlyEvents(context({ placements: [...seedPlacements()].reverse() }));
    expect(reversed).toEqual(forward);
  });
});

describe('idempotency keys are derived from the slot', () => {
  it('names the world, day, slot and index', () => {
    const events = deriveRulesOnlyEvents(context());
    expect(events.map(({ idempotencyKey }) => idempotencyKey))
      .toEqual([`rules:${WORLD_ID}:3:morning:event:1`, `rules:${WORLD_ID}:3:morning:event:2`]);
  });

  it('differs across time slots of the same day', () => {
    const slots: TimeSlot[] = ['morning', 'noon', 'afternoon', 'evening', 'night'];
    const keys = slots.flatMap((timeSlot) =>
      deriveRulesOnlyEvents(context({ timeSlot })).map(({ idempotencyKey }) => idempotencyKey));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('differs across world days of the same slot', () => {
    const keys = [0, 1, 2].flatMap((worldDay) =>
      deriveRulesOnlyEvents(context({ worldDay })).map(({ idempotencyKey }) => idempotencyKey));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('differs across worlds', () => {
    const [mine] = deriveRulesOnlyEvents(context());
    const [theirs] = deriveRulesOnlyEvents(context({ worldId: 'other-world' }));
    expect(mine.idempotencyKey).not.toBe(theirs.idempotencyKey);
  });
});

// --- how many, and which -----------------------------------------------------

describe('a slot proposes at most MAX_RULES_ONLY_EVENTS_PER_SLOT events', () => {
  it('caps the seeded world, which occupies eight locations', () => {
    expect(seedOccupancy().size).toBeGreaterThan(MAX_RULES_ONLY_EVENTS_PER_SLOT);
    expect(deriveRulesOnlyEvents(context())).toHaveLength(MAX_RULES_ONLY_EVENTS_PER_SLOT);
  });

  it('proposes nothing at all for a world with no placements', () => {
    // Not a failure. An empty or entirely vacant world is quiet, and failing the slot would push
    // the ladder DOWN for a world whose provider is fine.
    expect(deriveRulesOnlyEvents(context({ placements: [] }))).toEqual([]);
  });

  it('proposes one event for a world with a single occupied location', () => {
    const events = deriveRulesOnlyEvents(context({
      placements: [{ characterId: 'pei-lan', locationId: 'mistwood-hall' }],
    }));
    expect(events).toHaveLength(1);
    expect(events[0].locationId).toBe('mistwood-hall');
    expect(events[0].participantIds).toEqual(['pei-lan']);
  });

  it('takes the busiest locations first, breaking ties by location id', () => {
    const occupancy = seedOccupancy();
    const expected = [...occupancy.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, MAX_RULES_ONLY_EVENTS_PER_SLOT)
      .map(([locationId]) => locationId);
    expect(deriveRulesOnlyEvents(context()).map(({ locationId }) => locationId)).toEqual(expected);
  });

  it('breaks an occupancy tie on the location id, not on input order', () => {
    // Two locations with one occupant each: only the id can order them, and reversing the input
    // must not change the answer.
    const placements = [
      { characterId: 'pei-lan', locationId: 'mistwood-square' },
      { characterId: 'he-jun', locationId: 'mistwood-mill' },
    ];
    expect(deriveRulesOnlyEvents(context({ placements })).map(({ locationId }) => locationId))
      .toEqual(['mistwood-mill', 'mistwood-square']);
    expect(deriveRulesOnlyEvents(context({ placements: [...placements].reverse() }))
      .map(({ locationId }) => locationId)).toEqual(['mistwood-mill', 'mistwood-square']);
  });

  it('lists each location’s participants in sorted order', () => {
    for (const event of deriveRulesOnlyEvents(context())) {
      expect(event.participantIds).toEqual([...event.participantIds].sort());
    }
  });
});

// --- the Canon contract: this is the assertion that matters ------------------

describe('every rules-only event is something Canon accepts', () => {
  const events = () => deriveRulesOnlyEvents(context());

  it('passes structural validation', () => {
    for (const event of events()) {
      expect(validateEventStructure(event)).toBeNull();
    }
  });

  it('passes canon validation against the SEEDED baseline', () => {
    const projection = seededProjection();
    const rules = ruleContext();
    const derived = events();
    expect(derived.length).toBeGreaterThan(0);
    for (const event of derived) {
      // A rules-only event that a validator refuses is a defect in this derivation, not a reason to
      // write it anyway — `runRulesOnlySlot` fails the slot when it happens.
      expect(validateCanon(event, projection, rules)).toBeNull();
    }
  });

  it('draws its locations and participants from the seed, so the references resolve', () => {
    const knownLocations = new Set(activeLocations.map(({ id }) => id));
    const knownCharacters = new Set(mistwoodCharacterSeed.characters.map(({ id }) => id));
    for (const event of events()) {
      expect(knownLocations.has(event.locationId as string)).toBe(true);
      for (const characterId of event.participantIds) expect(knownCharacters.has(characterId)).toBe(true);
    }
  });

  it('passes canon validation at every time slot of the day', () => {
    const projection = seededProjection();
    const rules = ruleContext();
    for (const timeSlot of ['morning', 'noon', 'afternoon', 'evening', 'night'] as TimeSlot[]) {
      for (const event of deriveRulesOnlyEvents(context({ timeSlot }))) {
        expect(validateEventStructure(event)).toBeNull();
        expect(validateCanon(event, projection, rules)).toBeNull();
      }
    }
  });
});

// --- the negative half: it interprets nothing --------------------------------

describe('a rules-only event asserts only what the world already implies', () => {
  it('carries exactly one public fact_created and nothing else', () => {
    for (const event of deriveRulesOnlyEvents(context())) {
      expect(event.stateChanges).toEqual([{
        type: 'fact_created',
        subjectType: 'location',
        subjectId: event.locationId,
        predicate: 'lastRoutineSlot',
        value: '3:morning',
        visibility: 'public',
      }]);
    }
  });

  it('forms no relationship, memory, knowledge or rumor state', () => {
    // Stated as "the only type present is fact_created" rather than as four absences, so an
    // interpretive change type introduced later fails here instead of slipping past a deny-list.
    const types = new Set(deriveRulesOnlyEvents(context()).flatMap(({ stateChanges }) =>
      stateChanges.map(({ type }) => type)));
    expect([...types]).toEqual(['fact_created']);
  });

  it('is a world_event, not a conversation', () => {
    // Nothing here observed anyone talking, and claiming a conversation happened would be exactly
    // the invention this rung exists to avoid.
    for (const event of deriveRulesOnlyEvents(context())) {
      expect(event.eventType).toBe('world_event');
    }
  });

  it('is proposed by the system, naming the director run that produced the slot', () => {
    for (const event of deriveRulesOnlyEvents(context())) {
      expect(event.proposedBy).toEqual({ type: 'system', id: RUN_ID });
      expect(event.causedByEventIds).toEqual([]);
    }
  });

  it('marks itself as rules-only so nothing downstream has to guess from its shape', () => {
    for (const event of deriveRulesOnlyEvents(context())) {
      expect(event.metadata).toMatchObject({ authoring: 'rules_only', degradationLevel: 'rules_only' });
    }
  });
});

describe('the public summary is publishable zh-Hant', () => {
  it('is non-empty, carries CJK, and fits the public budget', () => {
    for (const event of deriveRulesOnlyEvents(context())) {
      const summary = event.publicSummary ?? '';
      expect(summary.length).toBeGreaterThan(0);
      expect(summary.length).toBeLessThanOrEqual(MAX_PUBLIC_SUMMARY_LENGTH);
      // zh-Hant, matching every other public string in this project — not an English placeholder.
      expect(countChineseCharacters(summary)).toBeGreaterThan(0);
    }
  });

  it('names the place and the slot it is about', () => {
    const [first] = deriveRulesOnlyEvents(context());
    expect(first.publicSummary).toContain(first.locationId);
    expect(first.publicSummary).toContain('上午');
  });

  it('says a different thing at a different slot', () => {
    const [morning] = deriveRulesOnlyEvents(context({ timeSlot: 'morning' }));
    const [night] = deriveRulesOnlyEvents(context({ timeSlot: 'night' }));
    expect(night.publicSummary).not.toBe(morning.publicSummary);
    expect(night.publicSummary).toContain('夜間');
  });
});
