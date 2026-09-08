/**
 * Fire once when the end of an article actually reaches the viewport (§15 / ART-47).
 *
 * ## Why an observer rather than a timer or a scroll handler
 *
 * `episode_completed` has to mean something. The two cheap definitions both lie:
 *
 *  - **A timer.** "Read for 30 seconds" counts a tab left open in the background, and misses a
 *    fast reader entirely. It measures the browser, not the reader.
 *  - **A scroll listener.** It fires continuously, so it needs its own throttle, and on a short
 *    Episode that fits on one screen there is no scroll event at all — the completion that is
 *    most certainly true would be the one never recorded.
 *
 * An `IntersectionObserver` on a sentinel at the end of the content answers the actual question —
 * did the end of this Episode become visible — and answers it correctly in the no-scroll case,
 * because an element already in view intersects immediately.
 *
 * ## Where it does not work, said rather than hidden
 *
 * `IntersectionObserver` is absent in jsdom and in old browsers. The hook is a no-op there, so
 * `episode_completed` is UNDER-reported rather than approximated: a completion rate that fell
 * back to a timer would be a different metric wearing this one's name.
 */

import { useEffect, useRef } from 'react';

export function useEndOfContent(onReached: () => void): { ref: React.RefObject<HTMLDivElement> } {
  const ref = useRef<HTMLDivElement>(null);
  // Held in a ref so a re-rendered parent passing a fresh closure does not tear down and rebuild
  // the observer — which would re-fire on an element that was already visible.
  const handler = useRef(onReached);
  handler.current = onReached;

  useEffect(() => {
    const sentinel = ref.current;
    if (sentinel === null || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        // Disconnected before the callback, not after: the callback is the only thing that can
        // throw here, and an observer left connected through a throw would fire again on the
        // next scroll. The queue deduplicates the measurement anyway; this keeps the DOM tidy
        // rather than relying on that.
        observer.disconnect();
        handler.current();
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return { ref };
}
