/**
 * What the Episode page's navigation actually renders (ART-189).
 *
 * `episodeNeighbours.test.ts` pins the rule; this pins that the page OBEYS it. A pure function
 * that returns `next: null` proves nothing on its own — the defect was a component that never
 * asked, and a component that asked and then rendered the button anyway would be the same defect
 * with better arithmetic behind it.
 *
 * A `dom` test rather than an addition to the a11y suite, which renders through
 * `renderToStaticMarkup` where no effect runs: these are claims about rendered controls and their
 * labels, and `disabled`/absence is exactly the kind of thing a markup snapshot reads past.
 */

import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { EpisodeDetailView, type EpisodeProjection } from './EpisodeDetail';
import { episodeNeighbours } from './episodeNeighbours';

const WORLD_ID = 'mistwood';
const PUBLISHED = [
  { worldDay: 1, episodeNumber: 1 },
  { worldDay: 2, episodeNumber: 2 },
  { worldDay: 5, episodeNumber: 3 },
];

const EPISODE: EpisodeProjection = {
  episodeNumber: 3,
  worldDay: 5,
  title: '世界第 5 天',
  headline: '審計被要求公開。',
  oneLineSummary: '審計被要求公開。',
  keyScenes: [],
  relationshipChanges: [],
  newQuestions: [],
  resolvedQuestions: [],
  arcIds: [],
  characterIds: [],
  nextEpisodeTease: '',
};

let container: HTMLElement;
let root: Root;

function mount(worldDay: number): HTMLElement {
  act(() => {
    root.render(
      <EpisodeDetailView
        worldId={WORLD_ID}
        worldDay={worldDay}
        episode={{ ...EPISODE, worldDay }}
        neighbours={episodeNeighbours(worldDay, PUBLISHED)}
        onNavigate={() => {}}
      />,
    );
  });
  return container.querySelector('nav.episode-nav') as HTMLElement;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('the newest Episode', () => {
  it('renders no next control at all, and says why', () => {
    /**
     * The live defect: the button was enabled, read 「下一集(第 6 日)」, and landed on
     * 「找不到此故事(可能尚未發布)。」 Not merely `disabled` — a disabled control still tells a
     * viewer there is something there.
     */
    const nav = mount(5);
    expect(nav.textContent).not.toContain('下一集');
    expect(nav.textContent).toContain('這是目前最新的一集。');
  });

  it('still offers the previous one', () => {
    expect(mount(5).textContent).toContain('上一集');
  });
});

describe('the earliest Episode', () => {
  it('renders no previous control, and says why', () => {
    const nav = mount(1);
    expect(nav.textContent).not.toContain('上一集');
    expect(nav.textContent).toContain('已經是最早一集。');
  });
});

describe('a control names both numbers', () => {
  it('states the episode number and the world day it navigates to', () => {
    // 「上一集(第 4 日)」 conflated 集 and 日 while the header one line above distinguishes them.
    const nav = mount(5);
    expect(nav.textContent).toContain('上一集:第 2 集(世界日 2)');
  });

  it('names the nearest PUBLISHED day, not the adjacent integer', () => {
    // From day 2 the next published Episode is day 5; arithmetic would have offered day 3.
    expect(mount(2).textContent).toContain('下一集:第 3 集(世界日 5)');
  });
});

describe('before the index has been read', () => {
  it('offers neither control rather than guessing', () => {
    act(() => {
      root.render(
        <EpisodeDetailView worldId={WORLD_ID} worldDay={5} episode={EPISODE} onNavigate={() => {}} />,
      );
    });
    const nav = container.querySelector('nav.episode-nav') as HTMLElement;
    expect(nav.querySelectorAll('button')).toHaveLength(0);
  });
});
