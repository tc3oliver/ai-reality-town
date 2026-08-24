/**
 * The degradation ladder, mounted (FR-O010 / ART-127).
 *
 * `degradationLadder.test.ts` settles what the verdict IS. This settles what the page does
 * with it, and three things that only a real tree can show:
 *
 * - Every rung renders the content it claims to, and the STAGE KEEPS ITS SHAPE while doing it.
 *   ART-126 proved a responsive contract about `.live-stage` having exactly two children with
 *   the canvas first; a degraded rung that quietly restructured the stage would break that
 *   contract in precisely the state nobody screenshots.
 * - The renderer boundary catches a throw, reports it ONCE, and does not re-render the thing
 *   that just threw. That is AC#4's runtime half — the structural half is
 *   `liveMapSurface.test.ts`, which already reads every file in this module.
 * - The status and last-updated labels are present at EVERY rung including the top (AC#3).
 *
 * Mounting is safe without Pixi stubs for the reason `characterCardFocus.dom.test.tsx`
 * records: no `ResizeObserver` in jsdom, so `useElementSize` measures zero and `ReadOnlyWorld`
 * is never mounted. The renderer failure path is therefore exercised against
 * `RendererErrorBoundary` directly, with a child that throws on purpose.
 */

import { jest } from '@jest/globals';
import { Component, useState, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { mistwoodCharacterSpriteKeys } from '../../../data/mistwoodCharacters';
import { mistwoodLocationFootprints, mistwoodWorldMap } from '../../../data/mistwood';
import { focusTargetsFrom } from '../world/cameraModel';
import { composeReadOnlyWorldViewModel, type PublicCharacterMotion } from '../world/worldViewModel';
import { LiveMapView } from './LiveMapView';
import { RendererErrorBoundary } from './RendererErrorBoundary';
import { DEGRADATION_LEVELS, resolveDegradationLevel, type DegradationLevel } from './degradationLadder';
import { composeStaticMap } from './staticMapModel';
import { composeStoryOverlayViewModel } from './storyOverlayModel';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The documented no-2D-context degradation path; stubbed so it does not bury a real failure. */
HTMLCanvasElement.prototype.getContext = () => null;

const WORLD_ID = 'mistwood';
const MILL = 'mistwood-mill';
const NOW = 1_700_000_000_000;

const motion: PublicCharacterMotion = {
  characterId: 'he-jun', semanticLocationId: MILL, motionType: 'idle',
  motionSequence: 1, from: { x: 36, y: 18 }, to: { x: 36, y: 18 },
  startedAt: 0, arriveAt: 0, animationState: 'idle', direction: 'down',
};

const viewModel = composeReadOnlyWorldViewModel({
  map: mistwoodWorldMap, motions: [motion], spriteKeys: mistwoodCharacterSpriteKeys, nowMs: 0,
});
const targets = focusTargetsFrom({
  motions: [motion], footprints: mistwoodLocationFootprints, map: mistwoodWorldMap, nowMs: 0,
});
/** The stage's second child. ART-126's contract is about BOTH children being there. */
const storyOverlay = composeStoryOverlayViewModel({
  worldId: WORLD_ID, summary: null, activeArcs: null, worldDay: 7, timeSlot: 'evening', scenes: [],
});
const staticMap = composeStaticMap({
  viewModel, footprints: mistwoodLocationFootprints, targets, tileSize: mistwoodWorldMap.tileDim,
});

/** The four verdicts, produced by the REAL resolver rather than hand-written. */
const VERDICTS = {
  stream: resolveDegradationLevel({
    loading: false, streamContent: true, snapshotContent: true,
    webglSupported: true, rendererFailed: false, mapAvailable: true,
  }),
  snapshot: resolveDegradationLevel({
    loading: false, streamContent: false, snapshotContent: true,
    webglSupported: true, rendererFailed: false, mapAvailable: true,
  }),
  'static-map': resolveDegradationLevel({
    loading: false, streamContent: true, snapshotContent: true,
    webglSupported: false, rendererFailed: false, mapAvailable: true,
  }),
  informational: resolveDegradationLevel({
    loading: false, streamContent: false, snapshotContent: false,
    webglSupported: true, rendererFailed: false, mapAvailable: true,
  }),
} satisfies Record<DegradationLevel, ReturnType<typeof resolveDegradationLevel>>;

let container: HTMLDivElement;
let root: Root;

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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderAt(level: DegradationLevel, overrides: Record<string, unknown> = {}): void {
  act(() => {
    root.render(
      <LiveMapView
        worldId={WORLD_ID}
        base="/ai-town/"
        viewModel={viewModel}
        targets={targets}
        primaryLocationId={null}
        storyOverlay={storyOverlay}
        webglSupported={level !== 'static-map'}
        loading={false}
        degradation={VERDICTS[level]}
        staticMap={staticMap}
        freshness="delayed"
        contentUpdatedAt={NOW - 5 * 60_000}
        nowMs={NOW}
        {...overrides}
      />,
    );
  });
}

describe('each rung renders its own content (AC#1)', () => {
  test('the stream and snapshot rungs keep the canvas box, and draw no static plan', () => {
    for (const level of ['stream', 'snapshot'] as const) {
      renderAt(level);
      expect(container.querySelector('.live-map-canvas')).not.toBeNull();
      expect(container.querySelector('.static-map')).toBeNull();
      expect(container.querySelector('.live-informational')).toBeNull();
    }
  });

  test('the static rung draws the floor plan and names everyone on it', () => {
    renderAt('static-map');
    expect(container.querySelector('.static-map-plan')).not.toBeNull();
    // The roster, not the SVG, is the accessible content — the plan is `aria-hidden` because
    // the roster already says every fact it draws.
    const roster = container.querySelector('.static-map-roster');
    expect(roster).not.toBeNull();
    // The label the CAMERA targets carry, read off the same array rather than hard-coded:
    // the point of the rung is that the plan and the controls name people identically.
    const expected = targets.find((target) => target.kind === 'character')?.label ?? '';
    expect(expected.length).toBeGreaterThan(0);
    expect(roster?.textContent).toContain(expected);
    expect(container.querySelector('.static-map-plan')?.getAttribute('aria-hidden')).toBe('true');
  });

  test('the informational rung says there are no positions and offers the text view', () => {
    renderAt('informational');
    const block = container.querySelector('.live-informational');
    expect(block).not.toBeNull();
    expect(block?.textContent).toContain('沒有可顯示的角色位置');
    // Not a dead end: the non-map equivalent is offered here exactly as NFR-009 AC#3 requires
    // everywhere else, and with a touch-sized target rather than as a bare inline link.
    const link = block?.querySelector('a');
    expect(link?.getAttribute('href')).toContain('/live/');
    expect(link?.className).toContain('public-tap');
  });

  test('a static rung with no plan to draw renders nothing rather than an empty frame', () => {
    renderAt('static-map', { staticMap: null });
    expect(container.querySelector('.static-map')).toBeNull();
  });
});

describe('degrading does not restructure the page (AC#2, and ART-126’s contract)', () => {
  test.each(DEGRADATION_LEVELS)('at the %s rung the stage still has exactly two children', (level) => {
    renderAt(level);
    const stage = container.querySelector('.live-stage');
    expect(stage).not.toBeNull();
    expect(stage!.children).toHaveLength(2);
  });

  test.each(DEGRADATION_LEVELS)('at the %s rung the canvas box is still first', (level) => {
    renderAt(level);
    const stage = container.querySelector('.live-stage');
    expect(stage!.children[0].className).toContain('live-map-canvas');
  });

  test.each(DEGRADATION_LEVELS)('at the %s rung the scene panel and camera controls survive', (level) => {
    renderAt(level);
    // Degradation is about the MAP. Everything the page says about the world in words is
    // unaffected, which is the client-side half of AC#2 — the server-side half is that this
    // module never touches an Episode, arc or timeline model at all.
    expect(container.querySelector('.live-scene-panel, [aria-label]')).not.toBeNull();
    expect(container.textContent).toContain('改用文字實況');
  });

  test('the rung is exposed on the canvas box, so the stylesheet can relax the fixed height', () => {
    renderAt('static-map');
    // `.live-map-canvas` clamps its height for a canvas that scales to its container. A floor
    // plan plus a roster has an intrinsic height and would be cropped by that clamp — cropping
    // the list of where everyone is, on the rung whose job is saying where everyone is.
    expect(container.querySelector('.live-map-canvas')?.getAttribute('data-rung')).toBe('static-map');
  });
});

describe('every rung is labelled (AC#3)', () => {
  test.each(DEGRADATION_LEVELS)('the %s rung shows a status chip row and a last-updated chip', (level) => {
    renderAt(level);
    const notice = container.querySelector('.degradation-notice');
    expect(notice).not.toBeNull();
    expect(notice?.getAttribute('data-level')).toBe(level);
    expect(notice?.textContent).toContain('5 分鐘前更新');
  });

  test('the top rung is labelled too, so "no notice" never has to mean "probably fine"', () => {
    renderAt('stream');
    // A notice that only appeared when something was wrong would leave a viewer on the healthy
    // rung unable to tell "everything is fine" from "this page has no such feature".
    expect(container.querySelector('.degradation-notice')?.textContent).toContain('即時畫面');
  });

  test('the degraded rungs explain themselves, and the top rung has nothing to explain', () => {
    renderAt('snapshot');
    expect(container.querySelector('.degradation-notice')?.textContent).toContain('即時投影目前無法取得');

    renderAt('stream');
    const notice = container.querySelector('.degradation-notice');
    expect(notice?.querySelector('p')).toBeNull();
  });

  test('an unknown last-updated time renders no chip rather than an invented age', () => {
    renderAt('stream', { contentUpdatedAt: null });
    expect(container.querySelector('.degradation-notice')?.textContent).not.toContain('更新');
  });
});

describe('the renderer boundary (AC#4, AC#5)', () => {
  /** Throws on demand, so the boundary is exercised rather than described. */
  function Exploder({ boom }: { boom: boolean }): JSX.Element {
    if (boom) throw new Error('WebGL context lost');
    return <p className="alive">canvas</p>;
  }

  /** Swallows the re-thrown error React logs in development, keeping the run readable. */
  class Silence extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() { return this.state.failed ? null : this.props.children; }
  }

  let consoleError: ReturnType<typeof jest.spyOn>;
  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => consoleError.mockRestore());

  test('a throw is reported once, and the child is not rendered again', () => {
    const failures: number[] = [];
    act(() => {
      root.render(
        <Silence>
          <RendererErrorBoundary onFailure={() => failures.push(1)} resetKey="map-1">
            <Exploder boom />
          </RendererErrorBoundary>
        </Silence>,
      );
    });

    // Reported exactly once. A boundary that re-mounted its child would report repeatedly, and
    // repeatedly re-running a renderer that just threw is a crash loop against a live
    // deployment — the shape of thing that turns a rendering fault into load on everything
    // behind it.
    expect(failures).toHaveLength(1);
    expect(container.querySelector('.alive')).toBeNull();
  });

  test('the boundary renders nothing, so the page can put the static plan in its place', () => {
    act(() => {
      root.render(
        <Silence>
          <RendererErrorBoundary resetKey="map-1">
            <Exploder boom />
          </RendererErrorBoundary>
        </Silence>,
      );
    });
    // Not a message: the page has already been told and shows the reason itself. Two
    // explanations of one failure on one screen is worse than either alone.
    expect(container.textContent).toBe('');
  });

  test('the latch clears when the map identity changes, and only then', () => {
    function Host({ resetKey, boom }: { resetKey: string; boom: boolean }) {
      return (
        <Silence>
          <RendererErrorBoundary resetKey={resetKey}>
            <Exploder boom={boom} />
          </RendererErrorBoundary>
        </Silence>
      );
    }

    act(() => root.render(<Host resetKey="map-1" boom />));
    expect(container.querySelector('.alive')).toBeNull();

    // Same map, renderer now healthy: STILL latched. Re-attempting on a whim is the retry the
    // ladder must not have.
    act(() => root.render(<Host resetKey="map-1" boom={false} />));
    expect(container.querySelector('.alive')).toBeNull();

    // A different map is a genuinely different thing to draw, and worth one attempt.
    act(() => root.render(<Host resetKey="map-2" boom={false} />));
    expect(container.querySelector('.alive')).not.toBeNull();
  });

  test('nothing in the failure path schedules work or reaches the network (AC#4)', () => {
    const fetchSpy = jest.fn();
    const originalFetch = globalThis.fetch;
    const timeoutSpy = jest.spyOn(globalThis, 'setTimeout');
    const intervalSpy = jest.spyOn(globalThis, 'setInterval');
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    try {
      act(() => {
        root.render(
          <Silence>
            <RendererErrorBoundary onFailure={() => undefined} resetKey="map-1">
              <Exploder boom />
            </RendererErrorBoundary>
          </Silence>,
        );
      });
      // The behavioural half of "renderer failure never triggers an LLM retry". It cannot
      // prove absence on its own — `liveMapSurface.test.ts` reads every file in the module for
      // that — but a retry added here would fail this immediately.
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(timeoutSpy).not.toHaveBeenCalled();
      expect(intervalSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      timeoutSpy.mockRestore();
      intervalSpy.mockRestore();
    }
  });

  test('recovery climbs back with no intervening render of a lower rung', () => {
    function Host() {
      const [degraded, setDegraded] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setDegraded(false)}>recover</button>
          <LiveMapView
            worldId={WORLD_ID}
            base="/ai-town/"
            viewModel={viewModel}
            targets={targets}
            primaryLocationId={null}
            storyOverlay={storyOverlay}
            webglSupported
            loading={false}
            degradation={degraded ? VERDICTS.snapshot : VERDICTS.stream}
            staticMap={staticMap}
            nowMs={NOW}
          />
        </>
      );
    }

    act(() => root.render(<Host />));
    expect(container.querySelector('.degradation-notice')?.getAttribute('data-level')).toBe('snapshot');

    act(() => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // AC#5. Nothing was retried and nothing was remounted: the level is a function of the
    // props, so restoring the condition restores the rung on the very next render.
    expect(container.querySelector('.degradation-notice')?.getAttribute('data-level')).toBe('stream');
  });
});

