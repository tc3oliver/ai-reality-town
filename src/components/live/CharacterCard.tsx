import { useEffect, useRef } from 'react';

import {
  DEFAULT_PORTRAIT_FRAME,
  SPRITE_FRAME_ORDER,
  SPRITE_FRAME_SIZE,
} from '../../../data/spritesheets/catalogue';
import type { ReadOnlySpriteAsset } from '../world/worldViewModel';
import type { CharacterCardViewModel } from './characterCardModel';

/**
 * The public character card (FR-O006 / ART-124).
 *
 * A sibling of {@link ./ActiveScenePanel} and {@link ./CameraControls}, bound by the same rules:
 * props in, no query and no mutation, every affordance a real DOM element beside the canvas
 * rather than a Pixi hit test. The card is OPENED from the character list in the camera chrome
 * for exactly that reason — `src/components/world/` keeps the property ART-113 proved about it
 * (no handler, no `on*` prop, no interactive display object anywhere in the renderer), and the
 * open affordance is keyboard-reachable and announceable for free.
 *
 * It renders as an ordinary block-stacked section rather than as a modal overlay. There is no
 * dialogue pattern anywhere in this codebase to follow, a correct one needs focus trapping and
 * restoration to be worth having, and covering the canvas would hide the character the card is
 * about — which is the one thing a viewer opened it to look at.
 *
 * Every field comes from {@link composeCharacterCardViewModel}, which builds the model from
 * named fields only; this file adds no field of its own, so there is no second place a private
 * value could enter the render.
 *
 * FOCUS (NFR-009, the bar ART-93/94/135 set). The card renders BELOW the button that opened it,
 * so without intervention a keyboard or screen-reader user presses "角色卡" and nothing appears
 * to happen — the new content is behind them in the tab order. On open, focus moves to the card
 * itself (`tabIndex={-1}`, focusable programmatically but never a tab stop of its own), which
 * announces the section by its heading. On close, {@link LiveMapView} returns focus to the
 * control that opened it rather than dropping it on `<body>`. The `role="status"` line is for
 * the case focus does NOT move: switching from one character's card to another re-renders in
 * place, and the polite announcement is what says whose card is now open.
 */
