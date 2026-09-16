/**
 * What the pages actually print for the world's name (ART-190).
 *
 * `convex/shared/publicWorldNames.test.ts` pins the resolution and the source scan. This pins that
 * the pages OBEY it, which is a separate claim: the defect was a component ignoring the resolved
 * name in favour of a hardcoded one, and a resolver test cannot see that.
 *
 * The first test is the one the task exists for. The home page rendered the seed's 「Mistwood」 as
 * its `h1` and a hardcoded 「現在的霧林鎮」 as the heading three lines below it — two names for one
 * town, on one screen. So the assertion is that both come out the same, not that either is
 * individually correct.
 */

import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { HomepageView } from './Homepage';
import { HelpView } from './HelpPage';
import { composeHomepageViewModel } from './homeRoute';
import { composeHelpViewModel } from './helpRoute';

const WORLD_ID = 'mistwood';
const DISPLAY_NAME = '霧林鎮';

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

const render = (node: React.ReactNode): string => {
  act(() => { root.render(node); });
  return container.textContent ?? '';
};

const home = (world: { name: string | null } | null) => composeHomepageViewModel({
  worldId: WORLD_ID,
  summary: null,
  world: world as never,
  live: null,
  base: '',
});

describe('the home page', () => {
  it('uses ONE name for the town, in the heading and in the h1', () => {
    // The live defect: 「Mistwood」 above 「現在的霧林鎮」.
    const vm = home({ name: 'Mistwood' });
    const text = render(<HomepageView worldId={WORLD_ID} vm={vm} />);
    expect(text).toContain(DISPLAY_NAME);
    expect(text).toContain(`現在的${DISPLAY_NAME}`);
    expect(text).not.toContain('Mistwood');
  });

  it('heads itself correctly BEFORE the world projection has been read', () => {
    /**
     * Resolved from the world id, so there is no flash of 「這個世界」 followed by the wrong name.
     * The page used to show the placeholder until the read landed and then 「Mistwood」.
     */
    render(<HomepageView worldId={WORLD_ID} vm={home(null)} />);
    // Scoped to the two places that NAME the town. The page also carries an unrelated section
    // heading 「認識這個世界」, and asserting over the whole page would read that as a placeholder.
    expect(container.querySelector('h1')?.textContent).toBe(DISPLAY_NAME);
    expect(container.querySelector('#home-first-screen')?.textContent)
      .toBe(`現在的${DISPLAY_NAME}`);
  });

  it('falls back to the canonical name for a world with no registered display name', () => {
    const vm = composeHomepageViewModel({
      worldId: 'other-world', summary: null, world: { name: 'Northreach' } as never, live: null, base: '',
    });
    const text = render(<HomepageView worldId="other-world" vm={vm} />);
    expect(text).toContain('Northreach');
  });

  it('falls back to the placeholder when nothing names the world at all', () => {
    const vm = composeHomepageViewModel({
      worldId: 'other-world', summary: null, world: null, live: null, base: '',
    });
    render(<HomepageView worldId="other-world" vm={vm} />);
    expect(container.querySelector('h1')?.textContent).toBe('這個世界');
  });
});

describe('the watch guide, which reads no projection', () => {
  it('names the town in Chinese in its opening sentence', () => {
    // 「Mistwood 是一個持續運作的 AI 世界」 — the canonical English name inside a Chinese sentence.
    const text = render(
      <HelpView worldId={WORLD_ID} vm={composeHelpViewModel({ worldId: WORLD_ID, base: '' })} />,
    );
    expect(text).toContain(`${DISPLAY_NAME}是一個持續運作的 AI 世界`);
    expect(text).toContain(`目前的${DISPLAY_NAME}`);
    expect(text).not.toContain('Mistwood');
  });

  it('says 這個世界 when the route carries no world at all', () => {
    // `#help` with no world id is a real route, and it must not invent a town.
    const text = render(
      <HelpView worldId={null} vm={composeHelpViewModel({ worldId: null, base: '' })} />,
    );
    expect(text).toContain('這個世界是一個持續運作的 AI 世界');
    expect(text).not.toContain(DISPLAY_NAME);
  });
});
