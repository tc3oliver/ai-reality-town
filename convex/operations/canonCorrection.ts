/**
 * Audited Canon correction workflows (FR-K003).
 *
 * THREE REMEDIATION TYPES, THREE CONTRACTS
 * ----------------------------------------
 * | Type | Claims the target was wrong | May overrule forward-only canon rules | Must restate public content |
 * | --- | --- | --- | --- |
 * | `correction`   | yes — supersedes what the cited events said | yes | no |
 * | `compensation` | no  — the cited events still stand; this only offsets state going forward | no | no |
 * | `retcon`       | yes — rewrites the canonical account | yes | YES, a `publicSummary` is required |
 *
 * NOTHING HERE EDITS ACCEPTED HISTORY (AC#1)
 * ------------------------------------------
 * A remediation is an ORDINARY appended event. It goes through the SAME
 * {@link commitProposedEvent} pipeline as every simulated event — structural
 * validation, idempotency, canon validation against the current projection,
 * sequence allocation, append — because {@link CanonCommitStore} exposes no update
 * and no delete. The cited events keep their rows, their sequence numbers, and
 * their payloads; replay therefore still reproduces the whole history, with the
 * remediation applied in its own position (AC#3).
 *
 * WHO / WHY IS RECORDED TWICE (AC#2, AC#5)
 * ----------------------------------------
 * The operator identity and the reason are written BOTH onto the accepted event
 * itself (`metadata.remediation`, immutable forever) AND into the ART-48
 * `operatorAuditLog` row, in the same transaction as the commit. A remediation can
 * therefore never exist without an attributable operator and a stated reason, and
 * the trail survives even if the audit table is later re-indexed.
 *
 * Pure module — no Convex imports, no clock, no randomness, no I/O. The Convex
 * wiring in `./canonCorrectionFunctions.ts` supplies the authorized principal, the
 * canon store, the audit sink, and the post-commit refresh port.
 */

import { CANON_SCHEMA_VERSION } from '../shared/constants';
import { commitProposedEvent, type CanonCommitStore, type CommitResult } from '../canon/commit';
import type { RemediationEventType, TimeSlot } from '../canon/eventTypes';
import type { JsonValue, ProposedEvent, StateChange } from '../canon/model';
import {
  buildOperatorAuditEntry,
  type OperatorAuditEntry,
  type OperatorPrincipal,
  type OpsCapability,
} from './operatorAuthorization';

/** What each remediation type is allowed and required to do. */
export type RemediationPolicy = {
  /** The ART-48 capability an operator must hold to submit this remediation. */
  capability: OpsCapability;
  /**
   * True when the remediation overrules the events it cites. Superseding types are
   * exempt from the forward-only canon rules (see `canon/eventTypes.ts`); a
   * compensation is not, because the original account still stands.
   */
  supersedesTargets: boolean;
  /** Retcon rewrites the public account, so it must carry the replacement summary. */
  requiresPublicSummary: boolean;
};

export const REMEDIATION_POLICY: Readonly<Record<RemediationEventType, RemediationPolicy>> = {
  correction: { capability: 'canon.correct', supersedesTargets: true, requiresPublicSummary: false },
  compensation: { capability: 'canon.compensate', supersedesTargets: false, requiresPublicSummary: false },
  retcon: { capability: 'canon.retcon', supersedesTargets: true, requiresPublicSummary: true },
};

export class RemediationError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'RemediationError';
  }
}

/** The immutable audit block stamped onto the accepted remediation event. */
export type RemediationProvenance = {
  schemaVersion: 1;
  type: RemediationEventType;
  operatorId: string;
  reason: string;
  /** Accepted events this remediation is about; always equal to `causedByEventIds`. */
  targetEventIds: string[];
  /** Targets whose account this event overrules. Empty for a compensation. */
  supersedes: string[];
  /** Targets this event offsets while leaving their account standing. */
  offsets: string[];
};

/** Everything an operator states when remediating Canon. */
export type RemediationRequest = {
  worldId: string;
  remediationType: RemediationEventType;
  /** Accepted event ids being remediated. At least one, no duplicates. */
  targetEventIds: readonly string[];
  /** Free-text justification. Required, and copied into Canon and the audit trail. */
  reason: string;
  idempotencyKey: string;
  worldDay: number;
  timeSlot: TimeSlot;
  locationId?: string;
  participantIds: readonly string[];
  /** The restated public account. Required for a retcon. */
  publicSummary?: string;
  stateChanges: readonly StateChange[];
};

function requireText(value: unknown, code: string, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new RemediationError(code, message);
  return value;
}

/**
 * Build the remediation ProposedEvent. Enforces only the rules that are specific to
 * remediation; everything else (references, preconditions, participant consistency,
 * schema version) is left to the shared structural and canon validators so a
 * remediation is held to exactly the same standard as any other proposed event.
 */
