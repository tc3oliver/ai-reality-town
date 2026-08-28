/**
 * Pure, testable logic for the device-aware return recap (FR-H004, ART-39, PRD §13.12).
 *
 * The React layer is thin: route resolution, the whole view model, and every piece of copy live
 * here as pure functions, unit-tested without a DOM — the same split `homeRoute.ts`, `arcRoute.ts`
 * and `timelineRoute.ts` use.
 *
 * ## Where the content comes from, and what that means for the safety gate
 *
 * The recap is composed ENTIRELY from already-published read models — `episodes:<worldId>`
 * (FR-I004), `timeline:<worldId>` (FR-I008) and `voteConsequence:<worldId>:<day>` (FR-J002) —
 * plus the viewer's own progress row. It derives no text from Canon and publishes no new read
 * model, so the ART-132 post-generation safety gate has ALREADY been applied to every sentence it
 * can render: `rebuildTimelineProjection` redacts withheld scene summaries before publishing, and
 * the consequence projection does the same. Re-running the gate here would be a second,
 * client-side copy of a decision the server already made, and a copy that could drift.
 *
 * The rejected alternative was a server-side `recap:<worldId>:<viewerKey>` read model. It would
 * have put a per-viewer row into the published read-model store — a table whose entire design
 * assumes its contents are world-scoped and cacheable — and it would have made a viewer's
 * follow set a thing the publication pipeline rebuilds on every Canon commit. See
 * `docs/device-return-recap.md` §6.
 *
 * ## AC#1 is a constraint on the OUTPUT, not on the input
 *
 * 「不逐日完整列出所有事件」. A viewer who has been away thirty days must not receive thirty days
 * of events. So the builder reports the gap as COUNTS, selects at most
 * {@link MAX_RECAP_HIGHLIGHTS} entries regardless of how many are available, states how many it
 * left out, and caps each line by 中文字 count. A recap that grew with the absence would be an
 * event log with a heading.
 *
 * ## AC#2 is an ordering guarantee
 *
 * 「優先顯示使用者追蹤內容」. Followed characters and arcs are selected FIRST and fill the budget
 * before anything else is considered, so a viewer following one character never loses their
 * highlight to a busier storyline.
 *
 * Pure module — no React, no Convex, no DOM, no clock, no randomness. Input shapes mirror the
 * published payloads exactly (redeclared locally, as every public page does).
 */

import { countChineseCharacters } from '../../../convex/shared/publicText';
import { isSpoilerMode, SPOILER_MODES, type SpoilerMode } from '../../../convex/viewer/spoilerMode';

/**
 * Re-exported so `src/components/public` can name the mode without depending on `convex/viewer`.
 *
 * `clientPublic` may not reach the viewer module — that boundary is what keeps the write gate's
 * blast radius the two declared client roots. This module may, so it is the seam.
 */
export type { SpoilerMode };
import {
  DEFAULT_SPOILER_MODE,
  parseViewerProgressEpisodeId,
  viewerProgressEpisodeId,
} from '../../../convex/viewer/viewerProgress';

// ---------------------------------------------------------------------------
// Published payload shapes
// ---------------------------------------------------------------------------

/** Published episode index (`episodes:<worldId>`, FR-I004) — fields the recap reads. */
export type RecapEpisodeIndex = {
  episodes: Array<{
    worldDay: number;
    episodeNumber: number;
    title: string;
    headline: string;
    arcIds?: string[];
    characterIds?: string[];
    isRecommendedEntry?: boolean;
    isTurningPoint?: boolean;
  }>;
  arcIds?: string[];
  characterIds?: string[];
};

/** Published major-event timeline (`timeline:<worldId>`, FR-I008) — fields the recap reads. */
export type RecapTimeline = {
  entries: Array<{
    eventId: string;
    worldDay: number;
    timeSlot?: string;
    eventType?: string;
    publicSummary: string | null;
    arcIds?: string[];
    characterIds?: string[];
    episodeNumber?: number | null;
  }>;
};

/**
 * Published vote-consequence model (`voteConsequence:<worldId>:<day>`, FR-J002).
 *
 * Only three fields are read, and `uncertain` is deliberately NOT one of them. See
 * {@link composeVoteRecapLine}.
 */
