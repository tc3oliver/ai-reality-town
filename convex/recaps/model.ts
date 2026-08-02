import type { AcceptedEvent } from '../canon/model';

export const RECAP_TYPES = ['scene', 'episode', 'arc', 'season', 'viewer_context'] as const;
export type RecapType = typeof RECAP_TYPES[number];
export type RecapStructuredPayload = {
  sourceEventIds: string[];
  newEventIds: string[];
  priorSnapshotId: string | null;
  generationMode: 'incremental' | 'regeneration';
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

function validateAcceptedWindow(events: readonly AcceptedEvent[], worldId: string): void {
  if (events.length === 0) throw new RecapError('RECAP_EMPTY_SOURCE', 'at least one Accepted Event is required');
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.worldId !== worldId || event.eventId.trim().length === 0 || !Number.isSafeInteger(event.sequenceNumber)) {
      throw new RecapError('RECAP_SOURCE_NOT_ACCEPTED', 'source must be a reconstructed Accepted Event', `acceptedEvents[${index}]`);
    }
    if (index > 0 && event.sequenceNumber !== events[index - 1].sequenceNumber + 1) {
      throw new RecapError('RECAP_SOURCE_GAP', 'Accepted Event window must be contiguous', `acceptedEvents[${index}]`);
    }
  }
  if (new Set(events.map(({ eventId }) => eventId)).size !== events.length) {
    throw new RecapError('RECAP_SOURCE_DUPLICATE', 'Accepted Event IDs must be unique');
  }
}

export function buildRecapSnapshot(input: BuildRecapSnapshotInput): RecapSnapshot {
  validateEnvelope(input);
  validateAcceptedWindow(input.acceptedEvents, input.worldId);
  const events = input.acceptedEvents.map((event) => structuredClone(event));
  if (input.mode === 'incremental' && input.prior
      && events[0].sequenceNumber !== input.prior.sourceToSequenceNumber + 1) {
    throw new RecapError('RECAP_INCREMENTAL_RANGE', 'incremental update must start immediately after prior source range');
  }
  if (input.mode === 'regeneration' && input.prior
      && (events[0].sequenceNumber !== input.prior.sourceFromSequenceNumber
        || events.at(-1)?.sequenceNumber !== input.prior.sourceToSequenceNumber)) {
    throw new RecapError('RECAP_REGENERATION_RANGE', 'regeneration must use the complete prior Accepted Event range');
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
    version: (input.prior?.version ?? 0) + 1,
    generatedAt: input.generatedAt,
  };
}

export function validateRecapSnapshot(snapshot: RecapSnapshot, acceptedEvents: readonly AcceptedEvent[]): RecapSnapshot {
  validateAcceptedWindow(acceptedEvents, snapshot.worldId);
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
