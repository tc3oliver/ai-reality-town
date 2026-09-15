import { useEffect, useState } from 'react';
import { useQuery } from 'convex/react';
import { getPublishedReadModelRef } from './publicReadModelRef';
import { PublicPageFrame } from './PublicPageFrame';
import { characterMapHref } from './liveMapLinks';
import { useEntityNames } from './useEntityNames';
import {
  episodeNeighbours,
  type EpisodeNeighbourSource,
  type EpisodeNeighbours,
} from './episodeNeighbours';
import { EMPTY_WORLD_NAMES, named, type WorldNames } from './worldNames';
import { useEndOfContent } from '../analytics/useEndOfContent';
import {
  emitEpisodeCompleted,
  emitEpisodeViewed,
  emitShareAction,
} from '../../analytics/productEvents';

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
  /**
   * §16.1's 首次進站後開啟 Episode numerator.
   *
   * On the ROUTE, not on the published payload: opening an Episode that turns out to be
   * unpublished is still opening one, and gating the event on content would make the rate
   * measure publication coverage instead. The two states are separable afterwards —
   * `episode_completed` only ever fires for an Episode that rendered.
   */
  const routeWorldId = route?.worldId ?? null;
  const routeWorldDay = route?.worldDay ?? null;
  useEffect(() => {
    if (routeWorldId !== null && routeWorldDay !== null) emitEpisodeViewed(routeWorldId, routeWorldDay);
  }, [routeWorldId, routeWorldDay]);

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
    <EpisodeDetailBody
      worldId={route.worldId}
      worldDay={route.worldDay}
      episode={result.payload as EpisodeProjection}
    />
  );
}

/**
 * The name lookup, split out because a hook may not run after the early returns above (ART-187).
 *
 * 關連角色 and 關連故事線 rendered `he-jun` and `arc-mill-audit` as the visible text of links
 * pointing at those ids — and the map link beside each row announced 「在地圖上查看 he-jun」. The
 * names are resolved here rather than in {@link EpisodeDetailView} so the presentational export
 * stays renderable without a Convex client, which is what lets the accessibility suite exercise
 * the real markup.
 */
function EpisodeDetailBody({
  worldId,
  worldDay,
  episode,
}: {
  worldId: string;
  worldDay: number;
  episode: EpisodeProjection;
}) {
  const names = useEntityNames(worldId, episode.arcIds);
  /**
   * The published index, read for the navigation bound (ART-189).
   *
   * The same `episodes:<worldId>` model the Episode list already reads — an allowlisted anonymous
   * query that triggers no generation. It is the only published thing that says which Episodes
   * EXIST, and 下一集 was computed by adding one to the current day instead.
   */
  const indexResult = useQuery(
    getPublishedReadModelRef,
    { worldId, modelKind: 'episode', modelRef: `episodes:${worldId}` },
  );
  const neighbours = episodeNeighbours(
    worldDay,
    ((indexResult?.payload ?? null) as { episodes?: EpisodeNeighbourSource[] } | null)?.episodes,
  );
  return (
    <EpisodeDetailView
      worldId={worldId}
      worldDay={worldDay}
      episode={episode}
      names={names}
      neighbours={neighbours}
      onNavigate={navigate}
    />
  );
}

/**
 * Presentational episode detail, including the recap-depth state. Split out
 * from the data-fetching default export so the accessibility suite can render
 * the real markup — in every recap depth — without a Convex client.
 */
/** Copy a public deep link. Returns the state the button should show. */
async function copyEpisodeLink(worldId: string, worldDay: number): Promise<'copied' | 'failed'> {
  const href = `${window.location.origin}${window.location.pathname}#episode/${worldId}/${worldDay}`;
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return 'failed';
  await navigator.clipboard.writeText(href);
  return 'copied';
}

