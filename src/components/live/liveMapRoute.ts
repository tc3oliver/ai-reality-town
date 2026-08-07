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

export function liveMapHref(worldId: string, base: string): string {
  return `${normalizeBase(base)}/live/${encodeURIComponent(worldId)}`;
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
