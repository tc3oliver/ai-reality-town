/**
 * The Mistwood binding for the Visual Runtime (FR-N010 / ART-114).
 *
 * This is the only file in `convex/visualRuntime` that knows a specific map or a specific world
 * exists. Everything else takes a `WalkableGrid` and a binding list as arguments, which is what
 * lets a test plan over a five-tile corridor and what will let a second town be added without
 * touching the planner.
 *
 * It is also the reason the planner itself must not import this module: the Mistwood location
 * bindings derive their labels from the Canon seed, so anything importing them transitively
 * reaches `convex/canon`. Keeping that edge in one leaf file keeps the planner's dependency
 * closure provably Canon-free (`visualRuntime.purity.test.ts`).
 */

import { mistwoodCollision } from '../../data/mistwood';
import {
  MISTWOOD_MAP_ID,
  mistwoodLocationVisualBindings,
} from '../visual/mistwoodLocationBindings';
import type { CharacterVisualBindingV1 } from '../visual/characterVisualBinding';
import type { LocationVisualBinding } from '../visual/locationVisualBinding';
import { buildMistwoodCharacterVisualBindings } from '../visual/mistwoodVisualBindings';
import { createCollisionGrid, type WalkableGrid } from './walkableGrid';

export const MISTWOOD_RUNTIME_MAP_ID = MISTWOOD_MAP_ID;

/** Built once at import: the collision layer is a frozen export, so the grid never changes. */
export const mistwoodWalkableGrid: WalkableGrid = createCollisionGrid(mistwoodCollision);

export type VisualRuntimeContext = {
  readonly mapId: string;
  readonly grid: WalkableGrid;
  readonly bindings: readonly LocationVisualBinding[];
  /**
   * Which characters have a sprite. The planner never reads this — it decides positions,
   * not appearances — but `detectUnboundCharacters` (FR-Q001) needs it to notice a
   * character that will be published and then drawn as nothing.
   */
  readonly characterBindings: readonly CharacterVisualBindingV1[];
};

/** The map-shaped half of a `VisualRuntimeInput`, ready to be given events and an instant. */
export function mistwoodRuntimeContext(): VisualRuntimeContext {
  return {
    mapId: MISTWOOD_RUNTIME_MAP_ID,
    grid: mistwoodWalkableGrid,
    bindings: mistwoodLocationVisualBindings,
    characterBindings: buildMistwoodCharacterVisualBindings(),
  };
}
