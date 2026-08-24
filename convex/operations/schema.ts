import { defineTable } from 'convex/server';
import { v } from 'convex/values';

const postCommitStage = v.union(
  v.literal('projection'), v.literal('knowledge'), v.literal('memory'), v.literal('relationship'),
  v.literal('arc'), v.literal('episode'), v.literal('recap'), v.literal('safety'),
  v.literal('publication'), v.literal('snapshot'), v.literal('metrics'),
);

/**
 * Post-commit cognition + editorial pipeline runs (PRD §12 stages 11–21).
 * Mirrors the world-day run/checkpoint durability: each stage has durable status
 * and a safe retry boundary (AC#1). Accepted Canon events are never mutated by
 * this pipeline — these tables only track pipeline progress.
 */
export const operationsTables = {
  postCommitRuns: defineTable({
    runId: v.string(), worldId: v.string(),
    sourceEventId: v.string(), sourceEventSequenceNumber: v.number(), worldDay: v.number(),
    status: v.union(v.literal('running'), v.literal('failed'), v.literal('completed')),
    attemptCount: v.number(), failureStage: v.optional(postCommitStage),
    errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()),
    metricsTraceId: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(),
  })
    .index('by_run_id', ['runId'])
    .index('by_world_and_sequence', ['worldId', 'sourceEventSequenceNumber']),

  postCommitCheckpoints: defineTable({
    runId: v.string(), stage: postCommitStage, attempt: v.number(),
    status: v.union(v.literal('running'), v.literal('failed'), v.literal('completed')),
    artifact: v.optional(v.any()), errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(),
  })
    .index('by_run_and_stage', ['runId', 'stage'])
    .index('by_run_stage_attempt', ['runId', 'stage', 'attempt']),

  /**
   * Operator audit trail for the authenticated simulation operations console
   * (FR-K001, NFR-005: every privileged mutation is server-authorized, reasoned,
   * and auditable). One row per applied console command, written in the same
   * transaction as the command itself so an operation can never be applied
   * without its audit record.
   *
   * SECRET-SAFE: this table records who (operatorId + verified identity subject),
   * what (capability + target), why (reason) and when (at). It never stores an ops
   * token, an API key, or any private world content.
   */
  operatorAuditLog: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    operatorId: v.string(),
    /** Verified identity subject, or the literal `token` for the bootstrap path. */
    subject: v.string(),
    role: v.union(v.literal('viewer'), v.literal('operator'), v.literal('admin')),
    source: v.union(v.literal('identity'), v.literal('token')),
    capability: v.string(),
    target: v.optional(v.string()),
    reason: v.string(),
    outcome: v.union(v.literal('applied'), v.literal('no_op'), v.literal('refused')),
    resultCode: v.string(),
    at: v.number(),
  })
    .index('by_world_and_time', ['worldId', 'at'])
    .index('by_operator_and_time', ['operatorId', 'at']),

  /**
   * Operator controls over the public dynamic view (FR-Q002 / ART-134).
   *
   * APPEND-ONLY, and the effective state is derived by replaying it — the same shape
   * `safetyStatusOverrides` (FR-P004) chose, for the same reason. An operator control decides
   * what the public can see, so the question asked afterwards is never only "is it hidden now"
   * but "who hid it, when, why, and what did they release". A mutable `hidden: boolean` answers
   * the first and destroys the rest. A RELEASE is therefore a row too, never a deletion.
   *
   * This governs the PROJECTION, never Canon. Hiding a character's visual does not edit an
   * event, withdraw an accepted fact, or compensate anything — Canon is corrected through
   * FR-K005's workflow and nothing here can reach it, which
   * `dynamicViewControls.boundary.test.ts` pins structurally.
   *
   * Kept separate from `safetyStatusOverrides` on purpose: that table records content a
   * CLASSIFIER refused, this records content an OPERATOR pulled. Merging them would let a
   * release here silently un-withhold something safety refused, and would make the two
   * indistinguishable in an audit.
   */
  dynamicViewControls: defineTable({
    worldId: v.string(),
    kind: v.union(
      v.literal('pause_updates'),
      v.literal('pin_snapshot'),
      v.literal('hide_character'),
      v.literal('hide_scene'),
    ),
    /** The character or scene id for a targeted control; absent for a world-wide one. */
    target: v.optional(v.string()),
    /** `true` engages, `false` releases. Both are appended. */
    engaged: v.boolean(),
    reason: v.string(),
    /** The operator identity, as `operatorAuditLog.operatorId` records it. */
    actor: v.string(),
    createdAt: v.number(),
  })
    // `createdAt` in the key so the replay is a single ordered sweep per world rather than a
    // collect-and-sort, matching how `safetyStatusOverrides` is read.
    .index('by_world_and_created', ['worldId', 'createdAt']),
};
