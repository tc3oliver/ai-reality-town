/**
 * The animation clock ticks, gates and stops (ART-119 / FR-O002 AC#7).
 *
 * `startMotionClock` is split out of `useMotionClock` for the same reason
 * `observeElementSize` is split out of `useElementSize`: the behaviour that
 * matters is the gate and the teardown, and a leaked animation frame keeps a
 * detached canvas alive on every route change -- which no test that merely
 * rendered the hook would catch.
 *
 * `jsdom` is needed only for `requestAnimationFrame`; nothing here mounts a
 * component or renders markup.
 */

import { jest } from '@jest/globals';

import { startMotionClock } from './useMotionClock';

/** A controllable rAF: frames fire only when the test says so. */
function installFrameLoop() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextHandle = 1;
  const realRaf = globalThis.requestAnimationFrame;
  const realCancel = globalThis.cancelAnimationFrame;

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const handle = nextHandle++;
    callbacks.set(handle, callback);
    return handle;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((handle: number) => {
    callbacks.delete(handle);
  }) as typeof globalThis.cancelAnimationFrame;

  return {
    /** Run every currently-scheduled callback once. */
    advanceOneFrame() {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pending) callback(0);
    },
    get scheduled() {
      return callbacks.size;
    },
    restore() {
      globalThis.requestAnimationFrame = realRaf;
      globalThis.cancelAnimationFrame = realCancel;
    },
  };
}

describe('startMotionClock', () => {
  let frames: ReturnType<typeof installFrameLoop>;
  let clock = 0;
  let nowSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    frames = installFrameLoop();
    clock = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    frames.restore();
    nowSpy.mockRestore();
  });

  test('emits at most once per interval, however many frames the browser draws', () => {
    const ticks: number[] = [];
    const stop = startMotionClock(() => 100, (nowMs) => ticks.push(nowMs));

    // A 60Hz display over one second: sixty frames, ten of which may pass the
    // 100ms gate. This is the whole point of the tier mechanism.
    for (let frame = 0; frame < 60; frame++) {
      clock += 1000 / 60;
      frames.advanceOneFrame();
    }
    stop();

    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThanOrEqual(11);
  });

  test('a faster tier really does emit more often over the same wall time', () => {
    const count = (intervalMs: number) => {
      let ticks = 0;
      const stop = startMotionClock(() => intervalMs, () => (ticks += 1));
      const start = clock;
      while (clock - start < 1_000) {
        clock += 1000 / 60;
        frames.advanceOneFrame();
      }
      stop();
      return ticks;
    };

    const at60 = count(1000 / 60);
    const at10 = count(1000 / 10);
    expect(at60).toBeGreaterThan(at10);
  });

  test('re-reads the interval each frame, so a tier change needs no restart', () => {
    let intervalMs = 1_000_000;
    const ticks: number[] = [];
    const stop = startMotionClock(() => intervalMs, (nowMs) => ticks.push(nowMs));

    clock += 500;
    frames.advanceOneFrame();
    expect(ticks).toHaveLength(0);

    intervalMs = 10;
    clock += 500;
    frames.advanceOneFrame();
    expect(ticks).toHaveLength(1);
    stop();
  });

  test('a zero or malformed interval is floored rather than spinning the gate open', () => {
    for (const intervalMs of [0, -1, Number.NaN, Infinity]) {
      const ticks: number[] = [];
      const stop = startMotionClock(() => intervalMs, (nowMs) => ticks.push(nowMs));
      clock += 5;
      frames.advanceOneFrame();
      stop();
      expect(ticks.length).toBeLessThanOrEqual(1);
    }
  });

  test('the teardown actually cancels the loop', () => {
    const ticks: number[] = [];
    const stop = startMotionClock(() => 1, (nowMs) => ticks.push(nowMs));
    clock += 100;
    frames.advanceOneFrame();
    const afterOneFrame = ticks.length;

    stop();
    expect(frames.scheduled).toBe(0);

    clock += 100;
    frames.advanceOneFrame();
    expect(ticks).toHaveLength(afterOneFrame);
  });

  test('degrades to a no-op where there is no animation frame at all', () => {
    frames.restore();
    const realRaf = globalThis.requestAnimationFrame;
    // @ts-expect-error deliberately removing the API the browser is assumed to have
    delete globalThis.requestAnimationFrame;
    try {
      const ticks: number[] = [];
      // No timer is started -- `liveMapSurface.test.ts` forbids `setInterval` in
      // this module, and a page with no rAF has no WebGL either, so it never
      // reaches the canvas. Positions then update per projection, as before ART-119.
      expect(() => startMotionClock(() => 10, (n) => ticks.push(n))()).not.toThrow();
      expect(ticks).toEqual([]);
    } finally {
      globalThis.requestAnimationFrame = realRaf;
    }
  });

  test('reads a clock and nothing else: no fetch, no query, no subscription', () => {
    // The runtime half of the claim `liveMapSurface.test.ts` makes structurally.
    // Sixty frames of animation must not produce a single request.
    // jsdom ships no `fetch`, so it is installed rather than spied on: any call
    // at all is a failure, and there is nothing to restore it to.
    let requests = 0;
    (globalThis as { fetch?: unknown }).fetch = () => {
      requests += 1;
      throw new Error('the motion clock must not touch the network');
    };
    try {
      const stop = startMotionClock(() => 16, () => undefined);
      for (let frame = 0; frame < 60; frame++) {
        clock += 16;
        frames.advanceOneFrame();
      }
      stop();
      expect(requests).toBe(0);
    } finally {
      delete (globalThis as { fetch?: unknown }).fetch;
    }
  });
});
