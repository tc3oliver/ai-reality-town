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
import { ambientSeedValue, createSeededPrng, type AmbientSeed } from './seededRandom';

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