/**
 * Every `useQuery(...)` call, extracted by balancing parentheses rather than by regex.
 *
 * A lazy regex stops at the first `)` and misses the argument that matters; a greedy one
 * swallows the file and makes the assertion below vacuously about everything. Both were tried.
 */
function useQueryCalls(source: string): string[] {
  const calls: string[] = [];
  const needle = 'useQuery(';
  for (let start = source.indexOf(needle); start !== -1; start = source.indexOf(needle, start + 1)) {
    let depth = 0;
    for (let index = start + needle.length - 1; index < source.length; index += 1) {
      if (source[index] === '(') depth += 1;
      else if (source[index] === ')') {
        depth -= 1;
        if (depth === 0) {
          calls.push(source.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return calls;
}

describe('the page cannot make degradation change what it reads (AC#4)', () => {
  const PAGE = readFileSync(new URL('./LiveMapPage.tsx', import.meta.url), 'utf8');

  test('no useQuery call mentions the ladder', () => {
    // The naive implementation re-subscribes on degradation — a `key`, a conditional read, a
    // `'skip'` that flips with the level. Any of those turns a renderer fault into query churn
    // against a deployment that is already having a bad time. Read off the source, because the
    // property is "the query set does not depend on the level" and that is a fact about the
    // code rather than about any one run.
    const calls = useQueryCalls(PAGE);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).not.toMatch(/degradation|rendererFailed|staticMap/);
    }
  });

  test('the view is not keyed on the level, which would remount the whole subtree', () => {
    expect(PAGE).not.toMatch(/key=\{[^}]*degradation/);
  });

  test('the renderer latch is cleared by the map identity, never by a clock', () => {
    const boundary = readFileSync(new URL('./RendererErrorBoundary.tsx', import.meta.url), 'utf8');
    expect(boundary).not.toMatch(/\b(setTimeout|setInterval|requestAnimationFrame|Date\.now)\b/);
  });
});
