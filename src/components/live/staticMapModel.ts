/**
 * Geometry for the static floor plan (FR-O010 / ART-127, ladder rung 3).
 *
 * ## Why rung 3 is DOM, not a frozen canvas
 *
 * "Static map with last known positions" cannot mean "the Pixi stage, stopped". The rung
 * exists precisely for the case where Pixi cannot run — no WebGL, or a renderer that threw —
 * so a frozen canvas is unreachable in the only situation that would need it. Drawing the
 * plan as SVG makes the rung reachable by construction: no WebGL, no textures, no GPU.
 *
 * Two consequences worth having anyway:
 *
 * - It is real DOM, so a screen reader can read the plan. The animated map is a `<canvas>`
 *   and is opaque to assistive technology by nature, which is why ART-113 put every control
 *   in the DOM beside it. Here the CONTENT is in the DOM too.
 * - It keeps the spatial information a text list throws away. "何俊 is at the mill" and "何俊
 *   is at the mill, which is across the square from the newspaper" are different amounts of
 *   world, and rung 3 exists to be more than rung 4.
 *
 * ## One source of positions, not two
 *
 * The plan is projected from the SAME `ReadOnlyWorldViewModel` the Pixi renderer consumes and
 * the SAME `FocusTarget[]` the camera controls are built from. Nothing here re-derives a
 * position or re-looks-up a name, so the static map is structurally incapable of disagreeing
 * with the animated one about who is where — which would otherwise be the obvious failure of
 * a second rendering path, and the kind that only shows up in the degraded state nobody
 * looks at.
 *
 * Pure: no React, no DOM, no clock, no randomness.
 */

import type { FocusTarget } from '../world/cameraModel';
import type { ReadOnlyWorldViewModel } from '../world/worldViewModel';

/** A room on the plan, in world pixels. */
export type StaticMapRoom = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** A person on the plan, in world pixels. */
export type StaticMapOccupant = {
  characterId: string;
  label: string;
  x: number;
  y: number;
  /** The room they are inside, or `null` when they are between places. */
  roomId: string | null;
  /** Room name, or `null`. Resolved here so the component does a second lookup nowhere. */
  roomName: string | null;
};

export type StaticMapModel = {
  /** SVG viewBox extent — the map's own pixel size, so the plan is to scale. */
  width: number;
  height: number;
  rooms: StaticMapRoom[];
  occupants: StaticMapOccupant[];
  /** People grouped by room, for the text summary beside the plan. */
  roster: Array<{ roomId: string | null; roomName: string; occupants: StaticMapOccupant[] }>;
};

/** A footprint as `data/mistwood.ts` publishes it: tile coordinates, not pixels. */
export type StaticMapFootprint = {
  readonly id: string;
  readonly name: string;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
};

/** Where a character is, when they are in no room at all. */
export const STATIC_MAP_BETWEEN_LABEL = '路上';

/** People whose room cannot be resolved sort last, then by label, then by id. */
function compareOccupants(a: StaticMapOccupant, b: StaticMapOccupant): number {
  return a.label.localeCompare(b.label) || a.characterId.localeCompare(b.characterId);
}

/**
 * Project the world view model onto a floor plan.
 *
 * `tileSize` converts the footprints (authored in tiles) into the same pixel space the view
 * model's character coordinates already use. Passing it in rather than importing a constant
 * keeps this module free of the map data and lets a test place a character on a room edge
 * without arithmetic.
 */
export function composeStaticMap(input: {
  viewModel: ReadOnlyWorldViewModel;
  footprints: readonly StaticMapFootprint[];
  targets: readonly FocusTarget[];
  tileSize: number;
}): StaticMapModel {
  const { viewModel, footprints, targets, tileSize } = input;

  const rooms: StaticMapRoom[] = footprints.map((footprint) => ({
    id: footprint.id,
    name: footprint.name,
    x: footprint.rect.x * tileSize,
    y: footprint.rect.y * tileSize,
    width: footprint.rect.width * tileSize,
    height: footprint.rect.height * tileSize,
  }));
  const roomById = new Map(rooms.map((room) => [room.id, room]));

  /**
   * Names come from the camera's targets, which are namespaced `character:<id>`.
   *
   * Reusing them rather than taking a second name table is the whole point: the camera
   * controls and the plan then cannot name the same person differently.
   */
  const labelByCharacterId = new Map<string, string>();
  for (const target of targets) {
    if (target.kind !== 'character') continue;
    const characterId = target.id.slice(target.id.indexOf(':') + 1);
    if (characterId.length > 0) labelByCharacterId.set(characterId, target.label);
  }

  const occupants: StaticMapOccupant[] = viewModel.characters.map((character) => {
    // `semanticLocationId` first: it is the Canon-anchored answer to "where are they", and
    // `x`/`y` are a rendering of it. Falling back to a geometric hit test covers a character
    // whose location id names no authored footprint, which is a data state the map itself
    // tolerates and this rung must not crash on.
    const declared = roomById.get(character.semanticLocationId) ?? null;
    const containing = declared ?? rooms.find((room) =>
      character.x >= room.x
      && character.x <= room.x + room.width
      && character.y >= room.y
      && character.y <= room.y + room.height) ?? null;

    return {
      characterId: character.characterId,
      label: labelByCharacterId.get(character.characterId) ?? character.characterId,
      x: character.x,
      y: character.y,
      roomId: containing?.id ?? null,
      roomName: containing?.name ?? null,
    };
  });

  // Rooms in plan order (so the list reads in the same order as the drawing), then the
  // between-places group. A room with nobody in it is omitted: an empty heading is noise in
  // a summary whose whole job is "where is everyone".
  const roster: StaticMapModel['roster'] = [];
  for (const room of rooms) {
    const inRoom = occupants.filter((occupant) => occupant.roomId === room.id).sort(compareOccupants);
    if (inRoom.length > 0) roster.push({ roomId: room.id, roomName: room.name, occupants: inRoom });
  }
  const between = occupants.filter((occupant) => occupant.roomId === null).sort(compareOccupants);
  if (between.length > 0) {
    roster.push({ roomId: null, roomName: STATIC_MAP_BETWEEN_LABEL, occupants: between });
  }

  return {
    width: viewModel.worldWidth,
    height: viewModel.worldHeight,
    rooms,
    occupants,
    roster,
  };
}
