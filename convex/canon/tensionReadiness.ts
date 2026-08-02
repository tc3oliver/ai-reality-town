/** Deterministic initial-tension readiness gate for FR-A003. */

import { internalMutation, internalQuery } from '../_generated/server';
import { v } from 'convex/values';
import type { GenericMutationCtx } from 'convex/server';
import type { DataModel } from '../_generated/dataModel';
import type { SeedKnowledge } from './characterSeed';

export const TENSION_PROFILE_SCHEMA_VERSION = 1;

export type InterestConflict = {
  id: string;
  participantCharacterIds: string[];
  description: string;
  stakes: string;
};

export type ResourceDependency = {
  id: string;
  dependentCharacterId: string;
  providerCharacterId: string;
  resourceOrDebt: string;
  description: string;
};

export type EmotionalTension = {
  id: string;
  participantCharacterIds: string[];
  description: string;
};

export type SharedMisunderstanding = {
  historyId: string;
  believingCharacterIds: string[];
  mistakenBelief: string;
};

export type LaunchableArcCandidate = {
  id: string;
  title: string;
  premise: string;
  currentQuestion: string;
  coreCharacterIds: string[];
  launchTrigger: string;
};

export type InitialTensionProfileV1 = {
  schemaVersion: 1;
  worldId: string;
  interestConflicts: InterestConflict[];
  resourceDependencies: ResourceDependency[];
  emotionalTensions: EmotionalTension[];
  sharedMisunderstanding: SharedMisunderstanding | null;
  launchableArcs: LaunchableArcCandidate[];
};

export type TensionEvidence = {
  worldId: string;
  characterIds: string[];
  privateSecretIds: string[];
  misconceptionKnowledgeIds: string[];
  historyIds: string[];
};

export const READINESS_THRESHOLDS = {
  interestConflicts: 3,
  privateSecrets: 3,
  resourceDependencies: 2,
  misconceptions: 2,
  emotionalTensions: 2,
  sharedMisunderstanding: 1,
  launchableMainArcs: 1,
} as const;

export type ReadinessCheckKey = keyof typeof READINESS_THRESHOLDS;

export type ReadinessCheck = {
  key: ReadinessCheckKey;
  required: number;
  actual: number;
  missingBy: number;
  passed: boolean;
  evidenceIds: string[];
};

export type ReadinessDeficit = {
  key: ReadinessCheckKey;
  required: number;
  actual: number;
  missingBy: number;
  message: string;
};

export type TensionReadinessReport = {
  reportVersion: 1;
  profileVersion: 1;
  worldId: string;
  evaluatedAt: number;
  readyForWarmup: boolean;
  checks: ReadinessCheck[];
  deficits: ReadinessDeficit[];
};

export type TensionReadinessErrorCode =
  | 'TENSION_PROFILE_INVALID_SHAPE'
  | 'TENSION_PROFILE_UNSUPPORTED_VERSION'
  | 'TENSION_PROFILE_INVALID_REFERENCE'
  | 'TENSION_PROFILE_DUPLICATE_ID'
  | 'TENSION_EVIDENCE_NOT_FOUND'
  | 'WORLD_NOT_READY_FOR_WARMUP';

export class TensionReadinessError extends Error {
  constructor(
    readonly code: TensionReadinessErrorCode,
    message: string,
    readonly path?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'TensionReadinessError';
  }
}

type RecordValue = Record<string, unknown>;

function object(value: unknown, path: string, keys: readonly string[]): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TensionReadinessError('TENSION_PROFILE_INVALID_SHAPE', 'must be an object', path);
  }
  const record = value as RecordValue;
  const unknown = Object.keys(record).filter((key) => !keys.includes(key));
  if (unknown.length) throw new TensionReadinessError('TENSION_PROFILE_INVALID_SHAPE', 'contains unknown fields', path, { fields: unknown });
  return record;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TensionReadinessError('TENSION_PROFILE_INVALID_SHAPE', 'must be a non-empty string', path);
  return value;
}

function strings(value: unknown, path: string, minimum = 0): string[] {
  if (!Array.isArray(value) || value.length < minimum) throw new TensionReadinessError('TENSION_PROFILE_INVALID_SHAPE', `must contain at least ${minimum} strings`, path);
  const parsed = value.map((entry, index) => string(entry, `${path}[${index}]`));
  if (new Set(parsed).size !== parsed.length) throw new TensionReadinessError('TENSION_PROFILE_DUPLICATE_ID', 'must not contain duplicates', path);
  return parsed;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TensionReadinessError('TENSION_PROFILE_INVALID_SHAPE', 'must be an array', path);
  return value;
}

