/**
 * Unit tests for the three-minute arc primer (ART-38, FR-H002).
 *
 * Pure jest (no Convex/DOM): the builder is a pure function. Covers all four
 * FR-H002 content areas (cause / turning point / core characters / unresolved
 * questions), the ~2–4 minute bound (AC#1), current-mainline-only composition
 * (AC#2), and "no need to start from Episode 1" (AC#3).
 */

import {
  ARC_PRIMER_MAX_CHARS,
  ARC_PRIMER_MAX_CHARACTERS,
  ARC_PRIMER_MAX_QUESTIONS,
  buildArcPrimer,
  truncatePrimerToChineseChars,
  type PrimerCharacter,
} from './arcPrimer';

const WORLD_ID = 'w-primer';
const ARC_ID = 'arc-1';

function characters(n: number): PrimerCharacter[] {
  return Array.from({ length: n }, (_, i) => ({ characterId: `c${i}`, name: `角色${i}`, role: i === 0 ? '主角' : null }));
}

describe('truncatePrimerToChineseChars', () => {
  it('leaves short text untouched and truncates long text with an ellipsis', () => {
    expect(truncatePrimerToChineseChars('短句', 10)).toBe('短句');
    const long = '起'.repeat(50);
    const truncated = truncatePrimerToChineseChars(long, 10);
    expect(truncated.endsWith('…')).toBe(true);
    expect([...truncated].length).toBeLessThanOrEqual(12);
  });
});

describe('buildArcPrimer', () => {
  it('composes a primer covering all four FR-H002 content areas (AC#1/#2)', () => {
    const primer = buildArcPrimer({
      worldId: WORLD_ID, arcId: ARC_ID, title: '兩家休戰',
      cause: '長年紛爭後的脆弱和平。',
      turningPoint: { eventId: 'evt-tp', summary: '廣場上的簽約。' },
      characters: characters(3),
      unresolvedQuestions: ['和平能維持多久?'],
      currentQuestion: '和平能維持多久?',
      recommendedEntry: { episodeNumber: 3, worldDay: 3 },
    });
    expect(primer.primerText).toContain('兩家休戰');
    expect(primer.primerText).toContain('起因');
    expect(primer.primerText).toContain('最近重大轉折');
    expect(primer.primerText).toContain('核心人物');
    expect(primer.primerText).toContain('未解之謎');
    expect(primer.structured.cause).toBe('長年紛爭後的脆弱和平。');
    expect(primer.structured.turningPoint?.eventId).toBe('evt-tp');
  });

  it('bounds core characters (核心人物角色, AC#2)', () => {
    const primer = buildArcPrimer({
      worldId: WORLD_ID, arcId: ARC_ID, title: 'T',
      cause: null, turningPoint: null, characters: characters(10),
      unresolvedQuestions: [], currentQuestion: null, recommendedEntry: null,
    });
    expect(primer.structured.characters).toHaveLength(ARC_PRIMER_MAX_CHARACTERS);
    expect(ARC_PRIMER_MAX_CHARACTERS).toBe(6);
  });

  it('bounds unresolved questions and leads with the current question (AC#2)', () => {
    const primer = buildArcPrimer({
      worldId: WORLD_ID, arcId: ARC_ID, title: 'T',
      cause: null, turningPoint: null, characters: [],
      unresolvedQuestions: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'],
      currentQuestion: '當前核心問題?',
      recommendedEntry: null,
    });
    expect(primer.structured.unresolvedQuestions[0]).toBe('當前核心問題?');
    expect(primer.structured.unresolvedQuestions).toHaveLength(ARC_PRIMER_MAX_QUESTIONS);
    expect(ARC_PRIMER_MAX_QUESTIONS).toBe(4);
  });

  it('stays within the ~4-minute char ceiling (AC#1)', () => {
    const primer = buildArcPrimer({
      worldId: WORLD_ID, arcId: ARC_ID, title: 'T',
      cause: 'x'.repeat(5000),
      turningPoint: { eventId: 'e', summary: 'y'.repeat(5000) },
      characters: characters(6),
      unresolvedQuestions: ['Q'.repeat(5000)],
      currentQuestion: null,
      recommendedEntry: null,
    });
    // Chinese-char count of the primer text must not exceed the ceiling.
    const chineseCount = (primer.primerText.match(/[一-鿿]/g) ?? []).length;
    // Non-Chinese filler aside, the hard cap is enforced on Chinese chars.
    expect(chineseCount).toBeLessThanOrEqual(ARC_PRIMER_MAX_CHARS);
  });

  it('states the viewer need not start from Episode 1 when a recommended entry exists (AC#3)', () => {
    const primer = buildArcPrimer({
      worldId: WORLD_ID, arcId: ARC_ID, title: 'T',
      cause: null, turningPoint: null, characters: [],
      unresolvedQuestions: [], currentQuestion: null,
      recommendedEntry: { episodeNumber: 5, worldDay: 5 },
    });
    expect(primer.primerText).toContain('不必從第一集開始');
    expect(primer.primerText).toContain('第5集');
    expect(primer.structured.recommendedEntry?.episodeNumber).toBe(5);
  });

  it('degrades gracefully when all optional content is absent', () => {
    const primer = buildArcPrimer({
      worldId: WORLD_ID, arcId: ARC_ID, title: '寂靜之線',
      cause: null, turningPoint: null, characters: [],
      unresolvedQuestions: [], currentQuestion: null, recommendedEntry: null,
    });
    expect(primer.primerText).toContain('寂靜之線');
    expect(primer.structured.characters).toEqual([]);
    expect(primer.structured.turningPoint).toBeNull();
  });

  it('rejects an empty worldId or arcId', () => {
    expect(() => buildArcPrimer({
      worldId: ' ', arcId: ARC_ID, title: 'T', cause: null, turningPoint: null,
      characters: [], unresolvedQuestions: [], currentQuestion: null, recommendedEntry: null,
    })).toThrow();
  });
});
