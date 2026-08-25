import { emitDynamicViewEvent } from './analyticsSink';

/**
 * The camera's four §17 events, derived from a mode TRANSITION (FR-Q007 / ART-140).
 *
 * `LiveMapView.setMode` is the single place every camera change already passes through, so the
 * events are computed from before-and-after rather than attached to each control. Two reasons,
 * and the second is the load-bearing one:
 *
 * - A control added later — a new zoom affordance, a new focus target — emits correctly without
 *   anyone remembering to instrument it.
 * - Attaching them to controls would double-count. Returning to the town view also turns follow
 *   off, so a "return" button that emitted its own event AND a follow toggle that emitted its
 *   own would report two interactions for one press, and PRD 2.0 §18.1's click-rate would be
 *   quietly inflated by exactly the amount nobody would think to check.
 *
 * Pure apart from the emit: the transition is compared, and nothing else is read.
 *
 * `zoomStep` is the only numeric payload and it is a STEP, not a scale factor and not a
 * viewport size — the camera model already works in integer steps, and a pixel dimension is a
 * device fingerprint in a way a step index is not.
 */

/** The subset of `CameraMode` this reads. Restated so `clientAnalytics` depends on nothing. */
export type CameraTransitionMode = {
  follow: boolean;
  focusId: string | null;
  zoomStep: number;
};

/**
 * `cameraModel`'s town target id.
 *
 * Kept for the pin below, and NOT used to detect a return — which was the first version of
 * this and was wrong. `TOWN_TARGET_ID` names an entry in the focus TARGET LIST;
 * `CameraControls` maps it to `focusId: null` before it ever reaches the camera mode, so a
 * mode whose `focusId` equals `'town'` does not exist and the event would never have fired.
 * The DOM test caught it. See {@link isTownView}.
 */
export const ANALYTICS_TOWN_TARGET_ID = 'town';

/**
 * The full town view: no explicit focus and no auto-follow.
 *
 * Exactly what 「回到全鎮視角」 produces (`{...INITIAL_CAMERA_MODE, follow: false}`). Turning
 * follow ON also clears the focus, but that sends the camera to the primary SCENE rather than
 * to the town, which is why `follow` is part of the test and not just `focusId`.
 *
 * One consequence, stated rather than hidden: turning follow off while already unfocused
 * produces the same camera as pressing the town button, so it counts as a return. That is the
 * honest reading — the camera did arrive at the town view — and the alternative would be
 * inferring intent from which control was pressed, which is what deriving from the transition
 * exists to avoid.
 */
function isTownView(mode: CameraTransitionMode): boolean {
  return mode.focusId === null && !mode.follow;
}

/**
 * The namespace prefixes `liveMapRoute` builds focus targets with.
 *
 * Selecting a character or a scene IS a camera transition — the active scene panel and the
 * camera controls both work by setting `focusId` — so both events are derived here rather than
 * from a second path. `cameraEvents.test.ts` pins these against the real constructors, so a
 * prefix change fails a test instead of silently emitting nothing.
 */
export const ANALYTICS_CHARACTER_PREFIX = 'character:';
export const ANALYTICS_SCENE_PREFIX = 'scene:';

export function emitCameraEvents(
  previous: CameraTransitionMode,
  next: CameraTransitionMode,
  worldId: string,
): void {
  if (previous.follow !== next.follow) {
    emitDynamicViewEvent(
      next.follow ? 'live_camera_follow_enabled' : 'live_camera_follow_disabled',
      { worldId },
    );
  }
  if (previous.zoomStep !== next.zoomStep) {
    emitDynamicViewEvent('live_zoom_used', { worldId, zoomStep: next.zoomStep });
  }
  // Only on ARRIVING. A viewer already on the town view who presses it again has not returned
  // to anything, and counting that would make the metric a button-press counter.
  if (isTownView(next) && !isTownView(previous)) {
    emitDynamicViewEvent('live_return_to_town', { worldId });
    return;
  }

  if (previous.focusId === next.focusId || next.focusId === null) return;

  if (next.focusId.startsWith(ANALYTICS_SCENE_PREFIX)) {
    emitDynamicViewEvent('live_scene_selected', {
      worldId,
      sceneId: next.focusId.slice(ANALYTICS_SCENE_PREFIX.length),
    });
  } else if (next.focusId.startsWith(ANALYTICS_CHARACTER_PREFIX)) {
    // Focusing the CAMERA on someone. Opening their card is a separate event emitted where the
    // card opens: an editorial link arrives with both, and a viewer panning to watch someone
    // has done neither of the other two things.
    emitDynamicViewEvent('live_character_selected', {
      worldId,
      characterId: next.focusId.slice(ANALYTICS_CHARACTER_PREFIX.length),
    });
  }
}
