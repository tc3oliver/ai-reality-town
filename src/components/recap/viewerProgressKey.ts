/**
 * The opaque per-browser token the return recap keys device progress on (FR-H004 AC#3, ART-39).
 *
 * Modelled on {@link ../vote/voteDeviceKey.ts} and deliberately NOT the same value.
 *
 * ## Why this is a separate storage key rather than a reuse of `art45.voteDeviceKey`
 *
 * Sharing one token would make「這個裝置投了什麼」and「這個裝置讀到哪裡」the same column in two
 * tables, so a single join would produce a per-device profile linking a viewer's ballots to their
 * reading history. Neither feature needs that link and neither PRD clause asks for it, and PRD
 * §15's data-minimisation rule is precisely the instruction not to create it for the product's
 * own convenience. Two independent random tokens cost one extra `localStorage` entry and remove
 * the join entirely — the server never sees a value that appears on both surfaces.
 *
 * ## What this is, and what it deliberately is not
 *
 * A random string this browser made up, stored in `localStorage`, sent only when the viewer asks
 * the recap to read or record their progress. NOT a fingerprint, NOT derived from anything about
 * the device, NOT correlated with any other identifier. Clearing site data produces a new one and
 * loses the progress, which is an accepted property rather than a defect: FR-H004 AC#3 asks for
 * device-level progress WITHOUT LOGIN, and a value a browser can discard is exactly what that
 * means.
 *
 * It is a claim, not an identity. Anyone presenting this token is, to the deployment, this
 * viewer. The server-side isolation (`convex/viewer/viewerProgress.ts`) defeats accident and
 * enumeration and does not defeat a person holding someone else's token.
 *
 * Pure except for `localStorage` and `crypto`, both of which are passed in so the whole thing is
 * testable without a DOM.
 */

/** Matches the server's `PROGRESS_DEVICE_KEY_PATTERN`. Kept in sync by `viewerProgressKey.test.ts`. */
export const VIEWER_PROGRESS_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;

/** Distinct from `art45.voteDeviceKey` on purpose. See the §15 note above. */
export const VIEWER_PROGRESS_STORAGE_KEY = 'art39.viewerProgressKey';

/** The minimum surface this module needs, so a test can supply an object literal. */
export type ProgressKeyStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * Read the stored token, or mint and store a new one.
 *
 * A stored value that no longer matches the accepted shape is REPLACED rather than sent. The
 * server refuses a malformed key, so forwarding one would spend an attempt from this device's
 * budget on a submission that could never succeed — a browser with a corrupted entry would lock
 * itself out of recording progress until it cleared storage.
 */
export function resolveViewerProgressKey(store: ProgressKeyStore, randomId: () => string): string {
  const existing = store.getItem(VIEWER_PROGRESS_STORAGE_KEY);
  if (existing !== null && VIEWER_PROGRESS_KEY_PATTERN.test(existing)) return existing;
  const minted = normalizeProgressKey(randomId());
  store.setItem(VIEWER_PROGRESS_STORAGE_KEY, minted);
  return minted;
}

/**
 * Force a candidate token into the accepted shape.
 *
 * `crypto.randomUUID()` is the intended source and already conforms once lower-cased, but this
 * module must not depend on that: a fallback source in an older browser could produce anything,
 * and a key that fails the server's pattern is indistinguishable from an attack. Padding rather
 * than throwing keeps a low-entropy environment able to keep progress — the token's job is to
 * separate honest devices, and the server never treats it as proof of anything.
 */
export function normalizeProgressKey(candidate: string): string {
  const cleaned = candidate.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+/, '');
  const padded = cleaned.length >= 8 ? cleaned : `${cleaned}00000000`.slice(0, 8);
  return padded.slice(0, 64);
}

/**
 * Browser entry point. Returns `null` where storage is unavailable — a private-mode window that
 * throws on `localStorage` should render the recap in its no-progress state rather than crash the
 * page. Every caller must handle `null` by degrading, never by inventing a key: a per-render
 * random token would mint a new server row on every page load.
 */
export function browserViewerProgressKey(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? () => crypto.randomUUID()
      : () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    return resolveViewerProgressKey(window.localStorage, random);
  } catch {
    return null;
  }
}
