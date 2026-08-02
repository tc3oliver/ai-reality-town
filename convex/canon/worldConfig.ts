/** Versioned, atomic world-configuration import for AI Reality Town. */

import { internalMutation, internalQuery } from '../_generated/server';
import { v } from 'convex/values';
import { isEventType } from './eventTypes';
import { emptyProjection, type CanonImmutableRule, type CanonRuleContext, type WorldProjection } from './model';
import type { CanonSnapshot } from './snapshots';

export const WORLD_CONFIGURATION_SCHEMA_VERSION = 1;

export type WorldDefinition = {
  id: string;
  name: string;
  description: string;
  background: string;
  era: string;
  technologyLevel: string;
  geographyRules: string[];
  socialRules: string[];
  laws: string[];
  taboos: string[];
  startDate: string;
};

export type WorldLocationDefinition = {
  id: string;
  name: string;
  description: string;
  type: string;
  capacity: number;
  connectedLocationIds: string[];
  active: boolean;
};

export type WorldOrganizationDefinition = {
  id: string;
  name: string;
  description: string;
  type: string;
  headquartersLocationId?: string;
};

export type WorldHistoryDefinition = {
  id: string;
  title: string;
  summary: string;
  occurredOn: string;
  locationIds: string[];
  organizationIds: string[];
};

export type WorldConfigurationV1 = {
  schemaVersion: 1;
  contentDeclaration: {
    fictionalWorld: true;
    containsRealPersonData: false;
  };
  world: WorldDefinition;
  locations: WorldLocationDefinition[];
  organizations: WorldOrganizationDefinition[];
  immutableRules: CanonImmutableRule[];
  history: WorldHistoryDefinition[];
};

export type WorldImportPlan = {
  configuration: WorldConfigurationV1;
  initialSnapshot: CanonSnapshot;
};

export type WorldImportResult = {
  worldId: string;
  locationCount: number;
  organizationCount: number;
  immutableRuleCount: number;
  historyCount: number;
  initialSnapshotSequence: -1;
};

export type WorldImportErrorCode =
  | 'WORLD_CONFIG_INVALID_SHAPE'
  | 'WORLD_CONFIG_UNSUPPORTED_VERSION'
  | 'WORLD_CONFIG_INVALID_REFERENCE'
  | 'WORLD_CONFIG_DUPLICATE_ID'
  | 'WORLD_CONFIG_NOT_FICTIONAL'
  | 'WORLD_ALREADY_EXISTS';

export class WorldImportError extends Error {
  readonly code: WorldImportErrorCode;
  readonly path?: string;
  readonly details?: Record<string, unknown>;

  constructor(code: WorldImportErrorCode, message: string, path?: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'WorldImportError';
    this.code = code;
    this.path = path;
    this.details = details;
  }
}

type PlainObject = Record<string, unknown>;

function object(value: unknown, path: string, keys: readonly string[]): PlainObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorldImportError('WORLD_CONFIG_INVALID_SHAPE', 'must be an object', path);
  }
  const record = value as PlainObject;
  const unknown = Object.keys(record).filter((key) => !keys.includes(key));
  if (unknown.length) {
    throw new WorldImportError('WORLD_CONFIG_INVALID_SHAPE', 'contains unknown fields', path, { fields: unknown });
  }
  return record;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new WorldImportError('WORLD_CONFIG_INVALID_SHAPE', 'must be a non-empty string', path);
  }
  return value;
}

function strings(value: unknown, path: string, options: { nonEmpty?: boolean } = {}): string[] {
  if (!Array.isArray(value) || (options.nonEmpty && value.length === 0)) {
    throw new WorldImportError('WORLD_CONFIG_INVALID_SHAPE', 'must be an array of strings', path);
  }
  const parsed = value.map((entry, index) => string(entry, `${path}[${index}]`));
  if (new Set(parsed).size !== parsed.length) {
    throw new WorldImportError('WORLD_CONFIG_DUPLICATE_ID', 'must not contain duplicates', path);
  }
  return parsed;
}

function date(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed) || Number.isNaN(Date.parse(`${parsed}T00:00:00Z`))) {
    throw new WorldImportError('WORLD_CONFIG_INVALID_SHAPE', 'must be an ISO date (YYYY-MM-DD)', path);
  }
  return parsed;
}

function uniqueById<T extends { id: string }>(values: T[], path: string): T[] {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) throw new WorldImportError('WORLD_CONFIG_DUPLICATE_ID', `duplicate id '${value.id}'`, path);
    ids.add(value.id);
  }
  return values;
}

