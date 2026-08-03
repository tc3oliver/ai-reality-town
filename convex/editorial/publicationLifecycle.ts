/**
 * Independent editorial publication lifecycle (FR-K004).
 *
 * This layer is STRICTLY SEPARATE from canon: no function here reads or writes
 * accepted events, and no publication transition can delete or edit canon
 * history. Publication status only governs whether derived public content
 * (e.g. a generated episode summary) is visible. A withheld or superseded
 * publication leaves the underlying Canon Event untouched.
 *
 * Pure module — no Convex imports, no clock, no randomness. Callers supply the
 * wall-clock `at` value; persistence + authorization enforcement against the
 * Convex identity happen in the wiring layer ({@link ./publicationLifecycleFunctions.ts}).
 */

export const PUBLICATION_STATUSES = [
  'generated',
  'validated',
  'safety_review',
  'ready',
  'published',
  'withheld',
  'superseded',
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const PUBLICATION_TERMINAL_STATUSES: readonly PublicationStatus[] = ['superseded'];

export function isPublicationStatus(value: unknown): value is PublicationStatus {
  return typeof value === 'string' && (PUBLICATION_STATUSES as readonly string[]).includes(value);
}

export function isTerminalPublicationStatus(status: PublicationStatus): boolean {
  return PUBLICATION_TERMINAL_STATUSES.includes(status);
}

/** Content a publication record governs. `episode` today; extensible. */
export type PublicationContentKind = 'episode';
export const PUBLICATION_CONTENT_KINDS: readonly PublicationContentKind[] = ['episode'];

export type PublicationActor = { type: 'admin' | 'system'; id: string };

export type PublicationAction =
  | 'create'
  | 'validate'
  | 'begin_safety_review'
  | 'pass_safety_review'
  | 'publish'
  | 'withhold'
  | 'resume_to_ready'
  | 'regenerate';

/** Actions that an administrator may take; system actors drive the generation pipeline. */
const ADMIN_ONLY_ACTIONS: ReadonlySet<PublicationAction> = new Set<PublicationAction>([
  'publish',
  'withhold',
  'resume_to_ready',
  'regenerate',
]);

export type PublicationAuditEvent = {
  action: PublicationAction;
  fromStatus: PublicationStatus;
  toStatus: PublicationStatus;
  actor: PublicationActor;
  reason: string;
  at: number;
  versionBefore: number;
  versionAfter: number;
};

export type PublicationRecord = {
  schemaVersion: 1;
  publicationId: string;
  worldId: string;
  contentKind: PublicationContentKind;
  /** Stable reference to the underlying generated content, e.g. `episode:<worldId>:<worldDay>`. */
  contentRef: string;
  status: PublicationStatus;
  /** Monotonic per-content version; regeneration allocates the next version. */
  version: number;
  /** Current public summary; null until generation provides one. */
  summary: string | null;
  audit: PublicationAuditEvent[];
};

export class PublicationLifecycleError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'PublicationLifecycleError';
  }
}

/**
 * Legal forward transitions. The map key is the source status; each action maps
 * to its destination status. `superseded` is terminal. `regenerate` is handled
 * separately by {@link regeneratePublication} because it supersedes the current
 * record AND spawns a fresh `generated` record.
 */
const LEGAL_TRANSITIONS: Record<PublicationStatus, Partial<Record<PublicationAction, PublicationStatus>>> = {
  generated: { validate: 'validated' },
  validated: { begin_safety_review: 'safety_review', withhold: 'withheld' },
  safety_review: { pass_safety_review: 'ready', withhold: 'withheld' },
  ready: { publish: 'published', withhold: 'withheld' },
  published: { withhold: 'withheld' },
  withheld: { resume_to_ready: 'ready' },
  superseded: {},
};

/** Records that may be regenerated (the administrator replaces the public summary). */
const REGENERATABLE_STATUSES: ReadonlySet<PublicationStatus> = new Set<PublicationStatus>([
  'generated',
  'validated',
  'safety_review',
  'ready',
  'published',
  'withheld',
]);

