import { readFileSync } from 'node:fs';
import { hasArrivedAtLocation, type LocationVisualBinding } from '../visual/locationVisualBinding';
import { mistwoodLocationVisualBindings } from '../visual/mistwoodLocationBindings';
import {
  BOOTSTRAP_INSTANT_MS,
  BOOTSTRAP_MOTION_SEQUENCE,
  BOOTSTRAP_TIME_BUCKET,
  BOOTSTRAP_WORLD_DAY,
  bootstrapAnchor,
  bootstrapTrajectory,
} from './seedBootstrap';

const MAP_ID = 'mistwood-v1';

function bindingFor(locationId: string): LocationVisualBinding {
  const binding = mistwoodLocationVisualBindings.find((entry) => entry.locationId === locationId);
  if (!binding) throw new Error(`missing test binding for ${locationId}`);
  return binding;
}

describe('FR-N010 AC#8 seed bootstrap position', () => {
  it('places a character on an authored anchor of its seeded location', () => {
    const binding = bindingFor('mistwood-station');
    const anchor = bootstrapAnchor(binding, 'wu-zhen');
    expect(binding.ambientAnchors).toContainEqual(anchor);
    expect(hasArrivedAtLocation(binding, anchor)).toBe(true);
  });

  it('returns the same anchor on every derivation, so a static character never twitches', () => {
    const binding = bindingFor('mistwood-hall');
    const expected = bootstrapAnchor(binding, 'pei-lan');
    for (let index = 0; index < 500; index++) {
      expect(bootstrapAnchor(binding, 'pei-lan')).toEqual(expected);
    }
  });

  it('separates characters seeded into the same location', () => {
    const binding = bindingFor('mistwood-hall');
    const chosen = new Set(
      ['gao-wenrui', 'qiu-an', 'pei-lan'].map((characterId) => {
        const anchor = bootstrapAnchor(binding, characterId);
        return `${anchor.x},${anchor.y}`;
      }),
    );
    expect(chosen.size).toBeGreaterThan(1);
  });

  it('keys the anchor off fixed constants, not off the world clock', () => {
    expect(BOOTSTRAP_WORLD_DAY).toBe(0);
    expect(BOOTSTRAP_TIME_BUCKET).toBe(0);
    expect(BOOTSTRAP_INSTANT_MS).toBe(0);
    expect(BOOTSTRAP_MOTION_SEQUENCE).toBe(0);
  });

  it('produces a standing character, not a zero-length walk', () => {
    const binding = bindingFor('mistwood-inn');
    const trajectory = bootstrapTrajectory(binding, 'luo-shan', MAP_ID);
    expect(trajectory).toMatchObject({
      characterId: 'luo-shan',
      mapId: MAP_ID,
      motionType: 'bootstrap',
      movementPhase: 'bootstrap',
      animationState: 'idle',
      motionSequence: BOOTSTRAP_MOTION_SEQUENCE,
      semanticLocationId: 'mistwood-inn',
      originLocationId: null,
      sourceEventIds: [],
      startedAt: BOOTSTRAP_INSTANT_MS,
      arriveAt: BOOTSTRAP_INSTANT_MS,
    });
    expect(trajectory.from).toEqual(trajectory.to);
    expect(trajectory.waypoints).toEqual([
      { point: trajectory.to, arriveAt: BOOTSTRAP_INSTANT_MS },
    ]);
  });

  it('is byte-identical across derivations', () => {
    const binding = bindingFor('mistwood-orchard');
    const expected = JSON.stringify(bootstrapTrajectory(binding, 'tang-ruoxi', MAP_ID));
    for (let index = 0; index < 50; index++) {
      expect(JSON.stringify(bootstrapTrajectory(binding, 'tang-ruoxi', MAP_ID))).toBe(expected);
    }
  });

  it('ends inside the zone it claims for every Mistwood location', () => {
    for (const binding of mistwoodLocationVisualBindings) {
      const trajectory = bootstrapTrajectory(binding, 'any-character', MAP_ID);
      expect(hasArrivedAtLocation(binding, trajectory.to)).toBe(true);
      expect(trajectory.arriveAt).toBeGreaterThanOrEqual(trajectory.startedAt);
    }
  });

  it('fabricates no Canon event to explain the position', () => {
    const source = readFileSync('convex/visualRuntime/seedBootstrap.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const forbidden of [
      /canonEvents/,
      /commitProposedEvent/,
      /character_location_changed/,
      /\bctx\b/,
      /\binsert\s*\(/,
    ]) {
      expect(source).not.toMatch(forbidden);
    }
  });
});
