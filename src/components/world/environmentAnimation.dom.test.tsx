/**
 * Environmental animation, and the Reduced Motion defect it fixed (ART-120 / FR-O012).
 *
 * Two claims are proved here, and the second one is a bug that had been live since ART-113:
 *
 * 1. **The environment animates without touching the world (AC#7).** `PixiStaticMap` is a
 *    `PixiComponent`, not a React component — it builds a display object directly, and doing
 *    that for real needs a GPU-backed texture. So the decision it makes is exported and called
 *    against stub sprites, and the wiring that calls it is pinned structurally.
 * 2. **Reduced Motion actually stops it (AC#8).** The mill wheel and the water used to set
 *    `autoUpdate = true` and call `play()` unconditionally, so a viewer who had asked their
 *    whole operating system to stop animating things still got a turning waterwheel. The
 *    preference was threaded to the camera and to nothing else.
 *
 * `jsdom` is needed only to import `@pixi/react`; nothing here mounts a stage or needs WebGL.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ReactElement } from 'react';
import type * as PIXI from 'pixi.js';

import { mistwoodAnimatedSprites, mistwoodWorldMap } from '../../../data/mistwood';
import { DayNightLayer } from './DayNightLayer';
import { setEnvironmentAnimationPlaying } from './PixiStaticMap';
import { dayNightTintFor, NO_TINT } from './dayNightTint';

/**
 * A stand-in for `PIXI.AnimatedSprite` that records what was asked of it.
 *
 * The real class needs a GPU-backed texture; what this test is about is which of `play`,
 * `stop` and `gotoAndStop` were called and what `autoUpdate` ended up as, none of which
 * requires one.
 */
class SpriteStub {
  autoUpdate = true;
  playing = false;
  frame = 3;
  readonly calls: string[] = [];

  play(): void {
    this.calls.push('play');
    this.playing = true;
  }

  gotoAndStop(frame: number): void {
    this.calls.push(`gotoAndStop(${frame})`);
    this.playing = false;
    this.frame = frame;
  }
}

/** The container shape `PixiStaticMap` attaches its bookkeeping to. */
type MapContainer = {
  environmentSprites: SpriteStub[];
  reducedMotion: boolean;
};

/**
 * Drives the real decision `PixiStaticMap` makes, against stub sprites.
 *
 * The production function is called, not a copy of it: a reimplementation here would keep
 * passing if the fix were reverted, which is the one thing this test exists to catch. What is
 * stubbed is only `AnimatedSprite`, because the real class needs a GPU-backed texture and this
 * test is about which methods get called, not about what they draw.
 */
function applyReducedMotion(container: MapContainer, reducedMotion: boolean): void {
  container.reducedMotion = reducedMotion;
  setEnvironmentAnimationPlaying(
    container.environmentSprites as unknown as PIXI.AnimatedSprite[],
    !reducedMotion,
  );
}

function containerWith(spriteCount: number): MapContainer {
  return {
    environmentSprites: Array.from({ length: spriteCount }, () => new SpriteStub()),
    reducedMotion: false,
  };
}

/** Every element in the tree, parents before children. */
function elements(node: unknown): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object') return [];
  const element = node as ReactElement;
  if (element.props === undefined) return [];
  return [element, ...elements(element.props.children)];
}

/** Records the Pixi drawing calls a `draw` callback makes. */
function recordDrawing(tree: ReactElement): string[] {
  const calls: string[] = [];
  const graphics = elements(tree).find(
    (element) => typeof (element.props as { draw?: unknown }).draw === 'function',
  );
  expect(graphics).toBeDefined();
  const stub = {
    clear: () => calls.push('clear'),
    beginFill: (fill: number, alpha: number) => calls.push(`beginFill(${fill},${alpha})`),
    endFill: () => calls.push('endFill'),
    drawRect: (...args: number[]) => calls.push(`rect(${args.join(',')})`),
  };
  (graphics!.props as { draw: (g: PIXI.Graphics) => void }).draw(stub as unknown as PIXI.Graphics);
  return calls;
}

