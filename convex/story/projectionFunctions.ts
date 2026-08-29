import { v } from 'convex/values';
import type { GenericQueryCtx } from 'convex/server';
import { internalMutation, internalQuery } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import { isTimeSlot } from '../canon/eventTypes';
import { deriveEventId } from '../shared/ids';
import type { ArcProjectionEvent, ArcProjectionFields } from './model';
import { ArcProjectionError, parseArcProjectionFields, replayArcProjection, validateArcProjectionReferences } from './projection';

async function acceptedEvent(
  ctx: Pick<GenericQueryCtx<DataModel>, 'db'>, worldId: string, sequenceNumber: number, eventId: string,
) {
  const row = await ctx.db.query('canonEvents')
    .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId).eq('sequenceNumber', sequenceNumber)).unique();
  if (!row || deriveEventId(worldId, sequenceNumber) !== eventId) {
    throw new ArcProjectionError('ARC_PROJECTION_INVALID_SHAPE', 'source event is not accepted in this world', 'sourceEventId');
  }
  return row;
}

async function validateReferences(ctx: Pick<GenericQueryCtx<DataModel>, 'db'>, worldId: string, fields: ArcProjectionFields): Promise<void> {
  const characters = await ctx.db.query('worldCharacters').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect();
  const characterIds = new Set(characters.map((row) => row.characterId));
  // `validateArcProjectionReferences` checks membership of exactly these three ids and no other
  // event reference, so each is a point lookup on `worldId + sequenceNumber` rather than a scan
  // of the world's whole event log — the same shape as `admitArcToPortfolio`'s source-event check.
  const candidateEventIds = [fields.incitingEventId, fields.latestTurningPointEventId, fields.recommendedEntryEventId]
    .filter((eventId): eventId is string => eventId !== null);
  const resolved = await Promise.all(candidateEventIds.map(async (eventId) => {
    const sequenceNumber = Number(eventId.split('#').at(-1));
    if (!Number.isSafeInteger(sequenceNumber)) return null;
    const row = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId).eq('sequenceNumber', sequenceNumber))
      .unique();
    return row !== null && deriveEventId(worldId, sequenceNumber) === eventId ? eventId : null;
  }));
  const eventIds = new Set(resolved.filter((eventId): eventId is string => eventId !== null));
  validateArcProjectionReferences(fields, characterIds, eventIds);
}

async function loadEvents(ctx: Pick<GenericQueryCtx<DataModel>, 'db'>, worldId: string, arcId: string): Promise<ArcProjectionEvent[]> {
  const rows = await ctx.db.query('storyArcProjectionEvents')
    .withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', worldId).eq('arcId', arcId)).collect();
  return rows.map((row) => {
    if (!isTimeSlot(row.timeSlot)) throw new ArcProjectionError('ARC_PROJECTION_INVALID_SHAPE', 'stored time slot is invalid');
    return {
      schemaVersion: 1, worldId: row.worldId, arcId: row.arcId, revision: row.revision,
      kind: row.kind, fields: parseArcProjectionFields(row.fields),
      sourceEventId: row.sourceEventId, sourceEventSequenceNumber: row.sourceEventSequenceNumber,
      worldDay: row.worldDay, timeSlot: row.timeSlot,
    };
  });
}

const writeArgs = {
  worldId: v.string(), arcId: v.string(), fields: v.any(),
  sourceEventId: v.string(), sourceEventSequenceNumber: v.number(),
};

export const initializeArcProjection = internalMutation({
  args: writeArgs,
  handler: async (ctx, args) => {
    const fields = parseArcProjectionFields(args.fields);
    if ((await loadEvents(ctx, args.worldId, args.arcId)).length > 0) {
      throw new ArcProjectionError('ARC_PROJECTION_SEQUENCE_CONFLICT', 'arc projection already exists');
    }
    const lifecycle = await ctx.db.query('storyArcLifecycles')
      .withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId)).unique();
    if (!lifecycle) throw new ArcProjectionError('ARC_PROJECTION_NOT_INITIALIZED', 'arc lifecycle must exist first');
    const source = await acceptedEvent(ctx, args.worldId, args.sourceEventSequenceNumber, args.sourceEventId);
    await validateReferences(ctx, args.worldId, fields);
    await ctx.db.insert('storyArcProjectionEvents', {
      schemaVersion: 1, worldId: args.worldId, arcId: args.arcId, revision: 0,
      kind: 'initialized', fields, sourceEventId: args.sourceEventId,
      sourceEventSequenceNumber: args.sourceEventSequenceNumber,
      worldDay: source.worldDay, timeSlot: source.timeSlot,
    });
    return { arcId: args.arcId, revision: 0 };
  },
});

export const updateArcProjection = internalMutation({
  args: { ...writeArgs, expectedRevision: v.number() },
  handler: async (ctx, args) => {
    const fields = parseArcProjectionFields(args.fields);
    const events = await loadEvents(ctx, args.worldId, args.arcId);
    if (events.length === 0) throw new ArcProjectionError('ARC_PROJECTION_NOT_INITIALIZED', 'arc projection does not exist');
    if (events.length - 1 !== args.expectedRevision) {
      throw new ArcProjectionError('ARC_PROJECTION_SEQUENCE_CONFLICT', 'expected revision is stale');
    }
    const source = await acceptedEvent(ctx, args.worldId, args.sourceEventSequenceNumber, args.sourceEventId);
    await validateReferences(ctx, args.worldId, fields);
    const revision = events.length;
    await ctx.db.insert('storyArcProjectionEvents', {
      schemaVersion: 1, worldId: args.worldId, arcId: args.arcId, revision,
      kind: 'updated', fields, sourceEventId: args.sourceEventId,
      sourceEventSequenceNumber: args.sourceEventSequenceNumber,
      worldDay: source.worldDay, timeSlot: source.timeSlot,
    });
    return { arcId: args.arcId, revision };
  },
});

export const getReplayedArcProjection = internalQuery({
  args: { worldId: v.string(), arcId: v.string() },
  handler: async (ctx, args) => {
    const lifecycle = await ctx.db.query('storyArcLifecycles')
      .withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId).eq('arcId', args.arcId)).unique();
    if (!lifecycle) return null;
    const events = await loadEvents(ctx, args.worldId, args.arcId);
    return events.length === 0 ? null : replayArcProjection(events, lifecycle.status);
  },
});
