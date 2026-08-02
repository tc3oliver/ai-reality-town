/** Versioned, secret-safe metadata contract for one generative model call. */

export const LLM_TRACE_SCHEMA_VERSION = 1 as const;
export const TRACE_VALIDATION_RESULTS = ['not_run', 'passed', 'rejected'] as const;
export const TRACE_FINAL_STATUSES = ['succeeded', 'failed', 'withheld'] as const;

export type TraceValidationResult = typeof TRACE_VALIDATION_RESULTS[number];
export type TraceFinalStatus = typeof TRACE_FINAL_STATUSES[number];

export type LlmTraceDraft = {
  schemaVersion: typeof LLM_TRACE_SCHEMA_VERSION;
  traceId: string;
  worldId: string;
  worldDay: number;
  runId: string;
  /** Absent only when the call is not associated with a scene. */
  sceneId?: string;
  /** Absent only when the call is not associated with a story arc. */
  arcId?: string;
  /** Required; an empty list explicitly means no character context. */
  characterIds: string[];
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  retryCount: number;
  validationResult: TraceValidationResult;
  finalStatus: TraceFinalStatus;
};

export type LlmTraceRecord = LlmTraceDraft & { recordedAt: number };

export type PublicLlmTrace = Pick<
  LlmTraceRecord,
  'schemaVersion' | 'traceId' | 'worldId' | 'worldDay' | 'finalStatus'
>;

export type LlmTraceErrorCode =
  | 'INVALID_LLM_TRACE'
  | 'UNSUPPORTED_LLM_TRACE_VERSION'
  | 'SENSITIVE_LLM_TRACE_FIELD'
  | 'CONFLICTING_LLM_TRACE';

export class LlmTraceError extends Error {
  readonly code: LlmTraceErrorCode;
  readonly path?: string;

  constructor(code: LlmTraceErrorCode, message: string, path?: string) {
    super(`[${code}] ${message}`);
    this.name = 'LlmTraceError';
    this.code = code;
    this.path = path;
  }
}

type PlainObject = Record<string, unknown>;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:#|\-]{0,159}$/u;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/\-]{0,159}$/u;
const ALLOWED_KEYS = [
  'schemaVersion', 'traceId', 'worldId', 'worldDay', 'runId', 'sceneId', 'arcId',
  'characterIds', 'model', 'promptVersion', 'inputTokens', 'outputTokens', 'latencyMs',
  'retryCount', 'validationResult', 'finalStatus',
] as const;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLocaleLowerCase('en-US').replace(/[^a-z0-9]/gu, '');
  return (normalized.includes('prompt') && normalized !== 'promptversion')
    || normalized.includes('secret')
    || normalized.includes('apikey')
    || normalized.includes('authorization')
    || normalized === 'messages'
    || normalized === 'requestbody'
    || normalized === 'responsebody'
    || normalized === 'inputtext'
    || normalized === 'outputtext';
}

function requiredId(value: unknown, path: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new LlmTraceError('INVALID_LLM_TRACE', 'field must be a bounded technical identifier', path);
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new LlmTraceError('INVALID_LLM_TRACE', 'field must be a non-negative safe integer', path);
  }
  return value as number;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new LlmTraceError('INVALID_LLM_TRACE', 'field contains an unsupported value', path);
  }
  return value as T;
}

