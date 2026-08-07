/**
 * The camera's correctness boundaries (ART-118, FR-O001 AC#1/#3/#5/#6).
 *
 * Everything asserted here is decidable without a browser: which places the
 * camera can be pointed at, which one a mode resolves to, how far it zooms, and
 * how long the move takes. The gesture itself (a finger dragging the canvas) is
 * pixi-viewport's and is covered by the recorded manual browser pass in
 * `docs/live-view-navigation.md`.
 *
 * Pure jest (no jsdom): the module under test has no React/Pixi/DOM deps.
 */

import { mistwoodLocationFootprints, mistwoodWorldMap } from '../../../data/mistwood';
import {
  CAMERA_MAX_TRANSITION_MS,
  CAMERA_MIN_TRANSITION_MS,
  FOCUS_ZOOM_MULTIPLIER,
  INITIAL_CAMERA_MODE,
  MAX_CAMERA_SCALE,
  MAX_ZOOM_STEP,
  MIN_CAMERA_SCALE,
  MIN_ZOOM_STEP,
  TOWN_TARGET_ID,
  cameraTransitionMs,
  characterTargetId,
  clampScale,
  clampZoomStep,
  fitScale,
  focusTargetsFrom,
  locationTargetId,
  nextCamera,
  nextZoomStep,
  primaryLocationId,
  primarySceneLocationId,
  resolveFocusTarget,
  sceneTargetId,
  townView,
  type CameraMode,
  type CameraViewport,
} from './cameraModel';
import type { PublicCharacterMotion } from './worldViewModel';

const WORLD_WIDTH = mistwoodWorldMap.width * mistwoodWorldMap.tileDim;
const WORLD_HEIGHT = mistwoodWorldMap.height * mistwoodWorldMap.tileDim;

function viewport(overrides: Partial<CameraViewport> = {}): CameraViewport {
  return {
    screenWidth: 1024,
    screenHeight: 768,
    worldWidth: WORLD_WIDTH,
    worldHeight: WORLD_HEIGHT,
    ...overrides,
  };
}

function motion(overrides: Partial<PublicCharacterMotion> = {}): PublicCharacterMotion {
  return {
    characterId: 'cassia',
    semanticLocationId: 'mistwood-square',
    motionType: 'canon',
    motionSequence: 1,
    from: { x: 6, y: 18 },
    to: { x: 6, y: 18 },
    startedAt: 0,
    arriveAt: 0,
    animationState: 'idle',
    direction: 'down',
    ...overrides,
  };
}

function targets(motions: PublicCharacterMotion[] = []) {
  return focusTargetsFrom({
    motions,
    footprints: mistwoodLocationFootprints,
    map: mistwoodWorldMap,
    nowMs: 0,
  });
}

function mode(overrides: Partial<CameraMode> = {}): CameraMode {
  return { ...INITIAL_CAMERA_MODE, ...overrides };
}

// ---------------------------------------------------------------------------
// AC#1 — the whole town fits, at every viewport size.
// ---------------------------------------------------------------------------

describe('fitScale (AC#1)', () => {
  test.each([
    ['desktop', 1440, 900],
    ['laptop', 1024, 768],
    ['tablet', 834, 1112],
    ['phone', 390, 664],
  ])('%s frames the whole map without cropping it', (_name, screenWidth, screenHeight) => {
    const view = viewport({ screenWidth, screenHeight });
    const scale = fitScale(view);
    expect(WORLD_WIDTH * scale).toBeLessThanOrEqual(screenWidth + 0.001);
    expect(WORLD_HEIGHT * scale).toBeLessThanOrEqual(screenHeight + 0.001);
    // ...and it is the *largest* such scale: one axis is filled exactly.
    const filled =
      Math.abs(WORLD_WIDTH * scale - screenWidth) < 0.001 ||
      Math.abs(WORLD_HEIGHT * scale - screenHeight) < 0.001;
    expect(filled).toBe(true);
  });

  test('a viewport with no usable axis falls back to the floor, not 0/Infinity/NaN', () => {
    for (const broken of [
      viewport({ screenWidth: 0, screenHeight: 0 }),
      viewport({ worldWidth: 0, worldHeight: 0 }),
      viewport({ screenWidth: Number.NaN, screenHeight: Number.NaN }),
      viewport({ screenWidth: -100, screenHeight: -100 }),
    ]) {
      expect(fitScale(broken)).toBe(MIN_CAMERA_SCALE);
    }
  });

  test('one broken axis still yields a finite scale from the other', () => {
    for (const partial of [viewport({ screenHeight: Number.NaN }), viewport({ screenWidth: 0 })]) {
      const scale = fitScale(partial);
      expect(Number.isFinite(scale)).toBe(true);
      expect(scale).toBeGreaterThan(0);
    }
  });

  test('the town view is the fitted frame, centred on the map', () => {
    const view = townView(viewport());
    expect(view.centerX).toBe(WORLD_WIDTH / 2);
    expect(view.centerY).toBe(WORLD_HEIGHT / 2);
    expect(view.scale).toBe(fitScale(viewport()));
  });
});

