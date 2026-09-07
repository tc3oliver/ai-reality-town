/**
 * The zh-Hant language contract of the deterministic fixture author (ART-164, FR-G003).
 *
 * FR-G003 states the Episode recap contract in 中文字 — Quick 80–150, Standard 400–800 — and
 * `countChineseCharacters` counts CJK ideographs only. This narrator wrote English, so every
 * deterministic world day measured zero and the live recap path refused every episode with
 * `RECAP_POOL_BELOW_MINIMUM`.
 *
 * The mismatch was between the fixture and the product's language contract, so the fixture is what
 * changed. These tests exist so it cannot silently change back: an English-only narrator wired to
 * the production recap path must make this suite red, which is the sixth test below.
 */

import { countChineseCharacters } from '../shared/publicText';
import { MAX_PUBLIC_SUMMARY_LENGTH } from '../shared/constants';
import { QUICK_RECAP_MIN, STANDARD_RECAP_MIN } from '../recaps/recapFormats';
import { composeRecaps, RecapCompositionError } from '../recaps/recapComposition';
import { buildDailyEpisode, validateDailyEpisode, type EpisodeSourceEvent } from '../editorial/episode';
import type { AcceptedEvent, ProposedEvent } from '../canon/model';
import { CANON_VALIDATION_VERSION } from '../shared/constants';
import { deriveEventId } from '../shared/ids';
import { narrateGroupedScene } from './fakeSceneNarrator';
import type { GroupedScene } from './sceneGrouping';
import { TIME_SLOTS } from '../canon/eventTypes';

const WORLD_ID = 'mistwood';

const scene = (index: number, participantIds: string[] = ['lin-yingxue', 'qiu-an']): GroupedScene => ({
  schemaVersion: 1,
  sceneId: `${WORLD_ID}#scene#${index}`,
  groupingRunId: `grouping-${index}`,
  directorRunId: `director-${index}`,
  worldId: WORLD_ID,
  worldDay: Math.floor(index / TIME_SLOTS.length),
  timeSlot: TIME_SLOTS[index % TIME_SLOTS.length],
  locationId: 'mistwood-station',
  participantIds,
  sourceIntentIds: [`intent-${index}`],
  arcIds: [],
  trigger: '車站帳本的下落',
  dramaticPressure: '雙方都知道對方握有對自己不利的紀錄',
});

const narration = (index: number, participantIds?: string[]): {
  sceneSummary: string;
  proposed: ProposedEvent;
  keyActions: Array<{ characterId: string; action: string }>;
} => {
  const output = narrateGroupedScene(scene(index, participantIds));
  return {
    sceneSummary: output.sceneSummary as string,
    proposed: (output.proposedEvents as ProposedEvent[])[0],
    keyActions: output.keyActions as Array<{ characterId: string; action: string }>,
  };
};

/** Turn narrated scenes into the accepted events a day's recap composes from. */
const acceptedDay = (count: number, offset = 0): AcceptedEvent[] =>
  Array.from({ length: count }, (_, index) => {
    const { proposed } = narration(offset + index);
    return {
      schemaVersion: 1,
      eventId: deriveEventId(WORLD_ID, offset + index),
      worldId: WORLD_ID,
      sequenceNumber: offset + index,
      idempotencyKey: proposed.idempotencyKey,
      proposedBy: { type: 'system' as const },
      worldDay: 0,
      timeSlot: TIME_SLOTS[index % TIME_SLOTS.length],
      eventType: proposed.eventType,
      locationId: proposed.locationId,
      participantIds: [...proposed.participantIds],
      causedByEventIds: [],
      publicSummary: proposed.publicSummary,
      stateChanges: proposed.stateChanges,
      validationVersion: CANON_VALIDATION_VERSION,
      traceId: `trace-${offset + index}`,
      acceptedAt: 1_700_000_000_000 + offset + index,
    } as AcceptedEvent;
  });

