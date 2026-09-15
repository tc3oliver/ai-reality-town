/**
 * What the home page prints, once (ART-184).
 *
 * A `dom` test rather than an addition to `publicPages.a11y.test.tsx`, which is about axe rules
 * and structure. These are presentation claims: a sentence appears once, and a link's number
 * matches the address it goes to.
 *
 * Renders `HomepageView`, the presentational export, so no `useQuery` and no transport is
 * involved — the view model is built by `composeHomepageViewModel` exactly as the page builds it.
 */

import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { HomepageView } from './Homepage';
import { composeHomepageViewModel } from './homeRoute';

const WORLD_ID = 'mistwood';
const LEAD = '磨坊那邊,何俊與趙明把帳目重新攤開。';

let container: HTMLElement;
let root: Root;

function mount(summaryText: string): string {
  const vm = composeHomepageViewModel({
    worldId: WORLD_ID,
    summary: {
      summaryText,
      structured: {
        majorEvent: { eventId: 'mistwood#event#74', publicSummary: LEAD },
        importance: 4,
        characters: [{ characterId: 'he-jun', name: '何俊' }],
        facts: [],
        question: '審計會揭露什麼?',
        recommendedEpisode: { episodeNumber: 3, worldDay: 2 },
      },
    },
    world: null,
    live: null,
    base: '',
  });
  act(() => { root.render(<HomepageView worldId={WORLD_ID} vm={vm} />); });
  return container.textContent ?? '';
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

describe('the lead event is printed once', () => {
  it('drops the 最新大事 section when 近期大事 already carries the same sentence', () => {
    /**
     * The live defect. The onboarding primer opens with 「近期大事:<publicSummary>」 — ART-75
     * AC#1 requires it to — and this section printed the identical sentence again right below.
     */
    const text = mount(`近期大事:${LEAD}。懸而未決:審計會揭露什麼?`);
    expect(text.split(LEAD).length - 1).toBe(1);
    expect(text).not.toContain('最新大事');
  });

  it('keeps the section, header and all, when the primer says something else', () => {
    const text = mount('關鍵人物:何俊。懸而未決:審計會揭露什麼?');
    expect(text).toContain('最新大事');
    expect(text).toContain(LEAD);
  });
});

describe('the episode call to action names the address it goes to', () => {
  it('states both the episode number and the world day the URL carries', () => {
    /**
     * The link was always correct — `episodeNumber` and `worldDay` come from ONE episode record,
     * and the destination heads itself 「第 N 集 · 世界日 M」. What was missing is that a reader
     * who clicked 「第 3 集」 landed on a URL ending in `/2` with nothing explaining the change.
     */
    mount('關鍵人物:何俊。');
    const link = container.querySelector<HTMLAnchorElement>('a[href^="#episode/"]');
    if (link === null) throw new Error('the recommended-episode link was not rendered');

    const routeNumber = link.getAttribute('href')?.split('/').pop();
    expect(routeNumber).toBe('2');
    expect(link.textContent).toContain('第 3 集');
    // The number in the address is named in the label, so the URL is predictable before the click.
    expect(link.textContent).toContain(`世界日 ${routeNumber}`);
  });
});
