/**
 * The replay chrome (FR-O013 / ART-121 AC#6, AC#8).
 *
 * Two real `<button>` elements, following `CameraControls.tsx` exactly and for the same three
 * reasons: `src/components/world/` keeps its "no handler anywhere in the renderer" property,
 * both controls are keyboard-reachable and announceable for free, and each handler is a
 * `useState` setter one component up. Nothing here can reach the network —
 * `liveMapSurface.test.ts` asserts this file names no request API at all, and the `clientLive`
 * boundary forbids the write symbols outright.
 *
 * The manual trigger is available in every state, including after auto-play has already fired
 * and including under Reduced Motion (which suppresses only the automatic one). A viewer who
 * wants to see it again asks for it; nothing asks on their behalf twice.
 */
export function ReplayControls({
  available,
  playing,
  onSkip,
  onReplay,
}: {
  /** Whether a replay exists to play at all. */
  available: boolean;
  playing: boolean;
  onSkip: () => void;
  onReplay: () => void;
}) {
  return (
    <section className="live-replay-controls mt-3" aria-labelledby="live-replay-controls">
      <h2 id="live-replay-controls" className="text-xl font-semibold">
        重播
      </h2>
      {available ? (
        <div className="flex flex-wrap gap-2 mt-1">
          {playing ? (
            <button type="button" className="public-tap" onClick={onSkip}>
              跳過重播
            </button>
          ) : (
            <button type="button" className="public-tap" onClick={onReplay}>
              重播今日事件
            </button>
          )}
        </div>
      ) : (
        <p className="public-muted text-sm">目前沒有可重播的場景。</p>
      )}
    </section>
  );
}
