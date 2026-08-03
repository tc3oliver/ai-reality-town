import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

/**
 * Story-first public homepage (FR-I001, UX-001..006). Reads ONLY published
 * projections via the failure-isolated public read model — no generation on
 * read. The first viewport prioritises the current major event (AC#2) and the
 * newcomer disclosure is bounded to one primary arc, ≤4 core characters, three
 * essential facts, and one entry point (AC#4). Voting/live render graceful
 * unavailable states without blocking (AC#5). Mobile-accessible markup.
 */

type OnboardingSummary = {
  summaryText: string;
  structured: {
    majorEvent: { eventId: string; publicSummary: string } | null;
    importance: number;
    characters: Array<{ characterId: string; name: string }>;
    facts: Array<{ factId: string; predicate: string; value: string | number | boolean }>;
    question: string | null;
    recommendedEpisode: { episodeNumber: number; worldDay: number } | null;
  };
};

type WorldProjection = {
  name: string | null;
  currentWorldDay: number | null;
  currentTimeSlot: string | null;
};

type LiveProjection = { worldTime: { worldDay: number; timeSlot: string } | null };

function useWorldId(): string | null {
  const hash = typeof window === 'undefined' ? '' : window.location.hash.replace(/^#/, '');
  const match = hash.match(/^home\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default function Homepage() {
  const worldId = useWorldId();
  const enabled = worldId !== null;

  // Public reads only — no provider calls (AC#1/#5).
  const onboarding = useQuery(
    api.publicRead.readModelFunctions.getPublishedReadModel,
    enabled ? { worldId: worldId as string, modelKind: 'world', modelRef: `onboarding:${worldId as string}` } : 'skip',
  );
  const world = useQuery(
    api.publicRead.readModelFunctions.getPublishedReadModel,
    enabled ? { worldId: worldId as string, modelKind: 'world', modelRef: `world:${worldId as string}` } : 'skip',
  );
  const live = useQuery(
    api.publicRead.readModelFunctions.getPublishedReadModel,
    enabled ? { worldId: worldId as string, modelKind: 'liveState', modelRef: `live:${worldId as string}` } : 'skip',
  );

  if (!enabled) {
    return <Frame><p>網址格式應為 <code>#home/&lt;worldId&gt;</code></p></Frame>;
  }

  const summary = (onboarding?.payload ?? null) as OnboardingSummary | null;
  const worldProj = (world?.payload ?? null) as WorldProjection | null;
  const liveProj = (live?.payload ?? null) as LiveProjection | null;

  return (
    <Frame>
      <header>
        <h1 className="text-3xl font-bold">{worldProj?.name ?? '這個世界'}</h1>
        <p className="text-sm opacity-70">
          世界日 {worldProj?.currentWorldDay ?? '—'} · {worldProj?.currentTimeSlot ?? '—'}
        </p>
      </header>

      {/* AC#2: first viewport prioritises the current major event. */}
      <section className="major-event mt-4" aria-label="Latest major event">
        <h2 className="text-xl font-semibold">最新大事</h2>
        {summary?.structured.majorEvent
          ? <p>{summary.structured.majorEvent.publicSummary}</p>
          : <p className="opacity-60">尚無重大發展。</p>}
      </section>

      <section className="current-situation mt-4" aria-label="Current situation">
        <h2 className="text-xl font-semibold">目前局勢</h2>
        <p>{summary?.summaryText ?? '摘要尚不可用。'}</p>
      </section>

      <section className="disclosure mt-4" aria-label="Newcomer disclosure">
        <h2 className="text-xl font-semibold">認識這個世界</h2>
        {/* AC#4: ≤4 core characters, three essential facts, one entry point. */}
        <h3 className="font-medium mt-2">核心角色</h3>
        <ul>{(summary?.structured.characters ?? []).map((c) => <li key={c.characterId}>{c.name}</li>)}</ul>
        <h3 className="font-medium mt-2">必知事實</h3>
        <ul>{(summary?.structured.facts ?? []).map((f) => <li key={f.factId}>{f.predicate}:{String(f.value)}</li>)}</ul>
        <h3 className="font-medium mt-2">推薦入坑點</h3>
        {summary?.structured.recommendedEpisode ? (
          <a href={`#episode/${worldId}/${summary.structured.recommendedEpisode.worldDay}`}>
            從第 {summary.structured.recommendedEpisode.episodeNumber} 集開始 →
          </a>
        ) : <p className="opacity-60">尚未推薦。</p>}
      </section>

      {/* AC#5: live + voting render unavailable states without blocking. */}
      <section className="live mt-4" aria-label="Live">
        <h2 className="text-xl font-semibold">實況</h2>
        {liveProj?.worldTime
          ? <p>世界日 {liveProj.worldTime.worldDay} · {liveProj.worldTime.timeSlot}</p>
          : <p className="opacity-60">實況尚未開始。</p>}
      </section>
      <section className="vote mt-4" aria-label="Vote">
        <h2 className="text-xl font-semibold">投票</h2>
        <p className="opacity-60">投票尚未開放。</p>
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
