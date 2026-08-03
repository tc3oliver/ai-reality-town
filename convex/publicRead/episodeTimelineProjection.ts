/**
 * Publication-safe Episode and Timeline projections (PRD §13.10/§13.8, FR-I003).
 *
 * Pure builders with explicit field projection. Episode projection includes ONLY
 * eligible published editorial content (AC#1); the Timeline defaults to major
 * events and retains Arc / Character / EventType / Episode-link keys (AC#2).
 * Both are published via the public read-model store (modelKind `episode` /
 * `timeline`) so they remain last-known-good during simulation failure (AC#3).
 *
 * Pure module — no Convex imports, no clock, no randomness, no Canon mutation.
 */

import type { DailyEpisode } from '../editorial/episode';

export const EPISODE_TIMELINE_SCHEMA_VERSION = 1;
export const EPISODE_MODEL_KIND = 'episode' as const;
export const TIMELINE_MODEL_KIND = 'timeline' as const;

/** Only eligible published editorial content is projected (AC#1). */
export const ELIGIBLE_EPISODE_STATUSES = ['ready', 'published'] as const;
/** Major-event threshold for the default Timeline (AC#2). */
export const TIMELINE_MAJOR_IMPORTANCE = 0.7;

export type EpisodeKeyScene = { title: string; summary: string; sourceEventIds: string[] };
export type EpisodeRelationshipChange = { summary: string; sourceEventId: string };

export type EpisodeProjection = {
  schemaVersion: typeof EPISODE_TIMELINE_SCHEMA_VERSION;
  worldId: string;
  worldDay: number;
  episodeNumber: number;
  status: string;
  title: string;
  headline: string;
  oneLineSummary: string;
  keyScenes: EpisodeKeyScene[];
  relationshipChanges: EpisodeRelationshipChange[];
  newQuestions: string[];
  resolvedQuestions: string[];
  arcIds: string[];
  characterIds: string[];
  nextEpisodeTease: string;
  sourceEventIds: string[];
};

export type TimelineEntryInput = {
  eventId: string;
  worldDay: number;
  timeSlot: string;
  eventType: string;
  publicSummary: string | null;
  importance: number;
  arcIds: readonly string[];
  characterIds: readonly string[];
  episodeNumber: number | null;
};

export type TimelineEntry = {
  eventId: string;
  worldDay: number;
  timeSlot: string;
  eventType: string;
  publicSummary: string | null;
  arcIds: string[];
  characterIds: string[];
  episodeNumber: number | null;
};

export type TimelineProjection = {
  schemaVersion: typeof EPISODE_TIMELINE_SCHEMA_VERSION;
  worldId: string;
  entries: TimelineEntry[];
};

export class EpisodeTimelineError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'EpisodeTimelineError';
  }
}

function isEligible(status: string): boolean {
  return (ELIGIBLE_EPISODE_STATUSES as readonly string[]).includes(status);
}

const unique = (values: readonly string[]): string[] => [...new Set(values)];
const TIME_SLOT_ORDER = ['morning', 'noon', 'afternoon', 'evening', 'night'];

/**
 * Build the publication-safe Episode projection (AC#1). Throws unless the
 * editorial status is eligible (ready/published); withheld or failed content is
 * never projected. Only allowlisted public fields are emitted.
 */
export function buildEpisodeProjection(input: {
  worldId: string;
  episode: DailyEpisode;
  status: string;
}): EpisodeProjection {
  if (input.worldId.trim().length === 0) throw new EpisodeTimelineError('EPISODE_INVALID', 'worldId must be non-empty');
  if (!isEligible(input.status)) {
    throw new EpisodeTimelineError('EPISODE_NOT_ELIGIBLE', `episode status '${input.status}' is not eligible for publication`);
  }
  const episode = input.episode;
  return {
    schemaVersion: EPISODE_TIMELINE_SCHEMA_VERSION,
    worldId: input.worldId,
    worldDay: episode.worldDay,
    episodeNumber: episode.episodeNumber,
    status: input.status,
    title: episode.title,
    headline: episode.headline,
    oneLineSummary: episode.oneLineSummary,
    keyScenes: episode.keyScenes.map((scene) => ({
      title: scene.title, summary: scene.summary, sourceEventIds: [...scene.sourceEventIds],
    })),
    relationshipChanges: episode.relationshipChanges.map((change) => ({ summary: change.summary, sourceEventId: change.sourceEventId })),
    newQuestions: [...episode.newQuestions],
    resolvedQuestions: [...episode.resolvedQuestions],
    arcIds: unique(episode.arcIds),
    characterIds: unique(episode.characterIds),
    nextEpisodeTease: episode.nextEpisodeTease,
    sourceEventIds: unique(episode.sourceEventIds),
  };
}

/**
 * Build the major-event Timeline projection (AC#2). Defaults to events whose
 * importance ≥ {@link TIMELINE_MAJOR_IMPORTANCE}; each entry retains the Arc,
 * Character, EventType, and Episode-link keys. Entries are ordered by
 * world day, time slot, then event id.
 */
export function buildTimelineProjection(input: {
  worldId: string;
  entries: readonly TimelineEntryInput[];
  minImportance?: number;
}): TimelineProjection {
  if (input.worldId.trim().length === 0) throw new EpisodeTimelineError('TIMELINE_INVALID', 'worldId must be non-empty');
  const threshold = input.minImportance ?? TIMELINE_MAJOR_IMPORTANCE;
  const entries = input.entries
    .filter((entry) => entry.importance >= threshold)
    .map((entry): TimelineEntry => ({
      eventId: entry.eventId,
      worldDay: entry.worldDay,
      timeSlot: entry.timeSlot,
      eventType: entry.eventType,
      publicSummary: entry.publicSummary,
      arcIds: unique(entry.arcIds),
      characterIds: unique(entry.characterIds),
      episodeNumber: entry.episodeNumber,
    }))
    .sort((a, b) => a.worldDay - b.worldDay
      || (TIME_SLOT_ORDER.indexOf(a.timeSlot) - TIME_SLOT_ORDER.indexOf(b.timeSlot))
      || a.eventId.localeCompare(b.eventId));
  return {
    schemaVersion: EPISODE_TIMELINE_SCHEMA_VERSION,
    worldId: input.worldId,
    entries,
  };
}
