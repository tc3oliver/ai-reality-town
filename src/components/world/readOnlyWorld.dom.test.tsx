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

import {
  mistwoodCollision,
  mistwoodLocationFootprints,
  mistwoodWorldMap,
  MISTWOOD_TILE_DIM,
} from '../../../data/mistwood';
import { CameraController } from './CameraController';
import { Character } from './Character';
import { MapZoneLayer } from './MapZoneLayer';
import { PixiStaticMap } from './PixiStaticMap';
import PixiViewport, { detachViewportFromDom } from './PixiViewport';
import { ReadOnlyWorldScene } from './ReadOnlyWorld';
import { townView } from './cameraModel';
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

function scene(
  motions: PublicCharacterMotion[],
  spriteKeys: Record<string, string>,
  overrides: Partial<Parameters<typeof ReadOnlyWorldScene>[0]> = {},
) {
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
    ...overrides,
  }) as ReactElement;
}

/** The scene's named layers, in the order they are drawn. */
function layerNames(tree: ReactElement): string[] {
  return elements(tree)
    .map((element) => (element.props as { name?: unknown }).name)
    .filter((name): name is string => typeof name === 'string');
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

  test('draws the map, the zones and the characters as three layers, back to front', () => {
    // ART-118 (FR-O001 AC#2). The character layer is asserted even though it is
    // empty in this task: FR-O002 (ART-119) supplies the sprite bindings, and a
    // layer that only appears once it has contents is a layer whose z-order was
    // never checked.
    expect(layerNames(scene([], {}))).toEqual([
      'tilemap-layer',
      'zone-layer',
      'character-layer',
    ]);
  });

  test('the zone layer receives the eight Mistwood footprints and the collision grid', () => {
    const tree = scene([], {}, { zones: mistwoodLocationFootprints, collision: mistwoodCollision });
    const zones = elements(tree).find((element) => element.type === MapZoneLayer);
    expect(zones).toBeDefined();
    expect(zones!.props.footprints).toHaveLength(8);
    expect(zones!.props.tileDim).toBe(MISTWOOD_TILE_DIM);
    // A collision grid of the wrong size would tint the wrong tiles.
    expect(zones!.props.collision).toHaveLength(mistwoodWorldMap.width);
    expect(zones!.props.collision[0]).toHaveLength(mistwoodWorldMap.height);
    // The diagnostic tint is off unless it is asked for.
    expect(zones!.props.showCollision).toBe(false);
  });

  test('the camera controller is mounted only when a camera and a viewport exist', () => {
    expect(elements(scene([], {})).filter((e) => e.type === CameraController)).toHaveLength(0);

    const viewportRef = { current: undefined };
    const camera = townView({
      screenWidth: 800,
      screenHeight: 600,
      worldWidth: mistwoodWorldMap.width * MISTWOOD_TILE_DIM,
      worldHeight: mistwoodWorldMap.height * MISTWOOD_TILE_DIM,
    });
    const tree = scene([], {}, { viewportRef, camera });
    const controller = elements(tree).find((element) => element.type === CameraController);
    expect(controller).toBeDefined();
    expect(controller!.props.camera).toBe(camera);
    expect(controller!.props.viewportRef).toBe(viewportRef);
    // The same ref reaches the viewport, so the controller drives the thing on screen.
    expect(tree.props.viewportRef).toBe(viewportRef);
  });

  test('Reduced Motion reaches the viewport, which owns the inertia plugins', () => {
    expect(scene([], {}).props.reducedMotion).toBe(false);
    expect(scene([], {}, { reducedMotion: true }).props.reducedMotion).toBe(true);
  });

  test('renders nothing for a character with no sprite binding', () => {
    const tree = scene([motion({ characterId: 'cassia' })], { cassia: 'f9-unbound' });
    expect(elements(tree).filter((element) => element.type === Character)).toHaveLength(0);
  });

  test('passes no callback and no pointer handler anywhere in the tree', () => {
    // AC#3/#4/#5: a viewer cannot invoke what the tree never wires up. This
    // holds for the props the scene passes *and* for everything its children
    // pass on, so a handler cannot be smuggled in one level down either.
    // ART-118 added a camera, an overlay and a controller to this tree. They are
    // all pure data props, which is the whole reason the camera *buttons* live in
    // `components/live/` instead: this scene must stay uninvokable.
    const trees = [
      scene([motion({ characterId: 'cassia' }), motion({ characterId: 'rowan' })], {
        cassia: 'f1',
        rowan: 'f2',
      }),
      scene([], {}, {
        viewportRef: { current: undefined },
        camera: townView({ screenWidth: 800, screenHeight: 600, worldWidth: 1, worldHeight: 1 }),
        zones: mistwoodLocationFootprints,
        collision: mistwoodCollision,
        showCollision: true,
        reducedMotion: true,
      }),
    ];

    const offenders = trees.flatMap((tree) =>
      elements(tree).flatMap((element) =>
        Object.entries(element.props as Record<string, unknown>)
          .filter(
            ([name, value]) =>
              typeof value === 'function' ||
              /^on[A-Z]/.test(name) ||
              /^(pointer|click|tap|mouse)/.test(name),
          )
          .map(([name]) => `${String(element.type)}: ${name}`),
      ),
    );

    expect(offenders).toEqual([]);
  });
});

describe('leaving the map (ART-118)', () => {
  /** What `pixi-viewport`'s `InputManager.destroy()` does, on the object it does it to. */
  function tearDown(viewport: { options: { events: { domElement: unknown } } }) {
    detachViewportFromDom(viewport as never);
    const element = viewport.options.events.domElement as { removeEventListener: () => void };
    element.removeEventListener();
  }

  test('unmounting does not throw when the renderer has already been destroyed', () => {
    // React runs `Stage`'s `componentWillUnmount` -- which destroys the whole Pixi
    // Application and nulls `events.domElement` -- before it removes children, so
    // by the time the viewport is destroyed its DOM element is gone. The throw
    // that caused happened inside React's commit phase, where no error boundary
    // can catch it: navigating away from the map blanked the entire app.
    expect(() => tearDown({ options: { events: { domElement: null } } })).not.toThrow();
  });

  test('a live DOM element is left alone, so the real listener is still unbound', () => {
    let unbound = 0;
    const domElement = { removeEventListener: () => (unbound += 1) };
    const viewport = { options: { events: { domElement } } };
    tearDown(viewport);
    expect(viewport.options.events.domElement).toBe(domElement);
    expect(unbound).toBe(1);
  });
});
