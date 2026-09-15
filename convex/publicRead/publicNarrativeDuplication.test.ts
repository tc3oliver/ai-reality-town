/**
 * Saying one thing once (ART-184).
 *
 * Measured against the live world before this task: twenty recent events carried THREE distinct
 * summary strings, one repeated seven times. Five key scenes were built from fifteen distinct
 * event ids and those same three sentences, so every scene was a permutation of the others and
 * one contained the same sentence twice. The home page then showed the mill sentence three times
 * on one screen.
 *
 * The counts below are the point. A test that merely asserted "scene 1 !== scene 2" would pass on
 * a page that says one thing five different ways; asserting the DISTINCT COUNT against the input
 * is what makes the fixture reproduce the real defect.
 */

import {
  MAX_EPISODE_SCENES,
  MIN_EPISODE_SCENES,
  buildDailyEpisode,
  type EpisodeSourceEvent,
} from '../editorial/episode';
import { buildOnboardingSummary } from './onboardingSummary';

const source = (eventId: string, publicSummary: string | null, importance = 0.5): EpisodeSourceEvent => ({
  eventId,
  publicSummary,
  participantIds: ['he-jun'],
  arcIds: ['arc-1'],
  importance,
  publicFactIds: [`${eventId}:fact`],
  publicRelationshipChanges: [],
  newQuestions: [],
  resolvedQuestions: [],
});

/** The shape the live world produced: many events, three sentences. */
const THREE_SENTENCES = [
  '磨坊那邊,何俊與趙明把帳目重新攤開。',
  '鎮公所裡,高文睿、裴嵐與邱安為修繕表決僵持。',
  '廣場上,方玥與沈愷談起鎮史展的事。',
] as const;

const twentyEventsOnThreeSentences = (): EpisodeSourceEvent[] =>
  Array.from({ length: 20 }, (unused, index) =>
    source(`e${index}`, THREE_SENTENCES[index % THREE_SENTENCES.length], 1 - index / 100));

const distinctCount = (values: readonly string[]): number => new Set(values).size;

describe('an episode never says the same thing twice', () => {
  it('reduces twenty events on three sentences to three distinct scenes', () => {
    const sources = twentyEventsOnThreeSentences();
    expect(distinctCount(sources.map((entry) => entry.publicSummary as string))).toBe(3);

    const episode = buildDailyEpisode('mistwood', 3, 4, sources);
    expect(episode.keyScenes).toHaveLength(3);
    expect(distinctCount(episode.keyScenes.map((scene) => scene.summary))).toBe(3);
  });

  it('never repeats a sentence INSIDE one scene', () => {
    // The live Key scene 2 contained the mistwood-square sentence twice, joined by a space.
    const episode = buildDailyEpisode('mistwood', 3, 4, twentyEventsOnThreeSentences());
    for (const scene of episode.keyScenes) {
      for (const sentence of THREE_SENTENCES) {
        const occurrences = scene.summary.split(sentence).length - 1;
        expect(occurrences).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps every collapsed event id, so provenance is merged rather than lost', () => {
    const sources = twentyEventsOnThreeSentences();
    const episode = buildDailyEpisode('mistwood', 3, 4, sources);
    const named = episode.keyScenes.flatMap((scene) => scene.sourceEventIds).sort();
    expect(named).toEqual(sources.map((entry) => entry.eventId).sort());
  });

  it('keeps every public fact a collapsed duplicate named', () => {
    const sources = twentyEventsOnThreeSentences();
    const episode = buildDailyEpisode('mistwood', 3, 4, sources);
    const facts = episode.keyScenes.flatMap((scene) => scene.publicFactIds).sort();
    expect(facts).toEqual(sources.map((entry) => `${entry.eventId}:fact`).sort());
  });

  it('does not repeat a sentence in the one-line summary either', () => {
    const episode = buildDailyEpisode('mistwood', 3, 4, twentyEventsOnThreeSentences());
    expect(episode.oneLineSummary.split(THREE_SENTENCES[0]).length - 1).toBeLessThanOrEqual(1);
  });

  it('still builds a full episode when every event genuinely differs', () => {
    const sources = Array.from({ length: 5 }, (unused, index) =>
      source(`e${index}`, `第 ${index} 件事發生了。`, 1 - index / 100));
    const episode = buildDailyEpisode('mistwood', 3, 4, sources);
    expect(episode.keyScenes).toHaveLength(MAX_EPISODE_SCENES);
    expect(distinctCount(episode.keyScenes.map((scene) => scene.summary))).toBe(MAX_EPISODE_SCENES);
  });

  it('does not collapse two events that merely both said nothing publicly', () => {
    /**
     * A blank summary is an ABSENCE, not a shared text. Collapsing on it would quietly shrink a
     * quiet day's scene count and make two silent events look like one.
     */
    const sources = [source('e1', null), source('e2', null), source('e3', null), source('e4', null)];
    const episode = buildDailyEpisode('mistwood', 3, 4, sources);
    expect(episode.keyScenes.length).toBeGreaterThanOrEqual(MIN_EPISODE_SCENES);
    expect(episode.keyScenes.flatMap((scene) => scene.sourceEventIds).sort())
      .toEqual(['e1', 'e2', 'e3', 'e4']);
  });
});

describe('the onboarding primer does not restate its own lead event', () => {
  const primer = (majorSummary: string, sceneSummary: string) => buildOnboardingSummary({
    worldId: 'mistwood',
    majorEvent: { eventId: 'e1', publicSummary: majorSummary },
    importance: 0.9,
    characters: [{ characterId: 'he-jun', name: 'He Jun' }],
    facts: [],
    question: '這筆錢究竟流向何處?',
    recommendedEpisode: { episodeNumber: 3, worldDay: 2 },
    scene: { title: '關鍵場景 1', summary: sceneSummary },
  }).summaryText;

  it('keeps the lead event, because ART-75 AC#1 needs the text to stand alone', () => {
    // An earlier attempt at this task removed it and the acceptance suite caught that.
    expect(primer('磨坊的帳目被重新翻開。', '別的事。')).toContain('近期大事:磨坊的帳目被重新翻開。');
  });

  it('drops the scene clause when the scene merely restates the lead event', () => {
    const text = primer('磨坊的帳目被重新翻開。', '磨坊的帳目被重新翻開。');
    expect(text.split('磨坊的帳目被重新翻開。').length - 1).toBe(1);
    expect(text).not.toContain('場景:');
  });

  it('drops it when the scene CONTAINS the lead event rather than equalling it', () => {
    /**
     * The observed shape. A scene summary is assembled by joining the summaries of the events it
     * covers, so it contains the lead sentence with more text around it. An equality check would
     * have missed every real case.
     */
    const text = primer('磨坊的帳目被重新翻開。', '磨坊的帳目被重新翻開。廣場上另有動靜。');
    expect(text).not.toContain('場景:');
  });

  it('keeps a scene that genuinely says something else', () => {
    expect(primer('磨坊的帳目被重新翻開。', '廣場上另有動靜。')).toContain('場景:廣場上另有動靜。');
  });
});
