/**
 * The pure FR-K005 configuration model (ART-52).
 *
 * Everything here is a claim about the RULES — validation, redaction, versioning, dedup — and
 * none of it needs a deployment. The two claims that need one live next door:
 * `convex/operations/moduleModelConfigFunctions.test.ts` settles authorization and the operator
 * projection, and `convex/simulation/moduleConfigSelection.test.ts` settles the one that
 * actually makes AC#1 true — that a configured value reaches the provider call.
 */

import {
  assertModuleModelSettings,
  assertNoCredentialMaterial,
  commitModuleModelConfig,
  CONFIGURABLE_MODULES,
  describeModuleModelConfig,
  FORBIDDEN_CONFIG_FIELDS,
  hashModuleModelSettings,
  MODULE_MODEL_DEFAULTS,
  MODULES_WITH_PROVIDER_CONSUMERS,
  ModuleModelConfigError,
  PROMPT_VERSION_IDS,
  resolveEffectiveModuleConfig,
  type ConfigurableModule,
  type ModuleModelConfigRecord,
  type ModuleModelConfigStore,
  type ModuleModelSettings,
  type StoredModuleModelConfig,
} from './moduleModelConfig';

const WORLD_ID = 'mistwood';
const NOW = 1_700_000_000_000;
const ACTOR = 'op-admin';
const REASON = 'raise scene creativity for the festival arc';

const settings = (over: Partial<ModuleModelSettings> = {}): ModuleModelSettings => ({
  ...MODULE_MODEL_DEFAULTS.scene_simulation,
  ...over,
});

/**
 * In-memory {@link ModuleModelConfigStore}.
 *
 * Deliberately does NOT enforce the at-most-one-`isCurrent` invariant itself — if it did, a
 * commit protocol that demoted nothing would still look correct here. The invariant is asserted
 * on the resulting rows instead.
 */
function memoryStore() {
  const rows: StoredModuleModelConfig[] = [];
  let nextId = 1;
  const store: ModuleModelConfigStore = {
    findCurrent: (worldId, module) => Promise.resolve(
      rows.find((row) => row.worldId === worldId && row.module === module && row.isCurrent) ?? null,
    ),
    insertVersion: (row: ModuleModelConfigRecord) => {
      const id = `cfg-${nextId++}`;
      rows.push({ ...row, id });
      return Promise.resolve(id);
    },
    demote: (rowId: string) => {
      const row = rows.find((candidate) => candidate.id === rowId);
      if (row) row.isCurrent = false;
      return Promise.resolve();
    },
  };
  return { store, rows };
}

const commit = (
  store: ModuleModelConfigStore,
  over: Partial<ModuleModelSettings> = {},
  input: { module?: ConfigurableModule; reason?: string; now?: number } = {},
) => commitModuleModelConfig(store, {
  worldId: WORLD_ID,
  module: input.module ?? 'scene_simulation',
  settings: settings(over),
  actor: ACTOR,
  reason: input.reason ?? REASON,
  now: input.now ?? NOW,
});

// ---------------------------------------------------------------------------

