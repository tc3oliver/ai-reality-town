/**
 * Read-only world view model (ART-113 / FR-N002).
 *
 * Everything the Pixi shell needs to draw a frame is computed here, as pure
 * functions over data the public read model already publishes. The renderer
 * itself owns no state, issues no query and can reach no write API, so the
 * whole "what does the world look like right now" decision is unit-testable
 * without a DOM, a Pixi application or a Convex client.
 *
 * The character input is shaped as PRD 2.0 §10.4 `PublicCharacterMotion`, the
 * unit that FR-N003 (ART-115) will publish. Producing that motion data is
 * explicitly *not* this task -- this module only consumes it, which is the
 * split PRD 2.0 §10.4 describes: "前端依 `startedAt`、`arriveAt` 與
 * `motionSequence` 進行插值及動畫播放". Until FR-N003 lands, callers pass an
 * empty motion list and the shell renders the map alone.
 */

// Type-only imports: erased at compile time, so this module pulls in neither
// pixi.js nor the DOM and stays runnable in the plain-Node unit test project.
import type { ISpritesheetData } from 'pixi.js';

import type { SerializedWorldMap } from '../../../convex/aiTown/worldMap';

export type PublicMotionType = 'canon' | 'ambient' | 'idle' | 'replay';

export type PublicAnimationState = 'idle' | 'walking' | 'speaking' | 'thinking' | 'activity';

export type PublicDirection = 'up' | 'down' | 'left' | 'right';

/** A published motion unit (PRD 2.0 §10.4). Positions are in map tiles. */
export interface PublicCharacterMotion {
  characterId: string;
  semanticLocationId: string;
  motionType: PublicMotionType;
  motionSequence: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  startedAt: number;
  arriveAt: number;
  animationState: PublicAnimationState;
  direction: PublicDirection;
  sourceEventIds?: string[];
}

/**
 * The sprite sheet a character draws with. Resolved by the caller from the
 * FR-N004 character visual binding (ART-111) so the renderer stays a pure
 * consumer of already-bound assets.
 */
export interface ReadOnlySpriteAsset {
  textureUrl: string;
  spritesheetData: ISpritesheetData;
}

/** One character, already resolved to the pixel pose the renderer draws. */
export interface ReadOnlyWorldCharacter {
  characterId: string;
  spriteKey: string;
  /** Pixel position on the map canvas. */
  x: number;
  y: number;
  /** Degrees, in the `right/down/left/up` order the sprite sheets are packed in. */
  orientation: number;
  isMoving: boolean;
  isSpeaking: boolean;
  isThinking: boolean;
}

export interface ReadOnlyWorldViewModel {
  map: SerializedWorldMap;
  /** Map size in pixels, for viewport clamping. */
  worldWidth: number;
  worldHeight: number;
  characters: ReadOnlyWorldCharacter[];
}

/** `Character` reads `['right', 'down', 'left', 'up'][orientation / 90]`. */
const ORIENTATION_DEGREES: Record<PublicDirection, number> = {
  right: 0,
  down: 90,
  left: 180,
  up: 270,
};

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Fraction of the way from `from` to `to` at `nowMs`.
 *
 * A motion whose window has not opened yet sits at its origin, a finished or
 * zero-length motion sits at its destination, and anything in between is
 * linear. Never extrapolates past either end, so a stale projection can only
 * ever park a character at a published position -- it cannot walk one off the
 * map while the backend is down.
 */
export function motionProgress(motion: PublicCharacterMotion, nowMs: number): number {
  if (motion.arriveAt <= motion.startedAt) return 1;
  return clamp((nowMs - motion.startedAt) / (motion.arriveAt - motion.startedAt), 0, 1);
}

/**
 * Latest motion per character. A projection may carry several units for one
 * character (for example an in-flight walk plus the idle that follows it); the
 * highest `motionSequence` wins so the render order cannot depend on array
 * order. Ties keep the first entry, which keeps the function total.
 */
function latestMotionPerCharacter(
  motions: readonly PublicCharacterMotion[],
): PublicCharacterMotion[] {
  const latest = new Map<string, PublicCharacterMotion>();
  for (const motion of motions) {
    const previous = latest.get(motion.characterId);
    if (previous === undefined || motion.motionSequence > previous.motionSequence) {
      latest.set(motion.characterId, motion);
    }
  }
  return [...latest.values()];
}

export function composeReadOnlyWorldViewModel({
  map,
  motions,
  spriteKeys,
  nowMs,
}: {
  map: SerializedWorldMap;
  /** Published motion units. Empty until FR-N003 publishes them. */
  motions: readonly PublicCharacterMotion[];
  /** `characterId -> spriteKey`, from the FR-N004 visual binding. */
  spriteKeys: Readonly<Record<string, string>>;
  nowMs: number;
}): ReadOnlyWorldViewModel {
  const characters = latestMotionPerCharacter(motions)
    // A character with no visual binding is dropped rather than drawn with a
    // guessed sprite: FR-N004 AC#6 wants unbound characters rejected, not
    // silently reskinned.
    .filter((motion) => spriteKeys[motion.characterId] !== undefined)
    .map((motion) => {
      const progress = motionProgress(motion, nowMs);
      const tileX = clamp(
        motion.from.x + (motion.to.x - motion.from.x) * progress,
        0,
        Math.max(map.width - 1, 0),
      );
      const tileY = clamp(
        motion.from.y + (motion.to.y - motion.from.y) * progress,
        0,
        Math.max(map.height - 1, 0),
      );
      return {
        characterId: motion.characterId,
        spriteKey: spriteKeys[motion.characterId],
        x: tileX * map.tileDim,
        y: tileY * map.tileDim,
        orientation: ORIENTATION_DEGREES[motion.direction],
        isMoving: motion.animationState === 'walking' && progress < 1,
        isSpeaking: motion.animationState === 'speaking',
        isThinking: motion.animationState === 'thinking',
      };
    })
    // Painter's order: lower on the map draws in front. `characterId` breaks
    // ties so two characters standing on the same row never flicker between
    // frames.
    .sort((a, b) => a.y - b.y || a.characterId.localeCompare(b.characterId));

  return {
    map,
    worldWidth: map.width * map.tileDim,
    worldHeight: map.height * map.tileDim,
    characters,
  };
}