// ---------------------------------------------------------------------------
// AC#6 — no runaway zoom, under any input.
// ---------------------------------------------------------------------------

describe('clampScale (AC#6)', () => {
  test('stays inside its bounds for every pathological input', () => {
    const inputs = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      1e308,
      -1e308,
      0,
      -0,
      -1,
      1e-12,
    ];
    for (const value of inputs) {
      const clamped = clampScale(value, 0.5, 3);
      expect(Number.isFinite(clamped)).toBe(true);
      expect(clamped).toBeGreaterThanOrEqual(0.5);
      expect(clamped).toBeLessThanOrEqual(3);
    }
  });

  test('broken bounds fall back to the module constants rather than propagating', () => {
    expect(clampScale(0.0001, Number.NaN, Number.NaN)).toBe(MIN_CAMERA_SCALE);
    expect(clampScale(99, Number.NaN, Number.NaN)).toBe(MAX_CAMERA_SCALE);
    expect(clampScale(Number.NaN, Number.NaN, Number.NaN)).toBe(MIN_CAMERA_SCALE);
    // An inverted pair cannot produce min > max.
    const clamped = clampScale(2, 1, 0.5);
    expect(clamped).toBeGreaterThanOrEqual(1);
  });

  test('zoom steps saturate rather than accumulating without bound', () => {
    let step = 0;
    for (let i = 0; i < 100; i += 1) step = nextZoomStep(step, 1);
    expect(step).toBe(MAX_ZOOM_STEP);
    for (let i = 0; i < 100; i += 1) step = nextZoomStep(step, -1);
    expect(step).toBe(MIN_ZOOM_STEP);
    expect(clampZoomStep(Number.NaN)).toBe(0);
  });

  test('repeated zoom-in never leaves the [fitScale, MAX] band', () => {
    const view = viewport();
    const fit = fitScale(view);
    let step = 0;
    for (let i = 0; i < 50; i += 1) {
      step = nextZoomStep(step, 1);
      const camera = nextCamera({
        mode: mode({ zoomStep: step }),
        targets: targets(),
        primaryLocationId: null,
        viewport: view,
        reducedMotion: false,
        previous: null,
      });
      expect(camera.scale).toBeGreaterThanOrEqual(fit);
      expect(camera.scale).toBeLessThanOrEqual(MAX_CAMERA_SCALE);
    }
  });
});

