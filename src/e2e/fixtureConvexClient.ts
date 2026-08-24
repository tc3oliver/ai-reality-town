import { getFunctionName } from 'convex/server';

import { fixtureScenario } from './fixtureScenario';
import {
  fixtureProjection,
  fixtureReadModel,
  fixtureReplay,
  fixtureRuntimeSnapshot,
} from './fixtureWorld';

/**
 * A read-only Convex client for the browser E2E suite (FR-Q006 / ART-137).
 *
 * ## What this replaces, and what it must NOT weaken
 *
 * The suite has to watch the real components — the real `LiveMapPage`, the real Pixi renderer,
 * the real camera — against data that does not move under it. Only the transport is faked. Every
 * component, hook and view model in the run is the shipped one.
 *
 * The zero-mutation and zero-LLM guarantees (AC#10 / AC#11) would be worthless if the fake simply
 * ignored writes: a suite that could not observe a mutation would report none. So this client
 * RECORDS every call it is asked to make and **throws** on any non-query one, and the recording
 * is published on `window.__ART137__` for the spec to read. A component that started mutating
 * would fail the run loudly rather than being quietly absorbed. The spec additionally watches the
 * browser's own network layer, so a write that bypassed this client entirely — a bare `fetch`,
 * a second client — is caught by a mechanism this file cannot influence.
 *
 * ## The surface actually needed
 *
 * `useQuery` reaches the client through `useQueries` -> `QueriesObserver` -> `watchQuery`, so a
 * `Watch` with `localQueryResult`, `onUpdate` and `journal` is the whole contract. `mutation`,
 * `action` and `close` exist only to be refused: leaving them off would surface as "not a
 * function", which reads like a wiring bug rather than as the guarantee being enforced.
 */

type Watch<T> = {
  localQueryResult(): T | undefined;
  onUpdate(callback: () => void): () => void;
  journal(): undefined;
};

/** What the spec reads back off the page to settle AC#10 and AC#11. */
export type E2ERecorder = {
  /** Every query the app asked for, in order, as `path:name`. */
  queries: string[];
  /** Any non-query call. MUST stay empty; a non-empty one fails the run. */
  writes: string[];
};

const FIXTURE_QUERY_HANDLERS: Record<string, (args: Record<string, unknown>) => unknown> = {
  /**
   * `null` under the `snapshot` scenario (FR-Q005 / ART-136).
   *
   * That is not a fault being simulated — it is exactly what the real query returns when the
   * read-model store has nothing to serve, including no last-known-good. It is also the ONLY
   * way to reach the ladder's second rung, which is a state NFR2-002 requires figures for and
   * which no amount of browser manipulation can produce: it is a fact about what the server
   * returned.
   */
  'publicRead/liveStateFunctions:getPublicDynamicProjection': () =>
    fixtureScenario() === 'snapshot' ? null : fixtureProjection(Date.now()),
  'publicRead/visualReplayFunctions:getPublicVisualReplay': () => fixtureReplay(),
  'publicRead/runtimeSnapshotFunctions:getPublicRuntimeSnapshot': () =>
    fixtureRuntimeSnapshot(Date.now(), fixtureScenario()),
  'publicRead/readModelFunctions:getPublishedReadModel': (args) =>
    fixtureReadModel(String(args.modelRef ?? '')),
};

/**
 * The `path:name` a function reference carries.
 *
 * Read through Convex's own `getFunctionName` rather than by inspecting the object, because
 * `makeFunctionReference` stores it under a SYMBOL — an own-property scan finds nothing and
 * yields `[object Object]`, which is what the first version of this did and what made every
 * query miss its fixture. Using the library's accessor also means a change to that representation
 * is the library's problem rather than a silent break here.
 */
function referenceName(query: unknown): string {
  try {
    return getFunctionName(query as Parameters<typeof getFunctionName>[0]);
  } catch {
    return String(query);
  }
}

export function createFixtureConvexClient(recorder: E2ERecorder) {
  function refuse(kind: string) {
    return (query: unknown) => {
      const name = `${kind}:${referenceName(query)}`;
      recorder.writes.push(name);
      // Thrown, not swallowed. A guarantee that is only observed cannot be enforced; this makes
      // the run fail at the moment a write is attempted rather than at an assertion afterwards.
      throw new Error(`[ART-137] the public surface attempted a ${kind}: ${name}`);
    };
  }

  return {
    watchQuery(query: unknown, args: Record<string, unknown> = {}): Watch<unknown> {
      const name = referenceName(query);
      recorder.queries.push(name);
      const handler = FIXTURE_QUERY_HANDLERS[name];
      if (handler === undefined) {
        // Loud, for the same reason as above: a silently-undefined query would render as an
        // ordinary loading state and the spec would wait for data that is never coming.
        throw new Error(`[ART-137] no fixture for query: ${name}`);
      }
      const value = handler(args);
      return {
        localQueryResult: () => value,
        // Static by design: the fixture never changes under the suite, so there is nothing to
        // notify. AC#3's motion comes from the CLIENT clock interpolating a motion whose
        // `arriveAt` is in the future, which is the same code path a live projection drives.
        onUpdate: () => () => undefined,
        journal: () => undefined,
      };
    },
    watchPaginatedQuery: refuse('paginatedQuery'),
    mutation: refuse('mutation'),
    action: refuse('action'),
    setAuth: () => undefined,
    clearAuth: () => undefined,
    close: () => Promise.resolve(),
  };
}

/**
 * Whether this build is the E2E fixture build.
 *
 * Gated on a Vite env flag that is only ever set by the E2E build script, so a production bundle
 * cannot contain the fixture path: `import.meta.env.VITE_E2E_FIXTURE` is replaced with the
 * literal `undefined` at build time and the branch is dropped entirely. `e2eFixtureBuild.test.ts`
 * asserts the ordinary build ships no fixture identifier.
 */
export function e2eFixtureEnabled(): boolean {
  return import.meta.env?.VITE_E2E_FIXTURE === '1';
}

/** Install the recorder on `window` so the spec can read it back. */
export function installRecorder(): E2ERecorder {
  const recorder: E2ERecorder = { queries: [], writes: [] };
  (globalThis as unknown as { __ART137__?: E2ERecorder }).__ART137__ = recorder;
  return recorder;
}
