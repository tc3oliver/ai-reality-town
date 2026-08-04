import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import {
  composeCharacterViewModel,
  parseCharacterRoute,
  type CharacterProjection,
  type CharacterRecentEvent,
} from './characterRoute';

/**
 * Public character page (FR-I005). Reads ONLY the published `character:<id>`
 * projection (+ the world timeline, filtered to this character) via the
 * failure-isolated public read model — no generation on read. Renders the
 * server-allowlisted identity + state card and recent major events.
 *
 * Privacy boundary (AC#2/#3): the projection is field-allowlisted server-side
 * (ART-84) and re-sanitised on read; the view model is built from named fields
 * only ({@link ./characterRoute}) so forbidden keys can never reach the render.
 *
 * Thin render layer over pure, unit-tested logic. Mobile-accessible markup.
 */

type TimelinePayload = {
  entries: Array<{
    eventId: string; worldDay: number; timeSlot: string;
    publicSummary: string | null; characterIds: string[]; episodeNumber: number | null;
  }>;
};

export default function CharacterPage() {
  const route = typeof window === 'undefined' ? null : parseCharacterRoute(window.location.hash);
  const worldId = route?.worldId ?? null;
  const characterId = route?.characterId ?? null;
  const enabled = route !== null;

  // Public reads only — no provider calls.
  const characterResult = useQuery(
    api.publicRead.readModelFunctions.getPublishedReadModel,
    enabled ? { worldId: worldId as string, modelKind: 'character', modelRef: `character:${characterId}` } : 'skip',
  );
  const timelineResult = useQuery(
    api.publicRead.readModelFunctions.getPublishedReadModel,
    enabled ? { worldId: worldId as string, modelKind: 'timeline', modelRef: `timeline:${worldId}` } : 'skip',
  );

  if (!enabled) {
    return <Frame worldId={null}><p>網址格式應為 <code>#character/&lt;worldId&gt;/&lt;characterId&gt;</code></p></Frame>;
  }
  if (characterResult === undefined) {
    return <Frame worldId={worldId}><p>載入中…</p></Frame>;
  }

  const timeline = (timelineResult?.payload ?? null) as TimelinePayload | null;
  const recentEvents: CharacterRecentEvent[] | null = timeline
    ? timeline.entries
        .filter((entry) => entry.characterIds.includes(characterId as string))
        .map((entry) => ({
          eventId: entry.eventId, worldDay: entry.worldDay, timeSlot: entry.timeSlot,
          publicSummary: entry.publicSummary, episodeNumber: entry.episodeNumber,
        }))
    : null;

  const vm = composeCharacterViewModel({
    worldId: worldId as string,
    character: (characterResult?.payload ?? null) as CharacterProjection | null,
    recentEvents,
  });

  return (
    <Frame worldId={worldId}>
      <header>
        <h1 className="text-3xl font-bold">{vm.name}</h1>
        <p className="text-sm opacity-70">{vm.occupation} · {vm.age}歲{vm.alive ? '' : ' · 已歿'}{vm.active ? '' : ' · 暫離'}</p>
      </header>

      {vm.publicProfile && (
        <section className="character-profile mt-4" aria-label="Public background">
          <h2 className="text-xl font-semibold">背景</h2>
          <p>{vm.publicProfile}</p>
        </section>
      )}

      <section className="character-state mt-4" aria-label="Current state">
        <h2 className="text-xl font-semibold">目前狀態</h2>
        <ul className="text-sm">
          <li>健康:{vm.healthState}</li>
          <li>情緒:{vm.emotionalState}</li>
          <li>財務:{vm.financialState}</li>
        </ul>
      </section>

      {vm.publicGoal && (
        <section className="character-goal mt-4" aria-label="Public goal">
          <h2 className="text-xl font-semibold">公開目標</h2>
          <p>{vm.publicGoal}</p>
        </section>
      )}

      {(vm.personality || vm.values) && (
        <section className="character-traits mt-4" aria-label="Traits">
          <h2 className="text-xl font-semibold">特質</h2>
          <p className="text-sm">{[vm.personality, vm.values].filter(Boolean).join(' · ')}</p>
        </section>
      )}

      <section className="character-recent mt-4" aria-label="Recent major events">
        <h2 className="text-xl font-semibold">近期大事</h2>
        {vm.recentEvents.length > 0 ? (
          <ul>
            {vm.recentEvents.map((event) => (
              <li key={event.eventId} className="text-sm">
                {event.label}
                {event.episodeHref && <a href={event.episodeHref} className="ml-2 underline">本日故事 →</a>}
              </li>
            ))}
          </ul>
        ) : <p className="opacity-60">尚無與此角色相關的近期大事。</p>}
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
