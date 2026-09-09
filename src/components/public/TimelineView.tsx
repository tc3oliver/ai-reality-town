import { useState } from 'react';
import { useQuery } from 'convex/react';
import { getPublishedReadModelRef } from './publicReadModelRef';
import { PublicPageFrame } from './PublicPageFrame';
import { emitTimelineFiltered } from '../../analytics/productEvents';
import {
  composeTimelineViewModel,
  parseTimelineRoute,
  type TimelineFilter,
  type TimelineProjection,
  type TimelineViewModel,
} from './timelineRoute';

/**
 * Public major-event world timeline (FR-I008). Reads ONLY the published
 * `timeline:<worldId>` projection via the failure-isolated public read model —
 * no generation on read. The projection is major-events-only by construction,
 * so the page defaults to major events (AC#1). Supports independent and
 * combined Arc / Character / Event-Type filters (AC#2) and links each event to
 * its related Episode when one exists (AC#3).
 *
 * ## Accessibility (NFR-009, ART-94)
 *
 * This page is a P1 view, so ART-93 — which established the public accessibility floor — did not
 * cover it, and it had drifted away from that floor in five specific ways. All five are fixed here
 * and pinned by `publicPages.a11y.test.tsx`:
 *
 *  - It rendered its own `Frame` rather than {@link PublicPageFrame}, so it carried **no
 *    `lang="zh-Hant"`** — a screen reader announced a page of Traditional Chinese in the document's
 *    declared English (WCAG 3.1.2) — and it put the back link **inside** `<main>`, which is the
 *    exact landmark defect `PublicPageFrame` was extracted to fix.
 *  - Its two sections were named `aria-label="Filters"` and `aria-label="Timeline events"`: English
 *    names on a Chinese page, and invisible, so a sighted keyboard user had no heading to navigate
 *    by. They are now visible `<h2>`s referenced by `aria-labelledby`, as every other public page
 *    does it.
 *  - Every event row rendered the same link text, 「查看本日故事 →」, with nothing to tell two rows
 *    apart in a screen reader's link list (WCAG 2.4.4).
 *  - Muted text used `opacity-70`/`opacity-60` rather than `--public-muted`. Opacity composites
 *    against whatever is behind it, so the resulting contrast is not a property the stylesheet
 *    harness can measure — and on the sunken surface it drops below AA.
 *  - Standalone links carried no `public-tap`, so they had no 44px touch target.
 *
 * Thin render layer: all route + filter + view-model logic lives in {@link ./timelineRoute}
 * (pure, unit-tested). {@link TimelineBody} is the presentational half, exported separately so the
 * accessibility suite can render the real markup without a Convex client — the suite renders
 * through `renderToStaticMarkup`, where no effect runs and no event fires.
 */

const NONE = '__none__';

/** The three dimensions the timeline filters on, in the order they render. */
const FILTER_DIMENSIONS = [
  { kind: 'arc', label: '故事線', id: 'timeline-filter-arc' },
  { kind: 'character', label: '角色', id: 'timeline-filter-character' },
  { kind: 'eventType', label: '事件類型', id: 'timeline-filter-event-type' },
] as const;

type FilterKind = (typeof FILTER_DIMENSIONS)[number]['kind'];

export default function TimelineView() {
  const route = typeof window === 'undefined' ? null : parseTimelineRoute(window.location.hash);
  const worldId = route?.worldId ?? null;
  const enabled = worldId !== null;

  // Public read only — no provider calls.
  const result = useQuery(
    getPublishedReadModelRef,
    enabled ? { worldId, modelKind: 'timeline', modelRef: `timeline:${worldId}` } : 'skip',
  );

  const [selection, setSelection] = useState<Record<FilterKind, string>>({
    arc: NONE, character: NONE, eventType: NONE,
  });

  /**
   * §15's `timeline_filtered`, emitted per DIMENSION rather than per selection.
   *
   * `filterKind` is part of the event's subject, so filtering by arc and then by character is
   * two measurements while re-picking a different arc is still one — which is the question the
   * metric asks (「篩選功能有沒有被用」), not「換了幾次選項」. Clearing a filter back to 全部
   * emits nothing: undoing a filter is not using one.
   */
  const onFilterChange = (kind: FilterKind, value: string) => {
    setSelection((current) => ({ ...current, [kind]: value }));
    if (worldId !== null && value !== NONE) emitTimelineFiltered(worldId, kind);
  };

  if (!enabled) {
    return (
      <PublicPageFrame worldId={null}>
        <h1 className="text-3xl font-bold">大事紀</h1>
        <p className="mt-2">網址格式應為 <code>#timeline/&lt;worldId&gt;</code></p>
      </PublicPageFrame>
    );
  }
  if (result === undefined) {
    return (
      <PublicPageFrame worldId={worldId}>
        <h1 className="text-3xl font-bold">大事紀</h1>
        <p className="mt-2">載入中…</p>
      </PublicPageFrame>
    );
  }

  const filter: TimelineFilter = {
    arc: selection.arc === NONE ? null : selection.arc,
    character: selection.character === NONE ? null : selection.character,
    eventType: selection.eventType === NONE ? null : selection.eventType,
  };
  const vm = composeTimelineViewModel({
    worldId,
    projection: (result?.payload ?? null) as TimelineProjection | null,
    filter,
  });

  return (
    <TimelineBody worldId={worldId} vm={vm} selection={selection} onFilterChange={onFilterChange} />
  );
}

