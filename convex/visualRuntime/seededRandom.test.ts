import { TIME_SLOTS } from '../canon/eventTypes';
import {
  AMBIENT_BUCKET_DURATION_MS,
  TIME_SLOT_ORDER,
  ambientSeedKey,
  ambientSeedValue,
  createSeededPrng,
  fnv1a32,
  timeBucketForInstant,
  timeBucketForSlot,
  type AmbientSeed,
} from './seededRandom';

const NUL = String.fromCharCode(0);

const baseSeed: AmbientSeed = {
  characterId: 'wu-zhen',
  locationId: 'mistwood-station',
  worldDay: 0,
  timeBucket: 0,
};

describe('FR-N010 AC#5 seeded determinism', () => {
  it('pins FNV-1a 32-bit against golden vectors', () => {
    expect(fnv1a32('')).toBe(2166136261);
    expect(fnv1a32('a')).toBe(3826002220);
    expect(fnv1a32('mistwood')).toBe(914440865);
    expect(fnv1a32(['wu-zhen', 'mistwood-station', 0, 0].join(NUL))).toBe(951869534);
    expect(fnv1a32(['lin-yingxue', 'mistwood-inn', 2, 3].join(NUL))).toBe(811433193);
  });

  it('returns an unsigned 32-bit value for every input', () => {
    for (let index = 0; index < 500; index++) {
      const hash = fnv1a32(`character-${index}`);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('delimits seed fields with NUL so no id can forge another seed key', () => {
    expect(ambientSeedKey(baseSeed)).toBe(['wu-zhen', 'mistwood-station', 0, 0].join(NUL));
    // Without a delimiter that cannot appear in an id, these two seeds would collide.
    const left = ambientSeedKey({ ...baseSeed, characterId: 'a', locationId: 'bc' });
    const right = ambientSeedKey({ ...baseSeed, characterId: 'ab', locationId: 'c' });
    expect(left).not.toBe(right);
  });

  it('is stable across repeated evaluation', () => {
    const expected = ambientSeedValue(baseSeed);
    for (let index = 0; index < 1000; index++) {
      expect(ambientSeedValue({ ...baseSeed })).toBe(expected);
    }
  });

  it('changes when any single seed field changes', () => {
    const expected = ambientSeedValue(baseSeed);
    expect(ambientSeedValue({ ...baseSeed, characterId: 'wu-zhem' })).not.toBe(expected);
    expect(ambientSeedValue({ ...baseSeed, locationId: 'mistwood-square' })).not.toBe(expected);
    expect(ambientSeedValue({ ...baseSeed, worldDay: 1 })).not.toBe(expected);
    expect(ambientSeedValue({ ...baseSeed, timeBucket: 1 })).not.toBe(expected);
  });

  it('mirrors the Canon time slot vocabulary exactly, in order', () => {
    expect([...TIME_SLOT_ORDER]).toEqual([...TIME_SLOTS]);
    TIME_SLOTS.forEach((slot, index) => expect(timeBucketForSlot(slot)).toBe(index));
  });

  it('maps an unrecognised slot to the first bucket rather than throwing', () => {
    expect(timeBucketForSlot('dusk')).toBe(0);
    expect(timeBucketForSlot('')).toBe(0);
  });

  it('buckets an explicitly supplied instant without reading a clock', () => {
    expect(timeBucketForInstant(0)).toBe(0);
    expect(timeBucketForInstant(AMBIENT_BUCKET_DURATION_MS - 1)).toBe(0);
    expect(timeBucketForInstant(AMBIENT_BUCKET_DURATION_MS)).toBe(1);
    expect(timeBucketForInstant(AMBIENT_BUCKET_DURATION_MS * 42 + 17)).toBe(42);
  });
});

describe('FR-N010 seeded pseudo-random stream', () => {
  it('pins the xorshift32 stream against golden vectors', () => {
    const next = createSeededPrng(0x811c9dc5);
    expect([next(), next(), next()]).toEqual([
      0.2739662209060043, 0.31014532619155943, 0.6669882687274367,
    ]);
  });

  it('produces the same stream for the same seed and a different one otherwise', () => {
    const draw = (seed: number): number[] => {
      const next = createSeededPrng(seed);
      return Array.from({ length: 20 }, () => next());
    };
    expect(draw(12345)).toEqual(draw(12345));
    expect(draw(12345)).not.toEqual(draw(12346));
  });

  it('remaps seed 0 off the generator fixed point', () => {
    const next = createSeededPrng(0);
    const draws = Array.from({ length: 10 }, () => next());
    expect(draws.every((value) => value === 0)).toBe(false);
    expect(new Set(draws).size).toBeGreaterThan(1);
  });

  it('stays inside the unit interval', () => {
    const next = createSeededPrng(ambientSeedValue(baseSeed));
    for (let index = 0; index < 1000; index++) {
      const value = next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
