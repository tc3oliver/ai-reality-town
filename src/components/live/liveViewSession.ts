import { characterIdFromFocusTargetId, parseLiveMapFocus } from './liveMapRoute';
import type { StorageLike } from './replaySession';

/**
 * Where the viewer had the camera when they left the live map (FR-P002 / ART-130 AC#5).
 *
 * ## What "preserves viewing progress and current focus" means here
 *
 * A viewer watching the mill, who follows a scene through to its Episode and then comes back,
 * should be looking at the mill again — not at the town view, as if they had arrived for the
 * first time. The navigation FR-P002 asks for is only continuous if the return leg is too.
 *
 * ## Why `sessionStorage`, and why the client
 *
 * The same reasoning `replaySession.ts` records, and deliberately the same mechanism rather than
 * a second one: this architecture has no server-side session and no viewer identity, and a
 * browser tab's lifetime IS the viewing session a viewer would recognise. `localStorage` would
 * outlive it and re-focus a map days later on a scene long since resolved.
 *
 * ## Fail OPEN, unlike the replay mark
 *
 * `replaySession` fails *closed* because its failure mode is auto-playing repeatedly. This one's
 * failure mode is merely arriving at the town view, which is the ordinary first-visit experience
 * — so every failure path here answers "nothing remembered" and the map opens normally. Nothing
 * becomes unreachable: the camera chrome is right there.
 *
 * ## Precedence
 *
 * An explicit `?focus=` in the URL always wins over the remembered camera. A viewer who followed
 * a link asking for a particular character is asking for that character *now*; honouring a
 * memory instead would ignore the thing they just clicked.
 */

const KEY_PREFIX = 'ai-reality-town:live:camera:';

/** Per world, so two worlds open in one tab do not overwrite each other's camera. */
function cameraKey(worldId: string): string {
  return `${KEY_PREFIX}${worldId}`;
}

export type RememberedCamera = {
  /** A `cameraModel` focus target id, or `null` for the town view. */
  focusId: string | null;
  follow: boolean;
  zoomStep: number;
};

/**
 * The tab's session storage, or `null` where there is none.
 *
 * Reading the global is wrapped for the reason `replaySessionStorage` records: a browser
 * configured to block storage throws on *access*, not merely on use.
 */
export function liveViewSessionStorage(): StorageLike | null {
  try {
    const candidate = (globalThis as { sessionStorage?: StorageLike | null }).sessionStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
}

/**
 * What the viewer was looking at, or `null` if nothing is remembered.
 *
 * Total over malformed input: a hand-edited value, a payload from an older deploy, or a
 * half-written record all yield `null` rather than throwing. `zoomStep` is range-checked here
 * rather than trusted, because a stored `1e9` would be handed straight to the camera.
 */
export function readRememberedCamera(
  worldId: string,
  storage: StorageLike | null,
): RememberedCamera | null {
  if (storage === null) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(cameraKey(worldId));
  } catch {
    return null;
  }
  if (raw === null || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const focusId = record.focusId;
  if (focusId !== null && typeof focusId !== 'string') return null;
  if (typeof record.follow !== 'boolean') return null;
  const zoomStep = record.zoomStep;
  if (typeof zoomStep !== 'number' || !Number.isFinite(zoomStep)) return null;
  return {
    focusId: focusId === null || focusId.length === 0 ? null : focusId,
    follow: record.follow,
    // The camera clamps this itself, but a stored value is untrusted input and a bounded one
    // keeps the clamp from being the only thing between a bad record and the viewport.
    zoomStep: Math.max(-8, Math.min(8, Math.trunc(zoomStep))),
  };
}

/** Record the camera. Silent on failure — see "fail open" above. */
export function rememberCamera(
  worldId: string,
  camera: RememberedCamera,
  storage: StorageLike | null,
): void {
  if (storage === null) return;
  try {
    storage.setItem(cameraKey(worldId), JSON.stringify(camera));
  } catch {
    // A full or read-only storage costs the viewer their camera on return, and nothing else.
  }
}

/** How the live map should open: the camera to seed, and any card to open with it. */
export type LiveEntry = {
  /** `undefined` means "no opinion" — the map uses its own default. */
  mode: { follow: boolean; focusId: string | null; zoomStep: number } | undefined;
  openCharacterId: string | null;
};

const NO_ENTRY: LiveEntry = { mode: undefined, openCharacterId: null };

/**
 * Decide how the live map opens (FR-P002 / ART-130 AC#5).
 *
 * Pure, and split out of `LiveMapPage` deliberately: this is the whole of the precedence rule,
 * and precedence rules that live inline in a component get tested through a renderer or not at
 * all. Every branch below is reachable from a unit test with a fake storage.
 *
 * PRECEDENCE. An explicit `?focus=` always wins over the remembered camera, because a viewer who
 * just followed a link asking for a particular character is asking for that character NOW —
 * honouring a memory instead would ignore the thing they clicked. Absent both, the map opens on
 * its own default and nothing here has an opinion.
 */
export function resolveLiveEntry({
  search,
  worldId,
  storage,
}: {
  search: string;
  worldId: string;
  storage: StorageLike | null;
}): LiveEntry {
  const linked = parseLiveMapFocus(search);
  if (linked !== null) {
    return {
      // An explicit focus overrides auto-follow, exactly as pressing a focus button does —
      // otherwise the primary scene pulls the camera straight back off the linked target.
      mode: { follow: false, focusId: linked.targetId, zoomStep: 0 },
      openCharacterId: linked.openCard ? characterIdFromFocusTargetId(linked.targetId) : null,
    };
  }
  const remembered = readRememberedCamera(worldId, storage);
  if (remembered === null) return NO_ENTRY;
  return {
    mode: { follow: remembered.follow, focusId: remembered.focusId, zoomStep: remembered.zoomStep },
    // Never re-opened from memory: a card is something a viewer opens, and reopening it on
    // return would be the page making a decision on their behalf every single time.
    openCharacterId: null,
  };
}