/** Strictly normalize unknown accounting metadata. Raw prompts/secrets are never accepted. */
export function normalizeLlmTraceDraft(value: unknown): LlmTraceDraft {
  if (!isPlainObject(value)) throw new LlmTraceError('INVALID_LLM_TRACE', 'trace must be a plain object', '$');
  const unknownKeys = Object.keys(value).filter((key) => !ALLOWED_KEYS.includes(key as typeof ALLOWED_KEYS[number]));
  const sensitive = unknownKeys.find(isSensitiveKey);
  if (sensitive) throw new LlmTraceError('SENSITIVE_LLM_TRACE_FIELD', 'raw content is forbidden in trace records', sensitive);
  if (unknownKeys.length) throw new LlmTraceError('INVALID_LLM_TRACE', 'trace contains unknown fields', '$');
  if (value.schemaVersion !== LLM_TRACE_SCHEMA_VERSION) {
    throw new LlmTraceError('UNSUPPORTED_LLM_TRACE_VERSION', 'only LLM trace version 1 is supported', 'schemaVersion');
  }
  if (!Array.isArray(value.characterIds)) {
    throw new LlmTraceError('INVALID_LLM_TRACE', 'characterIds must be an array', 'characterIds');
  }
  const characterIds = value.characterIds.map((id, index) => requiredId(id, `characterIds[${index}]`));
  if (new Set(characterIds).size !== characterIds.length) {
    throw new LlmTraceError('INVALID_LLM_TRACE', 'characterIds must be unique', 'characterIds');
  }
  if (typeof value.model !== 'string' || !MODEL_PATTERN.test(value.model)) {
    throw new LlmTraceError('INVALID_LLM_TRACE', 'model must be a bounded provider model identifier', 'model');
  }
  return {
    schemaVersion: LLM_TRACE_SCHEMA_VERSION,
    traceId: requiredId(value.traceId, 'traceId'),
    worldId: requiredId(value.worldId, 'worldId'),
    worldDay: nonNegativeInteger(value.worldDay, 'worldDay'),
    runId: requiredId(value.runId, 'runId'),
    ...(value.sceneId === undefined ? {} : { sceneId: requiredId(value.sceneId, 'sceneId') }),
    ...(value.arcId === undefined ? {} : { arcId: requiredId(value.arcId, 'arcId') }),
    characterIds,
    model: value.model,
    promptVersion: requiredId(value.promptVersion, 'promptVersion'),
    inputTokens: nonNegativeInteger(value.inputTokens, 'inputTokens'),
    outputTokens: nonNegativeInteger(value.outputTokens, 'outputTokens'),
    latencyMs: nonNegativeInteger(value.latencyMs, 'latencyMs'),
    retryCount: nonNegativeInteger(value.retryCount, 'retryCount'),
    validationResult: enumValue(value.validationResult, TRACE_VALIDATION_RESULTS, 'validationResult'),
    finalStatus: enumValue(value.finalStatus, TRACE_FINAL_STATUSES, 'finalStatus'),
  };
}

export function publicLlmTrace(record: LlmTraceRecord): PublicLlmTrace {
  return {
    schemaVersion: record.schemaVersion,
    traceId: record.traceId,
    worldId: record.worldId,
    worldDay: record.worldDay,
    finalStatus: record.finalStatus,
  };
}

export type TraceAccessRole = 'public' | 'viewer' | 'operations' | 'admin';
export function traceForRole(
  record: LlmTraceRecord,
  role: TraceAccessRole,
): PublicLlmTrace | LlmTraceRecord {
  return role === 'operations' || role === 'admin'
    ? structuredClone(record)
    : publicLlmTrace(record);
}

export interface LlmTraceStore {
  find(traceId: string): Promise<LlmTraceRecord | null>;
  /** Atomically insert; return the existing record when the trace ID already exists. */
  insertIfAbsent(record: LlmTraceRecord): Promise<LlmTraceRecord | null>;
}

export type RecordTraceResult = { traceId: string; deduplicated: boolean };

export async function recordLlmTrace(
  store: LlmTraceStore,
  draft: unknown,
  recordedAt: number,
): Promise<RecordTraceResult> {
  const normalized = normalizeLlmTraceDraft(draft);
  if (!Number.isSafeInteger(recordedAt) || recordedAt < 0) {
    throw new LlmTraceError('INVALID_LLM_TRACE', 'recordedAt must be a non-negative safe integer', 'recordedAt');
  }
  const record = { ...normalized, recordedAt };
  const existing = await store.insertIfAbsent(record);
  if (existing) {
    const { recordedAt: _existingTime, ...existingDraft } = existing;
    if (JSON.stringify(existingDraft) !== JSON.stringify(normalized)) {
      throw new LlmTraceError('CONFLICTING_LLM_TRACE', 'traceId already identifies another model call', 'traceId');
    }
    return { traceId: existing.traceId, deduplicated: true };
  }
  return { traceId: normalized.traceId, deduplicated: false };
}

export class InMemoryLlmTraceStore implements LlmTraceStore {
  private readonly records = new Map<string, LlmTraceRecord>();

  find(traceId: string): Promise<LlmTraceRecord | null> {
    const record = this.records.get(traceId);
    return Promise.resolve(record ? structuredClone(record) : null);
  }

  insertIfAbsent(record: LlmTraceRecord): Promise<LlmTraceRecord | null> {
    const existing = this.records.get(record.traceId);
    if (existing) return Promise.resolve(structuredClone(existing));
    this.records.set(record.traceId, structuredClone(record));
    return Promise.resolve(null);
  }
}
