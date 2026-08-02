import { readFileSync } from 'node:fs';
import { buildDailyEpisode, validateDailyEpisode, type DailyEpisode, type EpisodeSourceEvent } from './episode';

const source = (eventId: string, importance = 0.5): EpisodeSourceEvent => ({ eventId, publicSummary: `Public ${eventId}`,
  participantIds: [`character-${eventId}`], arcIds: ['arc-1'], importance, publicFactIds: [`${eventId}:fact:0`],
  publicRelationshipChanges: [`Relationship ${eventId}`], newQuestions: [`Question ${eventId}?`], resolvedQuestions: [] });

describe('FR-G001 Accepted-event daily Episodes', () => {
  it('builds exactly one complete 3-5-scene Episode solely from accepted sources', () => {
    const sources = [source('e1', 0.9), source('e2', 0.8), source('e3')];
    const episode = validateDailyEpisode(buildDailyEpisode('w', 4, 4, sources), sources, []);
    expect(episode).toMatchObject({ schemaVersion: 1, worldId: 'w', worldDay: 4, episodeNumber: 4,
      title: 'World Day 4', headline: 'Public e1', sourceEventIds: ['e1', 'e2', 'e3'], arcIds: ['arc-1'] });
    expect(episode.keyScenes).toHaveLength(3);
    expect(episode.relationshipChanges).toEqual(sources.map(({ eventId }) => ({ summary: `Relationship ${eventId}`, sourceEventId: eventId })));
    expect(episode.newQuestions).toEqual(['Question e1?', 'Question e2?', 'Question e3?']);
  });
  it('rejects any non-Accepted Event or private Fact reference', () => {
    const sources = [source('e1')];
    const episode = buildDailyEpisode('w', 1, 1, sources);
    expect(() => validateDailyEpisode({ ...episode, sourceEventIds: ['e1', 'proposed-only'],
      keyScenes: [{ ...episode.keyScenes[0], sourceEventIds: ['proposed-only'] }, ...episode.keyScenes.slice(1)] }, sources, [])).toThrow(/outside the accepted world-day set/);
    const privateFact: DailyEpisode = { ...episode, keyScenes: [{ ...episode.keyScenes[0], publicFactIds: ['private-fact'] }, ...episode.keyScenes.slice(1)] };
    expect(() => validateDailyEpisode(privateFact, sources, [])).toThrow(/not public/);
    expect(() => validateDailyEpisode({ ...episode, sourceEventIds: [] }, sources, []))
      .toThrow(/exactly match referenced events/);
  });
  it('requires coverage of every high-importance event, including more than five events', () => {
    const sources = Array.from({ length: 7 }, (_, index) => source(`e${index}`, 0.9));
    const episode = validateDailyEpisode(buildDailyEpisode('w', 2, 2, sources), sources, []);
    expect(episode.keyScenes).toHaveLength(5);
    expect(new Set(episode.keyScenes.flatMap(({ sourceEventIds }) => sourceEventIds)).size).toBe(7);
    const missing = { ...episode, keyScenes: episode.keyScenes.map((scene) => ({ ...scene,
      sourceEventIds: scene.sourceEventIds.filter((id) => id !== 'e6') })),
      relationshipChanges: episode.relationshipChanges.filter(({ sourceEventId }) => sourceEventId !== 'e6'),
      sourceEventIds: episode.sourceEventIds.filter((id) => id !== 'e6') };
    expect(() => validateDailyEpisode(missing, sources, [])).toThrow(/high-importance event/);
  });
  it('detects unpublished secret text even when source IDs are otherwise valid', () => {
    const sources = [source('e1')];
    const episode = buildDailyEpisode('w', 1, 1, sources);
    expect(() => validateDailyEpisode({ ...episode, headline: 'The ledger is under the red bridge' }, sources,
      ['ledger is under the red bridge'])).toThrow(/unpublished Canon secret/);
  });
  it('supports a quiet day without inventing Canon and keeps the source list empty', () => {
    const episode = validateDailyEpisode(buildDailyEpisode('w', 8, 8, []), [], []);
    expect(episode.keyScenes).toHaveLength(3);
    expect(episode.sourceEventIds).toEqual([]);
    expect(episode.keyScenes.every(({ sourceEventIds }) => sourceEventIds.length === 0)).toBe(true);
  });
  it('keeps generation/safety failure isolated from Canon and stores no blocked raw content', () => {
    const sourceCode = readFileSync('convex/editorial/episodeFunctions.ts', 'utf8');
    expect(sourceCode).toContain("status: 'failed'");
    expect(sourceCode).toContain("status: safe ? 'ready' : 'withheld'");
    expect(sourceCode).toContain("...(safe ? { episode } : {})");
    expect(sourceCode).not.toMatch(/insert\('canonEvents'|patch\([^\n]*canonEvents|commitProposedEvent|reduceWorldEvent/);
    expect(sourceCode).toContain(".withIndex('by_world_and_day'");
    expect(sourceCode).toContain('deduplicated: true');
  });
});