export function CharacterCard({
  viewModel,
  spriteAsset,
  onClose,
}: {
  viewModel: CharacterCardViewModel;
  /** The resolved sheet for `viewModel.spriteAssetKey`, from the map's own asset table (AC#6). */
  spriteAsset?: ReadOnlySpriteAsset;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  // Keyed on the character, so opening a card moves focus and a payload arriving for the SAME
  // character (loading -> ready) does not yank it back off whatever the viewer moved to.
  const { characterId } = viewModel;
  useEffect(() => {
    cardRef.current?.focus();
  }, [characterId]);

  return (
    <section
      ref={cardRef}
      tabIndex={-1}
      className="live-character-card mt-3"
      aria-labelledby="live-character-card"
    >
      <div className="flex items-start gap-2">
        <CharacterPortrait asset={spriteAsset} name={viewModel.name} />
        <div className="flex-1">
          <h2 id="live-character-card" className="text-xl font-semibold">
            {viewModel.name}
          </h2>
          <p className="public-muted text-sm">{viewModel.occupation}</p>
        </div>
        <button
          type="button"
          className="public-tap"
          aria-label={`關閉 ${viewModel.name} 的角色卡`}
          onClick={onClose}
        >
          關閉
        </button>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        已開啟 {viewModel.name} 的角色卡。
      </p>

      {viewModel.status === 'loading' && (
        <p className="public-muted text-sm mt-2">載入角色資料中…</p>
      )}

      {/* A completed read that found no published projection — a character whose model has never
          been built. Saying "loading" here would wait forever for something that is not coming.
          The map still knows where they are, so the card degrades to what it does know rather
          than to nothing, and says which half is missing. */}
      {viewModel.status === 'unavailable' && (
        <p className="public-muted text-sm mt-2">
          這個角色的公開資料尚未建立,以下只有地圖上的即時動態。
        </p>
      )}

      {/* AC#2, and the half that survives an unbuilt projection: every field here comes from the
          motion the map is already drawing. One list rather than separate sentences, so a screen
          reader announces the item count before reading them. */}
      {viewModel.status !== 'loading' && (
        <ul className="text-sm mt-2">
          <li>目前地點:{viewModel.locationLabel}</li>
          <li>移動狀態:{viewModel.movementLabel}</li>
          <li>目前活動:{viewModel.activityLabel}</li>
          {/* FR-O004 / ART-123 AC#1. Who with, then what about — both from the same active
              scene the map is drawing, so the card and the panel cannot disagree.

              Rendered as TEXT in the DOM rather than on the canvas. The canvas draws no text at
              all (see `conversationState.ts`), which is what makes AC#2 and AC#3 structural on
              the map surface rather than a rule someone has to remember. */}
          {viewModel.conversationPartnerIds.length > 0 && (
            <li>與 {viewModel.conversationPartnerIds.join('、')} 交談中</li>
          )}
          {/* Absent, not blank, when the scene's text is withheld or unpublished: an empty
              「談話內容:」 row would imply the conversation had nothing in it (AC#5 — the state
              above still says they are talking). */}
          {viewModel.conversationHint.length > 0 && (
            <li>談話內容:{viewModel.conversationHint}</li>
          )}
          {viewModel.hasContent && <li>情緒:{viewModel.emotionalState}</li>}
        </ul>
      )}

      {viewModel.status === 'ready' && (
        <>
          {viewModel.publicProfile.length > 0 && (
            <p className="text-sm mt-2">{viewModel.publicProfile}</p>
          )}

          {viewModel.publicGoal.length > 0 && (
            <p className="text-sm mt-2">公開目標:{viewModel.publicGoal}</p>
          )}

          <div className="mt-2">
            <h3 id="live-character-card-arcs" className="font-medium">
              進行中的故事線
            </h3>
            {viewModel.activeArcs.length === 0 ? (
              <p className="public-muted text-sm">目前沒有進行中的故事線。</p>
            ) : (
              <ul className="text-sm" aria-labelledby="live-character-card-arcs">
                {viewModel.activeArcs.map((arc) => (
                  <li key={arc.arcId}>
                    {arc.arcId}
                    {arc.sceneTitle.length > 0 && (
                      <span className="public-muted">(場景:{arc.sceneTitle})</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-2">
            <h3 id="live-character-card-events" className="font-medium">
              近期大事
            </h3>
            {viewModel.recentEvents.length === 0 ? (
              <p className="public-muted text-sm">尚無與此角色相關的近期大事。</p>
            ) : (
              <ul className="text-sm" aria-labelledby="live-character-card-events">
                {viewModel.recentEvents.map((event) => (
                  <li key={event.eventId}>
                    {event.label}
                    {event.episodeHref !== null && (
                      // Every row renders the same visible text, so the accessible name carries
                      // the event it belongs to (WCAG 2.4.4).
                      <a
                        href={event.episodeHref}
                        // `public-tap` for the touch target (FR-O008 AC#3): it is a standalone
                        // control at the end of a row, not a link inside a sentence.
                        className="public-tap ml-2"
                        aria-label={`本日故事:${event.label}`}
                      >
                        本日故事
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

        </>
      )}

      {/* AC#4, outside the `ready` branch on purpose: a card that could not load the projection
          is exactly when a viewer most needs the page that can. */}
      {viewModel.status !== 'loading' && (
        <p className="mt-2 text-sm">
          <a className="public-tap" href={viewModel.characterHref}>
            查看 {viewModel.name} 的完整角色頁
          </a>
        </p>
      )}
    </section>
  );
}

/**
 * The character's front-facing sprite frame, drawn as a DOM element (AC#6).
 *
 * The sheet is the one the canvas is drawing with — resolved through `useSpriteAssets()` and
 * handed down — rather than a portrait looked up somewhere else, so the card cannot show a
 * character the map does not. A palette variant therefore appears here recoloured exactly as it
 * appears on the map, including the documented fallback to the base texture where no canvas is
 * available.
 *
 * Decorative: the character's name is already the section's heading, so announcing the sprite
 * again would be a second announcement of the same information.
 */
function CharacterPortrait({ asset, name }: { asset?: ReadOnlySpriteAsset; name: string }) {
  const frame = asset?.spritesheetData.frames[SPRITE_FRAME_ORDER[DEFAULT_PORTRAIT_FRAME]]?.frame;
  if (asset === undefined || frame === undefined) {
    // A character with no binding draws nothing rather than borrowing another resident's
    // appearance (FR-N004 AC#6). The name still identifies them.
    return <span className="live-character-portrait" aria-hidden="true" data-portrait="none" />;
  }
  return (
    <span
      className="live-character-portrait"
      aria-hidden="true"
      data-portrait={name}
      style={{
        width: `${SPRITE_FRAME_SIZE}px`,
        height: `${SPRITE_FRAME_SIZE}px`,
        backgroundImage: `url(${asset.textureUrl})`,
        backgroundPosition: `-${frame.x}px -${frame.y}px`,
      }}
    />
  );
}
