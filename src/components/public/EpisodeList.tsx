import { useState } from 'react';
import { useQuery } from 'convex/react';
import { getPublishedReadModelRef } from './publicReadModelRef';
import { PublicPageFrame } from './PublicPageFrame';
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
 * {@link ./episodeListRoute} (pure, unit-tested). Accessibility (ART-93 /
 * NFR-009): both regions carry a visible heading that names them, the filter
 * controls keep their native `<label>` association and a 44px touch target, and
 * the Turning Point / Recommended Entry glyphs are backed by text.
 */

const NONE = '__none__';

export default function EpisodeList() {
  const route = typeof window === 'undefined' ? null : parseEpisodeListRoute(window.location.hash);
  const worldId = route?.worldId ?? null;
  const enabled = worldId !== null;

  // Public read only — no provider calls (AC#3).
  const result = useQuery(
    getPublishedReadModelRef,
    enabled ? { worldId, modelKind: 'episode', modelRef: `episodes:${worldId}` } : 'skip',
  );

  if (!enabled) {
    return (
      <PublicPageFrame worldId={null}>
        <h1 className="text-3xl font-bold">故事集</h1>
        <p className="mt-2">
          網址格式應為 <code>#episodes/&lt;worldId&gt;</code>
        </p>
      </PublicPageFrame>
    );
  }
  if (result === undefined) {
    return (
      <PublicPageFrame worldId={worldId}>
        <h1 className="text-3xl font-bold">故事集</h1>
        <p className="mt-2">載入中…</p>
      </PublicPageFrame>
    );
  }

  return (
    <EpisodeListView worldId={worldId} index={(result?.payload ?? null) as EpisodeListIndex | null} />
  );
}

/**
 * Presentational episode list, including the local filter state. Split out from
 * the data-fetching default export so the accessibility suite can render the
 * real markup without a Convex client.
 */
export function EpisodeListView({
  worldId,
  index,
}: {
  worldId: string;
  index: EpisodeListIndex | null;
}) {
  const [arc, setArc] = useState<string>(NONE);
  const [character, setCharacter] = useState<string>(NONE);

  const filter: EpisodeFilter = {
    arc: arc === NONE ? null : arc,
    character: character === NONE ? null : character,
  };
  const vm = composeEpisodeListViewModel({ worldId, index, filter });

  return (
    <PublicPageFrame worldId={worldId}>
      <header>
        <h1 className="text-3xl font-bold">故事集</h1>
        <p className="text-sm public-muted">依日期瀏覽,可篩選故事線與角色。</p>
      </header>

      {/* AC#2: arc + character filters. AC#4: native selects are mobile-accessible. */}
      <section className="episode-filters mt-4" aria-labelledby="episodes-filters">
        <h2 id="episodes-filters" className="text-xl font-semibold">
          篩選
        </h2>
        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            故事線
            <select
              value={arc}
              onChange={(e) => setArc(e.target.value)}
              className="ml-2 min-h-[44px]"
            >
              <option value={NONE}>全部</option>
              {vm.arcOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            角色
            <select
              value={character}
              onChange={(e) => setCharacter(e.target.value)}
              className="ml-2 min-h-[44px]"
            >
              <option value={NONE}>全部</option>
              {vm.characterOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* AC#1: date-ordered list. AC#3: Turning Point / Recommended Entry marked. */}
      <section className="episode-list mt-4" aria-labelledby="episodes-list">
        <h2 id="episodes-list" className="text-xl font-semibold">
          故事列表
        </h2>
        {vm.episodes.length > 0 ? (
          <ul>
            {vm.episodes.map((episode) => (
              <li key={episode.worldDay} className="mt-2">
                <a href={episode.href} className="font-medium">
                  第 {episode.episodeNumber} 集 · {episode.title}
                </a>
                {(episode.isRecommendedEntry || episode.isTurningPoint) && (
                  <span className="ml-2 text-xs public-muted">
                    {episode.isRecommendedEntry && '★ 推薦入坑'}
                    {episode.isRecommendedEntry && episode.isTurningPoint && ' · '}
                    {episode.isTurningPoint && '▲ 轉折點'}
                  </span>
                )}
                <p className="text-sm public-muted">{episode.headline}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="public-muted">
            {vm.hasContent ? '目前篩選條件下沒有故事。' : '尚未發布任何故事。'}
          </p>
        )}
      </section>
    </PublicPageFrame>
  );
}