describe('AC#1 — the eight settings are configurable per module', () => {
  it('declares one key per module and marks which are placeholders', () => {
    expect([...CONFIGURABLE_MODULES]).toEqual([
      'scene_simulation', 'director_plan', 'character_intent', 'editorial',
    ]);
    // The honesty pin. Exactly one module calls a language model today; the other three are
    // deterministic algorithms whose configuration nothing reads. If a consumer is added, this
    // fails until `MODULES_WITH_PROVIDER_CONSUMERS` and docs/model-configuration.md §2 agree.
    expect([...MODULES_WITH_PROVIDER_CONSUMERS]).toEqual(['scene_simulation']);
  });

  it('carries all eight FR-K005 settings, with Retry split into its two real layers', () => {
    expect(Object.keys(MODULE_MODEL_DEFAULTS.scene_simulation).sort()).toEqual([
      'dailyTokenBudget', 'fallbackModel', 'maxTokens', 'model', 'promptVersion',
      'semanticMaxAttempts', 'temperature', 'timeoutMs', 'transportMaxAttempts',
    ]);
  });

  it('defaults to the exact values that were hardcoded before this table existed', () => {
    // Behaviour preservation, stated as numbers rather than as prose: 0.4 and 4_000 are the
    // `sceneSimulation.ts` literals, 2 is its `maxAttempts` default, and 30_000 / 3 are the
    // `LLM_TIMEOUT_MS` / `LLM_MAX_ATTEMPTS` defaults from `providers/config.ts`.
    expect(MODULE_MODEL_DEFAULTS.scene_simulation).toEqual({
      model: null,
      promptVersion: 'scene_simulation.v1',
      temperature: 0.4,
      maxTokens: 4_000,
      // `null`, NOT 30_000 / 3. These two are the only settings whose pre-ART-52 value came from
      // a deployment environment variable rather than a code literal, and they become per-REQUEST
      // overrides that beat the provider instance. A concrete default here would make
      // `LLM_TIMEOUT_MS` and `LLM_MAX_ATTEMPTS` dead for every world, configured or not.
      timeoutMs: null,
      transportMaxAttempts: null,
      semanticMaxAttempts: 2,
      // Configured-but-unenforced by design: ART-59 owns budget enforcement, ART-91 owns
      // fallback ordering. `null` is the honest default for both.
      fallbackModel: null,
      dailyTokenBudget: null,
    });
  });

  it('refuses out-of-range and non-integer values rather than clamping them', () => {
    const cases: Array<[string, Partial<ModuleModelSettings>]> = [
      ['temperature above the wire maximum', { temperature: 2.5 }],
      ['negative temperature', { temperature: -0.1 }],
      ['fractional token limit', { maxTokens: 100.5 }],
      ['zero token limit', { maxTokens: 0 }],
      ['zero timeout', { timeoutMs: 0 }],
      ['a timeout above the ceiling', { timeoutMs: 600_001 }],
      ['zero transport attempts', { transportMaxAttempts: 0 }],
      ['transport attempts above the ceiling', { transportMaxAttempts: 11 }],
      ['semantic attempts above the ceiling of 3', { semanticMaxAttempts: 4 }],
      ['a negative daily budget', { dailyTokenBudget: -1 }],
      ['an over-long model id', { model: 'm'.repeat(201) }],
      ['an empty model id', { model: '' }],
      ['an unregistered prompt version', { promptVersion: 'scene_simulation.v9' as never }],
    ];
    for (const [label, over] of cases) {
      expect(() => { assertModuleModelSettings('scene_simulation', settings(over)); })
        .toThrow(ModuleModelConfigError);
      expect(label).toBeTruthy();
    }
  });

  it('accepts `null` for the three env-backed settings, meaning "inherit the deployment value"', () => {
    expect(() => {
      assertModuleModelSettings('scene_simulation',
        settings({ model: null, timeoutMs: null, transportMaxAttempts: null }));
    }).not.toThrow();
    // …and still validates a concrete value on those same fields.
    expect(() => { assertModuleModelSettings('scene_simulation', settings({ timeoutMs: -1 })); })
      .toThrow(ModuleModelConfigError);
  });

  it('requires a prompt version for a module that actually calls a model', () => {
    expect(() => { assertModuleModelSettings('scene_simulation', settings({ promptVersion: null })); })
      .toThrow(/requires a promptVersion/);
    // …and permits `null` for a placeholder module, where it honestly means "no prompt exists".
    expect(() => {
      assertModuleModelSettings('editorial', { ...MODULE_MODEL_DEFAULTS.editorial, promptVersion: null });
    }).not.toThrow();
  });
});

