import { v } from 'convex/values';
import type { GenericMutationCtx } from 'convex/server';
import { internalMutation, internalQuery } from '../_generated/server';
import type { DataModel, Doc } from '../_generated/dataModel';
import { rowToAcceptedEvent } from '../canon/serialize';
import { buildRecapSnapshot, parseRecapStructuredPayload, RecapError, type RecapSnapshot } from './model';

const recapTypeValidator = v.union(v.literal('scene'), v.literal('episode'), v.literal('arc'), v.literal('season'), v.literal('viewer_context'));

const snapshotFromRow = (row: Doc<'recapSnapshots'>): RecapSnapshot => ({
  id: row.snapshotId, schemaVersion: row.schemaVersion, worldId: row.worldId, recapType: row.recapType,
  targetId: row.targetId, sourceFromEventId: row.sourceFromEventId, sourceToEventId: row.sourceToEventId,
  sourceFromSequenceNumber: row.sourceFromSequenceNumber, sourceToSequenceNumber: row.sourceToSequenceNumber,
  content: row.content, structuredPayload: parseRecapStructuredPayload(row.structuredPayload),
  sourceScope: row.sourceScope ?? null, version: row.version, generatedAt: row.generatedAt,
});

/**
 * Sequence numbers of the events that MOVED one arc, within `[from, to]`.
 *
 * Read from `storyArcProjectionEvents` by the arc's own index and walked newest-first, stopping at
 * the cursor — so the read is proportional to that arc's delta, not to world history. Scanning
 * canon and filtering by membership would be the obvious alternative and is exactly the
 * O(world history) pattern ART-100 removed from this pipeline.
 *
 * A projection event exists only where the arc's projection actually changed, which is the right
 * source for an arc summary: FR-G002 asks for the arc's PROGRESS, not for every event that merely
 * mentioned it.
 */
async function arcProgressSequenceNumbers(
  db: GenericMutationCtx<DataModel>['db'],
  worldId: string,
  arcId: string,
  from: number,
  to: number,
): Promise<number[]> {
  const selected: number[] = [];
  for await (const row of db.query('storyArcProjectionEvents')
    .withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', worldId).eq('arcId', arcId))
    .order('desc')) {
    if (row.sourceEventSequenceNumber < from) break;
    if (row.sourceEventSequenceNumber <= to) selected.push(row.sourceEventSequenceNumber);
  }
  return [...new Set(selected)].sort((left, right) => left - right);
}

