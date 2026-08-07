/**
 * Accessibility evidence for the live map's chrome (ART-118, FR-O001 AC#3/#7; NFR-009).
 *
 * A canvas is opaque to assistive technology, which is exactly why every camera
 * affordance was built as a DOM control rather than as a Pixi hit test. This
 * suite is what makes that claim checkable: each control is a real `<button>`
 * with an accessible name, reachable in DOM order, and the WebGL-unavailable
 * page is a complete, axe-clean page that signposts the text Live View.
 *
 * The map itself is not rendered here -- mounting a Pixi `Stage` needs a real
 * WebGL context jsdom cannot provide. What the canvas draws is covered by
 * `components/world/readOnlyWorld.dom.test.tsx`, and the gestures by the
 * recorded manual browser pass in `docs/live-view-navigation.md`.
 */

import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import jestAxe from 'jest-axe';

import { mistwoodLocationFootprints, mistwoodWorldMap } from '../../../data/mistwood';
import {
  INITIAL_CAMERA_MODE,
  focusTargetsFrom,
  locationTargetId,
  type CameraMode,
} from '../world/cameraModel';
import { ActiveScenePanel } from './ActiveScenePanel';
import { composeActiveScenePanel } from './activeSceneModel';
import { CameraControls } from './CameraControls';
import { LiveMapFallback } from './LiveMapFallback';

const WORLD_ID = 'mistwood';
const BASE = '/ai-town/';

function render(element: ReactElement): HTMLElement {
  document.body.innerHTML = renderToStaticMarkup(element);
  return document.body;
}

