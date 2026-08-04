/**
 * Pure derivation and redaction for the proposed-event review surface (FR-K002).
 *
 * FR-K002 requires an authorized operator to see, for one proposed event:
 * the Proposed Event, its Validation Result, its Rejection Reason, the Model
 * Trace, the Participants, the State Changes, the Related Arcs, and the Safety
 * Label. This module decides ALL of that from already-durable records; it never
 * writes anything and never re-runs validation, safety classification, or the
 * model. Review is a read of what the pipeline already recorded.
 *
 * Pure module — no Convex imports, no clock, no randomness, no I/O. The store
 * layer ({@link ./proposalReviewStore.ts}) loads rows and the wiring layer
 * ({@link ./proposalReviewFunctions.ts}) authorizes, so every policy decision
 * here is unit testable without a deployment.
 *
 * TWO RULES THIS MODULE EXISTS TO ENFORCE
 * ---------------------------------------
 * 1. STABLE REASON CODES ONLY (AC#3). A rejection is reported as the machine
 *    code the producing layer already recorded (a `CanonErrorCode`, an
 *    orchestration code, or a safety reason code). This module never reads,
 *    parses, pattern-matches, or returns a free-text error message, so the
 *    console cannot grow a second, drifting classification of "why".
 *
 * 2. SECRET-SAFE PROJECTION (AC#2). The ART-57 trace record is already
 *    incapable of holding a prompt or a secret, but the review response is
 *    still projected by role: a read-only `viewer` operator receives only the
 *    public trace projection and no proposal metadata, while `operator`/`admin`
 *    receive the full accounting record. Proposal metadata — the one part of a
 *    proposal that is free-form provider JSON — is scrubbed with ART-57's own
 *    sensitive-key predicate rather than a copy of it.
 */

import {
  isSensitiveTraceKey,
  publicLlmTrace,
  type LlmTraceRecord,
  type PublicLlmTrace,
} from '../observability/llmTrace';
import type { OperatorRole } from './operatorAuthorization';

/** How a proposal ended up. Exactly one applies to any proposal at any instant. */
export const PROPOSAL_DISPOSITIONS = ['committed', 'rejected', 'withheld', 'pending'] as const;
export type ProposalDisposition = (typeof PROPOSAL_DISPOSITIONS)[number];

/** The FR-K002 "Validation Result" vocabulary; mirrors the ART-57 trace vocabulary. */
export const PROPOSAL_VALIDATION_RESULTS = ['accepted', 'rejected', 'not_run'] as const;
export type ProposalValidationResult = (typeof PROPOSAL_VALIDATION_RESULTS)[number];

/**
 * The code reported when a producing layer recorded a failure but not a usable
 * machine code. Reporting a placeholder is deliberate: inventing a specific code
 * from a free-text message would be exactly the classification logic AC#3 forbids.
 */
export const UNCLASSIFIED_REJECTION_CODE = 'UNCLASSIFIED_REJECTION';

/** The code used when safety withheld a scene but recorded no category. */
export const SAFETY_REVIEW_REQUIRED_CODE = 'SAFETY_REVIEW_REQUIRED';

/** A machine reason code: SCREAMING_SNAKE_CASE, bounded. Anything else is not a code. */
const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;

/**
 * Accept a recorded reason code, or fall back to the placeholder.
 *
 * This is the whole of AC#3: a value either already IS a stable code, or it is
 * not reported as one. No message parsing, no keyword matching, no heuristics.
 */
export function stableReasonCode(value: string | null | undefined): string {
  return typeof value === 'string' && REASON_CODE_PATTERN.test(value) ? value : UNCLASSIFIED_REJECTION_CODE;
}

/** Safety labels produced by post-generation classification (ART-54/ART-55). */
export type ProposalSafetyLabel = 'allow' | 'allow_with_warning' | 'withhold' | 'human_review_required';

/** A state change exactly as the proposal carried it; shape is owned by Canon. */
export type ReviewStateChange = Readonly<Record<string, unknown>> & { type: string };

/** The proposed event as recorded, before any Canon decision. */
export type ReviewProposedEvent = {
  schemaVersion: number;
  idempotencyKey: string;
  eventType: string;
  worldDay: number;
  timeSlot: string;
  locationId?: string;
  participantIds: readonly string[];
  causedByEventIds: readonly string[];
  publicSummary?: string;
  proposedBy: { type: string; id?: string };
  stateChanges: readonly ReviewStateChange[];
  metadata?: Readonly<Record<string, unknown>>;
};

/** The scene the proposal came out of; supplies participants and candidate arcs. */
export type ReviewSceneContext = {
  sceneId: string;
  simulationRunId: string;
  worldId: string;
  worldDay: number;
  timeSlot: string;
  locationId: string;
  participantIds: readonly string[];
  arcIds: readonly string[];
};

/** The persisted post-generation safety decision for the scene. */
export type ReviewSafety = {
  label: ProposalSafetyLabel;
  reasonCodes: readonly string[];
  warningCodes: readonly string[];
  classifiedTextHash: string;
};

