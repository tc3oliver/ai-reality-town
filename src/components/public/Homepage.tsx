import { useQuery } from 'convex/react';
import { getPublishedReadModelRef } from './publicReadModelRef';
import { PublicPageFrame } from './PublicPageFrame';
import {
  composeHomepageViewModel,
  parseHomeRoute,
  type HomeLiveProjection,
  type HomeOnboardingSummary,
  type HomepageViewModel,
  type HomeWorldProjection,
} from './homeRoute';

/**
 * Story-first public homepage (FR-I001, UX-001..006). Reads ONLY published
 * projections via the failure-isolated public read model — no generation on
 * read. The first viewport prioritises the current major event (AC#2) and the
 * newcomer disclosure is bounded to one primary arc, ≤4 core characters, three
 * essential facts, and one entry point (AC#4). Voting/live render graceful
 * unavailable states without blocking (AC#5). Mobile-accessible markup.
 *
 * Thin render layer: all route + view-model logic lives in {@link ./homeRoute}
 * (pure, unit-tested). Accessibility (ART-93 / NFR-009): every section is named
 * by its own visible heading via `aria-labelledby`, headings run h1 → h2 → h3
 * with no skipped level, and muted text uses the measured `.public-muted`
 * token rather than opacity. Covered by `publicPages.a11y.test.tsx`.
 */

export default function Homepage() {
  // SSR-safe: window is undefined during prerender.
  const route = typeof window === 'undefined' ? null : parseHomeRoute(window.location.hash);
  const worldId = route?.worldId ?? null;
  const enabled = worldId !== null;

  // Public reads only — no provider calls (AC#1/#5).
  const onboarding = useQuery(
    getPublishedReadModelRef,
    enabled ? { worldId, modelKind: 'world', modelRef: `onboarding:${worldId}` } : 'skip',
  );
  const world = useQuery(
    getPublishedReadModelRef,
    enabled ? { worldId, modelKind: 'world', modelRef: `world:${worldId}` } : 'skip',
  );
  const live = useQuery(
    getPublishedReadModelRef,
    enabled ? { worldId, modelKind: 'liveState', modelRef: `live:${worldId}` } : 'skip',
  );

  if (!enabled) {
    return (
      <PublicPageFrame worldId={null} showBackLink={false}>
        <h1 className="text-3xl font-bold">首頁</h1>
        <p className="mt-2">
          網址格式應為 <code>#home/&lt;worldId&gt;</code>
        </p>
      </PublicPageFrame>
    );
  }

  const vm = composeHomepageViewModel({
    worldId,
    summary: (onboarding?.payload ?? null) as HomeOnboardingSummary | null,
    world: (world?.payload ?? null) as HomeWorldProjection | null,
    live: (live?.payload ?? null) as HomeLiveProjection | null,
  });

  return <HomepageView worldId={worldId} vm={vm} />;
}

/**
 * Presentational homepage. Split out from the data-fetching default export so
 * the accessibility suite can render the real markup without a Convex client.
 */
export function HomepageView({ worldId, vm }: { worldId: string; vm: HomepageViewModel }) {
  return (
    <PublicPageFrame worldId={worldId} showBackLink={false}>
      <header>
        <h1 className="text-3xl font-bold">{vm.worldName}</h1>
        <p className="text-sm public-muted">
          世界日 {vm.worldDay} · {vm.timeSlot}
        </p>
      </header>

      {/* AC#2: first viewport prioritises the current major event. */}
      <section className="major-event mt-4" aria-labelledby="home-major-event">
        <h2 id="home-major-event" className="text-xl font-semibold">
          最新大事
        </h2>
        {vm.majorEvent ? <p>{vm.majorEvent}</p> : <p className="public-muted">尚無重大發展。</p>}
      </section>

      <section className="current-situation mt-4" aria-labelledby="home-current-situation">
        <h2 id="home-current-situation" className="text-xl font-semibold">
          目前局勢
        </h2>
        <p>{vm.currentSituation}</p>
      </section>

      <section className="disclosure mt-4" aria-labelledby="home-disclosure">
        <h2 id="home-disclosure" className="text-xl font-semibold">
          認識這個世界
        </h2>
        {/* AC#4: ≤4 core characters, three essential facts, one entry point. */}
        <h3 className="font-medium mt-2">核心角色</h3>
        <ul>
          {vm.characters.map((c) => (
            <li key={c.characterId}>{c.name}</li>
          ))}
        </ul>
        <h3 className="font-medium mt-2">必知事實</h3>
        <ul>
          {vm.facts.map((f) => (
            <li key={f.factId}>{f.label}</li>
          ))}
        </ul>
        <h3 className="font-medium mt-2">推薦入坑點</h3>
        {vm.recommendedEpisode ? (
          <a href={vm.recommendedEpisode.href}>從第 {vm.recommendedEpisode.episodeNumber} 集開始</a>
        ) : (
          <p className="public-muted">尚未推薦。</p>
        )}
      </section>

      {/* AC#5: live + voting render unavailable states without blocking. */}
      <section className="live mt-4" aria-labelledby="home-live">
        <h2 id="home-live" className="text-xl font-semibold">
          實況
        </h2>
        {vm.live ? (
          <p>
            世界日 {vm.live.worldDay} · {vm.live.timeSlot}
          </p>
        ) : (
          <p className="public-muted">實況尚未開始。</p>
        )}
        {/* NFR-009 AC#3: the text live view is the non-map equivalent of the
            world's live state, and the homepage is its entry point. */}
        <p className="mt-1">
          <a href={`#live/${worldId}`}>開啟文字實況(不需地圖)</a>
        </p>
      </section>
      <section className="vote mt-4" aria-labelledby="home-vote">
        <h2 id="home-vote" className="text-xl font-semibold">
          投票
        </h2>
        <p className="public-muted">{vm.voteAvailable ? '投票已開放。' : '投票尚未開放。'}</p>
      </section>
    </PublicPageFrame>
  );
}
