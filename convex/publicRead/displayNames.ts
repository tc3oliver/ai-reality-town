/**
 * Where a public surface gets an entity's display name (ART-183).
 *
 * One module because the two callers must agree. The onboarding summary names a major event's
 * participants and the live projection names everyone in the world; if they resolved names
 * differently, the same person could be 「Zhao Ming」 on one card and `zhao-ming` on the next.
 *
 * ## Characters: the published `character` read model
 *
 * A character's name arrives as a `fact_created` with predicate `name`, which is how
 * `characterSourceFrom` learns it. Folding it again here would resolve a name only for characters
 * introduced inside the caller's bounded event window, so the name is read from the projection
 * that already holds it — a point lookup per character, bounded by the cast.
 *
 * The lookup can miss, on the first rebuild after a character appears and before their projection
 * is published. The fallback is the id, which is what every public surface rendered before this
 * task, so a miss degrades to the old behaviour for one character rather than failing the page.
 *
 * ## Locations: whatever the caller already has
 *
 * Deliberately NOT read here. A location's name lives on the world projection's location records,
 * which the caller is already holding, and there is no `location` read model to look one up in.
 * This is also where the ART-185 gap shows: `convex/publicRead` replays from empty on purpose
 * (CLAUDE.md §9), and seeded locations live only in the `initial` snapshot, so most Mistwood
 * locations are absent from the projection entirely and therefore have no name to substitute. The
 * substitution mechanism is complete; the data it has to work with is what ART-185 is about.
 */

import type { GenericQueryCtx } from 'convex/server';
import type { DataModel } from '../_generated/dataModel';
import { entityNameMap } from './entityNames';
import { serveReadModel } from './readModel';
import { readStore } from './readModelFunctions';

type Ctx = { db: GenericQueryCtx<DataModel>['db'] };

/** One character's public name, or `null` when no projection has been published for them yet. */
export async function characterDisplayName(
  ctx: Ctx,
  worldId: string,
  characterId: string,
): Promise<string | null> {
  const served = await serveReadModel(readStore(ctx.db), worldId, 'character', `character:${characterId}`)
    .catch(() => null);
  const payload = served?.payload as { name?: unknown } | undefined;
  return typeof payload?.name === 'string' && payload.name.trim().length > 0 ? payload.name : null;
}

/**
 * The substitution map for a set of characters, plus any locations the caller can already name.
 *
 * `locations` is passed in rather than fetched for the reason in this module's header. Entries
 * whose name equals the id are dropped by {@link entityNameMap}, so a record with an unfilled name
 * does not turn into a no-op substitution that hides itself from a test.
 */
export async function loadDisplayNames(
  ctx: Ctx,
  worldId: string,
  characterIds: Iterable<string>,
  locations: Iterable<{ locationId: string; name?: string | null }> = [],
): Promise<ReadonlyMap<string, string>> {
  const entries: Array<{ id: string; name: string | null }> = [];
  for (const characterId of characterIds) {
    entries.push({ id: characterId, name: await characterDisplayName(ctx, worldId, characterId) });
  }
  for (const location of locations) {
    entries.push({ id: location.locationId, name: location.name ?? null });
  }
  return entityNameMap(entries);
}
