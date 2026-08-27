/**
 * The authorized FR-K005 configuration surface (ART-52).
 *
 * Handler-level, following the pattern `safetyOverrideFunctions.test.ts` established: the
 * registered `mutation`/`query`'s `_handler` runs against a hand-rolled in-memory `ctx`, so the
 * gate, the versioned append and the audit row are exercised as they actually run rather than as
 * they are declared.
 *
 * The unauthenticated case uses a `ctx` whose database THROWS on any access. That is the only
 * way to assert "authorize first" as a fact: a denial test against a working database proves the
 * caller got an error, not that the handler refused before it read anything.
 */

import {
  MODULE_MODEL_DEFAULTS,
  type ModuleModelSettings,
} from '../shared/moduleModelConfig';
import { OPS_CAPABILITY_MINIMUM_ROLE, OPS_UNAUTHORIZED } from './operatorAuthorization';
import {
  describeModuleModelDefaults,
  inspectModuleModelConfig,
  listModuleModelConfigVersions,
  setModuleModelConfig,
} from './moduleModelConfigFunctions';

const WORLD_ID = 'mistwood';
const NOW = 1_700_000_000_000;
const REASON = 'raise scene creativity for the festival arc';

type Registered = {
  isMutation?: boolean;
  isQuery?: boolean;
  isPublic?: boolean;
  isInternal?: boolean;
  _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

const write = setModuleModelConfig as unknown as Registered;
const inspect = inspectModuleModelConfig as unknown as Registered;
const history = listModuleModelConfigVersions as unknown as Registered;
const defaults = describeModuleModelDefaults as unknown as Registered;

const REGISTRY = JSON.stringify([
  { operatorId: 'op-admin', role: 'admin', subjects: [], token: 'correct-horse-battery-staple' },
  { operatorId: 'op-plain', role: 'operator', subjects: [], token: 'a-different-long-token-value' },
  { operatorId: 'op-read', role: 'viewer', subjects: [], token: 'a-third-distinct-token-value' },
]);

const ADMIN = { operatorId: 'op-admin', operatorToken: 'correct-horse-battery-staple' };
const OPERATOR = { operatorId: 'op-plain', operatorToken: 'a-different-long-token-value' };
const VIEWER = { operatorId: 'op-read', operatorToken: 'a-third-distinct-token-value' };

type Row = Record<string, unknown>;
type Tables = { moduleModelConfigs: Row[]; operatorAuditLog: Row[] };

/**
 * The slice of Convex these handlers use, copied from
 * `publicRead/episodeTimelineProjectionFunctions.test.ts`.
 *
 * Index constraints are `eq` chains, so filtering by the captured constraints reproduces them.
 * `version` ordering is modelled because `listModuleModelConfigVersions` reads the history with
 * `.order('desc')`, and insertion order and version order are exactly what diverge if the
 * commit protocol ever appends out of sequence.
 */
function memoryCtx(tables: Tables) {
  const db = {
    query(table: keyof Tables) {
      return {
        withIndex(_index: string, build?: (q: unknown) => unknown) {
          const constraints: Row = {};
          const builder = { eq(field: string, value: unknown) { constraints[field] = value; return builder; } };
          if (build) build(builder);
          const matched = (tables[table] ?? []).filter((row) =>
            Object.entries(constraints).every(([field, value]) => row[field] === value));
          const ascending = [...matched].sort((left, right) =>
            Number(left.version ?? left.at ?? 0) - Number(right.version ?? right.at ?? 0));
          const chain = (rows: Row[]) => ({
            order: (direction: 'asc' | 'desc') => chain(direction === 'desc' ? [...rows].reverse() : rows),
            take: (count: number) => Promise.resolve(rows.slice(0, count)),
            collect: () => Promise.resolve(rows),
            first: () => Promise.resolve(rows[0] ?? null),
            unique: () => Promise.resolve(rows[0] ?? null),
          });
          return chain(ascending);
        },
      };
    },
    insert(table: keyof Tables, row: Row) {
      const _id = `${table}:${(tables[table] ?? []).length}`;
      (tables[table] ??= []).push({ ...row, _id });
      return Promise.resolve(_id);
    },
    patch(id: string, patch: Row) {
      for (const rows of Object.values(tables)) {
        const row = rows.find((candidate) => candidate._id === id);
        if (row) Object.assign(row, patch);
      }
      return Promise.resolve();
    },
  };
  return { auth: { getUserIdentity: () => Promise.resolve(null) }, db };
}

/** A `ctx` whose database throws on any access, to prove the gate refuses before it reads. */
function anonymousCtx() {
  return {
    auth: { getUserIdentity: () => Promise.resolve(null) },
    db: new Proxy({}, {
      get(_target, property) {
        throw new Error(`unauthorized caller reached the database: .${String(property)}`);
      },
    }),
  };
}

const emptyTables = (): Tables => ({ moduleModelConfigs: [], operatorAuditLog: [] });

const writeArgs = (over: Partial<ModuleModelSettings> & Row = {}) => ({
  ...ADMIN,
  worldId: WORLD_ID,
  reason: REASON,
  module: 'scene_simulation',
  ...MODULE_MODEL_DEFAULTS.scene_simulation,
  now: NOW,
  ...over,
});

const withRegistry = () => {
  const prior = process.env.SIMULATION_OPS_OPERATORS;
  const priorIssuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
  beforeEach(() => {
    process.env.SIMULATION_OPS_OPERATORS = REGISTRY;
    delete process.env.CLERK_JWT_ISSUER_DOMAIN;
  });
  afterEach(() => {
    if (prior === undefined) delete process.env.SIMULATION_OPS_OPERATORS;
    else process.env.SIMULATION_OPS_OPERATORS = prior;
    if (priorIssuer === undefined) delete process.env.CLERK_JWT_ISSUER_DOMAIN;
    else process.env.CLERK_JWT_ISSUER_DOMAIN = priorIssuer;
  });
};

// ---------------------------------------------------------------------------

describe('AC#2 — every setting change is authorized', () => {
  withRegistry();

  it('exposes a public mutation and three public queries, so the gate is the only thing between a client and the table', () => {
    expect(write.isMutation).toBe(true);
    expect(write.isPublic).toBe(true);
    expect(write.isInternal).toBeFalsy();
    for (const registered of [inspect, history, defaults]) {
      expect(registered.isQuery).toBe(true);
      expect(registered.isPublic).toBe(true);
    }
  });

  it('refuses an unauthenticated caller before reading a single row', async () => {
    await expect(write._handler(anonymousCtx(), {
      worldId: WORLD_ID, reason: REASON, module: 'scene_simulation',
      ...MODULE_MODEL_DEFAULTS.scene_simulation, now: NOW,
    })).rejects.toThrow(OPS_UNAUTHORIZED);
    await expect(inspect._handler(anonymousCtx(), { worldId: WORLD_ID }))
      .rejects.toThrow(OPS_UNAUTHORIZED);
  });

  it('refuses an unknown principal with the identical uniform denial', async () => {
    const tables = emptyTables();
    await expect(write._handler(memoryCtx(tables), writeArgs({
      operatorId: 'op-ghost', operatorToken: 'a-token-that-is-not-in-the-registry',
    }))).rejects.toThrow(OPS_UNAUTHORIZED);
    expect(tables.moduleModelConfigs).toHaveLength(0);
    expect(tables.operatorAuditLog).toHaveLength(0);
  });

  it('reserves writing for `admin` — an `operator` who may pause the world may not change the model', async () => {
    expect(OPS_CAPABILITY_MINIMUM_ROLE['model_config.write']).toBe('admin');
    const tables = emptyTables();
    await expect(write._handler(memoryCtx(tables), writeArgs(OPERATOR)))
      .rejects.toThrow(OPS_UNAUTHORIZED);
    expect(tables.moduleModelConfigs).toHaveLength(0);
  });

  it('lets a `viewer` read the configuration without the authority to change it', async () => {
    expect(OPS_CAPABILITY_MINIMUM_ROLE['model_config.inspect']).toBe('viewer');
    const tables = emptyTables();
    await expect(inspect._handler(memoryCtx(tables), { ...VIEWER, worldId: WORLD_ID })).resolves.toBeDefined();
    await expect(write._handler(memoryCtx(tables), writeArgs(VIEWER))).rejects.toThrow(OPS_UNAUTHORIZED);
  });
});

describe('AC#2 — every setting change is auditable and versioned', () => {
  withRegistry();

  it('writes exactly one audit row per applied change, in the same transaction', async () => {
    const tables = emptyTables();
    await write._handler(memoryCtx(tables), writeArgs({ temperature: 0.9 }));
    expect(tables.moduleModelConfigs).toHaveLength(1);
    expect(tables.operatorAuditLog).toHaveLength(1);
    expect(tables.operatorAuditLog[0]).toMatchObject({
      worldId: WORLD_ID,
      operatorId: 'op-admin',
      role: 'admin',
      capability: 'model_config.write',
      target: 'scene_simulation:v1',
      reason: REASON,
      outcome: 'applied',
      resultCode: 'OPS_OK',
      at: NOW,
    });
  });

  it('appends a new version rather than editing the stored one', async () => {
    const tables = emptyTables();
    await write._handler(memoryCtx(tables), writeArgs({ temperature: 0.4 }));
    await write._handler(memoryCtx(tables), writeArgs({ temperature: 0.9 }));
    expect(tables.moduleModelConfigs.map((row) => [row.version, row.temperature, row.isCurrent]))
      .toEqual([[1, 0.4, false], [2, 0.9, true]]);
    expect(tables.moduleModelConfigs.filter((row) => row.isCurrent)).toHaveLength(1);
  });

  it('deduplicates an unchanged resubmission and still records the attempt', async () => {
    const tables = emptyTables();
    await write._handler(memoryCtx(tables), writeArgs({ temperature: 0.9 }));
    const repeat = await write._handler(memoryCtx(tables), writeArgs({ temperature: 0.9 }));
    expect(repeat).toMatchObject({ version: 1, deduplicated: true });
    expect(tables.moduleModelConfigs).toHaveLength(1);
    // The attempt is still audited: an operator pressing save is part of the account of what
    // happened, and a silent drop would leave a gap in it.
    expect(tables.operatorAuditLog).toHaveLength(2);
    expect(tables.operatorAuditLog[1]).toMatchObject({ outcome: 'no_op', resultCode: 'OPS_NO_OP' });
  });

  it('returns the version history newest-first, so an operator can see what the configuration WAS', async () => {
    const tables = emptyTables();
    await write._handler(memoryCtx(tables), writeArgs({ temperature: 0.4 }));
    await write._handler(memoryCtx(tables), writeArgs({ temperature: 0.7 }));
    const result = await history._handler(memoryCtx(tables), {
      ...VIEWER, worldId: WORLD_ID, module: 'scene_simulation',
    }) as { versions: Array<{ version: number | null; temperature: number; reason: string | null }> };
    expect(result.versions.map((row) => row.version)).toEqual([2, 1]);
    expect(result.versions.map((row) => row.temperature)).toEqual([0.7, 0.4]);
    expect(result.versions.every((row) => row.reason === REASON)).toBe(true);
  });

  it('reports a historical version as it was stored, even if its prompt id was later retired', async () => {
    // The history answers "what WAS the configuration", which is a different question from "what
    // will run". Routing it through the resolver — whose job is the second question, and which
    // therefore falls back to the defaults for a row that no longer validates — would silently
    // rewrite the record.
    const tables = emptyTables();
    tables.moduleModelConfigs.push({
      _id: 'moduleModelConfigs:0', schemaVersion: 1, worldId: WORLD_ID, module: 'scene_simulation',
      version: 1, ...MODULE_MODEL_DEFAULTS.scene_simulation,
      promptVersion: 'scene_simulation.v0', temperature: 0.25,
      contentHash: 'mmc:legacy', actor: 'op-admin', reason: 'the original setup', createdAt: 1,
      isCurrent: true,
    });
    const result = await history._handler(memoryCtx(tables), {
      ...VIEWER, worldId: WORLD_ID, module: 'scene_simulation',
    }) as { versions: Array<{ version: number | null; promptVersion: string | null; temperature: number }> };
    expect(result.versions[0]).toMatchObject({
      version: 1, promptVersion: 'scene_simulation.v0', temperature: 0.25,
    });
    // …while the live read reports what will ACTUALLY run, which is the documented defaults.
    const live = await inspect._handler(memoryCtx(tables), { ...VIEWER, worldId: WORLD_ID }) as {
      modules: Array<{ source: string; promptVersion: string | null; temperature: number }>;
    };
    expect(live.modules[0]).toMatchObject({
      source: 'default', promptVersion: 'scene_simulation.v1', temperature: 0.4,
    });
  });

  it('refuses an unknown module without writing anything', async () => {
    const tables = emptyTables();
    await expect(write._handler(memoryCtx(tables), writeArgs({ module: 'billing' })))
      .rejects.toThrow(/unknown module/);
    expect(tables.moduleModelConfigs).toHaveLength(0);
    expect(tables.operatorAuditLog).toHaveLength(0);
  });

  it('refuses a credential-shaped value without writing anything', async () => {
    const tables = emptyTables();
    await expect(write._handler(memoryCtx(tables), writeArgs({ model: 'gpt-4o apikey=sk-live-abcdef' })))
      .rejects.toThrow(/MODULE_CONFIG_SECRET_LEAK/);
    expect(tables.moduleModelConfigs).toHaveLength(0);
    expect(tables.operatorAuditLog).toHaveLength(0);
  });
});

describe('AC#3 — the operator projection carries no secret and no prompt body', () => {
  withRegistry();

  it('reports every module, including the ones running on defaults', async () => {
    const tables = emptyTables();
    await write._handler(memoryCtx(tables), writeArgs({ temperature: 0.9 }));
    const result = await inspect._handler(memoryCtx(tables), { ...VIEWER, worldId: WORLD_ID }) as {
      modules: Array<{ module: string; source: string; version: number | null; temperature: number }>;
    };
    expect(result.modules.map((row) => row.module))
      .toEqual(['scene_simulation', 'director_plan', 'character_intent', 'editorial']);
    expect(result.modules[0]).toMatchObject({ source: 'configured', version: 1, temperature: 0.9 });
    // Reporting only configured modules would read as "scene simulation is the only module",
    // which is a different and false statement from "the others run the documented defaults".
    expect(result.modules.slice(1).every((row) => row.source === 'default')).toBe(true);
  });

  it('is an allowlist: no apiKey, no token value, no prompt body, no registry material', async () => {
    const tables = emptyTables();
    await write._handler(memoryCtx(tables), writeArgs({ temperature: 0.9 }));
    const result = await inspect._handler(memoryCtx(tables), { ...ADMIN, worldId: WORLD_ID }) as {
      modules: Array<Record<string, unknown>>;
    };
    const serialised = JSON.stringify(result);
    for (const secret of [
      'correct-horse-battery-staple', 'a-different-long-token-value', 'a-third-distinct-token-value',
    ]) expect(serialised).not.toContain(secret);
    expect(serialised).not.toMatch(/apiKey/i);
    // The v1 prompt's opening sentence. If a body ever reached the projection, this catches it.
    expect(serialised).not.toMatch(/Simulate the entire grouped scene/);
    expect(Object.keys(result.modules[0]).sort()).toEqual([
      'actor', 'contentHash', 'createdAt', 'dailyTokenBudget', 'fallbackModel', 'maxTokens',
      'model', 'module', 'promptVersion', 'reason', 'semanticMaxAttempts', 'source',
      'temperature', 'timeoutMs', 'transportMaxAttempts', 'version',
    ]);
    // `promptVersion` is a NAME, and it is the only prompt-shaped value that exists here.
    expect(result.modules[0].promptVersion).toBe('scene_simulation.v1');
  });

  it('exposes the documented defaults behind the same gate, so the console is not anonymously enumerable', async () => {
    await expect(defaults._handler(anonymousCtx(), { worldId: WORLD_ID })).rejects.toThrow(OPS_UNAUTHORIZED);
    const result = await defaults._handler(memoryCtx(emptyTables()), { ...VIEWER, worldId: WORLD_ID }) as {
      modules: Array<{ module: string; defaults: ModuleModelSettings }>;
    };
    expect(result.modules).toHaveLength(4);
    expect(result.modules[0].defaults).toEqual(MODULE_MODEL_DEFAULTS.scene_simulation);
  });
});
