import { Container, Stage, useApp } from '@pixi/react';
import type { Application } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { MutableRefObject } from 'react';

import type { MistwoodLocationFootprint } from '../../../data/mistwood';
import { CameraController } from './CameraController';
import { Character } from './Character';
import { DayNightLayer } from './DayNightLayer';
import { MapZoneLayer } from './MapZoneLayer';
import { PixiStaticMap } from './PixiStaticMap';
import PixiViewport from './PixiViewport';
import type { CameraView } from './cameraModel';
import type { ReadOnlySpriteAsset, ReadOnlyWorldViewModel } from './worldViewModel';

/**
 * The read-only Pixi world shell (ART-113 / FR-N002, extended by ART-118 / FR-O001).
 *
 * This is the whole public renderer: a Pixi stage, a pan/zoom viewport, the
 * Mistwood tilemap, the location/collision overlay and one sprite per published
 * character motion. It is deliberately structurally incapable of writing to the
 * world:
 *
 * - It takes data props only. There is no callback, no handler and no `on*`
 *   prop anywhere in the tree, so nothing a viewer does can invoke anything
 *   (AC#3/#4/#5). The camera is passed *in* as a already-computed
 *   {@link CameraView}; the buttons that choose one are DOM elements in
 *   `components/live/`, outside this module on purpose.
 * - It mounts no world heartbeat and runs no timer that touches the backend.
 *   The a16z heartbeat, input and server-game hooks that used to drive the
 *   interactive game were deleted with the engine (ART-112) and this module
 *   imports nothing in their place (AC#2).
 * - It issues no query or mutation at all. The caller passes an already-read
 *   view model, which keeps the "public reads never trigger generation"
 *   invariant a property of composition rather than of this file's discipline.
 *
 * Those properties are enforced, not just documented: `architecture/
 * module-boundaries.json` declares `clientWorldReadOnly` with a forbidden
 * write-symbol list, `npm run check:architecture` fails the build if any of
 * them appears here, and `readOnlyWorldSurface.test.ts` asserts the same from
 * the product side (AC#6/#7).
 *
 * Viewer accessibility is not this component's job: a canvas cannot be read by
 * a screen reader, so the non-map equivalent stays the text Live View
 * (`components/public/LiveView.tsx`, NFR-009 AC#3), which every page linking to
 * this shell must also link to. ART-135 owns the full alternative view.
 */
export function ReadOnlyWorld(props: ReadOnlyWorldProps) {
  return (
    <Stage
      width={props.screenWidth}
      height={props.screenHeight}
      options={{ backgroundColor: 0x7ab5ff }}
    >
      <StageContents {...props} />
    </Stage>
  );
}

/** Bridges the Pixi application into the scene; `useApp` only works inside `Stage`. */
function StageContents(props: ReadOnlyWorldProps) {
  return <ReadOnlyWorldScene app={useApp()} {...props} />;
}

export interface ReadOnlyWorldProps {
  viewModel: ReadOnlyWorldViewModel;
  /** `spriteKey -> sheet`, resolved from the FR-N004 character visual binding. */
  spriteAssets: Readonly<Record<string, ReadOnlySpriteAsset>>;
  screenWidth: number;
  screenHeight: number;
  /** Handed to the viewport on creation so the camera controller can drive it. */
  viewportRef?: MutableRefObject<Viewport | undefined>;
  /** The frame to show. Omitted means "leave the camera wherever the viewer left it". */
  camera?: CameraView;
  reducedMotion?: boolean;
  /**
   * The Canon time slot of the last accepted event, driving the day/night wash
   * (ART-120 / FR-O012). Omitted means no wash — a world with no accepted history
   * has not had a time of day yet.
   */
  timeSlot?: string;
  /** Canonical location footprints drawn as labelled outlines (FR-O001 AC#2). */
  zones?: readonly MistwoodLocationFootprint[];
  collision?: readonly (readonly number[])[];
  showCollision?: boolean;
}

/** Stable empty defaults, so an omitted overlay prop does not force a redraw every frame. */
const NO_ZONES: readonly MistwoodLocationFootprint[] = [];
const NO_COLLISION: readonly (readonly number[])[] = [];

/**
 * Scene contents: the whole thing this shell draws.
 *
 * Deliberately hook-free and a pure function of its props, so
 * `readOnlyWorld.dom.test.tsx` can call it and inspect the element tree it
 * returns -- which is how "renders the Mistwood map and character sprites" and
 * "carries no callback anywhere in the tree" are asserted rather than assumed.
 *
 * The three named layers are drawn back to front. `character-layer` was mounted
 * and positioned while it was still empty, because a layer that appears only
 * once it has contents is a layer whose z-order was never tested; ART-119
 * (FR-O002) supplied the sprite bindings that fill it.
 */
export function ReadOnlyWorldScene({
  app,
  viewModel,
  spriteAssets,
  screenWidth,
  screenHeight,
  viewportRef,
  camera,
  reducedMotion = false,
  timeSlot,
  zones = NO_ZONES,
  collision = NO_COLLISION,
  showCollision = false,
}: ReadOnlyWorldProps & { app: Application }) {
  return (
    <PixiViewport
      app={app}
      viewportRef={viewportRef}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      worldWidth={viewModel.worldWidth}
      worldHeight={viewModel.worldHeight}
      reducedMotion={reducedMotion}
    >
      <Container name="tilemap-layer" eventMode="none" interactiveChildren={false}>
        <PixiStaticMap map={viewModel.map} reducedMotion={reducedMotion} />
      </Container>
      {/*
        Above the tiles and below the characters, so the wash colours the town without
        dimming the people in it. FR-O012.
      */}
      <Container name="day-night-layer" eventMode="none" interactiveChildren={false}>
        <DayNightLayer
          timeSlot={timeSlot}
          worldWidth={viewModel.worldWidth}
          worldHeight={viewModel.worldHeight}
        />
      </Container>
      <Container name="zone-layer" eventMode="none" interactiveChildren={false}>
        <MapZoneLayer
          footprints={zones}
          collision={collision}
          tileDim={viewModel.map.tileDim}
          showCollision={showCollision}
        />
      </Container>
      <Container name="character-layer" eventMode="none" interactiveChildren={false}>
        {viewModel.characters.map((character) => {
          const asset = spriteAssets[character.spriteKey];
          // An unbound sprite key draws nothing rather than falling back to some
          // other character's art (FR-N004 AC#6).
          if (asset === undefined) return null;
          return (
            <Character
              key={character.characterId}
              spriteKey={character.spriteKey}
              textureUrl={asset.textureUrl}
              spritesheetData={asset.spritesheetData}
              x={character.x}
              y={character.y}
              orientation={character.orientation}
              isMoving={character.isMoving}
              animationState={character.animationState}
              isAmbient={character.isAmbient}
            />
          );
        })}
      </Container>
      {camera !== undefined && viewportRef !== undefined && (
        <CameraController viewportRef={viewportRef} camera={camera} />
      )}
    </PixiViewport>
  );
}
