/**
 * Canon/Runtime location mismatch detection (FR-Q001 / ART-133).
 *
 * "Where is this character" is answered twice, independently, by two modules that never
 * consult each other:
 *
 * - the **Canon reducer** folds `character_location_changed` facts into
 *   `WorldProjection.characterLocations`;
 * - the **Visual Sync Planner** folds the same accepted events into a trajectory whose
 *   `semanticLocationId` is what the public payload publishes.
 *
 * They agree today, and ART-117 proved the planner is self-consistent — but self-consistent
 * is not the same as *in agreement with Canon*, and nothing until now compared the two. A
 * divergence would be invisible: the viewer would simply see a character standing somewhere
 * Canon does not say they are, with no error anywhere. That is precisely PRD 2.0 §18.1's
 * "unhandled drift", and this module is what makes it observable.
 *
 * Pure: no Convex, no clock, no randomness.
 */

import type { DynamicViewIncident } from './dynamicViewMetrics';
import type { PublicCharacterMotion } from './publicDynamicProjection';

export type LocationMismatchInput = {
  readonly characters: readonly PublicCharacterMotion[];
  /** The reducer's `characterLocations`: characterId -> Canon location id. */
  readonly canonLocations: Readonly<Record<string, string>>;
  readonly snapshotSequence: number;
};

/**
 * One incident per character whose two derivations disagree.
 *
 * A character ABSENT from `canonLocations` is not a mismatch. Canon only records a
 * location once the character has *moved*; a seeded character who has never moved has no
 * entry at all, while the planner still publishes them at their seeded position. Treating
 * that as drift would make every fresh world report twelve mismatches on day one and
 * train an operator to ignore the metric.
 *
 * Output follows the input order, which callers have already sorted by `characterId`.
 */
export function detectLocationMismatches(input: LocationMismatchInput): DynamicViewIncident[] {
  const incidents: DynamicViewIncident[] = [];
  for (const motion of input.characters) {
    const canonLocationId = input.canonLocations[motion.characterId];
    if (canonLocationId === undefined) continue;
    if (canonLocationId === motion.semanticLocationId) continue;
    incidents.push({
      code: 'CANON_RUNTIME_LOCATION_MISMATCH',
      characterId: motion.characterId,
      locationId: motion.semanticLocationId,
      canonLocationId,
      motionSequence: motion.motionSequence,
      snapshotSequence: input.snapshotSequence,
    });
  }
  return incidents;
}
