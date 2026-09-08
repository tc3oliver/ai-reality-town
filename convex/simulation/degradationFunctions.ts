/**
 * The Convex write boundary for the FR-M004 ladder (ART-91).
 *
 * The DECISION is pure (`convex/simulation/degradation.ts`); this file reads the world's current
 * state, applies it, and appends the transition. Two properties are enforced here rather than
 * there, because they are properties of the store:
 *
 *  - **A transition is appended once.** Insert-if-absent on the derived `transitionId`, so a
 *    retried slot that re-reaches the same decision records one move (AC#2). Replaying a slot
 *    therefore cannot walk the ladder.
 *  - **The state row is the world's, not the run's.** One row per world, patched in place, because
 *    "which rung is this world on" has exactly one answer at a time. Its history lives in the
 *    append-only transition table, for the reason `safetyStatusOverrides` is separate from the
 *    classification it revises: how a world got here must not be editable by what moves it.
 *
 * Nothing here bypasses anything. It writes two rows about the world's own operating mode and
 * touches no Canon table, no publication and no read model.
 */

import { v } from 'convex/values';
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server';
import { internalMutation, internalQuery } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import {
  advanceDegradation,
  initialDegradationState,
  resumeFromPause,
  type DegradationDecision,
  type DegradationLevel,
  type DegradationState,
} from './degradation';

type ReadDb = GenericQueryCtx<DataModel>['db'];
type WriteDb = GenericMutationCtx<DataModel>['db'];

const stateValidator = v.object({
  level: v.string(),
  consecutiveFailures: v.number(),
  lastTriggerCode: v.union(v.string(), v.null()),
  lastTransitionWorldDay: v.number(),
  lastTransitionAt: v.number(),
});

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
  };
}

async function applyDecision(
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
    updatedAt: now,
  };
  if (row) await db.patch(row._id, next);
  else await db.insert('worldDegradationStates', next);
  return deduplicated;
}

/** The world's current rung. Read before a slot is claimed, so the slot runs at the right level. */
export const getDegradationState = internalQuery({
  args: { worldId: v.string() },
  returns: stateValidator,
  handler: async (ctx, args) => {
    const state = await loadDegradationState(ctx.db, args.worldId);
    return {
      level: state.level,
      consecutiveFailures: state.consecutiveFailures,
      lastTriggerCode: state.lastTriggerCode,
      lastTransitionWorldDay: state.lastTransitionWorldDay,
      lastTransitionAt: state.lastTransitionAt,
    };
  },
});

/** Fold one slot outcome into the world's rung, appending a transition when it moved. */
export const recordSlotOutcome = internalMutation({
  args: {
    worldId: v.string(),
    worldDay: v.number(),
    timeSlot: v.string(),
    authored: v.boolean(),
    errorCode: v.union(v.string(), v.null()),
    now: v.number(),
  },
  returns: v.object({ level: v.string(), transitioned: v.boolean(), deduplicated: v.boolean() }),
  handler: async (ctx, args) => {
    const state = await loadDegradationState(ctx.db, args.worldId);
    const decision = advanceDegradation(state, {
      worldId: args.worldId, worldDay: args.worldDay, timeSlot: args.timeSlot,
      authored: args.authored, errorCode: args.errorCode, at: args.now,
    });
    const deduplicated = await applyDecision(ctx.db, args.worldId, decision, args.now);
    return {
      level: decision.state.level,
      transitioned: decision.transition !== null && !deduplicated,
      deduplicated,
    };
  },
});

/**
 * An operator resuming a paused world. Returns to `rules_only`, never straight to `normal` — see
 * `resumeFromPause` for why a world that just failed six ways does not get its budget back at once.
 */
export const resumeDegradedWorld = internalMutation({
  args: { worldId: v.string(), operatorId: v.string(), now: v.number() },
  returns: v.object({ level: v.string(), transitioned: v.boolean() }),
  handler: async (ctx, args) => {
    const state = await loadDegradationState(ctx.db, args.worldId);
    const decision = resumeFromPause(state, args.now, args.operatorId);
    const deduplicated = await applyDecision(ctx.db, args.worldId, decision, args.now);
    return { level: decision.state.level, transitioned: decision.transition !== null && !deduplicated };
  },
});
