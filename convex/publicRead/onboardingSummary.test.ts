import { countChineseCharacters } from '../recaps/recapFormats';
import {
  ONBOARDING_MAX_CHARS,
  ONBOARDING_MAX_CHARACTERS,
  ONBOARDING_MAX_FACTS,
  buildOnboardingSummary,
  truncateToChineseChars,
} from './onboardingSummary';

function cjk(n: number, suffix = ''): string {
  return '今'.repeat(n) + suffix;
}

describe('truncateToChineseChars', () => {
  it('leaves text under the limit untouched', () => {
    expect(truncateToChineseChars('今日天氣晴', 10)).toBe('今日天氣晴');
  });
  it('truncates to at most max Chinese characters', () => {
    const truncated = truncateToChineseChars(cjk(500), 100);
    expect(countChineseCharacters(truncated)).toBeLessThanOrEqual(100);
  });
});

describe('buildOnboardingSummary (FR-H001)', () => {
  it('AC#1: keeps the summary at or below ~300 中文字 even with huge inputs', () => {
    const summary = buildOnboardingSummary({
      worldId: 'w1',
      majorEvent: { eventId: 'e1', publicSummary: cjk(2000) },
      importance: 0.9,
      characters: Array.from({ length: 4 }, (_, i) => ({ characterId: `c${i}`, name: `角色${i}` })),
      facts: [{ factId: 'f1', predicate: '天氣', value: '晴' }],
      question: cjk(500),
      recommendedEpisode: { episodeNumber: 1, worldDay: 1 },
      scene: { title: '廣場', summary: cjk(500) },
    });
    expect(countChineseCharacters(summary.summaryText)).toBeLessThanOrEqual(ONBOARDING_MAX_CHARS);
    expect(summary.summaryText.endsWith('…') || countChineseCharacters(summary.summaryText) <= ONBOARDING_MAX_CHARS).toBe(true);
  });

  it('AC#2: bounds the structured payload (never a full history dump)', () => {
    const summary = buildOnboardingSummary({
      worldId: 'w1',
      majorEvent: { eventId: 'e1', publicSummary: '發生了大事' },
      importance: 0.8,
      characters: Array.from({ length: 6 }, (_, i) => ({ characterId: `c${i}`, name: `角色${i}` })),
      facts: Array.from({ length: 5 }, (_, i) => ({ factId: `f${i}`, predicate: `p${i}`, value: i })),
      question: '誰會讓步?',
      recommendedEpisode: { episodeNumber: 2, worldDay: 2 },
      scene: { title: '酒館', summary: '眾人聚集。' },
    });
    expect(summary.structured.characters).toHaveLength(ONBOARDING_MAX_CHARACTERS);
    expect(summary.structured.facts).toHaveLength(ONBOARDING_MAX_FACTS);
    expect(summary.structured.majorEvent?.eventId).toBe('e1');
    expect(summary.structured.question).toBe('誰會讓步?');
  });

  it('composes a readable summary from the bounded fields', () => {
    const summary = buildOnboardingSummary({
      worldId: 'w1',
      majorEvent: { eventId: 'e1', publicSummary: '兩家和解' },
      importance: 0.7,
      characters: [{ characterId: 'c1', name: '艾拉' }],
      facts: [{ factId: 'f1', predicate: '盟約', value: '締結' }],
      question: '和平能維持多久?',
      recommendedEpisode: { episodeNumber: 3, worldDay: 3 },
      scene: null,
    });
    expect(summary.summaryText).toContain('兩家和解');
    expect(summary.summaryText).toContain('艾拉');
    expect(summary.summaryText).toContain('第3集');
  });

  it('falls back to a default line when no fields are supplied', () => {
    const summary = buildOnboardingSummary({
      worldId: 'w1', majorEvent: null, importance: 0, characters: [], facts: [],
      question: null, recommendedEpisode: null, scene: null,
    });
    expect(countChineseCharacters(summary.summaryText)).toBeGreaterThan(0);
    expect(summary.summaryText).toContain('等待你來探索');
  });

  it('is deterministic for identical inputs (AC#3 refresh safety)', () => {
    const input = {
      worldId: 'w1', majorEvent: { eventId: 'e1', publicSummary: '事件' }, importance: 0.5,
      characters: [{ characterId: 'c1', name: 'A' }], facts: [], question: 'Q?',
      recommendedEpisode: null, scene: null,
    };
    expect(buildOnboardingSummary(input)).toEqual(buildOnboardingSummary(input));
  });
});