describe('AC#2 — every change is versioned', () => {
  it('assigns monotonic versions per (world, module)', async () => {
    const { store, rows } = memoryStore();
    expect(await commit(store, { temperature: 0.4 })).toMatchObject({ version: 1, deduplicated: false });
    expect(await commit(store, { temperature: 0.5 })).toMatchObject({ version: 2, deduplicated: false });
    expect(await commit(store, { temperature: 0.6 })).toMatchObject({ version: 3, deduplicated: false });
    expect(rows.map((row) => row.version)).toEqual([1, 2, 3]);
    // Per TARGET, not global: a different module starts its own count at 1.
    expect(await commit(store, { promptVersion: null }, { module: 'editorial' }))
      .toMatchObject({ version: 1, deduplicated: false });
  });

  it('deduplicates a byte-identical resubmission instead of appending a version', async () => {
    const { store, rows } = memoryStore();
    await commit(store, { temperature: 0.5 });
    const repeat = await commit(store, { temperature: 0.5 });
    expect(repeat).toMatchObject({ version: 1, deduplicated: true });
    expect(rows).toHaveLength(1);
  });

  it('treats a new reason for unchanged settings as a resubmission, not a change', async () => {
    // The reason is not part of the content hash on purpose: an operator re-saving the same
    // numbers with fresh prose has not changed the configuration, and a version that records no
    // decision makes the history stop meaning "someone changed something".
    const { store, rows } = memoryStore();
    await commit(store, { temperature: 0.5 }, { reason: REASON });
    expect(await commit(store, { temperature: 0.5 }, { reason: 'a completely different reason' }))
      .toMatchObject({ deduplicated: true });
    expect(rows).toHaveLength(1);
  });

  it('keeps at most one current version, and it is always the newest', async () => {
    const { store, rows } = memoryStore();
    await commit(store, { temperature: 0.4 });
    await commit(store, { temperature: 0.5 });
    await commit(store, { temperature: 0.6 });
    expect(rows.filter((row) => row.isCurrent)).toHaveLength(1);
    expect(rows.find((row) => row.isCurrent)?.version).toBe(3);
  });

  it('leaves the serving version untouched when the insert fails', async () => {
    // Insert-then-demote ordering. The reverse would open a window with no current version, in
    // which every reader silently falls back to defaults.
    const { store, rows } = memoryStore();
    await commit(store, { temperature: 0.4 });
    const broken: ModuleModelConfigStore = {
      ...store,
      insertVersion: () => Promise.reject(new Error('store unavailable')),
    };
    await expect(commitModuleModelConfig(broken, {
      worldId: WORLD_ID, module: 'scene_simulation', settings: settings({ temperature: 0.9 }),
      actor: ACTOR, reason: REASON, now: NOW,
    })).rejects.toThrow('store unavailable');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isCurrent: true, version: 1, temperature: 0.4 });
  });

  it('records who and why on every stored version', async () => {
    const { store, rows } = memoryStore();
    await commit(store, { temperature: 0.5 });
    expect(rows[0]).toMatchObject({ actor: ACTOR, reason: REASON, createdAt: NOW, schemaVersion: 1 });
  });

  it('refuses a blank reason or a blank actor', async () => {
    const { store } = memoryStore();
    await expect(commitModuleModelConfig(store, {
      worldId: WORLD_ID, module: 'scene_simulation', settings: settings(), actor: ACTOR, reason: '   ', now: NOW,
    })).rejects.toThrow(ModuleModelConfigError);
    await expect(commitModuleModelConfig(store, {
      worldId: WORLD_ID, module: 'scene_simulation', settings: settings(), actor: '', reason: REASON, now: NOW,
    })).rejects.toThrow(ModuleModelConfigError);
  });

  it('hashes the module alongside the settings', () => {
    // Identical settings under two modules must not collide, or configuring `editorial` with
    // `scene_simulation`'s values would dedup against the wrong target.
    const shared = { ...MODULE_MODEL_DEFAULTS.scene_simulation };
    expect(hashModuleModelSettings('scene_simulation', shared))
      .not.toEqual(hashModuleModelSettings('editorial', shared));
    // …and is stable across calls, or nothing would ever deduplicate.
    expect(hashModuleModelSettings('scene_simulation', shared))
      .toEqual(hashModuleModelSettings('scene_simulation', { ...shared }));
  });
});

