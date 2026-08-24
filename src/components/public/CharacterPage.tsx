import { useQuery } from 'convex/react';
import { getPublishedReadModelRef } from './publicReadModelRef';
import { PublicPageFrame } from './PublicPageFrame';
import {
  composeCharacterViewModel,
  parseCharacterRoute,
  type CharacterProjection,
  type CharacterRecentEvent,
  type CharacterViewModel,
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
 * Thin render layer over pure, unit-tested logic. Accessibility (ART-93 /
 * NFR-009): each section is named by its own visible heading, and the repeated
 * per-event "本日故事" link gets a per-item accessible name so it still makes
 * sense when a screen reader lists the page's links out of context.
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
    getPublishedReadModelRef,
    enabled ? { worldId: worldId as string, modelKind: 'character', modelRef: `character:${characterId}` } : 'skip',
  );
  const timelineResult = useQuery(
    getPublishedReadModelRef,
    enabled ? { worldId: worldId as string, modelKind: 'timeline', modelRef: `timeline:${worldId}` } : 'skip',
  );

  if (!enabled) {
    return (
      <PublicPageFrame worldId={null}>
        <h1 className="text-3xl font-bold">角色</h1>
        <p className="mt-2">
          網址格式應為 <code>#character/&lt;worldId&gt;/&lt;characterId&gt;</code>
        </p>
      </PublicPageFrame>
    );
  }
  if (characterResult === undefined) {
    return (
      <PublicPageFrame worldId={worldId}>
        <h1 className="text-3xl font-bold">角色</h1>
        <p className="mt-2">載入中…</p>
      </PublicPageFrame>
    );
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

  return <CharacterPageView worldId={worldId as string} vm={vm} />;
}

/**
 * Presentational character page. Split out from the data-fetching default
 * export so the accessibility suite can render the real markup without a
 * Convex client.
 */
export function CharacterPageView({ worldId, vm }: { worldId: string; vm: CharacterViewModel }) {
  return (
    <PublicPageFrame worldId={worldId}>
      <header>
        <h1 className="text-3xl font-bold">{vm.name}</h1>
        <p className="text-sm public-muted">{vm.occupation} · {vm.age}歲{vm.alive ? '' : ' · 已歿'}{vm.active ? '' : ' · 暫離'}</p>
      </header>

      {vm.publicProfile && (
        <section className="character-profile mt-4" aria-labelledby="character-profile">
          <h2 id="character-profile" className="text-xl font-semibold">背景</h2>
          <p>{vm.publicProfile}</p>
        </section>
      )}

      <section className="character-state mt-4" aria-labelledby="character-state">
        <h2 id="character-state" className="text-xl font-semibold">目前狀態</h2>
        <ul className="public-rows text-sm">
          <li>健康:{vm.healthState}</li>
          <li>情緒:{vm.emotionalState}</li>
          <li>財務:{vm.financialState}</li>
        </ul>
      </section>

      {vm.publicGoal && (
        <section className="character-goal mt-4" aria-labelledby="character-goal">
          <h2 id="character-goal" className="text-xl font-semibold">公開目標</h2>
          <p>{vm.publicGoal}</p>
        </section>
      )}

      {(vm.personality || vm.values) && (
        <section className="character-traits mt-4" aria-labelledby="character-traits">
          <h2 id="character-traits" className="text-xl font-semibold">特質</h2>
          <p className="text-sm">{[vm.personality, vm.values].filter(Boolean).join(' · ')}</p>
        </section>
      )}

      <section className="character-recent mt-4" aria-labelledby="character-recent">
        <h2 id="character-recent" className="text-xl font-semibold">近期大事</h2>
        {vm.recentEvents.length > 0 ? (
          <ul className="public-rows">
            {vm.recentEvents.map((event) => (
              <li key={event.eventId} className="text-sm">
                {event.label}
                {event.episodeHref && (
                  // Every row renders the same visible text, so the accessible
                  // name carries the event it belongs to (WCAG 2.4.4).
                  <a
                    href={event.episodeHref}
                    className="ml-2"
                    aria-label={`本日故事:${event.label}`}
                  >
                    本日故事
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="public-muted">尚無與此角色相關的近期大事。</p>}
      </section>
    </PublicPageFrame>
  );
}
