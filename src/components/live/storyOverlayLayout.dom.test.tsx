/**
 * The story overlay does not obscure the map (FR-O007 / ART-125 AC#5) — proven on the REAL tree.
 *
 * The other halves of this claim are asserted elsewhere and none is sufficient alone:
 * `liveMap.a11y.test.tsx` sweeps `index.css` for anything that would lift the panel out of
 * normal flow, and `liveMapSurface.test.ts` proves the component can issue no request. What
 * neither can see is the COMPOSITION — whether `LiveMapView` actually renders the overlay as a
 * sibling of `.live-map-canvas` rather than as a wrapper around it or a layer over it — nor the
 * Tailwind half: this is a utility-class project, so `className="absolute z-10"` would cover the
 * map while passing every stylesheet assertion. A source-text regex could be made to agree with
 * almost any arrangement; the rendered DOM cannot.
 *
 * Mounts for real, following `characterCardFocus.dom.test.tsx`: `LiveMapView` imports
 * `pixi-viewport`, whose `main` is a UMD bundle Node's ESM loader cannot read named exports from,
 * and only the `dom` project maps it to the ES build. Mounting the live map in jsdom is safe
 * without stubs for the reasons that file records — `useElementSize` finds no `ResizeObserver`,
 * so the measured size stays zero and `ReadOnlyWorld` is never mounted: no Pixi application and
 * no WebGL context. The canvas CONTAINER is what must not be covered, and it is present either
 * way.
 */

import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { mistwoodAmbientAnchorsByLocationId } from '../../../data/mistwoodAmbientAnchors';
import { mistwoodWorldMap } from '../../../data/mistwood';
import { composeReadOnlyWorldViewModel } from '../world/worldViewModel';
import { LiveMapView } from './LiveMapView';
import { composeStoryOverlayViewModel } from './storyOverlayModel';
import { composeTimeStateBadges } from './timeStateLabel';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The documented no-2D-context degradation path; stubbed so it does not bury a real failure. */
HTMLCanvasElement.prototype.getContext = () => null;

const WORLD_ID = 'mistwood';

/** Classes that would take the panel out of normal flow, or stack it above anything. */
const OUT_OF_FLOW = /^(?:[a-z-]+:)*(?:absolute|fixed|sticky|z-\d+|z-\[.*\])$/;

const worldViewModel = () =>
  composeReadOnlyWorldViewModel({
    map: mistwoodWorldMap,
    motions: [],
    spriteKeys: {},
    nowMs: 0,
    ambientAnchorsByLocationId: mistwoodAmbientAnchorsByLocationId,
    worldDay: 7,
    reducedMotion: true,
  });

/** Fully populated, so every conditional branch of the overlay's markup is present. */
const overlayViewModel = () =>
  composeStoryOverlayViewModel({
    worldId: WORLD_ID,
    summary: {
      summaryText: '近期大事:兩派在鎮公所簽下休戰。',
      structured: {
        majorEvent: { eventId: 'e-42', publicSummary: '兩派在鎮公所簽下休戰。' },
        recommendedEpisode: { episodeNumber: 3, worldDay: 7 },
      },
    },
    activeArcs: [{
      arcId: 'arc-truce', title: '休戰協議', currentQuestion: '休戰能撐過冬天嗎?', status: 'climax',
    }],
    worldDay: 7,
    timeSlot: 'evening',
    scenes: [{ title: '簽約', status: 'active' }],
  });

let container: HTMLDivElement;
let root: Root;

async function mount(element: Parameters<Root['render']>[0]) {
  await act(async () => {
    root.render(element);
  });
  // `useSpriteAssets` resolves each palette variant asynchronously and then sets state. Settled
  // here so it cannot land mid-assertion. A macrotask turn, not a microtask one.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function liveMap() {
  return (
    <LiveMapView
      worldId={WORLD_ID}
      base="/ai-town/"
      viewModel={worldViewModel()}
      targets={[]}
      primaryLocationId={null}
      webglSupported
      loading={false}
      timeStateBadges={composeTimeStateBadges({ replay: null, worldDay: 7, timeSlot: 'evening' })}
      storyOverlay={overlayViewModel()}
    />
  );
}