function nonempty(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PublicationLifecycleError('PUBLICATION_INVALID_SHAPE', `must be a non-empty string: ${path}`);
  }
  return value;
}

function assertFiniteAt(at: number): void {
  if (!Number.isFinite(at)) {
    throw new PublicationLifecycleError('PUBLICATION_INVALID_SHAPE', 'audit timestamp must be finite');
  }
}

/** Authorize an action for the actor. Admin-only actions require an admin actor. */
export function assertAuthorized(action: PublicationAction, actor: PublicationActor): void {
  if (!actor || (actor.type !== 'admin' && actor.type !== 'system')) {
    throw new PublicationLifecycleError('PUBLICATION_UNAUTHORIZED', 'actor must be admin or system');
  }
  if (ADMIN_ONLY_ACTIONS.has(action) && actor.type !== 'admin') {
    throw new PublicationLifecycleError(
      'PUBLICATION_UNAUTHORIZED',
      `action '${action}' requires an administrator`,
    );
  }
}

/** Validate a full publication record (used when hydrating persisted rows). */
export function validatePublicationRecord(value: unknown): PublicationRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PublicationLifecycleError('PUBLICATION_INVALID_SHAPE', 'record must be an object');
  }
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1) {
    throw new PublicationLifecycleError('PUBLICATION_INVALID_SHAPE', 'unsupported schema version');
  }
  if (!isPublicationStatus(row.status)) {
    throw new PublicationLifecycleError('PUBLICATION_INVALID_SHAPE', 'unsupported status');
  }
  if (typeof row.contentKind !== 'string' || !(PUBLICATION_CONTENT_KINDS as readonly string[]).includes(row.contentKind)) {
    throw new PublicationLifecycleError('PUBLICATION_INVALID_SHAPE', 'unsupported content kind');
  }
  if (!Array.isArray(row.audit)) {
    throw new PublicationLifecycleError('PUBLICATION_INVALID_SHAPE', 'audit must be an array');
  }
  if (!Number.isSafeInteger(row.version) || (row.version as number) < 1) {
    throw new PublicationLifecycleError('PUBLICATION_INVALID_SHAPE', 'version must be a positive integer');
  }
  const publicationId = nonempty(row.publicationId, 'publicationId');
  const worldId = nonempty(row.worldId, 'worldId');
  const contentRef = nonempty(row.contentRef, 'contentRef');
  const summary = row.summary === null ? null : (typeof row.summary === 'string' ? row.summary : null);
  if (row.summary !== undefined && row.summary !== null && typeof row.summary !== 'string') {
    throw new PublicationLifecycleError('PUBLICATION_INVALID_SHAPE', 'summary must be a string or null');
  }
  const audit = row.audit as PublicationAuditEvent[];
  return {
    schemaVersion: 1,
    publicationId,
    worldId,
    contentKind: row.contentKind as PublicationContentKind,
    contentRef,
    status: row.status,
    version: row.version as number,
    summary,
    audit,
  };
}

/** Create a fresh publication record in the `generated` status. */
export function createPublicationRecord(input: {
  publicationId: string;
  worldId: string;
  contentKind: PublicationContentKind;
  contentRef: string;
  summary: string | null;
  actor: PublicationActor;
  reason: string;
  at: number;
}): PublicationRecord {
  const publicationId = nonempty(input.publicationId, 'publicationId');
  const worldId = nonempty(input.worldId, 'worldId');
  const contentRef = nonempty(input.contentRef, 'contentRef');
  const reason = nonempty(input.reason, 'reason');
  assertFiniteAt(input.at);
  assertAuthorized('create', input.actor);
  const record: PublicationRecord = {
    schemaVersion: 1,
    publicationId,
    worldId,
    contentKind: input.contentKind,
    contentRef,
    status: 'generated',
    version: 1,
    summary: input.summary,
    audit: [],
  };
  record.audit.push({
    action: 'create',
    fromStatus: 'generated',
    toStatus: 'generated',
    actor: input.actor,
    reason,
    at: input.at,
    versionBefore: 0,
    versionAfter: 1,
  });
  return record;
}

