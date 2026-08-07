import { PixiComponent, applyDefaultProps } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { AnimatedSprite, SerializedWorldMap } from '../../../convex/aiTown/worldMap';
import * as campfire from '../../../data/animations/campfire.json';
import * as gentlesparkle from '../../../data/animations/gentlesparkle.json';
import * as gentlewaterfall from '../../../data/animations/gentlewaterfall.json';
import * as gentlesplash from '../../../data/animations/gentlesplash.json';
import * as windmill from '../../../data/animations/windmill.json';

const animations = {
  'campfire.json': { spritesheet: campfire, url: '/ai-town/assets/spritesheets/campfire.png' },
  'gentlesparkle.json': {
    spritesheet: gentlesparkle,
    url: '/ai-town/assets/spritesheets/gentlesparkle32.png',
  },
  'gentlewaterfall.json': {
    spritesheet: gentlewaterfall,
    url: '/ai-town/assets/spritesheets/gentlewaterfall32.png',
  },
  'windmill.json': { spritesheet: windmill, url: '/ai-town/assets/spritesheets/windmill.png' },
  'gentlesplash.json': { spritesheet: gentlesplash,
    url: '/ai-town/assets/spritesheets/gentlewaterfall32.png',},
};

/**
 * Stops or starts every environmental sprite in one go (ART-120 / FR-O012 AC#8).
 *
 * Kept as a plain function over an array rather than inlined, because the sprites are created
 * inside an async `parse()` callback: `applyProps` can and does run before that resolves, so
 * the same decision has to be applied twice — once when the props change, once when the
 * sprites finally exist — and the two must not diverge.
 */
export function setEnvironmentAnimationPlaying(
  sprites: readonly PIXI.AnimatedSprite[],
  playing: boolean,
): void {
  for (const sprite of sprites) {
    sprite.autoUpdate = playing;
    if (playing) sprite.play();
    // `gotoAndStop(0)` and not just `stop()`: stopping alone leaves the campfire frozen on
    // whichever frame it happened to reach, which for a flame is a half-drawn shape. Frame 0
    // is the pose the sheet was authored to rest on.
    else sprite.gotoAndStop(0);
  }
}

/** Instance state the component has to keep so `applyProps` can reach the sprites it made. */
type StaticMapContainer = PIXI.Container & {
  environmentSprites: PIXI.AnimatedSprite[];
  reducedMotion: boolean;
};

export const PixiStaticMap = PixiComponent('StaticMap', {
  create: (props: { map: SerializedWorldMap; reducedMotion?: boolean; [k: string]: any }) => {
    const map = props.map;
    const numxtiles = Math.floor(map.tileSetDimX / map.tileDim);
    const numytiles = Math.floor(map.tileSetDimY / map.tileDim);
    const bt = PIXI.BaseTexture.from(map.tileSetUrl, {
      scaleMode: PIXI.SCALE_MODES.NEAREST,
    });

    const tiles = [];
    for (let x = 0; x < numxtiles; x++) {
      for (let y = 0; y < numytiles; y++) {
        tiles[x + y * numxtiles] = new PIXI.Texture(
          bt,
          new PIXI.Rectangle(x * map.tileDim, y * map.tileDim, map.tileDim, map.tileDim),
        );
      }
    }
    const screenxtiles = map.bgTiles[0].length;
    const screenytiles = map.bgTiles[0][0].length;

    const container = new PIXI.Container() as StaticMapContainer;
    container.environmentSprites = [];
    container.reducedMotion = props.reducedMotion === true;
    const allLayers = [...map.bgTiles, ...map.objectTiles];

    // blit bg & object layers of map onto canvas
    for (let i = 0; i < screenxtiles * screenytiles; i++) {
      const x = i % screenxtiles;
      const y = Math.floor(i / screenxtiles);
      const xPx = x * map.tileDim;
      const yPx = y * map.tileDim;

      // Add all layers of backgrounds.
      for (const layer of allLayers) {
        const tileIndex = layer[x][y];
        // Some layers may not have tiles at this location.
        if (tileIndex === -1) continue;
        const ctile = new PIXI.Sprite(tiles[tileIndex]);
        ctile.x = xPx;
        ctile.y = yPx;
        container.addChild(ctile);
      }
    }

    // TODO: Add layers.
    const spritesBySheet = new Map<string, AnimatedSprite[]>();
    for (const sprite of map.animatedSprites) {
      const sheet = sprite.sheet;
      if (!spritesBySheet.has(sheet)) {
        spritesBySheet.set(sheet, []);
      }
      spritesBySheet.get(sheet)!.push(sprite);
    }
    for (const [sheet, sprites] of spritesBySheet.entries()) {
      const animation = (animations as any)[sheet];
      if (!animation) {
        console.error('Could not find animation', sheet);
        continue;
      }
      const { spritesheet, url } = animation;
      const texture = PIXI.BaseTexture.from(url, {
        scaleMode: PIXI.SCALE_MODES.NEAREST,
      });
      const spriteSheet = new PIXI.Spritesheet(texture, spritesheet);
      spriteSheet.parse().then(() => {
        const created: PIXI.AnimatedSprite[] = [];
        for (const sprite of sprites) {
          const pixiAnimation = spriteSheet.animations[sprite.animation];
          if (!pixiAnimation) {
            console.error('Failed to load animation', sprite);
            continue;
          }
          const pixiSprite = new PIXI.AnimatedSprite(pixiAnimation);
          pixiSprite.animationSpeed = 0.1;
          pixiSprite.x = sprite.x;
          pixiSprite.y = sprite.y;
          pixiSprite.width = sprite.w;
          pixiSprite.height = sprite.h;
          container.addChild(pixiSprite);
          created.push(pixiSprite);
        }
        container.environmentSprites.push(...created);
        // ART-120 (FR-O012 AC#8) fixed a live defect here: these sprites used to set
        // `autoUpdate = true` and `play()` unconditionally, so the mill wheel and the water
        // kept turning for a viewer who had asked the whole system to stop moving things.
        // The preference is re-read from the container rather than captured, because this
        // callback resolves after `applyProps` may already have changed it.
        setEnvironmentAnimationPlaying(created, !container.reducedMotion);
      });
    }

    container.x = 0;
    container.y = 0;

    // ART-113 (FR-N002 AC#5): the map used to opt into `pointerdown` with an explicit
    // hit area so a click could set the human player's destination. That write path is
    // gone, so the tile container takes no pointer events at all -- a map click cannot
    // reach a handler, let alone change a character's destination. Viewport pan/zoom is
    // unaffected: `PixiViewport` handles its own drag/pinch/wheel gestures.
    container.eventMode = 'none';
    container.interactiveChildren = false;

    return container;
  },

  applyProps: (instance, oldProps, newProps) => {
    applyDefaultProps(instance, oldProps, newProps);

    const container = instance as StaticMapContainer;
    container.reducedMotion = (newProps as { reducedMotion?: boolean }).reducedMotion === true;
    setEnvironmentAnimationPlaying(container.environmentSprites, !container.reducedMotion);
  },
});