describe('the story overlay never covers the canvas (FR-O007 AC#5)', () => {
  test('both are rendered, and neither contains the other', async () => {
    await mount(liveMap());
    expect(container.querySelector('.live-story-overlay')).not.toBeNull();
    expect(container.querySelector('.live-map-canvas')).not.toBeNull();
    // The disqualifying arrangement, stated directly: a wrapper can be styled to cover what it
    // wraps, and it would also put the map inside a region a viewer can collapse shut.
    expect(container.querySelector('.live-story-overlay .live-map-canvas')).toBeNull();
    expect(container.querySelector('.live-map-canvas .live-story-overlay')).toBeNull();
    // Nor inside the collapsible itself, which is the same mistake one element deeper.
    expect(container.querySelector('details .live-map-canvas')).toBeNull();
  });

  test('they are block siblings inside the stage, with the map first (FR-O008 AC#2)', async () => {
    await mount(liveMap());
    const overlay = container.querySelector('.live-story-overlay')!;
    const canvas = container.querySelector('.live-map-canvas')!;
    // Same parent, so neither can establish a containing block for the other. That parent is the
    // responsive stage ART-126 introduced, which decides how many columns they sit in.
    expect(overlay.parentElement).toBe(canvas.parentElement);
    expect(canvas.parentElement?.classList.contains('live-stage')).toBe(true);
    // The MAP comes first in document order, and therefore in visual order at every width — one
    // column stacks it above the overlay (mobile is map-first), two columns put it in the left
    // track. ART-125 put the overlay first; FR-O008 AC#2 asks for the opposite and wins. AC#5,
    // which this file is about, never asked for an order — only that the overlay not obscure the
    // map, which every other assertion here still checks.
    // eslint-disable-next-line no-bitwise -- compareDocumentPosition returns a bitmask.
    const overlayFollows = canvas.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(Boolean(overlayFollows)).toBe(true);
    // Exactly two children, so nothing has been slipped between them that could cover the map.
    expect(Array.from(canvas.parentElement!.children)).toEqual([canvas, overlay]);
  });

  test('no element in the rendered overlay is positioned or stacked', async () => {
    // The Tailwind half. `liveMap.a11y.test.tsx` sweeps `index.css`, which a utility class in
    // `className` bypasses entirely — this is the assertion that would catch that.
    await mount(liveMap());
    const overlay = container.querySelector('.live-story-overlay')!;
    const offenders = [overlay, ...Array.from(overlay.querySelectorAll('[class]'))]
      .map((element) => element.getAttribute('class') ?? '')
      .filter((className) => className.split(/\s+/).some((token) => OUT_OF_FLOW.test(token)));
    expect(offenders).toEqual([]);
    // Nor inline, which no class sweep would see.
    expect(overlay.getAttribute('style')).toBeNull();
    expect(overlay.querySelector('[style]')).toBeNull();
  });

  test('the regex behind that assertion actually matches what it claims to', () => {
    // A negative sweep that matched nothing would pass forever. Pinned both ways.
    for (const token of ['absolute', 'fixed', 'sticky', 'z-10', 'md:absolute', 'z-[60]']) {
      expect(OUT_OF_FLOW.test(token)).toBe(true);
    }
    for (const token of ['mt-3', 'text-sm', 'public-muted', 'live-story-overlay', 'font-medium']) {
      expect(OUT_OF_FLOW.test(token)).toBe(false);
    }
  });

  test('omitting the overlay leaves the map exactly as it was', async () => {
    // The prop is optional, so a caller that has not adopted it renders no empty panel.
    await mount(
      <LiveMapView
        worldId={WORLD_ID} base="/ai-town/" viewModel={worldViewModel()} targets={[]}
        primaryLocationId={null} webglSupported loading={false}
      />,
    );
    expect(container.querySelector('.live-story-overlay')).toBeNull();
    expect(container.querySelector('.live-map-canvas')).not.toBeNull();
  });
});