export const generateIncrementalRecap = internalMutation({
  args: { snapshotId: v.string(), worldId: v.string(), recapType: recapTypeValidator, targetId: v.string(),
    mode: v.union(v.literal('incremental'), v.literal('regeneration')), fromSequenceNumber: v.optional(v.number()),
    toSequenceNumber: v.number(), generatedAt: v.number(),
    /** Set for the SELECTIVE `arc` tier: sources become that arc's progress, not the whole range. */
    arcId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.snapshotId.trim().length === 0 || args.targetId.trim().length === 0
        || !Number.isSafeInteger(args.toSequenceNumber) || args.toSequenceNumber < 0
        || !Number.isSafeInteger(args.generatedAt) || args.generatedAt < 0) {
      throw new RecapError('RECAP_INVALID', 'invalid generation request');
    }
    const selective = args.arcId !== undefined;
    const duplicate = await ctx.db.query('recapSnapshots').withIndex('by_snapshot_id', (q) => q.eq('snapshotId', args.snapshotId)).unique();
    if (duplicate) {
      const snapshot = snapshotFromRow(duplicate);
      // The watermark, which for a selective tier is the scope end rather than the last matching
      // event — comparing the event would call a legitimate replay an idempotency conflict.
      const covered = snapshot.sourceScope?.toSequenceNumber ?? snapshot.sourceToSequenceNumber;
      if (snapshot.worldId !== args.worldId || snapshot.recapType !== args.recapType || snapshot.targetId !== args.targetId
          || covered !== args.toSequenceNumber
          || snapshot.structuredPayload.generationMode !== args.mode) {
        throw new RecapError('RECAP_IDEMPOTENCY_CONFLICT', 'Snapshot ID was reused with different generation inputs');
      }
      return { snapshot, deduplicated: true };
    }
    const priorRow = await ctx.db.query('recapSnapshots').withIndex('by_target_and_version',
      (q) => q.eq('worldId', args.worldId).eq('recapType', args.recapType).eq('targetId', args.targetId)).order('desc').first();
    const prior = priorRow ? snapshotFromRow(priorRow) : null;
    if (args.mode === 'regeneration' && !prior) throw new RecapError('RECAP_PRIOR_REQUIRED', 'regeneration requires a prior snapshot');
    const priorFrom = prior ? prior.sourceScope?.fromSequenceNumber ?? prior.sourceFromSequenceNumber : null;
    const priorTo = prior ? prior.sourceScope?.toSequenceNumber ?? prior.sourceToSequenceNumber : null;
    const from = args.mode === 'regeneration' && prior ? priorFrom
      : prior ? (priorTo as number) + 1 : args.fromSequenceNumber;
    if (!Number.isSafeInteger(from) || (from as number) < 0 || (from as number) > args.toSequenceNumber) {
      throw new RecapError('RECAP_INCREMENTAL_RANGE', 'a bounded valid source range is required');
    }

    let acceptedEvents;
    if (selective) {
      const sequenceNumbers = await arcProgressSequenceNumbers(
        ctx.db, args.worldId, args.arcId as string, from as number, args.toSequenceNumber,
      );
      if (sequenceNumbers.length === 0) {
        /**
         * The arc was named by this event's classification but its projection did not move — an
         * ordinary state, since membership and progress are different things.
         *
         * Reported as a skip rather than thrown: a throw here would fail the recap stage, and the
         * whole point of driving the arc tier off `classifiedArcIds` is that a membership without
         * progress is normal. Nothing is written, so the cursor stays put and the next real
         * progress on this arc still covers the range from where coverage left off.
         */
        return { snapshot: null, deduplicated: false };
      }
      const rows = await Promise.all(sequenceNumbers.map((sequenceNumber) => ctx.db.query('canonEvents')
        .withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId).eq('sequenceNumber', sequenceNumber))
        .unique()));
      acceptedEvents = rows.map((row) => {
        if (!row) throw new RecapError('RECAP_SOURCE_NOT_ACCEPTED', 'arc progress references an event that is not in canon');
        return rowToAcceptedEvent(row);
      });
    } else {
      const rows = await ctx.db.query('canonEvents').withIndex('by_world_and_sequence',
        (q) => q.eq('worldId', args.worldId).gte('sequenceNumber', from as number).lte('sequenceNumber', args.toSequenceNumber)).order('asc').collect();
      acceptedEvents = rows.map(rowToAcceptedEvent);
    }

    const snapshot = buildRecapSnapshot({ id: args.snapshotId, worldId: args.worldId, recapType: args.recapType,
      targetId: args.targetId, prior, acceptedEvents, mode: args.mode, generatedAt: args.generatedAt,
      sourceScope: selective ? { fromSequenceNumber: from as number, toSequenceNumber: args.toSequenceNumber } : null });
    await ctx.db.insert('recapSnapshots', { snapshotId: snapshot.id, schemaVersion: 1, worldId: snapshot.worldId,
      recapType: snapshot.recapType, targetId: snapshot.targetId, sourceFromEventId: snapshot.sourceFromEventId,
      sourceToEventId: snapshot.sourceToEventId, sourceFromSequenceNumber: snapshot.sourceFromSequenceNumber,
      sourceToSequenceNumber: snapshot.sourceToSequenceNumber, content: snapshot.content,
      structuredPayload: snapshot.structuredPayload,
      ...(snapshot.sourceScope === null ? {} : { sourceScope: snapshot.sourceScope }),
      version: snapshot.version, generatedAt: snapshot.generatedAt });
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
