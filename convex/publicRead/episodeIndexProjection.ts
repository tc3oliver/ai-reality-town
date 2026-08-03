/**
 * Publication-safe Episode Index projection (PRD §13.10, FR-I004).
 *
 * A list-shaped projection that lets the public Episode list page browse
 * episodes by day and filter by Story Arc / character without fetching every
 * full episode. Each entry carries only list-relevant, allowlisted fields plus
 * two derived markers: `isRecommendedEntry` (the episode is an arc's recommended
 * entry point, ART-67) and `isTurningPoint` (the episode contains an arc's
 * latest turning-point event). Only eligible (ready/published) editorial
 * episodes are indexed (AC#1). Pure module — no Convex imports, no clock, no
 * randomness, no Canon mutation.
 *
 * Published via the public read-model infrastructure (modelKind `episode`,
 * modelRef `episodes:<worldId>`); public reads reuse the generic
 * failure-isolated getPublishedReadModel.
 */

export const EPISODE_INDEX_SCHEMA_VERSION = 1;
export const EPISODE_INDEX_MODEL_KIND = 'episode' as const;
export const EPISODE_INDEX_MODEL_REF_PREFIX = 'episodes:' as const;

/** Only eligible published editorial content is indexed (mirrors FR-I003). */
export const ELIGIBLE_EPISODE_STATUSES = ['ready', 'published'] as const;

export type EpisodeIndexEntryInput = {
  worldDay: number;
  episodeNumber: number;
  title: string;
  headline: string;
  status: string;
  arcIds: readonly string[];
  characterIds: readonly string[];
  sourceEventIds: readonly string[];
};

export type EpisodeIndexEntry = {
  worldDay: number;
  episodeNumber: number;
  title: string;
  headline: string;
  arcIds: string[];
  characterIds: string[];
  isRecommendedEntry: boolean;
  isTurningPoint: boolean;
};

export type EpisodeIndexProjection = {
  schemaVersion: typeof EPISODE_INDEX_SCHEMA_VERSION;
  worldId: string;
  /** Eligible episodes, ordered by world day ascending (AC#1 date browse). */
  episodes: EpisodeIndexEntry[];
  /** Union of every indexed episode's arcs — the available arc filters. */
  arcIds: string[];
  /** Union of every indexed episode's characters — the available character filters. */
  characterIds: string[];
};

export class EpisodeIndexError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'EpisodeIndexError';
  }
}

const unique = (values: readonly string[]): string[] => [...new Set(values)];

function isEligible(status: string): boolean {
  return (ELIGIBLE_EPISODE_STATUSES as readonly string[]).includes(status);
}

/**
 * Build the Episode Index projection (AC#1). Only eligible episodes are
 * indexed; each is annotated with the recommended-entry and turning-point
 * markers derived from the supplied marker sets. Entries are ordered by world
 * day ascending so the page can browse by date; the union arc/character id sets
 * drive the filter UI.
 */
export function buildEpisodeIndex(input: {
  worldId: string;
  episodes: readonly EpisodeIndexEntryInput[];
  /** World days that are an arc's recommended entry point (ART-67). */
  recommendedEntryWorldDays: ReadonlySet<number>;
  /** Event ids that are some arc's latest turning point. */
  turningPointEventIds: ReadonlySet<string>;
}): EpisodeIndexProjection {
  if (input.worldId.trim().length === 0) {
    throw new EpisodeIndexError('EPISODE_INDEX_INVALID', 'worldId must be non-empty');
  }

  const entries: EpisodeIndexEntry[] = [];
  for (const episode of input.episodes) {
    if (!isEligible(episode.status)) continue;
    const isTurningPoint = episode.sourceEventIds.some((eventId) => input.turningPointEventIds.has(eventId));
    entries.push({
      worldDay: episode.worldDay,
      episodeNumber: episode.episodeNumber,
      title: episode.title,
      headline: episode.headline,
      arcIds: unique(episode.arcIds),
      characterIds: unique(episode.characterIds),
      isRecommendedEntry: input.recommendedEntryWorldDays.has(episode.worldDay),
      isTurningPoint,
    });
  }

  entries.sort((a, b) => a.worldDay - b.worldDay);

  return {
    schemaVersion: EPISODE_INDEX_SCHEMA_VERSION,
    worldId: input.worldId,
    episodes: entries,
    arcIds: unique(entries.flatMap((entry) => entry.arcIds)).sort(),
    characterIds: unique(entries.flatMap((entry) => entry.characterIds)).sort(),
  };
}
