/**
 * FR-G003 Quick and Standard recap composition (ART-164).
 *
 * `recapFormats.ts` validates that a Quick Recap is 80–150 中文字 and a Standard Recap 400–800, and
 * shipped no builder for either. Composing them deterministically inside a closed character band,
 * from a real world day, without lying about what the text says, is the work these tests cover.
 *
 * The central rule is that composition takes WHOLE SENTENCE UNITS or nothing. Everything below
 * follows from it, so most of these tests are about what the composer refuses to do.
 */

import type { AcceptedEvent } from '../canon/model';
import type { DailyEpisode } from '../editorial/episode';
import { CANON_VALIDATION_VERSION } from '../shared/constants';
import { countChineseCharacters } from '../shared/publicText';
import { deriveEventId } from '../shared/ids';
import {
  buildRecapUnits, composeRecaps, RecapCompositionError, RECAP_FORMATTER_VERSION,
} from './recapComposition';
import { QUICK_RECAP_MAX, QUICK_RECAP_MIN, STANDARD_RECAP_MAX, STANDARD_RECAP_MIN } from './recapFormats';

const WORLD_ID = 'mistwood';

/** One 30 中文字 sentence, distinguishable by index so provenance is checkable. */
const line = (index: number): string =>
  `第${index}場交涉在車站進行，雙方各自守住底線，話說到一半便停住，誰也沒有先讓步下來`;

const event = (index: number, publicSummary: string | undefined = line(index)): AcceptedEvent => ({
  schemaVersion: 1,
  eventId: deriveEventId(WORLD_ID, index),
  worldId: WORLD_ID,
  sequenceNumber: index,
  idempotencyKey: `event-${index}`,
  proposedBy: { type: 'system' },
  worldDay: 0,
  timeSlot: 'morning',
  eventType: 'conversation',
  participantIds: ['lin-yingxue'],
  causedByEventIds: [],
  publicSummary,
  stateChanges: [],
  validationVersion: CANON_VALIDATION_VERSION,
  traceId: `trace-${index}`,
  acceptedAt: 1_700_000_000_000 + index,
});

const episodeOf = (events: readonly AcceptedEvent[], overrides: Partial<DailyEpisode> = {}): DailyEpisode => ({
  schemaVersion: 1,
  worldId: WORLD_ID,
  worldDay: 0,
  episodeNumber: 1,
  title: '第一集',
  headline: '帳本的下落成為全鎮爭論的焦點，沒有人願意先鬆口說明自己知道多少',
  oneLineSummary: '雙方在車站對峙一整天，最後仍舊沒有得出任何結論來收尾這件事',
  keyScenes: [],
  relationshipChanges: [],
  newQuestions: [],
  resolvedQuestions: [],
  characterIds: ['lin-yingxue'],
  arcIds: [],
  sourceEventIds: events.map(({ eventId }) => eventId),
  ...overrides,
} as DailyEpisode);

const dayOf = (count: number): { episode: DailyEpisode; events: AcceptedEvent[] } => {
  const events = Array.from({ length: count }, (_, index) => event(index));
  return { episode: episodeOf(events), events };
};

