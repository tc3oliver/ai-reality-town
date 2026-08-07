/**
 * "Has this replay already auto-played?" (FR-O013 AC#5, client-only).
 *
 * ## Why `sessionStorage`, and why the client at all
 *
 * AC#5 says *per viewing session*. This architecture has no server-side session and no viewer
 * identity — that is the point of `docs/public-read-only-guarantee.md`, and inventing one so
 * that a replay could remember itself would be a far larger concession than the feature is
 * worth. A browser tab's lifetime IS the viewing session a viewer would recognise, and
 * `sessionStorage` is scoped to exactly that: it clears when the tab closes, so tomorrow's
 * visit legitimately auto-plays again. `localStorage` would outlive the session and suppress
 * a replay the viewer never saw.
 *
 * The key embeds the `replayId`, which embeds the highest replayed Canon sequence number. So
 * a newly completed slot produces a new id, and its replay auto-plays once on its own merits
 * rather than being suppressed by the previous one's mark.
 *
 * ## Fail closed
 *
 * Every failure path answers "already played". Safari private mode throws on write, jsdom has
 * no `sessionStorage` at all, and a storage quota can be exhausted at any moment — in each
 * case auto-playing would be auto-playing *repeatedly*, because the mark that was supposed to
 * stop the second one could not be recorded. {@link hasAutoPlayed} therefore probes
 * writability before answering `false`: a storage that cannot be written to cannot hold the
 * mark, so the honest answer is that auto-play is unavailable. The manual replay button is
 * unaffected and remains the way a viewer sees the replay in that case.
 */

/** The narrow slice of the Storage API this module uses, so a test can supply its own. */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const KEY_PREFIX = 'ai-reality-town:replay:autoplayed:';

/**
 * Written by the writability probe. A single fixed key rather than one per replay, so the
 * probe costs one slot for the life of the tab however many replays a viewer sees.
 */
const PROBE_KEY = 'ai-reality-town:replay:probe';

const MARK = '1';

function markKey(replayId: string): string {
  return `${KEY_PREFIX}${replayId}`;
}

/**
 * The tab's session storage, or `null` where there is none.
 *
 * Reading the global is wrapped: a browser configured to block storage throws on *access*,
 * not merely on use, and an uncaught throw here would take the whole live map down over a
 * feature the viewer can still trigger by hand.
 */
export function replaySessionStorage(): StorageLike | null {
  try {
    const candidate = (globalThis as { sessionStorage?: StorageLike | null }).sessionStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether this replay has already auto-played in this viewing session.
 *
 * `true` on every uncertainty, including a storage that exists but refuses to be written to —
 * see the module header. "At most once" can therefore be violated only by a caller that
 * ignores this answer, never by the environment.
 */
export function hasAutoPlayed(replayId: string, storage: StorageLike | null): boolean {
  if (!storage || replayId.length === 0) return true;
  try {
    if (storage.getItem(markKey(replayId)) !== null) return true;
    storage.setItem(PROBE_KEY, MARK);
    return false;
  } catch {
    return true;
  }
}

/** Record the auto-play. A storage that refuses the write is already handled above. */
export function markAutoPlayed(replayId: string, storage: StorageLike | null): void {
  if (!storage || replayId.length === 0) return;
  try {
    storage.setItem(markKey(replayId), MARK);
  } catch {
    // Nothing to do and nothing to report: `hasAutoPlayed` probes the same write and has
    // already answered `true` for this storage, so the auto-play this failed to record
    // could not have happened.
  }
}
