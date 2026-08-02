import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { rowToAcceptedEvent } from '../canon/serialize';
import { buildRecapSnapshot, parseRecapStructuredPayload, RecapError, type RecapSnapshot } from './model';

const recapTypeValidator = v.union(v.literal('scene'), v.literal('episode'), v.literal('arc'), v.literal('season'), v.literal('viewer_context'));

const snapshotFromRow = (row: Doc<'recapSnapshots'>): RecapSnapshot => ({
  id: row.snapshotId, schemaVersion: row.schemaVersion, worldId: row.worldId, recapType: row.recapType,
  targetId: row.targetId, sourceFromEventId: row.sourceFromEventId, sourceToEventId: row.sourceToEventId,
  sourceFromSequenceNumber: row.sourceFromSequenceNumber, sourceToSequenceNumber: row.sourceToSequenceNumber,
  content: row.content, structuredPayload: parseRecapStructuredPayload(row.structuredPayload), version: row.version, generatedAt: row.generatedAt,
});

export const generateIncrementalRecap = internalMutation({
  args: { snapshotId: v.string(), worldId: v.string(), recapType: recapTypeValidator, targetId: v.string(),
    mode: v.union(v.literal('incremental'), v.literal('regeneration')), fromSequenceNumber: v.optional(v.number()),
    toSequenceNumber: v.number(), generatedAt: v.number() },
  handler: async (ctx, args) => {
    if (args.snapshotId.trim().length === 0 || args.targetId.trim().length === 0
        || !Number.isSafeInteger(args.toSequenceNumber) || args.toSequenceNumber < 0
        || !Number.isSafeInteger(args.generatedAt) || args.generatedAt < 0) {
      throw new RecapError('RECAP_INVALID', 'invalid generation request');
    }
    const duplicate = await ctx.db.query('recapSnapshots').withIndex('by_snapshot_id', (q) => q.eq('snapshotId', args.snapshotId)).unique();
    if (duplicate) {
      const snapshot = snapshotFromRow(duplicate);
      if (snapshot.worldId !== args.worldId || snapshot.recapType !== args.recapType || snapshot.targetId !== args.targetId
          || snapshot.sourceToSequenceNumber !== args.toSequenceNumber
          || snapshot.structuredPayload.generationMode !== args.mode) {
        throw new RecapError('RECAP_IDEMPOTENCY_CONFLICT', 'Snapshot ID was reused with different generation inputs');
      }
      return { snapshot, deduplicated: true };
    }
    const priorRow = await ctx.db.query('recapSnapshots').withIndex('by_target_and_version',
      (q) => q.eq('worldId', args.worldId).eq('recapType', args.recapType).eq('targetId', args.targetId)).order('desc').first();
    const prior = priorRow ? snapshotFromRow(priorRow) : null;
    if (args.mode === 'regeneration' && !prior) throw new RecapError('RECAP_PRIOR_REQUIRED', 'regeneration requires a prior snapshot');
    const from = args.mode === 'regeneration' && prior ? prior.sourceFromSequenceNumber
      : prior ? prior.sourceToSequenceNumber + 1 : args.fromSequenceNumber;
    if (!Number.isSafeInteger(from) || (from as number) < 0 || (from as number) > args.toSequenceNumber) {
      throw new RecapError('RECAP_INCREMENTAL_RANGE', 'a bounded valid source range is required');
    }
    const rows = await ctx.db.query('canonEvents').withIndex('by_world_and_sequence',
      (q) => q.eq('worldId', args.worldId).gte('sequenceNumber', from as number).lte('sequenceNumber', args.toSequenceNumber)).order('asc').collect();
    const snapshot = buildRecapSnapshot({ id: args.snapshotId, worldId: args.worldId, recapType: args.recapType,
      targetId: args.targetId, prior, acceptedEvents: rows.map(rowToAcceptedEvent), mode: args.mode, generatedAt: args.generatedAt });
    await ctx.db.insert('recapSnapshots', { snapshotId: snapshot.id, schemaVersion: 1, worldId: snapshot.worldId,
      recapType: snapshot.recapType, targetId: snapshot.targetId, sourceFromEventId: snapshot.sourceFromEventId,
      sourceToEventId: snapshot.sourceToEventId, sourceFromSequenceNumber: snapshot.sourceFromSequenceNumber,
      sourceToSequenceNumber: snapshot.sourceToSequenceNumber, content: snapshot.content,
      structuredPayload: snapshot.structuredPayload, version: snapshot.version, generatedAt: snapshot.generatedAt });
    return { snapshot, deduplicated: false };
  },
});

export const getRecapHistoryInternal = internalQuery({
  args: { worldId: v.string(), recapType: recapTypeValidator, targetId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('recapSnapshots').withIndex('by_target_and_version',
      (q) => q.eq('worldId', args.worldId).eq('recapType', args.recapType).eq('targetId', args.targetId)).order('asc').collect();
    return rows.map(snapshotFromRow);
  },
});
