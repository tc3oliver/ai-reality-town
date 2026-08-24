import { useQuery } from 'convex/react';
import { getPublishedReadModelRef } from './publicReadModelRef';
import { getPublicRuntimeSnapshotRef } from './publicRuntimeSnapshotRef';
import { PublicPageFrame } from './PublicPageFrame';
import { CharacterSprite } from './CharacterSprite';
import { PublicStatusChips } from './PublicStatusChips';
import { freshnessDescriptor, worldClockDescriptors } from './publicStatusBadge';
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
  /**
   * The runtime freshness verdict (ART-131 AC#3). A fourth read, and an anonymous `query` that
   * was already on the public allowlist — reading it cannot ask the world for anything.
   *
   * On the homepage rather than only on the map because "is this thing actually running?" is a
   * question a visitor has before they open the map, and answering it only after they have is
   * answering it too late. `undefined` (in flight) and `null` (no capture yet) both render no
   * badge rather than a guessed one: a wrong state claim is worse than none.
   */
  const runtime = useQuery(getPublicRuntimeSnapshotRef, enabled ? { worldId } : 'skip');

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
    base: import.meta.env.BASE_URL,
  });

  return <HomepageView worldId={worldId} vm={vm} freshness={runtime?.freshness ?? null} />;
}

/**
 * Presentational homepage. Split out from the data-fetching default export so
 * the accessibility suite can render the real markup without a Convex client.
 */
export function HomepageView({
  worldId,
  vm,
  freshness = null,
}: {
  worldId: string;
  vm: HomepageViewModel;
  /**
   * The runtime freshness verdict, or `null` when it is in flight, uncaptured, or unrecognised
   * (ART-131 AC#3). Omitted renders no badge, so the accessibility suite and any caller that has
   * not adopted it is unchanged.
   */
  freshness?: string | null;
}) {
  const runtimeChip = freshnessDescriptor(freshness);
  return (
    <PublicPageFrame worldId={worldId} showBackLink={false}>
      <header>
        <h1 className="text-3xl font-bold">{vm.worldName}</h1>
        {/* The world clock as chips rather than as a muted sentence (ART-131 AC#3): it is
            metadata about what the viewer is looking at, and chips say so at a glance. */}
        <PublicStatusChips chips={worldClockDescriptors(vm.worldDay, vm.timeSlot)} label="世界時間" />
      </header>

      {/* THE FIRST SCREEN (FR-P001 / ART-129).
          UX2-001 asks a viewer to SEE the world before reading about it, so the live entry point
          leads (AC#1) and everything AC#2 names is in this one section: the current situation, the
          primary arc, up to four core characters drawn with their own sprites, the latest major
          event and the recommended Episode. It is one `<section>` rather than five so it is one
          screenful rather than five headings a viewer scrolls past. */}
      <section className="home-first-screen mt-4" aria-labelledby="home-first-screen">
        <h2 id="home-first-screen" className="text-xl font-semibold">
          現在的霧林鎮
        </h2>

        {/* AC#1 — the live world is the lead action, not a link buried under the prose. */}
        <p className="home-lead-actions">
          <a className="public-tap home-lead-live" href={vm.liveMapHref}>
            進入實況地圖
          </a>
          {/* NFR-009 AC#3: the non-map equivalent is always offered beside it, never instead. */}
          <a className="public-tap" href={vm.textLiveHref}>
            改用文字實況(不需地圖)
          </a>
        </p>

        {/* AC#3 — the first screen is not only headings and lists: the residents are drawn. */}
        <ul className="home-cast" aria-label="核心角色">
          {vm.characters.map((character) => (
            <li key={character.characterId}>
              <a className="home-cast-link public-tap" href={character.href}>
                <CharacterSprite characterId={character.characterId} spriteKey={character.spriteKey} />
                <span>{character.name}</span>
              </a>
            </li>
          ))}
        </ul>

        <p className="mt-2">{vm.currentSituation}</p>

        {/* AC#2 — the primary arc, chosen with the same ordering the live overlay uses. */}
        {vm.primaryArc !== null && (
          <p className="mt-2 text-sm">
            <a href={vm.primaryArc.href}>{vm.primaryArc.title}</a>
            <span className="public-muted">({vm.primaryArc.statusLabel})</span>
            {vm.primaryArc.currentQuestion.length > 0 && (
              <span className="block">懸而未決:{vm.primaryArc.currentQuestion}</span>
            )}
          </p>
        )}

        <h3 className="font-medium mt-2">最新大事</h3>
        {vm.majorEvent ? <p>{vm.majorEvent}</p> : <p className="public-muted">尚無重大發展。</p>}

        {/* AC#5 — a scene links through to the day it belongs to. */}
        {vm.activeScenes.length > 0 && (
          <ul className="public-rows text-sm mt-2" aria-label="進行中的場景">
            {vm.activeScenes.map((scene) => (
              <li key={scene.key}>
                <a href={scene.href} aria-label={`本日故事:${scene.title}`}>{scene.title}</a>
                {scene.summary.length > 0 && <span className="public-muted">{scene.summary}</span>}
              </li>
            ))}
          </ul>
        )}

        {/* AC#2 — the recommended Episode, with its absence stated rather than left blank, the
            same way 最新大事 above does. This is the page's ONLY recommendation link; the
            disclosure section below used to carry a second one to the same Episode, and two links
            to one destination is one destination twice for anyone navigating by link. */}
        {vm.recommendedEpisode !== null ? (
          <p className="mt-2 text-sm">
            <a className="public-tap" href={vm.recommendedEpisode.href}>
              從第 {vm.recommendedEpisode.episodeNumber} 集開始認識這個世界
            </a>
          </p>
        ) : (
          <p className="mt-2 text-sm public-muted">尚未推薦入坑點。</p>
        )}
      </section>

      <section className="disclosure mt-4" aria-labelledby="home-disclosure">
        <h2 id="home-disclosure" className="text-xl font-semibold">
          認識這個世界
        </h2>
        {/* The cast and the recommended Episode moved to the first screen with ART-129, where the
            cast is drawn rather than listed; repeating either here would be the same four names,
            and the same Episode link, twice on one page. */}
        <h3 className="font-medium mt-2">必知事實</h3>
        <ul className="public-rows">
          {vm.facts.map((f) => (
            <li key={f.factId}>{f.label}</li>
          ))}
        </ul>
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
        {/* AC#3. Rendered only when the server has actually reached a verdict: a state claim
            nobody has checked is worse than no claim, which is also why `stale` is a state of its
            own rather than being reported as `paused`. */}
        {runtimeChip !== null && (
          <PublicStatusChips chips={[runtimeChip]} label="世界運作狀態" live />
        )}
        {/* FR-O001: the animated live map is the primary live entry point... */}
        <p className="mt-1">
          <a href={vm.liveMapHref}>開啟實況地圖</a>
        </p>
        {/* ...and NFR-009 AC#3: its non-map equivalent is always offered beside it. */}
        <p className="mt-1">
          <a href={vm.textLiveHref}>開啟文字實況(不需地圖)</a>
        </p>
        {/* ART-113 (FR-N002 AC#8): the watch-only guide replaces the retired
            "how to play" help. It describes watching and navigating, and
            promises no joining, controlling or chatting. */}
        <p className="mt-1">
          <a href={`#help/${worldId}`}>觀看指南</a>
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