function assertTransition(record: PublicationRecord, action: PublicationAction): PublicationStatus {
  if (action === 'regenerate') {
    throw new PublicationLifecycleError('PUBLICATION_INVALID_ACTION', 'use regeneratePublication for regeneration');
  }
  if (isTerminalPublicationStatus(record.status)) {
    throw new PublicationLifecycleError('PUBLICATION_ILLEGAL_TRANSITION', `cannot transition from terminal status '${record.status}'`);
  }
  const dest = LEGAL_TRANSITIONS[record.status][action];
  if (dest === undefined) {
    throw new PublicationLifecycleError(
      'PUBLICATION_ILLEGAL_TRANSITION',
      `'${action}' is not legal from '${record.status}'`,
    );
  }
  return dest;
}

/**
 * Apply a forward transition to a publication record. Returns a NEW record with
 * the audit event appended; never mutates the input. Throws on illegal
 * transitions or unauthorized actors. Performs zero canon operations.
 */
export function transitionPublication(
  record: PublicationRecord,
  action: Exclude<PublicationAction, 'create' | 'regenerate'>,
  actor: PublicationActor,
  reason: string,
  at: number,
): PublicationRecord {
  nonempty(reason, 'reason');
  assertFiniteAt(at);
  assertAuthorized(action, actor);
  const toStatus = assertTransition(record, action);
  const next: PublicationRecord = {
    ...structuredClone(record),
    status: toStatus,
    audit: [...record.audit],
  };
  next.audit.push({
    action,
    fromStatus: record.status,
    toStatus,
    actor,
    reason,
    at,
    versionBefore: record.version,
    versionAfter: record.version,
  });
  return next;
}

/**
 * Regenerate the public summary for a content reference. The current record is
 * marked `superseded` (with audit) and a fresh `generated` record at the next
 * version is returned. The underlying Canon Event is never touched — only the
 * derived summary is replaced. Requires an administrator.
 *
 * Returns both records so the wiring layer can persist the superseded prior and
 * the new current version in one transaction.
 */
export function regeneratePublication(
  record: PublicationRecord,
  nextPublicationId: string,
  newSummary: string | null,
  actor: PublicationActor,
  reason: string,
  at: number,
): { supersededPrior: PublicationRecord; next: PublicationRecord } {
  nonempty(nextPublicationId, 'nextPublicationId');
  nonempty(reason, 'reason');
  assertFiniteAt(at);
  assertAuthorized('regenerate', actor);
  if (!REGENERATABLE_STATUSES.has(record.status)) {
    throw new PublicationLifecycleError(
      'PUBLICATION_ILLEGAL_TRANSITION',
      `cannot regenerate a '${record.status}' publication`,
    );
  }
  const nextVersion = record.version + 1;
  const supersededPrior: PublicationRecord = {
    ...structuredClone(record),
    status: 'superseded',
    audit: [...record.audit],
  };
  supersededPrior.audit.push({
    action: 'regenerate',
    fromStatus: record.status,
    toStatus: 'superseded',
    actor,
    reason,
    at,
    versionBefore: record.version,
    versionAfter: nextVersion,
  });
  const next: PublicationRecord = {
    schemaVersion: 1,
    publicationId: nextPublicationId,
    worldId: record.worldId,
    contentKind: record.contentKind,
    contentRef: record.contentRef,
    status: 'generated',
    version: nextVersion,
    summary: newSummary,
    audit: [{
      action: 'create',
      fromStatus: 'generated',
      toStatus: 'generated',
      actor,
      reason,
      at,
      versionBefore: record.version,
      versionAfter: nextVersion,
    }],
  };
  return { supersededPrior, next };
}

/** Convenience: can a record currently advance to `published`? */
export function isPublishable(record: PublicationRecord): boolean {
  return record.status === 'ready';
}

/**
 * Reference implementation of the legal-transition graph, exported for tests and
 * ops tooling. Keys are source statuses; each action maps to its destination.
 */
export const PUBLICATION_LEGAL_TRANSITIONS = LEGAL_TRANSITIONS;
