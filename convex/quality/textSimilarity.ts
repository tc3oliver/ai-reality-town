/**
 * Text similarity for the narrative evaluator (FR-M002, ART-88). Pure: no I/O, no clock, no
 * randomness, no node builtin, so it runs inside a Convex query and inside the harness alike.
 *
 * ## Why a similarity and not only a digest
 *
 * ART-60 measured repetition as EXACT content-digest collisions, and the human review (D6)
 * recorded the gap in one line: "a human catches paraphrase and template reuse that a digest
 * treats as distinct." Two scenes that differ in one slot of a template are the same scene to a
 * reader. So the evaluator needs a graded measure, and this module is it.
 *
 * ## The three operations
 *
 *  1. **Normalisation** ({@link normalizeNarrative}). Entity identifiers (character ids, location
 *     ids, arc ids) are masked to a fixed token, digits are masked, whitespace and punctuation are
 *     dropped. Identifiers are unique by construction and would make every scene at a different
 *     place trivially distinct — the same reason ART-60's digest excluded them. Masking rather than
 *     deleting keeps the sentence's shape.
 *  2. **Character 3-gram shingles + Jaccard** ({@link shingles}, {@link jaccard}). Character
 *     n-grams because the prose is zh-Hant, where "words" are not whitespace-delimited; three is
 *     the smallest window at which two unrelated sentences stop sharing most of their grams.
 *  3. **Structural signature** ({@link structuralSignature}). The normalised text with every
 *     quoted span 「…」 and every masked slot collapsed: what remains is the TEMPLATE. Two scenes
 *     with one signature were written from one mould, however different the words in the slots.
 *
 * ## Thresholds live in the evaluator, not here
 *
 * This module returns numbers. What counts as "near-duplicate" is a metric definition and is
 * versioned with the evaluator that owns it.
 */

const IDENTIFIER_TOKEN = '';
const NUMBER_TOKEN = '';
const QUOTE_TOKEN = '';

/** Longest identifier first, so `mistwood-hall-annex` is masked before `mistwood-hall`. */
function byLengthDesc(values: Iterable<string>): string[] {
  return [...new Set(values)].filter((value) => value.length > 0).sort((left, right) => right.length - left.length || left.localeCompare(right));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Mask identifiers and digits, drop whitespace and punctuation. Deterministic and idempotent.
 */
export function normalizeNarrative(text: string, identifiers: Iterable<string> = []): string {
  let normalized = text;
  for (const identifier of byLengthDesc(identifiers)) {
    normalized = normalized.replace(new RegExp(escapeRegExp(identifier), 'g'), IDENTIFIER_TOKEN);
  }
  normalized = normalized.replace(/[0-9０-９]+/g, NUMBER_TOKEN);
  // Whitespace and punctuation carry no narrative content; two sentences that differ only in a
  // comma are one sentence.
  normalized = normalized.replace(/[\s\p{P}]+/gu, '');
  return normalized;
}

/** Character n-gram shingles of an already-normalised string. Shorter inputs yield the whole string. */
export function shingles(normalized: string, size = 3): Set<string> {
  const grams = new Set<string>();
  const characters = [...normalized];
  if (characters.length === 0) return grams;
  if (characters.length <= size) {
    grams.add(characters.join(''));
    return grams;
  }
  for (let index = 0; index + size <= characters.length; index += 1) {
    grams.add(characters.slice(index, index + size).join(''));
  }
  return grams;
}

/** Jaccard similarity in [0, 1]. Two empty sets are identical (1); one empty set is disjoint (0). */
export function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const gram of small) if (large.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * The template a normalised text was written from: quoted spans and masked slots collapsed to
 * single tokens. Two texts with one signature are one template.
 */
export function structuralSignature(text: string, identifiers: Iterable<string> = []): string {
  let masked = text;
  for (const identifier of byLengthDesc(identifiers)) {
    masked = masked.replace(new RegExp(escapeRegExp(identifier), 'g'), IDENTIFIER_TOKEN);
  }
  masked = masked
    .replace(/「[^」]*」/g, QUOTE_TOKEN)
    .replace(/"[^"]*"/g, QUOTE_TOKEN)
    .replace(/[0-9０-９]+/g, NUMBER_TOKEN)
    .replace(/\s+/g, '');
  return fnv1a64(masked);
}

function fnv1a(value: string, offsetBasis: number): number {
  let hash = offsetBasis >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** 64-bit FNV-1a as two seeded 32-bit passes; a grouping key, not a secret. */
export function fnv1a64(value: string): string {
  const low = fnv1a(value, 0x811c9dc5).toString(16).padStart(8, '0');
  const high = fnv1a(value, 0x811c9dc5 ^ 0x5bf03635).toString(16).padStart(8, '0');
  return `${high}${low}`;
}

export type SimilarityMatch = { index: number; similarity: number };

/**
 * For every text, the most similar EARLIER text at or above `minimumSimilarity`, if any.
 *
 * Earlier means lower index: the caller orders texts by accepted sequence, so a repeat is charged
 * to the later scene and an original is never charged for being repeated. An inverted index over
 * shingles prunes candidates to texts sharing at least `minimumSharedShingles` grams, which keeps
 * a 90-day run's dialogue lines (thousands) tractable without changing the answer for any pair
 * that could reach the threshold.
 */
export function nearestEarlier(
  normalizedTexts: readonly string[],
  minimumSimilarity: number,
  size = 3,
): Array<SimilarityMatch | null> {
  const shingleSets = normalizedTexts.map((text) => shingles(text, size));
  const postings = new Map<string, number[]>();
  const results: Array<SimilarityMatch | null> = [];
  for (let index = 0; index < shingleSets.length; index += 1) {
    const grams = shingleSets[index];
    // A pair at Jaccard >= s over sets of sizes a and b shares at least s * max(a, b) / (1 + s)
    // grams... a loose but safe bound is s * a / (1 + s) with a = this set's size, because
    // shared <= min(a, b) and shared / (a + b - shared) >= s implies shared >= s * a / (1 + s).
    const minimumShared = Math.max(1, Math.ceil((minimumSimilarity * grams.size) / (1 + minimumSimilarity)));
    const counts = new Map<number, number>();
    for (const gram of grams) {
      const earlier = postings.get(gram);
      if (!earlier) continue;
      for (const candidate of earlier) counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
    }
    let best: SimilarityMatch | null = null;
    for (const [candidate, shared] of counts) {
      if (shared < minimumShared) continue;
      const similarity = jaccard(grams, shingleSets[candidate]);
      if (similarity >= minimumSimilarity && (best === null || similarity > best.similarity
          || (similarity === best.similarity && candidate < best.index))) {
        best = { index: candidate, similarity };
      }
    }
    // Empty texts: identical to an earlier empty text, and to nothing else.
    if (grams.size === 0) {
      const earlierEmpty = normalizedTexts.findIndex((text, at) => at < index && text.length === 0);
      best = earlierEmpty >= 0 ? { index: earlierEmpty, similarity: 1 } : null;
    }
    results.push(best);
    for (const gram of grams) {
      const list = postings.get(gram);
      if (list) list.push(index);
      else postings.set(gram, [index]);
    }
  }
  return results;
}
