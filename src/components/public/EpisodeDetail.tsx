import { useState } from 'react';
import { useQuery } from 'convex/react';
import { getPublishedReadModelRef } from './publicReadModelRef';
import { PublicPageFrame } from './PublicPageFrame';

/**
 * Public Episode detail page (FR-I003). Reads ONLY the published episode
 * projection via the failure-isolated public read model — no generation is
 * triggered on read (AC#5). Renders Quick / Standard / Deep recap views from
 * the published content (AC#1), key scenes + related characters + arcs (AC#2),
 * and previous/next navigation (AC#3). Recommended reading links only to
 * published arcs (AC#4). Mobile-accessible markup.
 *
 * Accessibility (ART-93 / NFR-009): the recap selector is a labelled button
 * group with `aria-pressed` and a real visible selected state — it previously
 * relied on a bare `.active` class that no stylesheet defined, so the current
 * recap depth was neither visible nor announced. Heading levels now run
 * h1 → h2 → h3 (the deep recap used to jump straight from h1 to h3), and the
 * related-character / related-arc / back links carry the worldId their target
 * routes require. Covered by `publicPages.a11y.test.tsx`.
 */

export type EpisodeProjection = {
  episodeNumber: number;
  worldDay: number;
  title: string;
  headline: string;
  oneLineSummary: string;
  keyScenes: Array<{ title: string; summary: string; sourceEventIds: string[] }>;
  relationshipChanges: Array<{ summary: string; sourceEventId: string }>;
  newQuestions: string[];
  resolvedQuestions: string[];
  arcIds: string[];
  characterIds: string[];
  nextEpisodeTease: string;
};

type RecapView = 'quick' | 'standard' | 'deep';

const RECAP_LABELS: Record<RecapView, string> = {
  quick: '快速',
  standard: '標準',
  deep: '深度',
};

