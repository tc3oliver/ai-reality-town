import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import {
  composeEpisodeListViewModel,
  parseEpisodeListRoute,
  type EpisodeFilter,
  type EpisodeListIndex,
} from './episodeListRoute';

/**
 * Public Episode list page (FR-I004). Reads ONLY the published `episodes:<worldId>`
 * index projection via the failure-isolated public read model — no generation on
 * read (AC#3 published-data-only). Supports browsing by date (AC#1), filtering by
 * Story Arc and character (AC#2), visibly marks Turning Point / Recommended Entry
 * episodes (AC#3), and stays mobile-accessible (AC#4). Mobile-accessible markup.
 *
 * Thin render layer: all route + filter + view-model logic lives in
 * {@link ./episodeListRoute} (pure, unit-tested).
 */

const NONE = '__none__';

export default function EpisodeList() {
  const route = typeof window === 'undefined' ? null : parseEpisodeListRoute(window.location.hash);
  const worldId = route?.worldId ?? null;
  const enabled = worldId !== null;

  // Public read only — no provider calls (AC#3).
  const result = useQuery(
    api.publicRead.readModelFunctions.getPublishedReadModel,
    enabled ? { worldId, modelKind: 'episode', modelRef: `episodes:${worldId}` } : 'skip',
  );

  const [arc, setArc] = useState<string>(NONE);
  const [character, setCharacter] = useState<string>(NONE);

  if (!enabled) {
    return <Frame worldId={null}><p>網址格式應為 <code>#episodes/&lt;worldId&gt;</code></p></Frame>;
  }
  if (result === undefined) {
    return <Frame worldId={worldId}><p>載入中…</p></Frame>;
  }

  const filter: EpisodeFilter = {
    arc: arc === NONE ? null : arc,
    character: character === NONE ? null : character,
  };
  const vm = composeEpisodeListViewModel({
    worldId,
    index: (result?.payload ?? null) as EpisodeListIndex | null,
    filter,
  });

  return (
    <Frame worldId={worldId}>
      <header>
        <h1 className="text-3xl font-bold">故事集</h1>
        <p className="text-sm opacity-70">依日期瀏覽,可篩選故事線與角色。</p>
      </header>

      {/* AC#2: arc + character filters. AC#4: native selects are mobile-accessible. */}
      <section className="episode-filters mt-4" aria-label="Filters">
        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            故事線
            <select value={arc} onChange={(e) => setArc(e.target.value)} className="ml-2">
              <option value={NONE}>全部</option>
              {vm.arcOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="text-sm">
            角色
            <select value={character} onChange={(e) => setCharacter(e.target.value)} className="ml-2">
              <option value={NONE}>全部</option>
              {vm.characterOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>
      </section>

      {/* AC#1: date-ordered list. AC#3: Turning Point / Recommended Entry marked. */}
      <section className="episode-list mt-4" aria-label="Episodes">
        {vm.episodes.length > 0 ? (
          <ul>
            {vm.episodes.map((episode) => (
              <li key={episode.worldDay} className="mt-2">
                <a href={episode.href} className="font-medium">
                  第 {episode.episodeNumber} 集 · {episode.title}
                </a>
                {(episode.isRecommendedEntry || episode.isTurningPoint) && (
                  <span className="ml-2 text-xs opacity-80">
                    {episode.isRecommendedEntry && '★ 推薦入坑'}
                    {episode.isRecommendedEntry && episode.isTurningPoint && ' · '}
                    {episode.isTurningPoint && '▲ 轉折點'}
                  </span>
                )}
                <p className="text-sm opacity-80">{episode.headline}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="opacity-60">{vm.hasContent ? '目前篩選條件下沒有故事。' : '尚未發布任何故事。'}</p>
        )}
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
