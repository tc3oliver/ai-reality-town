/**
 * Server-side operator authorization for the simulation operations console
 * (FR-K001, NFR-005).
 *
 * NFR-005 requires that the administrative surface authenticates identity AND
 * permission, that every privileged mutation is server-authorized and auditable,
 * and that no secret reaches a log or a public trace. This module is the single
 * decision point for all of that.
 *
 * Pure module — no Convex imports, no clock, no randomness, no I/O. The Convex
 * wiring layer ({@link ./opsConsoleFunctions.ts}) supplies the verified identity
 * and the raw registry string; every policy decision is made here so it can be
 * unit tested without a deployment.
 *
 * TRUST MODEL
 * -----------
 * The operator registry lives ONLY in the Convex deployment environment variable
 * `SIMULATION_OPS_OPERATORS`. It is never committed, never returned to a caller,
 * and never written to the audit log. Two principal sources are supported and
 * both are verified server-side:
 *
 *   1. `identity` — a Convex-verified `ctx.auth` identity whose `subject` (or
 *      `tokenIdentifier`) is listed in the registry. Preferred; the client cannot
 *      forge it because Convex validates the JWT before the handler runs.
 *   2. `token`    — a per-operator ops token compared in constant time against
 *      the registry entry. This is the bootstrap/automation path used until an
 *      identity provider is configured for the deployment.
 *
 * FAIL-CLOSED
 * -----------
 * An unset registry, malformed registry JSON, a missing identity, an unknown
 * subject, a disabled operator, a mismatched token, or an unknown capability all
 * deny. There is no implicit "no registry means open" mode.
 *
 * UNIFORM DENIAL (AC#3)
 * ---------------------
 * Every denial throws the SAME error code and the SAME message. The console must
 * not let an unauthorized caller distinguish "you are not an operator" from "that
 * world does not exist" from "that capability requires admin", because any of
 * those distinctions leaks the existence and shape of privileged controls.
 */

/** Operator roles, ordered from least to most privileged. */
export const OPERATOR_ROLES = ['viewer', 'operator', 'admin'] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

/**
 * The eight FR-K001 console capabilities, one per PRD bullet:
 * pause / resume / advance a slot / retry a failed run / cancel an uncommitted
 * scene / inspect world state / create a snapshot / inspect schedules and queues.
 *
 * Plus the three FR-K006 emergency capabilities. They are deliberately SEPARATE
 * from `world.pause`/`world.resume`: the kill switch halts the executor itself
 * rather than only the clock, and rollback repoints operational reads, so both
 * are reserved for `admin` even though an ordinary pause is not.
 *
 * Plus the three FR-K003 canon remediation capabilities. One capability per
 * remediation type so the audit trail distinguishes a factual correction from an
 * offsetting compensation from a narrative retcon without reading the event.
 */
export const OPS_CAPABILITIES = [
  'world.pause',
  'world.resume',
  'slot.advance',
  'run.retry',
  'scene.cancel',
  'world.inspect',
  'snapshot.create',
  'schedule.inspect',
  'world.emergency_stop',
  'world.emergency_resume',
  'world.rollback',
  'canon.correct',
  'canon.compensate',
  'canon.retcon',
  // FR-P004 / ART-132. Revising a post-generation safety label decides whether already
  // published text stays visible, so it is its own capability rather than folded into an
  // existing one: an operator trusted to pause a world is not thereby trusted to un-withhold
  // content the safety classifier refused.
  'safety.override',
  /**
   * FR-Q002 / ART-134. Four controls over the public dynamic view, each its own capability
   * rather than folded into an existing one.
   *
   * `dynamic.hide` is separated from `safety.override` for the reason the two ledgers are
   * separate: one pulls content an operator judged should come down, the other revises what a
   * CLASSIFIER decided, and an operator trusted to take a mis-rendering sprite off the map is
   * not thereby trusted to un-withhold content safety refused.
   *
   * `dynamic.pause` is separated from `world.pause` because they stop different things. Pausing
   * the WORLD stops the simulation; pausing the dynamic VIEW stops republishing what the public
   * sees while the world keeps running. Sharing a capability would mean an operator who can
   * freeze the public page can also halt Canon, which is a much larger action.
   */
  'dynamic.pause',
  'dynamic.pin_snapshot',
  'dynamic.hide',
  'dynamic.rebuild',
  /** Read-only: binding and synchronisation errors (AC#4). */
  'dynamic.inspect',
  /**
   * FR-K005 / ART-52. Per-module model, prompt, temperature, token, timeout, retry, fallback
   * and daily-budget configuration.
   *
   * Its own capability rather than folded into `world.pause` or `snapshot.create`, because it
   * governs a different thing from either: what the world COSTS and how it is AUTHORED. An
   * operator trusted to pause a running world is not thereby trusted to change which model
   * writes its scenes, and the reverse is equally true.
   *
   * `model_config.write` is `admin` for the reason `snapshot.create` is: it takes effect on
   * every subsequent scene in the world, it is the lever that decides spend, and a wrong value
   * is not visible in the output until scenes have already been authored with it.
   * `model_config.inspect` is `viewer`, matching `world.inspect` — reading what the world is
   * configured to do does not require the authority to change it.
   */
  'model_config.write',
  'model_config.inspect',
] as const;
export type OpsCapability = (typeof OPS_CAPABILITIES)[number];

