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
 * ## Where the cut may land (ART-183)
 *
 * This docblock used to say word boundaries are deliberately NOT respected, because Chinese has
 * none and a rule that only worked for the space-separated half of the content would cut CJK at
 * an arbitrary point anyway. The first half of that is right and still governs the CJK case. The
 * conclusion was wrong: it treated "cannot help every script" as a reason to help none, and the
 * live site published `Press the matter of "Digitize the surviving archives." at mistwoo…` —
 * a cut four letters into a place name, which reads as a typo rather than as an omission.
 *
 * So the rule is asymmetric, matching the scripts rather than pretending they are alike:
 *
 * - Inside a run of Latin letters or digits, back off to the start of that run. A token there is
 *   a unit a reader can see; half of one is noise.
 * - Anywhere else — between CJK characters, at punctuation, at a space — cut where the budget
 *   ran out. This is the original behaviour, and for CJK it remains the only honest option.
 *
 * Backing off never yields an empty string while content exists: if the run reaches all the way
 * back to the start, the cut stands rather than discarding everything (see {@link safeCutIndex}).
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
  return `${trimmed.slice(0, safeCutIndex(trimmed, budget)).trimEnd()}${PUBLIC_TRUNCATION_SUFFIX}`;
}

/** A Latin letter or a digit — the characters that form a token a cut can visibly break. */
const TOKEN_CHARACTER = /[A-Za-z0-9]/;

/**
 * How far back the cut may move to avoid splitting a token.
 *
 * Bounded, and the bound is the whole design rather than a guard. A real word is short, so 16
 * characters is more than enough to reach the start of one. A run LONGER than that is not a word
 * a reader would recognise — it is an identifier, a URL, or machine output — and giving up its
 * content to protect it is the worse trade: `shareFormats` composes a 60-character card from a
 * 300-character unbroken run, and an unbounded back-off returned SEVEN characters of it.
 *
 * So: short token, back off; long run, cut where the budget ran out.
 */
const MAX_TOKEN_BACKOFF = 16;

/**
 * Where to cut so the tail is not half a Latin word.
 *
 * Only backs off when the cut would land INSIDE a token, which means both the last kept character
 * and the first dropped character are token characters. A cut whose next character is a space, a
 * quote, a full stop or a CJK ideograph is already on a boundary and is left alone — that is the
 * CJK path, and it is the common one here.
 *
 * Returns `budget` unchanged in the two cases where backing off would cost more than it saves:
 * when the token starts at the very beginning of the text, and when it is longer than
 * {@link MAX_TOKEN_BACKOFF}. Cutting mid-token is bad; returning an ellipsis with almost no
 * content is worse, because it tells the reader nothing about what was there.
 */
export function safeCutIndex(text: string, budget: number): number {
  if (budget <= 0 || budget >= text.length) return budget;
  if (!TOKEN_CHARACTER.test(text[budget - 1]) || !TOKEN_CHARACTER.test(text[budget])) return budget;
  const floor = Math.max(0, budget - MAX_TOKEN_BACKOFF);
  let index = budget;
  while (index > floor && TOKEN_CHARACTER.test(text[index - 1])) index -= 1;
  return index === 0 || index === floor ? budget : index;
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
