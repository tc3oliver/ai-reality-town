import { defineTable } from 'convex/server';
import { v } from 'convex/values';

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
export const visualTables = {
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
};
