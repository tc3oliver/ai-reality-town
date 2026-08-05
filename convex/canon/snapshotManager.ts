import { CanonError, canonError } from '../shared/errors';
import { emptyProjection, type AcceptedEvent, type WorldProjection } from './model';
import { replayWorldEvents } from './replay';
import {
  buildSnapshot,
  cloneProjection,
  replayFromSnapshot,
  serializeProjectionDeterministically,
  validateSnapshot,
  type CanonSnapshot,
} from './snapshots';

export type SnapshotKind = 'initial' | 'daily' | 'manual';
export type StoredCanonSnapshot = CanonSnapshot & { snapshotId: string; kind: SnapshotKind };
export type RecoveryHead = {
  worldId: string;
  targetSnapshotId: string;
  targetSequenceNumber: number;
  activatedAt: number;
  operatorId: string;
  reason: string;
};
export type RecoveryAudit = {
  worldId: string;
  action: 'activated' | 'cleared';
  targetSnapshotId?: string;
  targetSequenceNumber?: number;
  operatorId: string;
  reason: string;
  createdAt: number;
};

export interface SnapshotRecoveryStore {
  loadAcceptedEvents(worldId: string): Promise<AcceptedEvent[]>;
  findDailySnapshot(worldId: string, worldDay: number): Promise<StoredCanonSnapshot | null>;
  loadLatestSnapshot(worldId: string, throughWorldDay: number): Promise<StoredCanonSnapshot | null>;
  loadSnapshot(worldId: string, snapshotId: string): Promise<StoredCanonSnapshot | null>;
  /** The 'initial' snapshot `importWorld` persists for a seeded world, or null if the world was never seeded. */
  loadInitialSnapshot(worldId: string): Promise<StoredCanonSnapshot | null>;
  saveSnapshot(snapshot: CanonSnapshot, kind: SnapshotKind): Promise<StoredCanonSnapshot>;
  loadRecoveryHead(worldId: string): Promise<RecoveryHead | null>;
  replaceRecoveryHead(worldId: string, head: RecoveryHead | null): Promise<void>;
  appendRecoveryAudit(entry: RecoveryAudit): Promise<void>;
}

/** The projection + sequence number every replay for a world starts from. */
export type WorldBaseline = { projection: WorldProjection; lastSequenceNumber: number };

/**
 * Resolve a world's replay baseline: its validated seeded 'initial' snapshot if `importWorld`
 * seeded it, otherwise the empty projection. `initialSnapshot` is authoritative seed data, not
 * derivable from accepted events, so it is validated for self-consistency (not history-replay
 * consistency) here — a corrupted seeded baseline fails closed with SNAPSHOT_CORRUPT before it
 * can be used to (mis)verify anything built on top of it.
 */
export function resolveWorldBaseline(worldId: string, initialSnapshot: CanonSnapshot | null): WorldBaseline {
  if (!initialSnapshot) return { projection: emptyProjection(worldId), lastSequenceNumber: -1 };
  validateSnapshot(initialSnapshot);
  return { projection: initialSnapshot.projection, lastSequenceNumber: initialSnapshot.lastSequenceNumber };
}

async function loadWorldBaseline(store: SnapshotRecoveryStore, worldId: string): Promise<WorldBaseline> {
  return resolveWorldBaseline(worldId, await store.loadInitialSnapshot(worldId));
}

function validOperatorInput(operatorId: string, reason: string, createdAt: number): void {
  if (operatorId.trim().length === 0 || reason.trim().length === 0 || !Number.isFinite(createdAt)) {
    throw new CanonError(canonError('RECOVERY_HEAD_CONFLICT', 'recovery action requires operator, reason, and valid time'));
  }
}

function eventsThrough(events: AcceptedEvent[], sequenceNumber: number): AcceptedEvent[] {
  return events.filter((event) => event.sequenceNumber <= sequenceNumber);
}

/**
 * Prove a stored snapshot is exactly derivable from `baseline` plus the immutable accepted-event
 * suffix after it. `baseline` must come from {@link resolveWorldBaseline} so every caller applies
 * the same seeded-vs-unseeded rule.
 */