/**
 * Minimum role required per capability.
 *
 * `viewer` is read-only. `operator` may drive the running world. `snapshot.create`
 * is reserved for `admin` because it writes a durable recovery artifact, mirroring
 * the admin-only reservation already used by the publication lifecycle (FR-K004).
 */
const CAPABILITY_MINIMUM_ROLE: Readonly<Record<OpsCapability, OperatorRole>> = {
  'world.inspect': 'viewer',
  'schedule.inspect': 'viewer',
  'world.pause': 'operator',
  // Every dynamic control drives the running public view, so `operator`; inspection is
  // read-only and therefore `viewer`, matching `world.inspect`.
  'dynamic.pause': 'operator',
  'dynamic.pin_snapshot': 'operator',
  'dynamic.hide': 'operator',
  'dynamic.rebuild': 'operator',
  'dynamic.inspect': 'viewer',
  'world.resume': 'operator',
  'slot.advance': 'operator',
  'run.retry': 'operator',
  'scene.cancel': 'operator',
  'snapshot.create': 'admin',
  // FR-K006. Engaging the kill switch halts a whole world's simulation; releasing it
  // restarts one; rollback repoints every operational read at an earlier snapshot.
  // All three are world-wide and are therefore reserved for `admin`.
  'world.emergency_stop': 'admin',
  'world.emergency_resume': 'admin',
  'world.rollback': 'admin',
  // FR-K003. A remediation appends to accepted Canon, the most consequential
  // write the console can make, so all three are reserved for `admin`.
  'canon.correct': 'admin',
  'canon.compensate': 'admin',
  'canon.retcon': 'admin',
  // FR-P004. Releasing content the safety classifier withheld is the highest-consequence
  // publication decision in the system, so it is `admin` for the same reason the remediations
  // are.
  'safety.override': 'admin',
  // FR-K005. Writing configuration decides which model authors every subsequent scene and what
  // the world costs, so `admin`; reading it is as read-only as `world.inspect`, so `viewer`.
  'model_config.write': 'admin',
  'model_config.inspect': 'viewer',
};

/** Capabilities that only ever read; used to keep read entry points side-effect free. */
export const READ_ONLY_CAPABILITIES: readonly OpsCapability[] = ['world.inspect', 'schedule.inspect'];

function roleRank(role: OperatorRole): number {
  return OPERATOR_ROLES.indexOf(role);
}

export function isOperatorRole(value: unknown): value is OperatorRole {
  return typeof value === 'string' && (OPERATOR_ROLES as readonly string[]).includes(value);
}

export function isOpsCapability(value: unknown): value is OpsCapability {
  return typeof value === 'string' && (OPS_CAPABILITIES as readonly string[]).includes(value);
}

/** The single denial code. Never varies, so denials carry no information. */
export const OPS_UNAUTHORIZED = 'OPS_UNAUTHORIZED';
const UNAUTHORIZED_MESSAGE = 'operator is not authorized for this operation';

export class OperatorAuthorizationError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'OperatorAuthorizationError';
  }
}

/**
 * Build the one and only denial. Callers must not attach context: a denial that
 * varies by cause tells an unauthorized caller which controls exist (AC#3).
 */
export function unauthorized(): OperatorAuthorizationError {
  return new OperatorAuthorizationError(OPS_UNAUTHORIZED, UNAUTHORIZED_MESSAGE);
}

/** True when the error is the uniform denial (used by tests and by ops tooling). */
export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof OperatorAuthorizationError && error.code === OPS_UNAUTHORIZED;
}

/**
 * One registry entry. `subjects` lists the verified identity subjects that map to
 * this operator; `token` is the optional bootstrap ops token. At least one of the
 * two must be present or the entry can never authenticate anything.
 */
export type OperatorRegistryEntry = {
  operatorId: string;
  role: OperatorRole;
  subjects: readonly string[];
  /** Never logged, never audited, never returned to a caller. */
  token?: string;
  /** Optional world allowlist. Empty/absent means every world. */
  worldIds?: readonly string[];
  disabled?: boolean;
};