/** Canon's decision, present only once the proposal reached accepted history. */
export type ReviewCommit = {
  eventId: string;
  sequenceNumber: number;
  validationVersion: string;
  traceId: string;
  acceptedAt: number;
};

/** A recorded slot failure. `reasonCode` is the producing layer's stable code. */
export type ReviewRejection = {
  reasonCode: string | null;
  stage: string | null;
  runId: string;
};

/** Vendor-neutral provider accounting for the scene call; never carries content. */
export type ReviewProviderTrace = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  retryCount: number;
};

/** Everything the store gathered for one proposal, before derivation and redaction. */
export type ProposalReviewSource = {
  scene: ReviewSceneContext;
  proposal: ReviewProposedEvent;
  safety: ReviewSafety;
  /** `required` means post-generation safety withheld the scene from Canon. */
  reviewStatus: 'not_required' | 'required';
  commit: ReviewCommit | null;
  rejection: ReviewRejection | null;
  /** Arc memberships recorded for the committed event, if any. */
  classifiedArcIds: readonly string[];
  trace: LlmTraceRecord | null;
  providerTrace: ReviewProviderTrace | null;
};

/** The reviewable record returned to an authorized operator. */
export type ProposalReviewRecord = {
  worldId: string;
  idempotencyKey: string;
  sceneId: string;
  simulationRunId: string;
  worldDay: number;
  timeSlot: string;
  eventType: string;
  disposition: ProposalDisposition;
  validationResult: ProposalValidationResult;
  /** Stable machine code, or null when nothing was rejected. Never free text. */
  rejectionReasonCode: string | null;
  /** The pipeline stage that recorded the rejection, when one was recorded. */
  rejectionStage: string | null;
  proposedEvent: ReviewProposedEvent;
  participantIds: readonly string[];
  stateChanges: readonly ReviewStateChange[];
  relatedArcIds: readonly string[];
  safety: ReviewSafety;
  /** Role-projected ART-57 trace: full metadata for operator/admin, public projection for viewer. */
  modelTrace: LlmTraceRecord | PublicLlmTrace | null;
  providerTrace: ReviewProviderTrace | null;
  commit: ReviewCommit | null;
};

/**
 * Recursively drop provider-supplied metadata keys that name raw model input,
 * model output, or credential material.
 *
 * Proposal metadata is the only free-form JSON on this surface, so it is the one
 * place a provider could smuggle a prompt or a key into an operator response.
 * The predicate is ART-57's, imported rather than reimplemented.
 */
export function scrubMetadata(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveTraceKey(key)) continue;
    result[key] = entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ? scrubMetadata(entry as Record<string, unknown>)
      : entry;
  }
  return result;
}

/**
 * Project the ART-57 trace for the calling operator's role.
 *
 * `viewer` is the read-only console role, so it receives only the correlation +
 * final-status projection ART-57 already defines as publicly safe. `operator`
 * and `admin` receive the full accounting record — which, by ART-57's write-side
 * contract, still cannot contain a prompt, a response body, or a secret.
 */
