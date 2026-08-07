/**
 * Convex wiring for the public read-model infrastructure (NFR-001/002/005, §16.3).
 *
 * The public read query serves pre-computed, publication-gated snapshots from
 * `publishedReadModels` ONLY — it never reads canon or simulation tables and
 * invokes no provider, so read availability is isolated from simulation/model
 * failure (AC#1) and public reads never trigger LLM generation (AC#3/#6). The
 * projection-writer mutations are internal: they are called by downstream
 * projection tasks and the editorial pipeline, never by public visitors.
 */

import { v } from 'convex/values';
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server';
import { query, internalMutation, internalQuery } from '../_generated/server';
import type { DataModel, Id } from '../_generated/dataModel';
import type { JsonValue } from '../canon/model';
import {
  commitReadModelVersion,
  invalidateReadModel,
  isReadModelKind,
  isReadModelStatus,
  ReadModelError,
  serveReadModel,
  type PublishedReadModel,
  type PublicReadReadStore,
  type PublicReadStore,
  type StoredReadModel,
} from './readModel';

const modelKindValidator = v.union(
  v.literal('world'), v.literal('character'), v.literal('episode'),
  v.literal('arc'), v.literal('relationship'), v.literal('liveState'), v.literal('timeline'),
  v.literal('visualReplay'),
);

type PublishedReadModelRow = {
  _id: Id<'publishedReadModels'>;
  schemaVersion: number;
  worldId: string;
  modelKind: string;
  modelRef: string;
  version: number;
  payload: unknown;
  status: string;
  sourceEventIds: string[];
  isCurrent: boolean;
  isLastKnownGood: boolean;
  contentHash: string;
  createdAt: number;
  publishedAt?: number;
  updatedAt: number;
};

function rowToStored(row: PublishedReadModelRow): StoredReadModel {
  if (!isReadModelKind(row.modelKind)) {
    throw new ReadModelError('READ_MODEL_INVALID_SHAPE', `persisted modelKind is not a known kind: ${row.modelKind}`);
  }
  if (!isReadModelStatus(row.status)) {
    throw new ReadModelError('READ_MODEL_INVALID_SHAPE', `persisted status is not known: ${row.status}`);
  }
  return {
    id: row._id,
    schemaVersion: row.schemaVersion as PublishedReadModel['schemaVersion'],
    worldId: row.worldId,
    modelKind: row.modelKind,
    modelRef: row.modelRef,
    version: row.version,
    payload: row.payload as JsonValue,
    status: row.status,
    sourceEventIds: row.sourceEventIds,
    isCurrent: row.isCurrent,
    isLastKnownGood: row.isLastKnownGood,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt ?? null,
  };
}

/** Read-only store adapter backed by a Convex query context (exported for public queries). */
export function readStore(db: GenericQueryCtx<DataModel>['db']): PublicReadReadStore {
  return {
    async loadTargetVersions(worldId, modelKind, modelRef) {
      const rows = await db
        .query('publishedReadModels')
        .withIndex('by_target_and_version', (q) => q.eq('worldId', worldId).eq('modelKind', modelKind).eq('modelRef', modelRef))
        .collect();
      return rows.map(rowToStored);
    },
  };
}

/** Full store adapter backed by a Convex mutation context (exported for projection builders). */
export function writeStore(db: GenericMutationCtx<DataModel>['db']): PublicReadStore {
  return {
    async loadTargetVersions(worldId, modelKind, modelRef) {
      const rows = await db
        .query('publishedReadModels')
        .withIndex('by_target_and_version', (q) => q.eq('worldId', worldId).eq('modelKind', modelKind).eq('modelRef', modelRef))
        .collect();
      return rows.map(rowToStored);
    },
    async findCurrent(worldId, modelKind, modelRef) {
      const row = await db
        .query('publishedReadModels')
        .withIndex('by_current', (q) => q.eq('worldId', worldId).eq('modelKind', modelKind).eq('modelRef', modelRef).eq('isCurrent', true))
        .unique();
      return row ? rowToStored(row) : null;
    },
    async loadLastKnownGood(worldId, modelKind, modelRef) {
      const rows = await db
        .query('publishedReadModels')
        .withIndex('by_lkg', (q) => q.eq('worldId', worldId).eq('modelKind', modelKind).eq('modelRef', modelRef).eq('isLastKnownGood', true))
        .collect();
      return rows.map(rowToStored);
    },
    async insertVersion(record) {
      return db.insert('publishedReadModels', {
        schemaVersion: record.schemaVersion,
        worldId: record.worldId,
        modelKind: record.modelKind,
        modelRef: record.modelRef,
        version: record.version,
        payload: record.payload,
        status: record.status,
        sourceEventIds: record.sourceEventIds,
        isCurrent: record.isCurrent,
        isLastKnownGood: record.isLastKnownGood,
        contentHash: record.contentHash,
        createdAt: record.createdAt,
        publishedAt: record.publishedAt ?? undefined,
        updatedAt: record.createdAt,
      });
    },
    async markCurrent(rowId, patch) {
      await db.patch(rowId as Id<'publishedReadModels'>, {
        isCurrent: patch.isCurrent,
        isLastKnownGood: patch.isLastKnownGood,
        status: patch.status,
        updatedAt: patch.updatedAt,
      });
    },
  };
}

