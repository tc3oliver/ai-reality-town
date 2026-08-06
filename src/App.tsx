import ArcDetailPage from './components/public/ArcDetailPage.tsx';
import CharacterPage from './components/public/CharacterPage.tsx';
import EpisodeDetail from './components/public/EpisodeDetail.tsx';
import EpisodeList from './components/public/EpisodeList.tsx';
import HelpPage from './components/public/HelpPage.tsx';
import Homepage from './components/public/Homepage.tsx';
import LiveView from './components/public/LiveView.tsx';
import { OperatorEntry } from './components/public/OperatorEntry.tsx';
import TimelineView from './components/public/TimelineView.tsx';

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
// any in-world capability. The read-only renderer itself lives in `components/world/` and
// is composed onto a page by FR-O001, not here.
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
  // #episodes/…, #home, #live/…). Public reads use the failure-isolated public read model
  // and trigger no generation (FR-I002/I003/I004 AC#5).
  if (typeof window !== 'undefined' && window.location.hash.startsWith('#episodes/')) {
    return <EpisodeList />;
  }
  if (typeof window !== 'undefined' && window.location.hash.startsWith('#episode/')) {
    return <EpisodeDetail />;
  }
  // NFR-009 AC#3: the text Live View is the non-map equivalent of the animated world and
  // stays reachable at this route through the renderer refactor (ART-135 owns its
  // eventual replacement).
  if (typeof window !== 'undefined' && window.location.hash.startsWith('#live/')) {
    return <LiveView />;
  }
  if (typeof window !== 'undefined' && window.location.hash.startsWith('#character/')) {
    return <CharacterPage />;
  }
  if (typeof window !== 'undefined' && window.location.hash.startsWith('#timeline/')) {
    return <TimelineView />;
  }
  if (typeof window !== 'undefined' && window.location.hash.startsWith('#arc/')) {
    return <ArcDetailPage />;
  }
  if (typeof window !== 'undefined' && window.location.hash.startsWith('#help')) {
    return <HelpPage />;
  }
  return <Homepage />;
}
