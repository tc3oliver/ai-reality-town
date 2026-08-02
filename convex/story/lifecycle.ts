import type { ArcLifecycleRecord, ArcLifecycleTransition, StoryArcStatus } from './model';

export type ArcLifecycleErrorCode =
  | 'ARC_ALREADY_EXISTS'
  | 'ARC_NOT_FOUND'
  | 'ARC_INVALID_TRANSITION'
  | 'ARC_STATUS_CONFLICT'
  | 'ARC_INVALID_PROVENANCE';

export class ArcLifecycleError extends Error {
  constructor(readonly code: ArcLifecycleErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'ArcLifecycleError';
  }
}

export const ALLOWED_ARC_TRANSITIONS: Readonly<Record<StoryArcStatus, readonly StoryArcStatus[]>> = {
  emerging: ['active', 'archived'],
  active: ['escalating', 'resolving'],
  escalating: ['climax', 'resolving'],
  climax: ['resolving'],
  resolving: ['resolved'],
  resolved: ['archived'],
  archived: [],
};

export function assertArcSourceMatchesAcceptedEvent(
  sourceEventId: string,
  acceptedEventId: string | null,
): void {
  if (acceptedEventId === null || sourceEventId !== acceptedEventId) {
    throw new ArcLifecycleError('ARC_INVALID_PROVENANCE', 'lifecycle source must match an accepted Canon event');
  }
}

export type ArcTransitionInput = {
  expectedStatus: StoryArcStatus;
  toStatus: StoryArcStatus;
  sourceEventId: string;
  sourceEventSequenceNumber: number;
  reason: string;
  changedAt: number;
};

function validateProvenance(input: Pick<ArcTransitionInput, 'sourceEventId' | 'sourceEventSequenceNumber' | 'reason' | 'changedAt'>): void {
  if (input.sourceEventId.trim().length === 0 || !Number.isSafeInteger(input.sourceEventSequenceNumber)
      || input.sourceEventSequenceNumber < 0 || input.reason.trim().length === 0
      || !Number.isFinite(input.changedAt)) {
    throw new ArcLifecycleError('ARC_INVALID_PROVENANCE', 'lifecycle changes require accepted-event provenance, a reason, and finite time');
  }
}

export function createArcLifecycle(
  worldId: string,
  arcId: string,
  provenance: Omit<ArcTransitionInput, 'expectedStatus' | 'toStatus'>,
): ArcLifecycleRecord {
  if (worldId.trim().length === 0 || arcId.trim().length === 0) {
    throw new ArcLifecycleError('ARC_INVALID_PROVENANCE', 'worldId and arcId are required');
  }
  validateProvenance(provenance);
  const transition: ArcLifecycleTransition = {
    transitionId: `${arcId}:lifecycle:0`, fromStatus: null, toStatus: 'emerging', ...provenance,
  };
  return { schemaVersion: 1, worldId, arcId, status: 'emerging', revision: 0, transitions: [transition] };
}

export function transitionArcLifecycle(record: ArcLifecycleRecord, input: ArcTransitionInput): ArcLifecycleRecord {
  validateProvenance(input);
  if (record.status !== input.expectedStatus) {
    throw new ArcLifecycleError('ARC_STATUS_CONFLICT', `expected ${input.expectedStatus}, found ${record.status}`);
  }
  if (!ALLOWED_ARC_TRANSITIONS[record.status].includes(input.toStatus)) {
    throw new ArcLifecycleError('ARC_INVALID_TRANSITION', `${record.status} cannot transition to ${input.toStatus}`);
  }
  const revision = record.revision + 1;
  const transition: ArcLifecycleTransition = {
    transitionId: `${record.arcId}:lifecycle:${revision}`,
    fromStatus: record.status,
    toStatus: input.toStatus,
    sourceEventId: input.sourceEventId,
    sourceEventSequenceNumber: input.sourceEventSequenceNumber,
    reason: input.reason,
    changedAt: input.changedAt,
  };
  return {
    ...record,
    status: input.toStatus,
    revision,
    transitions: [...record.transitions.map((entry) => ({ ...entry })), transition],
  };
}

export const isActiveArcStatus = (status: StoryArcStatus): boolean =>
  status === 'active' || status === 'escalating' || status === 'climax' || status === 'resolving';

export function selectActiveArcContext(records: readonly ArcLifecycleRecord[]): ArcLifecycleRecord[] {
  return records.filter((record) => isActiveArcStatus(record.status)).map(cloneArcLifecycle);
}

export function cloneArcLifecycle(record: ArcLifecycleRecord): ArcLifecycleRecord {
  return { ...record, transitions: record.transitions.map((entry) => ({ ...entry })) };
}

export class InMemoryArcLifecycleStore {
  private readonly records = new Map<string, ArcLifecycleRecord>();

  create(record: ArcLifecycleRecord): void {
    const key = `${record.worldId}|${record.arcId}`;
    if (this.records.has(key)) throw new ArcLifecycleError('ARC_ALREADY_EXISTS', 'arc lifecycle already exists');
    this.records.set(key, cloneArcLifecycle(record));
  }

  transition(worldId: string, arcId: string, input: ArcTransitionInput): ArcLifecycleRecord {
    const key = `${worldId}|${arcId}`;
    const current = this.records.get(key);
    if (!current) throw new ArcLifecycleError('ARC_NOT_FOUND', 'arc lifecycle does not exist');
    const next = transitionArcLifecycle(current, input);
    this.records.set(key, cloneArcLifecycle(next));
    return cloneArcLifecycle(next);
  }

  get(worldId: string, arcId: string): ArcLifecycleRecord | null {
    const record = this.records.get(`${worldId}|${arcId}`);
    return record ? cloneArcLifecycle(record) : null;
  }

  active(worldId: string): ArcLifecycleRecord[] {
    return selectActiveArcContext([...this.records.values()].filter((record) => record.worldId === worldId));
  }
}