describe('FR-O012 AC#8 — Reduced Motion stops the environment', () => {
  test('stops every animated sprite and parks it on frame 0', () => {
    const container = containerWith(mistwoodAnimatedSprites.length);
    applyReducedMotion(container, true);

    for (const sprite of container.environmentSprites) {
      expect(sprite.playing).toBe(false);
      expect(sprite.autoUpdate).toBe(false);
      // `gotoAndStop(0)` rather than a bare `stop()`: stopping alone freezes a flame on
      // whichever half-drawn frame it reached, which looks like a rendering fault.
      expect(sprite.frame).toBe(0);
      expect(sprite.calls).toEqual(['gotoAndStop(0)']);
    }
  });

  test('starts them again when the preference is turned off mid-session', () => {
    // `prefers-reduced-motion` is a live media query; a viewer can change it without
    // reloading, and `useReducedMotion` already subscribes to `change`.
    const container = containerWith(3);
    applyReducedMotion(container, true);
    applyReducedMotion(container, false);

    for (const sprite of container.environmentSprites) {
      expect(sprite.playing).toBe(true);
      expect(sprite.autoUpdate).toBe(true);
    }
  });

  test('the component wires the preference in rather than ignoring it', () => {
    // The structural half of the fix, stated the way `readOnlyWorldSurface.test.ts` states
    // its claims: the two lines that caused the defect — an unconditional `play()` and an
    // unconditional `autoUpdate = true` — must not come back.
    const source = readFileSync(join(process.cwd(), 'src/components/world/PixiStaticMap.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/autoUpdate\s*=\s*true/);
    expect(source).not.toMatch(/pixiSprite\.play\(\)/);
    expect(source).toContain('setEnvironmentAnimationPlaying');
    expect(source).toContain('reducedMotion');
  });

  test('covers every animated sprite the map authors, not a subset', () => {
    // The regression this replaces was partial coverage of a different kind: the preference
    // reached the camera and stopped there. So the count is asserted against the real map.
    expect(mistwoodAnimatedSprites.length).toBeGreaterThan(5);
    const container = containerWith(mistwoodAnimatedSprites.length);
    applyReducedMotion(container, true);
    expect(container.environmentSprites.filter((sprite) => sprite.playing)).toHaveLength(0);
  });
});

describe('FR-O012 AC#7 — environmental animation modifies no world state', () => {
  test('the sprite list is a build-time constant with no query, handler or id in it', () => {
    for (const sprite of mistwoodAnimatedSprites) {
      expect(Object.keys(sprite).sort()).toEqual(
        ['animation', 'h', 'layer', 'sheet', 'w', 'x', 'y'].sort(),
      );
    }
  });

  test('the day/night wash is mute and cannot swallow a pointer event', () => {
    // A rectangle covering the whole map would otherwise intercept every drag and scroll on
    // the canvas, which would be a novel way to break panning.
    const tree = DayNightLayer({ timeSlot: 'night', worldWidth: 100, worldHeight: 80 })!;
    expect(tree.props.eventMode).toBe('none');
    for (const element of elements(tree)) {
      const offenders = Object.keys(element.props as Record<string, unknown>).filter(
        (name) => /^on[A-Z]/.test(name) || /^(pointer|click|tap|mouse)/.test(name),
      );
      expect(offenders).toEqual([]);
    }
  });
});

describe('the day/night wash follows Canon, never a wall clock (FR-O012)', () => {
  test('draws one full-map rectangle in the slot colour', () => {
    const width = mistwoodWorldMap.width * mistwoodWorldMap.tileDim;
    const height = mistwoodWorldMap.height * mistwoodWorldMap.tileDim;
    const calls = recordDrawing(
      DayNightLayer({ timeSlot: 'evening', worldWidth: width, worldHeight: height })!,
    );
    const evening = dayNightTintFor('evening');
    expect(calls).toEqual([
      'clear',
      `beginFill(${evening.colour},${evening.alpha})`,
      `rect(0,0,${width},${height})`,
      'endFill',
    ]);
  });

  test('gives the five Canon slots five distinguishable washes', () => {
    const washes = ['morning', 'noon', 'afternoon', 'evening', 'night'].map((slot) =>
      JSON.stringify(dayNightTintFor(slot)),
    );
    expect(new Set(washes).size).toBe(5);
    // Night is the heaviest and noon is untinted: the art was drawn in midday light.
    expect(dayNightTintFor('night').alpha).toBeGreaterThan(dayNightTintFor('morning').alpha);
    expect(dayNightTintFor('noon')).toEqual(NO_TINT);
  });

  test('draws nothing at all without a published slot', () => {
    // A world with no accepted history has not had a time of day. Guessing one — from the
    // viewer's clock, say — would be the map asserting a world fact nobody accepted, which is
    // exactly the RISK2-008 failure this whole feature is built around avoiding.
    expect(DayNightLayer({ timeSlot: undefined, worldWidth: 10, worldHeight: 10 })).toBeNull();
    expect(DayNightLayer({ timeSlot: 'noon', worldWidth: 10, worldHeight: 10 })).toBeNull();
  });

  test('degrades to no wash for a slot vocabulary this build predates', () => {
    // Refusing to draw the town because Canon grew a sixth slot would be a far worse failure
    // than drawing it in daylight. Same stance `timeBucketForSlot` takes in the runtime.
    expect(dayNightTintFor('midwinter-dusk')).toEqual(NO_TINT);
    expect(DayNightLayer({ timeSlot: 'midwinter-dusk', worldWidth: 10, worldHeight: 10 })).toBeNull();
  });
});
