/**
 * Convex wiring for the independent editorial publication lifecycle (FR-K004).
 *
 * Server-authorized administrative commands and ops queries. Each mutation
 * records a full audit trail (actor + reason + timestamp + version delta) and
 * performs ZERO canon writes: a withheld or superseded publication never
 * deletes or edits an accepted Canon Event. Authorization is enforced by the
 * pure layer ({@link assertAuthorized}) on the actor supplied by the calling
 * server entry point; only authenticated admin/system callers reach these
 * internal mutations.
 */

import { v } from 'convex/values';
import type { GenericQueryCtx } from 'convex/server';
import { internalMutation, internalQuery } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import {
  assertAuthorized,
  createPublicationRecord,
  regeneratePublication,
  transitionPublication,
  validatePublicationRecord,
  PublicationLifecycleError,
  type PublicationActor,
  type PublicationContentKind,
  type PublicationRecord,
} from './publicationLifecycle';

const actorArgs = v.object({ type: v.union(v.literal('admin'), v.literal('system')), id: v.string() });

/** Actions handled by the generic forward-transition mutation. */
const TRANSITION_ACTIONS = [
  'validate', 'begin_safety_review', 'pass_safety_review', 'publish', 'withhold', 'resume_to_ready',
] as const;

const transitionActionArgs = v.union(
  ...TRANSITION_ACTIONS.map((action) => v.literal(action)),
);

function toRecord(row: {
  schemaVersion: number; publicationId: string; worldId: string; contentKind: string;
  contentRef: string; status: string; version: number; summary?: string; audit: unknown[];
}): PublicationRecord {
  return validatePublicationRecord({
    schemaVersion: row.schemaVersion,
    publicationId: row.publicationId,
    worldId: row.worldId,
    contentKind: row.contentKind as PublicationContentKind,
    contentRef: row.contentRef,
    status: row.status,
    version: row.version,
    summary: row.summary ?? null,
    audit: row.audit as PublicationRecord['audit'],
  });
}

async function loadCurrentRecord(
  db: GenericQueryCtx<DataModel>['db'],
  worldId: string,
  contentRef: string,
) {
  const row = await db
    .query('publicationRecords')
    .withIndex('by_current', (q) => q.eq('worldId', worldId).eq('contentRef', contentRef).eq('isCurrent', true))
    .unique();
  return row ? { id: row._id, record: toRecord(row) } : null;
}

/**
 * Create a publication record in the `generated` status for an episode content
 * reference. Idempotent: a repeated create for the same content returns the
 * existing current record without appending a new audit event.
 *
 * `contentKind` defaults to `episode`; ART-36 (FR-G005) passes `episode_share` for the outreach
 * copy derived from an Episode. Optional rather than required so the FR-K004 call site that
 * predates derived content keeps its exact meaning — and defaulted rather than inferred from
 * `contentRef`, because a naming convention is not something a caller should be able to get
 * wrong silently.
 */
export const createEpisodePublication = internalMutation({
  args: {
    worldId: v.string(), contentRef: v.string(), summary: v.union(v.string(), v.null()),
    contentKind: v.optional(v.union(v.literal('episode'), v.literal('episode_share'))),
    actor: actorArgs, reason: v.string(), now: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || args.contentRef.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new PublicationLifecycleError('PUBLICATION_INVALID_SHAPE', 'invalid create request');
    }
    const actor = args.actor as PublicationActor;
    assertAuthorized('create', actor);
    const existing = await loadCurrentRecord(ctx.db, args.worldId, args.contentRef);
    if (existing) return { publicationId: existing.record.publicationId, status: existing.record.status, version: existing.record.version, deduplicated: true };
    const record = createPublicationRecord({
      publicationId: `pub:${args.contentRef}:1`,
      worldId: args.worldId, contentKind: args.contentKind ?? 'episode', contentRef: args.contentRef,
      summary: args.summary, actor, reason: args.reason, at: args.now,
    });
    await ctx.db.insert('publicationRecords', {
      schemaVersion: 1, worldId: record.worldId, contentKind: record.contentKind, contentRef: record.contentRef,
      publicationId: record.publicationId, status: record.status, version: record.version,
      summary: record.summary ?? undefined, audit: record.audit, isCurrent: true,
      createdAt: args.now, updatedAt: args.now,
    });
    return { publicationId: record.publicationId, status: record.status, version: record.version, deduplicated: false };
  },
});

