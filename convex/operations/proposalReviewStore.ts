/**
 * Durable-record loader for the proposed-event review surface (FR-K002).
 *
 * This layer only READS. It gathers, for every proposal a scene produced, the
 * records the pipeline already wrote, and hands them to the pure derivation in
 * {@link ./proposalReview.ts}. Review adds no table, no pipeline write, and no
 * re-execution of validation, safety, or the model — an operator reviewing an
 * event must see what actually happened, not a fresh re-judgement of it.
 *
 * WHERE EACH FR-K002 FIELD COMES FROM
 * -----------------------------------
 * | Proposed Event / Participants / State Changes | `sceneSimulationRuns.result.output.proposedEvents` (ART-30) |
 * | Validation Result                             | presence of a `canonEvents` row for the proposal's idempotency key |
 * | Rejection Reason                              | `worldDayRuns.errorCode` + `failureStage`, or the safety reason codes |
 * | Model Trace                                   | `llmTraces` (ART-57), correlated by scene, then run |
 * | Related Arc                                   | `sceneSimulationRuns.result.scene.arcIds` ∪ `storyArcEventClassifications` |
 * | Safety Label                                  | `sceneSimulationRuns.result.safety` (ART-54/ART-55) |
 *
 * Exported as plain functions over a Convex `db` handle — the same shape as
 * `convex/simulation/schedulerOperations.ts` — so the assembly is driven by an
 * in-memory `db` double in tests instead of being asserted by reading wiring.
 *
 * Callers reachable by an unauthenticated client MUST authorize before calling
 * anything here; the caller-facing entry points live in
 * {@link ./proposalReviewFunctions.ts} and authorize first.
 */

import type { GenericQueryCtx } from 'convex/server';
import type { DataModel, Doc } from '../_generated/dataModel';
import { TIME_SLOTS } from '../canon/eventTypes';
import type { LlmTraceRecord } from '../observability/llmTrace';
import { deriveEventId } from '../shared/ids';
import type { OperatorRole } from './operatorAuthorization';
import {
  buildProposalReview,
  filterProposalReviews,
  reviewPageLimit,
  type ProposalReviewFilter,
  type ProposalReviewRecord,
  type ProposalReviewSource,
  type ReviewProposedEvent,
  type ReviewProviderTrace,
  type ReviewSafety,
  type ReviewSceneContext,
  type ReviewStateChange,
} from './proposalReview';

type QueryDb = GenericQueryCtx<DataModel>['db'];

