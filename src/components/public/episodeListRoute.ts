/**
 * Pure, testable logic for the public Episode list page (FR-I004, ART-86).
 *
 * Mirrors {@link ./homeRoute} / {@link ./liveRoute}: the React component is a
 * thin render layer and the correctness boundaries — route resolution, date
 * ordering, arc/character filtering, and the recommended-entry / turning-point
 * markers — live here as pure functions, unit-tested without a DOM.
 *
 * Pure module — no React, no Convex, no DOM, no clock, no randomness. Input
 * shapes mirror the published `episodes:<worldId>` index projection payload.
 */

/** Published episode index (FR-I004) — fields the page reads. */
export type EpisodeListIndex = {
  episodes: Array<{
    worldDay: number;
    episodeNumber: number;
    title: string;
    headline: string;
    arcIds: string[];
    characterIds: string[];
    isRecommendedEntry: boolean;
    isTurningPoint: boolean;
  }>;
  arcIds: string[];
  characterIds: string[];
};

export type EpisodeFilter = { arc: string | null; character: string | null };

export type EpisodeListItem = {
  worldDay: number;
  episodeNumber: number;
  title: string;
  headline: string;
  isRecommendedEntry: boolean;
  isTurningPoint: boolean;
  href: string;
};

export type EpisodeListViewModel = {
  /** True when the published index contains any episode at all. */
  hasContent: boolean;
  /** Episodes after applying the active arc + character filters, ordered by day. */
  episodes: EpisodeListItem[];
  /** Available arc filters (from the published index). */
  arcOptions: string[];
  /** Available character filters (from the published index). */
  characterOptions: string[];
};

/**
 * Resolve the public world from the `#episodes/<worldId>` hash route. Returns
 * null for a bare/unknown route so the component can surface a format hint.
 */
export function parseEpisodeListRoute(hash: string): { worldId: string } | null {
  const stripped = hash.replace(/^#/, '');
  const match = stripped.match(/^episodes\/([^/]+)$/);
  if (!match) return null;
  const worldId = decodeURIComponent(match[1]);
  return worldId.length > 0 ? { worldId } : null;
}

/**
 * Apply the arc + character filters to an episode (AC#2). A null filter matches
 * everything; both filters combine with AND.
 */
export function episodeMatchesFilters(
  episode: { arcIds: string[]; characterIds: string[] },
  filter: EpisodeFilter,
): boolean {
  if (filter.arc !== null && !episode.arcIds.includes(filter.arc)) return false;
  if (filter.character !== null && !episode.characterIds.includes(filter.character)) return false;
  return true;
}

/**
 * Compose the episode-list render model from the published index and the active
 * filters (AC#1/#2). Episodes are filtered, ordered by world day ascending, and
 * each carries its deep-link plus the recommended-entry / turning-point markers
 * (AC#3). Degrades to an empty model when the index is null.
 */
export function composeEpisodeListViewModel(input: {
  worldId: string;
  index: EpisodeListIndex | null;
  filter: EpisodeFilter;
}): EpisodeListViewModel {
  const episodes = input.index?.episodes ?? [];
  const filtered = episodes
    .filter((episode) => episodeMatchesFilters(episode, input.filter))
    .map((episode) => ({
      worldDay: episode.worldDay,
      episodeNumber: episode.episodeNumber,
      title: episode.title,
      headline: episode.headline,
      isRecommendedEntry: episode.isRecommendedEntry,
      isTurningPoint: episode.isTurningPoint,
      href: `#episode/${input.worldId}/${episode.worldDay}`,
    }));

  return {
    hasContent: episodes.length > 0,
    episodes: filtered,
    arcOptions: input.index?.arcIds ?? [],
    characterOptions: input.index?.characterIds ?? [],
  };
}