function unique<T extends { id: string }>(values: T[], path: string): T[] {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) throw new TensionReadinessError('TENSION_PROFILE_DUPLICATE_ID', `duplicate id '${value.id}'`, path);
    ids.add(value.id);
  }
  return values;
}

function reference(id: string, ids: Set<string>, path: string, kind: string): void {
  if (!ids.has(id)) throw new TensionReadinessError('TENSION_PROFILE_INVALID_REFERENCE', `unknown ${kind} '${id}'`, path, { id, kind });
}

function parseInterest(value: unknown, index: number): InterestConflict {
  const path = `interestConflicts[${index}]`;
  const record = object(value, path, ['id', 'participantCharacterIds', 'description', 'stakes']);
  return {
    id: string(record.id, `${path}.id`),
    participantCharacterIds: strings(record.participantCharacterIds, `${path}.participantCharacterIds`, 2),
    description: string(record.description, `${path}.description`),
    stakes: string(record.stakes, `${path}.stakes`),
  };
}

function parseResource(value: unknown, index: number): ResourceDependency {
  const path = `resourceDependencies[${index}]`;
  const record = object(value, path, ['id', 'dependentCharacterId', 'providerCharacterId', 'resourceOrDebt', 'description']);
  const parsed = {
    id: string(record.id, `${path}.id`),
    dependentCharacterId: string(record.dependentCharacterId, `${path}.dependentCharacterId`),
    providerCharacterId: string(record.providerCharacterId, `${path}.providerCharacterId`),
    resourceOrDebt: string(record.resourceOrDebt, `${path}.resourceOrDebt`),
    description: string(record.description, `${path}.description`),
  };
  if (parsed.dependentCharacterId === parsed.providerCharacterId) throw new TensionReadinessError('TENSION_PROFILE_INVALID_REFERENCE', 'dependency parties must differ', path);
  return parsed;
}

function parseEmotion(value: unknown, index: number): EmotionalTension {
  const path = `emotionalTensions[${index}]`;
  const record = object(value, path, ['id', 'participantCharacterIds', 'description']);
  return {
    id: string(record.id, `${path}.id`),
    participantCharacterIds: strings(record.participantCharacterIds, `${path}.participantCharacterIds`, 2),
    description: string(record.description, `${path}.description`),
  };
}

function parseMisunderstanding(value: unknown): SharedMisunderstanding {
  const path = 'sharedMisunderstanding';
  const record = object(value, path, ['historyId', 'believingCharacterIds', 'mistakenBelief']);
  return {
    historyId: string(record.historyId, `${path}.historyId`),
    believingCharacterIds: strings(record.believingCharacterIds, `${path}.believingCharacterIds`, 1),
    mistakenBelief: string(record.mistakenBelief, `${path}.mistakenBelief`),
  };
}

function parseArc(value: unknown, index: number): LaunchableArcCandidate {
  const path = `launchableArcs[${index}]`;
  const record = object(value, path, ['id', 'title', 'premise', 'currentQuestion', 'coreCharacterIds', 'launchTrigger']);
  return {
    id: string(record.id, `${path}.id`),
    title: string(record.title, `${path}.title`),
    premise: string(record.premise, `${path}.premise`),
    currentQuestion: string(record.currentQuestion, `${path}.currentQuestion`),
    coreCharacterIds: strings(record.coreCharacterIds, `${path}.coreCharacterIds`, 2),
    launchTrigger: string(record.launchTrigger, `${path}.launchTrigger`),
  };
}

