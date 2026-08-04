/**
 * Pure decision logic for the simulation operations console (FR-K001).
 *
 * The console's most dangerous control is "cancel an uncommitted scene". This
 * module is where the Canon-safety rule is decided and tested:
 *
 *   Cancellation may only discard queue/pre-commit state. It must NEVER read,
 *   edit, or delete accepted Canon history (CLAUDE.md §6, PRD NFR-008).
 *
 * Concretely that means a slot may be cancelled only while it is still `queued`
 * or has `failed`, and only while it has produced no committed event. A slot that
 * is `running` cannot be interrupted safely mid-transaction, and a `completed`
 * slot — or any slot whose world-day run already recorded committed event ids —
 * has already contributed to append-only Canon and is refused outright.
 *
 * Pure module — no Convex imports, no clock, no randomness. The wiring layer
 * ({@link ./opsConsoleFunctions.ts}) loads rows, calls in here, and applies the
 * decision.
 */

import type { SlotRunStatus } from '../simulation/scheduler';

/** Result codes surfaced to the operator and recorded in the audit trail. */
export const OPS_RESULT_CODES = [
  'OPS_OK',
  'OPS_NO_OP',
  'OPS_SLOT_CANCELLED',
  'OPS_SLOT_ALREADY_CANCELLED',
  'OPS_SLOT_RUNNING',
  'OPS_SLOT_COMMITTED',
  'OPS_SLOT_NOT_FOUND',
  'OPS_SCHEDULE_NOT_FOUND',
] as const;
export type OpsResultCode = (typeof OPS_RESULT_CODES)[number];

export class OpsConsoleError extends Error {
  constructor(readonly code: OpsResultCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'OpsConsoleError';
  }
}

/** The slot fields the cancellation decision depends on. */
export type CancellableSlot = {
  slotKey: string;
  worldId: string;
  status: SlotRunStatus;
  /** Present once the slot's scene reached accepted Canon. */
  committedEventId?: string;
};

/** The world-day run fields the cancellation decision depends on. */
export type CancellableRun = {
  runId: string;
  status: 'running' | 'failed' | 'completed';
  committedEventIds?: readonly string[];
};

export type CancellationDecision =
  | { action: 'cancel'; resultCode: 'OPS_SLOT_CANCELLED' }
  | { action: 'none'; resultCode: 'OPS_SLOT_ALREADY_CANCELLED' };

/**
 * Decide whether an uncommitted scene may be cancelled.
 *
 * `runs` are the world-day runs recorded for the same (world, day, slot). Any of
 * them holding committed event ids means accepted Canon exists for this slot, so
 * cancellation is refused even if the queue row still looks uncommitted — the
 * queue row is not the authority on what Canon accepted.
 *
 * Idempotent: cancelling an already-cancelled slot is a no-op, not an error, so
 * an operator (or a retried request) can safely repeat the call.
 */
export function decideSlotCancellation(
  slot: CancellableSlot,
  runs: readonly CancellableRun[] = [],
): CancellationDecision {
  if (slot.committedEventId !== undefined) {
    throw new OpsConsoleError('OPS_SLOT_COMMITTED', 'slot already committed an event; accepted Canon is never cancelled');
  }
  if (runs.some((run) => run.status === 'completed' || (run.committedEventIds?.length ?? 0) > 0)) {
    throw new OpsConsoleError('OPS_SLOT_COMMITTED', 'slot has a committed world-day run; accepted Canon is never cancelled');
  }
  switch (slot.status) {
    case 'cancelled':
      return { action: 'none', resultCode: 'OPS_SLOT_ALREADY_CANCELLED' };
    case 'running':
      throw new OpsConsoleError('OPS_SLOT_RUNNING', 'a running slot cannot be cancelled; wait for it to finish or fail');
    case 'completed':
      throw new OpsConsoleError('OPS_SLOT_COMMITTED', 'a completed slot is not cancellable');
    case 'queued':
    case 'failed':
      return { action: 'cancel', resultCode: 'OPS_SLOT_CANCELLED' };
  }
}

/** Queue counts by status, for the FR-K001 "inspect schedules and queues" control. */
export type QueueSummary = Record<SlotRunStatus, number>;

export function summarizeQueue(slots: readonly { status: SlotRunStatus }[]): QueueSummary {
  const summary: QueueSummary = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const slot of slots) summary[slot.status] += 1;
  return summary;
}

/**
 * Shape a world projection into the operations state view.
 *
 * This is the OPERATIONS read path, not the public read path: it deliberately
 * reports only counts and cursors, never character knowledge, memories, or
 * prompts, so that even an authorized console response cannot become a leak
 * vector for the private state NFR-005 protects.
 */
export type OperationalWorldStateView = {
  worldId: string;
  lastSequenceNumber: number;
  characterCount: number;
  aliveCharacterCount: number;
  locationCount: number;
  organizationCount: number;
  trackedItemCount: number;
  factCount: number;
  environmentPredicateCount: number;
};

export function summarizeWorldState(projection: {
  worldId: string;
  lastSequenceNumber: number;
  characterAlive: Record<string, boolean>;
  itemOwners: Record<string, string>;
  facts: readonly unknown[];
  worldEnvironment: Record<string, unknown>;
  locations: Record<string, unknown>;
  organizations: Record<string, unknown>;
}): OperationalWorldStateView {
  const alive = Object.values(projection.characterAlive).filter(Boolean).length;
  return {
    worldId: projection.worldId,
    lastSequenceNumber: projection.lastSequenceNumber,
    characterCount: Object.keys(projection.characterAlive).length,
    aliveCharacterCount: alive,
    locationCount: Object.keys(projection.locations).length,
    organizationCount: Object.keys(projection.organizations).length,
    trackedItemCount: Object.keys(projection.itemOwners).length,
    factCount: projection.facts.length,
    environmentPredicateCount: Object.keys(projection.worldEnvironment).length,
  };
}
