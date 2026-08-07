import { readFileSync } from 'node:fs';
import { mistwoodCharacterSeed } from '../canon/mistwoodSeed';
import {
  createMultiHopFixture,
  createSingleMoveFixture,
  createZeroEventFixture,
  FIXTURE_ACCEPTED_AT_MS,
  FIXTURE_NOW_MS,
  MISTWOOD_SEED_PLACEMENTS,
} from './fixtures';
import { mistwoodRuntimeContext } from './mistwoodRuntime';
import { planCharacterTrajectories } from './visualSyncPlanner';

describe('FR-N010 AC#6 deterministic fixtures', () => {
  it('mirrors the Canon character seed exactly, in seed order', () => {
    expect(MISTWOOD_SEED_PLACEMENTS).toEqual(
      mistwoodCharacterSeed.characters.map((character) => ({
        characterId: character.id,
        initialLocationId: character.initialLocationId,
      })),
    );
    expect(MISTWOOD_SEED_PLACEMENTS).toHaveLength(12);
  });

  it('binds every fixture to the Mistwood runtime context', () => {
    const context = mistwoodRuntimeContext();
    for (const input of [createZeroEventFixture(), createSingleMoveFixture(), createMultiHopFixture()]) {
      expect(input.mapId).toBe(context.mapId);
      expect(input.grid).toBe(context.grid);
      expect(input.bindings).toBe(context.bindings);
      expect(input.seedPlacements).toBe(MISTWOOD_SEED_PLACEMENTS);
    }
  });

  it('builds the same input on every call', () => {
    for (const build of [createZeroEventFixture, createSingleMoveFixture, createMultiHopFixture]) {
      expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
    }
  });

  it('defaults to a fixed planning instant and honours an override', () => {
    expect(FIXTURE_NOW_MS).toBe(FIXTURE_ACCEPTED_AT_MS + 1_000);
    expect(createZeroEventFixture().nowMs).toBe(FIXTURE_NOW_MS);
    expect(createSingleMoveFixture(42).nowMs).toBe(42);
  });

  it('describes a world with no accepted history at all', () => {
    expect(createZeroEventFixture().acceptedEvents).toEqual([]);
  });

  it('moves one resident along a road that actually exists', () => {
    const events = createSingleMoveFixture().acceptedEvents;
    expect(events).toHaveLength(1);
    expect(events[0].stateChanges[0]).toEqual({
      type: 'character_location_changed',
      characterId: 'wu-zhen',
      fromLocationId: 'mistwood-station',
      toLocationId: 'mistwood-square',
    });
    expect(planCharacterTrajectories(createSingleMoveFixture()).problems).toEqual([]);
  });

  it('chains three hops in strictly increasing sequence order across two world days', () => {
    const events = createMultiHopFixture().acceptedEvents;
    expect(events.map((event) => event.sequenceNumber)).toEqual([1, 2, 3]);
    expect(events.map((event) => event.worldDay)).toEqual([1, 1, 2]);
    expect(new Set(events.map((event) => event.timeSlot)).size).toBeGreaterThan(1);
    expect(planCharacterTrajectories(createMultiHopFixture()).problems).toEqual([]);
  });

  it('reaches no external API, clock or generated Convex code', () => {
    const source = readFileSync('convex/visualRuntime/fixtures.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const forbidden of [
      /convex\/_generated/,
      /\bfetch\s*\(/,
      /\bDate(?:\.now|\s*\()/,
      /\bMath\.random\s*\(/,
      /\bprocess\.env\b/,
    ]) {
      expect(source).not.toMatch(forbidden);
    }
  });
});
