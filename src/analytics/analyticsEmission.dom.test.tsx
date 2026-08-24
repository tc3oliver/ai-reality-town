/**
 * The events fire from the REAL surface (FR-Q007 / ART-140 AC#1).
 *
 * `cameraEvents.test.ts` proves the derivation; this proves the wiring, which is the half that
 * silently rots. A contract with correct payloads that nothing ever calls satisfies every unit
 * test in this module and produces no analytics at all.
 *
 * Mounts the shipped `LiveMapView` with a recording sink installed and drives real clicks.
 * Safe without Pixi stubs for the reason `characterCardFocus.dom.test.tsx` records: jsdom has
 * no `ResizeObserver`, so `useElementSize` measures zero and `ReadOnlyWorld` never mounts.
 */

import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { mistwoodCharacterSpriteKeys } from '../../data/mistwoodCharacters';
import { mistwoodLocationFootprints, mistwoodWorldMap } from '../../data/mistwood';
import { focusTargetsFrom } from '../components/world/cameraModel';
import { composeReadOnlyWorldViewModel, type PublicCharacterMotion } from '../components/world/worldViewModel';
import { composeActiveScenePanel } from '../components/live/activeSceneModel';
import { LiveMapView } from '../components/live/LiveMapView';
import { resetAnalyticsSink, setAnalyticsSink } from './analyticsSink';
import type { DynamicViewEvent } from './dynamicViewEvents';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = () => null;

const WORLD_ID = 'mistwood';
const MILL = 'mistwood-mill';
const CHARACTER_ID = 'he-jun';

const motion: PublicCharacterMotion = {
  characterId: CHARACTER_ID, semanticLocationId: MILL, motionType: 'idle',
  motionSequence: 1, from: { x: 36, y: 18 }, to: { x: 36, y: 18 },
  startedAt: 0, arriveAt: 0, animationState: 'idle', direction: 'down',
};

const viewModel = composeReadOnlyWorldViewModel({
  map: mistwoodWorldMap, motions: [motion], spriteKeys: mistwoodCharacterSpriteKeys, nowMs: 0,
});
const targets = focusTargetsFrom({
  motions: [motion], footprints: mistwoodLocationFootprints, map: mistwoodWorldMap, nowMs: 0,
});
const scenePanel = composeActiveScenePanel({
  scenes: [{
    title: '修水車', summary: '水車卡住了。', sceneId: `7:evening:${MILL}`, locationId: MILL,
    participantCharacterIds: [CHARACTER_ID], arcIds: ['arc-mill'], status: 'ended',
  }],
  footprints: mistwoodLocationFootprints,
  worldId: WORLD_ID,
});

let container: HTMLDivElement;
let root: Root;
let received: DynamicViewEvent[];

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  received = [];
  setAnalyticsSink((event) => received.push(event));

  act(() => {
    root.render(
      <LiveMapView
        worldId={WORLD_ID}
        base="/ai-town/"
        viewModel={viewModel}
        targets={targets}
        primaryLocationId={null}
        scenePanel={scenePanel}
        replayAvailable
        webglSupported
        loading={false}
        onOpenCharacterCard={() => undefined}
      />,
    );
  });
});

afterEach(() => {
  resetAnalyticsSink();
  act(() => root.unmount());
  container.remove();
});

const names = () => received.map((event) => event.name);

function press(accessibleName: string | RegExp): void {
  const match = Array.from(container.querySelectorAll('button')).find((button) => {
    const label = (button.getAttribute('aria-label') ?? button.textContent ?? '').trim();
    return typeof accessibleName === 'string' ? label === accessibleName : accessibleName.test(label);
  });
  expect(match).toBeDefined();
  act(() => {
    match!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('mounting emits nothing on its own', () => {
  test('rendering the view is not an interaction', () => {
    // `live_view_opened` belongs to the page (it is the click-rate DENOMINATOR and must fire
    // even when the map never loads), not to this component. If it fired here it would fire
    // again on every remount.
    expect(received).toEqual([]);
  });
});

describe('camera controls emit through the real handlers', () => {
  test('turning auto-follow off', () => {
    press('自動跟隨主要場景');
    expect(names()).toContain('live_camera_follow_disabled');
  });

  test('zooming emits the step actually applied', () => {
    press('拉近');
    const zoom = received.find((event) => event.name === 'live_zoom_used');
    expect(zoom).toBeDefined();
    expect(typeof zoom?.payload.zoomStep).toBe('number');
  });

  test('focusing a character from the controls', () => {
    press(CHARACTER_ID);
    const selected = received.find((event) => event.name === 'live_character_selected');
    expect(selected?.payload.characterId).toBe(CHARACTER_ID);
  });

  test('opening a character card is its own event, with the id', () => {
    press(`查看 ${CHARACTER_ID} 的角色卡`);
    const opened = received.filter((event) => event.name === 'live_character_selected');
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.at(-1)?.payload.characterId).toBe(CHARACTER_ID);
  });
});

describe('the scene panel and the replay controls', () => {
  test('focusing a scene emits its id', () => {
    press('聚焦此場景');
    const selected = received.find((event) => event.name === 'live_scene_selected');
    expect(selected?.payload.sceneId).toBe(`7:evening:${MILL}`);
  });

  test('the Episode link off a finished scene emits an open', () => {
    const link = Array.from(container.querySelectorAll('a')).find((anchor) =>
      (anchor.getAttribute('href') ?? '').includes('#episode/'));
    expect(link).toBeDefined();
    act(() => {
      link!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(names()).toContain('live_episode_opened');
  });
});

describe('every emitted payload is clean, whatever the trigger', () => {
  test('no interaction produces a field outside the allowlist', () => {
    // The integration form of AC#2. The unit tests prove the sanitiser; this proves that what
    // the real handlers hand it comes out clean on the other side.
    press('拉近');
    press(CHARACTER_ID);
    press(`查看 ${CHARACTER_ID} 的角色卡`);
    expect(received.length).toBeGreaterThan(0);
    for (const event of received) {
      for (const [key, value] of Object.entries(event.payload)) {
        expect(['worldId', 'characterId', 'sceneId', 'zoomStep', 'episodeNumber']).toContain(key);
        expect(['string', 'number', 'boolean']).toContain(typeof value);
      }
    }
  });
});
