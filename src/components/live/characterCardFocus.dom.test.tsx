/**
 * Focus management for the public character card (FR-O006 / ART-124, NFR-009).
 *
 * The only test in this repo that MOUNTS a component and dispatches a real event, and it is here
 * because nothing else can prove the claim. The two other harnesses each miss it by construction:
 * the `a11y` project renders through `renderToStaticMarkup`, which runs no effect and delivers no
 * click, and the rest of the `dom` project deliberately calls components as functions rather than
 * mounting them. Both can show that the card is *focusable* — `tabindex="-1"` is in the markup —
 * and neither can show that focus ever actually moves. That gap is exactly where this feature's
 * accessibility bug would live: the card renders BELOW the button that opens it, so if the effect
 * regressed, a keyboard user would press "角色卡" and land on nothing, and every static assertion
 * would still pass.
 *
 * So this mounts `LiveMapView` for real and asserts on `document.activeElement` across the whole
 * round trip: open -> focus is in the card; close -> focus is back on the button that opened it.
 *
 * Mounting the live map in jsdom is safe without stubs, and that is a property of the components
 * rather than luck. `useReducedMotion` returns `false` where `matchMedia` is absent;
 * `useElementSize` returns a no-op teardown where `ResizeObserver` is absent, so the measured size
 * stays `EMPTY_ELEMENT_SIZE` and `LiveMapView` never mounts `ReadOnlyWorld` — no Pixi application,
 * no WebGL context. `useSpriteAssets` does run, and resolves every palette variant to the base
 * texture because jsdom's canvas has no 2D context, which is the documented degradation path.
 */

import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { mistwoodCharacterSpriteKeys } from '../../../data/mistwoodCharacters';
import { mistwoodLocationFootprints, mistwoodWorldMap } from '../../../data/mistwood';
import { focusTargetsFrom } from '../world/cameraModel';
import { composeReadOnlyWorldViewModel } from '../world/worldViewModel';
import type { PublicCharacterMotion } from '../world/worldViewModel';
import { LiveMapView } from './LiveMapView';
import { composeCharacterCardViewModel } from './characterCardModel';
import type { CharacterProjection } from '../public/characterRoute';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * jsdom throws "not implemented" from `getContext` unless the `canvas` package is installed, once
 * per palette variant. Returning `null` instead is not a workaround for that: it is precisely the
 * case `resolveVariantSpriteAsset` documents and handles — a browser with no 2D context — and it
 * resolves every variant to its base texture. Stubbed here so the sixteen unhandled errors do not
 * bury a real failure in this suite's output.
 */
HTMLCanvasElement.prototype.getContext = () => null;

const WORLD_ID = 'mistwood';
const CHARACTER_ID = 'he-jun';

const motion: PublicCharacterMotion = {
  characterId: CHARACTER_ID, semanticLocationId: 'mistwood-mill', motionType: 'idle',
  motionSequence: 1, from: { x: 36, y: 18 }, to: { x: 36, y: 18 },
  startedAt: 0, arriveAt: 0, animationState: 'idle', direction: 'down',
};

const character: CharacterProjection = {
  id: CHARACTER_ID, worldId: WORLD_ID, name: '何俊', age: 38, occupation: '磨坊工',
  publicProfile: '北水磨坊的工頭。', personality: '沉穩', values: '守信',
  publicGoal: '修好水車', fear: '洪水', currentLocationId: 'mistwood-mill',
  healthState: '健康', emotionalState: '平靜', financialState: '拮据', alive: true, active: true,
};

/**
 * The wiring `LiveMapPage` provides, reduced to the part under test: the selection lives above
 * `LiveMapView`, and the card view model is composed from it. Everything focus-related —
 * capturing the trigger, restoring to it, taking focus on mount — is inside the real components.
 */
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
      characterCard={
        selectedCharacterId === null
          ? null
          : composeCharacterCardViewModel({
              worldId: WORLD_ID,
              characterId: selectedCharacterId,
              character,
              motion,
              scenes: [],
              recentEvents: [],
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

beforeEach(async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Harness />);
  });
  // `useSpriteAssets` resolves each palette variant asynchronously and then sets state. Settled
  // here rather than left in flight so it cannot land mid-assertion and re-render the tree while
  // the focus expectations are being read. A macrotask turn, not a microtask one: each variant
  // resolves through a promise chain, so awaiting a single tick would leave the later ones
  // pending and put their state updates outside `act`.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function buttonNamed(name: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll('button')).find(
    (button) => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim() === name,
  );
  expect(match).toBeDefined();
  return match as HTMLButtonElement;
}

function card(): HTMLElement | null {
  return container.querySelector('section.live-character-card');
}

/**
 * Press a button the way a viewer does: focus it first, then click.
 *
 * The focus step is the browser behaviour being modelled, not test decoration — a real pointer or
 * keyboard activation leaves the control focused, and `LiveMapView` reads `document.activeElement`
 * to learn which trigger to return to. `jsdom` does not focus a target on `click()` by itself, so
 * skipping this would test a situation no browser produces.
 */
function press(button: HTMLButtonElement): void {
  act(() => {
    button.focus();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('opening and closing the character card moves focus (NFR-009)', () => {
  test('the card takes focus on open, so pressing 角色卡 is not silent', () => {
    expect(card()).toBeNull();
    const trigger = buttonNamed(`查看 ${CHARACTER_ID} 的角色卡`);

    press(trigger);

    const opened = card();
    expect(opened).not.toBeNull();
    // The heart of it: the card renders BELOW its trigger, so without the mount effect the new
    // content would sit behind the viewer in the tab order and nothing would announce it.
    expect(document.activeElement).toBe(opened);
    expect(opened?.contains(document.activeElement)).toBe(true);
    expect(opened?.textContent).toContain('何俊');
  });

  test('focus returns to the button that opened it on close, not to <body>', () => {
    const trigger = buttonNamed(`查看 ${CHARACTER_ID} 的角色卡`);
    press(trigger);
    expect(document.activeElement).not.toBe(document.body);

    press(buttonNamed('關閉 何俊 的角色卡'));

    expect(card()).toBeNull();
    // Restored to the exact element, not merely to something plausible: a keyboard user who
    // closes the card carries on from where they were, instead of restarting at the top of the
    // page — which is what losing focus to `<body>` costs them.
    expect(document.activeElement).toBe(trigger);
  });

  test('the card is not itself a tab stop, so it is skipped once focus has moved on', () => {
    press(buttonNamed(`查看 ${CHARACTER_ID} 的角色卡`));
    // `tabIndex={-1}` is what makes "focusable programmatically" and "in the tab order" different
    // things. Asserted on the mounted node rather than the markup so it is the same element the
    // focus assertions above are about.
    expect((card() as HTMLElement).tabIndex).toBe(-1);
  });

  test('switching straight to another character re-announces rather than going quiet', () => {
    // No close in between: the card re-renders in place for a different character. Focus is
    // already inside it, so what carries the change is the polite live region.
    press(buttonNamed(`查看 ${CHARACTER_ID} 的角色卡`));
    const status = card()?.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toContain('何俊');
  });
});
