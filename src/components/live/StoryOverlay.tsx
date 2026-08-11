import type { ReactNode } from 'react';

import type { StoryOverlaySourceStatus, StoryOverlayViewModel } from './storyOverlayModel';

/**
 * The Live Story Overlay (FR-O007 / ART-125).
 *
 * A sibling of {@link ./ActiveScenePanel} and {@link ./CharacterCard}, bound by the same rules:
 * props in, no query and no mutation, every value composed one level up by
 * {@link composeStoryOverlayViewModel} in {@link ./LiveMapPage}.
 *
 * COLLAPSIBLE, NOT AN OVERLAY LAYER (AC#5). Despite the name, this renders as an ordinary
 * block-stacked `<section>` above the canvas, never as a positioned layer on top of it: a panel
 * that covers the map hides the thing it is describing, and "alongside the map" is satisfied by
 * co-presence rather than by stacking. Because it is a block sibling of `.live-map-canvas` it is
 * structurally incapable of obscuring it — no z-index or positioning decision could ever regress
 * that, which is a stronger guarantee than any amount of careful CSS.
 *
 * The collapse itself is a native `<details>`/`<summary>`, which is why this file holds no state
 * and no handler. There is no collapsible primitive in this codebase to follow, and a hand-built
 * one would need its own `aria-expanded` wiring, its own keyboard handling and its own focus
 * behaviour to be as good as the element the browser already ships. It renders OPEN by default —
 * PRD 2.0 UX2-004 asks for narrative context to be permanently available, so collapsing is the
 * viewer's choice (the reason AC#5 asks for it is a small screen, not a default).
 *
 * The summary line carries the world clock, so a viewer who has collapsed the panel still knows
 * WHEN what they are watching is happening.
 *
 * EVERY SECTION REPORTS ITS OWN SOURCE'S STATE. The overlay is fed by two independent reads that
 * resolve at different times, so a single panel-wide status would make each section claim
 * something its own source has not said: a page-level spinner rendering ABOVE "there is no major
 * event" is two contradictory statements at once, and "there is no major event" is a confident
 * claim that must never stand in for "that read has not arrived". Each block below therefore
 * renders from `summaryStatus` or `arcStatus`, whichever governs it, through {@link SourceState}.
 */
export function StoryOverlay({ viewModel }: { viewModel: StoryOverlayViewModel }) {
  return (
    <section className="live-story-overlay mt-3" aria-labelledby="live-story-overlay">
      <details className="live-story-overlay-details" open>
        <summary className="live-story-overlay-summary">
          <h2 id="live-story-overlay" className="text-xl font-semibold inline">
            故事資訊
          </h2>
          {/* AC#1's world clock, deliberately in the summary rather than the body: it is the one
              line that must survive the panel being collapsed. */}
          <span className="public-muted text-sm ml-2">
            {viewModel.worldDayLabel} · {viewModel.timeSlotLabel}
          </span>
        </summary>

        <div className="live-story-overlay-body">
          <div className="mt-2">
            <h3 className="font-medium">目前情勢</h3>
            <SourceState
              status={viewModel.summaryStatus}
              loading="載入目前情勢中…"
              unavailable="這個世界的故事摘要尚未建立,以下只有地圖上的即時狀態。"
              empty="目前沒有可顯示的情勢摘要。"
            >
              {viewModel.currentSituationText === null || viewModel.currentSituationText.length === 0
                ? null
                : <p className="text-sm">{viewModel.currentSituationText}</p>}
            </SourceState>
          </div>

          <div className="mt-2">
            <h3 className="font-medium">主線故事</h3>
            <SourceState
              status={viewModel.arcStatus}
              loading="載入故事線中…"
              unavailable="故事線資料尚未建立。"
              // Only reachable once the read has genuinely landed, which is the whole point of
              // tracking this source separately: "no arc is running" is a claim about the world,
              // not about the network.
              empty="目前沒有進行中的主線故事。"
            >
              {viewModel.primaryArc === null ? null : (
                <p className="text-sm" data-arc-status={viewModel.primaryArc.status}>
                  {viewModel.primaryArc.title}
                  <span className="public-muted">({viewModel.primaryArc.statusLabel})</span>
                  {viewModel.primaryArc.currentQuestion.length > 0 && (
                    <span className="block">懸而未決:{viewModel.primaryArc.currentQuestion}</span>
                  )}
                </p>
              )}
            </SourceState>
          </div>

          {/* No status of its own: the scenes arrive with the projection the canvas is drawing,
              so if this component rendered at all they are as current as the map itself. */}
          <div className="mt-2">
            <h3 className="font-medium">進行中的場景</h3>
            {viewModel.activeSceneSummary.count === 0 ? (
              <p className="public-muted text-sm">目前沒有進行中的場景。</p>
            ) : (
              <p className="text-sm">
                {viewModel.activeSceneSummary.count} 個場景
                {viewModel.activeSceneSummary.brief !== null && `:${viewModel.activeSceneSummary.brief}`}
              </p>
            )}
          </div>

          <div className="mt-2">
            <h3 className="font-medium">最新大事</h3>
            <SourceState
              status={viewModel.summaryStatus}
              loading="載入近期大事中…"
              unavailable="近期大事尚未建立。"
              empty="目前沒有可顯示的近期大事。"
            >
              {viewModel.latestMajorEvent === null
                ? null
                : <p className="text-sm">{viewModel.latestMajorEvent}</p>}
            </SourceState>
          </div>

          {/* AC#2 — where to catch up. Rendered whenever the summary supplied one, independently
              of every other block: a viewer whose arc read failed is exactly the one who most
              needs the narrated version. */}
          {viewModel.recommendedEntry !== null && (
            <p className="mt-2 text-sm">
              <a href={viewModel.recommendedEntry.href}>
                從第 {viewModel.recommendedEntry.episodeNumber} 集開始認識這個世界
              </a>
            </p>
          )}
        </div>
      </details>
    </section>
  );
}

/**
 * One section's body, told by the state of the read that supplies it.
 *
 * Four outcomes, never merged: the read is in flight, it completed and the model was never
 * built, it completed and the field is genuinely absent, or there is something to show. Only the
 * third may be phrased as a fact about the world — which is why the caller passes three separate
 * sentences rather than one placeholder. Every branch renders a sentence, so no section is ever
 * a heading over a blank region.
 */
function SourceState({
  status,
  loading,
  unavailable,
  empty,
  children,
}: {
  status: StoryOverlaySourceStatus;
  loading: string;
  unavailable: string;
  empty: string;
  children: ReactNode;
}) {
  if (status === 'loading') return <p className="public-muted text-sm">{loading}</p>;
  // A completed read that found no published model — never built, rather than late. Saying
  // "loading" here would wait forever for something that is not coming.
  if (status === 'unavailable') return <p className="public-muted text-sm">{unavailable}</p>;
  if (children === null) return <p className="public-muted text-sm">{empty}</p>;
  return <>{children}</>;
}
