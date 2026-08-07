import { PublicPageFrame } from '../public/PublicPageFrame';
import { textLiveHref } from './liveMapRoute';

/**
 * What a viewer sees when the animated map cannot be drawn (ART-118 / FR-O001 AC#7).
 *
 * Informational, not a second renderer. Pixi 7 dropped the canvas renderer into
 * a separate `@pixi/canvas-*` package that this project does not install, so
 * "fall back to Canvas" would mean adopting a whole second rendering path for a
 * case the text Live View already covers completely -- it publishes the same
 * world state as screen-reader-readable text and is the NFR-009 AC#3 equivalent
 * of the map. The honest fallback is therefore to say what happened and hand
 * the viewer to that view rather than to draw a worse map.
 *
 * `reason` distinguishes "this browser has no WebGL" from "the renderer failed
 * after starting", because the first is fixable by the viewer and the second is
 * not.
 */
export function LiveMapFallback({
  worldId,
  base,
  reason = 'no-webgl',
}: {
  worldId: string;
  base: string;
  reason?: 'no-webgl' | 'render-failed';
}) {
  return (
    <PublicPageFrame worldId={worldId}>
      <h1 className="text-3xl font-bold">實況地圖無法顯示</h1>
      <p className="mt-2">
        {reason === 'no-webgl'
          ? '這個瀏覽器沒有可用的 WebGL,動態地圖無法繪製。'
          : '動態地圖在載入過程中失敗了。'}
        世界仍在運作,你可以改用文字實況,它提供同樣的世界狀態。
      </p>
      <p className="mt-2">
        <a className="public-tap" href={textLiveHref(worldId, base)}>
          開啟文字實況(不需地圖)
        </a>
      </p>
      <p className="mt-2 text-sm public-muted">
        文字實況包含地點、角色位置、活躍場景、最近事件與進行中的故事線。無論使用哪一種畫面,觀看都不會改變世界。
      </p>
    </PublicPageFrame>
  );
}
