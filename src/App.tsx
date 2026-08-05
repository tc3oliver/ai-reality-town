import ArcDetailPage from './components/public/ArcDetailPage.tsx';
import CharacterPage from './components/public/CharacterPage.tsx';
import EpisodeDetail from './components/public/EpisodeDetail.tsx';
import EpisodeList from './components/public/EpisodeList.tsx';
import Homepage from './components/public/Homepage.tsx';
import LiveView from './components/public/LiveView.tsx';
import TimelineView from './components/public/TimelineView.tsx';

// ART-112: the interactive a16z game route (join/move/chat, Interact and Freeze controls,
// the "join the town" help copy) has been retired -- Canon Simulation is the sole
// narrative source, and public visitors must never start or sustain a simulation. The bare
// route (no hash, previously the PixiJS game) now falls back to the public Homepage, the
// same as every other public entry point. Building the new read-only dynamic view is
// separate, later work (FR-N002/FR-N010), not this task.
export default function Home() {
  // Public newcomer-facing pages live behind a hash route (#episode/…,
  // #episodes/…, #home, #live/…). Public reads use the failure-isolated public read model
  // and trigger no generation (FR-I002/I003/I004 AC#5).
  if (typeof window !== 'undefined' && window.location.hash.startsWith('#episodes/')) {
    return <EpisodeList />;
  }
  if (typeof window !== 'undefined' && window.location.hash.startsWith('#episode/')) {
    return <EpisodeDetail />;
  }
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
  return <Homepage />;
}
