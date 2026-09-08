/**
 * The similarity primitives the Narrative evaluator is built on (FR-M002, ART-88).
 *
 * These four functions decide what "the same scene" means, so every number
 * `evaluateNarrative` reports is downstream of them. They are tested here on their own, with
 * ASCII wherever the assertion is about arithmetic and zh-Hant wherever it is about the prose the
 * evaluator actually sees, because a Jaccard value is checkable by hand and a hanzi sentence is
 * not.
 *
 * Two properties get the most attention, because both have a silent failure mode:
 *
 *  - **Masking is longest-identifier-first.** Wrong order leaves a stub (`⟨mask⟩-annex`), which
 *    reads as ordinary prose and quietly makes two identical scenes distinct.
 *  - **`nearestEarlier`'s inverted index prunes candidates before scoring them.** A pruning bound
 *    that is too tight drops true matches, and a dropped match is indistinguishable from a clean
 *    world: the ratio simply comes out lower. The bound is exercised here at a pair that sits above
 *    the evaluator's own threshold.
 */

import { fnv1a64, jaccard, nearestEarlier, normalizeNarrative, shingles, structuralSignature } from './textSimilarity';

const YINGXUE = 'lin-yingxue';
const WENRUI = 'gao-wenrui';
const HALL = 'mistwood-hall';
const HALL_ANNEX = 'mistwood-hall-annex';

const gramSet = (...grams: string[]): Set<string> => new Set(grams);

describe('normalizeNarrative', () => {
  it('masks an identifier to one character rather than deleting it', () => {
    const normalized = normalizeNarrative(`${YINGXUE} 與 ${WENRUI}`, [YINGXUE, WENRUI]);

    // Deleting would collapse 「甲與乙」 into 「與」 and lose the sentence's shape; masking keeps
    // three positions, which is what makes two differently-cast scenes comparable at all.
    expect([...normalized]).toHaveLength(3);
    expect(normalized).toContain('與');
    expect(normalized).not.toContain('lin');
    expect(normalized).not.toContain('gao');
  });

  it('masks every identifier to the SAME token, so who acted cannot create similarity', () => {
    expect(normalizeNarrative(`${YINGXUE} 走進議事廳。`, [YINGXUE, WENRUI]))
      .toBe(normalizeNarrative(`${WENRUI} 走進議事廳。`, [YINGXUE, WENRUI]));
  });

  it('masks the longest identifier first, so a prefix id leaves no stub', () => {
    const identifiers = [HALL, HALL_ANNEX];
    const annex = normalizeNarrative(`在 ${HALL_ANNEX} 集合`, identifiers);

    expect(annex).not.toContain('annex');
    // Sorting the other way would mask `mistwood-hall` inside `mistwood-hall-annex` and leave
    // `-annex` behind as prose. Both texts name one location, so both normalise identically.
    expect(annex).toBe(normalizeNarrative(`在 ${HALL} 集合`, identifiers));
    // 在 + one mask + 集 + 合.
    expect([...annex]).toHaveLength(4);
  });

  it('masks a run of digits to one token, in either script', () => {
    expect(normalizeNarrative('第3號附件')).toBe(normalizeNarrative('第17號附件'));
    expect(normalizeNarrative('第3號附件')).toBe(normalizeNarrative('第３號附件'));
    // 第 + one mask for the whole run + 號 + 附 + 件.
    expect([...normalizeNarrative('第17號附件')]).toHaveLength(5);
  });

  it('drops whitespace and punctuation', () => {
    expect(normalizeNarrative('裴嵐，  請坐。')).toBe('裴嵐請坐');
    expect(normalizeNarrative('a b\tc\nd')).toBe('abcd');
    expect(normalizeNarrative('「引號」也是標點')).toBe('引號也是標點');
  });

  it('is idempotent', () => {
    const identifiers = [YINGXUE, HALL];
    const once = normalizeNarrative(`${YINGXUE} 在 ${HALL} 讀了第 3 份卷宗。`, identifiers);

    expect(normalizeNarrative(once, identifiers)).toBe(once);
  });

  it('leaves an empty string empty, and an all-punctuation string empty', () => {
    expect(normalizeNarrative('')).toBe('');
    expect(normalizeNarrative('，。 「」')).toBe('');
  });
});

