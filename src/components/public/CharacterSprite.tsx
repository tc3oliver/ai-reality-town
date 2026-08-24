import {
  CHARACTER_TEXTURE_URL,
  SPRITE_CELL_ORIGINS,
  SPRITE_FRAME_SIZE,
  isSpriteKey,
} from '../../../data/spritesheets/catalogue';

/**
 * A character's front-facing sprite frame, as a DOM element (FR-P001 / ART-129 AC#4).
 *
 * ## Why this is not the live map's portrait
 *
 * `components/live/CharacterCard` draws the same thing, but through `useSpriteAssets()` — which
 * recolours palette variants on a `<canvas>` and hands back a data URL. That machinery lives in
 * `clientLive`, and `clientPublic` may not depend on it: `clientLive` already depends on
 * `clientPublic`, so the reverse edge would be a cycle. Moving it to a third module was the
 * alternative, and it is not worth a refactor of the live map's asset pipeline to put twelve
 * 32×32 frames on the homepage.
 *
 * Everything needed is in `data/`, which no boundary module owns: the shared texture URL, the
 * cell origin per sprite key, and the frame size. So this reads the SAME binding the map reads
 * (`mistwoodCharacterSpriteKeys`) and cuts the same frame out of the same texture.
 *
 * ## The one difference, stated rather than hidden
 *
 * This draws the BASE cell, not the palette-recoloured variant. Recolouring needs a canvas, and
 * the homepage has no reason to create twelve of them. Four of Mistwood's twelve residents are
 * palette variants of another's sprite (`pei-lan`/`f1`, `wu-zhen`/`f2`, `fang-yue`/`f4`,
 * `zhao-ming`/`f6`), so on the homepage such a pair shows the same figure in the base palette.
 * Their *binding* is still theirs — the sprite key is the identity FR-N004 assigns — and their
 * name is beside them. `homeSprites.a11y.test.tsx` pins that the key rendered here is the key the
 * live map resolves, so the two surfaces can never disagree about who draws with what.
 *
 * DECORATIVE. The character's name is rendered beside it as real text, so announcing the sprite
 * again would be a second announcement of the same information.
 */
export function CharacterSprite({
  characterId,
  spriteKey,
  size = SPRITE_FRAME_SIZE * 2,
}: {
  characterId: string;
  /** From `mistwoodCharacterSpriteKeys`. An unknown key renders nothing rather than guessing. */
  spriteKey: string | undefined;
  size?: number;
}) {
  if (!isSpriteKey(spriteKey)) {
    // A character with no binding draws nothing rather than borrowing another resident's
    // appearance (FR-N004 AC#6). The name beside it still identifies them.
    return <span className="public-sprite" aria-hidden="true" data-sprite="none" />;
  }
  const origin = SPRITE_CELL_ORIGINS[spriteKey];
  const scale = size / SPRITE_FRAME_SIZE;
  return (
    <span
      className="public-sprite"
      aria-hidden="true"
      data-sprite={spriteKey}
      data-character={characterId}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        backgroundImage: `url(${CHARACTER_TEXTURE_URL})`,
        // The frame is `DEFAULT_PORTRAIT_FRAME` (front-facing), which sits at the cell origin.
        // Scaled with `background-size` rather than `transform`, so the element's own box is the
        // rendered size and nothing around it has to account for a transform.
        backgroundPosition: `-${origin.x * scale}px -${origin.y * scale}px`,
        backgroundSize: `${384 * scale}px ${256 * scale}px`,
      }}
    />
  );
}