export function parseInitialTensionProfile(value: unknown, evidence: TensionEvidence): InitialTensionProfileV1 {
  const root = object(value, '$', ['schemaVersion', 'worldId', 'interestConflicts', 'resourceDependencies', 'emotionalTensions', 'sharedMisunderstanding', 'launchableArcs']);
  if (root.schemaVersion !== TENSION_PROFILE_SCHEMA_VERSION) throw new TensionReadinessError('TENSION_PROFILE_UNSUPPORTED_VERSION', 'only tension profile schemaVersion 1 is supported', 'schemaVersion');
  const worldId = string(root.worldId, 'worldId');
  if (worldId !== evidence.worldId) throw new TensionReadinessError('TENSION_PROFILE_INVALID_REFERENCE', 'profile world does not match seeded evidence', 'worldId');
  const interestConflicts = unique(array(root.interestConflicts, 'interestConflicts').map(parseInterest), 'interestConflicts');
  const resourceDependencies = unique(array(root.resourceDependencies, 'resourceDependencies').map(parseResource), 'resourceDependencies');
  const emotionalTensions = unique(array(root.emotionalTensions, 'emotionalTensions').map(parseEmotion), 'emotionalTensions');
  const sharedMisunderstanding = root.sharedMisunderstanding === null ? null : parseMisunderstanding(root.sharedMisunderstanding);
  const launchableArcs = unique(array(root.launchableArcs, 'launchableArcs').map(parseArc), 'launchableArcs');
  const characterIds = new Set(evidence.characterIds);
  const historyIds = new Set(evidence.historyIds);
  interestConflicts.forEach((conflict, index) => conflict.participantCharacterIds.forEach((id, refIndex) => reference(id, characterIds, `interestConflicts[${index}].participantCharacterIds[${refIndex}]`, 'character')));
  resourceDependencies.forEach((dependency, index) => {
    reference(dependency.dependentCharacterId, characterIds, `resourceDependencies[${index}].dependentCharacterId`, 'character');
    reference(dependency.providerCharacterId, characterIds, `resourceDependencies[${index}].providerCharacterId`, 'character');
  });
  emotionalTensions.forEach((tension, index) => tension.participantCharacterIds.forEach((id, refIndex) => reference(id, characterIds, `emotionalTensions[${index}].participantCharacterIds[${refIndex}]`, 'character')));
  if (sharedMisunderstanding) {
    reference(sharedMisunderstanding.historyId, historyIds, 'sharedMisunderstanding.historyId', 'history');
    sharedMisunderstanding.believingCharacterIds.forEach((id, index) => reference(id, characterIds, `sharedMisunderstanding.believingCharacterIds[${index}]`, 'character'));
  }
  launchableArcs.forEach((arc, index) => arc.coreCharacterIds.forEach((id, refIndex) => reference(id, characterIds, `launchableArcs[${index}].coreCharacterIds[${refIndex}]`, 'character')));
  return { schemaVersion: 1, worldId, interestConflicts, resourceDependencies, emotionalTensions, sharedMisunderstanding, launchableArcs };
}

function check(key: ReadinessCheckKey, actual: number, evidenceIds: string[]): ReadinessCheck {
  const required = READINESS_THRESHOLDS[key];
  return { key, required, actual, missingBy: Math.max(0, required - actual), passed: actual >= required, evidenceIds: [...evidenceIds] };
}

export function evaluateTensionReadiness(profile: InitialTensionProfileV1, evidence: TensionEvidence, evaluatedAt: number): TensionReadinessReport {
  if (!Number.isSafeInteger(evaluatedAt) || evaluatedAt < 0) throw new TensionReadinessError('TENSION_PROFILE_INVALID_SHAPE', 'evaluatedAt must be a non-negative safe integer', 'evaluatedAt');
  const allCharacters = new Set(evidence.characterIds);
  const sharedIsTownWide = profile.sharedMisunderstanding !== null
    && profile.sharedMisunderstanding.believingCharacterIds.length === allCharacters.size
    && profile.sharedMisunderstanding.believingCharacterIds.every((id) => allCharacters.has(id));
  const checks = [
    check('interestConflicts', profile.interestConflicts.length, profile.interestConflicts.map((item) => item.id)),
    check('privateSecrets', evidence.privateSecretIds.length, evidence.privateSecretIds),
    check('resourceDependencies', profile.resourceDependencies.length, profile.resourceDependencies.map((item) => item.id)),
    check('misconceptions', evidence.misconceptionKnowledgeIds.length, evidence.misconceptionKnowledgeIds),
    check('emotionalTensions', profile.emotionalTensions.length, profile.emotionalTensions.map((item) => item.id)),
    check('sharedMisunderstanding', sharedIsTownWide ? 1 : 0, sharedIsTownWide && profile.sharedMisunderstanding ? [profile.sharedMisunderstanding.historyId] : []),
    check('launchableMainArcs', profile.launchableArcs.length, profile.launchableArcs.map((item) => item.id)),
  ];
  const deficits = checks.filter((item) => !item.passed).map((item) => ({
    key: item.key,
    required: item.required,
    actual: item.actual,
    missingBy: item.missingBy,
    message: `${item.key} requires ${item.required}; found ${item.actual}; add ${item.missingBy}`,
  }));
  return {
    reportVersion: 1,
    profileVersion: profile.schemaVersion,
    worldId: profile.worldId,
    evaluatedAt,
    readyForWarmup: deficits.length === 0,
    checks,
    deficits,
  };
}

export function assertWarmupReady(report: TensionReadinessReport | null): TensionReadinessReport {
  if (!report?.readyForWarmup) {
    throw new TensionReadinessError('WORLD_NOT_READY_FOR_WARMUP', 'world has not passed initial tension readiness', 'readinessReport', {
      deficits: report?.deficits ?? [{ message: 'No readiness report exists.' }],
    });
  }
  return report;
}

export interface TensionReadinessStore {
  loadEvidence(worldId: string): Promise<TensionEvidence | null>;
  saveAtomically(profile: InitialTensionProfileV1, report: TensionReadinessReport): Promise<void>;
  latestReport(worldId: string): Promise<TensionReadinessReport | null>;
}