/**
 * Presentational timeline. A pure function of its props — the filter selection is passed in rather
 * than held here — so the accessibility suite can render the real markup, including a filtered
 * state, without a Convex client and without firing an event.
 */
export function TimelineBody({
  worldId,
  vm,
  selection = { arc: NONE, character: NONE, eventType: NONE },
  onFilterChange,
}: {
  worldId: string;
  vm: TimelineViewModel;
  selection?: Record<FilterKind, string>;
  onFilterChange?: (kind: FilterKind, value: string) => void;
}) {
  const options: Record<FilterKind, readonly string[]> = {
    arc: vm.arcOptions, character: vm.characterOptions, eventType: vm.eventTypeOptions,
  };
  const filtered = FILTER_DIMENSIONS.some((dimension) => selection[dimension.kind] !== NONE);

  return (
    <PublicPageFrame worldId={worldId}>
      <header>
        <h1 className="text-3xl font-bold">大事紀</h1>
        <p className="text-sm public-muted">重大事件時間軸(預設僅顯示大事)。</p>
      </header>

      {/* AC#2: independent + combined arc/character/event-type filters. */}
      <section className="timeline-filters mt-4" aria-labelledby="timeline-filters">
        <h2 id="timeline-filters" className="text-xl font-semibold">篩選</h2>
        <div className="flex flex-wrap gap-3">
          {FILTER_DIMENSIONS.map((dimension) => (
            <label key={dimension.kind} className="text-sm" htmlFor={dimension.id}>
              {dimension.label}
              <select
                id={dimension.id}
                className="public-tap ml-2"
                value={selection[dimension.kind]}
                onChange={(event) => onFilterChange?.(dimension.kind, event.target.value)}
              >
                <option value={NONE}>全部</option>
                {options[dimension.kind].map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {/*
          How many events the current filter leaves, announced rather than left to be counted by
          eye. `role="status"` so a change is spoken without stealing focus — the whole point of a
          filter is that its effect is visible at a glance, and a screen-reader user has no glance.
        */}
        <p className="mt-2 text-sm public-muted" role="status">
          {filtered
            ? `目前篩選條件下共 ${vm.entries.length} 筆事件。`
            : `共 ${vm.entries.length} 筆重大事件。`}
        </p>
      </section>

      {/* AC#1: major-events-only projection. AC#3: episode links. */}
      <section className="timeline-list mt-4" aria-labelledby="timeline-list">
        <h2 id="timeline-list" className="text-xl font-semibold">事件</h2>
        {vm.entries.length > 0 ? (
          <ul className="public-rows">
            {vm.entries.map((entry) => (
              <li key={entry.eventId} className="mt-2">
                <span className="text-sm public-muted">
                  [日 {entry.worldDay} {entry.timeSlot} · {entry.eventType}]
                </span>
                <span className="ml-2">{entry.publicSummary}</span>
                {entry.episodeHref && (
                  // Every row renders the same visible text, so the accessible name carries the
                  // event it belongs to (WCAG 2.4.4) — the same treatment the character page's
                  // repeated 「本日故事」 link already had.
                  <a
                    className="public-tap ml-2 text-sm"
                    href={entry.episodeHref}
                    aria-label={`查看本日故事:日 ${entry.worldDay} ${entry.publicSummary}`}
                  >
                    查看本日故事 →
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="public-muted">{vm.hasContent ? '目前篩選條件下沒有事件。' : '尚無重大事件。'}</p>
        )}
      </section>
    </PublicPageFrame>
  );
}