export function assertSnapshotMatchesHistory(snapshot: CanonSnapshot, events: AcceptedEvent[], baseline: WorldBaseline): void {
  validateSnapshot(snapshot);
  const prefix = eventsThrough(events, snapshot.lastSequenceNumber).filter(
    (event) => event.sequenceNumber > baseline.lastSequenceNumber,
  );
  const expected = replayWorldEvents(cloneProjection(baseline.projection), prefix);
  if (serializeProjectionDeterministically(expected) !== serializeProjectionDeterministically(snapshot.projection)) {
    throw new CanonError(canonError('SNAPSHOT_CORRUPT', 'snapshot projection does not match accepted history', {
      lastSequenceNumber: snapshot.lastSequenceNumber,
    }));
  }
}

/** Idempotently create the one required daily snapshot after all events through a world day. */
export async function createDailySnapshot(
  store: SnapshotRecoveryStore,
  worldId: string,
  worldDay: number,
  createdAt: number,
): Promise<{ snapshot: StoredCanonSnapshot; deduplicated: boolean }> {
  if (!Number.isSafeInteger(worldDay) || worldDay < 0 || !Number.isFinite(createdAt)) {
    throw new CanonError(canonError('SNAPSHOT_DAY_CONFLICT', 'daily snapshot inputs are invalid', { worldDay, createdAt }));
  }
  const baseline = await loadWorldBaseline(store, worldId);
  const events = await store.loadAcceptedEvents(worldId);
  const existing = await store.findDailySnapshot(worldId, worldDay);
  if (existing) {
    assertSnapshotMatchesHistory(existing, events, baseline);
    return { snapshot: existing, deduplicated: true };
  }
  const future = events.find((event) => event.worldDay > worldDay);
  if (future) {
    throw new CanonError(canonError('SNAPSHOT_DAY_CONFLICT', 'cannot create a past daily snapshot after future events exist', {
      worldDay, futureEventId: future.eventId,
    }));
  }
  const latest = await store.loadLatestSnapshot(worldId, worldDay);
  let projection: WorldProjection;
  if (latest) {
    assertSnapshotMatchesHistory(latest, events, baseline);
    projection = replayFromSnapshot(
      latest,
      events.filter((event) => event.sequenceNumber > latest.lastSequenceNumber),
    );
  } else {
    projection = replayWorldEvents(
      cloneProjection(baseline.projection),
      events.filter((event) => event.sequenceNumber > baseline.lastSequenceNumber),
    );
  }
  const snapshot = await store.saveSnapshot(buildSnapshot(projection, createdAt, worldDay), 'daily');
  return { snapshot, deduplicated: false };
}

/** Activate a reversible operational read head without changing accepted Canon history. */
export async function activateRecoveryHead(
  store: SnapshotRecoveryStore,
  args: { worldId: string; snapshotId: string; operatorId: string; reason: string; createdAt: number },
): Promise<RecoveryHead> {
  validOperatorInput(args.operatorId, args.reason, args.createdAt);
  const snapshot = await store.loadSnapshot(args.worldId, args.snapshotId);
  if (!snapshot) throw new CanonError(canonError('RECOVERY_HEAD_CONFLICT', 'target snapshot does not exist'));
  const events = await store.loadAcceptedEvents(args.worldId);
  const baseline = await loadWorldBaseline(store, args.worldId);
  assertSnapshotMatchesHistory(snapshot, events, baseline);
  const head: RecoveryHead = {
    worldId: args.worldId,
    targetSnapshotId: snapshot.snapshotId,
    targetSequenceNumber: snapshot.lastSequenceNumber,
    activatedAt: args.createdAt,
    operatorId: args.operatorId,
    reason: args.reason,
  };
  await store.replaceRecoveryHead(args.worldId, head);
  await store.appendRecoveryAudit({
    worldId: args.worldId,
    action: 'activated',
    targetSnapshotId: snapshot.snapshotId,
    targetSequenceNumber: snapshot.lastSequenceNumber,
    operatorId: args.operatorId,
    reason: args.reason,
    createdAt: args.createdAt,
  });
  return head;
}

