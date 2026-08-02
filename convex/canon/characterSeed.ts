/** Versioned, atomic primary-character seed import (FR-A002). */

import { internalMutation } from '../_generated/server';
import { v } from 'convex/values';

export const CHARACTER_SEED_SCHEMA_VERSION = 1;
export const MIN_PRIMARY_CHARACTERS = 12;
export const MAX_PRIMARY_CHARACTERS = 20;

export type SeedCharacter = {
  id: string;
  name: string;
  fictional: true;
  age: number;
  occupation: string;
  publicProfile: string;
  privateProfile: string;
  personalityTraits: string[];
  values: string[];
  publicGoal: string;
  privateGoal: string;
  fear: string;
  behaviorRules: string[];
  initialLocationId: string;
  organizationIds: string[];
  secretIds: string[];
};

export type SeedSecret = {
  id: string;
  content: string;
  initialKnowerCharacterIds: string[];
};

export type SeedKnowledge = {
  id: string;
  characterId: string;
  content: string;
  truthStatus: 'true' | 'false' | 'unknown';
  confidence: number;
  shareability: 'private' | 'trusted' | 'public';
};

export type SeedAsset = {
  id: string;
  name: string;
  description: string;
  type: string;
  ownerCharacterId: string;
};

export type SeedRelationship = {
  sourceCharacterId: string;
  targetCharacterId: string;
  trust: number;
  affection: number;
  resentment: number;
  fear: number;
  dependency: number;
  familiarity: number;
  visibility: 'private' | 'public';
};

export type CharacterSeedBundleV1 = {
  schemaVersion: 1;
  worldId: string;
  contentDeclaration: { fictionalCharacters: true; containsRealPersonData: false };
  characters: SeedCharacter[];
  secrets: SeedSecret[];
  knowledge: SeedKnowledge[];
  assets: SeedAsset[];
  relationships: SeedRelationship[];
};

export type CharacterSeedReferences = {
  worldExists: boolean;
  locationIds: string[];
  organizationIds: string[];
};

export type CharacterSeedPlan = { bundle: CharacterSeedBundleV1 };
export type CharacterSeedResult = {
  worldId: string;
  characterCount: number;
  secretCount: number;
  knowledgeCount: number;
  assetCount: number;
  relationshipCount: number;
};

export type CharacterSeedErrorCode =
  | 'CHARACTER_SEED_INVALID_SHAPE'
  | 'CHARACTER_SEED_UNSUPPORTED_VERSION'
  | 'CHARACTER_SEED_INVALID_REFERENCE'
  | 'CHARACTER_SEED_DUPLICATE_ID'
  | 'CHARACTER_SEED_INVALID_RELATIONSHIP'
  | 'CHARACTER_SEED_NOT_FICTIONAL'
  | 'CHARACTER_SEED_WORLD_NOT_FOUND'
  | 'CHARACTER_SEED_ALREADY_EXISTS';

export class CharacterSeedError extends Error {
  constructor(
    readonly code: CharacterSeedErrorCode,
    message: string,
    readonly path?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'CharacterSeedError';
  }
}

type RecordValue = Record<string, unknown>;

function object(value: unknown, path: string, allowed: readonly string[]): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CharacterSeedError('CHARACTER_SEED_INVALID_SHAPE', 'must be an object', path);
  }
  const record = value as RecordValue;
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new CharacterSeedError('CHARACTER_SEED_INVALID_SHAPE', 'contains unknown fields', path, { fields: unknown });
  return record;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CharacterSeedError('CHARACTER_SEED_INVALID_SHAPE', 'must be a non-empty string', path);
  }
  return value;
}

function strings(value: unknown, path: string, nonEmpty = false): string[] {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    throw new CharacterSeedError('CHARACTER_SEED_INVALID_SHAPE', 'must be an array of strings', path);
  }
  const result = value.map((entry, index) => string(entry, `${path}[${index}]`));
  if (new Set(result).size !== result.length) throw new CharacterSeedError('CHARACTER_SEED_DUPLICATE_ID', 'must not contain duplicates', path);
  return result;
}

