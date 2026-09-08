/**
 * The two opaque tokens analytics needs, and the argument for each (§15 / ART-47).
 *
 * ## Why an identifier exists here at all
 *
 * §15's data-minimisation rule and every instinct it encodes say not to identify a viewer. Two of
 * §16.1's eight metrics — 次日回訪率 and 七日回訪率 — are not computable without knowing that the
 * browser here on Tuesday is the one that was here on Monday. There is no aggregate substitute:
 * a return rate is a statement about a repeated individual, and a design with no stable key can
 * report visits and cannot report returns.
 *
 * So a key exists, and everything about it is chosen to be the least it can be:
 *
 *  - It is a random string this browser made up. NOT a fingerprint, NOT derived from anything
 *    about the device, NOT correlated with anything.
 *  - It is **digested before it is stored** (`convex/shared/opaqueDigest.ts`), so a leaked table
 *    does not hand anyone a value a browser is still presenting.
 *  - It is a THIRD token under a THIRD storage key, independent of `art45.voteDeviceKey` and
 *    `art39.viewerProgressKey`. Sharing one would make「這個裝置投了什麼」、「讀到哪裡」and
 *    「點了什麼」the same column in three tables, and one join would produce a per-device profile
 *    no clause of the PRD asks for. Three independent tokens cost two extra storage entries and
 *    remove the join entirely — the server never sees a value that appears on two surfaces.
 *  - Clearing site data produces a new one and loses the history, which is a property rather than
 *    a defect: a value a browser can discard is what「匿名」means here.
 *
 * ## Why the session token is separate, and why it is NOT persisted
 *
 * Every rate in §16.1 is per-visit, so the events of one visit have to be groupable. A session id
 * derived from the viewer key would make the grouping stable across visits, which is exactly what
 * it must not be. `sessionStorage` is the right store precisely because it forgets: a new tab is
 * a new session, and a closed browser leaves nothing behind.
 *
 * Pure except for the two storage objects and the random source, all of which are passed in so
 * the whole module is testable without a DOM.
 */

/** Matches the server's `ANALYTICS_KEY_PATTERN`. Pinned by `analyticsIdentity.test.ts`. */
export const ANALYTICS_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;

/** Distinct from `art45.voteDeviceKey` and `art39.viewerProgressKey`. See the §15 note above. */
export const ANALYTICS_VIEWER_STORAGE_KEY = 'art47.analyticsViewerKey';
export const ANALYTICS_SESSION_STORAGE_KEY = 'art47.analyticsSessionKey';

/** The minimum surface this module needs, so a test can supply an object literal. */
export type KeyStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * Force a candidate token into the accepted shape.
 *
 * `crypto.randomUUID()` is the intended source and already conforms once lower-cased, but this
 * must not depend on that: a fallback source in an older browser could produce anything, and a
 * key that fails the server's pattern is refused as if it were an attack. Padding rather than
 * throwing keeps a low-entropy environment able to report — the token separates honest browsers
 * and the server treats it as proof of nothing.
 */
export function normalizeAnalyticsKey(candidate: string): string {
  const cleaned = candidate.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+/, '');
  const padded = cleaned.length >= 8 ? cleaned : `${cleaned}00000000`.slice(0, 8);
  return padded.slice(0, 64);
}

function resolve(store: KeyStore, storageKey: string, randomId: () => string): string {
  const existing = store.getItem(storageKey);
  if (existing !== null && ANALYTICS_KEY_PATTERN.test(existing)) return existing;
  const minted = normalizeAnalyticsKey(randomId());
  store.setItem(storageKey, minted);
  return minted;
}

export type AnalyticsIdentity = {
  /** Stable across visits. Digested server-side; never stored raw. */
  deviceKey: string;
  /** New per tab session. The grouping key for every per-visit rate. */
  sessionToken: string;
};

export function resolveAnalyticsIdentity(
  persistent: KeyStore,
  perSession: KeyStore,
  randomId: () => string,
): AnalyticsIdentity {
  return {
    deviceKey: resolve(persistent, ANALYTICS_VIEWER_STORAGE_KEY, randomId),
    sessionToken: resolve(perSession, ANALYTICS_SESSION_STORAGE_KEY, randomId),
  };
}

/**
 * Browser entry point. `null` where storage is unavailable.
 *
 * A private-mode window that throws on `localStorage` must keep working and simply report
 * nothing — never invent a key. A per-render random token would mint a new server row and a new
 * "first session" on every page load, which would not merely lose the measurement, it would
 * fabricate one: every visit an acquisition, every retention rate zero.
 */
export function browserAnalyticsIdentity(): AnalyticsIdentity | null {
  try {
    if (typeof window === 'undefined') return null;
    const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? () => crypto.randomUUID()
      : () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    return resolveAnalyticsIdentity(window.localStorage, window.sessionStorage, random);
  } catch {
    return null;
  }
}
