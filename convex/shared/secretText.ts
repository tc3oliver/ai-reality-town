/**
 * The one rule for 「這段文字有沒有把某個秘密講出來」 (ART-169).
 *
 * It already existed, twice, in two modules that may not import each other:
 *
 *  - `convex/quality/continuity.ts` scans a publication's text for secret and private-fact
 *    values, and asks whether one of the cited events made that value public
 *    (`sourcedByCitedEvent`).
 *  - `convex/editorial/episode.ts` refuses an Episode whose text contains an unpublished secret.
 *
 * ART-169 needs the SAME question a third time — a viewer knows a secret exactly when a published
 * event said it out loud — and a third copy is how the three would start to disagree about which
 * strings count. So the primitive lives here, in `shared`, which every one of them may depend on.
 *
 * ## What is deliberately NOT unified
 *
 * The three callers apply different POLICY around the same primitive, and that is correct rather
 * than accidental:
 *
 *  - `continuity` accepts only `visibility === 'public'` as a source, because it is looking for
 *    leaks and a stricter source rule flags more of them.
 *  - `episode.ts` lowercases the haystack before matching, because it is scanning generated prose
 *    rather than a stored fact value.
 *  - The viewer-known-secret projection (`convex/publicRead/viewerKnowledgeProjection.ts`) uses
 *    `continuity`'s rule exactly, for the reason that matters most on a public surface: it can
 *    only ever UNDER-report a secret as viewer-known, never over-report one.
 *
 * Folding those three policies into one flag would make the shared function harder to read than
 * the three call sites it replaced. What is shared is the part that must not drift: the minimum
 * needle length, and what "contains" means.
 */

/**
 * Shortest secret or private value worth scanning for.
 *
 * Below this, a "secret" is ambient text: a three-character string will appear inside unrelated
 * prose by accident, and every publication in the world would be reported as leaking it. The
 * value is a scan floor, not a claim that short secrets are safe — a world configured with one
 * is misconfigured, and `tensionReadiness` is where that is caught.
 */
export const MIN_SECRET_NEEDLE_LENGTH = 4;

/**
 * Whether `value` quotes `needle` outright.
 *
 * `value` is `unknown` because every caller reads it out of an untyped store: a Canon
 * `fact_created` change's `value` is `string | number | boolean`, and a `worldSecrets` payload is
 * `v.any()`. A non-string cannot quote anything, so it is not a special case to handle — it is
 * simply `false`.
 */
export function quotesSecret(value: unknown, needle: string): boolean {
  if (typeof value !== 'string') return false;
  if (needle.length < MIN_SECRET_NEEDLE_LENGTH) return false;
  return value.includes(needle);
}
