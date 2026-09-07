import type { AcceptedEvent } from '../canon/model';

export const RECAP_TYPES = ['scene', 'episode', 'arc', 'season', 'viewer_context'] as const;
export type RecapType = typeof RECAP_TYPES[number];
export type RecapStructuredPayload = {
  sourceEventIds: string[];
  newEventIds: string[];
  priorSnapshotId: string | null;
  generationMode: 'incremental' | 'regeneration';
};

/**
 * The sequence range a SELECTIVE recap was drawn from (ART-164, FR-G002).
 *
 * An `episode` recap covers every accepted event of its day, so its source range and its event
 * list are the same thing and a contiguous window is the right contract. An `arc` recap is not
 * like that: an arc's events are scattered through canon among every other arc's, so its sources
 * are inherently sparse and the contiguous rule would reject every honest arc summary. That is the
 * exact reason `docs/post-commit-pipeline.md` recorded arc and season levels as unreachable.
 *
 * A scope makes the distinction explicit rather than simply dropping the check. It states the
 * window that was EXAMINED, while `structuredPayload.newEventIds` states what was found in it, so
 * a reader can tell "this arc did nothing between sequence 40 and 90" from "nothing between 40 and
 * 90 was ever looked at". Without it a sparse recap could silently skip events and look identical
 * to one that had none to skip.
 *
 * It is also what keeps the tier incremental: the cursor advances to `toSequenceNumber`, the
 * watermark that was scanned, not to the last event that happened to match. Advancing to the last
 * match would re-examine the same quiet stretch on every later run.
 */
export type RecapSourceScope = {
  fromSequenceNumber: number;
  toSequenceNumber: number;
};

export type RecapSnapshot = {
  id: string;
  schemaVersion: 1;
  worldId: string;
  recapType: RecapType;
  targetId: string;
  sourceFromEventId: string;
  sourceToEventId: string;
  sourceFromSequenceNumber: number;
  sourceToSequenceNumber: number;
  content: string;
  structuredPayload: RecapStructuredPayload;
  /** Null for a contiguous tier, where the event window IS the source range. */
  sourceScope: RecapSourceScope | null;
  version: number;
  generatedAt: number;
};

export type BuildRecapSnapshotInput = {
  id: string;
  worldId: string;
  recapType: RecapType;
  targetId: string;
  prior: RecapSnapshot | null;
  acceptedEvents: AcceptedEvent[];
  mode: 'incremental' | 'regeneration';
  generatedAt: number;
  /** Supply for a selective tier; omit for a contiguous one. */
  sourceScope?: RecapSourceScope | null;
};

export class RecapError extends Error {
  constructor(readonly code: string, message: string, readonly path?: string) {
    super(`[${code}] ${message}`);
    this.name = 'RecapError';
  }
}

export function parseRecapStructuredPayload(value: unknown): RecapStructuredPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RecapError('RECAP_INVALID', 'structured payload must be an object');
  const row = value as Record<string, unknown>;
  const allowed = ['sourceEventIds', 'newEventIds', 'priorSnapshotId', 'generationMode'];
  const parseIds = (candidate: unknown): string[] | null => {
    if (!Array.isArray(candidate)) return null;
    const result: string[] = [];
    for (const item of candidate as unknown[]) {
      if (typeof item !== 'string' || item.length === 0) return null;
      result.push(item);
    }
    return result;
  };
  const sourceEventIds = parseIds(row.sourceEventIds);
  const newEventIds = parseIds(row.newEventIds);
  if (Object.keys(row).some((key) => !allowed.includes(key)) || !sourceEventIds || !newEventIds
      || (row.priorSnapshotId !== null && (typeof row.priorSnapshotId !== 'string' || row.priorSnapshotId.length === 0))
      || (row.generationMode !== 'incremental' && row.generationMode !== 'regeneration')) {
    throw new RecapError('RECAP_INVALID', 'structured payload is invalid');
  }
  return { sourceEventIds, newEventIds, priorSnapshotId: row.priorSnapshotId, generationMode: row.generationMode };
}

const unique = (values: readonly string[]): string[] => [...new Set(values)];
const validType = (value: string): value is RecapType => (RECAP_TYPES as readonly string[]).includes(value);