function enumValue<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new CharacterSeedError('CHARACTER_SEED_INVALID_SHAPE', `must be one of: ${allowed.join(', ')}`, path);
  }
  return value as T;
}

function bounded(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new CharacterSeedError('CHARACTER_SEED_INVALID_SHAPE', `must be a finite number from ${minimum} to ${maximum}`, path);
  }
  return value;
}

function uniqueIds<T extends { id: string }>(values: T[], path: string): T[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) throw new CharacterSeedError('CHARACTER_SEED_DUPLICATE_ID', `duplicate id '${value.id}'`, path);
    seen.add(value.id);
  }
  return values;
}

function reference(value: string, ids: Set<string>, path: string, kind: string): void {
  if (!ids.has(value)) throw new CharacterSeedError('CHARACTER_SEED_INVALID_REFERENCE', `unknown ${kind} '${value}'`, path, { id: value, kind });
}

function parseCharacter(value: unknown, index: number): SeedCharacter {
  const path = `characters[${index}]`;
  const record = object(value, path, [
    'id', 'name', 'fictional', 'age', 'occupation', 'publicProfile', 'privateProfile',
    'personalityTraits', 'values', 'publicGoal', 'privateGoal', 'fear', 'behaviorRules',
    'initialLocationId', 'organizationIds', 'secretIds',
  ]);
  if (record.fictional !== true) throw new CharacterSeedError('CHARACTER_SEED_NOT_FICTIONAL', 'every default character must be explicitly fictional', `${path}.fictional`);
  if (!Number.isSafeInteger(record.age) || (record.age as number) < 18 || (record.age as number) > 120) {
    throw new CharacterSeedError('CHARACTER_SEED_INVALID_SHAPE', 'age must be an adult safe integer from 18 to 120', `${path}.age`);
  }
  return {
    id: string(record.id, `${path}.id`),
    name: string(record.name, `${path}.name`),
    fictional: true,
    age: record.age as number,
    occupation: string(record.occupation, `${path}.occupation`),
    publicProfile: string(record.publicProfile, `${path}.publicProfile`),
    privateProfile: string(record.privateProfile, `${path}.privateProfile`),
    personalityTraits: strings(record.personalityTraits, `${path}.personalityTraits`, true),
    values: strings(record.values, `${path}.values`, true),
    publicGoal: string(record.publicGoal, `${path}.publicGoal`),
    privateGoal: string(record.privateGoal, `${path}.privateGoal`),
    fear: string(record.fear, `${path}.fear`),
    behaviorRules: strings(record.behaviorRules, `${path}.behaviorRules`, true),
    initialLocationId: string(record.initialLocationId, `${path}.initialLocationId`),
    organizationIds: strings(record.organizationIds, `${path}.organizationIds`),
    secretIds: strings(record.secretIds, `${path}.secretIds`, true),
  };
}

function parseSecret(value: unknown, index: number): SeedSecret {
  const path = `secrets[${index}]`;
  const record = object(value, path, ['id', 'content', 'initialKnowerCharacterIds']);
  return {
    id: string(record.id, `${path}.id`),
    content: string(record.content, `${path}.content`),
    initialKnowerCharacterIds: strings(record.initialKnowerCharacterIds, `${path}.initialKnowerCharacterIds`, true),
  };
}

function parseKnowledge(value: unknown, index: number): SeedKnowledge {
  const path = `knowledge[${index}]`;
  const record = object(value, path, ['id', 'characterId', 'content', 'truthStatus', 'confidence', 'shareability']);
  return {
    id: string(record.id, `${path}.id`),
    characterId: string(record.characterId, `${path}.characterId`),
    content: string(record.content, `${path}.content`),
    truthStatus: enumValue(record.truthStatus, `${path}.truthStatus`, ['true', 'false', 'unknown'] as const),
    confidence: bounded(record.confidence, `${path}.confidence`, 0, 1),
    shareability: enumValue(record.shareability, `${path}.shareability`, ['private', 'trusted', 'public'] as const),
  };
}

