/**
 * Recommended active-arc entry points (FR-H003).
 *
 * Maintains an explainable recommended entry EPISODE for a major active arc and
 * reassesses it after major changes. Pure module — no Convex imports, no clock,
 * no randomness, no Canon mutation. The recommendation is a deterministic
 * derived artifact persisted idempotently by the wiring layer.
 *
 * Selection priority (most explainable first):
 *   1. the episode covering the arc's inciting event,
 *   2. the episode covering the latest turning point,
 *   3. the earliest episode that references the arc,
 *   4. the world's earliest published episode (fallback so every major active
 *      arc has an entry point — AC#1).
 */

import type { StoryArcProjectionData } from './model';

export const RECOMMENDED_ENTRY_SCHEMA_VERSION = 1;

export type EntryBasis = 'inciting' | 'turning_point' | 'earliest' | 'first_episode';

export type ArcEpisodeRef = {
  episodeNumber: number;
  worldDay: number;
  sourceEventIds: readonly string[];
};

export type RecommendedArcEntry = {
  schemaVersion: typeof RECOMMENDED_ENTRY_SCHEMA_VERSION;
  worldId: string;
  arcId: string;
  episodeNumber: number;
  worldDay: number;
  /** The accepted event this recommendation is anchored on. */
  sourceEventId: string;
  /** Human-readable, queryable recommendation reason (AC#2). */
  reason: string;
  signals: { basis: EntryBasis; heatScore: number };
  /** Monotonic marker of when this recommendation was last reassessed (AC#3). */
  reassessedAtSequenceNumber: number;
};

export class EntryRecommendationError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'EntryRecommendationError';
  }
}

function episodeCovering(episodes: readonly ArcEpisodeRef[], eventId: string | null): ArcEpisodeRef | null {
  if (eventId === null) return null;
  return episodes.find((episode) => episode.sourceEventIds.includes(eventId)) ?? null;
}

function reasonFor(basis: EntryBasis, episodeNumber: number): string {
  switch (basis) {
    case 'inciting':
      return `從故事〈第 ${episodeNumber} 集〉入坑:涵蓋本 Arc 的觸發事件,是理解後續發展的起點。`;
    case 'turning_point':
      return `從故事〈第 ${episodeNumber} 集〉入坑:涵蓋本 Arc 最近的轉折點,緊湊且容易跟上。`;
    case 'earliest':
      return `從故事〈第 ${episodeNumber} 集〉入坑:本 Arc 最早出現的故事,從頭跟隨最完整。`;
    case 'first_episode':
      return `從故事〈第 ${episodeNumber} 集〉入坑:本 Arc 尚未有專屬故事,建議從世界最早的發布故事認識背景。`;
    default:
      return `從故事〈第 ${episodeNumber} 集〉入坑。`;
  }
}

/**
 * Recommend an entry episode for an arc (AC#1). The arc's projection, the
 * episodes that reference it, and the world's full episode set drive a
 * deterministic, explainable choice. Every major active arc with at least one
 * published episode receives a recommendation; a world with no episodes at all
 * throws (the recommendation is genuinely unavailable until content exists).
 */
export function recommendArcEntry(input: {
  worldId: string;
  arcId: string;
  projection: StoryArcProjectionData;
  arcEpisodes: readonly ArcEpisodeRef[];
  worldEpisodes: readonly ArcEpisodeRef[];
  latestSequenceNumber: number;
}): RecommendedArcEntry {
  if (input.worldId.trim().length === 0 || input.arcId.trim().length === 0) {
    throw new EntryRecommendationError('ENTRY_INVALID', 'worldId and arcId must be non-empty');
  }
  if (!Number.isSafeInteger(input.latestSequenceNumber) || input.latestSequenceNumber < 0) {
    throw new EntryRecommendationError('ENTRY_INVALID', 'latestSequenceNumber must be a non-negative integer');
  }
  if (input.projection.incitingEventId.trim().length === 0) {
    throw new EntryRecommendationError('ENTRY_INVALID', 'projection.incitingEventId must be non-empty');
  }
  const arcEpisodes = [...input.arcEpisodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
  const worldEpisodes = [...input.worldEpisodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
  if (worldEpisodes.length === 0) {
    throw new EntryRecommendationError('ENTRY_NO_EPISODE_AVAILABLE', 'cannot recommend an entry before any episode is published');
  }

  const projection = input.projection;
  const incitingEpisode = episodeCovering(arcEpisodes, projection.incitingEventId);
  const turningEpisode = episodeCovering(arcEpisodes, projection.latestTurningPointEventId);

  let chosen: ArcEpisodeRef;
  let basis: EntryBasis;
  let sourceEventId: string;

  if (incitingEpisode) {
    chosen = incitingEpisode;
    basis = 'inciting';
    sourceEventId = projection.incitingEventId;
  } else if (turningEpisode) {
    chosen = turningEpisode;
    basis = 'turning_point';
    sourceEventId = projection.latestTurningPointEventId as string;
  } else if (arcEpisodes.length > 0) {
    chosen = arcEpisodes[0];
    basis = 'earliest';
    sourceEventId = projection.incitingEventId;
  } else {
    chosen = worldEpisodes[0];
    basis = 'first_episode';
    sourceEventId = projection.incitingEventId;
  }

  return {
    schemaVersion: RECOMMENDED_ENTRY_SCHEMA_VERSION,
    worldId: input.worldId,
    arcId: input.arcId,
    episodeNumber: chosen.episodeNumber,
    worldDay: chosen.worldDay,
    sourceEventId,
    reason: reasonFor(basis, chosen.episodeNumber),
    signals: { basis, heatScore: projection.heatScore },
    reassessedAtSequenceNumber: input.latestSequenceNumber,
  };
}

/** Validate a persisted recommendation envelope. */
export function validateRecommendedArcEntry(value: unknown): RecommendedArcEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EntryRecommendationError('ENTRY_INVALID', 'recommendation must be an object');
  }
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== RECOMMENDED_ENTRY_SCHEMA_VERSION) {
    throw new EntryRecommendationError('ENTRY_INVALID', 'unsupported schema version');
  }
  const signals = row.signals as Record<string, unknown> | undefined;
  const allowedBases: EntryBasis[] = ['inciting', 'turning_point', 'earliest', 'first_episode'];
  if (!signals || typeof signals.basis !== 'string' || !allowedBases.includes(signals.basis as EntryBasis)) {
    throw new EntryRecommendationError('ENTRY_INVALID', 'unsupported basis');
  }
  const textFields: Record<string, unknown> = {
    worldId: row.worldId, arcId: row.arcId, sourceEventId: row.sourceEventId, reason: row.reason,
  };
  for (const [field, fieldValue] of Object.entries(textFields)) {
    if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) {
      throw new EntryRecommendationError('ENTRY_INVALID', `${field} must be a non-empty string`);
    }
  }
  if (!Number.isSafeInteger(row.episodeNumber) || (row.episodeNumber as number) < 1
      || !Number.isSafeInteger(row.reassessedAtSequenceNumber) || (row.reassessedAtSequenceNumber as number) < 0) {
    throw new EntryRecommendationError('ENTRY_INVALID', 'episodeNumber and reassessedAtSequenceNumber must be valid integers');
  }
  return structuredClone(row) as RecommendedArcEntry;
}
