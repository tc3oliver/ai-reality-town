import { ISpritesheetData, Spritesheet } from 'pixi.js';
import { useState, useEffect, useRef } from 'react';
import { AnimatedSprite, Container } from '@pixi/react';
import * as PIXI from 'pixi.js';

import { CharacterStateIndicator } from './CharacterStateIndicator';
import { AMBIENT_ANIMATION_SPEED, WALK_ANIMATION_SPEED } from './characterAnimation';
import { loadSpriteSheet } from './spriteSheetCache';
import type { PublicAnimationState } from './worldViewModel';

/**
 * Read-only character sprite (ART-113 / FR-N002, animated by ART-119 / FR-O002).
 *
 * The inherited a16z version took an `onClick` handler and made its container
 * `interactive` with a `pointerdown` binding, because clicking a character
 * opened the chat panel that could start a conversation. That write path was
 * retired with the engine (ART-112), so the sprite accepts no callback and takes
 * no pointer events at all (AC#3/#4/#5): there is nothing a click on a character
 * could invoke.
 *
 * ART-119 made it move. Three changes:
 *
 * - the walk cycle plays only while `isMoving`, and picks its facing from
 *   `orientation`, so a character walks in the direction it is actually
 *   travelling (AC#4) and holds a still frame otherwise (AC#3);
 * - the published `animationState` is passed through whole instead of being
 *   flattened into two booleans, and the emoji `Text` overlays it used to drive
 *   are replaced by {@link ./CharacterStateIndicator}'s drawn shapes — see that
 *   module for why emoji could not stay (AC#5);
 * - the spritesheet comes from {@link ./spriteSheetCache} rather than being
 *   parsed per instance, so twelve residents share eight parses instead of
 *   starting twelve.
 */
export const Character = ({
  spriteKey,
  textureUrl,
  spritesheetData,
  x,
  y,
  orientation,
  isMoving = false,
  animationState = 'idle',
  isAmbient = false,
  speed,
}: {
  /** Asset key; the spritesheet cache key, since all eight base sprites share one URL. */
  spriteKey: string;
  // Path to the texture packed image.
  textureUrl: string;
  // The data for the spritesheet.
  spritesheetData: ISpritesheetData;
  // The pose of the NPC.
  x: number;
  y: number;
  orientation: number;
  isMoving?: boolean;
  /** The published state. Drives the indicator above the sprite. */
  animationState?: PublicAnimationState;
  /**
   * Whether this frame's position came from in-zone drift (ART-120 / FR-O011 AC#6).
   *
   * Two of the four visual-distinction signals hang off this: the gait halves, and the marker
   * becomes the dwell ring at the character's feet rather than nothing.
   */
  isAmbient?: boolean;
  /** Frames per tick. Defaults to the gait matching `isAmbient`; override to tune. */
  speed?: number;
}) => {
  const [spriteSheet, setSpriteSheet] = useState<Spritesheet>();
  useEffect(() => {
    let mounted = true;
    void loadSpriteSheet(spriteKey, textureUrl, spritesheetData).then((sheet) => {
      if (mounted) setSpriteSheet(sheet);
    });
    return () => {
      mounted = false;
    };
  }, [spriteKey, textureUrl, spritesheetData]);

  // The first "left" is "right" but reflected.
  const roundedOrientation = Math.floor(orientation / 90);
  const direction = ['right', 'down', 'left', 'up'][roundedOrientation];

  // Prevents the animation from stopping when the texture changes
  // (see https://github.com/pixijs/pixi-react/issues/359)
  const ref = useRef<PIXI.AnimatedSprite | null>(null);
  useEffect(() => {
    if (isMoving) {
      ref.current?.play();
    }
  }, [direction, isMoving]);

  if (!spriteSheet) return null;

  return (
    <Container x={x} y={y} eventMode="none" interactiveChildren={false}>
      <CharacterStateIndicator animationState={animationState} isAmbient={isAmbient} />
      <AnimatedSprite
        ref={ref}
        isPlaying={isMoving}
        textures={spriteSheet.animations[direction]}
        animationSpeed={speed ?? (isAmbient ? AMBIENT_ANIMATION_SPEED : WALK_ANIMATION_SPEED)}
        anchor={{ x: 0.5, y: 0.5 }}
        eventMode="none"
      />
    </Container>
  );
};