const sourcesOf = (events: readonly AcceptedEvent[]): EpisodeSourceEvent[] =>
  events.map((event) => ({
    eventId: event.eventId,
    publicSummary: event.publicSummary ?? null,
    participantIds: [...event.participantIds],
    arcIds: [],
    importance: 0.8,
    publicFactIds: event.stateChanges.flatMap((change, index) =>
      change.type === 'fact_created' && change.visibility === 'public' ? [`${event.eventId}:fact:${index}`] : []),
    publicRelationshipChanges: event.stateChanges.flatMap((change) =>
      change.type === 'relationship_changed' && change.visibility === 'public'
        ? [`${change.sourceCharacterId} 與 ${change.targetCharacterId} 的關係有了公開的變化。`] : []),
    newQuestions: [],
    resolvedQuestions: [],
  }));

const composeDay = (eventCount: number): ReturnType<typeof composeRecaps> => {
  const events = acceptedDay(eventCount);
  const sources = sourcesOf(events);
  const episode = validateDailyEpisode(buildDailyEpisode(WORLD_ID, 0, 1, sources), sources, []);
  return composeRecaps(episode, events);
};

describe('the deterministic fixture author narrates in zh-Hant (FR-G003)', () => {
  it('AC#1 — every narrated string a recap can draw on carries 中文字', () => {
    const { sceneSummary, proposed, keyActions } = narration(0);
    expect(countChineseCharacters(sceneSummary)).toBeGreaterThan(0);
    expect(countChineseCharacters(proposed.publicSummary ?? '')).toBeGreaterThan(0);
    expect(keyActions.every(({ action }) => countChineseCharacters(action) > 0)).toBe(true);
    // Every state change that carries prose carries it in the same language.
    for (const change of proposed.stateChanges) {
      if (change.type === 'relationship_changed') expect(countChineseCharacters(change.reason)).toBeGreaterThan(0);
      if (change.type === 'character_memory_formed') {
        expect(countChineseCharacters(change.content)).toBeGreaterThan(0);
        expect(countChineseCharacters(change.interpretation)).toBeGreaterThan(0);
      }
    }
  });

  it('stays deterministic and stays distinguishable between scenes', () => {
    expect(narration(3).proposed.publicSummary).toBe(narration(3).proposed.publicSummary);
    const summaries = Array.from({ length: 24 }, (_, index) => narration(index).proposed.publicSummary);
    // Distinguishable, not merely unique-by-ID: the TEXT differs across scenes, which is what a
    // recap composed from a day of them depends on.
    expect(new Set(summaries).size).toBeGreaterThan(1);
  });

  /**
   * The public sentence must not grow with the cast, and the reason is a defect this migration
   * caused and then removed.
   *
   * An earlier version spelled out every participant's stance and listed every participant by
   * name. On a large cast that overran `MAX_PUBLIC_SUMMARY_LENGTH`, and the clamp cut the tail —
   * where the scene's outcome and stake live — so two different scenes at one location truncated
   * to the SAME text. The measured distinct-scene count FELL from 46 to 41 as the sentence got
   * longer. The sentence is now scene-level only, so this holds by construction rather than by
   * luck of cast size.
   */
  it('keeps the public summary independent of cast size, so the clamp never fires', () => {
    const cast = ['lin-yingxue', 'qiu-an', 'gao-wenrui', 'pei-lan', 'he-jun', 'zhao-ming', 'tang-ruoxi'];
    const byIndex = new Map<number, string>();
    for (let size = 1; size <= cast.length; size += 1) {
      for (let index = 0; index < 24; index += 1) {
        const summary = narration(index, cast.slice(0, size)).proposed.publicSummary ?? '';
        expect(summary.length).toBeLessThanOrEqual(MAX_PUBLIC_SUMMARY_LENGTH);
        // An ellipsis would mean the text was cut, and a cut sentence is what the recap composer
        // refuses to produce; the fixture must not hand it one either.
        expect(summary.endsWith('…')).toBe(false);
        // Same scene, any cast: same sentence. A summary that varied with cast size is what put
        // the differentiating half of it at risk of the clamp.
        const seen = byIndex.get(index);
        if (seen === undefined) byIndex.set(index, summary);
        else expect(summary).toBe(seen);
      }
    }
  });

  /**
   * THIN is five events: one scene in each of the five time slots, which is the fewest a world day
   * can produce. It is deliberately not an arbitrary smaller number — a four-event day is not a
   * day this pipeline emits, so requiring one to compose would be testing the fixture against a
   * state it never reaches, and the honest answer for a genuinely under-dense day is the explicit
   * refusal AC#5 covers rather than a padded pass.
   */
  it('AC#2 — a thin day still composes a Quick and a Standard Recap inside their bands', () => {
    expect(TIME_SLOTS).toHaveLength(5);
    const composed = composeDay(TIME_SLOTS.length);
    expect(countChineseCharacters(composed.quickRecap)).toBeGreaterThanOrEqual(QUICK_RECAP_MIN);
    expect(countChineseCharacters(composed.standardRecap)).toBeGreaterThanOrEqual(STANDARD_RECAP_MIN);
  });

  it('AC#3/#4 — a normal and a busy day compose too, and the busy day stays under the maximum', () => {
    for (const eventCount of [12, 30]) {
      const composed = composeDay(eventCount);
      expect(countChineseCharacters(composed.quickRecap)).toBeGreaterThanOrEqual(QUICK_RECAP_MIN);
      expect(countChineseCharacters(composed.standardRecap)).toBeGreaterThanOrEqual(STANDARD_RECAP_MIN);
    }
    // The busy day drops whole units to stay inside the maximum, and says which — truncation is
    // never silent, so the omission is on the artifact rather than only in the missing text.
    const busy = composeDay(30);
    expect(busy.composition.omittedUnits).toBeGreaterThan(0);
    expect(busy.composition.omittedSourceEventIds.length).toBeGreaterThan(0);
  });

  it('AC#5 — a genuinely insufficient source pool is still an explicit refusal, not a padded pass', () => {
    const events = acceptedDay(1).map((event) => ({ ...event, publicSummary: '。' }));
    const sources = sourcesOf(events).map((source) => ({ ...source, publicSummary: '。' }));
    const episode = validateDailyEpisode(buildDailyEpisode(WORLD_ID, 0, 1, sources), sources, []);
    const thin = {
      ...episode,
      headline: '無',
      oneLineSummary: '無',
      keyScenes: episode.keyScenes.map((keyScene) => ({ ...keyScene, title: '無', summary: '無' })),
      relationshipChanges: [],
    };
    let thrown: unknown;
    try {
      composeRecaps(thin, events);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RecapCompositionError);
    expect((thrown as RecapCompositionError).code).toBe('RECAP_POOL_BELOW_MINIMUM');
  });

  it('AC#6 — an English-only author wired to this path makes the contract fail, not pass', () => {
    const events = acceptedDay(12).map((event) => ({
      ...event,
      publicSummary: 'The parties met at the station and left without agreeing anything.',
    }));
    const sources = sourcesOf(events).map((source) => ({
      ...source, publicSummary: 'The parties met at the station and left without agreeing anything.',
    }));
    const episode = validateDailyEpisode(buildDailyEpisode(WORLD_ID, 0, 1, sources), sources, []);
    const english = {
      ...episode,
      headline: 'The ledger question stays open',
      oneLineSummary: 'Nobody conceded and nothing was signed.',
      keyScenes: episode.keyScenes.map((keyScene) => ({
        ...keyScene, title: 'At the station', summary: 'They talked past each other for an hour.',
      })),
      relationshipChanges: [],
    };
    /**
     * The regression this whole migration exists to prevent. Plenty of prose, zero 中文字, so the
     * band cannot be met — and the failure is loud rather than a recap that quietly ships in the
     * wrong language.
     */
    expect(() => composeRecaps(english, events)).toThrow(/RECAP_POOL_BELOW_MINIMUM/);
  });
});