export function EpisodeDetailView({
  worldId,
  worldDay,
  episode,
  names = EMPTY_WORLD_NAMES,
  neighbours = { previous: null, next: null },
  initialRecapView = 'quick',
  onNavigate = navigate,
}: {
  worldId: string;
  worldDay: number;
  episode: EpisodeProjection;
  /**
   * What to call the related characters and arcs (ART-187). Omitted renders ids, which is what
   * this page did before — so the accessibility suite and any caller that has not adopted it are
   * unchanged, and a name that has not resolved yet costs one row its name rather than the page.
   */
  names?: WorldNames;
  /**
   * Which Episodes actually exist either side of this one (ART-189). Omitted offers neither
   * control, which is what an unread index should look like: a control that is briefly absent is
   * a smaller error than one that is offered and then lands on 找不到此故事.
   */
  neighbours?: EpisodeNeighbours;
  initialRecapView?: RecapView;
  onNavigate?: (worldId: string, worldDay: number) => void;
}) {
  const [view, setView] = useState<RecapView>(initialRecapView);
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle');
  // Fires when the end of the Episode reaches the viewport — including immediately, for an
  // Episode short enough to fit on one screen, which a scroll listener would never see.
  const { ref: endOfEpisode } = useEndOfContent(() => emitEpisodeCompleted(worldId, worldDay));

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
        <ul className="public-rows">
          {episode.characterIds.map((id) => (
            <li key={id}>
              <a className="public-tap" href={`#character/${worldId}/${id}`}>
                {named(names.characters, id)}
              </a>
              {/* FR-P002 / ART-130 AC#2 — the other half of "links back to related characters":
                  where they are RIGHT NOW. The link opens the live map focused on them and with
                  their card open, so the viewer lands on the answer instead of on a map they
                  then have to search. Named per row, since every row reads the same (WCAG
                  2.4.4). */}
              <a
                className="public-tap"
                href={characterMapHref(worldId, id)}
                aria-label={`在地圖上查看 ${named(names.characters, id)}`}
              >
                在地圖上查看
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="related-arcs" aria-labelledby="episode-related-arcs">
        <h2 id="episode-related-arcs" className="text-xl font-semibold mt-3">
          關連故事線
        </h2>
        <ul className="public-rows">
          {episode.arcIds.map((id) => (
            <li key={id}>
              <a className="public-tap" href={`#arc/${worldId}/${id}`}>
                {named(names.arcs, id)}
              </a>
            </li>
          ))}
        </ul>
      </section>

      {episode.nextEpisodeTease && <p className="mt-4 italic">{episode.nextEpisodeTease}</p>}

      {/* The end of the Episode. `aria-hidden` because it is a measurement point and not
          content — a screen reader announcing an empty landmark would be the instrumentation
          leaking into the thing it measures. */}
      <div ref={endOfEpisode} aria-hidden="true" />

      {/* §15's `share_action`. A copy-link button rather than a share sheet: the deep link is
          already public and already in the address bar, so this adds no capability and reaches
          no third party — which a social share widget would, along with the viewer's IP. */}
      <p className="episode-share mt-4">
        <button
          type="button"
          className="public-tap border"
          onClick={() => {
            emitShareAction(worldId, 'episode', 'link');
            void copyEpisodeLink(worldId, worldDay).then(setShareState, () => setShareState('failed'));
          }}
        >
          複製這一集的連結
        </button>
        {shareState === 'copied' && <span className="ml-2 text-sm">已複製</span>}
        {/* Never silently nothing: a clipboard API can be refused by permission or absent
            entirely, and a button that appeared to do nothing is worse than one that says so. */}
        {shareState === 'failed' && (
          <span className="ml-2 text-sm">無法複製,請直接複製網址列。</span>
        )}
      </p>

      {/* Bounded by what is PUBLISHED, not by arithmetic (ART-189). 下一集 used to be offered
          unconditionally and landed on 找不到此故事 at the end of the run; both ends are now the
          nearest published Episode, so a withheld day in the middle is stepped over rather than
          walked into. Each control names both numbers, as the header above does — ART-184 already
          established that conflating 集 and 日 is what makes a link surprising. */}
      <nav className="episode-nav mt-4 flex flex-wrap gap-2" aria-label="集數導覽">
        {neighbours.previous === null ? (
          <span className="public-muted text-sm">已經是最早一集。</span>
        ) : (
          <button
            type="button"
            className="public-tap border"
            onClick={() => onNavigate(worldId, neighbours.previous?.worldDay as number)}
          >
            上一集:第 {neighbours.previous.episodeNumber} 集(世界日 {neighbours.previous.worldDay})
          </button>
        )}
        {neighbours.next === null ? (
          <span className="public-muted text-sm">這是目前最新的一集。</span>
        ) : (
          <button
            type="button"
            className="public-tap border"
            onClick={() => onNavigate(worldId, neighbours.next?.worldDay as number)}
          >
            下一集:第 {neighbours.next.episodeNumber} 集(世界日 {neighbours.next.worldDay})
          </button>
        )}
      </nav>
    </PublicPageFrame>
  );
}
