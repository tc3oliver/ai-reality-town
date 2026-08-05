import { useQuery } from 'convex/react';
import { getPublishedReadModelRef } from './publicReadModelRef';
import { PublicPageFrame } from './PublicPageFrame';
import {
  composeLiveViewModel,
  parseLiveRoute,
  type LiveProjection,
  type LiveViewModel,
} from './liveRoute';

/**
 * Public live-world view (FR-I002). Reads ONLY the published `liveState`
 * projection via the failure-isolated public read model — no generation on
 * read (AC#3). Renders a text location list with character positions and scene
 * summaries (AC#1/#2 — no game animation), and stays browsable from the
 * last-known-good snapshot even when the simulation is paused or the model is
 * missing (AC#4). Mobile-accessible markup.
 *
 * Thin render layer: all route + view-model logic lives in {@link ./liveRoute}
 * (pure, unit-tested).
 *
 * NFR-009 AC#3 (non-map alternative): this view *is* the accessible equivalent
 * of the animated map. It exposes the same live world state — locations,
 * character positions, active scenes, recent events and running arcs — as
 * screen-reader-readable text, and renders no canvas, image or map element at
 * all. `publicPages.a11y.test.tsx` asserts both halves of that claim.
 */

export default function LiveView() {
  const route = typeof window === 'undefined' ? null : parseLiveRoute(window.location.hash);
  const worldId = route?.worldId ?? null;
  const enabled = worldId !== null;

  // Public read only — no provider calls (AC#3).
  const result = useQuery(
    getPublishedReadModelRef,
    enabled ? { worldId, modelKind: 'liveState', modelRef: `live:${worldId}` } : 'skip',
  );

  if (!enabled) {
    return (
      <PublicPageFrame worldId={null}>
        <h1 className="text-3xl font-bold">實況</h1>
        <p className="mt-2">
          網址格式應為 <code>#live/&lt;worldId&gt;</code>
        </p>
      </PublicPageFrame>
    );
  }
  if (result === undefined) {
    return (
      <PublicPageFrame worldId={worldId}>
        <h1 className="text-3xl font-bold">實況</h1>
        <p className="mt-2">載入中…</p>
      </PublicPageFrame>
    );
  }

  const vm = composeLiveViewModel({ live: (result?.payload ?? null) as LiveProjection | null });

  return <LiveViewBody worldId={worldId} vm={vm} />;
}

/**
 * Presentational live view. Split out from the data-fetching default export so
 * the accessibility suite can render the real markup without a Convex client.
 */
export function LiveViewBody({ worldId, vm }: { worldId: string; vm: LiveViewModel }) {
  return (
    <PublicPageFrame worldId={worldId}>
      <header>
        <h1 className="text-3xl font-bold">實況(文字版)</h1>
        <p className="text-sm public-muted">
          {vm.worldTime
            ? `世界日 ${vm.worldTime.worldDay} · ${vm.worldTime.timeSlot}`
            : '實況尚未開始,顯示最後狀態。'}
        </p>
      </header>

      {/* AC#1: text location list — no map / animation. */}
      <section className="live-locations mt-4" aria-labelledby="live-locations">
        <h2 id="live-locations" className="text-xl font-semibold">
          地點
        </h2>
        {vm.locations.length > 0 ? (
          <ul>
            {vm.locations.map((location) => (
              <li key={location.locationId}>
                <span className="font-medium">{location.name}</span>
                <span className="public-muted">
                  {' · '}
                  {location.locationType}
                  {location.active ? '' : '(休止)'}
                </span>
                {location.description && <p className="text-sm public-muted">{location.description}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="public-muted">尚無地點資訊。</p>
        )}
      </section>

      <section className="live-characters mt-4" aria-labelledby="live-characters">
        <h2 id="live-characters" className="text-xl font-semibold">
          角色位置
        </h2>
        {vm.characterPositions.length > 0 ? (
          <ul>
            {vm.characterPositions.map((character) => (
              <li key={character.characterId}>
                {/* The arrow glyph this used to render is not announced by
                    screen readers; the relationship is now stated in words. */}
                {character.characterId} 位於 {character.locationLabel}
                {!character.alive && <span className="public-muted">(已歿)</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="public-muted">尚無角色動態。</p>
        )}
      </section>

      {/* AC#2: active scenes as summaries / essence only. */}
      <section className="live-scenes mt-4" aria-labelledby="live-scenes">
        <h2 id="live-scenes" className="text-xl font-semibold">
          活躍場景
        </h2>
        {vm.activeScenes.length > 0 ? (
          vm.activeScenes.map((scene, index) => (
            <article key={index} className="mt-1">
              <h3 className="font-medium">{scene.title}</h3>
              <p className="text-sm public-muted">{scene.summary}</p>
            </article>
          ))
        ) : (
          <p className="public-muted">目前無活躍場景。</p>
        )}
      </section>

      <section className="live-recent mt-4" aria-labelledby="live-recent">
        <h2 id="live-recent" className="text-xl font-semibold">
          最近事件
        </h2>
        {vm.recentEvents.length > 0 ? (
          <ul>
            {vm.recentEvents.map((event) => (
              <li key={event.eventId} className="text-sm">
                <span className="public-muted">
                  [日 {event.worldDay} {event.timeSlot}]
                </span>{' '}
                {event.summary}
              </li>
            ))}
          </ul>
        ) : (
          <p className="public-muted">尚無最近事件。</p>
        )}
      </section>

      <section className="live-arcs mt-4" aria-labelledby="live-arcs">
        <h2 id="live-arcs" className="text-xl font-semibold">
          進行中的故事線
        </h2>
        {vm.activeArcs.length > 0 ? (
          <ul>
            {vm.activeArcs.map((arc) => (
              <li key={arc.arcId}>
                <a href={`#arc/${worldId}/${arc.arcId}`}>{arc.title}</a>
                <span className="text-sm public-muted"> · {arc.currentQuestion}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="public-muted">目前無進行中的故事線。</p>
        )}
      </section>
    </PublicPageFrame>
  );
}
