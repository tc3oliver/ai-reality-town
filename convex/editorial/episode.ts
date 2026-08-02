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

export function buildDailyEpisode(
  worldId: string,
  worldDay: number,
  episodeNumber: number,
  sources: readonly EpisodeSourceEvent[],
): DailyEpisode {
  const ordered = [...sources].sort((a, b) => b.importance - a.importance || a.eventId.localeCompare(b.eventId));
  const sceneCount = Math.min(MAX_EPISODE_SCENES, Math.max(MIN_EPISODE_SCENES, ordered.length));
  const buckets = Array.from({ length: sceneCount }, (): EpisodeSourceEvent[] => []);
  ordered.forEach((source, index) => buckets[index % sceneCount].push(source));
  const scenes = buckets.map((bucket, index): EpisodeScene => ({
    title: bucket.length > 0 ? `Key scene ${index + 1}` : `Quiet beat ${index + 1}`,
    summary: bucket.map(({ publicSummary }) => publicSummary).filter((value): value is string => value !== null).join(' ') || 'No accepted public development was recorded.',
    sourceEventIds: bucket.map(({ eventId }) => eventId), publicFactIds: unique(bucket.flatMap(({ publicFactIds }) => publicFactIds)),
  }));
  const sourceEventIds = ordered.map(({ eventId }) => eventId);
  const publicSummaries = ordered.map(({ publicSummary }) => publicSummary).filter((value): value is string => value !== null);
  return {
    schemaVersion: 1, worldId, worldDay, episodeNumber, title: `World Day ${worldDay}`,
    headline: publicSummaries[0] ?? 'A quiet day in Mistwood',
    oneLineSummary: publicSummaries.slice(0, 2).join(' ') || 'The town passed a quiet day without a public Canon development.',
    keyScenes: scenes,
    relationshipChanges: ordered.flatMap((source) => source.publicRelationshipChanges.map((summary) => ({ summary, sourceEventId: source.eventId }))),
    newQuestions: unique(ordered.flatMap(({ newQuestions }) => newQuestions)),
    resolvedQuestions: unique(ordered.flatMap(({ resolvedQuestions }) => resolvedQuestions)),
    arcIds: unique(ordered.flatMap(({ arcIds }) => arcIds)), characterIds: unique(ordered.flatMap(({ participantIds }) => participantIds)),
    nextEpisodeTease: 'What consequences will tomorrow bring?', sourceEventIds,
  };
}