describe('shingles', () => {
  it('yields nothing for an empty string', () => {
    expect(shingles('').size).toBe(0);
  });

  it('yields the whole string as one gram when it is no longer than the window', () => {
    expect(shingles('ab', 3)).toEqual(gramSet('ab'));
    expect(shingles('abc', 3)).toEqual(gramSet('abc'));
  });

  it('yields three grams for a string of length n+2', () => {
    expect(shingles('abcde', 3)).toEqual(gramSet('abc', 'bcd', 'cde'));
    expect(shingles('abcd', 2)).toEqual(gramSet('ab', 'bc', 'cd'));
    expect(shingles('abcdef', 4)).toEqual(gramSet('abcd', 'bcde', 'cdef'));
  });

  it('is a SET: a repeated gram is counted once', () => {
    expect(shingles('ababab', 2)).toEqual(gramSet('ab', 'ba'));
  });

  it('windows over code points rather than UTF-16 units', () => {
    // Astral CJK. A `.slice()` over UTF-16 units would cut a surrogate pair in half and produce
    // grams that are not characters at all.
    expect(shingles('\u{20000}\u{20001}\u{20002}\u{20003}', 3))
      .toEqual(gramSet('\u{20000}\u{20001}\u{20002}', '\u{20001}\u{20002}\u{20003}'));
  });
});

describe('jaccard', () => {
  it('calls two empty sets identical and one empty set disjoint', () => {
    expect(jaccard(gramSet(), gramSet())).toBe(1);
    expect(jaccard(gramSet(), gramSet('a'))).toBe(0);
    expect(jaccard(gramSet('a'), gramSet())).toBe(0);
  });

  it('is 1 for identical sets and 0 for disjoint sets', () => {
    expect(jaccard(gramSet('a', 'b', 'c'), gramSet('a', 'b', 'c'))).toBe(1);
    expect(jaccard(gramSet('a', 'b'), gramSet('c', 'd'))).toBe(0);
  });

  it('is intersection over union for a partial overlap, in either argument order', () => {
    // shared {b, c} = 2; union {a, b, c, d} = 4.
    expect(jaccard(gramSet('a', 'b', 'c'), gramSet('b', 'c', 'd'))).toBe(0.5);
    expect(jaccard(gramSet('b', 'c', 'd'), gramSet('a', 'b', 'c'))).toBe(0.5);
    // shared {b} = 1; union {a, b, c, d, e} = 5.
    expect(jaccard(gramSet('a', 'b'), gramSet('b', 'c', 'd', 'e'))).toBe(0.2);
  });
});

describe('structuralSignature', () => {
  const template = (slot: string, day: string): string =>
    `高文瑞在議事廳說「${slot}」，並要求在第${day}天前回覆。`;

  it('is equal for two texts that differ only inside 「…」', () => {
    expect(structuralSignature(template('水道必須修好', '3')))
      .toBe(structuralSignature(template('橋面必須拆掉重來', '3')));
  });

  it('is equal for two texts that differ only in a number', () => {
    expect(structuralSignature(template('水道必須修好', '3')))
      .toBe(structuralSignature(template('水道必須修好', '14')));
  });

  it('is equal for two texts that differ only in identifiers it was given', () => {
    const identifiers = [YINGXUE, WENRUI];
    expect(structuralSignature(`${YINGXUE} 提出動議。`, identifiers))
      .toBe(structuralSignature(`${WENRUI} 提出動議。`, identifiers));
    // Not given the identifiers, the same two texts are two templates. This is why the evaluator
    // hands the world's id set to every comparison.
    expect(structuralSignature(`${YINGXUE} 提出動議。`))
      .not.toBe(structuralSignature(`${WENRUI} 提出動議。`));
  });

  it('collapses ASCII double quotes as well as 「…」', () => {
    expect(structuralSignature('He said "we vote today", then sat down.'))
      .toBe(structuralSignature('He said "we vote next week", then sat down.'));
  });

  it('differs when a clause outside the slots differs', () => {
    expect(structuralSignature(template('水道必須修好', '3')))
      .not.toBe(structuralSignature(`高文瑞在議事廳說「水道必須修好」，然後離席。`));
  });
});

