/**
 * The responsive live viewing experience (FR-O008 / ART-126).
 *
 * Every acceptance criterion here is about what a viewport does to a layout, and jsdom applies no
 * CSS — so this suite deliberately splits each claim into the half a DOM can settle and the half
 * only the stylesheet can, and asserts both rather than pretending either is sufficient.
 *
 * - The DOM half is a real mount, following `characterCardFocus.dom.test.tsx`: which elements
 *   exist, what contains what, what order they are in, which classes they carry, and what happens
 *   when a control is pressed at a small viewport. This is where a Tailwind utility class would be
 *   caught, because it is on the rendered node rather than in `index.css`.
 * - The stylesheet half reads `src/index.css` directly, because "two columns above 64rem" and "no
 *   floor taller than a landscape phone" are declarations, not DOM facts. Comments are stripped
 *   first so prose about CSS is never mistaken for CSS.
 *
 * What neither half covers is real layout in a real engine — no headless browser runs in this
 * repo yet. That is ART-137's job (FR-O008's browser E2E), and this file is the structural floor
 * under it rather than a substitute for it.
 *
 * Mounting the live map in jsdom is safe without stubs for the reasons `characterCardFocus`
 * records: `useElementSize` finds no `ResizeObserver`, so the measured size stays zero and
 * `ReadOnlyWorld` is never mounted — no Pixi application and no WebGL context.
 */

import { readFileSync } from 'node:fs';

import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { mistwoodCharacterSpriteKeys } from '../../../data/mistwoodCharacters';
import { mistwoodLocationFootprints, mistwoodWorldMap } from '../../../data/mistwood';
import { focusTargetsFrom } from '../world/cameraModel';
import { composeReadOnlyWorldViewModel, type PublicCharacterMotion } from '../world/worldViewModel';
import type { CharacterProjection } from '../public/characterRoute';
import { LiveMapView } from './LiveMapView';
import { composeActiveScenePanel } from './activeSceneModel';
import { composeCharacterCardViewModel } from './characterCardModel';
import { composeStoryOverlayViewModel } from './storyOverlayModel';
import { composeTimeStateBadges } from './timeStateLabel';
import { COMPACT_VIEWPORT_MAX_REM, COMPACT_VIEWPORT_QUERY } from './useCompactViewport';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The documented no-2D-context degradation path; stubbed so it does not bury a real failure. */
HTMLCanvasElement.prototype.getContext = () => null;

/** Comments stripped, so prose about CSS is never mistaken for CSS. */
const INDEX_CSS = readFileSync(new URL('../../index.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

const WORLD_ID = 'mistwood';
const CHARACTER_ID = 'he-jun';
const MILL = 'mistwood-mill';

const motion: PublicCharacterMotion = {
  characterId: CHARACTER_ID, semanticLocationId: MILL, motionType: 'idle',
  motionSequence: 1, from: { x: 36, y: 18 }, to: { x: 36, y: 18 },
  startedAt: 0, arriveAt: 0, animationState: 'idle', direction: 'down',
};

const character: CharacterProjection = {
  id: CHARACTER_ID, worldId: WORLD_ID, name: '何俊', age: 38, occupation: '磨坊工',
  publicProfile: '北水磨坊的工頭。', personality: '沉穩', values: '守信',
  publicGoal: '修好水車', fear: '洪水', currentLocationId: MILL,
  healthState: '健康', emotionalState: '平靜', financialState: '拮据', alive: true, active: true,
};

/**
 * A viewport of a chosen width, expressed the only way the components can observe one.
 *
 * `useCompactViewport` and `useReducedMotion` both go through `matchMedia`, so a stub has to
 * answer BOTH — returning `matches: true` for everything would silently also turn on Reduced
 * Motion and test a different page than the one claimed.
 */
function stubViewport(compact: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: query === COMPACT_VIEWPORT_QUERY ? compact : false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** The wiring `LiveMapPage` supplies, reduced to what these criteria are about. */
function Harness() {
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  return (
    <LiveMapView
      worldId={WORLD_ID}
      base="/ai-town/"
      viewModel={composeReadOnlyWorldViewModel({
        map: mistwoodWorldMap, motions: [motion], spriteKeys: mistwoodCharacterSpriteKeys, nowMs: 0,
      })}
      targets={focusTargetsFrom({
        motions: [motion], footprints: mistwoodLocationFootprints, map: mistwoodWorldMap, nowMs: 0,
      })}
      primaryLocationId={null}
      webglSupported
      loading={false}
      timeStateBadges={composeTimeStateBadges({ replay: null, worldDay: 7, timeSlot: 'evening' })}
      replayAvailable
      scenePanel={composeActiveScenePanel({
        scenes: [{
          title: '修水車', summary: '水車卡住了。', sceneId: `7:evening:${MILL}`, locationId: MILL,
          participantCharacterIds: [CHARACTER_ID], arcIds: ['arc-mill'], status: 'ended',
        }],
        footprints: mistwoodLocationFootprints,
        worldId: WORLD_ID,
      })}
      storyOverlay={composeStoryOverlayViewModel({
        worldId: WORLD_ID,
        summary: {
          summaryText: '兩派在鎮公所簽下休戰。',
          structured: {
            majorEvent: { eventId: 'e-42', publicSummary: '兩派在鎮公所簽下休戰。' },
            recommendedEpisode: { episodeNumber: 3, worldDay: 7 },
          },
        },
        activeArcs: [{
          arcId: 'arc-truce', title: '休戰協議', currentQuestion: '撐得過冬天嗎?', status: 'climax',
        }],
        worldDay: 7,
        timeSlot: 'evening',
        scenes: [{ title: '簽約', status: 'active' }],
      })}
      characterCard={
        selectedCharacterId === null
          ? null
          : composeCharacterCardViewModel({
              worldId: WORLD_ID,
              characterId: selectedCharacterId,
              character,
              motion,
              scenes: [],
              recentEvents: [
                { eventId: 'e1', worldDay: 3, timeSlot: 'noon', publicSummary: '簽下休戰。', episodeNumber: 3 },
              ],
              spriteKeys: mistwoodCharacterSpriteKeys,
              footprints: mistwoodLocationFootprints,
            })
      }
      onOpenCharacterCard={setSelectedCharacterId}
      onCloseCharacterCard={() => setSelectedCharacterId(null)}
    />
  );
}

let container: HTMLDivElement;
let root: Root;
const realMatchMedia = window.matchMedia;

async function mountAt(compact: boolean): Promise<void> {
  stubViewport(compact);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Harness />);
  });
  // `useSpriteAssets` resolves each palette variant asynchronously and then sets state. A
  // macrotask turn, not a microtask one, so no variant lands mid-assertion.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  window.matchMedia = realMatchMedia;
});