function reference(id: string, ids: Set<string>, path: string, kind: string): void {
  if (!ids.has(id)) {
    throw new WorldImportError('WORLD_CONFIG_INVALID_REFERENCE', `unknown ${kind} '${id}'`, path, { id, kind });
  }
}

function parseWorld(value: unknown): WorldDefinition {
  const path = 'world';
  const record = object(value, path, [
    'id', 'name', 'description', 'background', 'era', 'technologyLevel', 'geographyRules',
    'socialRules', 'laws', 'taboos', 'startDate',
  ]);
  return {
    id: string(record.id, `${path}.id`),
    name: string(record.name, `${path}.name`),
    description: string(record.description, `${path}.description`),
    background: string(record.background, `${path}.background`),
    era: string(record.era, `${path}.era`),
    technologyLevel: string(record.technologyLevel, `${path}.technologyLevel`),
    geographyRules: strings(record.geographyRules, `${path}.geographyRules`, { nonEmpty: true }),
    socialRules: strings(record.socialRules, `${path}.socialRules`, { nonEmpty: true }),
    laws: strings(record.laws, `${path}.laws`, { nonEmpty: true }),
    taboos: strings(record.taboos, `${path}.taboos`, { nonEmpty: true }),
    startDate: date(record.startDate, `${path}.startDate`),
  };
}

function parseLocation(value: unknown, index: number): WorldLocationDefinition {
  const path = `locations[${index}]`;
  const record = object(value, path, ['id', 'name', 'description', 'type', 'capacity', 'connectedLocationIds', 'active']);
  if (!Number.isSafeInteger(record.capacity) || (record.capacity as number) < 1) {
    throw new WorldImportError('WORLD_CONFIG_INVALID_SHAPE', 'must be a positive safe integer', `${path}.capacity`);
  }
  if (typeof record.active !== 'boolean') {
    throw new WorldImportError('WORLD_CONFIG_INVALID_SHAPE', 'must be a boolean', `${path}.active`);
  }
  return {
    id: string(record.id, `${path}.id`),
    name: string(record.name, `${path}.name`),
    description: string(record.description, `${path}.description`),
    type: string(record.type, `${path}.type`),
    capacity: record.capacity as number,
    connectedLocationIds: strings(record.connectedLocationIds, `${path}.connectedLocationIds`),
    active: record.active,
  };
}

function parseOrganization(value: unknown, index: number): WorldOrganizationDefinition {
  const path = `organizations[${index}]`;
  const record = object(value, path, ['id', 'name', 'description', 'type', 'headquartersLocationId']);
  return {
    id: string(record.id, `${path}.id`),
    name: string(record.name, `${path}.name`),
    description: string(record.description, `${path}.description`),
    type: string(record.type, `${path}.type`),
    headquartersLocationId: record.headquartersLocationId === undefined
      ? undefined
      : string(record.headquartersLocationId, `${path}.headquartersLocationId`),
  };
}

function parseRule(value: unknown, index: number): CanonImmutableRule {
  const path = `immutableRules[${index}]`;
  const record = object(value, path, ['id', 'description', 'enforcement']);
  const enforcement = object(record.enforcement, `${path}.enforcement`, ['type', 'eventType', 'maximum']);
  const type = string(enforcement.type, `${path}.enforcement.type`);
  let parsed: CanonImmutableRule['enforcement'];
  if (type === 'narrative_only') {
    if (enforcement.eventType !== undefined || enforcement.maximum !== undefined) {
      throw new WorldImportError('WORLD_CONFIG_INVALID_SHAPE', 'narrative_only has no parameters', `${path}.enforcement`);
    }
    parsed = { type };
  } else if (type === 'forbid_event_type') {
    if (!isEventType(enforcement.eventType)) {
      throw new WorldImportError('WORLD_CONFIG_INVALID_SHAPE', 'must name a supported event type', `${path}.enforcement.eventType`);
    }
    if (enforcement.maximum !== undefined) {
      throw new WorldImportError('WORLD_CONFIG_INVALID_SHAPE', 'forbid_event_type does not accept maximum', `${path}.enforcement.maximum`);
    }
    parsed = { type, eventType: enforcement.eventType };
  } else if (type === 'max_event_participants') {
    if (!Number.isSafeInteger(enforcement.maximum) || (enforcement.maximum as number) < 1) {
      throw new WorldImportError('WORLD_CONFIG_INVALID_SHAPE', 'must be a positive safe integer', `${path}.enforcement.maximum`);
    }
    if (enforcement.eventType !== undefined) {
      throw new WorldImportError('WORLD_CONFIG_INVALID_SHAPE', 'max_event_participants does not accept eventType', `${path}.enforcement.eventType`);
    }
    parsed = { type, maximum: enforcement.maximum as number };
  } else {
    throw new WorldImportError('WORLD_CONFIG_INVALID_SHAPE', `unsupported enforcement type '${type}'`, `${path}.enforcement.type`);
  }
  return { id: string(record.id, `${path}.id`), description: string(record.description, `${path}.description`), enforcement: parsed };
}

