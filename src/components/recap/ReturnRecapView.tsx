/**
 * The return-recap presentation layer (FR-H004 / ART-39).
 *
 * Pure: no hooks, no Convex client, no clock. Everything it renders comes from the view model
 * {@link ./returnRecap.ts} composed, and every control is a callback the caller supplies. That is
 * what lets the accessibility suite render it through `react-dom/server` — which runs no effects
 * and fires no events — and it is also what keeps the write out of this file: the component can
 * ASK to record progress and has no way to do it.
 *
 * Accessibility (ART-93 / NFR-009): every region carries a visible heading that names it, the
 * follow controls are real `<button>`s with `aria-pressed`, the spoiler selector keeps its native
 * `<label>` association, and no meaning is carried by a glyph alone.
 */

import {
  FOLLOW_SETTINGS_NOTE,
  SPOILER_MODE_OPTIONS,
  type ReturnRecapViewModel,
} from './returnRecap';
import type { SpoilerMode } from '../../../convex/viewer/spoilerMode';

export type ReturnRecapHandlers = {
  onToggleCharacter: (characterId: string) => void;
  onToggleArc: (arcId: string) => void;
  onSpoilerModeChange: (mode: SpoilerMode) => void;
  onMarkWatched: () => void;
  /** The last write's verdict, in the viewer's language. Null when nothing has been attempted. */
  statusMessage: string | null;
  /** False while a write is in flight or when there is no usable device key. */
  controlsEnabled: boolean;
};