function parseRoute(): { worldId: string; worldDay: number } | null {
  const hash = window.location.hash.replace(/^#/, '');
  const match = hash.match(/^episode\/([^/]+)\/(\d+)$/);
  if (!match) return null;
  return { worldId: decodeURIComponent(match[1]), worldDay: Number(match[2]) };
}

function navigate(worldId: string, worldDay: number): void {
  window.location.hash = `episode/${worldId}/${worldDay}`;
}

export default function EpisodeDetail() {
  const route = parseRoute();

  const result = useQuery(
    getPublishedReadModelRef,
    route
      ? { worldId: route.worldId, modelKind: 'episode', modelRef: `episode:${route.worldDay}` }
      : 'skip',
  );

  if (!route) {
    return (
      <PublicPageFrame worldId={null}>
        <h1 className="text-3xl font-bold">故事</h1>
        <p className="mt-2">
          網址格式應為 <code>#episode/&lt;worldId&gt;/&lt;worldDay&gt;</code>
        </p>
      </PublicPageFrame>
    );
  }
  if (result === undefined) {
    return (
      <PublicPageFrame worldId={route.worldId}>
        <h1 className="text-3xl font-bold">故事</h1>
        <p className="mt-2">載入中…</p>
      </PublicPageFrame>
    );
  }
  if (result === null) {
    return (
      <PublicPageFrame worldId={route.worldId}>
        <h1 className="text-3xl font-bold">故事</h1>
        <p className="mt-2">找不到此故事(可能尚未發布)。</p>
      </PublicPageFrame>
    );
  }

  return (
    <EpisodeDetailView
      worldId={route.worldId}
      worldDay={route.worldDay}
      episode={result.payload as EpisodeProjection}
      onNavigate={navigate}
    />
  );
}

/**
 * Presentational episode detail, including the recap-depth state. Split out
 * from the data-fetching default export so the accessibility suite can render
 * the real markup — in every recap depth — without a Convex client.
 */
export function EpisodeDetailView({
  worldId,
  worldDay,
  episode,
  initialRecapView = 'quick',
  onNavigate = navigate,
}: {
  worldId: string;
  worldDay: number;
  episode: EpisodeProjection;
  initialRecapView?: RecapView;
  onNavigate?: (worldId: string, worldDay: number) => void;
}) {
  const [view, setView] = useState<RecapView>(initialRecapView);
  const prevDay = worldDay - 1;
  const nextDay = worldDay + 1;

  return (
    <PublicPageFrame worldId={worldId}>
      <header>
        <p className="text-sm public-muted">
          第 {episode.episodeNumber} 集 · 世界日 {episode.worldDay}
        </p>
        <h1 className="text-3xl font-bold mt-1">{episode.title}</h1>
        <p className="mt-2 text-lg">{episode.headline}</p>
      </header>

      <section className="recap" aria-labelledby="episode-recap">
        <h2 id="episode-recap" className="text-xl font-semibold mt-4">
          回顧
        </h2>

        {/* Not a <nav>: these controls change the recap depth in place, they do
            not navigate. `aria-pressed` announces the current depth. */}
        <div className="recap-tabs flex flex-wrap gap-2" role="group" aria-label="回顧深度">
          {(['quick', 'standard', 'deep'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              aria-pressed={view === tab}
              className={`public-tap border ${view === tab ? 'font-bold underline' : ''}`}
              onClick={() => setView(tab)}
            >
              {RECAP_LABELS[tab]}
            </button>
          ))}
        </div>

        <div className="recap-body mt-2">
          {view === 'quick' && <p>{episode.oneLineSummary}</p>}
          {view === 'standard' && (
            <div>
              <p>{episode.oneLineSummary}</p>
              {episode.resolvedQuestions.length > 0 && (
                <ul>
                  <li className="mt-2">已揭曉:{episode.resolvedQuestions.join('、')}</li>
                </ul>
              )}
            </div>
          )}
          {view === 'deep' && (
            <div>
              {episode.keyScenes.map((scene, index) => (
                <article key={index} className="mt-3">
                  <h3 className="font-semibold">{scene.title}</h3>
                  <p>{scene.summary}</p>
                </article>
              ))}
              {episode.relationshipChanges.length > 0 && (
                <p className="mt-3 text-sm public-muted">
                  關係變化:{episode.relationshipChanges.map((c) => c.summary).join(' ')}
                </p>
              )}
              {episode.newQuestions.length > 0 && (
                <p className="mt-1 text-sm public-muted">新懸念:{episode.newQuestions.join('、')}</p>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="related" aria-labelledby="episode-related-characters">
        <h2 id="episode-related-characters" className="text-xl font-semibold mt-4">
          關連角色
        </h2>
        <ul>
          {episode.characterIds.map((id) => (
            <li key={id}>
              <a href={`#character/${worldId}/${id}`}>{id}</a>
            </li>
          ))}
        </ul>
      </section>

      <section className="related-arcs" aria-labelledby="episode-related-arcs">
        <h2 id="episode-related-arcs" className="text-xl font-semibold mt-3">
          關連故事線
        </h2>
        <ul>
          {episode.arcIds.map((id) => (
            <li key={id}>
              <a href={`#arc/${worldId}/${id}`}>{id}</a>
            </li>
          ))}
        </ul>
      </section>

      {episode.nextEpisodeTease && <p className="mt-4 italic">{episode.nextEpisodeTease}</p>}

      <nav className="episode-nav mt-4 flex flex-wrap gap-2" aria-label="集數導覽">
        <button
          type="button"
          className="public-tap border"
          disabled={prevDay < 1}
          onClick={() => onNavigate(worldId, prevDay)}
        >
          上一集(第 {prevDay} 日)
        </button>
        <button
          type="button"
          className="public-tap border"
          onClick={() => onNavigate(worldId, nextDay)}
        >
          下一集(第 {nextDay} 日)
        </button>
      </nav>
    </PublicPageFrame>
  );
}