describe('cameraTransitionMs (AC#6)', () => {
  test('Reduced Motion snaps: no animation is scheduled at all', () => {
    for (const distancePx of [0, 10, 500, 100000, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(cameraTransitionMs({ reducedMotion: true, distancePx })).toBe(0);
    }
  });

  test('a move of no distance also snaps', () => {
    expect(cameraTransitionMs({ reducedMotion: false, distancePx: 0 })).toBe(0);
    expect(cameraTransitionMs({ reducedMotion: false, distancePx: Number.NaN })).toBe(0);
  });

  test('a real move is bounded on both ends', () => {
    expect(cameraTransitionMs({ reducedMotion: false, distancePx: 1 })).toBeGreaterThanOrEqual(
      CAMERA_MIN_TRANSITION_MS,
    );
    expect(cameraTransitionMs({ reducedMotion: false, distancePx: 1e9 })).toBe(
      CAMERA_MAX_TRANSITION_MS,
    );
    expect(
      cameraTransitionMs({ reducedMotion: false, distancePx: Number.POSITIVE_INFINITY }),
    ).toBe(CAMERA_MAX_TRANSITION_MS);
  });

  test('a Reduced Motion camera snaps end to end, not just in the helper', () => {
    const view = viewport();
    const all = targets([motion()]);
    const camera = nextCamera({
      mode: mode({ focusId: locationTargetId('mistwood-mill') }),
      targets: all,
      primaryLocationId: null,
      viewport: view,
      reducedMotion: true,
      previous: townView(view),
    });
    expect(camera.transitionMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — everything the camera can be pointed at.
// ---------------------------------------------------------------------------

describe('focusTargetsFrom (AC#3)', () => {
  test('yields the town, all eight locations and one target per character', () => {
    const all = targets([
      motion({ characterId: 'cassia' }),
      motion({ characterId: 'rowan', semanticLocationId: 'mistwood-mill' }),
    ]);
    expect(all.filter((target) => target.kind === 'town')).toHaveLength(1);
    expect(all.filter((target) => target.kind === 'location')).toHaveLength(8);
    expect(all.filter((target) => target.kind === 'character')).toHaveLength(2);
    expect(all[0].id).toBe(TOWN_TARGET_ID);
    expect(all.map((target) => target.id)).toContain(locationTargetId('mistwood-square'));
    expect(all.map((target) => target.id)).toContain(characterTargetId('rowan'));
    // Every label is human-readable, since it is also a button's accessible name.
    for (const target of all) expect(target.label.length).toBeGreaterThan(0);
  });

  test('a location target sits at the centre of its footprint, in world pixels', () => {
    const square = mistwoodLocationFootprints.find((f) => f.id === 'mistwood-square')!;
    const target = targets().find((t) => t.id === locationTargetId('mistwood-square'))!;
    expect(target.point).toEqual({
      x: (square.rect.x + square.rect.width / 2) * mistwoodWorldMap.tileDim,
      y: (square.rect.y + square.rect.height / 2) * mistwoodWorldMap.tileDim,
    });
    expect(target.label).toBe(square.name);
  });

  test('several motions for one character collapse to the latest one', () => {
    const all = targets([
      motion({ characterId: 'cassia', motionSequence: 1, from: { x: 2, y: 2 }, to: { x: 2, y: 2 } }),
      motion({ characterId: 'cassia', motionSequence: 7, from: { x: 9, y: 9 }, to: { x: 9, y: 9 } }),
    ]);
    const characters = all.filter((target) => target.kind === 'character');
    expect(characters).toHaveLength(1);
    expect(characters[0].point).toEqual({
      x: 9 * mistwoodWorldMap.tileDim,
      y: 9 * mistwoodWorldMap.tileDim,
    });
  });

  test('a walking character is targeted where it is, not where it started', () => {
    const walking = motion({
      characterId: 'cassia',
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
      startedAt: 0,
      arriveAt: 100,
      animationState: 'walking',
    });
    const halfway = focusTargetsFrom({
      motions: [walking],
      footprints: mistwoodLocationFootprints,
      map: mistwoodWorldMap,
      nowMs: 50,
    }).find((target) => target.kind === 'character')!;
    expect(halfway.point.x).toBeCloseTo(5 * mistwoodWorldMap.tileDim);
  });

  test('focusing a target centres on it and zooms in past the town view', () => {
    const view = viewport();
    const all = targets();
    const town = nextCamera({
      mode: mode({ follow: false }),
      targets: all,
      primaryLocationId: null,
      viewport: view,
      reducedMotion: false,
      previous: null,
    });
    const focused = nextCamera({
      mode: mode({ focusId: locationTargetId('mistwood-inn') }),
      targets: all,
      primaryLocationId: null,
      viewport: view,
      reducedMotion: false,
      previous: town,
    });
    const inn = all.find((target) => target.id === locationTargetId('mistwood-inn'))!;
    expect(focused.centerX).toBe(inn.point.x);
    expect(focused.centerY).toBe(inn.point.y);
    expect(focused.scale).toBeGreaterThan(town.scale);
    expect(focused.scale).toBeCloseTo(
      Math.min(fitScale(view) * FOCUS_ZOOM_MULTIPLIER, MAX_CAMERA_SCALE),
    );
    expect(focused.transitionMs).toBeGreaterThan(0);
  });

  test('returning to the town view re-frames the whole map', () => {
    const view = viewport();
    const town = nextCamera({
      mode: mode({ follow: false, focusId: null }),
      targets: targets(),
      primaryLocationId: 'mistwood-mill',
      viewport: view,
      reducedMotion: false,
      previous: null,
    });
    expect(town.centerX).toBe(WORLD_WIDTH / 2);
    expect(town.centerY).toBe(WORLD_HEIGHT / 2);
    expect(town.scale).toBe(fitScale(view));
  });

  test('a focus id that no longer resolves degrades to the town view', () => {
    const camera = nextCamera({
      mode: mode({ focusId: characterTargetId('someone-who-left') }),
      targets: targets(),
      primaryLocationId: null,
      viewport: viewport(),
      reducedMotion: false,
      previous: null,
    });
    expect(camera.centerX).toBe(WORLD_WIDTH / 2);
    expect(camera.scale).toBe(fitScale(viewport()));
  });
});

// ---------------------------------------------------------------------------
// AC#5 — auto-follow, and turning it off.
// ---------------------------------------------------------------------------

describe('scene focus targets (FR-O003 / ART-122 AC#1/#3)', () => {
  const HALL = 'mistwood-hall';
  const hallFootprint = mistwoodLocationFootprints.find((footprint) => footprint.id === HALL)!;

  test('every placeable scene yields one target at its location footprint centre', () => {
    const all = focusTargetsFrom({
      motions: [],
      footprints: mistwoodLocationFootprints,
      map: mistwoodWorldMap,
      nowMs: 0,
      scenes: [{ sceneId: `3:evening:${HALL}`, locationId: HALL, title: '簽約', status: 'active' }],
    });
    const scenes = all.filter((target) => target.kind === 'scene');
    expect(scenes).toHaveLength(1);
    expect(scenes[0].id).toBe(sceneTargetId(`3:evening:${HALL}`));
    expect(scenes[0].label).toBe('簽約');
    // The same point the location target for that footprint resolves to: a scene *is*
    // somewhere, it does not have geometry of its own.
    const location = all.find((target) => target.id === locationTargetId(HALL))!;
    expect(scenes[0].point).toEqual(location.point);
    expect(scenes[0].point).toEqual({
      x: (hallFootprint.rect.x + hallFootprint.rect.width / 2) * mistwoodWorldMap.tileDim,
      y: (hallFootprint.rect.y + hallFootprint.rect.height / 2) * mistwoodWorldMap.tileDim,
    });
  });

  test('skips a scene the map cannot place rather than centring it at the origin', () => {
    const scenes = focusTargetsFrom({
      motions: [],
      footprints: mistwoodLocationFootprints,
      map: mistwoodWorldMap,
      nowMs: 0,
      scenes: [
        { sceneId: 's1', locationId: 'nowhere-at-all', title: 'x' },
        { sceneId: 's2', title: 'no location at all' },
        { locationId: HALL, title: 'no scene id' },
      ],
    }).filter((target) => target.kind === 'scene');
    expect(scenes).toEqual([]);
  });

  test('focusing a scene centres the camera on its location', () => {
    const all = focusTargetsFrom({
      motions: [],
      footprints: mistwoodLocationFootprints,
      map: mistwoodWorldMap,
      nowMs: 0,
      scenes: [{ sceneId: 'sc', locationId: HALL, title: '簽約' }],
    });
    const resolved = resolveFocusTarget({
      mode: mode({ focusId: sceneTargetId('sc') }),
      targets: all,
      primaryLocationId: null,
    });
    expect(resolved?.kind).toBe('scene');
    expect(resolved?.point).toEqual(all.find((target) => target.id === locationTargetId(HALL))!.point);
  });

  test('an unresolvable scene focus degrades to the town view rather than freezing', () => {
    expect(resolveFocusTarget({
      mode: mode({ focusId: sceneTargetId('scene-that-ended') }),
      targets: targets(),
      primaryLocationId: null,
    })).toBeNull();
  });
});

describe('primarySceneLocationId (FR-O003 AC#3) and its documented fallback', () => {
  test('prefers an active scene over an ended one', () => {
    expect(primarySceneLocationId([
      { sceneId: 'a', locationId: 'mistwood-mill', status: 'ended' },
      { sceneId: 'b', locationId: 'mistwood-hall', status: 'active' },
    ])).toBe('mistwood-hall');
  });

  test('uses the degraded ended scene when no scene is active', () => {
    expect(primarySceneLocationId([{ sceneId: 'a', locationId: 'mistwood-mill', status: 'ended' }]))
      .toBe('mistwood-mill');
  });

  test('is null for no scenes and for scenes the payload could not place', () => {
    expect(primarySceneLocationId([])).toBeNull();
    // A payload persisted before ART-122 carries scenes with no locationId at all; the
    // caller then falls back to the character-density heuristic rather than to nothing.
    expect(primarySceneLocationId([{ sceneId: 'a', status: 'active' }])).toBeNull();
  });
});

describe('primaryLocationId, the documented fallback for scene-less worlds', () => {
  test('is the location holding the most characters', () => {
    expect(
      primaryLocationId([
        motion({ characterId: 'a', semanticLocationId: 'mistwood-mill' }),
        motion({ characterId: 'b', semanticLocationId: 'mistwood-mill' }),
        motion({ characterId: 'c', semanticLocationId: 'mistwood-square' }),
      ]),
    ).toBe('mistwood-mill');
  });

  test('breaks ties by ascending locationId, so it is deterministic', () => {
    const tie = [
      motion({ characterId: 'a', semanticLocationId: 'mistwood-square' }),
      motion({ characterId: 'b', semanticLocationId: 'mistwood-inn' }),
    ];
    expect(primaryLocationId(tie)).toBe('mistwood-inn');
    expect(primaryLocationId([...tie].reverse())).toBe('mistwood-inn');
  });

  test('counts characters, not motion units', () => {
    expect(
      primaryLocationId([
        motion({ characterId: 'a', motionSequence: 1, semanticLocationId: 'mistwood-mill' }),
        motion({ characterId: 'a', motionSequence: 2, semanticLocationId: 'mistwood-mill' }),
        motion({ characterId: 'b', semanticLocationId: 'mistwood-clinic' }),
      ]),
    ).toBe('mistwood-clinic');
  });

  test('is null when nothing is published', () => {
    expect(primaryLocationId([])).toBeNull();
  });
});

describe('auto-follow (AC#5)', () => {
  const all = targets();
  const view = viewport();

  test('follows the primary location while it is on', () => {
    const target = resolveFocusTarget({
      mode: mode({ follow: true, focusId: null }),
      targets: all,
      primaryLocationId: 'mistwood-orchard',
    });
    expect(target?.id).toBe(locationTargetId('mistwood-orchard'));
  });

  test('turning it off pins the camera: the primary location no longer moves it', () => {
    const off = mode({ follow: false, focusId: null });
    const before = nextCamera({
      mode: off,
      targets: all,
      primaryLocationId: 'mistwood-mill',
      viewport: view,
      reducedMotion: false,
      previous: null,
    });
    const after = nextCamera({
      mode: off,
      targets: all,
      primaryLocationId: 'mistwood-orchard',
      viewport: view,
      reducedMotion: false,
      previous: before,
    });
    expect(after.centerX).toBe(before.centerX);
    expect(after.centerY).toBe(before.centerY);
    expect(after.scale).toBe(before.scale);
    // Nothing moved, so nothing is animated either.
    expect(after.transitionMs).toBe(0);
  });

  test('an explicit focus overrides auto-follow', () => {
    const target = resolveFocusTarget({
      mode: mode({ follow: true, focusId: locationTargetId('mistwood-station') }),
      targets: all,
      primaryLocationId: 'mistwood-mill',
    });
    expect(target?.id).toBe(locationTargetId('mistwood-station'));
  });
});
