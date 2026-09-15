/**
 * The current `location.hash`, kept in sync with the browser (ART-192).
 *
 * Extracted from `RelationshipGraphView.tsx`, which wrote it for itself under ART-44 and was for a
 * long time the only public surface that worked. Its docblock stated the rule, and stated it half
 * wrong:
 *
 * > Every other public page reads `window.location.hash` once during render and gets away with it,
 * > because none of them links to a DIFFERENT hash of the SAME route — following a link from
 * > `#arc/…` to `#character/…` re-enters `PublicRoute` through a different branch and remounts.
 *
 * The first clause is right. The second is not: re-entering `PublicRoute` requires `PublicRoute` to
 * render again, and a hash link fires no navigation and reloads nothing, so React was never told
 * anything had changed. Following ANY public link moved the address bar and left the page where it
 * was — the home page's character links, an Episode's related lists, the timeline's
 * 「查看本日故事」, the Episode page's 上一集 and 下一集, the recommended-episode call to action,
 * and 返回首頁 in the shared frame. The graph page worked because it subscribed; nothing else did.
 *
 * The defect survived a full browser suite because every spec navigates with `page.goto()`, a full
 * load, and a full load reads the hash correctly. Only following a link reproduces it.
 *
 * `subscribe` is registered in an effect — never during render — and torn down with the component,
 * so no listener outlives the page.
 */

import { useEffect, useState } from 'react';

export function useLocationHash(): string {
  const [hash, setHash] = useState(() => (typeof window === 'undefined' ? '' : window.location.hash));
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    // Read once more on mount: the hash can have changed between the initial state and the
    // listener being attached, and a page that missed that would be stale from its first paint.
    onHashChange();
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return hash;
}
