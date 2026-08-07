import { useEffect } from 'react';

import { LiveMapErrorBoundary } from './components/live/LiveMapErrorBoundary.tsx';
import LiveMapPage from './components/live/LiveMapPage.tsx';
import { parseLiveMapPath, redirectForLegacyHash } from './components/live/liveMapRoute.ts';
import ArcDetailPage from './components/public/ArcDetailPage.tsx';
import CharacterPage from './components/public/CharacterPage.tsx';
import EpisodeDetail from './components/public/EpisodeDetail.tsx';
import EpisodeList from './components/public/EpisodeList.tsx';
import HelpPage from './components/public/HelpPage.tsx';
import Homepage from './components/public/Homepage.tsx';
import LiveView from './components/public/LiveView.tsx';
import { OperatorEntry } from './components/public/OperatorEntry.tsx';
import TimelineView from './components/public/TimelineView.tsx';

/** Deployment path prefix (`/ai-town/`). Vite inlines this at build time. */
const BASE = import.meta.env.BASE_URL;

// ART-112: the interactive a16z game route (join/move/chat, Interact and Freeze controls,
// the "join the town" help copy) has been retired -- Canon Simulation is the sole
// narrative source, and public visitors must never start or sustain a simulation. The bare
// route (no hash, previously the PixiJS game) now falls back to the public Homepage, the
// same as every other public entry point.
//
// ART-113 (FR-N002): the public surface is watch-only and now says so. `#help` carries the
// rewritten guide -- watching, navigating, character cards, scenes, episodes and replay,
// with no joining, controlling or chatting -- and the Clerk sign-in entry point returns as
// {@link OperatorEntry}, which authenticates operators (ART-105) without offering anyone
// any in-world capability.
//
// ART-118 (FR-O001 AC#8): the live world is a real path, `<base>/live/<worldId>`, with the
// text Live View as its `/text` sibling. Path routes are checked before the hash switch,
// and the legacy `#live/<worldId>` hash redirects to the map with its world identifier
// intact.
export default function Home() {
  return (
    <>
      <OperatorEntry />
      <PublicRoute />
    </>
  );
}

function PublicRoute() {
  // Public newcomer-facing pages live behind a hash route (#episode/…,
  // #episodes/…, #home). Public reads use the failure-isolated public read model
  // and trigger no generation (FR-I002/I003/I004 AC#5).
  if (typeof window === 'undefined') return <Homepage />;

  const liveRoute = parseLiveMapPath(window.location.pathname, BASE);
  if (liveRoute !== null) {
    // NFR-009 AC#3: the text Live View is the non-map equivalent of the animated
    // world and stays reachable, now as the map route's sibling.
    if (liveRoute.view === 'text') return <LiveView worldId={liveRoute.worldId} />;
    // The boundary wraps the page rather than living inside it: `useQuery` throws
    // when the deployment is unavailable, and a read that fails above the
    // boundary would leave a blank page instead of the text view.
    return (
      <LiveMapErrorBoundary worldId={liveRoute.worldId} base={BASE}>
        <LiveMapPage worldId={liveRoute.worldId} base={BASE} />
      </LiveMapErrorBoundary>
    );
  }

  const legacyLive = redirectForLegacyHash(window.location.hash, BASE);
  if (legacyLive !== null) return <LegacyLiveRedirect href={legacyLive} />;

  if (window.location.hash.startsWith('#episodes/')) {
    return <EpisodeList />;
  }
  if (window.location.hash.startsWith('#episode/')) {
    return <EpisodeDetail />;
  }
  if (window.location.hash.startsWith('#character/')) {
    return <CharacterPage />;
  }
  if (window.location.hash.startsWith('#timeline/')) {
    return <TimelineView />;
  }
  if (window.location.hash.startsWith('#arc/')) {
    return <ArcDetailPage />;
  }
  if (window.location.hash.startsWith('#help')) {
    return <HelpPage />;
  }
  return <Homepage />;
}

/**
 * Sends `#live/<worldId>` to the canonical map path (FR-O001 AC#8).
 *
 * `replace` rather than `assign`, so the retired hash does not sit in the back
 * stack and bounce a viewer who presses Back. The redirect runs in an effect
 * rather than during render because navigating is a side effect, and the notice
 * below is what a viewer sees if it is slow or blocked.
 */
function LegacyLiveRedirect({ href }: { href: string }) {
  useEffect(() => {
    window.location.replace(href);
  }, [href]);

  return (
    <div lang="zh-Hant" className="public-page mx-auto max-w-2xl p-4 font-body">
      <main className="mt-3">
        <h1 className="text-3xl font-bold">實況已搬家</h1>
        <p className="mt-2">
          正在前往新的實況網址。若沒有自動跳轉,請點<a href={href}>這裡開啟實況地圖</a>。
        </p>
      </main>
    </div>
  );
}