export function traceForOperatorRole(
  trace: LlmTraceRecord | null,
  role: OperatorRole,
): LlmTraceRecord | PublicLlmTrace | null {
  if (!trace) return null;
  return role === 'viewer' ? publicLlmTrace(trace) : structuredClone(trace);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

type Derived = {
  disposition: ProposalDisposition;
  validationResult: ProposalValidationResult;
  rejectionReasonCode: string | null;
  rejectionStage: string | null;
};

/**
 * Decide disposition, validation result, and reason code from durable facts.
 *
 * Order matters and encodes the pipeline's own precedence:
 *  1. Accepted Canon wins outright. A committed event is proof validation passed,
 *     and accepted history is never re-judged by a review surface.
 *  2. Safety withholding comes next: a scene safety refused never reached Canon
 *     validation at all, so reporting a Canon rejection for it would be false.
 *  3. A recorded slot failure is a Canon/orchestration rejection.
 *  4. Otherwise the proposal is still in flight.
 */
function derive(source: ProposalReviewSource): Derived {
  if (source.commit) {
    return { disposition: 'committed', validationResult: 'accepted', rejectionReasonCode: null, rejectionStage: null };
  }
  if (source.reviewStatus === 'required') {
    return {
      disposition: 'withheld',
      validationResult: 'not_run',
      rejectionReasonCode: source.safety.reasonCodes.length > 0
        ? stableReasonCode(source.safety.reasonCodes[0])
        : SAFETY_REVIEW_REQUIRED_CODE,
      rejectionStage: 'safety',
    };
  }
  if (source.rejection) {
    return {
      disposition: 'rejected',
      validationResult: 'rejected',
      rejectionReasonCode: stableReasonCode(source.rejection.reasonCode),
      rejectionStage: source.rejection.stage,
    };
  }
  return { disposition: 'pending', validationResult: 'not_run', rejectionReasonCode: null, rejectionStage: null };
}

/**
 * Build the reviewable record for one proposal, projected for `role`.
 *
 * Related Arcs are the union of the arcs the scene was planned against and the
 * arc memberships classified for the accepted event: a proposal that never
 * committed has no classification yet, so the planned arcs are the only honest
 * answer, and a committed event may have joined an arc the plan did not name.
 */
export function buildProposalReview(source: ProposalReviewSource, role: OperatorRole): ProposalReviewRecord {
  const derived = derive(source);
  // Split metadata off the spread: a conditional re-add cannot remove a key the
  // spread already copied, and a viewer must receive no free-form provider JSON.
  const { metadata, ...proposal } = source.proposal;
  return {
    worldId: source.scene.worldId,
    idempotencyKey: source.proposal.idempotencyKey,
    sceneId: source.scene.sceneId,
    simulationRunId: source.scene.simulationRunId,
    worldDay: source.proposal.worldDay,
    timeSlot: source.proposal.timeSlot,
    eventType: source.proposal.eventType,
    ...derived,
    proposedEvent: {
      ...proposal,
      participantIds: [...proposal.participantIds],
      causedByEventIds: [...proposal.causedByEventIds],
      stateChanges: proposal.stateChanges.map((change) => ({ ...change })),
      // A read-only viewer gets no provider-supplied free-form metadata at all;
      // operator/admin get it with sensitive keys scrubbed.
      ...(metadata === undefined || role === 'viewer' ? {} : { metadata: scrubMetadata(metadata) }),
    },
    participantIds: unique([...source.proposal.participantIds, ...source.scene.participantIds]),
    stateChanges: source.proposal.stateChanges.map((change) => ({ ...change })),
    relatedArcIds: unique([...source.scene.arcIds, ...source.classifiedArcIds]),
    safety: {
      label: source.safety.label,
      reasonCodes: [...source.safety.reasonCodes],
      warningCodes: [...source.safety.warningCodes],
      classifiedTextHash: source.safety.classifiedTextHash,
    },
    modelTrace: traceForOperatorRole(source.trace, role),
    providerTrace: source.providerTrace ? { ...source.providerTrace } : null,
    commit: source.commit ? { ...source.commit } : null,
  };
}

/** Server-side filters for the review list (AC#2: review data is filterable). */
export type ProposalReviewFilter = {
  worldDay?: number;
  timeSlot?: string;
  sceneId?: string;
  idempotencyKey?: string;
  eventType?: string;
  disposition?: ProposalDisposition;
  validationResult?: ProposalValidationResult;
  safetyLabel?: ProposalSafetyLabel;
  reasonCode?: string;
  participantId?: string;
  arcId?: string;
};

/** True when the record satisfies every supplied filter (absent filters ignored). */
export function matchesProposalReviewFilter(
  record: ProposalReviewRecord,
  filter: ProposalReviewFilter,
): boolean {
  if (filter.worldDay !== undefined && record.worldDay !== filter.worldDay) return false;
  if (filter.timeSlot !== undefined && record.timeSlot !== filter.timeSlot) return false;
  if (filter.sceneId !== undefined && record.sceneId !== filter.sceneId) return false;
  if (filter.idempotencyKey !== undefined && record.idempotencyKey !== filter.idempotencyKey) return false;
  if (filter.eventType !== undefined && record.eventType !== filter.eventType) return false;
  if (filter.disposition !== undefined && record.disposition !== filter.disposition) return false;
  if (filter.validationResult !== undefined && record.validationResult !== filter.validationResult) return false;
  if (filter.safetyLabel !== undefined && record.safety.label !== filter.safetyLabel) return false;
  if (filter.reasonCode !== undefined
    && record.rejectionReasonCode !== filter.reasonCode
    && !record.safety.reasonCodes.includes(filter.reasonCode)) return false;
  if (filter.participantId !== undefined && !record.participantIds.includes(filter.participantId)) return false;
  if (filter.arcId !== undefined && !record.relatedArcIds.includes(filter.arcId)) return false;
  return true;
}

/** Lower and upper bounds on a review page; mirrors the console's audit-list bounds. */
export const REVIEW_PAGE_LIMITS = { min: 1, default: 50, max: 200 } as const;

export function reviewPageLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return REVIEW_PAGE_LIMITS.default;
  return Math.min(Math.max(Math.trunc(limit), REVIEW_PAGE_LIMITS.min), REVIEW_PAGE_LIMITS.max);
}

/**
 * Filter, order, and bound a review page.
 *
 * Ordering is newest world time first (world day, then slot position, then
 * sequence within the scene) so the console's default page is "what just
 * happened", and it is deterministic for equal keys via the idempotency key.
 */
export function filterProposalReviews(
  records: readonly ProposalReviewRecord[],
  filter: ProposalReviewFilter,
  slotOrder: readonly string[],
  limit?: number,
): ProposalReviewRecord[] {
  const slotRank = (timeSlot: string): number => {
    const index = slotOrder.indexOf(timeSlot);
    return index === -1 ? slotOrder.length : index;
  };
  return records
    .filter((record) => matchesProposalReviewFilter(record, filter))
    .sort((left, right) => right.worldDay - left.worldDay
      || slotRank(right.timeSlot) - slotRank(left.timeSlot)
      || left.idempotencyKey.localeCompare(right.idempotencyKey))
    .slice(0, reviewPageLimit(limit));
}
