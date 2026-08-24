import {
  characterTargetId,
  liveMapHref,
  locationTargetId,
  sceneTargetId,
} from '../live/liveMapRoute';

/**
 * Links from the editorial surfaces INTO the live map (FR-P002 / ART-130).
 *
 * FR-P002's problem statement is that Live Town and the editorial surfaces exist as disconnected
 * routes, so a viewer cannot move between "what is happening now" and "what it means". The
 * Episode → character and arc → character directions already existed as links to the *pages*;
 * what was missing is the direction that answers **where they are right now**, which is the map.
 *
 * The target ids are built with `cameraModel`'s own constructors rather than by writing
 * `` `character:${id}` `` here. That is the difference between one namespace and two: if the
 * camera ever changes its prefix, every link built through this module follows it, and a link
 * that stops resolving silently drops the viewer at an unfocused map — a working page, but the
 * wrong one. `liveMapLinks.test.ts` pins the round trip against `characterIdFromFocusTargetId`,
 * so producer and consumer are checked against each other rather than against a literal.
 *
 * `import.meta.env.BASE_URL` is read here rather than threaded through every caller. Vite
 * replaces it at build time and Jest cannot see it, so the tests pass `base` explicitly through
 * the `*HrefWithBase` forms and the components use the convenience wrappers.
 */

function currentBase(): string {
  // `import.meta.env` is absent under Jest's CommonJS interop; `''` normalises to no prefix,
  // which is the correct answer for a test and for a site served from the root.
  return (import.meta.env?.BASE_URL as string | undefined) ?? '';
}

/** The live map, focused on a character, with their card open (AC#2). */
export function characterMapHrefWithBase(worldId: string, characterId: string, base: string): string {
  return liveMapHref(worldId, base, {
    targetId: characterTargetId(characterId),
    // The card too, not just the camera: "where is this person" and "what are they doing" are
    // one question, and the map alone answers only half of it.
    openCard: true,
  });
}

/** The live map, focused on a location (AC#2, AC#3). */
export function locationMapHrefWithBase(worldId: string, locationId: string, base: string): string {
  return liveMapHref(worldId, base, {
    targetId: locationTargetId(locationId),
    openCard: false,
  });
}

/** The live map, focused on a scene currently on it (AC#3). */
export function sceneMapHrefWithBase(worldId: string, sceneId: string, base: string): string {
  return liveMapHref(worldId, base, { targetId: sceneTargetId(sceneId), openCard: false });
}

export function characterMapHref(worldId: string, characterId: string): string {
  return characterMapHrefWithBase(worldId, characterId, currentBase());
}

export function locationMapHref(worldId: string, locationId: string): string {
  return locationMapHrefWithBase(worldId, locationId, currentBase());
}

export function sceneMapHref(worldId: string, sceneId: string): string {
  return sceneMapHrefWithBase(worldId, sceneId, currentBase());
}
