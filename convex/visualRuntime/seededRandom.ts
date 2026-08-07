/**
 * Seeded determinism for the Visual Runtime (FR-N010 AC#5 / ART-114).
 *
 * Ambient placement has to look varied but must not *be* random: two servers, a replay and
 * a client re-derivation all have to agree on where a character stands, and no coordinate is
 * ever written back to the backend to reconcile a disagreement. So the "randomness" is a pure
 * function of `characterId`, `locationId`, `worldDay` and a time bucket.
 *
 * The hash is the same FNV-1a 32-bit construction Canon uses for projection checksums
 * (`convex/canon/snapshots.ts`). It is duplicated rather than imported on purpose: this module
 * must not depend on Canon at all, so that no future edit can quietly give the Visual Runtime
 * a path into the Canon write surface.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a, 32-bit, unsigned. `Math.imul` keeps the multiply exact in 32-bit space. */
export function fnv1a32(value: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

export type AmbientSeed = {
  readonly characterId: string;
  readonly locationId: string;
  readonly worldDay: number;
  readonly timeBucket: number;
};

/**
 * Canon time slots, mirrored from `convex/canon/eventTypes.ts`. Duplicated for the same
 * reason as the hash; `seededRandom.test.ts` pins this list against the Canon original so
 * the mirror cannot drift silently.
 */
export const TIME_SLOT_ORDER = ['morning', 'noon', 'afternoon', 'evening', 'night'] as const;

export type RuntimeTimeSlot = (typeof TIME_SLOT_ORDER)[number];

/**
 * How long one ambient bucket lasts. Ambient drift should re-roll on a human timescale, not
 * per frame; a minute is long enough that a viewer sees a character settle somewhere.
 */
export const AMBIENT_BUCKET_DURATION_MS = 60_000;

/**
 * NUL-delimited because `|` or `:` could appear in an id and let two different seeds collide
 * on one key. NUL cannot appear in a Canon id.
 */
export function ambientSeedKey(seed: AmbientSeed): string {
  return `${seed.characterId}\0${seed.locationId}\0${seed.worldDay}\0${seed.timeBucket}`;
}

export function ambientSeedValue(seed: AmbientSeed): number {
  return fnv1a32(ambientSeedKey(seed));
}

/**
 * An unknown slot maps to the first bucket rather than throwing: a slot the runtime does not
 * recognise is a Canon-side vocabulary change, and refusing to draw the town is a worse
 * failure than placing a character on a stable but arbitrary anchor.
 */
export function timeBucketForSlot(timeSlot: string): number {
  const index = TIME_SLOT_ORDER.indexOf(timeSlot as RuntimeTimeSlot);
  return index < 0 ? 0 : index;
}

/**
 * Bucket for an explicitly supplied instant. The caller passes the instant in; this module
 * never reads a clock, so an ambient position stays reproducible from a recorded input.
 */
export function timeBucketForInstant(instantMs: number): number {
  return Math.floor(instantMs / AMBIENT_BUCKET_DURATION_MS);
}

/**
 * xorshift32. Seed 0 is the generator's fixed point (it would emit zeroes forever), so it is
 * remapped to the golden-ratio constant instead of being rejected — a caller hashing an id
 * that happens to land on 0 should still get a usable stream.
 */
export function createSeededPrng(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    return state / 0x1_0000_0000;
  };
}
