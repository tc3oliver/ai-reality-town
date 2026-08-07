/**
 * Missing-sprite detection for the Visual Runtime (FR-Q001 / ART-133).
 *
 * `planCharacterTrajectories` answers "where does this character stand". It never asks
 * whether there is a sprite to stand there: the planner only ever consults
 * `LocationVisualBinding`, so a character with no `CharacterVisualBinding` is planned,
 * published, and then fails silently in the browser with nothing recorded anywhere.
 *
 * This check deliberately lives OUTSIDE the planner rather than inside it. A missing
 * location binding makes a position underivable, so the planner is right to withhold the
 * motion; a missing sprite does not — the character is still at a real place, and
 * suppressing the motion would turn a presentation gap into a Canon-visible one. So this
 * is a second pass over the planner's output, not a filter on it.
 *
 * Pure: no Convex, no clock, no randomness.
 */

import type { CharacterVisualBindingV1 } from '../visual/characterVisualBinding';
import type { VisualRuntimeProblem } from './motion';

/** The published motion, reduced to the two fields this check attributes a problem to. */
export type PublishedCharacterRef = {
  readonly characterId: string;
  readonly locationId: string;
};

/**
 * Report one problem per published character with no *active* binding.
 *
 * A `retired` binding counts as absent: the row is kept for audit, but the renderer has
 * no sprite to draw from it. Results follow the input order, which the callers have
 * already sorted by `characterId`, so the output is deterministic.
 */
export function detectUnboundCharacters(
  published: readonly PublishedCharacterRef[],
  characterBindings: readonly CharacterVisualBindingV1[],
): VisualRuntimeProblem[] {
  const bound = new Set(
    characterBindings
      .filter((binding) => binding.status === 'active')
      .map((binding) => binding.characterId),
  );
  return published
    .filter((entry) => !bound.has(entry.characterId))
    .map((entry) => ({
      code: 'VISUAL_RUNTIME_UNBOUND_CHARACTER' as const,
      characterId: entry.characterId,
      locationId: entry.locationId,
      message: `character ${entry.characterId} has no active Character Visual Binding, so the renderer has no sprite to draw`,
    }));
}
