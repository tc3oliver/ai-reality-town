import { emitDynamicViewEvent } from '../../analytics/analyticsSink';
import type { CameraMode } from '../world/cameraModel';
import type { ActiveScenePanelModel } from './activeSceneModel';

/**
 * The active scene panel (FR-O003 / ART-122 AC#1/#2/#3/#5).
 *
 * A sibling of {@link ./CameraControls} and bound by the same rule: every affordance is a
 * real `<button>` layered beside the canvas, never a Pixi pointer handler. `components/world/`
 * therefore keeps the property ART-113 proved about it -- no handler anywhere in the renderer
 * -- and focusing a scene is keyboard-reachable and announceable for free.
 *
 * Every handler below calls `onModeChange`, a React `useState` setter one component up. There
 * is no request API named in this file, which `liveMapSurface.test.ts` asserts structurally
 * and the `clientLive` module boundary enforces: looking at a scene must not be able to make
 * the world produce one.
 */
export function ActiveScenePanel({
  model,
  mode,
  onModeChange,
}: {
  model: ActiveScenePanelModel;
  mode: CameraMode;
  onModeChange: (mode: CameraMode) => void;
}) {
  return (
    <section className="live-active-scenes mt-3" aria-labelledby="live-active-scenes">
      <h2 id="live-active-scenes" className="text-xl font-semibold">
        目前場景
      </h2>

      {!model.hasScenes ? (
        <p className="public-muted text-sm">目前沒有進行中的場景。</p>
      ) : (
        <ul className="mt-1">
          {model.scenes.map((scene) => (
            <li key={scene.key} className="mt-2">
              <article aria-label={scene.title}>
                <h3 className="font-medium">
                  {scene.title}
                  {scene.ended && <span className="public-muted text-sm">(已結束)</span>}
                </h3>
                {scene.locationLabel !== null && (
                  <p className="public-muted text-sm">地點:{scene.locationLabel}</p>
                )}
                {scene.summary.length > 0 && <p className="text-sm">{scene.summary}</p>}
                {scene.participantCharacterIds.length > 0 && (
                  <p className="text-sm">登場角色:{scene.participantCharacterIds.join('、')}</p>
                )}
                {scene.arcIds.length > 0 && (
                  <p className="text-sm">相關故事線:{scene.arcIds.join('、')}</p>
                )}

                <div className="flex flex-wrap gap-2 mt-1">
                  {scene.focusTargetId !== null && (
                    <button
                      type="button"
                      className="public-tap"
                      aria-pressed={mode.focusId === scene.focusTargetId}
                      // An explicit focus overrides auto-follow, exactly as it does in the
                      // camera chrome, so the two entry points cannot disagree.
                      onClick={() => onModeChange({ ...mode, focusId: scene.focusTargetId })}
                    >
                      聚焦此場景
                    </button>
                  )}
                  {scene.episodeHref !== null && (
                    <a
                      className="public-tap"
                      href={scene.episodeHref}
                      // FR-Q007 / ART-140. An ordinary same-origin navigation, so the handler
                      // only records that it happened — it does not preventDefault and does not
                      // wait for anything. Analytics must never sit between a viewer and a link.
                      onClick={() => emitDynamicViewEvent('live_episode_opened', {
                        // `key` is the scene id where the scene has one — the model builds it
                        // from `sceneId` and the sanitiser drops it if it is not a short
                        // identifier, so no invented field is needed to attribute the click.
                        sceneId: scene.key,
                      })}
                    >
                      閱讀當日 Episode
                    </a>
                  )}
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