export function buildRemediationEvent(
  principal: Pick<OperatorPrincipal, 'operatorId'>,
  request: RemediationRequest,
): ProposedEvent {
  const policy = REMEDIATION_POLICY[request.remediationType];
  const operatorId = requireText(principal.operatorId, 'REMEDIATION_OPERATOR_REQUIRED', 'a remediation requires an operator identity');
  const reason = requireText(request.reason, 'REMEDIATION_REASON_REQUIRED', 'a remediation requires a non-empty reason');
  const targetEventIds = [...request.targetEventIds];
  if (targetEventIds.length === 0) {
    throw new RemediationError('REMEDIATION_TARGET_REQUIRED', 'a remediation must cite the accepted events it remediates');
  }
  if (new Set(targetEventIds).size !== targetEventIds.length) {
    throw new RemediationError('REMEDIATION_TARGET_DUPLICATED', 'a remediation must not cite the same event twice');
  }
  if (policy.requiresPublicSummary && (request.publicSummary ?? '').trim().length === 0) {
    throw new RemediationError(
      'REMEDIATION_PUBLIC_SUMMARY_REQUIRED',
      'a retcon rewrites the public account and must carry the replacement public summary',
    );
  }

  const provenance: RemediationProvenance = {
    schemaVersion: 1,
    type: request.remediationType,
    operatorId,
    reason,
    targetEventIds,
    supersedes: policy.supersedesTargets ? [...targetEventIds] : [],
    offsets: policy.supersedesTargets ? [] : [...targetEventIds],
  };

  return {
    schemaVersion: CANON_SCHEMA_VERSION,
    worldId: request.worldId,
    idempotencyKey: request.idempotencyKey,
    // Structural validation refuses any remediation not proposed by an administrator.
    proposedBy: { type: 'admin', id: operatorId },
    worldDay: request.worldDay,
    timeSlot: request.timeSlot,
    eventType: request.remediationType,
    ...(request.locationId === undefined ? {} : { locationId: request.locationId }),
    participantIds: [...request.participantIds],
    causedByEventIds: targetEventIds,
    ...(request.publicSummary === undefined ? {} : { publicSummary: request.publicSummary }),
    stateChanges: request.stateChanges.map((change) => ({ ...change })),
    metadata: { remediation: provenance as unknown as JsonValue },
  };
}

/**
 * Ports the orchestration needs. The Convex wiring binds them to the shared canon
 * store, an `operatorAuditLog` insert, and ART-98's post-commit pipeline; tests bind
 * them to the in-memory canon store and recording doubles.
 */
export type RemediationPorts = {
  canonStore: CanonCommitStore;
  /** Append the ART-48 audit row inside the commit's own transaction. */
  appendAudit: (entry: OperatorAuditEntry) => Promise<void>;
  /**
   * Refresh the public read models for a newly accepted event. Bound to the SAME
   * post-commit pipeline a simulated event runs, so a correction can never publish
   * through a path the ordinary flow does not use (AC#4).
   */
  refreshPublicContent: (worldId: string, sequenceNumber: number) => Promise<RemediationRefresh>;
};

export type RemediationRefresh = { runId: string; status: string };

export type RemediationResult = CommitResult & {
  remediationType: RemediationEventType;
  /** Whether the remediation overrules its targets or merely offsets them. */
  supersedes: string[];
  offsets: string[];
  refresh: RemediationRefresh;
};

/**
 * Commit one remediation, audit it, and refresh public content.
 *
 * Ordering is deliberate: the event is committed FIRST, so a rejected remediation
 * writes neither Canon nor an audit row, and the audit row is appended in the same
 * transaction as the commit, so an accepted remediation can never lack its
 * who/what/why record. A retried submission with the same idempotency key returns
 * the original event (`deduplicated`) and is audited as a `no_op` rather than
 * appending a second remediation.
 */
export async function submitRemediation(
  ports: RemediationPorts,
  input: {
    principal: OperatorPrincipal;
    request: RemediationRequest;
    traceId: string;
    at: number;
  },
): Promise<RemediationResult> {
  const { principal, request, traceId, at } = input;
  const policy = REMEDIATION_POLICY[request.remediationType];
  const proposed = buildRemediationEvent(principal, request);

  const commit = await commitProposedEvent(ports.canonStore, { proposed, traceId });

  await ports.appendAudit(buildOperatorAuditEntry({
    principal,
    worldId: request.worldId,
    capability: policy.capability,
    target: proposed.causedByEventIds.join(','),
    reason: request.reason,
    outcome: commit.deduplicated ? 'no_op' : 'applied',
    resultCode: commit.deduplicated ? 'OPS_NO_OP' : 'OPS_OK',
    at,
  }));

  // AC#4: public content follows the correction through the ordinary post-commit
  // pipeline. It is safe to re-run for a deduplicated submission — a completed run
  // short-circuits and a failed one resumes at the stage that failed.
  const refresh = await ports.refreshPublicContent(request.worldId, commit.sequenceNumber);

  return {
    ...commit,
    remediationType: request.remediationType,
    supersedes: policy.supersedesTargets ? [...proposed.causedByEventIds] : [],
    offsets: policy.supersedesTargets ? [] : [...proposed.causedByEventIds],
    refresh,
  };
}