function parseAsset(value: unknown, index: number): SeedAsset {
  const path = `assets[${index}]`;
  const record = object(value, path, ['id', 'name', 'description', 'type', 'ownerCharacterId']);
  return {
    id: string(record.id, `${path}.id`),
    name: string(record.name, `${path}.name`),
    description: string(record.description, `${path}.description`),
    type: string(record.type, `${path}.type`),
    ownerCharacterId: string(record.ownerCharacterId, `${path}.ownerCharacterId`),
  };
}

function parseRelationship(value: unknown, index: number): SeedRelationship {
  const path = `relationships[${index}]`;
  const record = object(value, path, [
    'sourceCharacterId', 'targetCharacterId', 'trust', 'affection', 'resentment', 'fear',
    'dependency', 'familiarity', 'visibility',
  ]);
  return {
    sourceCharacterId: string(record.sourceCharacterId, `${path}.sourceCharacterId`),
    targetCharacterId: string(record.targetCharacterId, `${path}.targetCharacterId`),
    trust: bounded(record.trust, `${path}.trust`, -100, 100),
    affection: bounded(record.affection, `${path}.affection`, -100, 100),
    resentment: bounded(record.resentment, `${path}.resentment`, -100, 100),
    fear: bounded(record.fear, `${path}.fear`, -100, 100),
    dependency: bounded(record.dependency, `${path}.dependency`, -100, 100),
    familiarity: bounded(record.familiarity, `${path}.familiarity`, 0, 100),
    visibility: enumValue(record.visibility, `${path}.visibility`, ['private', 'public'] as const),
  };
}