export type OperatorRegistry = readonly OperatorRegistryEntry[];

/** The resolved, authenticated principal. Contains no secret material. */
export type OperatorPrincipal = {
  operatorId: string;
  role: OperatorRole;
  /** How this principal proved itself; recorded in the audit trail. */
  source: 'identity' | 'token';
  /**
   * The verified identity subject when `source === 'identity'`, otherwise the
   * literal `'token'`. Never contains the token value itself.
   */
  subject: string;
};

/** What the wiring layer knows about the caller before authorization runs. */
export type OperatorCredentials = {
  /** `ctx.auth.getUserIdentity()` result, reduced to the fields we trust. */
  identity?: { subject?: string | null; tokenIdentifier?: string | null } | null;
  /** Caller-supplied ops token for the bootstrap path. */
  token?: string | null;
  /** Caller-supplied operator id, required with `token` to select the entry. */
  operatorId?: string | null;
};

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function parseEntry(value: unknown): OperatorRegistryEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const operatorId = nonEmptyString(row.operatorId);
  if (!operatorId || !isOperatorRole(row.role)) return null;
  const subjects = Array.isArray(row.subjects)
    ? row.subjects.filter((subject): subject is string => nonEmptyString(subject) !== null)
    : [];
  const token = nonEmptyString(row.token) ?? undefined;
  if (subjects.length === 0 && token === undefined) return null;
  const worldIds = Array.isArray(row.worldIds)
    ? row.worldIds.filter((worldId): worldId is string => nonEmptyString(worldId) !== null)
    : undefined;
  return {
    operatorId,
    role: row.role,
    subjects,
    token,
    worldIds: worldIds && worldIds.length > 0 ? worldIds : undefined,
    disabled: row.disabled === true,
  };
}

/**
 * Parse `SIMULATION_OPS_OPERATORS`. Any problem — unset, blank, not JSON, not an
 * array — yields an EMPTY registry, which denies every caller. Individual entries
 * that are malformed are dropped rather than throwing, so one bad row cannot be
 * used to probe the parser, and a partially valid registry still authorizes only
 * the operators it actually describes.
 */
export function parseOperatorRegistry(raw: string | undefined | null): OperatorRegistry {
  const source = nonEmptyString(raw);
  if (!source) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: OperatorRegistryEntry[] = [];
  const seen = new Set<string>();
  for (const candidate of parsed) {
    const entry = parseEntry(candidate);
    // A duplicate operatorId is ambiguous; keep the first and drop the rest.
    if (entry && !seen.has(entry.operatorId)) {
      seen.add(entry.operatorId);
      entries.push(entry);
    }
  }
  return entries;
}

/**
 * Constant-time string comparison. A naive `===` on a secret leaks its prefix
 * length through timing; this always inspects every character of the longer
 * input. Length is intentionally folded into the accumulator rather than
 * short-circuited on.
 */
export function constantTimeEquals(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < length; index++) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

/**
 * Resolve the authenticated principal, or `null` when the caller cannot prove any
 * registered identity. Identity is tried first so a deployment with a configured
 * provider never falls back to the weaker token path for the same operator.
 *
 * `allowTokenFallback` (default `true` for back-compat with the bootstrap era) gates the
 * shared-token branch. The Convex wiring ({@link ./opsConsoleFunctions.ts}) computes it
 * from the deployment env: the token stays available only until an identity provider is
 * configured (`CLERK_JWT_ISSUER_DOMAIN`), or when an operator explicitly sets
 * `SIMULATION_OPS_ALLOW_TOKEN_FALLBACK=1` as an escape hatch — so retiring the token (audit
 * H-1) cannot lock out a deployment that has not yet finished moving to verified identity.
 */
export function resolveOperatorPrincipal(
  credentials: OperatorCredentials,
  registry: OperatorRegistry,
  allowTokenFallback = true,
): OperatorPrincipal | null {
  const active = registry.filter((entry) => !entry.disabled);

  const subject = nonEmptyString(credentials.identity?.subject)
    ?? nonEmptyString(credentials.identity?.tokenIdentifier);
  if (subject) {
    const entry = active.find((candidate) => candidate.subjects.includes(subject));
    if (entry) return { operatorId: entry.operatorId, role: entry.role, source: 'identity', subject };
  }

  if (!allowTokenFallback) return null;

  const token = nonEmptyString(credentials.token);
  const operatorId = nonEmptyString(credentials.operatorId);
  if (token && operatorId) {
    // Compare against every entry so a wrong operatorId costs the same as a wrong
    // token, then accept only an exact operatorId + token match.
    let matched: OperatorRegistryEntry | null = null;
    for (const entry of active) {
      const tokenOk = entry.token !== undefined && constantTimeEquals(entry.token, token);
      if (tokenOk && entry.operatorId === operatorId) matched = entry;
    }
    if (matched) return { operatorId: matched.operatorId, role: matched.role, source: 'token', subject: 'token' };
  }

  return null;
}

