/**
 * What the read-only world shell actually renders (ART-113, FR-N002 AC#1/#3/#4/#5).
 *
 * The scene component is called and the element tree it returns is inspected.
 * That exercises the renderer's own code -- the map it hands to the tilemap
 * component, the sprite it hands to each character, the props it does and does
 * not pass -- without mounting a Pixi application, which needs a real WebGL
 * context jsdom cannot provide.
 *
 * `jsdom` is required merely to *import* the module: `pixi-viewport` reads
 * `window` at module load. Nothing here renders markup.
 */

import type { ReactElement } from 'react';
import type { Application, ISpritesheetData } from 'pixi.js';

import { mistwoodWorldMap, MISTWOOD_TILE_DIM } from '../../../data/mistwood';
import { Character } from './Character';
import { PixiStaticMap } from './PixiStaticMap';
import PixiViewport from './PixiViewport';
import { ReadOnlyWorldScene } from './ReadOnlyWorld';
import {
  composeReadOnlyWorldViewModel,
  type PublicCharacterMotion,
  type ReadOnlySpriteAsset,
} from './worldViewModel';

/** `useApp()` is bridged in by the `Stage` wrapper; the scene only forwards it. */
const APP = {} as Application;

const SPRITE_ASSETS: Record<string, ReadOnlySpriteAsset> = {
  f1: { textureUrl: '/assets/32x32folk.png', spritesheetData: {} as ISpritesheetData },
  f2: { textureUrl: '/assets/32x32folk.png', spritesheetData: {} as ISpritesheetData },
};

function motion(overrides: Partial<PublicCharacterMotion> = {}): PublicCharacterMotion {
  return {
    characterId: 'cassia',
    semanticLocationId: 'mistwood-market',
    motionType: 'canon',
    motionSequence: 1,
    from: { x: 12, y: 8 },
    to: { x: 12, y: 8 },
    startedAt: 0,
    arriveAt: 0,
    animationState: 'idle',
    direction: 'down',
    ...overrides,
  };
}

function scene(motions: PublicCharacterMotion[], spriteKeys: Record<string, string>) {
  return ReadOnlyWorldScene({
    app: APP,
    viewModel: composeReadOnlyWorldViewModel({
      map: mistwoodWorldMap,
      motions,
      spriteKeys,
      nowMs: 0,
    }),
    spriteAssets: SPRITE_ASSETS,
    screenWidth: 800,
    screenHeight: 600,
  }) as ReactElement;
}

/** Every element in the tree, parents before children. */
function elements(node: unknown): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object') return [];
  const element = node as ReactElement;
  if (element.props === undefined) return [];
  return [element, ...elements(element.props.children)];
}

describe('the read-only world scene', () => {
  test('renders the Mistwood map inside a clamped viewport', () => {
    const tree = scene([], {});

    expect(tree.type).toBe(PixiViewport);
    expect(tree.props.app).toBe(APP);
    // The viewport is sized to the map so panning cannot leave Mistwood.
    expect(tree.props.worldWidth).toBe(mistwoodWorldMap.width * MISTWOOD_TILE_DIM);
    expect(tree.props.worldHeight).toBe(mistwoodWorldMap.height * MISTWOOD_TILE_DIM);

    const map = elements(tree).find((element) => element.type === PixiStaticMap);
    expect(map).toBeDefined();
    expect(map!.props.map).toBe(mistwoodWorldMap);
  });

  test('renders one character sprite per bound published motion', () => {
    const tree = scene(
      [
        motion({ characterId: 'cassia', from: { x: 12, y: 8 }, to: { x: 12, y: 8 } }),
        motion({
          characterId: 'rowan',
          motionSequence: 4,
          from: { x: 30, y: 20 },
          to: { x: 30, y: 20 },
          direction: 'left',
          animationState: 'speaking',
        }),
      ],
      { cassia: 'f1', rowan: 'f2' },
    );

    const sprites = elements(tree).filter((element) => element.type === Character);
    expect(sprites).toHaveLength(2);
    // Painter's order: the character further down the map is drawn later.
    expect(sprites.map((sprite) => sprite.props.textureUrl)).toEqual([
      SPRITE_ASSETS.f1.textureUrl,
      SPRITE_ASSETS.f2.textureUrl,
    ]);
    expect(sprites[0].props).toMatchObject({
      x: 12 * MISTWOOD_TILE_DIM,
      y: 8 * MISTWOOD_TILE_DIM,
      orientation: 90,
      isSpeaking: false,
    });
    expect(sprites[1].props).toMatchObject({
      x: 30 * MISTWOOD_TILE_DIM,
      y: 20 * MISTWOOD_TILE_DIM,
      orientation: 180,
      isSpeaking: true,
    });
  });

  test('renders nothing for a character with no sprite binding', () => {
    const tree = scene([motion({ characterId: 'cassia' })], { cassia: 'f9-unbound' });
    expect(elements(tree).filter((element) => element.type === Character)).toHaveLength(0);
  });

  test('passes no callback and no pointer handler anywhere in the tree', () => {
    // AC#3/#4/#5: a viewer cannot invoke what the tree never wires up. This
    // holds for the props the scene passes *and* for everything its children
    // pass on, so a handler cannot be smuggled in one level down either.
    const tree = scene([motion({ characterId: 'cassia' }), motion({ characterId: 'rowan' })], {
      cassia: 'f1',
      rowan: 'f2',
    });

    const offenders = elements(tree).flatMap((element) =>
      Object.entries(element.props as Record<string, unknown>)
        .filter(
          ([name, value]) =>
            typeof value === 'function' ||
            /^on[A-Z]/.test(name) ||
            /^(pointer|click|tap|mouse)/.test(name),
        )
        .map(([name]) => `${String(element.type)}: ${name}`),
    );

    expect(offenders).toEqual([]);
  });
});
