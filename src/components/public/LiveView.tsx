import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { composeLiveViewModel, parseLiveRoute, type LiveProjection } from './liveRoute';

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
 */

export default function LiveView() {
  const route = typeof window === 'undefined' ? null : parseLiveRoute(window.location.hash);
  const worldId = route?.worldId ?? null;
  const enabled = worldId !== null;

  // Public read only — no provider calls (AC#3).
  const result = useQuery(
    api.publicRead.readModelFunctions.getPublishedReadModel,
    enabled ? { worldId, modelKind: 'liveState', modelRef: `live:${worldId}` } : 'skip',
  );

  if (!enabled) {
    return <Frame worldId={null}><p>網址格式應為 <code>#live/&lt;worldId&gt;</code></p></Frame>;
  }
  if (result === undefined) {
    return <Frame worldId={worldId}><p>載入中…</p></Frame>;
  }

  const vm = composeLiveViewModel({ live: (result?.payload ?? null) as LiveProjection | null });

  return (
    <Frame worldId={worldId}>
      <header>
        <h1 className="text-3xl font-bold">實況</h1>
        <p className="text-sm opacity-70">
          {vm.worldTime
            ? `世界日 ${vm.worldTime.worldDay} · ${vm.worldTime.timeSlot}`
            : '實況尚未開始,顯示最後狀態。'}
        </p>
      </header>

      {/* AC#1: text location list — no map / animation. */}
      <section className="live-locations mt-4" aria-label="Locations">
        <h2 className="text-xl font-semibold">地點</h2>
        {vm.locations.length > 0 ? (
          <ul>
            {vm.locations.map((location) => (
              <li key={location.locationId}>
                <span className="font-medium">{location.name}</span>
                <span className="opacity-70"> · {location.locationType}{location.active ? '' : ' (休止)'}</span>
                {location.description && <p className="text-sm opacity-80">{location.description}</p>}
              </li>
            ))}
          </ul>
        ) : <p className="opacity-60">尚無地點資訊。</p>}
      </section>

      <section className="live-characters mt-4" aria-label="Character positions">
        <h2 className="text-xl font-semibold">角色位置</h2>
        {vm.characterPositions.length > 0 ? (
          <ul>
            {vm.characterPositions.map((character) => (
              <li key={character.characterId}>
                {character.characterId} → {character.locationLabel}
                {!character.alive && <span className="opacity-60"> (已歿)</span>}
              </li>
            ))}
          </ul>
        ) : <p className="opacity-60">尚無角色動態。</p>}
      </section>

      {/* AC#2: active scenes as summaries / essence only. */}
      <section className="live-scenes mt-4" aria-label="Active scenes">
        <h2 className="text-xl font-semibold">活躍場景</h2>
        {vm.activeScenes.length > 0 ? (
          vm.activeScenes.map((scene, index) => (
            <article key={index} className="mt-1">
              <h3 className="font-medium">{scene.title}</h3>
              <p className="text-sm opacity-80">{scene.summary}</p>
            </article>
          ))
        ) : <p className="opacity-60">目前無活躍場景。</p>}
      </section>

      <section className="live-recent mt-4" aria-label="Recent events">
        <h2 className="text-xl font-semibold">最近事件</h2>
        {vm.recentEvents.length > 0 ? (
          <ul>
            {vm.recentEvents.map((event) => (
              <li key={event.eventId} className="text-sm">
                <span className="opacity-70">[日 {event.worldDay} {event.timeSlot}]</span> {event.summary}
              </li>
            ))}
          </ul>
        ) : <p className="opacity-60">尚無最近事件。</p>}
      </section>

      <section className="live-arcs mt-4" aria-label="Active arcs">
        <h2 className="text-xl font-semibold">進行中的故事線</h2>
        {vm.activeArcs.length > 0 ? (
          <ul>
            {vm.activeArcs.map((arc) => (
              <li key={arc.arcId}>
                <a href={`#arc/${arc.arcId}`}>{arc.title}</a>
                <span className="text-sm opacity-70"> · {arc.currentQuestion}</span>
              </li>
            ))}
          </ul>
        ) : <p className="opacity-60">目前無進行中的故事線。</p>}
      </section>
    </Frame>
  );
}

function Frame({ worldId, children }: { worldId: string | null; children: React.ReactNode }) {
  return (
    <main className="public-page mx-auto max-w-2xl p-4 font-body">
      <a href={worldId ? `#home/${worldId}` : '#home'} className="text-sm opacity-70">← 返回首頁</a>
      <div className="mt-3">{children}</div>
    </main>
  );
}