export type RecapVoteConsequence = {
  targetWorldDay: number;
  trigger: {
    eventId: string;
    worldDay: number;
    timeSlot: string;
    publicSummary: string | null;
    publicationStatus: string;
  } | null;
  explicitCausalEdgeCount: number;
};

/** The §13.12 progress record, as `getViewerProgress` returns it. */
export type RecapProgress = {
  lastViewedEpisodeId: string | null;
  followedCharacterIds: string[];
  followedArcIds: string[];
  spoilerMode: string;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/**
 * How many event highlights the recap may ever render, followed and unfollowed combined.
 *
 * The number that makes AC#1 structural. Five is what fits a first screen without scrolling on a
 * phone and is small enough that a thirty-day absence and a two-day absence produce a recap of
 * the same size — which is the property「不逐日完整列出」actually asks for.
 */
export const MAX_RECAP_HIGHLIGHTS = 5;

/** How many followed arcs the recap lists progress for. Bounded for the same reason. */
export const MAX_RECAP_ARC_PROGRESS = 3;

/**
 * Maximum length of one recap line, in 中文字.
 *
 * Counted with {@link countChineseCharacters} rather than `String.length` because this project's
 * length unit is 中文字 everywhere else (FR-G003's recap formats), and a code-unit cap would
 * measure a Chinese sentence and an English one on two different scales.
 */
export const RECAP_LINE_MAX_CHARACTERS = 40;

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const NO_SUMMARY = '(無摘要)';
const WITHHELD_SUMMARY = '(這段敘述目前不予公開)';

/** Shown when this device has never recorded progress — the honest first-visit state (AC#3). */
export const NO_PROGRESS_NOTE = '這個裝置還沒有記錄觀看進度。先挑一集開始看,或在下方追蹤你在意的角色與故事線。';

/** Shown when `localStorage` is unavailable, so the page says why instead of failing silently. */
export const NO_STORAGE_NOTE = '這個瀏覽器不允許儲存本機資料,因此無法記住裝置層級的觀看進度。你仍然可以瀏覽以下重點。';

export const LOADING_STATUS = '載入中…';

/**
 * The ONLY sentence a viewer ever reads about where their progress lives — so it has to be true.
 *
 * It previously said 「這些設定只存在這個裝置上」, which is the opposite of what this feature does:
 * progress is a row in a Convex table, keyed by a digest of a token this browser minted. That
 * matters more than a wording slip. The 「deviceKey 是一項主張,不是身分」caveat is stated
 * thoroughly everywhere a REVIEWER meets it (`convex/viewer/viewerProgress.ts`,
 * `viewerProgressFunctions.ts`, `viewer/schema.ts`, `docs/device-return-recap.md` §5) and nowhere
 * a VIEWER meets it — and the one string a viewer did meet overclaimed in the other direction,
 * promising a privacy property the system does not provide.
 *
 * What it says now is what is actually true, in the order a viewer needs it: the settings are
 * bound to this browser rather than to an account, no login is required, and clearing browser
 * data loses them. Pinned by `returnRecap.test.ts`.
 */
export const FOLLOW_SETTINGS_NOTE =
  '追蹤的角色與故事線會在回訪摘要中優先顯示。這些設定綁定這個瀏覽器,不需要登入;它們儲存在伺服器上,以這個瀏覽器產生的一組隨機識別碼對應,清除瀏覽器資料後就會失效。';

/** Shown once the reads settle and the world genuinely has nothing published. */
export const NO_CONTENT_NOTE = '這個世界目前還沒有已發佈的內容可以摘要。';

/**
 * Said when the day's vote produced a trigger but Canon records no causal edge from it.
 *
 * The same distinction `src/components/vote/voteConsequenceModel.ts` protects, restated because
 * this surface makes the claim independently:「沒有記錄到因果關聯」is a statement about the
 * evidence,「沒有造成任何影響」would be a statement about the world. Only the first is true.
 */
export const VOTE_NO_CAUSAL_EDGE_NOTE =
  'Canon 目前沒有記錄任何事件明確由這次投票引發,因此這裡只列出投票送進世界的事件本身。';

/**
 * Said when the summarised day has no accepted viewer-vote event.
 *
 * Names the DAY, because that is all this section looked at. The first version said
 * 「你離開期間沒有由觀眾投票觸發的事件」— a claim about the whole absence, made from one day's
 * consequence model, and it disagreed with {@link VOTE_UNAVAILABLE_NOTE} two lines below, which
 * had always correctly said 「這一天」. The recap reads one `voteConsequence:<worldId>:<day>` model
 * (see `docs/device-return-recap.md` §12), so one day is what it may speak about.
 */
export function voteNoTriggerNote(targetWorldDay: number): string {
  return `第 ${targetWorldDay} 天沒有由觀眾投票觸發的事件(回訪摘要只檢視最新一天的投票)。`;
}

/** Said when the consequence model has not been published for the day being summarised. */
export const VOTE_UNAVAILABLE_NOTE = '尚未有這一天的投票後果資料。';

/**
 * Said under Watched Episodes Only.
 *
 * Not a degraded state to apologise for — it is what the mode MEANS. A return recap's whole
 * content is episodes the viewer has not watched, so a `watchedOnly` recap that listed them would
 * be the mode failing to do the one thing it exists for. The page says so and offers the
 * continuation point instead.
 */
export const WATCHED_ONLY_NOTE =
  '你選擇了「只看已觀看集數」。回訪摘要的內容全部來自你尚未觀看的集數,因此這裡不列出重點,只提供接續觀看的位置。';

const SPOILER_MODE_LABELS: Readonly<Record<SpoilerMode, string>> = {
  full: '完整視角',
  publicOnly: '只看公開資訊',
  watchedOnly: '只看已觀看集數',
};

export function spoilerModeLabel(mode: string): string {
  return isSpoilerMode(mode) ? SPOILER_MODE_LABELS[mode] : SPOILER_MODE_LABELS[DEFAULT_SPOILER_MODE];
}

/** Every mode a viewer may pick, with its label. Ordered as `SPOILER_MODES` declares them. */
export const SPOILER_MODE_OPTIONS: ReadonlyArray<{ mode: SpoilerMode; label: string }> =
  SPOILER_MODES.map((mode) => ({ mode, label: SPOILER_MODE_LABELS[mode] }));

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/**
 * Resolve the public world from `#recap/<worldId>`.
 *
 * A route of its own rather than a homepage section, and that is a correctness decision rather
 * than a layout one: the homepage is asserted to issue an exact set of queries and zero writes
 * (`e2e/dynamicView.spec.ts`), and mounting a per-viewer read and a write control there would
 * dissolve the evidence ART-127 / ART-137 rest on. Returns null for a bare/unknown route so the
 * component can surface a format hint.
 */
export function parseRecapRoute(hash: string): { worldId: string } | null {
  const stripped = hash.replace(/^#/, '');
  const match = stripped.match(/^recap\/([^/]+)$/);
  if (!match) return null;
  const worldId = decodeURIComponent(match[1]);
  return worldId.length > 0 ? { worldId } : null;
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

export type RecapHighlight = {
  eventId: string;
  summary: string;
  /** `第 7 天 · evening`, so a line is locatable without opening anything. */
  when: string;
  /** True when this event names a followed character or arc — AC#2's ordering key. */
  followed: boolean;
  /** Deep link to the episode covering the event's day, when one is published. */
  href: string | null;
};

export type RecapArcProgress = {
  arcId: string;
  /** How many published episodes touched this arc while the viewer was away. */
  episodeCount: number;
  label: string;
  href: string;
};

export type RecapFollowOption = { id: string; label: string; following: boolean; href: string };

export type ReturnRecapViewModel = {
  worldId: string;
  /** True while any read the recap depends on is still in flight. */
  loading: boolean;
  /** True when a §13.12 row exists for this device. */
  hasProgress: boolean;
  /** The one-line status: a recorded position, a first visit, or an unusable storage. */
  progressNote: string;
  /**
   * The absence, as COUNTS rather than as a list (AC#1). Null when there is no recorded
   * position — a first visit has no gap to describe, and inventing one would be a claim.
   */
  awayNote: string | null;
  missedEpisodeCount: number;
  spoilerMode: SpoilerMode;
  spoilerModeLabel: string;
  /** Present only under `watchedOnly`, where the recap deliberately shows no highlights. */
  spoilerNote: string | null;
  /** Followed content first, then the rest, capped at {@link MAX_RECAP_HIGHLIGHTS} (AC#1/#2). */
  highlights: RecapHighlight[];
  /** How many qualifying events the cap left out. Stated, never silently dropped. */
  omittedHighlightCount: number;
  followedArcProgress: RecapArcProgress[];
  /** The honest vote line. Never presents `uncertain` nodes as effects (FR-J002 AC#2). */
  voteNote: string;
  voteTrigger: RecapHighlight | null;
  /** Where to pick the story back up. */
  continueFrom: {
    episodeNumber: number;
    worldDay: number;
    title: string;
    href: string;
    isRecommendedEntry: boolean;
  } | null;
  /** Follow controls, built from the world's published vocabulary. */
  followableCharacters: RecapFollowOption[];
  followableArcs: RecapFollowOption[];
  /** The episode id the "mark as watched" control would record, or null. */
  markableEpisodeId: string | null;
};

const truncateToChineseCharacters = (text: string, max: number): string => {
  if (countChineseCharacters(text) <= max) return text;
  const characters = [...text];
  let kept = '';
  let counted = 0;
  for (const character of characters) {
    const next = kept + character;
    counted = countChineseCharacters(next);
    if (counted > max) break;
    kept = next;
  }
  return `${kept}…`;
};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/**
 * The honest vote line (FR-J002 AC#2, restated on this surface).
 *
 * `explicitCausalEdgeCount` is 0 on all of today's real data — no provider emits
 * `causedByEventIds` — so the `uncertain` bucket is the only non-empty one, and it is context
 * MEMBERSHIP: the Director was told the vote had happened while it planned some Scene. That is
 * not a causal claim, and rendering it under a heading like「投票效果」would make this recap say
 * what the projection refuses to say. So the recap surfaces the TRIGGER and states what Canon
 * does and does not record. `uncertain` is not read here at all — a field the builder never
 * touches cannot be accidentally promoted by a later edit.
 */
export function composeVoteRecapLine(
  payload: RecapVoteConsequence | null,
  /**
   * True while the consequence read is still in flight.
   *
   * A separate input from `payload` being absent, and the distinction is the whole point — the
   * same one `src/components/vote/voteConsequenceModel.ts` documents at length and tests. This
   * section cannot even name its model until the episode index tells it the latest world day, so
   * on every page load there is a window where the payload is legitimately missing. Collapsing
   * that into `payload === null` made the recap assert 「尚未有這一天的投票後果資料。」— a factual
   * claim about the world — for a moment on every single load. A loading state is not an empty
   * result, and a view whose whole purpose is to avoid overclaiming must not begin by
   * overclaiming an absence.
   */
  loading = false,
): { note: string; trigger: RecapHighlight | null } {
  if (loading) return { note: LOADING_STATUS, trigger: null };
  if (payload === null) return { note: VOTE_UNAVAILABLE_NOTE, trigger: null };
  if (payload.trigger === null) {
    return { note: voteNoTriggerNote(payload.targetWorldDay), trigger: null };
  }
  const node = payload.trigger;
  const summary = node.publicationStatus === 'withheld'
    ? WITHHELD_SUMMARY
    : (node.publicSummary ?? NO_SUMMARY);
  return {
    // Only ever one of two sentences, and neither of them is a causal claim the projection did
    // not make. With at least one real Canon edge the recap defers to the consequence page
    // rather than restating a chain it does not have room for.
    note: payload.explicitCausalEdgeCount === 0
      ? VOTE_NO_CAUSAL_EDGE_NOTE
      : `Canon 記錄了 ${payload.explicitCausalEdgeCount} 條與這次投票有關的因果連結,詳情請見首頁的投票後果區塊。`,
    trigger: {
      eventId: node.eventId,
      summary: truncateToChineseCharacters(summary, RECAP_LINE_MAX_CHARACTERS),
      when: `第 ${node.worldDay} 天 · ${node.timeSlot}`,
      followed: false,
      href: null,
    },
  };
}

/**
 * Compose the whole recap render model.
 *
 * Degrades on every axis: a missing progress row is a first visit, a missing episode index is a
 * world with nothing published, a missing consequence model is「尚未有資料」. No branch throws,
 * because every input is an independently published model and one of them being unavailable must
 * not take the page down (the FR-I002 failure-isolation rule the public pages already follow).
 */
export function composeReturnRecapViewModel(input: {
  worldId: string;
  progress: RecapProgress | null;
  episodes: RecapEpisodeIndex | null;
  timeline: RecapTimeline | null;
  voteConsequence: RecapVoteConsequence | null;
  /** True while any read the recap BODY depends on is in flight (progress, episodes, timeline). */
  loading?: boolean;
  /**
   * True while the consequence read is in flight, tracked separately.
   *
   * It resolves later than the others by construction — the model's key contains a world day
   * that only the episode index can supply — so folding it into `loading` would hold the whole
   * page back on the one section that always arrives last.
   */
  voteLoading?: boolean;
  /** False when the browser refuses `localStorage`, so the page can say why. */
  storageAvailable?: boolean;
}): ReturnRecapViewModel {
  const { worldId } = input;
  const loading = input.loading ?? false;
  const storageAvailable = input.storageAvailable ?? true;
  const progress = input.progress;

  const episodes = [...(input.episodes?.episodes ?? [])].sort((a, b) => a.worldDay - b.worldDay);
  const storedMode: unknown = progress === null ? undefined : progress.spoilerMode;
  const spoilerMode: SpoilerMode = isSpoilerMode(storedMode) ? storedMode : DEFAULT_SPOILER_MODE;

  const followedCharacters = new Set(progress === null ? [] : progress.followedCharacterIds);
  const followedArcs = new Set(progress === null ? [] : progress.followedArcIds);

  const storedEpisodeId = progress === null ? null : progress.lastViewedEpisodeId;
  const lastViewed = storedEpisodeId === null ? null : parseViewerProgressEpisodeId(storedEpisodeId);
  // A position recorded against another world is not this world's position. It is ignored rather
  // than trusted: the row is per (world, viewer), so this can only happen to a hand-built value.
  const lastViewedDay = lastViewed !== null && lastViewed.worldId === worldId ? lastViewed.worldDay : null;
  const lastViewedEpisode = lastViewedDay === null
    ? null
    : episodes.find((episode) => episode.worldDay === lastViewedDay) ?? null;

  // Everything strictly after the recorded position. With no position the whole index counts as
  // "since", which is what a first visit is.
  const missedEpisodes = lastViewedDay === null
    ? episodes
    : episodes.filter((episode) => episode.worldDay > lastViewedDay);

  const progressNote = loading
    ? LOADING_STATUS
    : !storageAvailable
      ? NO_STORAGE_NOTE
      : progress === null
        ? (episodes.length === 0 ? NO_CONTENT_NOTE : NO_PROGRESS_NOTE)
        : lastViewedEpisode !== null
          ? `你上次看到第 ${lastViewedEpisode.episodeNumber} 集(第 ${lastViewedEpisode.worldDay} 天)。`
          : lastViewedDay !== null
            ? `你上次看到第 ${lastViewedDay} 天。`
            : '這個裝置已經記錄了追蹤設定,但還沒有記錄看到哪一集。';

  const awayNote = lastViewedDay === null
    ? null
    // AC#1: the gap is reported as two numbers. It does not grow into a list.
    : missedEpisodes.length === 0
      ? '你已經看到目前最新的一集。'
      : `你離開期間新增了 ${missedEpisodes.length} 集,涵蓋第 ${missedEpisodes[0].worldDay} 到 ${missedEpisodes[missedEpisodes.length - 1].worldDay} 天。`;

  const episodeHref = (worldDay: number) => `#episode/${worldId}/${worldDay}`;
  const publishedDays = new Set(episodes.map((episode) => episode.worldDay));

  // Candidate highlights: published major events after the recorded position.
  const entries = (input.timeline?.entries ?? []).filter((entry) =>
    lastViewedDay === null || entry.worldDay > lastViewedDay);
  const candidates: RecapHighlight[] = entries.map((entry) => {
    const followed = strings(entry.characterIds).some((id) => followedCharacters.has(id))
      || strings(entry.arcIds).some((id) => followedArcs.has(id));
    return {
      eventId: entry.eventId,
      summary: truncateToChineseCharacters(entry.publicSummary ?? NO_SUMMARY, RECAP_LINE_MAX_CHARACTERS),
      when: `第 ${entry.worldDay} 天${entry.timeSlot === undefined ? '' : ` · ${entry.timeSlot}`}`,
      followed,
      href: publishedDays.has(entry.worldDay) ? episodeHref(entry.worldDay) : null,
    };
  });

  // AC#2: followed content fills the budget first. Within each group the world's own chronology
  // is preserved, so a group reads as a sequence rather than as a ranking nobody can check.
  const ordered = [
    ...candidates.filter((candidate) => candidate.followed),
    ...candidates.filter((candidate) => !candidate.followed),
  ];
  // AC#1 + FR-H005: `watchedOnly` scopes content to episodes the viewer has watched, and every
  // candidate here is by construction from an episode they have not.
  const highlights = spoilerMode === 'watchedOnly' ? [] : ordered.slice(0, MAX_RECAP_HIGHLIGHTS);
  const omittedHighlightCount = spoilerMode === 'watchedOnly'
    ? 0
    : Math.max(0, ordered.length - highlights.length);

  const followedArcProgress: RecapArcProgress[] = [...followedArcs]
    .map((arcId) => ({
      arcId,
      episodeCount: missedEpisodes.filter((episode) => strings(episode.arcIds).includes(arcId)).length,
      label: arcId,
      href: `#arc/${worldId}/${encodeURIComponent(arcId)}`,
    }))
    .sort((a, b) => b.episodeCount - a.episodeCount || a.arcId.localeCompare(b.arcId))
    .slice(0, MAX_RECAP_ARC_PROGRESS);

  const vote = composeVoteRecapLine(input.voteConsequence, input.voteLoading ?? loading);

  // The recommended continuation: the first unwatched episode, or the arc-recommended entry when
  // the viewer has no position at all. Never episode 1 by default — FR-H002/H003 exist precisely
  // so a returning or new viewer does not have to start from the beginning.
  const continueEpisode = lastViewedDay === null
    // FR-H003: a viewer with no recorded position is sent to an arc's recommended entry point,
    // and only falls back to the earliest episode when the world publishes no recommendation.
    // Defaulting to episode 1 is exactly the「必須從第一集開始」cost FR-H002/H003 exist to remove.
    ? (episodes.find((episode) => episode.isRecommendedEntry === true) ?? episodes[0] ?? null)
    : (missedEpisodes.length > 0 ? missedEpisodes[0] : null);

  return {
    worldId,
    loading,
    hasProgress: progress !== null,
    progressNote,
    awayNote,
    missedEpisodeCount: missedEpisodes.length,
    spoilerMode,
    spoilerModeLabel: spoilerModeLabel(spoilerMode),
    spoilerNote: spoilerMode === 'watchedOnly' ? WATCHED_ONLY_NOTE : null,
    highlights,
    omittedHighlightCount,
    followedArcProgress,
    voteNote: vote.note,
    voteTrigger: vote.trigger,
    continueFrom: continueEpisode === null
      ? null
      : {
          episodeNumber: continueEpisode.episodeNumber,
          worldDay: continueEpisode.worldDay,
          title: continueEpisode.title,
          href: episodeHref(continueEpisode.worldDay),
          isRecommendedEntry: continueEpisode.isRecommendedEntry === true,
        },
    followableCharacters: strings(input.episodes?.characterIds).map((id) => ({
      id,
      label: id,
      following: followedCharacters.has(id),
      href: `#character/${worldId}/${encodeURIComponent(id)}`,
    })),
    followableArcs: strings(input.episodes?.arcIds).map((id) => ({
      id,
      label: id,
      following: followedArcs.has(id),
      href: `#arc/${worldId}/${encodeURIComponent(id)}`,
    })),
    markableEpisodeId: continueEpisode === null
      ? null
      : viewerProgressEpisodeId(worldId, continueEpisode.worldDay),
  };
}