export function parseCharacterSeedBundle(value: unknown, references: CharacterSeedReferences): CharacterSeedBundleV1 {
  const root = object(value, '$', ['schemaVersion', 'worldId', 'contentDeclaration', 'characters', 'secrets', 'knowledge', 'assets', 'relationships']);
  if (root.schemaVersion !== CHARACTER_SEED_SCHEMA_VERSION) throw new CharacterSeedError('CHARACTER_SEED_UNSUPPORTED_VERSION', 'only character seed schemaVersion 1 is supported', 'schemaVersion');
  const worldId = string(root.worldId, 'worldId');
  if (!references.worldExists) throw new CharacterSeedError('CHARACTER_SEED_WORLD_NOT_FOUND', `world '${worldId}' does not exist`, 'worldId');
  const declaration = object(root.contentDeclaration, 'contentDeclaration', ['fictionalCharacters', 'containsRealPersonData']);
  if (declaration.fictionalCharacters !== true || declaration.containsRealPersonData !== false) {
    throw new CharacterSeedError('CHARACTER_SEED_NOT_FICTIONAL', 'seed must contain only fictional characters and no real-person data', 'contentDeclaration');
  }
  if (!Array.isArray(root.characters) || root.characters.length < MIN_PRIMARY_CHARACTERS || root.characters.length > MAX_PRIMARY_CHARACTERS) {
    throw new CharacterSeedError('CHARACTER_SEED_INVALID_SHAPE', `must contain ${MIN_PRIMARY_CHARACTERS}–${MAX_PRIMARY_CHARACTERS} primary characters`, 'characters');
  }
  for (const [key, candidate] of [['secrets', root.secrets], ['knowledge', root.knowledge], ['assets', root.assets], ['relationships', root.relationships]] as const) {
    if (!Array.isArray(candidate)) throw new CharacterSeedError('CHARACTER_SEED_INVALID_SHAPE', 'must be an array', key);
  }
  const characters = uniqueIds(root.characters.map(parseCharacter), 'characters');
  const secrets = uniqueIds((root.secrets as unknown[]).map(parseSecret), 'secrets');
  const knowledge = uniqueIds((root.knowledge as unknown[]).map(parseKnowledge), 'knowledge');
  const assets = uniqueIds((root.assets as unknown[]).map(parseAsset), 'assets');
  const relationships = (root.relationships as unknown[]).map(parseRelationship);
  const characterIds = new Set(characters.map((character) => character.id));
  const locationIds = new Set(references.locationIds);
  const organizationIds = new Set(references.organizationIds);
  const secretIds = new Set(secrets.map((secret) => secret.id));
  characters.forEach((character, index) => {
    reference(character.initialLocationId, locationIds, `characters[${index}].initialLocationId`, 'location');
    character.organizationIds.forEach((id, refIndex) => reference(id, organizationIds, `characters[${index}].organizationIds[${refIndex}]`, 'organization'));
    character.secretIds.forEach((id, refIndex) => reference(id, secretIds, `characters[${index}].secretIds[${refIndex}]`, 'secret'));
  });
  secrets.forEach((secret, index) => secret.initialKnowerCharacterIds.forEach((id, refIndex) => reference(id, characterIds, `secrets[${index}].initialKnowerCharacterIds[${refIndex}]`, 'character')));
  knowledge.forEach((entry, index) => reference(entry.characterId, characterIds, `knowledge[${index}].characterId`, 'character'));
  assets.forEach((asset, index) => reference(asset.ownerCharacterId, characterIds, `assets[${index}].ownerCharacterId`, 'character'));
  for (const [index, character] of characters.entries()) {
    const knowledgeCount = knowledge.filter((entry) => entry.characterId === character.id).length;
    const assetCount = assets.filter((asset) => asset.ownerCharacterId === character.id).length;
    if (knowledgeCount === 0) throw new CharacterSeedError('CHARACTER_SEED_INVALID_REFERENCE', 'every character must have initial knowledge', `characters[${index}]`);
    if (assetCount === 0) throw new CharacterSeedError('CHARACTER_SEED_INVALID_REFERENCE', 'every character must have an initial asset', `characters[${index}]`);
    for (const secretId of character.secretIds) {
      const secret = secrets.find((candidate) => candidate.id === secretId);
      if (!secret?.initialKnowerCharacterIds.includes(character.id)) {
        throw new CharacterSeedError('CHARACTER_SEED_INVALID_REFERENCE', 'a character must initially know each of their own secrets', `characters[${index}].secretIds`);
      }
    }
  }
  const relationshipKeys = new Set<string>();
  relationships.forEach((relationship, index) => {
    reference(relationship.sourceCharacterId, characterIds, `relationships[${index}].sourceCharacterId`, 'character');
    reference(relationship.targetCharacterId, characterIds, `relationships[${index}].targetCharacterId`, 'character');
    if (relationship.sourceCharacterId === relationship.targetCharacterId) {
      throw new CharacterSeedError('CHARACTER_SEED_INVALID_RELATIONSHIP', 'relationship source and target must differ', `relationships[${index}]`);
    }
    const key = `${relationship.sourceCharacterId}|${relationship.targetCharacterId}`;
    if (relationshipKeys.has(key)) throw new CharacterSeedError('CHARACTER_SEED_INVALID_RELATIONSHIP', `duplicate directional relationship '${key}'`, `relationships[${index}]`);
    relationshipKeys.add(key);
  });
  for (const [index, character] of characters.entries()) {
    if (!relationships.some((relationship) => relationship.sourceCharacterId === character.id || relationship.targetCharacterId === character.id)) {
      throw new CharacterSeedError('CHARACTER_SEED_INVALID_RELATIONSHIP', 'every character must participate in an initial relationship', `characters[${index}]`);
    }
  }
  return {
    schemaVersion: 1,
    worldId,
    contentDeclaration: { fictionalCharacters: true, containsRealPersonData: false },
    characters, secrets, knowledge, assets, relationships,
  };
}

export interface AtomicCharacterSeedStore {
  loadReferences(worldId: string): Promise<CharacterSeedReferences>;
  charactersExist(worldId: string): Promise<boolean>;
  commitAtomically(plan: CharacterSeedPlan): Promise<void>;
}