/**
 * Public read API. Serves the current published version for a target, falling
 * back to the last-known-good when the current is withheld/failed. Reads ONLY
 * `publishedReadModels`; performs zero canon reads and zero provider calls
 * (AC#1/#3/#4). Returns null when nothing was ever published for the target.
 */
export const getPublishedReadModel = query({
  args: { worldId: v.string(), modelKind: modelKindValidator, modelRef: v.string() },
  handler: async (ctx, args) => serveReadModel(readStore(ctx.db), args.worldId, args.modelKind, args.modelRef),
});

/**
 * Internal projection-writer primitive. Materialises a new published read-model
 * version: applies the public allowlist, allocates the next version, demotes the
 * prior current to last-known-good (when it was published), and inserts the new
 * current. Idempotent on (target, contentHash, status). Called by downstream
 * projection tasks / the editorial pipeline — never by public visitors.
 */
export const writePublishedReadModel = internalMutation({
  args: {
    worldId: v.string(),
    modelKind: modelKindValidator,
    modelRef: v.string(),
    payload: v.any(),
    sourceEventIds: v.array(v.string()),
    status: v.union(
      v.literal('publishing'), v.literal('published'),
      v.literal('withheld'), v.literal('failed'),
    ),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.now)) {
      throw new ReadModelError('READ_MODEL_INVALID_SHAPE', 'now must be finite');
    }
    return commitReadModelVersion(writeStore(ctx.db), {
      worldId: args.worldId,
      modelKind: args.modelKind,
      modelRef: args.modelRef,
      payload: args.payload as JsonValue,
      sourceEventIds: args.sourceEventIds,
      status: args.status,
      now: args.now,
    });
  },
});

/**
 * Invalidate (withhold or fail) the current version while preserving the
 * last-known-good fallback (AC#5). Reads then fall back to the retained prior
 * published version. The Canon history is never touched.
 */
export const invalidateReadModelVersion = internalMutation({
  args: {
    worldId: v.string(),
    modelKind: modelKindValidator,
    modelRef: v.string(),
    status: v.union(v.literal('withheld'), v.literal('failed')),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.now)) {
      throw new ReadModelError('READ_MODEL_INVALID_SHAPE', 'now must be finite');
    }
    return invalidateReadModel(writeStore(ctx.db), {
      worldId: args.worldId,
      modelKind: args.modelKind,
      modelRef: args.modelRef,
      status: args.status,
      now: args.now,
    });
  },
});

/** Operations-only: version history (newest first) for a target. */
export const listReadModelVersions = internalQuery({
  args: { worldId: v.string(), modelKind: modelKindValidator, modelRef: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('publishedReadModels')
      .withIndex('by_target_and_version', (q) => q.eq('worldId', args.worldId).eq('modelKind', args.modelKind).eq('modelRef', args.modelRef))
      .collect();
    return rows
      .map(rowToStored)
      .sort((a, b) => b.version - a.version)
      .map((row) => ({
        version: row.version,
        status: row.status,
        isCurrent: row.isCurrent,
        isLastKnownGood: row.isLastKnownGood,
        contentHash: row.contentHash,
        sourceEventIds: row.sourceEventIds,
        publishedAt: row.publishedAt,
      }));
  },
});
