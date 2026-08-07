import {
  INITIAL_CAMERA_MODE,
  TOWN_TARGET_ID,
  nextZoomStep,
  type CameraMode,
  type FocusTarget,
} from '../world/cameraModel';

/**
 * The camera chrome (ART-118 / FR-O005 AC#3/#5).
 *
 * Every affordance on the live map lives here, as real `<button>` elements
 * layered over the canvas -- never as Pixi pointer handlers. That is a
 * deliberate architectural choice with three consequences:
 *
 * 1. `src/components/world/` keeps the property ART-113 proved about it: no
 *    handler, no `on*` prop, no interactive display object anywhere in the
 *    renderer. Clicking the canvas still reaches nothing at all.
 * 2. Focus is keyboard-reachable and screen-reader-announceable for free
 *    (NFR2-006). A canvas hit test is neither.
 * 3. Every handler below is a call to `onModeChange`, which is a React
 *    `useState` setter one component up. No handler here can reach the network:
 *    `liveMapSurface.test.ts` asserts this file names no request API at all,
 *    and the `clientLive` boundary forbids the write symbols outright (AC#4).
 */
export function CameraControls({
  targets,
  mode,
  onModeChange,
}: {
  targets: readonly FocusTarget[];
  mode: CameraMode;
  onModeChange: (mode: CameraMode) => void;
}) {
  const locations = targets.filter((target) => target.kind === 'location');
  const characters = targets.filter((target) => target.kind === 'character');

  return (
    <section className="live-camera-controls mt-3" aria-labelledby="live-camera-controls">
      <h2 id="live-camera-controls" className="text-xl font-semibold">
        鏡頭
      </h2>

      <div className="flex flex-wrap gap-2 mt-1">
        <button
          type="button"
          className="public-tap"
          // Auto-follow is switched off as well, otherwise the primary scene
          // would pull the camera straight back off the town view.
          onClick={() => onModeChange({ ...INITIAL_CAMERA_MODE, follow: false })}
        >
          回到全鎮視角
        </button>
        <button
          type="button"
          className="public-tap"
          onClick={() => onModeChange({ ...mode, zoomStep: nextZoomStep(mode.zoomStep, 1) })}
        >
          拉近
        </button>
        <button
          type="button"
          className="public-tap"
          onClick={() => onModeChange({ ...mode, zoomStep: nextZoomStep(mode.zoomStep, -1) })}
        >
          拉遠
        </button>
        <button
          type="button"
          className="public-tap"
          aria-pressed={mode.follow}
          onClick={() => onModeChange({ ...mode, follow: !mode.follow, focusId: null })}
        >
          自動跟隨主要場景
        </button>
      </div>

      <FocusList
        headingId="live-focus-locations"
        heading="聚焦地點"
        targets={locations}
        mode={mode}
        onModeChange={onModeChange}
        emptyLabel="尚無地點。"
      />
      <FocusList
        headingId="live-focus-characters"
        heading="聚焦角色"
        targets={characters}
        mode={mode}
        onModeChange={onModeChange}
        emptyLabel="目前沒有已發布的角色動態。"
      />
    </section>
  );
}

function FocusList({
  headingId,
  heading,
  targets,
  mode,
  onModeChange,
  emptyLabel,
}: {
  headingId: string;
  heading: string;
  targets: readonly FocusTarget[];
  mode: CameraMode;
  onModeChange: (mode: CameraMode) => void;
  emptyLabel: string;
}) {
  return (
    <div className="mt-2">
      <h3 id={headingId} className="font-medium">
        {heading}
      </h3>
      {targets.length === 0 ? (
        <p className="public-muted text-sm">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-labelledby={headingId}>
          {targets.map((target) => (
            <li key={target.id}>
              <button
                type="button"
                className="public-tap"
                aria-pressed={mode.focusId === target.id}
                // Focusing is an explicit choice, so it overrides auto-follow
                // until the viewer turns follow back on or returns to the town.
                onClick={() =>
                  onModeChange({
                    ...mode,
                    focusId: target.id === TOWN_TARGET_ID ? null : target.id,
                  })
                }
              >
                {target.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
