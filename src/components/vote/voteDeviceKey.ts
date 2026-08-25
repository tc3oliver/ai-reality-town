/**
 * The opaque per-browser token the daily ballot rate-limits on (FR-J001 AC#2, ART-45).
 *
 * ## What this is, and what it deliberately is not
 *
 * It is a random string this browser made up, stored in `localStorage`, sent only when a vote is
 * cast. It is NOT a fingerprint, NOT derived from anything about the device, and NOT correlated
 * with any other identifier. Clearing site data produces a new one, and that is an accepted
 * property rather than a defect: the requirement is 「每個裝置每日投票次數受限」, and a limit a
 * determined person can reset is still a limit on everyone who does not.
 *
 * The rejected alternative was a real device fingerprint (canvas, fonts, screen metrics). It
 * would resist rotation better, and it would have made the ballot the one place in a product
 * with an explicit data-minimisation rule (§15) that collects something the viewer did not
 * choose to give. A weaker control with no privacy cost beat a stronger one with a large one,
 * and the server-side attempt budget carries what the token cannot.
 *
 * Pure except for `localStorage` and `crypto`, both of which are passed in so the whole thing is
 * testable without a DOM.
 */

/** Matches the server's `DEVICE_KEY_PATTERN`. Kept in sync by `voteDeviceKey.test.ts`. */
export const VOTE_DEVICE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;

const STORAGE_KEY = 'art45.voteDeviceKey';

/** The minimum surface this module needs, so a test can supply an object literal. */
export type KeyStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * Read the stored token, or mint and store a new one.
 *
 * A stored value that no longer matches the accepted shape is REPLACED rather than sent. The
 * server refuses a malformed key, so forwarding one would spend an attempt from this device's
 * budget on a submission that could never succeed — a browser with a corrupted entry would lock
 * itself out of voting until it cleared storage.
 */
export function resolveVoteDeviceKey(store: KeyStore, randomId: () => string): string {
  const existing = store.getItem(STORAGE_KEY);
  if (existing !== null && VOTE_DEVICE_KEY_PATTERN.test(existing)) return existing;
  const minted = normalizeDeviceKey(randomId());
  store.setItem(STORAGE_KEY, minted);
  return minted;
}

/**
 * Force a candidate token into the accepted shape.
 *
 * `crypto.randomUUID()` is the intended source and already conforms once lower-cased, but this
 * module must not depend on that: a fallback source in an older browser could produce anything,
 * and a key that fails the server's pattern is indistinguishable from an attack. Padding rather
 * than throwing keeps a low-entropy environment able to vote — the token's job is to separate
 * honest devices, and the server never treats it as proof of anything.
 */
export function normalizeDeviceKey(candidate: string): string {
  const cleaned = candidate.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+/, '');
  const padded = cleaned.length >= 8 ? cleaned : `${cleaned}00000000`.slice(0, 8);
  return padded.slice(0, 64);
}

/**
 * Browser entry point. Returns `null` where storage is unavailable — a private-mode window that
 * throws on `localStorage` should render the ballot read-only rather than crash the homepage.
 */
export function browserVoteDeviceKey(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? () => crypto.randomUUID()
      : () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    return resolveVoteDeviceKey(window.localStorage, random);
  } catch {
    return null;
  }
}