export function ReturnRecapView({
  vm,
  handlers,
}: {
  vm: ReturnRecapViewModel;
  handlers: ReturnRecapHandlers;
}) {
  /**
   * While the reads are in flight the page renders its heading and nothing else.
   *
   * `vm.loading` used to be computed, carried on the view model, and read by nobody — so first
   * paint announced four factual absences before any data existed: no episode to continue from,
   * no major events, no vote consequence, nothing to follow. Each is a claim about the world,
   * and each was false. `voteConsequenceModel.ts` documents this exact defect and the fix; this
   * is the same fix, and `returnRecap.test.ts` pins that a loading model makes no such claim.
   */
  if (vm.loading) {
    return (
      <header>
        <h1 className="text-3xl font-bold">回訪摘要</h1>
        <p className="mt-2">{vm.progressNote}</p>
      </header>
    );
  }

  return (
    <>
      <header>
        <h1 className="text-3xl font-bold">回訪摘要</h1>
        <p className="mt-2">{vm.progressNote}</p>
        {vm.awayNote !== null && <p className="mt-1 text-sm opacity-80">{vm.awayNote}</p>}
      </header>

      {/*
        The write verdict, announced rather than only displayed. Every control on this page is a
        server write that can be refused (budget, referential validation), and a refusal a screen
        reader never hears is a control that silently does nothing.
      */}
      <p aria-live="polite" className="mt-2 text-sm">
        {handlers.statusMessage ?? ''}
      </p>

      <section className="recap-continue mt-4" aria-labelledby="recap-continue-heading">
        <h2 id="recap-continue-heading" className="text-xl font-semibold">接續觀看</h2>
        {vm.continueFrom === null ? (
          <p className="opacity-60">目前沒有可以接續的集數。</p>
        ) : (
          <p className="mt-1">
            <a className="public-tap underline" href={vm.continueFrom.href}>
              第 {vm.continueFrom.episodeNumber} 集(第 {vm.continueFrom.worldDay} 天):{vm.continueFrom.title}
            </a>
            {vm.continueFrom.isRecommendedEntry && <span className="ml-2 text-sm">推薦入坑點</span>}
          </p>
        )}
        {vm.markableEpisodeId !== null && (
          <button
            type="button"
            className="public-tap mt-2 underline"
            disabled={!handlers.controlsEnabled}
            onClick={handlers.onMarkWatched}
          >
            標記為已看到這一集
          </button>
        )}
      </section>

      <section className="recap-highlights mt-4" aria-labelledby="recap-highlights-heading">
        <h2 id="recap-highlights-heading" className="text-xl font-semibold">離開期間的重點</h2>
        {vm.spoilerNote !== null && <p className="mt-1 text-sm">{vm.spoilerNote}</p>}
        {vm.highlights.length > 0 ? (
          <ul className="mt-2">
            {vm.highlights.map((highlight) => (
              <li key={highlight.eventId} className="mt-2">
                <span className="text-sm opacity-70">[{highlight.when}]</span>
                {/* AC#2: followed content is marked in text, not by position alone. */}
                {highlight.followed && <span className="ml-2 text-sm">追蹤中</span>}
                <span className="ml-2">{highlight.summary}</span>
                {highlight.href !== null && (
                  <a className="public-tap ml-2 text-sm underline" href={highlight.href}>查看本日故事</a>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 opacity-60">
            {vm.spoilerNote === null ? '離開期間沒有新的重大事件。' : ''}
          </p>
        )}
        {/* AC#1: the recap is bounded, and it says what it left out rather than dropping it silently. */}
        {vm.omittedHighlightCount > 0 && (
          <p className="mt-2 text-sm opacity-80">
            另外還有 {vm.omittedHighlightCount} 則重大事件未列出。完整清單請見
            <a className="public-tap ml-1 underline" href={`#timeline/${vm.worldId}`}>大事紀</a>。
          </p>
        )}
      </section>

      {vm.followedArcProgress.length > 0 && (
        <section className="recap-arcs mt-4" aria-labelledby="recap-arcs-heading">
          <h2 id="recap-arcs-heading" className="text-xl font-semibold">追蹤故事線的進展</h2>
          <ul className="mt-2">
            {vm.followedArcProgress.map((arc) => (
              <li key={arc.arcId} className="mt-1">
                <a className="public-tap underline" href={arc.href}>{arc.label}</a>
                <span className="ml-2 text-sm opacity-80">離開期間有 {arc.episodeCount} 集提到</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="recap-vote mt-4" aria-labelledby="recap-vote-heading">
        <h2 id="recap-vote-heading" className="text-xl font-semibold">觀眾投票</h2>
        {/*
          The trigger, and a sentence about what Canon does and does not record. There is
          deliberately no「投票效果」list: the consequence projection's `uncertain` bucket is
          context membership, not causation, and presenting it as an effect would violate
          FR-J002 AC#2. See `composeVoteRecapLine`.
        */}
        {vm.voteTrigger !== null && (
          <p className="mt-1">
            <span className="text-sm opacity-70">[{vm.voteTrigger.when}]</span>
            <span className="ml-2">{vm.voteTrigger.summary}</span>
          </p>
        )}
        <p className="mt-1 text-sm opacity-80">{vm.voteNote}</p>
      </section>

      <section className="recap-following mt-4" aria-labelledby="recap-following-heading">
        <h2 id="recap-following-heading" className="text-xl font-semibold">追蹤設定</h2>
        {/* The one place a viewer is told where their progress lives. See FOLLOW_SETTINGS_NOTE. */}
        <p className="mt-1 text-sm opacity-80">{FOLLOW_SETTINGS_NOTE}</p>

        <label className="mt-3 block text-sm">
          劇透模式
          <select
            className="ml-2"
            value={vm.spoilerMode}
            disabled={!handlers.controlsEnabled}
            onChange={(event) => handlers.onSpoilerModeChange(event.target.value as SpoilerMode)}
          >
            {SPOILER_MODE_OPTIONS.map((option) => (
              <option key={option.mode} value={option.mode}>{option.label}</option>
            ))}
          </select>
        </label>

        <FollowGroup
          heading="角色"
          headingId="recap-follow-characters"
          options={vm.followableCharacters}
          disabled={!handlers.controlsEnabled}
          onToggle={handlers.onToggleCharacter}
        />
        <FollowGroup
          heading="故事線"
          headingId="recap-follow-arcs"
          options={vm.followableArcs}
          disabled={!handlers.controlsEnabled}
          onToggle={handlers.onToggleArc}
        />
      </section>
    </>
  );
}

function FollowGroup({
  heading,
  headingId,
  options,
  disabled,
  onToggle,
}: {
  heading: string;
  headingId: string;
  options: ReturnRecapViewModel['followableCharacters'];
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="mt-3" role="group" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-base font-semibold">{heading}</h3>
      {options.length === 0 ? (
        <p className="opacity-60">尚無可追蹤的{heading}。</p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-2">
          {options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                className="public-tap underline"
                aria-pressed={option.following}
                disabled={disabled}
                onClick={() => onToggle(option.id)}
              >
                {option.following ? '取消追蹤' : '追蹤'} {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