function validateEnvelope(input: BuildRecapSnapshotInput): void {
  for (const [path, value] of [['id', input.id], ['worldId', input.worldId], ['targetId', input.targetId]] as const) {
    if (value.trim().length === 0) throw new RecapError('RECAP_INVALID', 'must be non-empty', path);
  }
  if (!validType(input.recapType) || (input.mode !== 'incremental' && input.mode !== 'regeneration')
      || !Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) {
    throw new RecapError('RECAP_INVALID', 'invalid recap envelope');
  }
  if (input.prior && (input.prior.worldId !== input.worldId || input.prior.recapType !== input.recapType
      || input.prior.targetId !== input.targetId)) {
    throw new RecapError('RECAP_PRIOR_MISMATCH', 'prior snapshot belongs to another recap target');
  }
}

/**
 * @param scope when present the window is SELECTIVE: gaps are legal, but every event must fall
 * inside the declared range. When absent the window must be contiguous, unchanged from ART-34.
 */
function validateAcceptedWindow(
  events: readonly AcceptedEvent[],
  worldId: string,
  scope: RecapSourceScope | null,
): void {
  if (events.length === 0) throw new RecapError('RECAP_EMPTY_SOURCE', 'at least one Accepted Event is required');
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.worldId !== worldId || event.eventId.trim().length === 0 || !Number.isSafeInteger(event.sequenceNumber)) {
      throw new RecapError('RECAP_SOURCE_NOT_ACCEPTED', 'source must be a reconstructed Accepted Event', `acceptedEvents[${index}]`);
    }
    if (scope === null) {
      if (index > 0 && event.sequenceNumber !== events[index - 1].sequenceNumber + 1) {
        throw new RecapError('RECAP_SOURCE_GAP', 'Accepted Event window must be contiguous', `acceptedEvents[${index}]`);
      }
    } else {
      // Ascending and strictly increasing still holds: dropping it would let a selection repeat or
      // reorder events and still be accepted, which no honest selection ever does.
      if (index > 0 && event.sequenceNumber <= events[index - 1].sequenceNumber) {
        throw new RecapError('RECAP_SOURCE_GAP', 'selected Accepted Events must ascend by sequence number', `acceptedEvents[${index}]`);
      }
      if (event.sequenceNumber < scope.fromSequenceNumber || event.sequenceNumber > scope.toSequenceNumber) {
        throw new RecapError('RECAP_SOURCE_OUT_OF_SCOPE', 'selected Accepted Event lies outside the declared source scope', `acceptedEvents[${index}]`);
      }
    }
  }
  if (new Set(events.map(({ eventId }) => eventId)).size !== events.length) {
    throw new RecapError('RECAP_SOURCE_DUPLICATE', 'Accepted Event IDs must be unique');
  }
}

/** A scope must be a bounded, ordered range of safe integers, or it cannot anchor a cursor. */
function validateScope(scope: RecapSourceScope | null): void {
  if (scope === null) return;
  if (!Number.isSafeInteger(scope.fromSequenceNumber) || !Number.isSafeInteger(scope.toSequenceNumber)
      || scope.fromSequenceNumber < 0 || scope.toSequenceNumber < scope.fromSequenceNumber) {
    throw new RecapError('RECAP_INVALID', 'invalid recap source scope');
  }
}

