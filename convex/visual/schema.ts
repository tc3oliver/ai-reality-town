import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/** Persisted Visual Binding rows; each table is documented at its own member. */
export const visualTables = {
  /**
   * Persisted Character Visual Binding rows (FR-N004, PRD 2.0 §14.1).
   *
   * Rows are versioned and auditable: an appearance change writes a new `version`
   * and retires the previous row rather than editing it in place, so the history
   * of what the public saw stays reconstructable. `characterId` and the seed's
   * romanised name remain internal; only `displayName`/`nameplate` are public,
   * and the authored set keeps them equal so every public surface agrees.
   *
   * The authored, deterministic half of this shape lives in
   * `convex/visual/characterVisualBinding.ts`; `createdAt`/`updatedAt` are clock
   * values and therefore only exist on the persisted row.
   */
  characterVisualBindings: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    characterId: v.string(),
    runtimeId: v.string(),
    spriteKey: v.string(),
    paletteVariant: v.string(),
    nameplate: v.string(),
    portraitFrame: v.number(),
    displayName: v.string(),
    locale: v.string(),
    publicVariant: v.union(v.literal('default'), v.literal('inactive'), v.literal('memorial')),
    status: v.union(v.literal('active'), v.literal('retired')),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_character_status', ['worldId', 'characterId', 'status'])
    .index('by_character_version', ['worldId', 'characterId', 'version'])
    .index('by_runtime', ['worldId', 'runtimeId']),

  /**
   * Persisted Location Visual Binding rows (FR-N005, PRD 2.0 §14.2).
   *
   * Same auditability rule as above: re-authoring a zone writes a new `version`
   * and retires the previous row rather than editing geometry in place, so a
   * published position can always be traced back to the map it was measured on.
   * `mapId` is part of the row because geometry does not survive a new map.
   *
   * The authored, deterministic half lives in
   * `convex/visual/locationVisualBinding.ts` and
   * `convex/visual/mistwoodLocationBindings.ts`; `createdAt`/`updatedAt` are
   * clock values and therefore only exist on the persisted row.
   */
  locationVisualBindings: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    mapId: v.string(),
    locationId: v.string(),
    zoneType: v.literal('canon-location'),
    zonePolygon: v.array(v.object({ x: v.number(), y: v.number() })),
    entryAnchors: v.array(v.object({ x: v.number(), y: v.number() })),
    ambientAnchors: v.array(v.object({ x: v.number(), y: v.number() })),
    sceneFocusPoint: v.object({ x: v.number(), y: v.number() }),
    publicLabel: v.string(),
    status: v.union(v.literal('active'), v.literal('retired')),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_location_status', ['worldId', 'locationId', 'status'])
    .index('by_location_version', ['worldId', 'locationId', 'version'])
    .index('by_map', ['worldId', 'mapId']),
};
