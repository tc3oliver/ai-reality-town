import { Stage, useApp } from '@pixi/react';
import { useRef } from 'react';
import { Viewport } from 'pixi-viewport';

import { Character } from './Character';
import { PixiStaticMap } from './PixiStaticMap';
import PixiViewport from './PixiViewport';
import type { ReadOnlySpriteAsset, ReadOnlyWorldViewModel } from './worldViewModel';

/**
 * The read-only Pixi world shell (ART-113 / FR-N002).
 *
 * This is the whole public renderer: a Pixi stage, a pan/zoom viewport, the
 * Mistwood tilemap and one sprite per published character motion. It is
 * deliberately structurally incapable of writing to the world:
 *
 * - It takes data props only. There is no callback, no handler and no `on*`
 *   prop anywhere in the tree, so nothing a viewer does can invoke anything
 *   (AC#3/#4/#5).
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
export function ReadOnlyWorld({
  viewModel,
  spriteAssets,
  screenWidth,
  screenHeight,
}: {
  viewModel: ReadOnlyWorldViewModel;
  /** `spriteKey -> sheet`, resolved from the FR-N004 character visual binding. */
  spriteAssets: Readonly<Record<string, ReadOnlySpriteAsset>>;
  screenWidth: number;
  screenHeight: number;
}) {
  return (
    <Stage width={screenWidth} height={screenHeight} options={{ backgroundColor: 0x7ab5ff }}>
      <ReadOnlyWorldScene
        viewModel={viewModel}
        spriteAssets={spriteAssets}
        screenWidth={screenWidth}
        screenHeight={screenHeight}
      />
    </Stage>
  );
}

/**
 * Scene contents. Split from {@link ReadOnlyWorld} because `useApp` has to run
 * inside the `Stage` subtree.
 */
function ReadOnlyWorldScene({
  viewModel,
  spriteAssets,
  screenWidth,
  screenHeight,
}: {
  viewModel: ReadOnlyWorldViewModel;
  spriteAssets: Readonly<Record<string, ReadOnlySpriteAsset>>;
  screenWidth: number;
  screenHeight: number;
}) {
  const pixiApp = useApp();
  // Held only so the viewport instance is reachable for future camera work
  // (following a character, framing a scene). Panning and zooming are local
  // camera state and never leave the browser.
  const viewportRef = useRef<Viewport | undefined>(undefined);

  return (
    <PixiViewport
      app={pixiApp}
      viewportRef={viewportRef}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      worldWidth={viewModel.worldWidth}
      worldHeight={viewModel.worldHeight}
    >
      <PixiStaticMap map={viewModel.map} />
      {viewModel.characters.map((character) => {
        const asset = spriteAssets[character.spriteKey];
        // An unbound sprite key draws nothing rather than falling back to some
        // other character's art (FR-N004 AC#6).
        if (asset === undefined) return null;
        return (
          <Character
            key={character.characterId}
            textureUrl={asset.textureUrl}
            spritesheetData={asset.spritesheetData}
            x={character.x}
            y={character.y}
            orientation={character.orientation}
            isMoving={character.isMoving}
            isSpeaking={character.isSpeaking}
            isThinking={character.isThinking}
          />
        );
      })}
    </PixiViewport>
  );
}
