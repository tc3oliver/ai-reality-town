import { v } from 'convex/values';
import type { GenericQueryCtx } from 'convex/server';
import { internalMutation, internalQuery } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import { deriveEventId } from '../shared/ids';
import { ArcLifecycleError, assertArcSourceMatchesAcceptedEvent, isActiveArcStatus, transitionArcLifecycle } from './lifecycle';
import type { ArcLifecycleRecord, ArcLifecycleTransition } from './model';
import { storyArcStatusValidator } from './schema';

async function requireAcceptedEvent(
  ctx: Pick<GenericQueryCtx<DataModel>, 'db'>,
  worldId: string,
  sequenceNumber: number,
  eventId: string,
): Promise<void> {
  const row = await ctx.db.query('canonEvents')
    .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId).eq('sequenceNumber', sequenceNumber))
    .unique();
  assertArcSourceMatchesAcceptedEvent(eventId, row ? deriveEventId(worldId, sequenceNumber) : null);
}

async function loadRecord(ctx: Pick<GenericQueryCtx<DataModel>, 'db'>, worldId: string, arcId: string): Promise<ArcLifecycleRecord | null> {
  const current = await ctx.db.query('storyArcLifecycles')
    .withIndex('by_world_and_arc', (q) => q.eq('worldId', worldId).eq('arcId', arcId)).unique();
  if (!current) return null;
  const transitions = await ctx.db.query('storyArcLifecycleTransitions')
    .withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', worldId).eq('arcId', arcId)).collect();
  return {
    schemaVersion: 1, worldId, arcId, status: current.status,
    revision: current.revision,
    transitions: transitions.map((row): ArcLifecycleTransition => ({
      transitionId: row.transitionId,
      fromStatus: row.fromStatus ?? null,
      toStatus: row.toStatus,
      sourceEventId: row.sourceEventId,
      sourceEventSequenceNumber: row.sourceEventSequenceNumber,
      reason: row.reason,
      changedAt: row.changedAt,
    })),
  };
}

const provenanceArgs = {
  sourceEventId: v.string(), sourceEventSequenceNumber: v.number(), reason: v.string(), changedAt: v.number(),
};

export const createArcLifecycleRecord = internalMutation({
  args: { worldId: v.string(), arcId: v.string(), ...provenanceArgs },
  handler: async (ctx, args) => {
    if (await loadRecord(ctx, args.worldId, args.arcId)) throw new ArcLifecycleError('ARC_ALREADY_EXISTS', 'arc lifecycle already exists');
    await requireAcceptedEvent(ctx, args.worldId, args.sourceEventSequenceNumber, args.sourceEventId);
    if (args.arcId.trim().length === 0 || args.reason.trim().length === 0 || !Number.isFinite(args.changedAt)) {
      throw new ArcLifecycleError('ARC_INVALID_PROVENANCE', 'arc ID, reason, and finite time are required');
    }
    await ctx.db.insert('storyArcLifecycles', {
      schemaVersion: 1, worldId: args.worldId, arcId: args.arcId, status: 'emerging', revision: 0,
      createdAt: args.changedAt, updatedAt: args.changedAt,
    });
    await ctx.db.insert('storyArcLifecycleTransitions', {
      worldId: args.worldId, arcId: args.arcId, transitionId: `${args.arcId}:lifecycle:0`, revision: 0,
      toStatus: 'emerging', sourceEventId: args.sourceEventId,
      sourceEventSequenceNumber: args.sourceEventSequenceNumber, reason: args.reason, changedAt: args.changedAt,
    });
    return { arcId: args.arcId, status: 'emerging' as const, revision: 0 };
  },
});

export const transitionArcLifecycleRecord = internalMutation({
  args: {
    worldId: v.string(), arcId: v.string(), expectedStatus: storyArcStatusValidator,
    toStatus: storyArcStatusValidator, ...provenanceArgs,
  },
  handler: async (ctx, args) => {
    const current = await loadRecord(ctx, args.worldId, args.arcId);
    if (!current) throw new ArcLifecycleError('ARC_NOT_FOUND', 'arc lifecycle does not exist');
    await requireAcceptedEvent(ctx, args.worldId, args.sourceEventSequenceNumber, args.sourceEventId);
    const next = transitionArcLifecycle(current, args);
    const row = await ctx.db.query('storyArcLifecycles')
      .withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId)).unique();
    if (!row) throw new ArcLifecycleError('ARC_NOT_FOUND', 'arc lifecycle does not exist');
    await ctx.db.patch(row._id, { status: next.status, revision: next.revision, updatedAt: args.changedAt });
    const transition = next.transitions[next.transitions.length - 1];
    await ctx.db.insert('storyArcLifecycleTransitions', {
      worldId: args.worldId, arcId: args.arcId, transitionId: transition.transitionId,
      revision: next.revision, fromStatus: transition.fromStatus ?? undefined, toStatus: transition.toStatus,
      sourceEventId: transition.sourceEventId, sourceEventSequenceNumber: transition.sourceEventSequenceNumber,
      reason: transition.reason, changedAt: transition.changedAt,
    });
    return { arcId: args.arcId, status: next.status, revision: next.revision };
  },
});

export const getArcLifecycleHistory = internalQuery({
  args: { worldId: v.string(), arcId: v.string() },
  handler: (ctx, args) => loadRecord(ctx, args.worldId, args.arcId),
});

export const listActiveArcLifecycleContext = internalQuery({
  args: { worldId: v.string() },
  handler: async (ctx, { worldId }) => {
    const rows = await ctx.db.query('storyArcLifecycles')
      .withIndex('by_world_and_arc', (q) => q.eq('worldId', worldId)).collect();
    return rows.filter((row) => isActiveArcStatus(row.status)).map((row) => ({
      arcId: row.arcId, status: row.status, revision: row.revision,
    }));
  },
});
