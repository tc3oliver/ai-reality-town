import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

/**
 * Public Episode detail page (FR-I003). Reads ONLY the published episode
 * projection via the failure-isolated public read model — no generation is
 * triggered on read (AC#5). Renders Quick / Standard / Deep recap views from
 * the published content (AC#1), key scenes + related characters + arcs (AC#2),
 * and previous/next navigation (AC#3). Recommended reading links only to
 * published arcs (AC#4). Mobile-accessible markup.
 */

type EpisodeProjection = {
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
  const [view, setView] = useState<RecapView>('quick');

  const result = useQuery(
    api.publicRead.readModelFunctions.getPublishedReadModel,
    route ? { worldId: route.worldId, modelKind: 'episode', modelRef: `episode:${route.worldDay}` } : 'skip',
  );

  if (!route) return <PublicFrame><p>網址格式應為 <code>#episode/&lt;worldId&gt;/&lt;worldDay&gt;</code></p></PublicFrame>;
  if (result === undefined) return <PublicFrame><p>載入中…</p></PublicFrame>;
  if (result === null) return <PublicFrame><p>找不到此故事(可能尚未發布)。</p></PublicFrame>;

  const episode = result.payload as EpisodeProjection;
  const prevDay = route.worldDay - 1;
  const nextDay = route.worldDay + 1;

  return (
    <PublicFrame>
      <header>
        <p className="text-sm opacity-70">第 {episode.episodeNumber} 集 · 世界日 {episode.worldDay}</p>
        <h1 className="text-3xl font-bold mt-1">{episode.title}</h1>
        <p className="mt-2 text-lg">{episode.headline}</p>
      </header>

      <nav className="recap-tabs" aria-label="Recap view">
        {(['quick', 'standard', 'deep'] as const).map((tab) => (
          <button key={tab} className={view === tab ? 'active' : ''} onClick={() => setView(tab)}>
            {tab === 'quick' ? '快速' : tab === 'standard' ? '標準' : '深度'}
          </button>
        ))}
      </nav>

      <section className="recap-body">
        {view === 'quick' && <p>{episode.oneLineSummary}</p>}
        {view === 'standard' && (
          <div>
            <p>{episode.oneLineSummary}</p>
            {episode.resolvedQuestions.length > 0 && (
              <ul><li className="mt-2">已揭曉:{episode.resolvedQuestions.join('、')}</li></ul>
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
              <p className="mt-3 text-sm opacity-80">關係變化:{episode.relationshipChanges.map((c) => c.summary).join(' ')}</p>
            )}
            {episode.newQuestions.length > 0 && (
              <p className="mt-1 text-sm opacity-80">新懸念:{episode.newQuestions.join('、')}</p>
            )}
          </div>
        )}
      </section>

      <section className="related" aria-label="Related">
        <h2 className="text-xl font-semibold mt-4">關連角色</h2>
        <ul>{episode.characterIds.map((id) => <li key={id}><a href={`#character/${id}`}>{id}</a></li>)}</ul>
        <h2 className="text-xl font-semibold mt-3">關連故事線</h2>
        <ul>{episode.arcIds.map((id) => <li key={id}><a href={`#arc/${id}`}>{id}</a></li>)}</ul>
      </section>

      {episode.nextEpisodeTease && <p className="mt-4 italic">{episode.nextEpisodeTease}</p>}

      <nav className="episode-nav" aria-label="Episode navigation">
        <button disabled={prevDay < 1} onClick={() => navigate(route.worldId, prevDay)}>← 上一集</button>
        <button onClick={() => navigate(route.worldId, nextDay)}>下一集 →</button>
      </nav>
    </PublicFrame>
  );
}

function PublicFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="public-page mx-auto max-w-2xl p-4 font-body">
      <a href="#home" className="text-sm opacity-70">← 返回首頁</a>
      <div className="mt-3">{children}</div>
    </main>
  );
}
