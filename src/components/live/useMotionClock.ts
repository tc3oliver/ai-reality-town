import { useEffect, useRef, useState } from 'react';

/**
 * The animation clock (ART-119 / FR-O002 AC#2/#7).
 *
 * Until this existed the live map was a still frame: the view model interpolates
 * against a `nowMs` argument, but nothing advanced it, so a character only moved
 * when a *new projection* arrived and then jumped there in one step. This is the
 * thing that ticks.
 *
 * It is deliberately the dumbest possible clock. It reads `Date.now()` and hands
 * it to a pure function; it holds no world state, owns no character, and — this
 * is the load-bearing part — **takes no network action of any kind**. There is
 * no query, no refetch, no subscription and no Convex client here, which is what
 * keeps `components/live/` inside `readOnlyClientBoundary` and keeps "public
 * reads never trigger generation" true even while the map animates sixty times a
 * second. `liveMapSurface.test.ts` asserts that structurally.
 *
 * `requestAnimationFrame` is the driver, and deliberately the *only* driver.
 * Two reasons. It is already throttled by the browser when the tab is hidden, so
 * a backgrounded map costs nothing. And `liveMapSurface.test.ts` asserts that no
 * file in this module mounts a repeating timer at all — the guarantee being that
 * watching the map schedules no recurring work — which a timer-based fallback
 * would have to weaken. Nothing is lost: this hook only runs on a page that has
 * already probed for WebGL and mounted a Pixi stage (`LiveMapFallback` handles
 * the alternative), and no browser has WebGL without rAF.
 *
 * Where rAF is genuinely absent the clock simply never advances, which degrades
 * to exactly the pre-ART-119 behaviour: positions update when a new projection
 * arrives. Still correct, merely not smooth.
 *
 * `intervalMs` gates *how many* animation frames produce a new value, which is
 * how a render quality tier reduces work without changing behaviour.
 */

/** Floor of one millisecond, so a zero or malformed interval cannot spin the gate open. */
function gate(intervalMs: number): number {
  return Number.isFinite(intervalMs) && intervalMs > 1 ? intervalMs : 1;
}

/**
 * Run `onTick` no more often than every `intervalMs()` milliseconds; returns a
 * teardown.
 *
 * Split out of the hook for the same reason `observeElementSize` is split out of
 * `useElementSize`: the behaviour that matters — that the gate actually holds,
 * and that the loop is actually cancelled — is testable without a React
 * renderer, and a leaked animation frame keeps a detached canvas alive on every
 * route change.
 *
 * `intervalMs` is a getter rather than a number so a quality-tier change does
 * not have to tear down and rebuild the frame chain mid-walk.
 */
export function startMotionClock(
  intervalMs: () => number,
  onTick: (nowMs: number) => void,
): () => void {
  let last = Date.now();
  const tick = () => {
    const now = Date.now();
    if (now - last < gate(intervalMs())) return;
    last = now;
    onTick(now);
  };

  if (typeof requestAnimationFrame !== 'function') return () => undefined;

  let handle = requestAnimationFrame(function frame() {
    tick();
    handle = requestAnimationFrame(frame);
  });
  return () => cancelAnimationFrame(handle);
}

/**
 * The current instant, advanced at most once per `intervalMs`.
 *
 * Returns a fixed instant while `enabled` is false, so a page with nothing to
 * animate does not re-render on a timer.
 */
export function useMotionClock(intervalMs: number, enabled = true): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const interval = useRef(intervalMs);
  interval.current = intervalMs;

  useEffect(() => {
    if (!enabled) return;
    return startMotionClock(() => interval.current, setNowMs);
  }, [enabled]);

  return nowMs;
}