function parseHistory(value: unknown, index: number): WorldHistoryDefinition {
  const path = `history[${index}]`;
  const record = object(value, path, ['id', 'title', 'summary', 'occurredOn', 'locationIds', 'organizationIds']);
  return {
    id: string(record.id, `${path}.id`),
    title: string(record.title, `${path}.title`),
    summary: string(record.summary, `${path}.summary`),
    occurredOn: date(record.occurredOn, `${path}.occurredOn`),
    locationIds: strings(record.locationIds, `${path}.locationIds`),
    organizationIds: strings(record.organizationIds, `${path}.organizationIds`),
  };
}

/** Parse and cross-reference a complete configuration before any write is attempted. */
export function parseWorldConfiguration(value: unknown): WorldConfigurationV1 {
  const root = object(value, '$', ['schemaVersion', 'contentDeclaration', 'world', 'locations', 'organizations', 'immutableRules', 'history']);
  if (root.schemaVersion !== WORLD_CONFIGURATION_SCHEMA_VERSION) {
    throw new WorldImportError('WORLD_CONFIG_UNSUPPORTED_VERSION', 'only world configuration schemaVersion 1 is supported', 'schemaVersion');
  }
  const declaration = object(root.contentDeclaration, 'contentDeclaration', ['fictionalWorld', 'containsRealPersonData']);
  if (declaration.fictionalWorld !== true || declaration.containsRealPersonData !== false) {
    throw new WorldImportError('WORLD_CONFIG_NOT_FICTIONAL', 'imports must attest a fictional world with no real-person data', 'contentDeclaration');
  }
  if (!Array.isArray(root.locations) || root.locations.length === 0) throw new WorldImportError('WORLD_CONFIG_INVALID_SHAPE', 'must contain at least one location', 'locations');
  if (!Array.isArray(root.organizations) || root.organizations.length === 0) throw new WorldImportError('WORLD_CONFIG_INVALID_SHAPE', 'must contain at least one organization', 'organizations');
  if (!Array.isArray(root.immutableRules) || root.immutableRules.length === 0) throw new WorldImportError('WORLD_CONFIG_INVALID_SHAPE', 'must contain at least one immutable rule', 'immutableRules');
  if (!Array.isArray(root.history) || root.history.length === 0) throw new WorldImportError('WORLD_CONFIG_INVALID_SHAPE', 'must contain at least one history entry', 'history');
  const world = parseWorld(root.world);
  const locations = uniqueById(root.locations.map(parseLocation), 'locations');
  const organizations = uniqueById(root.organizations.map(parseOrganization), 'organizations');
  const immutableRules = uniqueById(root.immutableRules.map(parseRule), 'immutableRules');
  const history = uniqueById(root.history.map(parseHistory), 'history');
  const locationIds = new Set(locations.map((location) => location.id));
  const organizationIds = new Set(organizations.map((organization) => organization.id));
  locations.forEach((location, index) => location.connectedLocationIds.forEach((id, refIndex) => {
    reference(id, locationIds, `locations[${index}].connectedLocationIds[${refIndex}]`, 'location');
    if (id === location.id) throw new WorldImportError('WORLD_CONFIG_INVALID_REFERENCE', 'location cannot connect to itself', `locations[${index}].connectedLocationIds[${refIndex}]`);
  }));
  organizations.forEach((organization, index) => {
    if (organization.headquartersLocationId) reference(organization.headquartersLocationId, locationIds, `organizations[${index}].headquartersLocationId`, 'location');
  });
  history.forEach((entry, index) => {
    if (entry.occurredOn > world.startDate) {
      throw new WorldImportError('WORLD_CONFIG_INVALID_REFERENCE', 'initial history cannot occur after the world start date', `history[${index}].occurredOn`, {
        occurredOn: entry.occurredOn,
        worldStartDate: world.startDate,
      });
    }
    entry.locationIds.forEach((id, refIndex) => reference(id, locationIds, `history[${index}].locationIds[${refIndex}]`, 'location'));
    entry.organizationIds.forEach((id, refIndex) => reference(id, organizationIds, `history[${index}].organizationIds[${refIndex}]`, 'organization'));
  });
  return {
    schemaVersion: 1,
    contentDeclaration: { fictionalWorld: true, containsRealPersonData: false },
    world, locations, organizations, immutableRules, history,
  };
}

