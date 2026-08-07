/**
 * Deterministic ambient anchor selection (FR-N010 AC#5 / ART-114).
 *
 * A Location Visual Binding offers several standing positions inside a zone. Choosing one is
 * the whole of this module's job: *what* a character does while standing there is ambient
 * behaviour semantics (FR-O011 / ART-120) and is deliberately not modelled here.
 *
 * Selection is a pure function of the seed, so the same character on the same world day in the
 * same slot always stands in the same spot — including on a client that re-derives the position
 * locally instead of asking the backend for it.
 */

import type { LocationVisualBinding, ZonePoint } from '../visual/locationVisualBinding';
import { ambientSeedValue, createSeededPrng, fnv1a32, type AmbientSeed } from './seededRandom';

/**
 * A standing position, structurally. Declared here rather than re-exported from
 * `../visual/locationVisualBinding` so a consumer holding a bare anchor list — the browser's
 * ambient derivation reads `data/mistwoodAmbientAnchors.ts`, which owns no Canon binding —
 * can call {@link selectAmbientAnchorForBucket} without acquiring a dependency on the
 * binding contract. A real `ZonePoint` satisfies it.
 */
export type ZonePointLike = {
  readonly x: number;
  readonly y: number;
};

/**
 * A binding with no ambient anchors cannot place a character anywhere legitimate, and
 * `sceneFocusPoint` is a camera target rather than a standing position. Failing loudly here
 * beats publishing a character standing on a viewpoint.
 */
function requireAnchors(binding: LocationVisualBinding): readonly ZonePoint[] {
  if (binding.ambientAnchors.length === 0) {
    throw new Error(
      `[VISUAL_RUNTIME_NO_AMBIENT_ANCHORS] location binding ${binding.locationId} declares no ambient anchors`,
    );
  }
  return binding.ambientAnchors;
}

/**
 * Modulo over the authored anchor order. The bias a modulo introduces across a 32-bit hash is
 * irrelevant for the handful of anchors a zone declares, and the alternative (rejection
 * sampling) would make the result depend on how many draws it took.
 */
export function selectAmbientAnchor(binding: LocationVisualBinding, seed: AmbientSeed): ZonePoint {
  const anchors = requireAnchors(binding);
  return anchors[ambientSeedValue(seed) % anchors.length];
}

/**
 * A deterministic walk of anchors for a character that lingers in one zone, for FR-O011 to
 * consume. Consecutive repeats are skipped: standing still twice in a row reads as the
 * character being frozen rather than idling.
 */
export function selectAmbientAnchorSequence(
  binding: LocationVisualBinding,
  seed: AmbientSeed,
  count: number,
): readonly ZonePoint[] {
  const anchors = requireAnchors(binding);
  if (count <= 0) return [];
  const first = selectAmbientAnchor(binding, seed);
  const sequence: ZonePoint[] = [first];
  if (anchors.length === 1) {
    while (sequence.length < count) sequence.push(first);
    return sequence;
  }
  const next = createSeededPrng(ambientSeedValue(seed));
  let previousIndex = anchors.indexOf(first);
  while (sequence.length < count) {
    // Drawing from `length - 1` and stepping past the previous index makes a repeat
    // impossible without a retry loop, so the draw count stays fixed per step.
    const offset = Math.floor(next() * (anchors.length - 1));
    const index = offset >= previousIndex ? offset + 1 : offset;
    sequence.push(anchors[index]);
    previousIndex = index;
  }
  return sequence;
}

/**
 * The anchor a character rests on during one ambient bucket (FR-O011 / ART-120).
 *
 * {@link selectAmbientAnchorSequence} cannot serve this. It walks a stateful PRNG stream from
 * a fixed origin, so answering "where is this character in bucket 29,148,033?" would mean
 * replaying every bucket since the epoch. A viewer joins the map at an arbitrary bucket and
 * has to agree with every other viewer immediately, so the bucket's anchor has to be
 * computable from the bucket number alone.
 *
 * ## Why an arithmetic step and not a per-bucket redraw
 *
 * The property that matters is "the anchor never repeats between consecutive buckets" —
 * standing still through two buckets reads as a frozen character rather than an idling one.
 * A per-bucket hash `h(n) mod L` cannot promise that, and patching it by looking back at
 * bucket `n - 1`'s own hash only moves the collision one step: `n - 1`'s *adjusted* index was
 * itself derived by looking back at `n - 2`, so an exact guarantee needs an unbounded
 * recursion, which is the very thing this function exists to avoid.
 *
 * Stepping by a fixed non-zero stride makes the guarantee algebraic instead:
 * `i(n) - i(n-1) ≡ stride (mod L)` and `1 <= stride <= L - 1`, so the difference is never
 * zero for *any* pair of adjacent buckets, at O(1) cost and with no look-back at all. The
 * stride and the starting index are seeded from `characterId`, `locationId` and `worldDay`,
 * so each resident walks its own order and the whole town reshuffles when Canon's day turns.
 * Variety *within* a bucket — when the character sets off, and therefore how long it stands
 * at each end — is hashed from all four seed components by the caller.
 *
 * The cost is that within one world day one character's anchor order is a rotation rather
 * than a fresh draw. At a minute per bucket a viewer would have to watch one resident for
 * five minutes to notice, and the alternative was giving up either determinism or O(1).
 */
export function selectAmbientAnchorForBucket(
  anchors: readonly ZonePointLike[],
  seed: AmbientSeed,
): ZonePointLike {
  if (anchors.length === 0) {
    throw new Error(
      `[VISUAL_RUNTIME_NO_AMBIENT_ANCHORS] no ambient anchors for ${seed.characterId} at ${seed.locationId}`,
    );
  }
  const count = anchors.length;
  if (count === 1) return anchors[0];
  // The bucket is deliberately absent from this key: it is what the stride is multiplied by,
  // and hashing it in as well would destroy the "adjacent buckets always differ" property.
  const cycleKey = `${seed.characterId}\0${seed.locationId}\0${seed.worldDay}`;
  const base = fnv1a32(`${cycleKey}\0base`) % count;
  const stride = 1 + (fnv1a32(`${cycleKey}\0stride`) % (count - 1));
  // Double modulo so a negative bucket (an instant before the Unix epoch) still indexes.
  const index = (((base + seed.timeBucket * stride) % count) + count) % count;
  return anchors[index];
}