function accessibleName(element: Element): string {
  return (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
}

function targets() {
  return focusTargetsFrom({
    motions: [
      {
        characterId: 'he-jun',
        semanticLocationId: 'mistwood-mill',
        motionType: 'canon',
        motionSequence: 1,
        from: { x: 36, y: 18 },
        to: { x: 36, y: 18 },
        startedAt: 0,
        arriveAt: 0,
        animationState: 'idle',
        direction: 'down',
      },
    ],
    footprints: mistwoodLocationFootprints,
    map: mistwoodWorldMap,
    nowMs: 0,
  });
}

function controls(mode: CameraMode = INITIAL_CAMERA_MODE) {
  return <CameraControls targets={targets()} mode={mode} onModeChange={() => undefined} />;
}

describe('the camera chrome is operable without a mouse (NFR-009, FR-O005 AC#3)', () => {
  test('is axe-clean', async () => {
    expect(await jestAxe.axe(render(controls()))).toHaveNoViolations();
  });

  test('every camera affordance is a real button with an accessible name', () => {
    const container = render(controls());
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(4);
    for (const button of buttons) {
      // A canvas hit test is none of these things; a <button> is all of them.
      expect(button.getAttribute('type')).toBe('button');
      expect(accessibleName(button)).not.toBe('');
      expect(button.getAttribute('tabindex')).toBeNull();
      expect(button.closest('[aria-hidden="true"]')).toBeNull();
      expect(button.classList.contains('public-tap')).toBe(true);
    }
    // Nothing on the map is clickable-but-not-focusable.
    const nonButtonControls = container.querySelectorAll('[onclick], [role="button"]');
    expect(nonButtonControls).toHaveLength(0);
  });

  test('the whole control set AC#3 requires is present and named', () => {
    const names = Array.from(render(controls()).querySelectorAll('button')).map(accessibleName);
    expect(names).toContain('回到全鎮視角');
    expect(names).toContain('拉近');
    expect(names).toContain('拉遠');
    expect(names).toContain('自動跟隨主要場景');
    // One focus button per location...
    for (const footprint of mistwoodLocationFootprints) expect(names).toContain(footprint.name);
    // ...and one per published character.
    expect(names).toContain('he-jun');
  });

  test('the current camera state is announced, not just drawn', () => {
    const followingOff = render(
      controls({ follow: false, focusId: locationTargetId('mistwood-mill'), zoomStep: 0 }),
    );
    const pressed = Array.from(followingOff.querySelectorAll('button[aria-pressed="true"]')).map(
      accessibleName,
    );
    expect(pressed).toEqual(['Northwater Mill']);

    const following = render(controls({ follow: true, focusId: null, zoomStep: 0 }));
    expect(
      Array.from(following.querySelectorAll('button[aria-pressed="true"]')).map(accessibleName),
    ).toEqual(['自動跟隨主要場景']);
  });

  test('headings run in order and name their own groups', () => {
    const container = render(controls());
    const levels = Array.from(container.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((heading) =>
      Number(heading.tagName.slice(1)),
    );
    // Three focus lists since ART-122: scenes, locations, characters.
    expect(levels).toEqual([2, 3, 3, 3]);
    for (const list of Array.from(container.querySelectorAll('ul[aria-labelledby]'))) {
      const id = list.getAttribute('aria-labelledby')!;
      expect(container.querySelector(`#${id}`)?.textContent).toBeTruthy();
    }
  });
});

describe('the WebGL-unavailable page (FR-O001 AC#7)', () => {
  test('is axe-clean and renders as a complete page', async () => {
    const container = render(<LiveMapFallback worldId={WORLD_ID} base={BASE} />);
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('.public-page')?.getAttribute('lang')).toBe('zh-Hant');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    // It is informational, not a second renderer: no canvas is attempted.
    expect(container.querySelector('canvas')).toBeNull();
  });

  test('hands the viewer to the text Live View rather than dead-ending', () => {
    const container = render(<LiveMapFallback worldId={WORLD_ID} base={BASE} />);
    const link = Array.from(container.querySelectorAll('a[href]')).find(
      (anchor) => anchor.getAttribute('href') === `/ai-town/live/${WORLD_ID}/text`,
    );
    expect(link).toBeDefined();
    expect(accessibleName(link as Element)).not.toBe('');
  });

  test('says which failure happened, since only one of them is the viewer‘s to fix', () => {
    const noWebgl = render(<LiveMapFallback worldId={WORLD_ID} base={BASE} />).textContent ?? '';
    const crashed =
      render(<LiveMapFallback worldId={WORLD_ID} base={BASE} reason="render-failed" />)
        .textContent ?? '';
    expect(noWebgl).toContain('WebGL');
    expect(crashed).not.toBe(noWebgl);
    // Neither wording implies the world stopped -- it did not.
    for (const text of [noWebgl, crashed]) expect(text).toContain('世界仍在運作');
  });
});

/**
 * The active scene panel (FR-O003 / ART-122 AC#1/#2/#3/#5).
 *
 * Real rendering evidence rather than a browser click: the deployment this repo builds
 * against is quota-disabled, so the live map cannot be fed real data in a browser. What a
 * browser would have shown -- a titled scene with its location, summary, participants, arcs,
 * a focus button and an Episode link -- is asserted here against the actual rendered DOM.
 */
describe('the active scene panel (FR-O003 / ART-122)', () => {
  const HALL = 'mistwood-hall';

  function panel(scenes: Parameters<typeof composeActiveScenePanel>[0]['scenes']) {
    return composeActiveScenePanel({ scenes, footprints: mistwoodLocationFootprints, worldId: WORLD_ID });
  }

  const activeScene = {
    title: '簽約', summary: '眾人見證休戰。', sceneId: `7:evening:${HALL}`, locationId: HALL,
    participantCharacterIds: ['cassia', 'rowan'], arcIds: ['arc-truce'], status: 'active' as const,
  };

  test('renders title, location, summary, participants and arcs, and is axe-clean', async () => {
    const container = render(
      <ActiveScenePanel model={panel([activeScene])} mode={INITIAL_CAMERA_MODE} onModeChange={() => {}} />,
    );
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    const text = container.textContent ?? '';
    for (const fragment of ['簽約', 'Town Hall', '眾人見證休戰。', 'cassia', 'rowan', 'arc-truce']) {
      expect(text).toContain(fragment);
    }
    // The section names itself, so a screen reader can reach it as a landmark.
    expect(container.querySelector('section[aria-labelledby="live-active-scenes"]')).not.toBeNull();
  });

  test('focus is a real button with an accessible name (AC#3)', () => {
    const container = render(
      <ActiveScenePanel model={panel([activeScene])} mode={INITIAL_CAMERA_MODE} onModeChange={() => {}} />,
    );
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(1);
    expect(accessibleName(buttons[0])).toBe('聚焦此場景');
    // Not a canvas hit test: a button is keyboard-reachable and announceable for free.
    expect(container.querySelector('canvas')).toBeNull();
  });

  test('an ended scene offers its Episode, an active one does not (AC#5)', () => {
    const ended = render(
      <ActiveScenePanel
        model={panel([{ ...activeScene, status: 'ended' }])}
        mode={INITIAL_CAMERA_MODE}
        onModeChange={() => {}}
      />,
    );
    const link = ended.querySelector('a[href="#episode/mistwood/7"]');
    expect(link).not.toBeNull();
    expect(accessibleName(link as Element)).toBe('閱讀當日 Episode');
    expect(ended.textContent).toContain('已結束');

    const active = render(
      <ActiveScenePanel model={panel([activeScene])} mode={INITIAL_CAMERA_MODE} onModeChange={() => {}} />,
    );
    expect(active.querySelectorAll('a[href]')).toHaveLength(0);
  });

  test('the empty state is a sentence, not a blank region', async () => {
    const container = render(
      <ActiveScenePanel model={panel([])} mode={INITIAL_CAMERA_MODE} onModeChange={() => {}} />,
    );
    expect(await jestAxe.axe(container)).toHaveNoViolations();
    expect(container.textContent).toContain('目前沒有進行中的場景。');
  });
});
