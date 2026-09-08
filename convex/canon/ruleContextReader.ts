/**
 * The one reader of a world's persisted {@link CanonRuleContext}.
 *
 * Extracted from `createConvexCanonStore` by ART-58 so a READ-ONLY caller — the continuity
 * evaluator's operator query — validates accepted history against exactly the rule context the
 * commit path validated it under. A second loader, however similar, would be a second definition
 * of which locations are active and which characters exist, and the two would drift silently:
 * both would keep returning well-formed contexts.
 *
 * Takes a query-side `db` on purpose. A `GenericMutationCtx['db']` is a superset, so the commit
 * store passes its own handle through unchanged; a query cannot pass the other way.
 */

import type { GenericQueryCtx } from 'convex/server';
import type { DataModel } from '../_generated/dataModel';
import type { CanonImmutableRule, CanonRuleContext } from './model';
import { personaAnchorFromSeed } from './personaDeviation';

type ReadDb = GenericQueryCtx<DataModel>['db'];

/** `null` when the world carries no seed rows at all. */
export async function readCanonRuleContext(db: ReadDb, worldId: string): Promise<CanonRuleContext | null> {
  const [rules, characters, locations, items, organizations] = await Promise.all([
    db.query('worldImmutableRules').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
    db.query('worldCharacters').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
    db.query('worldLocations').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
    db.query('worldAssets').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
    db.query('worldOrganizations').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
  ]);
  if (rules.length === 0 && characters.length === 0 && locations.length === 0 && items.length === 0 && organizations.length === 0) return null;
  const activeLocations = locations.filter((row) => (row.payload as { active?: unknown }).active === true);
  return {
    worldId,
    rules: rules.map((row) => row.payload as CanonImmutableRule),
    characterIds: characters.map((row) => row.characterId),
    // FR-B003 anchors come from the seed rows this query already reads. A payload that cannot
    // yield an anchor contributes nothing, so an older or partial seed leaves the gate inert
    // for that character instead of failing every commit involving them.
    characterPersonas: Object.fromEntries(characters.flatMap((row) => {
      const anchor = personaAnchorFromSeed(row.characterId, row.payload);
      return anchor ? [[row.characterId, anchor] as const] : [];
    })),
    locationIds: activeLocations.map((row) => row.locationId),
    itemIds: items.map((row) => row.assetId),
    organizationIds: organizations.map((row) => row.organizationId),
    initialCharacterAlive: Object.fromEntries(characters.map((row) => [row.characterId, true])),
    initialItemOwners: Object.fromEntries(items.map((row) => [row.assetId, row.ownerCharacterId])),
    initialCharacterLocations: Object.fromEntries(characters.flatMap((row) => {
      const initialLocationId = (row.payload as { initialLocationId?: unknown }).initialLocationId;
      return typeof initialLocationId === 'string' ? [[row.characterId, initialLocationId] as const] : [];
    })),
    locationConnections: Object.fromEntries(activeLocations.map((row) => {
      const connected = (row.payload as { connectedLocationIds?: unknown }).connectedLocationIds;
      return [row.locationId, Array.isArray(connected)
        ? connected.filter((id): id is string => typeof id === 'string')
        : []];
    })),
  };
}
