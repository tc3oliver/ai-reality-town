/**
 * The value stored in place of a browser-minted token (§15 data minimisation).
 *
 * Extracted from {@link ../viewer/environmentVote.ts}, where ART-45 wrote it, because ART-47's
 * analytics ingest needs the SAME construction for a third independent token and `analytics` may
 * not depend on `viewer`. Copying it would have produced two digests that could drift, and a
 * drift here is invisible: both sides would still produce well-formed hex.
 *
 * NON-CRYPTOGRAPHIC, and named a digest rather than a hash for that reason. It is not defending a
 * secret — the input is a random string a browser generated for one purpose and that means
 * nothing anywhere else. What it buys is that a leaked row does not hand anyone the value a
 * browser is still presenting, so a stolen table cannot be replayed against the live surface.
 *
 * Two independently seeded passes are concatenated for **64 bits**, not for strength. A single
 * 32-bit pass collides with near-certainty across the row counts these tables reach, and a
 * collision does not leak anything — it silently merges two strangers' budgets, or two strangers'
 * retention. Correctness, not secrecy, is what sets the width.
 *
 * Pure: no clock, no randomness, no I/O.
 */

/** Stable, order-independent fingerprint. Same construction the simulation layer uses. */
export function fingerprint(value: string, seed = 2166136261): number {
  let hash = seed;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 64 bits of `value`, as `fnv1a64:<16 hex digits>`. Never the input itself. */
export function opaqueDigest(value: string): string {
  const low = fingerprint(value).toString(16).padStart(8, '0');
  const high = fingerprint(value, 0x811c9dc5 ^ 0x5bf03635).toString(16).padStart(8, '0');
  return `fnv1a64:${high}${low}`;
}
