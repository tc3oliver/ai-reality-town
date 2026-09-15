/**
 * The name tables a static public page needs, read from published models (ART-187).
 *
 * {@link composeWorldNames} is the pure half and says what the fallbacks are. This is the half
 * that fetches, and it exists because four pages needed the same two lookups and each would
 * otherwise have invented its own.
 *
 * ## Two reads, not N
 *
 * **Characters** come from `live:<worldId>` — ONE read that carries `displayName` for every
 * character in the world. A page naming six residents would otherwise issue six `character:<id>`
 * reads for six strings it could have had in one.
 *
 * **Arcs** come from `arc:<arcId>`, one per id, through `useQueries`. There is no published model
 * that lists every arc's title: `liveState.activeArcs` covers only the arcs running RIGHT NOW,
 * and an Episode from world day 2 names arcs that resolved long ago. Reading them individually is
 * the only exact answer, and it is bounded by the ids the caller already holds.
 *
 * `useQueries` rather than a `useQuery` per id because the id set is data-dependent and the rules
 * of hooks forbid a loop — the same reason and the same mechanism `RelationshipGraphView` uses for
 * its per-node character reads, including the memoisation note below.
 *
 * ## The memoisation is not an optimisation
 *
 * `useQueries` memoises its subscription on the `queries` object IDENTITY. A fresh object literal
 * each render re-creates the subscription, which re-enters `setQueries` and renders again — an
 * infinite loop that presents as a blank page rather than as an error. `RelationshipGraphView`
 * records that the browser E2E is what caught it, and that it looked nothing like a hook bug. The
 * key here is the joined id list for the same reason: that is what the query set actually depends
 * on.
 *
 * ## No generation on read
 *
 * Both reads go through `getPublishedReadModel`, the anonymous allowlisted query every public page
 * already uses. Naming somebody cannot make the world produce anything.
 */

import { useMemo } from 'react';
import { useQueries, useQuery, type RequestForQueries } from 'convex/react';

import { getPublishedReadModelRef } from './publicReadModelRef';
import { composeWorldNames, type WorldNames } from './worldNames';

type LivePayload = {
  characters?: Array<{ characterId: string; displayName?: string | null }>;
  locations?: Array<{ locationId: string; name?: string | null }>;
  activeArcs?: Array<{ arcId: string; title?: string | null }>;
};

/**
 * Character, location and arc names for one world.
 *
 * `arcIds` is the set the caller wants titles for; passing `[]` skips the per-arc reads entirely,
 * which is what a page that only names people should do. Ids are de-duplicated and sorted here so
 * two renders that hold the same set in a different order do not re-subscribe.
 */
export function useEntityNames(
  worldId: string | null,
  /**
   * `unknown[]`, deliberately. Every caller builds this from a published payload, and typing it
   * as `string[]` would let TypeScript promise something the wire cannot — see the filter below.
   */
  arcIds: readonly unknown[] = [],
): WorldNames {
  const live = useQuery(
    getPublishedReadModelRef,
    worldId === null ? 'skip' : { worldId, modelKind: 'liveState', modelRef: `live:${worldId}` },
  );

  /**
   * Typed-checked, not just emptiness-checked.
   *
   * A published payload reaches the client as unvalidated JSON, so a field that was never set
   * arrives as `undefined` rather than as `[]` — `timelineRoute.ts` has a test named for exactly
   * that. The first version of this line called `.trim()` on whatever `flatMap` produced, and a
   * timeline entry with no `arcIds` made it throw during render. The page went blank, which is the
   * ART-146 signature: no error a viewer could see, just no `<main>`. The browser E2E caught it
   * and no unit test would have, because the fixtures all set the field.
   */
  const arcIdKey = [...new Set(
    arcIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
  )].sort().join('|');
  const arcQueries = useMemo<RequestForQueries>(() => {
    const queries: RequestForQueries = {};
    if (worldId === null || arcIdKey.length === 0) return queries;
    for (const arcId of arcIdKey.split('|')) {
      queries[arcId] = {
        query: getPublishedReadModelRef,
        args: { worldId, modelKind: 'arc', modelRef: `arc:${arcId}` },
      };
    }
    return queries;
  }, [worldId, arcIdKey]);
  const arcResults = useQueries(arcQueries);

  const livePayload = (live?.payload ?? null) as LivePayload | null;
  /**
   * The live payload's active arcs first, then the per-arc reads on top.
   *
   * An arc that is running right now is in both, and the individual read is the more specific
   * source, so it wins. An Error from one arc's read costs that arc its title, not the page:
   * `useQueries` returns the error in place of the value rather than throwing.
   */
  const arcEntries: Array<{ arcId: string; title: string | null }> = [];
  for (const [arcId, result] of Object.entries(arcResults)) {
    if (result instanceof Error || result === undefined) continue;
    const payload = (result as { payload?: { title?: unknown } } | null)?.payload;
    arcEntries.push({ arcId, title: typeof payload?.title === 'string' ? payload.title : null });
  }

  return composeWorldNames({
    characters: livePayload?.characters,
    locations: livePayload?.locations,
    activeArcs: [...(livePayload?.activeArcs ?? []), ...arcEntries],
  });
}