export function buildWorldImportPlan(value: unknown, createdAt: number): WorldImportPlan {
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new WorldImportError('WORLD_CONFIG_INVALID_SHAPE', 'createdAt must be a non-negative safe integer', 'createdAt');
  const configuration = parseWorldConfiguration(value);
  const projection: WorldProjection = emptyProjection(configuration.world.id);
  return {
    configuration,
    initialSnapshot: { worldId: configuration.world.id, lastSequenceNumber: -1, projection, createdAt },
  };
}

export function canonRuleContextFromConfiguration(configuration: WorldConfigurationV1): CanonRuleContext {
  return { worldId: configuration.world.id, rules: configuration.immutableRules.map((rule) => ({ ...rule, enforcement: { ...rule.enforcement } })) };
}

export interface AtomicWorldImportStore {
  worldExists(worldId: string): Promise<boolean>;
  commitAtomically(plan: WorldImportPlan): Promise<void>;
}

export async function importWorldConfiguration(store: AtomicWorldImportStore, value: unknown, createdAt: number): Promise<WorldImportResult> {
  const plan = buildWorldImportPlan(value, createdAt);
  if (await store.worldExists(plan.configuration.world.id)) {
    throw new WorldImportError('WORLD_ALREADY_EXISTS', `world '${plan.configuration.world.id}' already exists`, 'world.id');
  }
  await store.commitAtomically(plan);
  return {
    worldId: plan.configuration.world.id,
    locationCount: plan.configuration.locations.length,
    organizationCount: plan.configuration.organizations.length,
    immutableRuleCount: plan.configuration.immutableRules.length,
    historyCount: plan.configuration.history.length,
    initialSnapshotSequence: -1,
  };
}

/** Internal-only administrative import. Convex mutations are transactional: any throw rolls every insert back. */
export const importWorld = internalMutation({
  args: { configuration: v.any() },
  handler: async (ctx, { configuration }): Promise<WorldImportResult> => importWorldConfiguration({
    async worldExists(worldId) {
      return (await ctx.db.query('worldDefinitions').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).unique()) !== null;
    },
    async commitAtomically(plan) {
      const worldId = plan.configuration.world.id;
      await ctx.db.insert('worldDefinitions', { worldId, schemaVersion: plan.configuration.schemaVersion, payload: plan.configuration.world, contentDeclaration: plan.configuration.contentDeclaration });
      for (const payload of plan.configuration.locations) await ctx.db.insert('worldLocations', { worldId, locationId: payload.id, payload });
      for (const payload of plan.configuration.organizations) await ctx.db.insert('worldOrganizations', { worldId, organizationId: payload.id, payload });
      for (const payload of plan.configuration.immutableRules) await ctx.db.insert('worldImmutableRules', { worldId, ruleId: payload.id, payload });
      for (const payload of plan.configuration.history) await ctx.db.insert('worldHistory', { worldId, historyId: payload.id, payload });
      await ctx.db.insert('canonSnapshots', plan.initialSnapshot);
    },
  }, configuration, Date.now()),
});

/** Internal query consumed by operations/diagnostics; Canon commits read the same table directly. */
export const getCanonRuleContext = internalQuery({
  args: { worldId: v.string() },
  handler: async (ctx, { worldId }): Promise<CanonRuleContext> => {
    const rows = await ctx.db.query('worldImmutableRules').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect();
    return { worldId, rules: rows.map((row) => row.payload as CanonImmutableRule) };
  },
});

/** Atomic in-memory reference adapter with failure injection for offline rollback tests. */
export class InMemoryWorldImportStore implements AtomicWorldImportStore {
  private worlds = new Map<string, WorldImportPlan>();
  private failAfterWrite: number | null = null;

  injectFailureAfter(writeCount: number | null): void { this.failAfterWrite = writeCount; }
  worldExists(worldId: string): Promise<boolean> { return Promise.resolve(this.worlds.has(worldId)); }
  importedWorldIds(): string[] { return [...this.worlds.keys()]; }
  plan(worldId: string): WorldImportPlan | null { return this.worlds.get(worldId) ?? null; }

  commitAtomically(plan: WorldImportPlan): Promise<void> {
    const staged = new Map(this.worlds);
    let writes = 0;
    const write = (): void => {
      writes += 1;
      if (this.failAfterWrite !== null && writes >= this.failAfterWrite) throw new Error('INJECTED_WORLD_IMPORT_FAILURE');
    };
    write();
    for (const _ of plan.configuration.locations) write();
    for (const _ of plan.configuration.organizations) write();
    for (const _ of plan.configuration.immutableRules) write();
    for (const _ of plan.configuration.history) write();
    write();
    staged.set(plan.configuration.world.id, plan);
    this.worlds = staged;
    return Promise.resolve();
  }
}
