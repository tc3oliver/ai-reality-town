import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import {
  composeHomepageViewModel,
  parseHomeRoute,
  type HomeLiveProjection,
  type HomeOnboardingSummary,
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
 * (pure, unit-tested).
 */

export default function Homepage() {
  // SSR-safe: window is undefined during prerender.
  const route = typeof window === 'undefined' ? null : parseHomeRoute(window.location.hash);
  const worldId = route?.worldId ?? null;
  const enabled = worldId !== null;

  // Public reads only — no provider calls (AC#1/#5).
  const onboarding = useQuery(
    api.publicRead.readModelFunctions.getPublishedReadModel,
    enabled ? { worldId, modelKind: 'world', modelRef: `onboarding:${worldId}` } : 'skip',
  );
  const world = useQuery(
    api.publicRead.readModelFunctions.getPublishedReadModel,
    enabled ? { worldId, modelKind: 'world', modelRef: `world:${worldId}` } : 'skip',
  );
  const live = useQuery(
    api.publicRead.readModelFunctions.getPublishedReadModel,
    enabled ? { worldId, modelKind: 'liveState', modelRef: `live:${worldId}` } : 'skip',
  );

  if (!enabled) {
    return <Frame><p>網址格式應為 <code>#home/&lt;worldId&gt;</code></p></Frame>;
  }

  const vm = composeHomepageViewModel({
    worldId,
    summary: (onboarding?.payload ?? null) as HomeOnboardingSummary | null,
    world: (world?.payload ?? null) as HomeWorldProjection | null,
    live: (live?.payload ?? null) as HomeLiveProjection | null,
  });

  return (
    <Frame>
      <header>
        <h1 className="text-3xl font-bold">{vm.worldName}</h1>
        <p className="text-sm opacity-70">世界日 {vm.worldDay} · {vm.timeSlot}</p>
      </header>

      {/* AC#2: first viewport prioritises the current major event. */}
      <section className="major-event mt-4" aria-label="Latest major event">
        <h2 className="text-xl font-semibold">最新大事</h2>
        {vm.majorEvent ? <p>{vm.majorEvent}</p> : <p className="opacity-60">尚無重大發展。</p>}
      </section>

      <section className="current-situation mt-4" aria-label="Current situation">
        <h2 className="text-xl font-semibold">目前局勢</h2>
        <p>{vm.currentSituation}</p>
      </section>

      <section className="disclosure mt-4" aria-label="Newcomer disclosure">
        <h2 className="text-xl font-semibold">認識這個世界</h2>
        {/* AC#4: ≤4 core characters, three essential facts, one entry point. */}
        <h3 className="font-medium mt-2">核心角色</h3>
        <ul>{vm.characters.map((c) => <li key={c.characterId}>{c.name}</li>)}</ul>
        <h3 className="font-medium mt-2">必知事實</h3>
        <ul>{vm.facts.map((f) => <li key={f.factId}>{f.label}</li>)}</ul>
        <h3 className="font-medium mt-2">推薦入坑點</h3>
        {vm.recommendedEpisode
          ? <a href={vm.recommendedEpisode.href}>從第 {vm.recommendedEpisode.episodeNumber} 集開始 →</a>
          : <p className="opacity-60">尚未推薦。</p>}
      </section>

      {/* AC#5: live + voting render unavailable states without blocking. */}
      <section className="live mt-4" aria-label="Live">
        <h2 className="text-xl font-semibold">實況</h2>
        {vm.live
          ? <p>世界日 {vm.live.worldDay} · {vm.live.timeSlot}</p>
          : <p className="opacity-60">實況尚未開始。</p>}
      </section>
      <section className="vote mt-4" aria-label="Vote">
        <h2 className="text-xl font-semibold">投票</h2>
        <p className="opacity-60">{vm.voteAvailable ? '' : '投票尚未開放。'}</p>
      </section>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="public-page mx-auto max-w-2xl p-4 font-body">
      <div>{children}</div>
    </main>
  );
}
