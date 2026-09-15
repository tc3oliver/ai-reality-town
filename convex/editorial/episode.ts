export const HIGH_IMPORTANCE_THRESHOLD = 0.7;
export const MIN_EPISODE_SCENES = 3;
export const MAX_EPISODE_SCENES = 5;

export type EpisodeSourceEvent = {
  eventId: string;
  publicSummary: string | null;
  participantIds: string[];
  arcIds: string[];
  importance: number;
  publicFactIds: string[];
  publicRelationshipChanges: string[];
  newQuestions: string[];
  resolvedQuestions: string[];
};

export type EpisodeScene = { title: string; summary: string; sourceEventIds: string[]; publicFactIds: string[] };
export type DailyEpisode = {
  schemaVersion: 1;
  worldId: string;
  worldDay: number;
  episodeNumber: number;
  title: string;
  headline: string;
  oneLineSummary: string;
  keyScenes: EpisodeScene[];
  relationshipChanges: Array<{ summary: string; sourceEventId: string }>;
  newQuestions: string[];
  resolvedQuestions: string[];
  arcIds: string[];
  characterIds: string[];
  nextEpisodeTease: string;
  sourceEventIds: string[];
};

/**
 * The `sourceId` an Episode's post-generation classification is recorded against (ART-177).
 *
 * One definition, because three places have to agree on it and they are in different modules: the
 * generator that mints it, and the two read-model rebuilds that ask whether this Episode is
 * currently refused. It is keyed on the EPISODE NUMBER rather than the world day because that is
 * what `classifyPostGeneration` was already given, and changing it would orphan every
 * classification already in the ledger.
 *
 * Deliberately distinct from a Scene id, which is what every other entry in that ledger is. The
 * two never collide: a Scene id carries the world day and time slot, and nothing matches an
 * accepted event's `metadata.sceneId` against this.
 */
export function episodeSafetySourceId(episodeNumber: number): string {
  return `episode:${episodeNumber}`;
}

export class EpisodeError extends Error {
  constructor(readonly code: string, message: string, readonly path?: string) {
    super(`[${code}] ${message}`);
    this.name = 'EpisodeError';
  }
}

const unique = (values: readonly string[]): string[] => [...new Set(values)];
export const dailyEpisodePublicText = (episode: DailyEpisode): string => [episode.title, episode.headline, episode.oneLineSummary,
  ...episode.keyScenes.flatMap(({ title, summary }) => [title, summary]),
  ...episode.relationshipChanges.map(({ summary }) => summary), ...episode.newQuestions,
  ...episode.resolvedQuestions, episode.nextEpisodeTease].join(' ');

export function validateDailyEpisode(
  episode: DailyEpisode,
  acceptedSources: readonly EpisodeSourceEvent[],
  unpublishedSecretValues: readonly string[],
): DailyEpisode {
  if (episode.schemaVersion !== 1 || episode.worldId.trim().length === 0 || !Number.isSafeInteger(episode.worldDay)
      || episode.worldDay < 0 || !Number.isSafeInteger(episode.episodeNumber) || episode.episodeNumber < 1) {
    throw new EpisodeError('EPISODE_INVALID_SHAPE', 'invalid Episode envelope');
  }
  if (episode.keyScenes.length < MIN_EPISODE_SCENES || episode.keyScenes.length > MAX_EPISODE_SCENES) {
    throw new EpisodeError('EPISODE_SCENE_LIMIT', `Episode must contain ${MIN_EPISODE_SCENES}-${MAX_EPISODE_SCENES} key scenes`, 'keyScenes');
  }
  const accepted = new Map(acceptedSources.map((source) => [source.eventId, source]));
  const referenced = unique([...episode.keyScenes.flatMap(({ sourceEventIds }) => sourceEventIds),
    ...episode.relationshipChanges.map(({ sourceEventId }) => sourceEventId)]);
  const cited = unique([...episode.sourceEventIds, ...referenced]);
  if (cited.some((eventId) => !accepted.has(eventId))) throw new EpisodeError('EPISODE_SOURCE_NOT_ACCEPTED', 'Episode cites an event outside the accepted world-day set');
  const publicFacts = new Set(acceptedSources.flatMap(({ publicFactIds }) => publicFactIds));
  if (episode.keyScenes.flatMap(({ publicFactIds }) => publicFactIds).some((factId) => !publicFacts.has(factId))) {
    throw new EpisodeError('EPISODE_PRIVATE_FACT', 'Episode cites a fact that is not public', 'keyScenes.publicFactIds');
  }
  const highImportance = acceptedSources.filter(({ importance }) => importance >= HIGH_IMPORTANCE_THRESHOLD).map(({ eventId }) => eventId);
  if (highImportance.some((eventId) => !cited.includes(eventId))) throw new EpisodeError('EPISODE_IMPORTANT_EVENT_MISSING', 'every high-importance event must be covered');
  const sourceIds = unique(episode.sourceEventIds);
  if (sourceIds.length !== episode.sourceEventIds.length
      || sourceIds.some((id) => !referenced.includes(id)) || referenced.some((id) => !sourceIds.includes(id))) {
    throw new EpisodeError('EPISODE_INVALID_SHAPE', 'source Event IDs must uniquely and exactly match referenced events');
  }
  const text = dailyEpisodePublicText(episode).toLocaleLowerCase();
  const leaked = unpublishedSecretValues.find((secret) => secret.trim().length >= 4 && text.includes(secret.trim().toLocaleLowerCase()));
  if (leaked) throw new EpisodeError('EPISODE_SECRET_LEAK', 'Episode contains unpublished Canon secret text');
  return structuredClone(episode);
}