/** True when the principal's role meets the capability's minimum role. */
export function hasCapability(role: OperatorRole, capability: OpsCapability): boolean {
  return roleRank(role) >= roleRank(CAPABILITY_MINIMUM_ROLE[capability]);
}

/** The capability -> minimum-role matrix, exported for docs, tests, and ops tooling. */
export const OPS_CAPABILITY_MINIMUM_ROLE = CAPABILITY_MINIMUM_ROLE;

/** Every capability the role may exercise, for an authenticated "what can I do" query. */
export function capabilitiesForRole(role: OperatorRole): OpsCapability[] {
  return OPS_CAPABILITIES.filter((capability) => hasCapability(role, capability));
}

/**
 * THE authorization gate. Resolves the principal, checks the capability, and
 * checks the optional per-operator world allowlist. Throws the uniform denial for
 * every failure. Callers MUST invoke this before reading or writing anything, so
 * an unauthorized caller cannot distinguish a missing world from a denied one.
 */
export function authorizeOperator(input: {
  credentials: OperatorCredentials;
  registry: OperatorRegistry;
  capability: OpsCapability;
  worldId: string;
  /**
   * Whether the shared-token bootstrap path may authenticate. The wiring derives this
   * from the deployment env (audit H-1); defaults to `true` so direct callers and tests
   * keep the historical behaviour.
   */
  allowTokenFallback?: boolean;
}): OperatorPrincipal {
  if (!isOpsCapability(input.capability)) throw unauthorized();
  const worldId = nonEmptyString(input.worldId);
  if (!worldId) throw unauthorized();
  const principal = resolveOperatorPrincipal(input.credentials, input.registry, input.allowTokenFallback ?? true);
  if (!principal) throw unauthorized();
  if (!hasCapability(principal.role, input.capability)) throw unauthorized();
  const entry = input.registry.find((candidate) => candidate.operatorId === principal.operatorId);
  if (!entry || entry.disabled) throw unauthorized();
  if (entry.worldIds && !entry.worldIds.includes(worldId)) throw unauthorized();
  return principal;
}

/** A single row of the operator audit trail. Contains no secret material. */
export type OperatorAuditEntry = {
  schemaVersion: 1;
  worldId: string;
  operatorId: string;
  subject: string;
  role: OperatorRole;
  source: 'identity' | 'token';
  capability: OpsCapability;
  /** What the operation acted on, e.g. a slot key or a run id. */
  target?: string;
  reason: string;
  outcome: 'applied' | 'no_op' | 'refused';
  /** Stable machine-readable outcome code, e.g. `OPS_SLOT_ALREADY_CANCELLED`. */
  resultCode: string;
  at: number;
};

/** Field names that must never be copied into an audit row. Compared case-insensitively. */
const FORBIDDEN_AUDIT_FIELDS = ['token', 'operatortoken', 'apikey', 'authorization', 'password', 'secret'];

/**
 * Build an audit row. Rejects a blank reason (NFR-005 requires every privileged
 * mutation to be *reasoned*) and defends the "secrets never reach a log" rule by
 * refusing any target that looks like credential material.
 */
export function buildOperatorAuditEntry(input: {
  principal: OperatorPrincipal;
  worldId: string;
  capability: OpsCapability;
  target?: string;
  reason: string;
  outcome: OperatorAuditEntry['outcome'];
  resultCode: string;
  at: number;
}): OperatorAuditEntry {
  const reason = nonEmptyString(input.reason);
  if (!reason) throw new OperatorAuthorizationError('OPS_REASON_REQUIRED', 'a non-empty reason is required');
  if (!Number.isFinite(input.at)) {
    throw new OperatorAuthorizationError('OPS_INVALID_TIMESTAMP', 'audit timestamp must be finite');
  }
  const target = nonEmptyString(input.target) ?? undefined;
  const lowered = `${reason} ${target ?? ''}`.toLowerCase();
  if (FORBIDDEN_AUDIT_FIELDS.some((field) => lowered.includes(`${field}=`) || lowered.includes(`${field}:`))) {
    throw new OperatorAuthorizationError('OPS_AUDIT_SECRET_LEAK', 'audit fields must not carry credential material');
  }
  return {
    schemaVersion: 1,
    worldId: input.worldId,
    operatorId: input.principal.operatorId,
    subject: input.principal.subject,
    role: input.principal.role,
    source: input.principal.source,
    capability: input.capability,
    target,
    reason,
    outcome: input.outcome,
    resultCode: input.resultCode,
    at: input.at,
  };
}