describe('FR-G003 recap composition', () => {
  it('lands both tiers inside their bands and records the formatter that produced them', () => {
    const { episode, events } = dayOf(12);
    const composed = composeRecaps(episode, events);

    const quick = countChineseCharacters(composed.quickRecap);
    const standard = countChineseCharacters(composed.standardRecap);
    expect(quick).toBeGreaterThanOrEqual(QUICK_RECAP_MIN);
    expect(quick).toBeLessThanOrEqual(QUICK_RECAP_MAX);
    expect(standard).toBeGreaterThanOrEqual(STANDARD_RECAP_MIN);
    expect(standard).toBeLessThanOrEqual(STANDARD_RECAP_MAX);
    // Stored so a later formatter change never leaves an older artifact unidentifiable.
    expect(composed.composition.formatterVersion).toBe(RECAP_FORMATTER_VERSION);
  });

  it('is deterministic: the same day composes to the same text', () => {
    const { episode, events } = dayOf(12);
    expect(composeRecaps(episode, events)).toEqual(composeRecaps(episode, events));
  });

  /**
   * The rule the three failure modes in the PRD all reduce to. Character-level trimming is the
   * obvious way to hit a band exactly; it is also the way to publish a sentence that says the
   * opposite of what happened, so the composer cannot land on an exact count and does not try.
   */
  it('takes whole sentences or none, so no unit is ever half-published', () => {
    const { episode, events } = dayOf(30);
    const units = buildRecapUnits(episode, events);
    const composed = composeRecaps(episode, events);

    for (const text of [composed.quickRecap, composed.standardRecap]) {
      // Concatenating whole units means the text partitions exactly into pool sentences.
      let remaining = text;
      while (remaining.length > 0) {
        const match = units.find(({ text: unitText }) => remaining.startsWith(unitText));
        expect(match).toBeDefined();
        remaining = remaining.slice((match as { text: string }).text.length);
      }
    }
    // And nothing is truncated mid-sentence at the end.
    expect(/[。！？]$/u.test(composed.standardRecap)).toBe(true);
  });

  it('covers the Quick Recap with the Standard Recap, so the short one is never contradicted', () => {
    const { episode, events } = dayOf(20);
    const composed = composeRecaps(episode, events);
    // Both fill greedily from one pool in the same order, so everything the Quick says the
    // Standard says too. A reader of only the short one is never told something the long one
    // takes back.
    expect(composed.standardRecap.startsWith(composed.quickRecap)).toBe(true);
  });

  it('publishes what a busy day omitted rather than dropping it silently', () => {
    const { episode, events } = dayOf(60);
    const composed = composeRecaps(episode, events);
    expect(composed.composition.omittedUnits).toBeGreaterThan(0);
    expect(composed.composition.omittedSourceEventIds.length).toBeGreaterThan(0);
    // An omitted event's ID is NOT claimed as a source: the artifact cannot say it covered an
    // event whose only sentence was dropped.
    for (const eventId of composed.composition.omittedSourceEventIds) {
      expect(composed.sourceEventIds).not.toContain(eventId);
    }
  });

  it('claims provenance only for the events whose sentences were kept', () => {
    const { episode, events } = dayOf(60);
    const composed = composeRecaps(episode, events);
    const known = new Set(events.map(({ eventId }) => eventId));
    expect(composed.sourceEventIds.every((eventId) => known.has(eventId))).toBe(true);
    expect(composed.sourceEventIds.length).toBeLessThan(events.length);
    // Sorted and unique, so two runs cannot disagree about the order of the same evidence.
    expect(composed.sourceEventIds).toEqual([...new Set(composed.sourceEventIds)].sort());
  });

  it('refuses a day with too little public content instead of padding it to the floor', () => {
    const events = [event(0, '很短。')];
    const episode = episodeOf(events, { headline: '短', oneLineSummary: '短' });
    expect(() => composeRecaps(episode, events)).toThrow(RecapCompositionError);
    try {
      composeRecaps(episode, events);
    } catch (error) {
      const failure = error as RecapCompositionError;
      expect(failure.code).toBe('RECAP_POOL_BELOW_MINIMUM');
      // The measurement travels with the refusal, so an operator sees a thin day rather than a
      // mysteriously empty recap.
      expect(failure.details).toMatchObject({ required: QUICK_RECAP_MIN });
      expect((failure.details as { available: number }).available).toBeLessThan(QUICK_RECAP_MIN);
    }
  });

  it('refuses a day that clears the Quick floor but cannot reach the Standard one', () => {
    const { episode, events } = dayOf(3);
    try {
      composeRecaps(episode, events);
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as RecapCompositionError).code).toBe('RECAP_STANDARD_BELOW_MINIMUM');
    }
  });

  it('refuses when no whole-sentence combination lands in the Quick band', () => {
    /**
     * EVERY sentence is longer than the Quick maximum. The pool is far past the floor in total,
     * but no combination of whole units fits inside the band, because `fill` skips an oversized
     * unit and moves on rather than cutting it. The fix is shorter sentences, not a sliced one.
     */
    const long = '這件事拖了很久並且牽連甚廣'.repeat(20);
    const events = Array.from({ length: 20 }, (_, index) => event(index, long));
    const episode = episodeOf(events, { headline: long, oneLineSummary: long });
    try {
      composeRecaps(episode, events);
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as RecapCompositionError).code).toBe('RECAP_QUICK_UNSATISFIABLE');
    }
  });

  it('draws only on already-public material', () => {
    const unsummarised = { ...event(0), publicSummary: undefined } as AcceptedEvent;
    const events = [unsummarised, ...Array.from({ length: 14 }, (_, index) => event(index + 1))];
    const episode = episodeOf(events);
    const units = buildRecapUnits(episode, events);
    // An event with no public summary contributes no sentence, so a recap can never be the route
    // by which unsummarised material reaches a reader.
    expect(units.some(({ sourceEventId }) => sourceEventId === unsummarised.eventId)).toBe(false);
    expect(units.every(({ text }) => text.length > 0)).toBe(true);
    // And the composed artifact does not claim it either.
    expect(composeRecaps(episode, events).sourceEventIds).not.toContain(unsummarised.eventId);
  });

  it('orders the pool by weight, so the thinnest recap still says what happened', () => {
    const { episode, events } = dayOf(12);
    const units = buildRecapUnits(episode, events);
    expect(units[0].text).toContain(episode.headline);
    const weights = units.map(({ weight }) => weight);
    expect(weights).toEqual([...weights].sort((left, right) => right - left));
  });
});