export function buildRecapSnapshot(input: BuildRecapSnapshotInput): RecapSnapshot {
  validateEnvelope(input);
  const scope = input.sourceScope ?? null;
  validateScope(scope);
  validateAcceptedWindow(input.acceptedEvents, input.worldId, scope);
  const events = input.acceptedEvents.map((event) => structuredClone(event));
  /**
   * A tier may not change its selectivity between versions. A contiguous prior followed by a
   * selective update would leave one target's history half-checked for gaps, and the cursor would
   * be read off two different fields depending on the version it landed on.
   */
  if (input.prior && (input.prior.sourceScope === null) !== (scope === null)) {
    throw new RecapError('RECAP_SCOPE_MISMATCH', 'a recap target may not change between contiguous and selective sources');
  }
  if (input.mode === 'incremental' && input.prior) {
    // Continuity is checked on the SCOPE for a selective tier: the guarantee is that no stretch of
    // canon went unexamined, which is not the same as the events being adjacent. Checking the
    // events instead would reject every arc that was quiet for a day.
    const priorEnd = scope === null ? input.prior.sourceToSequenceNumber : input.prior.sourceScope!.toSequenceNumber;
    const nextStart = scope === null ? events[0].sequenceNumber : scope.fromSequenceNumber;
    if (nextStart !== priorEnd + 1) {
      throw new RecapError('RECAP_INCREMENTAL_RANGE', 'incremental update must start immediately after prior source range');
    }
  }
  if (input.mode === 'regeneration' && input.prior) {
    const priorFrom = scope === null ? input.prior.sourceFromSequenceNumber : input.prior.sourceScope!.fromSequenceNumber;
    const priorTo = scope === null ? input.prior.sourceToSequenceNumber : input.prior.sourceScope!.toSequenceNumber;
    const from = scope === null ? events[0].sequenceNumber : scope.fromSequenceNumber;
    const to = scope === null ? events.at(-1)?.sequenceNumber : scope.toSequenceNumber;
    if (from !== priorFrom || to !== priorTo) {
      throw new RecapError('RECAP_REGENERATION_RANGE', 'regeneration must use the complete prior Accepted Event range');
    }
  }
  const priorSourceIds = input.mode === 'incremental' ? input.prior?.structuredPayload.sourceEventIds ?? [] : [];
  const sourceEventIds = unique([...priorSourceIds, ...events.map(({ eventId }) => eventId)]);
  const newSummaries = events.map(({ publicSummary }) => publicSummary).filter((value): value is string => Boolean(value));
  const previousContent = input.mode === 'incremental' ? input.prior?.content : null;
  const content = [previousContent, ...newSummaries].filter((value): value is string => Boolean(value)).join(' ').trim()
    || 'No public development was recorded in the accepted source range.';
  const first = input.mode === 'incremental' && input.prior
    ? { eventId: input.prior.sourceFromEventId, sequenceNumber: input.prior.sourceFromSequenceNumber }
    : events[0];
  const last = events.at(-1)!;
  return {
    id: input.id, schemaVersion: 1, worldId: input.worldId, recapType: input.recapType, targetId: input.targetId,
    sourceFromEventId: first.eventId, sourceToEventId: last.eventId,
    sourceFromSequenceNumber: first.sequenceNumber, sourceToSequenceNumber: last.sequenceNumber,
    content,
    structuredPayload: { sourceEventIds, newEventIds: events.map(({ eventId }) => eventId),
      priorSnapshotId: input.prior?.id ?? null, generationMode: input.mode },
    // For an incremental selective update the scope spans everything examined SO FAR, not just
    // this delta: that is what makes the recorded range mean "no stretch went unexamined".
    sourceScope: scope === null ? null : {
      fromSequenceNumber: input.mode === 'incremental' && input.prior
        ? input.prior.sourceScope!.fromSequenceNumber : scope.fromSequenceNumber,
      toSequenceNumber: scope.toSequenceNumber,
    },
    version: (input.prior?.version ?? 0) + 1,
    generatedAt: input.generatedAt,
  };
}

export function validateRecapSnapshot(snapshot: RecapSnapshot, acceptedEvents: readonly AcceptedEvent[]): RecapSnapshot {
  validateAcceptedWindow(acceptedEvents, snapshot.worldId, snapshot.sourceScope);
  validateScope(snapshot.sourceScope);
  const byId = new Map(acceptedEvents.map((event) => [event.eventId, event]));
  const expectedIds = acceptedEvents.map(({ eventId }) => eventId);
  if (snapshot.structuredPayload.sourceEventIds.length !== expectedIds.length
      || snapshot.structuredPayload.sourceEventIds.some((id, index) => id !== expectedIds[index])
      || snapshot.sourceFromEventId !== expectedIds[0] || snapshot.sourceToEventId !== expectedIds.at(-1)
      || byId.get(snapshot.sourceFromEventId)?.sequenceNumber !== snapshot.sourceFromSequenceNumber
      || byId.get(snapshot.sourceToEventId)?.sequenceNumber !== snapshot.sourceToSequenceNumber) {
    throw new RecapError('RECAP_SOURCE_NOT_ACCEPTED', 'snapshot source range must resolve only to supplied Accepted Events');
  }
  return structuredClone(snapshot);
}