describe('AC#3 — secrets and complete prompts never enter the configuration', () => {
  it('refuses a credential-shaped FIELD', () => {
    for (const field of FORBIDDEN_CONFIG_FIELDS) {
      expect(() => { assertNoCredentialMaterial({ ...settings(), [field]: 'sk-live-abcdef' }); })
        .toThrow(/MODULE_CONFIG_SECRET_LEAK/);
    }
  });

  it('refuses a credential smuggled inside a legitimate string value', async () => {
    const { store, rows } = memoryStore();
    await expect(commitModuleModelConfig(store, {
      worldId: WORLD_ID, module: 'scene_simulation',
      settings: settings({ model: 'gpt-4o apikey=sk-live-abcdef' }),
      actor: ACTOR, reason: REASON, now: NOW,
    })).rejects.toThrow(/MODULE_CONFIG_SECRET_LEAK/);
    expect(rows).toHaveLength(0);
  });

  it('refuses a credential in the worldId, the last caller-controlled string on the write path', async () => {
    const { store, rows } = memoryStore();
    await expect(commitModuleModelConfig(store, {
      worldId: 'mistwood secret=hunter2', module: 'scene_simulation', settings: settings(),
      actor: ACTOR, reason: REASON, now: NOW,
    })).rejects.toThrow(/MODULE_CONFIG_SECRET_LEAK/);
    expect(rows).toHaveLength(0);
  });

  it('refuses a credential in the reason, which is the field most likely to carry one', async () => {
    const { store } = memoryStore();
    await expect(commitModuleModelConfig(store, {
      worldId: WORLD_ID, module: 'scene_simulation', settings: settings(),
      actor: ACTOR, reason: 'rotating to the new key, token: hunter2', now: NOW,
    })).rejects.toThrow(/MODULE_CONFIG_SECRET_LEAK/);
  });

  it('still permits `maxTokens`, whose name contains a forbidden word', () => {
    // The field sweep is an exact, case-insensitive key match rather than a substring one,
    // precisely so the setting named after tokens is not mistaken for a credential.
    expect(() => { assertNoCredentialMaterial(settings({ maxTokens: 8_000 })); }).not.toThrow();
  });

  it('stores prompt version IDs only — there is no field a body could go in', () => {
    for (const id of PROMPT_VERSION_IDS) {
      expect(id).toMatch(/^[a-z_]+\.v\d+$/);
      // A registered id is a NAME. Nothing that looks like an instruction is stored under it.
      expect(id.length).toBeLessThan(64);
    }
    const view = describeModuleModelConfig(
      resolveEffectiveModuleConfig('scene_simulation', null),
      null,
    );
    const serialised = JSON.stringify(view);
    expect(serialised).not.toMatch(/Simulate the entire grouped scene/);
    expect(Object.keys(view)).not.toContain('apiKey');
    expect(Object.keys(view)).not.toContain('prompt');
  });

  it('mirrors the operator audit trail\'s forbidden-field list exactly', () => {
    // A copy, because `shared` may not depend on `operations`. Pinned here so the copy cannot
    // drift into being weaker than the original.
    expect([...FORBIDDEN_CONFIG_FIELDS])
      .toEqual(['token', 'operatortoken', 'apikey', 'authorization', 'password', 'secret']);
  });
});

describe('resolution — an unconfigured world runs the documented defaults', () => {
  it('reports `default` with no version when nothing is stored', () => {
    expect(resolveEffectiveModuleConfig('scene_simulation', null)).toEqual({
      module: 'scene_simulation', source: 'default', version: null,
      ...MODULE_MODEL_DEFAULTS.scene_simulation,
    });
  });

  it('reports `configured` with the stored version when a row exists', () => {
    const resolved = resolveEffectiveModuleConfig('scene_simulation', {
      ...settings({ temperature: 0.9, maxTokens: 1_234 }), version: 7,
    });
    expect(resolved).toMatchObject({ source: 'configured', version: 7, temperature: 0.9, maxTokens: 1_234 });
  });

  it('falls back to the defaults for a stored row that no longer validates', () => {
    // A prompt version retired after a configuration referenced it must not be able to stop a
    // world simulating; it must make the world run the documented defaults, visibly.
    const resolved = resolveEffectiveModuleConfig('scene_simulation', {
      ...settings({ promptVersion: 'scene_simulation.v0' as never }), version: 4,
    });
    expect(resolved).toMatchObject({ source: 'default', version: null, promptVersion: 'scene_simulation.v1' });
  });
});
