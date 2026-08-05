import { useState } from 'react';
import { useQuery } from 'convex/react';
import { getPublishedReadModelRef } from './publicReadModelRef';
import {
  composeTimelineViewModel,
  parseTimelineRoute,
  type TimelineFilter,
  type TimelineProjection,
} from './timelineRoute';

/**
 * Public major-event world timeline (FR-I008). Reads ONLY the published
 * `timeline:<worldId>` projection via the failure-isolated public read model —
 * no generation on read. The projection is major-events-only by construction,
 * so the page defaults to major events (AC#1). Supports independent and
 * combined Arc / Character / Event-Type filters (AC#2) and links each event to
 * its related Episode when one exists (AC#3). Mobile-accessible markup.
 *
 * Thin render layer: all route + filter + view-model logic lives in
 * {@link ./timelineRoute} (pure, unit-tested).
 */

const NONE = '__none__';

export default function TimelineView() {
  const route = typeof window === 'undefined' ? null : parseTimelineRoute(window.location.hash);
  const worldId = route?.worldId ?? null;
  const enabled = worldId !== null;

  // Public read only — no provider calls.
  const result = useQuery(
    getPublishedReadModelRef,
    enabled ? { worldId, modelKind: 'timeline', modelRef: `timeline:${worldId}` } : 'skip',
  );

  const [arc, setArc] = useState<string>(NONE);
  const [character, setCharacter] = useState<string>(NONE);
  const [eventType, setEventType] = useState<string>(NONE);

  if (!enabled) {
    return <Frame worldId={null}><p>網址格式應為 <code>#timeline/&lt;worldId&gt;</code></p></Frame>;
  }
  if (result === undefined) {
    return <Frame worldId={worldId}><p>載入中…</p></Frame>;
  }

  const filter: TimelineFilter = {
    arc: arc === NONE ? null : arc,
    character: character === NONE ? null : character,
    eventType: eventType === NONE ? null : eventType,
  };
  const vm = composeTimelineViewModel({
    worldId,
    projection: (result?.payload ?? null) as TimelineProjection | null,
    filter,
  });

  return (
    <Frame worldId={worldId}>
      <header>
        <h1 className="text-3xl font-bold">大事紀</h1>
        <p className="text-sm opacity-70">重大事件時間軸(預設僅顯示大事)。</p>
      </header>

      {/* AC#2: independent + combined arc/character/event-type filters. */}
      <section className="timeline-filters mt-4" aria-label="Filters">
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
          <label className="text-sm">
            事件類型
            <select value={eventType} onChange={(e) => setEventType(e.target.value)} className="ml-2">
              <option value={NONE}>全部</option>
              {vm.eventTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>
      </section>

      {/* AC#1: major-events-only projection. AC#3: episode links. */}
      <section className="timeline-list mt-4" aria-label="Timeline events">
        {vm.entries.length > 0 ? (
          <ul>
            {vm.entries.map((entry) => (
              <li key={entry.eventId} className="mt-2">
                <span className="text-sm opacity-70">[日 {entry.worldDay} {entry.timeSlot} · {entry.eventType}]</span>
                <span className="ml-2">{entry.publicSummary}</span>
                {/* AC#3: navigate to related Episode when available. */}
                {entry.episodeHref && <a href={entry.episodeHref} className="ml-2 text-sm underline">查看本日故事 →</a>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="opacity-60">{vm.hasContent ? '目前篩選條件下沒有事件。' : '尚無重大事件。'}</p>
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
