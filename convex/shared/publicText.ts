/**
 * Shortening already-published text for a public hint (FR-O004 / ART-123 AC#4).
 *
 * In `shared` because both sides need the SAME answer: the server decides what a scene's public
 * summary says, and the client decides how much of it fits beside a character. Two truncation
 * rules would mean the card and the map disagree about where a sentence ends, which is the kind
 * of difference nobody notices until a hint reads as a different claim from the summary it came
 * from.
 *
 * ## What this is NOT for
 *
 * This never shortens private text, because it is never given any. The only input is a
 * `publicSummary` that has already passed the safety gate and the withhold substitution — see
 * `conversationState.ts` for why the hint is derived from the published summary rather than
 * carried as a second field.
 *
 * Pure: no clock, no randomness, no I/O.
 */

/**
 * How long a public hint may be.
 *
 * Sized for the scene panel and the character card, which is where hints are rendered — the
 * canvas draws no text at all (see `conversationState.ts`). Long enough for a clause, short
 * enough that it cannot become a paragraph on a phone.
 */
export const MAX_PUBLIC_CONVERSATION_HINT_LENGTH = 48;

/** Appended when text was cut, so a reader can tell a shortened line from a complete one. */
export const PUBLIC_TRUNCATION_SUFFIX = '…';

/**
 * Shorten to at most `maxLength` INCLUDING the ellipsis.
 *
 * Counting the suffix inside the budget rather than outside it: a caller that sized a column for
 * 48 characters means 48 rendered characters, and the version that appends after truncating
 * quietly returns 49. Off-by-one in the direction of overflow is how a hint pushes a card wider
 * on the one screen size nobody tested.
 *
 * Word boundaries are deliberately NOT respected. Chinese does not have them, and a rule that
 * only worked for the space-separated half of the content would cut CJK at an arbitrary point
 * anyway while looking correct in review.
 *
 * Returns `''` for empty or whitespace-only input, which is what a withheld scene's summary is —
 * so a withheld scene produces an empty hint BY CONSTRUCTION rather than by a second check.
 */
export function truncateForPublic(
  text: string,
  maxLength: number = MAX_PUBLIC_CONVERSATION_HINT_LENGTH,
): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';
  if (maxLength <= 0) return '';
  if (trimmed.length <= maxLength) return trimmed;
  // `maxLength` of 1 leaves no room for content beside the ellipsis, so the ellipsis alone is
  // the honest answer: something was here, and none of it fits.
  const budget = Math.max(0, maxLength - PUBLIC_TRUNCATION_SUFFIX.length);
  return `${trimmed.slice(0, budget).trimEnd()}${PUBLIC_TRUNCATION_SUFFIX}`;
}

/**
 * Count CJK Unified Ideograph characters — this project's length unit is 中文字 (FR-G003).
 *
 * In `shared` for exactly the reason {@link truncateForPublic} above is: the server enforces the
 * recap-format length bands with it (`convex/recaps/recapFormats.ts`, which re-exports this) and
 * the client caps a return-recap line with it (`src/components/recap/returnRecap.ts`). Two
 * implementations would mean the two sides disagreed about how long a sentence is.
 *
 * It moved here from `recapFormats.ts` when ART-39 needed it client-side. Importing it from
 * there would have given `src/components/recap` a dependency on the whole `editorial` module —
 * whose roots also cover `convex/recaps`, four of whose files register an `internalMutation` —
 * to reuse five lines with no imports of their own. That is a boundary bought for a helper, and
 * `shared` is what the repo already uses instead.
 *
 * Counts code POINTS in the CJK Unified Ideographs block only: Latin letters, digits, spaces and
 * punctuation are deliberately not counted, because the bands the PRD states are stated in 中文字.
 */
export function countChineseCharacters(text: string): number {
  if (typeof text !== 'string') return 0;
  const matches = text.match(/[一-鿿]/g);
  return matches ? matches.length : 0;
}