describe('fnv1a64', () => {
  it('is a deterministic 16-hex-digit grouping key', () => {
    expect(fnv1a64('議事廳')).toBe(fnv1a64('議事廳'));
    expect(fnv1a64('議事廳')).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64('議事廳')).not.toBe(fnv1a64('議事聽'));
    expect(fnv1a64('')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('nearestEarlier', () => {
  /** Twenty distinct characters, so every trigram in the string is distinct too. */
  const BASE = 'abcdefghijklmnopqrst';
  /** BASE with the LAST character changed: exactly one of the eighteen trigrams differs. */
  const LAST_CHANGED = 'abcdefghijklmnopqrsZ';

  it('never charges the first text: index 0 has no earlier text to match', () => {
    expect(nearestEarlier([BASE, BASE], 0.8)[0]).toBeNull();
  });

  it('charges the LATER of two identical texts', () => {
    expect(nearestEarlier([BASE, BASE], 0.8)).toEqual([null, { index: 0, similarity: 1 }]);
  });

  it('returns null when the most similar earlier text is below the threshold', () => {
    // Sixteen of twenty characters replaced: far below 0.8, and below 0.5 too.
    expect(nearestEarlier([BASE, 'abcdZZZZZZZZZZZZZZZZ'], 0.8)[1]).toBeNull();
    expect(nearestEarlier([BASE, 'abcdZZZZZZZZZZZZZZZZ'], 0.5)[1]).toBeNull();
  });

  it('does not let the inverted-index pruning drop a match above the threshold', () => {
    // Eighteen trigrams each; one differs; shared 17, union 19. The evaluator's own
    // NEAR_DUPLICATE_SIMILARITY is 0.8, so this pair is exactly the kind of near-duplicate the
    // measure exists to catch, and a pruning bound tighter than 17 shared grams would lose it
    // silently — the ratio would simply come out lower with no error anywhere.
    const [, match] = nearestEarlier([BASE, LAST_CHANGED], 0.8);

    expect(match).not.toBeNull();
    expect(match?.index).toBe(0);
    expect(match?.similarity).toBeCloseTo(17 / 19, 10);
    expect(match!.similarity).toBeGreaterThan(0.8);
  });

  it('picks the most similar earlier text, not the earliest one above the threshold', () => {
    // `later` differs from `middle` in one character and from BASE in two, so both candidates
    // clear 0.8 and the nearer one is the LATER of the two.
    const middle = 'abcdefghijklmnopqrXY';
    const later = 'abcdefghijklmnopqrXZ';
    const [, first, second] = nearestEarlier([BASE, middle, later], 0.8);

    expect(first).toEqual({ index: 0, similarity: 0.8 });
    expect(second?.index).toBe(1);
    expect(second?.similarity).toBeCloseTo(17 / 19, 10);
  });

  it('breaks a tie toward the earliest index', () => {
    // Three identical texts: index 2 is equally similar to 0 and to 1, and must be charged
    // against the original rather than against the first copy, so re-running over a longer
    // window cannot change which scene a repeat points at.
    expect(nearestEarlier([BASE, BASE, BASE], 0.8)).toEqual([
      null,
      { index: 0, similarity: 1 },
      { index: 0, similarity: 1 },
    ]);
  });

  it('matches an empty text against an earlier empty text and nothing else', () => {
    expect(nearestEarlier(['', BASE, ''], 0.8)).toEqual([null, null, { index: 0, similarity: 1 }]);
    // An empty text has no grams, so it can never match prose, in either direction.
    expect(nearestEarlier([BASE, ''], 0.8)[1]).toBeNull();
    expect(nearestEarlier(['', BASE], 0.8)[1]).toBeNull();
  });

  it('honours the shingle size it is given', () => {
    // At size 3 both texts are shorter than the window, so each is a single gram and they are
    // disjoint. At size 2 they share 「ab」.
    expect(nearestEarlier(['abc', 'abd'], 0.3, 3)[1]).toBeNull();
    expect(nearestEarlier(['abc', 'abd'], 0.3, 2)[1]).toEqual({ index: 0, similarity: 1 / 3 });
  });

  it('returns one result per input, in input order', () => {
    expect(nearestEarlier([], 0.8)).toEqual([]);
    expect(nearestEarlier([BASE, 'zzzz', LAST_CHANGED], 0.8)).toHaveLength(3);
  });
});