export async function clearRecoveryHead(
  store: SnapshotRecoveryStore,
  args: { worldId: string; operatorId: string; reason: string; createdAt: number },
): Promise<void> {
  validOperatorInput(args.operatorId, args.reason, args.createdAt);
  await store.replaceRecoveryHead(args.worldId, null);
  await store.appendRecoveryAudit({ ...args, action: 'cleared' });
}

/** Recovery-aware operations projection; Canon events remain untouched and fully queryable. */
export async function getOperationalProjection(
  store: SnapshotRecoveryStore,
  worldId: string,
): Promise<WorldProjection> {
  const events = await store.loadAcceptedEvents(worldId);
  const baseline = await loadWorldBaseline(store, worldId);
  const head = await store.loadRecoveryHead(worldId);
  if (!head) {
    return replayWorldEvents(
      cloneProjection(baseline.projection),
      events.filter((event) => event.sequenceNumber > baseline.lastSequenceNumber),
    );
  }
  const snapshot = await store.loadSnapshot(worldId, head.targetSnapshotId);
  if (!snapshot || snapshot.lastSequenceNumber !== head.targetSequenceNumber) {
    throw new CanonError(canonError('RECOVERY_HEAD_CONFLICT', 'recovery head target is missing or inconsistent'));
  }
  assertSnapshotMatchesHistory(snapshot, events, baseline);
  return cloneProjection(snapshot.projection);
}

/** Offline reference store used for integration and long-run evidence. */
export class InMemorySnapshotRecoveryStore implements SnapshotRecoveryStore {
  private readonly events: AcceptedEvent[] = [];
  private readonly snapshots: StoredCanonSnapshot[] = [];
  private readonly heads = new Map<string, RecoveryHead>();
  readonly audit: RecoveryAudit[] = [];

  appendEvent(event: AcceptedEvent): void { this.events.push(structuredClone(event)); }
  acceptedEvents(): AcceptedEvent[] { return structuredClone(this.events); }
  storedSnapshots(): StoredCanonSnapshot[] { return structuredClone(this.snapshots); }
  loadAcceptedEvents(worldId: string): Promise<AcceptedEvent[]> {
    return Promise.resolve(structuredClone(this.events.filter((event) => event.worldId === worldId)));
  }
  findDailySnapshot(worldId: string, worldDay: number): Promise<StoredCanonSnapshot | null> {
    return Promise.resolve(structuredClone(this.snapshots.find((s) => s.worldId === worldId && s.worldDay === worldDay && s.kind === 'daily') ?? null));
  }
  loadLatestSnapshot(worldId: string, throughWorldDay: number): Promise<StoredCanonSnapshot | null> {
    const found = this.snapshots.filter((s) => s.worldId === worldId && s.worldDay <= throughWorldDay)
      .sort((a, b) => b.lastSequenceNumber - a.lastSequenceNumber)[0] ?? null;
    return Promise.resolve(structuredClone(found));
  }
  loadSnapshot(worldId: string, snapshotId: string): Promise<StoredCanonSnapshot | null> {
    return Promise.resolve(structuredClone(this.snapshots.find((s) => s.worldId === worldId && s.snapshotId === snapshotId) ?? null));
  }
  loadInitialSnapshot(worldId: string): Promise<StoredCanonSnapshot | null> {
    return Promise.resolve(structuredClone(this.snapshots.find((s) => s.worldId === worldId && s.kind === 'initial') ?? null));
  }
  saveSnapshot(snapshot: CanonSnapshot, kind: SnapshotKind): Promise<StoredCanonSnapshot> {
    const stored = { ...structuredClone(snapshot), kind, snapshotId: `snapshot-${this.snapshots.length}` };
    this.snapshots.push(stored);
    return Promise.resolve(structuredClone(stored));
  }
  loadRecoveryHead(worldId: string): Promise<RecoveryHead | null> {
    return Promise.resolve(structuredClone(this.heads.get(worldId) ?? null));
  }
  replaceRecoveryHead(worldId: string, head: RecoveryHead | null): Promise<void> {
    if (head) this.heads.set(head.worldId, structuredClone(head));
    else this.heads.delete(worldId);
    return Promise.resolve();
  }
  appendRecoveryAudit(entry: RecoveryAudit): Promise<void> {
    this.audit.push(structuredClone(entry));
    return Promise.resolve();
  }
}