/** A public summary, with every event that produced that exact text. */
type CollapsedSource = {
  readonly source: EpisodeSourceEvent;
  readonly eventIds: string[];
  /** Merged across every event collapsed here, so a fact a duplicate named is not lost. */
  readonly publicFactIds: string[];
};

/**
 * Events that are distinct in Canon but indistinguishable to a reader, merged into one (ART-184).
 *
 * A public summary is derived from a scene's place, cast and goals, none of which change between
 * ticks, so the same scene at a later time produces a BYTE-IDENTICAL string. Measured on the live
 * world: twenty recent events carried three distinct summaries, one of them seven times. The
 * round-robin in `buildDailyEpisode` then dealt those repeats across buckets, so every key scene
 * came out a permutation of the same three sentences and one contained the same sentence twice.
 *
 * Merging rather than dropping is the point. The duplicate events are real and their ids are
 * provenance a reader can follow, so each entry KEEPS THEM ALL. The episode's own
 * `sourceEventIds`, relationship changes and questions are still derived from the full `ordered`
 * list, so nothing about what the episode COVERS changes — only how many times it says one thing.
 *
 * The highest-importance event wins the representative slot, because `ordered` is already sorted.
 * A summary of `null` or blank is never merged: two events that both said nothing publicly are
 * not thereby the same event, and collapsing them would silently shrink a quiet day's scene count.
 */
function collapseByPublicSummary(ordered: readonly EpisodeSourceEvent[]): CollapsedSource[] {
  const byText = new Map<string, CollapsedSource>();
  const collapsed: CollapsedSource[] = [];
  for (const source of ordered) {
    const text = source.publicSummary;
    if (text === null || text.trim().length === 0) {
      collapsed.push({ source, eventIds: [source.eventId], publicFactIds: [...source.publicFactIds] });
      continue;
    }
    const seen = byText.get(text);
    if (seen === undefined) {
      const entry: CollapsedSource = {
        source, eventIds: [source.eventId], publicFactIds: [...source.publicFactIds],
      };
      byText.set(text, entry);
      collapsed.push(entry);
      continue;
    }
    seen.eventIds.push(source.eventId);
    for (const factId of source.publicFactIds) {
      if (!seen.publicFactIds.includes(factId)) seen.publicFactIds.push(factId);
    }
  }
  return collapsed;
}

export function buildDailyEpisode(
  worldId: string,
  worldDay: number,
  episodeNumber: number,
  sources: readonly EpisodeSourceEvent[],
): DailyEpisode {
  const ordered = [...sources].sort((a, b) => b.importance - a.importance || a.eventId.localeCompare(b.eventId));
  const distinct = collapseByPublicSummary(ordered);
  const sceneCount = Math.min(MAX_EPISODE_SCENES, Math.max(MIN_EPISODE_SCENES, distinct.length));
  const buckets = Array.from({ length: sceneCount }, (): CollapsedSource[] => []);
  distinct.forEach((entry, index) => buckets[index % sceneCount].push(entry));
  const scenes = buckets.map((bucket, index): EpisodeScene => ({
    title: bucket.length > 0 ? `關鍵場景 ${index + 1}` : `平靜片段 ${index + 1}`,
    summary: bucket.map(({ source }) => source.publicSummary).filter((value): value is string => value !== null).join(' ') || '這一段沒有已接受的公開進展。',
    sourceEventIds: bucket.flatMap(({ eventIds }) => eventIds), publicFactIds: unique(bucket.flatMap((entry) => entry.publicFactIds)),
  }));
  const sourceEventIds = ordered.map(({ eventId }) => eventId);
  const publicSummaries = distinct.map(({ source }) => source.publicSummary).filter((value): value is string => value !== null);
  return {
    schemaVersion: 1, worldId, worldDay, episodeNumber, title: `世界第 ${worldDay} 天`,
    headline: publicSummaries[0] ?? '平靜的一天',
    oneLineSummary: publicSummaries.slice(0, 2).join(' ') || '這一天平靜度過,沒有任何公開進展。',
    keyScenes: scenes,
    relationshipChanges: ordered.flatMap((source) => source.publicRelationshipChanges.map((summary) => ({ summary, sourceEventId: source.eventId }))),
    newQuestions: unique(ordered.flatMap(({ newQuestions }) => newQuestions)),
    resolvedQuestions: unique(ordered.flatMap(({ resolvedQuestions }) => resolvedQuestions)),
    arcIds: unique(ordered.flatMap(({ arcIds }) => arcIds)), characterIds: unique(ordered.flatMap(({ participantIds }) => participantIds)),
    nextEpisodeTease: 'What consequences will tomorrow bring?', sourceEventIds,
  };
}