function press(button: HTMLButtonElement): void {
  act(() => {
    button.focus();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function buttonNamed(name: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll('button')).find(
    (button) => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim() === name,
  );
  expect(match).toBeDefined();
  return match as HTMLButtonElement;
}

/** Every rule for a selector, in source order. */
function rulesFor(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...INDEX_CSS.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
}

describe('AC#1 — desktop shows the map and the story overlay at the same time', () => {
  test('the stage holds exactly the canvas and the overlay, as siblings', async () => {
    await mountAt(false);
    const stage = container.querySelector('.live-stage');
    expect(stage).not.toBeNull();
    const canvas = container.querySelector('.live-map-canvas')!;
    const overlay = container.querySelector('.live-story-overlay')!;
    // "Simultaneously" is only meaningful if one cannot be inside — and therefore hidden with —
    // the other. Two children, both direct, nothing else between them.
    expect(Array.from(stage!.children)).toEqual([canvas, overlay]);
  });

  test('the stylesheet gives the stage a second column above the breakpoint', async () => {
    const base = rulesFor('.live-stage');
    expect(base.length).toBeGreaterThan(0);
    expect(base[0]).toMatch(/display:\s*grid/);
    // One column by default — the mobile-first direction, so a browser that fails to match any
    // media query still gets the stacked arrangement rather than a broken two-column one.
    expect(base[0]).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);

    // ...and a two-column rule inside a min-width query, which is the AC itself.
    const wide = INDEX_CSS.match(
      /@media\s*\(min-width:\s*(\d+(?:\.\d+)?)rem\)\s*\{\s*\.live-stage\s*\{([^}]*)\}/,
    );
    expect(wide).not.toBeNull();
    expect(wide![2]).toMatch(/grid-template-columns:\s*minmax\(0,\s*3fr\)\s+minmax\(0,\s*2fr\)/);
    // The one number JavaScript and CSS both depend on. If they drifted, the overlay could start
    // collapsed in the very layout that has a column to show it in.
    expect(Number(wide![1])).toBe(COMPACT_VIEWPORT_MAX_REM);
  });

  test('the live page is allowed to be wider than the prose measure', async () => {
    await mountAt(false);
    // AC#1 is unreachable inside `max-w-2xl`; the opt-in is per page, so no prose page is
    // affected. Asserted on the rendered node rather than on the frame's source.
    const page = container.querySelector('.public-page')!;
    const classes = (page.getAttribute('class') ?? '').split(/\s+/);
    expect(classes).toContain('max-w-5xl');
    expect(classes).not.toContain('max-w-2xl');
  });
});

describe('AC#2 — mobile is map-first, with the overlay as the card beneath it', () => {
  test('the map precedes the overlay in the DOM, so it does at every width', async () => {
    await mountAt(true);
    const canvas = container.querySelector('.live-map-canvas')!;
    const overlay = container.querySelector('.live-story-overlay')!;
    // eslint-disable-next-line no-bitwise -- compareDocumentPosition returns a bitmask.
    const overlayFollows = canvas.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(Boolean(overlayFollows)).toBe(true);
  });

  test('nothing in the stylesheet reorders the two visually', () => {
    // The trap this layout was built to avoid: `order` would put the map first on mobile without
    // touching the markup, and would leave the reading order disagreeing with the focus order
    // (WCAG 1.3.2 / 2.4.3) — passing the AC while failing a viewer using a keyboard.
    for (const selector of ['.live-stage', '.live-map-canvas', '.live-story-overlay']) {
      for (const rule of rulesFor(selector)) {
        expect(rule).not.toMatch(/(^|[;\s])order\s*:/);
        expect(rule).not.toMatch(/flex-direction:\s*(column|row)-reverse/);
      }
    }
  });

  test('the overlay starts collapsed on a compact viewport and open on a wide one', async () => {
    // FR-O007: a mobile viewer is not required to be shown everything at once. Under the map, an
    // expanded panel costs a viewer who came to watch the map a screenful of scrolling.
    await mountAt(true);
    expect(container.querySelector('.live-story-overlay details')?.hasAttribute('open')).toBe(false);
    // ...and it is still collapsIBLE rather than gone: the heading and the world clock are in the
    // summary, so the panel says what it holds and when, closed.
    const summary = container.querySelector('.live-story-overlay summary');
    expect(summary?.textContent).toContain('故事資訊');
    expect(summary?.textContent).toContain('第 7 天');
  });

  test('and open on a wide one, where it has its own column to sit in', async () => {
    await mountAt(false);
    expect(container.querySelector('.live-story-overlay details')?.hasAttribute('open')).toBe(true);
  });
});

describe('AC#3 — the primary controls are big enough to hit with a thumb', () => {
  test('every button and every link on the live surface carries the touch target', async () => {
    await mountAt(true);
    press(buttonNamed(`查看 ${CHARACTER_ID} 的角色卡`));
    // With the card open, so its own controls are in the sweep too.
    const controls = [
      ...Array.from(container.querySelectorAll('button')),
      ...Array.from(container.querySelectorAll('a[href]')),
    ];
    // Not passing by finding nothing: the camera chrome alone contributes more than this.
    expect(controls.length).toBeGreaterThan(8);
    const undersized = controls
      .filter((control) => !control.classList.contains('public-tap'))
      .map((control) => `${control.tagName}: ${(control.textContent ?? '').trim()}`);
    expect(undersized).toEqual([]);
  });

  test('the class it carries actually declares the WCAG 2.5.8 minimum', () => {
    // The other half. Every control could carry a class that no longer sized anything.
    const [tap] = rulesFor('.public-tap');
    expect(tap).toBeDefined();
    expect(tap).toMatch(/min-height:\s*44px/);
    expect(tap).toMatch(/min-width:\s*44px/);
  });

  test('the overlay summary — the panel\'s only control — is sized too', () => {
    const [summary] = rulesFor('.live-story-overlay-summary');
    expect(summary).toMatch(/min-height:\s*44px/);
  });
});

describe('AC#4 — neither orientation produces blocking overflow', () => {
  test('the canvas never declares a floor taller than a phone held sideways', () => {
    // The bug this replaced: `min-height: 280px`. A landscape phone is around 360px tall, so the
    // map plus the page header left nothing else on screen — and the floor beat the `70vh` cap,
    // which is what made it a floor rather than a fallback.
    for (const rule of rulesFor('.live-map-canvas')) {
      expect(rule).not.toMatch(/min-height/);
      // Every height is a clamp, so there is always an upper bound as well as a lower one.
      for (const height of rule.matchAll(/height:\s*([^;]+);/g)) {
        expect(height[1]).toMatch(/^clamp\(/);
      }
    }
    // The lower bounds, read off the declarations rather than assumed: 200px in general, and
    // lower still under the short-landscape rule.
    const floors = rulesFor('.live-map-canvas')
      .flatMap((rule) => [...rule.matchAll(/clamp\((\d+)px/g)].map((m) => Number(m[1])));
    expect(floors.length).toBeGreaterThan(0);
    for (const floor of floors) expect(floor).toBeLessThanOrEqual(200);
  });

  test('a short landscape viewport gets a shorter map still', () => {
    const landscape = INDEX_CSS.match(
      /@media\s*\(orientation:\s*landscape\)\s*and\s*\(max-height:\s*[^)]+\)\s*\{\s*\.live-map-canvas\s*\{([^}]*)\}/,
    );
    expect(landscape).not.toBeNull();
    expect(landscape![1]).toMatch(/height:\s*clamp\(140px/);
  });

  test('the grid tracks can shrink below their content', () => {
    // A grid track's automatic minimum is `auto`, so a canvas or a long unbroken id would refuse
    // to shrink and widen the grid past the viewport — the same blocking overflow, arriving
    // through the layout instead of through the text.
    for (const rule of rulesFor('.live-stage')) {
      for (const tracks of rule.matchAll(/grid-template-columns:\s*([^;]+);/g)) {
        for (const track of tracks[1].split(/\)\s+/)) {
          expect(track).toMatch(/minmax\(0,/);
        }
      }
    }
    const wide = INDEX_CSS.match(/@media\s*\(min-width:[^)]+\)\s*\{\s*\.live-stage\s*\{([^}]*)\}/);
    expect(wide![1]).toMatch(/minmax\(0,\s*3fr\)\s+minmax\(0,\s*2fr\)/);
  });

  test('long unbroken identifiers cannot set the page width', () => {
    // The live surface prints raw ids — `arc-mill`, `7:evening:mistwood-mill`, participant ids
    // joined with 、. None has a break opportunity, so without this one long one pushes the whole
    // page sideways. `anywhere`, not `break-word`: only `anywhere` also shrinks the intrinsic
    // min-content width, which is the half that stops the overflow.
    const [page] = rulesFor('.public-page');
    expect(page).toMatch(/overflow-wrap:\s*anywhere/);
  });

  test('no live rule pins a width in pixels', async () => {
    await mountAt(true);
    // The canvas is `width: 100%`, and the portrait is the one fixed-size element — a 32x32
    // sprite frame, which is smaller than any viewport and is asserted by name rather than
    // exempted by a pattern.
    for (const selector of ['.live-stage', '.live-map-canvas', '.live-story-overlay', '.live-character-card']) {
      for (const rule of rulesFor(selector)) {
        expect(rule).not.toMatch(/(?:^|[;\s])(?:min-)?width:\s*\d+px/);
      }
    }
    expect(rulesFor('.live-character-portrait')[0]).toMatch(/width:\s*32px/);
  });
});

describe('AC#5 — the character and scene cards still open on a small screen', () => {
  test('the card opens from the camera chrome at a compact viewport', async () => {
    await mountAt(true);
    expect(container.querySelector('.live-character-card')).toBeNull();

    press(buttonNamed(`查看 ${CHARACTER_ID} 的角色卡`));

    const card = container.querySelector('.live-character-card');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('何俊');
    // And it took focus, which is what puts it on screen for a viewer who pressed a control near
    // the bottom of a long stacked page: the card renders above that control.
    expect(document.activeElement).toBe(card);
  });

  test('it closes again, and the close control is thumb-sized', async () => {
    await mountAt(true);
    press(buttonNamed(`查看 ${CHARACTER_ID} 的角色卡`));
    const close = buttonNamed('關閉 何俊 的角色卡');
    expect(close.classList.contains('public-tap')).toBe(true);
    press(close);
    expect(container.querySelector('.live-character-card')).toBeNull();
  });

  test('the card is in the page flow, not a layer over the map', async () => {
    await mountAt(true);
    press(buttonNamed(`查看 ${CHARACTER_ID} 的角色卡`));
    const card = container.querySelector('.live-character-card')!;
    // The "bottom sheet or equivalent" AC#2 offers a choice about: the equivalent chosen is an
    // in-flow card stack under the map. A fixed sheet would cover the character the card is
    // about, would need focus trapping to be correct, and would contradict FR-O007 AC#5 for the
    // panel beside it. Documented in docs/live-responsive-layout.md.
    expect(card.closest('.live-stage')).toBeNull();
    for (const rule of rulesFor('.live-character-card')) {
      expect(rule).not.toMatch(/position:\s*(absolute|fixed|sticky)/);
      expect(rule).not.toMatch(/\bz-index\b/);
    }
    const classes = [card, ...Array.from(card.querySelectorAll('[class]'))]
      .flatMap((element) => (element.getAttribute('class') ?? '').split(/\s+/));
    for (const token of classes) {
      expect(token).not.toMatch(/^(?:[a-z-]+:)*(?:absolute|fixed|sticky|z-\d+)$/);
    }
  });

  test('the scene card keeps its focus button and its Episode link', async () => {
    await mountAt(true);
    // AC#5 names both cards. The scene panel's controls are what "openable" means for it: an
    // ended scene offers the day's Episode, and any scene can be focused on the map.
    const focusScene = buttonNamed('聚焦此場景');
    expect(focusScene.classList.contains('public-tap')).toBe(true);
    const episode = container.querySelector(`a[href="#episode/${WORLD_ID}/7"]`);
    expect(episode).not.toBeNull();
    expect(episode?.classList.contains('public-tap')).toBe(true);
  });
});