/** The parts of a persisted scene simulation result this surface reads. */
type PersistedSceneResult = {
  simulationRunId?: unknown;
  scene?: unknown;
  output?: unknown;
  safety?: unknown;
  reviewStatus?: unknown;
  trace?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function sceneContext(row: Doc<'sceneSimulationRuns'>, result: PersistedSceneResult): ReviewSceneContext | null {
  const scene = asRecord(result.scene);
  if (!scene) return null;
  return {
    sceneId: row.sceneId,
    simulationRunId: typeof result.simulationRunId === 'string' ? result.simulationRunId : row.simulationRunId,
    worldId: row.worldId,
    worldDay: typeof scene.worldDay === 'number' ? scene.worldDay : 0,
    timeSlot: typeof scene.timeSlot === 'string' ? scene.timeSlot : '',
    locationId: typeof scene.locationId === 'string' ? scene.locationId : '',
    participantIds: stringList(scene.participantIds),
    arcIds: stringList(scene.arcIds),
  };
}

/**
 * Read the persisted safety decision, failing CLOSED.
 *
 * A row whose safety block is missing or malformed is reported as
 * `human_review_required` rather than `allow`: an unreadable safety decision is
 * never evidence that content was safe.
 */
function safetyOf(result: PersistedSceneResult): ReviewSafety {
  const safety = asRecord(result.safety);
  const label = safety?.label;
  const known = label === 'allow' || label === 'allow_with_warning' || label === 'withhold' || label === 'human_review_required';
  return {
    label: known ? label : 'human_review_required',
    reasonCodes: stringList(safety?.reasonCodes),
    warningCodes: stringList(safety?.warningCodes),
    classifiedTextHash: typeof safety?.classifiedTextHash === 'string' ? safety.classifiedTextHash : '',
  };
}

function providerTraceOf(result: PersistedSceneResult): ReviewProviderTrace | null {
  const trace = asRecord(result.trace);
  if (!trace || typeof trace.provider !== 'string' || typeof trace.model !== 'string') return null;
  const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  return {
    provider: trace.provider,
    model: trace.model,
    inputTokens: count(trace.inputTokens),
    outputTokens: count(trace.outputTokens),
    latencyMs: count(trace.latencyMs),
    retryCount: count(trace.retryCount),
  };
}

function proposalsOf(result: PersistedSceneResult, scene: ReviewSceneContext): ReviewProposedEvent[] {
  const output = asRecord(result.output);
  const proposals = Array.isArray(output?.proposedEvents) ? output?.proposedEvents ?? [] : [];
  return proposals.flatMap((entry) => {
    const proposal = asRecord(entry);
    if (!proposal || typeof proposal.idempotencyKey !== 'string' || typeof proposal.eventType !== 'string') return [];
    const proposedBy = asRecord(proposal.proposedBy);
    const metadata = asRecord(proposal.metadata);
    const stateChanges = (Array.isArray(proposal.stateChanges) ? proposal.stateChanges : [])
      .flatMap((change) => {
        const record = asRecord(change);
        return record && typeof record.type === 'string' ? [record as ReviewStateChange] : [];
      });
    return [{
      schemaVersion: typeof proposal.schemaVersion === 'number' ? proposal.schemaVersion : 1,
      idempotencyKey: proposal.idempotencyKey,
      eventType: proposal.eventType,
      worldDay: typeof proposal.worldDay === 'number' ? proposal.worldDay : scene.worldDay,
      timeSlot: typeof proposal.timeSlot === 'string' ? proposal.timeSlot : scene.timeSlot,
      ...(typeof proposal.locationId === 'string' ? { locationId: proposal.locationId } : {}),
      participantIds: stringList(proposal.participantIds),
      causedByEventIds: stringList(proposal.causedByEventIds),
      ...(typeof proposal.publicSummary === 'string' ? { publicSummary: proposal.publicSummary } : {}),
      proposedBy: {
        type: typeof proposedBy?.type === 'string' ? proposedBy.type : 'system',
        ...(typeof proposedBy?.id === 'string' ? { id: proposedBy.id } : {}),
      },
      stateChanges,
      ...(metadata ? { metadata } : {}),
    }];
  });
}

/**
 * The stable rejection code for a scene's slot, or null when nothing failed.
 *
 * A world-day run is the unit that either reaches Canon or fails, so its
 * recorded `errorCode` and `failureStage` are the rejection of every proposal in
 * that slot that has no accepted event. Only the free-text `errorMessage` is
 * deliberately left behind (AC#3).
 */
async function slotRejection(
  db: QueryDb,
  worldId: string,
  worldDay: number,
  timeSlot: string,
): Promise<{ reasonCode: string | null; stage: string | null; runId: string } | null> {
  const slot = TIME_SLOTS.find((candidate) => candidate === timeSlot);
  if (!slot) return null;
  const runs = await db
    .query('worldDayRuns')
    .withIndex('by_world_day_slot', (q) => q.eq('worldId', worldId).eq('worldDay', worldDay).eq('timeSlot', slot))
    .collect();
  const failed = runs.filter((run) => run.status === 'failed').sort((left, right) => right.updatedAt - left.updatedAt)[0];
  return failed
    ? { reasonCode: failed.errorCode ?? null, stage: failed.failureStage ?? null, runId: failed.runId }
    : null;
}

/**
 * Correlate the ART-57 trace for a scene.
 *
 * Preference order is most-specific-first: the trace recorded for this scene,
 * then the trace recorded for the failed run that carried it. A trace is never
 * guessed from the world day alone, because attaching another scene's model call
 * to this proposal would make the review record actively misleading.
 */
async function traceForScene(
  db: QueryDb,
  scene: ReviewSceneContext,
  runId: string | null,
): Promise<LlmTraceRecord | null> {
  const strip = (row: Doc<'llmTraces'>): LlmTraceRecord => {
    const { _id: _id, _creationTime: _creationTime, ...record } = row;
    return record as LlmTraceRecord;
  };
  const byDay = await db
    .query('llmTraces')
    .withIndex('by_world_and_day', (q) => q.eq('worldId', scene.worldId).eq('worldDay', scene.worldDay))
    .collect();
  const bySceneId = byDay.find((row) => row.sceneId === scene.sceneId);
  if (bySceneId) return strip(bySceneId);
  if (!runId) return null;
  const byRun = await db.query('llmTraces').withIndex('by_run_id', (q) => q.eq('runId', runId)).first();
  return byRun ? strip(byRun) : null;
}

/** Arc memberships classified for an accepted event (ART-40). */
async function classifiedArcIds(db: QueryDb, worldId: string, sequenceNumber: number): Promise<string[]> {
  const row = await db
    .query('storyArcEventClassifications')
    .withIndex('by_world_and_source_event', (q) => q.eq('worldId', worldId).eq('sourceEventSequenceNumber', sequenceNumber))
    .unique();
  const memberships: unknown[] = Array.isArray(row?.memberships) ? row?.memberships ?? [] : [];
  return memberships.flatMap((entry) => {
    const membership = asRecord(entry);
    return typeof membership?.arcId === 'string' ? [membership.arcId] : [];
  });
}

/** Build every review source for one persisted scene simulation run. */
async function sourcesForScene(db: QueryDb, row: Doc<'sceneSimulationRuns'>): Promise<ProposalReviewSource[]> {
  const result = (asRecord(row.result) ?? {}) as PersistedSceneResult;
  const scene = sceneContext(row, result);
  if (!scene) return [];
  const proposals = proposalsOf(result, scene);
  if (proposals.length === 0) return [];

  const safety = safetyOf(result);
  const reviewStatus = row.status === 'review_required' ? 'required' as const : 'not_required' as const;
  const providerTrace = providerTraceOf(result);
  const rejection = await slotRejection(db, scene.worldId, scene.worldDay, scene.timeSlot);
  const trace = await traceForScene(db, scene, rejection?.runId ?? null);

  const sources: ProposalReviewSource[] = [];
  for (const proposal of proposals) {
    const committed = await db
      .query('canonEvents')
      .withIndex('by_world_and_idempotency_key', (q) =>
        q.eq('worldId', scene.worldId).eq('idempotencyKey', proposal.idempotencyKey))
      .first();
    sources.push({
      scene,
      proposal,
      safety,
      reviewStatus,
      commit: committed
        ? {
          // The canonical, deterministic event id — the same one replay derives —
          // not the Convex row id, so an operator can follow it into accepted history.
          eventId: deriveEventId(scene.worldId, committed.sequenceNumber),
          sequenceNumber: committed.sequenceNumber,
          validationVersion: committed.validationVersion,
          traceId: committed.traceId,
          acceptedAt: committed.acceptedAt,
        }
        : null,
      // A proposal that never committed has no arc classification yet, so the only
      // honest Related Arc answer is the arcs the scene was planned against.
      rejection: committed ? null : rejection,
      classifiedArcIds: committed ? await classifiedArcIds(db, scene.worldId, committed.sequenceNumber) : [],
      trace,
      providerTrace,
    });
  }
  return sources;
}

/** Scene simulation rows for a world, narrowed by scene when the caller named one. */
async function sceneRows(
  db: QueryDb,
  worldId: string,
  sceneId: string | undefined,
): Promise<Doc<'sceneSimulationRuns'>[]> {
  if (sceneId !== undefined) {
    return db.query('sceneSimulationRuns')
      .withIndex('by_scene', (q) => q.eq('worldId', worldId).eq('sceneId', sceneId)).collect();
  }
  return db.query('sceneSimulationRuns')
    .withIndex('by_world_and_run', (q) => q.eq('worldId', worldId)).collect();
}

/**
 * List reviewable proposals for a world, filtered and bounded.
 *
 * `role` is the AUTHENTICATED operator's role, supplied by the wiring layer
 * after {@link authorizeOperator} accepted the caller. It selects the trace
 * projection; it is never taken from caller input.
 */
export async function listProposalReviews(
  db: QueryDb,
  args: { worldId: string; role: OperatorRole; filter?: ProposalReviewFilter; limit?: number },
): Promise<ProposalReviewRecord[]> {
  const filter = args.filter ?? {};
  const rows = await sceneRows(db, args.worldId, filter.sceneId);
  const records: ProposalReviewRecord[] = [];
  for (const row of rows) {
    for (const source of await sourcesForScene(db, row)) {
      records.push(buildProposalReview(source, args.role));
    }
  }
  return filterProposalReviews(records, filter, TIME_SLOTS, reviewPageLimit(args.limit));
}

/** The single reviewable proposal for one idempotency key, or null. */
export async function readProposalReview(
  db: QueryDb,
  args: { worldId: string; role: OperatorRole; idempotencyKey: string },
): Promise<ProposalReviewRecord | null> {
  const records = await listProposalReviews(db, {
    worldId: args.worldId,
    role: args.role,
    filter: { idempotencyKey: args.idempotencyKey },
    limit: 1,
  });
  return records[0] ?? null;
}
