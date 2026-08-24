/**
 * Live route resolution (ART-118 / FR-O001 AC#8).
 *
 * PRD 2.0 puts the live world at a real path, `/live/<worldId>`, not behind a
 * hash. This module owns that shape and nothing else: it is pure, imports
 * nothing, and is its own architecture module (`clientLiveRoute`) so both the
 * live map and the existing public pages can link to the same URLs without
 * either depending on the other.
 *
 * Two routes and one redirect:
 *
 *   `<base>/live/<worldId>`        the animated map
 *   `<base>/live/<worldId>/text`   the text Live View, the non-map equivalent
 *                                  required by NFR-009 AC#3
 *   `#live/<worldId>`              the legacy hash, which redirects to the map
 *                                  with the world identifier preserved
 *
 * `base` is a parameter rather than a read of `import.meta.env.BASE_URL`. Vite
 * replaces that expression at build time and Jest cannot see it, so a pure
 * module that read it directly would be untestable; the calling component
 * passes it in.
 */

/**
 * THE CAMERA FOCUS TARGET NAMESPACE (ART-118, relocated here by ART-130 / FR-P002).
 *
 * These identifiers are shared by three modules that are not allowed to depend on each other:
 * `components/world/cameraModel` produces them, `components/live` renders controls that carry
 * them, and — since ART-130 — `components/public` builds `?focus=` links out of them. Only this
 * module is reachable from all three (`clientLiveRoute` may depend on nothing, which is why it is
 * safe for anything to depend on it), so this is where they live.
 *
 * The alternative was writing `` `character:${id}` `` a second time in `components/public`. That
 * is two namespaces that happen to agree today: change the prefix in one and every editorial link
 * silently stops resolving, dropping viewers at an unfocused map with nothing failing anywhere.
 */
export const TOWN_TARGET_ID = 'town';

export function locationTargetId(locationId: string): string {
  return `location:${locationId}`;
}

export function characterTargetId(characterId: string): string {
  return `character:${characterId}`;
}

export function sceneTargetId(sceneId: string): string {
  return `scene:${sceneId}`;
}

/**
 * The character a focus target names, or `null` if it names something else.
 *
 * The prefix is derived from {@link characterTargetId} itself rather than written out again, so
 * the two cannot drift: if the producer ever changes its namespace, this follows it.
 */
export function characterIdFromFocusTargetId(targetId: string): string | null {
  const prefix = characterTargetId('');
  if (!targetId.startsWith(prefix)) return null;
  const characterId = targetId.slice(prefix.length);
  return characterId.length > 0 ? characterId : null;
}

export type LiveMapView = 'map' | 'text';

export interface LiveMapRoute {
  worldId: string;
  view: LiveMapView;
}

/** `/ai-town/` and `/ai-town` and `ai-town/` all normalise to `/ai-town`; `/` to `''`. */
export function normalizeBase(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '');
  if (trimmed === '' || trimmed === '.') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** The part of `pathname` below `base`, or `null` when the path is outside it. */
function stripBase(pathname: string, base: string): string | null {
  const prefix = normalizeBase(base);
  if (prefix === '') return pathname.replace(/^\/+/, '');
  if (pathname === prefix) return '';
  if (!pathname.startsWith(`${prefix}/`)) return null;
  return pathname.slice(prefix.length + 1);
}

/**
 * Resolve `<base>/live/<worldId>` and its `/text` sibling. Returns null for any
 * other path, so the caller can fall through to the remaining hash routes.
 */
export function parseLiveMapPath(pathname: string, base: string): LiveMapRoute | null {
  const rest = stripBase(pathname, base);
  if (rest === null) return null;
  const match = /^live\/([^/?#]+)(\/text)?\/?$/.exec(rest);
  if (match === null) return null;
  const worldId = decodeURIComponent(match[1]);
  if (worldId.length === 0) return null;
  return { worldId, view: match[2] === undefined ? 'map' : 'text' };
}

/** The retired `#live/<worldId>` entry point. Bare or malformed hashes yield null. */
export function parseLegacyLiveHash(hash: string): { worldId: string } | null {
  const match = /^#?live\/([^/?#]+)$/.exec(hash);
  if (match === null) return null;
  const worldId = decodeURIComponent(match[1]);
  return worldId.length > 0 ? { worldId } : null;
}

/**
 * What an editorial page asked the live map to look at (FR-P002 / ART-130).
 *
 * `targetId` is an OPAQUE string here. Its shape belongs to `components/world/cameraModel`
 * (`character:<id>`, `location:<id>`, `scene:<id>`, `town`), and this module is deliberately
 * dependency-free — it is its own architecture module precisely so the live map and the public
 * pages can agree on URLs without either depending on the other. Carrying the value rather than
 * validating it is what keeps that true; the live map resolves it against the targets it actually
 * has, and an id that resolves to nothing simply leaves the camera where it was.
 */
export interface LiveMapFocusIntent {
  targetId: string;
  /** Whether the viewer also asked for that character's card, not just the camera. */
  openCard: boolean;
}

export const LIVE_FOCUS_PARAM = 'focus';
export const LIVE_CARD_PARAM = 'card';

/**
 * Read a focus intent out of a `?focus=…&card=1` query string.
 *
 * Returns `null` for an absent, empty or malformed parameter rather than throwing: a link
 * someone edited by hand, or one carrying an id from an older deploy, must degrade to "the live
 * map, unfocused" — which is a working page — rather than to an error.
 */
export function parseLiveMapFocus(search: string): LiveMapFocusIntent | null {
  const query = search.startsWith('?') ? search.slice(1) : search;
  if (query.length === 0) return null;
  const params = new URLSearchParams(query);
  const targetId = (params.get(LIVE_FOCUS_PARAM) ?? '').trim();
  if (targetId.length === 0) return null;
  return { targetId, openCard: params.get(LIVE_CARD_PARAM) === '1' };
}

export function liveMapHref(
  worldId: string,
  base: string,
  /** Omitted links to the map as it always did, so every existing caller is unchanged. */
  focus?: LiveMapFocusIntent | null,
): string {
  const path = `${normalizeBase(base)}/live/${encodeURIComponent(worldId)}`;
  if (focus === undefined || focus === null || focus.targetId.length === 0) return path;
  const params = new URLSearchParams({ [LIVE_FOCUS_PARAM]: focus.targetId });
  if (focus.openCard) params.set(LIVE_CARD_PARAM, '1');
  return `${path}?${params.toString()}`;
}

export function textLiveHref(worldId: string, base: string): string {
  return `${liveMapHref(worldId, base)}/text`;
}

/**
 * Where a legacy hash should be sent, or null when it is not a live hash.
 *
 * The world identifier survives the redirect, which is the half of AC#8 that a
 * blanket "send `#live/*` to `/live`" rule would silently lose.
 */
export function redirectForLegacyHash(hash: string, base: string): string | null {
  const legacy = parseLegacyLiveHash(hash);
  return legacy === null ? null : liveMapHref(legacy.worldId, base);
}