export async function evaluateAndStoreTensionReadiness(store: TensionReadinessStore, value: unknown, evaluatedAt: number): Promise<TensionReadinessReport> {
  const untrusted = object(value, '$', ['schemaVersion', 'worldId', 'interestConflicts', 'resourceDependencies', 'emotionalTensions', 'sharedMisunderstanding', 'launchableArcs']);
  const worldId = string(untrusted.worldId, 'worldId');
  const evidence = await store.loadEvidence(worldId);
  if (!evidence) throw new TensionReadinessError('TENSION_EVIDENCE_NOT_FOUND', `seed evidence for world '${worldId}' does not exist`, 'worldId');
  const profile = parseInitialTensionProfile(value, evidence);
  const report = evaluateTensionReadiness(profile, evidence, evaluatedAt);
  await store.saveAtomically(profile, report);
  return report;
}

function convexStore(ctx: GenericMutationCtx<DataModel>): TensionReadinessStore {
  return {
    async loadEvidence(worldId) {
      const [characters, secrets, knowledge, history] = await Promise.all([
        ctx.db.query('worldCharacters').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
        ctx.db.query('worldSecrets').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
        ctx.db.query('worldCharacterKnowledge').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
        ctx.db.query('worldHistory').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
      ]);
      if (characters.length === 0) return null;
      return {
        worldId,
        characterIds: characters.map((row) => row.characterId),
        privateSecretIds: secrets.map((row) => row.secretId),
        misconceptionKnowledgeIds: knowledge
          .filter((row) => (row.payload as SeedKnowledge).truthStatus === 'false')
          .map((row) => row.knowledgeId),
        historyIds: history.map((row) => row.historyId),
      };
    },
    async saveAtomically(profile, report) {
      await ctx.db.insert('worldTensionProfiles', { worldId: profile.worldId, schemaVersion: profile.schemaVersion, payload: profile, evaluatedAt: report.evaluatedAt });
      await ctx.db.insert('worldTensionReadinessReports', { worldId: report.worldId, readyForWarmup: report.readyForWarmup, evaluatedAt: report.evaluatedAt, payload: report });
    },
    async latestReport(worldId) {
      const row = await ctx.db.query('worldTensionReadinessReports').withIndex('by_world_and_time', (q) => q.eq('worldId', worldId)).order('desc').first();
      return row ? row.payload as TensionReadinessReport : null;
    },
  };
}

export const evaluateWorldTensionReadiness = internalMutation({
  args: { profile: v.any() },
  handler: async (ctx, { profile }): Promise<TensionReadinessReport> => evaluateAndStoreTensionReadiness(convexStore(ctx), profile, Date.now()),
});

/** Administrator/server-only read of the latest detailed readiness result. */
export const getTensionReadinessReport = internalQuery({
  args: { worldId: v.string() },
  handler: async (ctx, { worldId }): Promise<TensionReadinessReport | null> => {
    const row = await ctx.db.query('worldTensionReadinessReports').withIndex('by_world_and_time', (q) => q.eq('worldId', worldId)).order('desc').first();
    return row ? row.payload as TensionReadinessReport : null;
  },
});

/** Mandatory server-side guard to be called by the ART-8 warmup workflow. */
export const requireWarmupReadiness = internalQuery({
  args: { worldId: v.string() },
  handler: async (ctx, { worldId }): Promise<TensionReadinessReport> => {
    const row = await ctx.db.query('worldTensionReadinessReports').withIndex('by_world_and_time', (q) => q.eq('worldId', worldId)).order('desc').first();
    return assertWarmupReady(row ? row.payload as TensionReadinessReport : null);
  },
});

export class InMemoryTensionReadinessStore implements TensionReadinessStore {
  private reports: TensionReadinessReport[] = [];
  private profiles: InitialTensionProfileV1[] = [];
  constructor(private readonly evidence: TensionEvidence | null) {}
  loadEvidence(worldId: string): Promise<TensionEvidence | null> { return Promise.resolve(this.evidence?.worldId === worldId ? { ...this.evidence, characterIds: [...this.evidence.characterIds], privateSecretIds: [...this.evidence.privateSecretIds], misconceptionKnowledgeIds: [...this.evidence.misconceptionKnowledgeIds], historyIds: [...this.evidence.historyIds] } : null); }
  saveAtomically(profile: InitialTensionProfileV1, report: TensionReadinessReport): Promise<void> { this.profiles.push(profile); this.reports.push(report); return Promise.resolve(); }
  latestReport(worldId: string): Promise<TensionReadinessReport | null> { return Promise.resolve([...this.reports].reverse().find((report) => report.worldId === worldId) ?? null); }
}