/**
 * Apply a forward publication transition (validate / safety review / publish /
 * withhold / resume). Appends an audit event and patches the current record.
 */
export const advancePublication = internalMutation({
  args: {
    worldId: v.string(), contentRef: v.string(), action: transitionActionArgs,
    actor: actorArgs, reason: v.string(), now: v.number(),
  },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.now)) throw new PublicationLifecycleError('PUBLICATION_INVALID_SHAPE', 'invalid timestamp');
    const actor = args.actor as PublicationActor;
    const action = args.action;
    const current = await loadCurrentRecord(ctx.db, args.worldId, args.contentRef);
    if (!current) throw new PublicationLifecycleError('PUBLICATION_NOT_FOUND', 'no current publication for content reference');
    const next = transitionPublication(current.record, action, actor, args.reason, args.now);
    await ctx.db.patch(current.id, {
      status: next.status, summary: next.summary ?? undefined, audit: next.audit, updatedAt: args.now,
    });
    return { publicationId: next.publicationId, status: next.status, version: next.version };
  },
});

/**
 * Regenerate the public summary for a content reference. The current record is
 * marked `superseded` and a fresh `generated` record at the next version is
 * inserted. The Canon Event backing the content is never read or written here.
 */
export const regenerateEpisodePublication = internalMutation({
  args: {
    worldId: v.string(), contentRef: v.string(), newSummary: v.union(v.string(), v.null()),
    actor: actorArgs, reason: v.string(), now: v.number(),
  },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.now)) throw new PublicationLifecycleError('PUBLICATION_INVALID_SHAPE', 'invalid timestamp');
    const actor = args.actor as PublicationActor;
    const current = await loadCurrentRecord(ctx.db, args.worldId, args.contentRef);
    if (!current) throw new PublicationLifecycleError('PUBLICATION_NOT_FOUND', 'no current publication to regenerate');
    const nextPublicationId = `pub:${args.contentRef}:${current.record.version + 1}`;
    const { supersededPrior, next } = regeneratePublication(
      current.record, nextPublicationId, args.newSummary, actor, args.reason, args.now,
    );
    await ctx.db.patch(current.id, {
      status: supersededPrior.status, audit: supersededPrior.audit, isCurrent: false, updatedAt: args.now,
    });
    await ctx.db.insert('publicationRecords', {
      schemaVersion: 1, worldId: next.worldId, contentKind: next.contentKind, contentRef: next.contentRef,
      publicationId: next.publicationId, status: next.status, version: next.version,
      summary: next.summary ?? undefined, audit: next.audit, isCurrent: true,
      createdAt: args.now, updatedAt: args.now,
    });
    return { priorPublicationId: supersededPrior.publicationId, publicationId: next.publicationId, version: next.version };
  },
});

/** Operations-only: the current (non-superseded) publication for a content reference. */
export const getCurrentPublication = internalQuery({
  args: { worldId: v.string(), contentRef: v.string() },
  handler: async (ctx, args) => {
    const current = await loadCurrentRecord(ctx.db, args.worldId, args.contentRef);
    return current ? { publicationId: current.record.publicationId, status: current.record.status, version: current.record.version, summary: current.record.summary } : null;
  },
});

/** Operations-only: full version history (newest first) for a content reference, including superseded records. */
export const listPublicationHistory = internalQuery({
  args: { worldId: v.string(), contentRef: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('publicationRecords')
      .withIndex('by_world_and_content', (q) => q.eq('worldId', args.worldId).eq('contentRef', args.contentRef))
      .collect();
    return rows
      .map((row) => toRecord(row))
      .sort((a, b) => b.version - a.version)
      .map((record) => ({
        publicationId: record.publicationId, status: record.status, version: record.version,
        summary: record.summary, auditCount: record.audit.length,
      }));
  },
});
