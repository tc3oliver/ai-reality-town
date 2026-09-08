/**
 * The Convex write boundary for the FR-M004 ladder (ART-91).
 *
 * The DECISION is pure (`convex/simulation/degradation.ts`); this file reads the world's current
 * state, applies it, and appends the transition. Two properties are enforced here rather than
 * there, because they are properties of the store:
 *
 *  - **A transition is appended once.** Insert-if-absent on the derived `transitionId`, so a
 *    retried slot that re-reaches the same decision records one move (AC#2). That alone did NOT
 *    stop a replayed slot from walking the ladder — the state row below is patched whether or not
 *    the transition row was new — so exactly-once now lives in the pure decision, keyed on the slot
 *    that fed it (ART-165). This dedup remains, because the two guard different things: one the
 *    history, one the state.
 *  - **The state row is the world's, not the run's.** One row per world, patched in place, because
 *    "which rung is this world on" has exactly one answer at a time. Its history lives in the
 *    append-only transition table, for the reason `safetyStatusOverrides` is separate from the
 *    classification it revises: how a world got here must not be editable by what moves it.
 *
 * Nothing here bypasses anything. It writes two rows about the world's own operating mode and
 * touches no Canon table, no publication and no read model.
 *
 * ART-165 removed `getDegradationState` and `resumeDegradedWorld` from this file. Both were
 * registered Convex functions with no caller anywhere: every reader calls `loadDegradationState`
 * directly, and the operator's resume path is the gated public `resumeDegradation`, which now shares
 * `applyDecision` with `recordSlotOutcome` instead of carrying its own copy of the same two writes.
 */

import { v } from 'convex/values';
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server';
import { internalMutation } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import {
  advanceDegradation,
  initialDegradationState,
  type DegradationDecision,
  type DegradationLevel,
  type DegradationState,
} from './degradation';

type ReadDb = GenericQueryCtx<DataModel>['db'];
type WriteDb = GenericMutationCtx<DataModel>['db'];

/** The world's rung, or the top of the ladder for a world that has never degraded. */
export async function loadDegradationState(db: ReadDb, worldId: string): Promise<DegradationState> {
  const row = await db.query('worldDegradationStates')
    .withIndex('by_world_id', (q) => q.eq('worldId', worldId)).unique();
  if (!row) return initialDegradationState(worldId);
  return {
    schemaVersion: 1,
    worldId,
    level: row.level as DegradationLevel,
    consecutiveFailures: row.consecutiveFailures,
    lastTriggerCode: row.lastTriggerCode,
    lastTransitionWorldDay: row.lastTransitionWorldDay,
    lastTransitionAt: row.lastTransitionAt,
    // ART-165. Absent on rows written before it: a world mid-outage at deploy time starts its probe
    // count again and has no recorded signal, which costs one deterministic world day and cannot
    // move it the wrong way.
    slotsSinceProviderProbe: row.slotsSinceProviderProbe ?? 0,
    lastSignalKey: row.lastSignalKey ?? null,
  };
}

export async function applyDecision(
  db: WriteDb,
  worldId: string,
  decision: DegradationDecision,
  now: number,
): Promise<boolean> {
  let deduplicated = false;
  const { transition } = decision;
  if (transition) {
    const prior = await db.query('worldDegradationTransitions')
      .withIndex('by_transition_id', (q) => q.eq('transitionId', transition.transitionId)).unique();
    if (prior) deduplicated = true;
    else await db.insert('worldDegradationTransitions', { ...transition });
  }
  const row = await db.query('worldDegradationStates')
    .withIndex('by_world_id', (q) => q.eq('worldId', worldId)).unique();
  const next = {
    schemaVersion: 1 as const,
    worldId,
    level: decision.state.level,
    consecutiveFailures: decision.state.consecutiveFailures,
    lastTriggerCode: decision.state.lastTriggerCode,
    lastTransitionWorldDay: decision.state.lastTransitionWorldDay,
    lastTransitionAt: decision.state.lastTransitionAt,
    slotsSinceProviderProbe: decision.state.slotsSinceProviderProbe,
    lastSignalKey: decision.state.lastSignalKey,
    updatedAt: now,
  };
  if (row) await db.patch(row._id, next);
  else await db.insert('worldDegradationStates', next);
  return deduplicated;
}

/** Fold one slot outcome into the world's rung, appending a transition when it moved. */
export const recordSlotOutcome = internalMutation({
  args: {
    worldId: v.string(),
    worldDay: v.number(),
    timeSlot: v.string(),
    authored: v.boolean(),
    /**
     * ART-165. Whether the slot called a model at all. Required rather than defaulted: a caller
     * that does not know is a caller that should not be feeding this ladder, and defaulting it to
     * true is exactly the bug that made the two lowest rungs unreachable.
     */
    usedProvider: v.boolean(),
    errorCode: v.union(v.string(), v.null()),
    now: v.number(),
  },
  returns: v.object({ level: v.string(), transitioned: v.boolean(), deduplicated: v.boolean() }),
  handler: async (ctx, args) => {
    const state = await loadDegradationState(ctx.db, args.worldId);
    const decision = advanceDegradation(state, {
      worldId: args.worldId, worldDay: args.worldDay, timeSlot: args.timeSlot,
      authored: args.authored, usedProvider: args.usedProvider, errorCode: args.errorCode,
      at: args.now,
    });
    const deduplicated = await applyDecision(ctx.db, args.worldId, decision, args.now);
    return {
      level: decision.state.level,
      transitioned: decision.transition !== null && !deduplicated,
      deduplicated,
    };
  },
});