export async function seedCharacters(store: AtomicCharacterSeedStore, value: unknown): Promise<CharacterSeedResult> {
  const untrusted = object(value, '$', ['schemaVersion', 'worldId', 'contentDeclaration', 'characters', 'secrets', 'knowledge', 'assets', 'relationships']);
  const worldId = string(untrusted.worldId, 'worldId');
  const references = await store.loadReferences(worldId);
  const bundle = parseCharacterSeedBundle(value, references);
  if (await store.charactersExist(worldId)) throw new CharacterSeedError('CHARACTER_SEED_ALREADY_EXISTS', `characters already seeded for world '${worldId}'`, 'worldId');
  await store.commitAtomically({ bundle });
  return {
    worldId,
    characterCount: bundle.characters.length,
    secretCount: bundle.secrets.length,
    knowledgeCount: bundle.knowledge.length,
    assetCount: bundle.assets.length,
    relationshipCount: bundle.relationships.length,
  };
}

export const seedWorldCharacters = internalMutation({
  args: { bundle: v.any() },
  handler: async (ctx, { bundle }): Promise<CharacterSeedResult> => seedCharacters({
    async loadReferences(worldId) {
      const [world, locations, organizations] = await Promise.all([
        ctx.db.query('worldDefinitions').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).unique(),
        ctx.db.query('worldLocations').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
        ctx.db.query('worldOrganizations').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
      ]);
      return {
        worldExists: world !== null,
        locationIds: locations.map((row) => row.locationId),
        organizationIds: organizations.map((row) => row.organizationId),
      };
    },
    async charactersExist(worldId) {
      return (await ctx.db.query('worldCharacters').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).first()) !== null;
    },
    async commitAtomically(plan) {
      const { worldId } = plan.bundle;
      for (const payload of plan.bundle.characters) await ctx.db.insert('worldCharacters', { worldId, characterId: payload.id, payload });
      for (const payload of plan.bundle.secrets) await ctx.db.insert('worldSecrets', { worldId, secretId: payload.id, payload });
      for (const payload of plan.bundle.knowledge) await ctx.db.insert('worldCharacterKnowledge', { worldId, knowledgeId: payload.id, characterId: payload.characterId, payload });
      for (const payload of plan.bundle.assets) await ctx.db.insert('worldAssets', { worldId, assetId: payload.id, ownerCharacterId: payload.ownerCharacterId, payload });
      for (const payload of plan.bundle.relationships) await ctx.db.insert('worldSeedRelationships', { worldId, sourceCharacterId: payload.sourceCharacterId, targetCharacterId: payload.targetCharacterId, payload });
    },
  }, bundle),
});

export class InMemoryCharacterSeedStore implements AtomicCharacterSeedStore {
  private planValue: CharacterSeedPlan | null = null;
  private failureAfter: number | null = null;

  constructor(private readonly references: CharacterSeedReferences) {}
  injectFailureAfter(writeCount: number | null): void { this.failureAfter = writeCount; }
  loadReferences(): Promise<CharacterSeedReferences> { return Promise.resolve({ ...this.references, locationIds: [...this.references.locationIds], organizationIds: [...this.references.organizationIds] }); }
  charactersExist(): Promise<boolean> { return Promise.resolve(this.planValue !== null); }
  plan(): CharacterSeedPlan | null { return this.planValue; }
  commitAtomically(plan: CharacterSeedPlan): Promise<void> {
    let writes = 0;
    const write = (): void => {
      writes += 1;
      if (this.failureAfter !== null && writes >= this.failureAfter) throw new Error('INJECTED_CHARACTER_SEED_FAILURE');
    };
    for (const _ of plan.bundle.characters) write();
    for (const _ of plan.bundle.secrets) write();
    for (const _ of plan.bundle.knowledge) write();
    for (const _ of plan.bundle.assets) write();
    for (const _ of plan.bundle.relationships) write();
    this.planValue = plan;
    return Promise.resolve();
  }
}
