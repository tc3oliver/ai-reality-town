/**
 * THE public read-only guarantee (ART-128 / FR-O009).
 *
 * PRD 2.0 §18.1 sets two numbers to exactly zero -- viewer-triggered LLM calls and
 * successful public mutations -- and §22 makes both a release gate. §12 Epic O adds
 * that hiding a control in the UI is explicitly not enough.
 *
 * That claim cannot be proven by driving the app. A behavioural test only shows that
 * the paths it happened to walk did not write; it says nothing about the anonymous
 * caller who never loads the app at all and posts straight at the deployment URL. So
 * this suite reasons about the SURFACE instead, at three levels:
 *
 *  1. **Enumeration.** Every client-reachable Convex registration is listed from
 *     source and diffed against `architecture/module-boundaries.json`, and each one's
 *     real runtime visibility flags are read off the registered function object. If a
 *     public function is added anywhere under `convex/`, this fails.
 *  2. **Adversarial invocation.** Every public mutation is CALLED, through its real
 *     handler, with no identity and with forged credentials. The `db` handed to it is
 *     a Proxy that throws on any property access, so a handler that consults a row
 *     before deciding fails loudly -- proving denial happens before any read, which
 *     is what stops a denial from leaking whether a world exists.
 *  3. **Absence.** The functions a viewer would need in order to join, move, chat or
 *     drive a world are proven not to exist, rather than proven to be unreachable.
 *
 * Where an assertion pins behaviour that is already correct (forged identifiers fail
 * safe), it is a regression guard and says so.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import * as canonCorrectionFunctions from '../operations/canonCorrectionFunctions';
import * as dynamicViewMetricsFunctions from '../operations/dynamicViewMetricsFunctions';
import * as emergencyStopFunctions from '../operations/emergencyStopFunctions';
import * as opsConsoleFunctions from '../operations/opsConsoleFunctions';
import * as proposalReviewFunctions from '../operations/proposalReviewFunctions';
import * as traces from '../observability/traces';
import * as liveStateFunctions from './liveStateFunctions';
import * as readModelFunctions from './readModelFunctions';
import * as runtimeSnapshotFunctions from './runtimeSnapshotFunctions';

import { publicLlmTraceValidator } from '../observability/schema';
import { OPS_UNAUTHORIZED } from '../operations/operatorAuthorization';
import {
  commitReadModelVersion,
  sanitizeForPublic,
  serveReadModel,
  type JsonValue,
  type PublishedReadModel,
  type PublicReadStore,
  type ReadModelKind,
  type StoredReadModel,
} from './readModel';
import { PUBLIC_DYNAMIC_FORBIDDEN_FIELDS } from './publicDynamicProjection';
import { serveRuntimeSnapshot, type RuntimeSnapshotReadStore } from './runtimeSnapshot';

const ROOT = process.cwd();

// --- the declared surface ---------------------------------------------------

type SurfaceEntry = { path: string; name: string; kind: 'query' | 'mutation' | 'action'; gate: 'anonymous' | 'operator' };

const policy = JSON.parse(readFileSync(join(ROOT, 'architecture/module-boundaries.json'), 'utf8')) as {
  publicFunctionSurface: { allowed: SurfaceEntry[]; forbiddenRegistrations: string[] };
};
const ALLOWED: readonly SurfaceEntry[] = policy.publicFunctionSurface.allowed;

/**
 * The registered function objects behind the policy, imported statically so a module
 * with a load-time side effect cannot be smuggled past the enumeration.
 */
const MODULES: Readonly<Record<string, Record<string, unknown>>> = {
  'convex/operations/opsConsoleFunctions.ts': opsConsoleFunctions,
  'convex/operations/emergencyStopFunctions.ts': emergencyStopFunctions,
  'convex/operations/canonCorrectionFunctions.ts': canonCorrectionFunctions,
  'convex/operations/dynamicViewMetricsFunctions.ts': dynamicViewMetricsFunctions,
  'convex/operations/proposalReviewFunctions.ts': proposalReviewFunctions,
  'convex/observability/traces.ts': traces,
  'convex/publicRead/readModelFunctions.ts': readModelFunctions,
  'convex/publicRead/liveStateFunctions.ts': liveStateFunctions,
  'convex/publicRead/runtimeSnapshotFunctions.ts': runtimeSnapshotFunctions,
};

/** A Convex-registered function, as it exists at runtime. */
type Registered = {
  isQuery?: boolean;
  isMutation?: boolean;
  isAction?: boolean;
  isPublic?: boolean;
  isInternal?: boolean;
  exportArgs: () => string;
  _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

function registered(entry: SurfaceEntry): Registered {
  const module = MODULES[entry.path];
  if (!module) throw new Error(`no imported module for ${entry.path}`);
  return module[entry.name] as Registered;
}

const PUBLIC_MUTATIONS = ALLOWED.filter((entry) => entry.kind === 'mutation');
const PUBLIC_QUERIES = ALLOWED.filter((entry) => entry.kind === 'query');

// --- source scanning --------------------------------------------------------

/**
 * Every extension Convex's bundler accepts as a function entry point. Scanning a
 * narrower set than the bundler deploys is how a public function hides: a `.cts` or
 * `.jsx` module under `convex/` would ship a live registration that no enumeration here
 * had ever looked at. Matches `isSourceFile` in `scripts/architecture/check-boundaries.mjs`.
 */
const CONVEX_ENTRY_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts'] as const;

function sourceFiles(dir: string, extensions: readonly string[]): string[] {
  if (!existsSync(join(ROOT, dir))) return [];
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((item) => {
    const path = `${dir}/${item.name}`;
    if (item.isDirectory()) return item.name === '_generated' ? [] : sourceFiles(path, extensions);
    if (!extensions.some((extension) => item.name.endsWith(extension))) return [];
    return item.name.includes('.test.') ? [] : [path];
  });
}

/** Client-reachable registrations, found the same way `check:architecture` finds them. */
function clientReachableRegistrations(source: string): Array<{ name: string; kind: string }> {
  const found: Array<{ name: string; kind: string }> = [];
  const kinds = 'httpAction|query|mutation|action';
  for (const match of source.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(${kinds})\s*\(`, 'g'))) {
    found.push({ name: match[1], kind: match[2] });
  }
  for (const match of source.matchAll(new RegExp(String.raw`export\s+default\s+(${kinds})\s*\(`, 'g'))) {
    found.push({ name: 'default', kind: match[1] });
  }
  return found;
}

/**
 * Does this source name `httpAction` as a call, in ANY shape?
 *
 * Independent of {@link clientReachableRegistrations} on purpose. That function anchors
 * on an assignment (`const x = httpAction(`), which cannot see the spelling Convex's own
 * docs use -- `http.route({ handler: httpAction(...) })` binds the action to no name.
 * Reusing it here would have made this suite test the same code path twice and inherit
 * the same blind spot. Policy declares zero HTTP endpoints, so nothing needs parsing.
 */
function namesHttpAction(source: string): boolean {
  return /\bhttpAction\s*\(/.test(source);
}

// --- adversarial stubs ------------------------------------------------------

/**
 * A `db` that cannot be touched without saying so. Any property access throws and
 * flips `touched`, so "the handler denied the caller" and "the handler denied the
 * caller BEFORE reading anything" become separately checkable facts.
 */
function throwingDb() {
  const state = { touched: false };
  const db = new Proxy(
    {},
    {
      get(_target, property) {
        state.touched = true;
        throw new Error(`public caller reached the database: .${String(property)}`);
      },
    },
  );
  return { db, state };
}

/** The context an unauthenticated, anonymous caller actually presents. */
function anonymousCtx() {
  const { db, state } = throwingDb();
  return {
    ctx: { auth: { getUserIdentity: () => Promise.resolve(null) }, db, storage: db, scheduler: db, runMutation: () => { throw new Error('runMutation'); } },
    state,
  };
}

/** A caller who forged a signed-in identity that is in no operator registry. */
function forgedIdentityCtx(subject: string) {
  const { db, state } = throwingDb();
  return {
    ctx: {
      auth: { getUserIdentity: () => Promise.resolve({ subject, tokenIdentifier: subject, issuer: 'https://attacker.example' }) },
      db,
      storage: db,
      scheduler: db,
      runMutation: () => { throw new Error('runMutation'); },
    },
    state,
  };
}

/** Plausible arguments for every console command, so a denial is the only reason to fail. */
function commandArgsFor(entry: SurfaceEntry): Record<string, unknown> {
  return {
    worldId: 'mistwood',
    reason: 'security suite: unauthorized attempt',
    now: 1_700_000_000_000,
    slotKey: 'slot-1',
    runId: 'run-1',
    sceneId: 'scene-1',
    traceId: 'trace-1',
    eventId: 'evt-1',
    remediationType: 'correction',
    proposedEventId: 'proposal-1',
    correction: { publicSummary: 'x' },
    payload: { publicSummary: 'x' },
    ...(entry.name === 'createRetconEvent' ? { retconReason: 'x' } : {}),
  };
}

const REGISTRY = JSON.stringify([
  { operatorId: 'op-real', role: 'admin', subjects: ['clerk|real-operator'], token: 'correct-horse-battery-staple' },
]);

// --- in-memory stores -------------------------------------------------------

class MemoryReadStore implements PublicReadStore {
  readonly rows: StoredReadModel[] = [];
  private counter = 0;
  async loadTargetVersions(worldId: string, modelKind: string, modelRef: string): Promise<readonly StoredReadModel[]> {
    return Promise.resolve(this.rows.filter((row) => row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef));
  }
  async findCurrent(worldId: string, modelKind: string, modelRef: string): Promise<StoredReadModel | null> {
    return Promise.resolve(this.rows.find((row) => row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isCurrent) ?? null);
  }
  async loadLastKnownGood(worldId: string, modelKind: string, modelRef: string): Promise<readonly StoredReadModel[]> {
    return Promise.resolve(this.rows.filter((row) => row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isLastKnownGood));
  }
  async insertVersion(record: PublishedReadModel): Promise<string> {
    this.counter += 1;
    const id = `row-${this.counter}`;
    this.rows.push({ ...record, id });
    return Promise.resolve(id);
  }
  async markCurrent(rowId: string, patch: { isCurrent: boolean; isLastKnownGood: boolean; status: never; updatedAt: number }): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === rowId);
    if (row) { row.isCurrent = patch.isCurrent; row.isLastKnownGood = patch.isLastKnownGood; row.status = patch.status; }
    return Promise.resolve();
  }
}

const SECRET_WORLD = 'w-secret';

async function seededStore(): Promise<MemoryReadStore> {
  const store = new MemoryReadStore();
  await commitReadModelVersion(store, {
    worldId: SECRET_WORLD,
    modelKind: 'liveState' as ReadModelKind,
    modelRef: `live:${SECRET_WORLD}`,
    payload: { worldId: SECRET_WORLD, headline: 'public headline' } as unknown as JsonValue,
    sourceEventIds: ['evt-1'],
    status: 'published',
    now: 1,
  });
  return store;
}

// ---------------------------------------------------------------------------

describe('AC#1 — the client-reachable surface is exactly what policy declares', () => {
  test('every public function under convex/ is declared, and every declaration exists', () => {
    const declared = new Set(ALLOWED.map((entry) => `${entry.path}:${entry.name}`));
    const found = sourceFiles('convex', CONVEX_ENTRY_EXTENSIONS).flatMap((path) =>
      clientReachableRegistrations(readFileSync(join(ROOT, path), 'utf8')).map(
        (registration) => `${path}:${registration.name}`,
      ),
    );
    expect([...found].sort()).toEqual([...declared].sort());
  });

  test('each declared function carries the runtime visibility its policy entry claims', () => {
    for (const entry of ALLOWED) {
      const fn = registered(entry);
      expect(fn).toBeDefined();
      expect(fn.isPublic).toBe(true);
      expect(fn.isInternal).toBeUndefined();
      if (entry.kind === 'query') expect(fn.isQuery).toBe(true);
      if (entry.kind === 'mutation') expect(fn.isMutation).toBe(true);
    }
  });

  test('every public mutation is an operator control; no anonymous mutation exists', () => {
    expect(PUBLIC_MUTATIONS.length).toBeGreaterThan(0);
    for (const entry of PUBLIC_MUTATIONS) expect(entry.gate).toBe('operator');
    expect(ALLOWED.filter((entry) => entry.gate === 'anonymous').every((entry) => entry.kind === 'query')).toBe(true);
  });

  test('the shipped client reaches exactly one Convex function, and it is a read', () => {
    // The browser bundle's whole write capability is whatever it can name. After
    // ART-128 deleted the music module, one reference remains -- a published-read query.
    const refs = sourceFiles('src', ['.ts', '.tsx']).flatMap((path) =>
      [...readFileSync(join(ROOT, path), 'utf8').matchAll(/publicFunctionRef<[^>]*>\(\s*'([^']+)'/g)].map(
        (match) => match[1],
      ),
    );
    expect(refs).toEqual(['publicRead/readModelFunctions:getPublishedReadModel']);
    expect(readModelFunctions.getPublishedReadModel).toHaveProperty('isQuery', true);
  });

  test('convex/init.ts is no longer a public mutation', () => {
    // GAP 1: this shipped as `mutation`, so any anonymous client holding the
    // deployment URL could call it -- and it SUCCEEDED.
    const source = readFileSync(join(ROOT, 'convex/init.ts'), 'utf8');
    expect(source).toContain('internalMutation({');
    expect(clientReachableRegistrations(source)).toEqual([]);
  });
});

describe('AC#2/#3/#4 — the functions a viewer would need do not exist', () => {
  test('no human-player, heartbeat or world-lifecycle function survives', () => {
    // ADR-0004 / ART-112 retired the a16z engine. Absence is the guarantee: these
    // cannot be reached because there is nothing to reach.
    for (const path of [
      'convex/world.ts',
      'convex/messages.ts',
      'convex/testing.ts',
      'convex/aiTown/main.ts',
      'convex/aiTown/game.ts',
      'convex/agent/conversation.ts',
    ]) {
      expect(existsSync(join(ROOT, path))).toBe(false);
    }
  });

  test('nothing under convex/aiTown/ registers a client-reachable function', () => {
    const offenders = sourceFiles('convex/aiTown', CONVEX_ENTRY_EXTENSIONS).flatMap((path) =>
      clientReachableRegistrations(readFileSync(join(ROOT, path), 'utf8')).map((r) => `${path}:${r.name}`),
    );
    expect(offenders).toEqual([]);
    expect(ALLOWED.filter((entry) => entry.path.startsWith('convex/aiTown/'))).toEqual([]);
  });

  test('no declared public function is named for joining, moving, chatting or a heartbeat', () => {
    const retired = /join|leave|heartbeat|move|walk|destination|conversation|chat|message|interact|input/i;
    expect(ALLOWED.filter((entry) => retired.test(entry.name))).toEqual([]);
  });

  test('starting or resuming a world requires an operator', async () => {
    for (const name of ['resumeWorld', 'pauseWorld', 'advanceSlot', 'retryFailedSlot'] as const) {
      const entry = ALLOWED.find((candidate) => candidate.name === name)!;
      expect(entry.gate).toBe('operator');
      const { ctx, state } = anonymousCtx();
      await expect(registered(entry)._handler(ctx, commandArgsFor(entry))).rejects.toThrow(OPS_UNAUTHORIZED);
      expect(state.touched).toBe(false);
    }
    const resume = ALLOWED.find((candidate) => candidate.name === 'resumeFromEmergencyStop')!;
    const { ctx, state } = anonymousCtx();
    await expect(registered(resume)._handler(ctx, commandArgsFor(resume))).rejects.toThrow(OPS_UNAUTHORIZED);
    expect(state.touched).toBe(false);
  });
});

describe('AC#6/#7 — public mutations refuse unauthorized callers server-side', () => {
  const priorRegistry = process.env.SIMULATION_OPS_OPERATORS;
  const priorIssuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
  afterEach(() => {
    if (priorRegistry === undefined) delete process.env.SIMULATION_OPS_OPERATORS;
    else process.env.SIMULATION_OPS_OPERATORS = priorRegistry;
    if (priorIssuer === undefined) delete process.env.CLERK_JWT_ISSUER_DOMAIN;
    else process.env.CLERK_JWT_ISSUER_DOMAIN = priorIssuer;
  });

  test('every public mutation refuses an unauthenticated caller before reading any row', async () => {
    process.env.SIMULATION_OPS_OPERATORS = REGISTRY;
    for (const entry of PUBLIC_MUTATIONS) {
      const { ctx, state } = anonymousCtx();
      await expect(registered(entry)._handler(ctx, commandArgsFor(entry))).rejects.toThrow(OPS_UNAUTHORIZED);
      // The denial must not be informed by any stored row: a gate that reads first
      // can be used to probe which worlds exist.
      expect(state.touched).toBe(false);
    }
  });

  test('every operator-gated query refuses an unauthenticated caller too', async () => {
    process.env.SIMULATION_OPS_OPERATORS = REGISTRY;
    for (const entry of PUBLIC_QUERIES.filter((candidate) => candidate.gate === 'operator')) {
      const { ctx, state } = anonymousCtx();
      await expect(registered(entry)._handler(ctx, commandArgsFor(entry))).rejects.toThrow(OPS_UNAUTHORIZED);
      expect(state.touched).toBe(false);
    }
  });

  test('an empty registry denies everyone: the console fails closed', async () => {
    delete process.env.SIMULATION_OPS_OPERATORS;
    for (const entry of PUBLIC_MUTATIONS) {
      const { ctx } = anonymousCtx();
      await expect(registered(entry)._handler(ctx, commandArgsFor(entry))).rejects.toThrow(OPS_UNAUTHORIZED);
    }
  });

  test('forged operator credentials are refused', async () => {
    process.env.SIMULATION_OPS_OPERATORS = REGISTRY;
    const forgeries = [
      { operatorId: 'op-real', operatorToken: 'wrong-token' },
      { operatorId: 'op-attacker', operatorToken: 'correct-horse-battery-staple' },
      { operatorId: 'op-real', operatorToken: '' },
      { operatorId: 'op-real' },
    ];
    for (const entry of PUBLIC_MUTATIONS) {
      for (const forgery of forgeries) {
        const { ctx, state } = anonymousCtx();
        await expect(
          registered(entry)._handler(ctx, { ...commandArgsFor(entry), ...forgery }),
        ).rejects.toThrow(OPS_UNAUTHORIZED);
        expect(state.touched).toBe(false);
      }
      // A forged verified identity: a subject that is in no registry.
      const { ctx, state } = forgedIdentityCtx('clerk|attacker');
      await expect(registered(entry)._handler(ctx, commandArgsFor(entry))).rejects.toThrow(OPS_UNAUTHORIZED);
      expect(state.touched).toBe(false);
    }
  });

  test('a VALID operator credential gets past the gate — so the refusals above discriminate', async () => {
    // The positive control. Every other test here proves a wrong credential is refused,
    // which a gate that denies EVERYONE would also pass -- a typo in the arg name it
    // reads, or a registry that no longer parses, would make the whole suite green for
    // the wrong reason. This is the one call that must NOT be refused.
    process.env.SIMULATION_OPS_OPERATORS = REGISTRY;
    // The shared-token path closes once an identity provider is configured.
    delete process.env.CLERK_JWT_ISSUER_DOMAIN;
    const entry = PUBLIC_MUTATIONS.find((candidate) => candidate.name === 'pauseWorld')!;
    const { ctx, state } = anonymousCtx();
    const outcome = await registered(entry)
      ._handler(ctx, { ...commandArgsFor(entry), operatorId: 'op-real', operatorToken: 'correct-horse-battery-staple' })
      .then(() => null, (error: Error) => error);

    // It got THROUGH authorization and on to the work: the `db` proxy is what stopped
    // it, one statement later. A denial here would mean the gate rejects valid
    // credentials too, and the negative tests prove nothing.
    expect(outcome?.message ?? '').not.toContain(OPS_UNAUTHORIZED);
    expect(outcome?.message ?? '').toContain('public caller reached the database');
    expect(state.touched).toBe(true);
  });

  test('every denial is the same, so a refusal leaks nothing about what exists', async () => {
    // The property is "no denial is distinguishable from any other", so the matrix has
    // to span genuinely different CAUSES of denial -- absent credential, wrong token,
    // unknown operator, unparseable registry -- not just different world ids under one
    // cause, which only ever exercised a single branch.
    const causes = [
      { registry: REGISTRY, credentials: {} },
      { registry: REGISTRY, credentials: { operatorId: 'op-real', operatorToken: 'wrong-token' } },
      { registry: REGISTRY, credentials: { operatorId: 'op-unknown', operatorToken: 'correct-horse-battery-staple' } },
      { registry: undefined, credentials: { operatorId: 'op-real', operatorToken: 'correct-horse-battery-staple' } },
      { registry: 'not-json-at-all', credentials: { operatorId: 'op-real', operatorToken: 'correct-horse-battery-staple' } },
    ];
    const messages = new Set<string>();
    for (const entry of PUBLIC_MUTATIONS) {
      for (const cause of causes) {
        for (const worldId of ['mistwood', 'no-such-world-at-all', SECRET_WORLD]) {
          if (cause.registry === undefined) delete process.env.SIMULATION_OPS_OPERATORS;
          else process.env.SIMULATION_OPS_OPERATORS = cause.registry;
          const { ctx } = anonymousCtx();
          const call = registered(entry)._handler(ctx, { ...commandArgsFor(entry), ...cause.credentials, worldId });
          // Assert the rejection FIRST. A call that RESOLVES is the worst outcome this
          // suite can find -- an anonymous mutation that silently succeeded -- and it
          // would otherwise contribute no message and leave the set uniform anyway.
          await expect(call).rejects.toThrow(OPS_UNAUTHORIZED);
          messages.add(await call.then(() => 'RESOLVED', (error: Error) => error.message));
        }
      }
    }
    expect(messages.size).toBe(1);
    expect([...messages][0]).toContain(OPS_UNAUTHORIZED);
  });

  test('character-control payloads are refused server-side, not merely hidden', async () => {
    process.env.SIMULATION_OPS_OPERATORS = REGISTRY;
    // The a16z-shaped inputs a retired client would have sent. Passing them changes
    // nothing: the caller is still unauthorized, and the extra fields are not inputs
    // this API has.
    const controlPayload = {
      playerId: 'p-1',
      characterId: 'char-a',
      destination: { x: 4, y: 9 },
      action: 'moveTo',
      message: 'hello',
      conversationId: 'conv-1',
    };
    for (const entry of PUBLIC_MUTATIONS) {
      const { ctx, state } = anonymousCtx();
      await expect(
        registered(entry)._handler(ctx, { ...commandArgsFor(entry), ...controlPayload }),
      ).rejects.toThrow(OPS_UNAUTHORIZED);
      expect(state.touched).toBe(false);
    }
  });

  test('no public function even declares a character-control argument', () => {
    // The stronger half of AC#7: these are not rejected inputs, they are not inputs.
    // Convex validates against `exportArgs()` before a handler runs, so a field absent
    // here cannot be supplied at all.
    for (const entry of ALLOWED) {
      const declaredArgs = Object.keys(
        (JSON.parse(registered(entry).exportArgs()) as { value?: Record<string, unknown> }).value ?? {},
      );
      for (const forbidden of ['playerId', 'characterId', 'destination', 'message', 'conversationId', 'action']) {
        expect(declaredArgs).not.toContain(forbidden);
      }
    }
  });
});

describe('AC#8 — forged identifiers fail safe and leak nothing', () => {
  test('a well-formed but nonexistent worldId returns null, not an error and not data', async () => {
    // Regression guard: this behaviour is already correct and must stay that way.
    const store = await seededStore();
    expect(await serveReadModel(store, 'w-does-not-exist', 'liveState' as ReadModelKind, 'live:w-does-not-exist')).toBeNull();
  });

  test("another world's modelRef does not cross worlds", async () => {
    const store = await seededStore();
    expect(await serveReadModel(store, 'w-other', 'liveState' as ReadModelKind, `live:${SECRET_WORLD}`)).toBeNull();
  });

  test('a blank worldId or an unknown modelKind is rejected without naming stored data', async () => {
    const store = await seededStore();
    const failures: string[] = [];
    for (const attempt of [
      () => serveReadModel(store, '   ', 'liveState' as ReadModelKind, 'live:x'),
      () => serveReadModel(store, SECRET_WORLD, 'notAKind' as ReadModelKind, `live:${SECRET_WORLD}`),
      () => serveReadModel(store, SECRET_WORLD, 'liveState' as ReadModelKind, '  '),
    ]) {
      await attempt().catch((error: Error) => failures.push(error.message));
    }
    expect(failures).toHaveLength(3);
    for (const message of failures) {
      expect(message).toContain('READ_MODEL_INVALID_SHAPE');
      // The refusal must not echo a stored value, a table name, or the world it guards.
      expect(message).not.toContain('public headline');
      expect(message).not.toContain('publishedReadModels');
      expect(message).not.toContain(SECRET_WORLD);
    }
  });

  test('a forged runtime clock can no longer be supplied at all', () => {
    // GAP 6: `getPublicRuntimeSnapshot` used to accept a caller `nowMs`, which decided
    // the freshness verdict -- so anyone could make a stale snapshot report `live`.
    const declaredArgs = Object.keys(
      (JSON.parse((runtimeSnapshotFunctions.getPublicRuntimeSnapshot as unknown as Registered).exportArgs()) as {
        value?: Record<string, unknown>;
      }).value ?? {},
    );
    expect(declaredArgs).toEqual(['worldId']);
    expect(declaredArgs).not.toContain('nowMs');
    const wiring = readFileSync(join(ROOT, 'convex/publicRead/runtimeSnapshotFunctions.ts'), 'utf8');
    expect(wiring).toContain('serveRuntimeSnapshot(runtimeSnapshotReadStore(ctx.db), args.worldId, Date.now())');
  });

  test('the server clock is validated: a non-finite instant is refused', async () => {
    const emptyStore: RuntimeSnapshotReadStore = { loadCurrent: () => Promise.resolve(null) };
    for (const nowMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      await expect(serveRuntimeSnapshot(emptyStore, 'mistwood', nowMs)).rejects.toThrow('RUNTIME_SNAPSHOT_INVALID_SHAPE');
    }
    await expect(serveRuntimeSnapshot(emptyStore, '   ', Date.now())).rejects.toThrow('RUNTIME_SNAPSHOT_INVALID_SHAPE');
    // A well-formed request for a world with no snapshot is null, not an error.
    expect(await serveRuntimeSnapshot(emptyStore, 'w-does-not-exist', Date.now())).toBeNull();
  });
});

describe('AC#5 — public viewing adds no LLM trace', () => {
  test('trace recording is internal and cannot be reached from a client', () => {
    expect((traces.recordTrace as unknown as Registered).isInternal).toBe(true);
    expect((traces.recordTrace as unknown as Registered).isPublic).toBeUndefined();
    expect(ALLOWED.some((entry) => entry.name === 'recordTrace')).toBe(false);
  });

  test('the public trace read exposes only non-generative metadata', () => {
    // Reading a trace must not become a way to read a prompt or a model response.
    const source = readFileSync(join(ROOT, 'convex/observability/llmTrace.ts'), 'utf8');
    const body = source.slice(source.indexOf('export function publicLlmTrace'));
    const exposed = [...body.slice(0, body.indexOf('}')).matchAll(/^\s{4}([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
    expect(exposed).toEqual(['schemaVersion', 'traceId', 'worldId', 'worldDay', 'finalStatus']);
    for (const forbidden of ['prompt', 'response', 'rawModelOutput', 'apiKey', 'messages']) {
      expect(exposed).not.toContain(forbidden);
    }
  });

  test('the public trace read RETURNS only the five public fields', async () => {
    // The assertion above reads source text; this one calls the function. A projection
    // that stopped being applied -- or a `returns` validator that never existed -- is
    // only visible by looking at what actually comes back.
    const stored = {
      _id: 'row-1', _creationTime: 1,
      schemaVersion: 1 as const, traceId: 'trace-1', worldId: SECRET_WORLD, worldDay: 4,
      runId: 'run-1', sceneId: 'scene-1', arcId: 'arc-1', characterIds: ['c-1'],
      model: 'gpt-secret-internal', promptVersion: 'v9', inputTokens: 1234, outputTokens: 99,
      latencyMs: 42, retryCount: 1, validationResult: 'passed' as const, finalStatus: 'succeeded' as const,
      recordedAt: 1_700_000_000_000,
    };
    const ctx = {
      db: { query: () => ({ withIndex: () => ({ unique: () => Promise.resolve(stored) }) }) },
      auth: { getUserIdentity: () => Promise.resolve(null) },
    };
    const served = await (traces.getTracePublic as unknown as Registered)._handler(ctx, { traceId: 'trace-1' });

    expect(Object.keys(served as object).sort()).toEqual(
      ['finalStatus', 'schemaVersion', 'traceId', 'worldDay', 'worldId'],
    );
    // Nothing about HOW the model was called survives the projection.
    const text = JSON.stringify(served);
    for (const leak of ['gpt-secret-internal', 'v9', '1234', 'run-1', 'scene-1', 'arc-1', 'c-1']) {
      expect(text).not.toContain(leak);
    }
    // An unknown trace is null, not an error: a miss must not confirm a hit.
    const emptyCtx = { db: { query: () => ({ withIndex: () => ({ unique: () => Promise.resolve(null) }) }) } };
    expect(await (traces.getTracePublic as unknown as Registered)._handler(emptyCtx, { traceId: 'nope' })).toBeNull();
  });

  test('the public trace read declares its return shape to Convex', () => {
    // Without a `returns` validator the server will serve whatever the handler happens
    // to build, so a refactor that dropped the projection would leak silently.
    const source = readFileSync(join(ROOT, 'convex/observability/traces.ts'), 'utf8');
    const publicQuery = source.slice(source.indexOf('export const getTracePublic'));
    expect(publicQuery).toContain('returns: v.union(publicLlmTraceValidator, v.null())');
    // And the validator it names permits exactly the five fields, so the declaration
    // cannot be widened without this failing.
    expect(Object.keys(publicLlmTraceValidator.fields)).toEqual(
      ['schemaVersion', 'traceId', 'worldId', 'worldDay', 'finalStatus'],
    );
  });

  test('no public read module can reach a provider, the simulation, or observability writes', () => {
    // A public read that could import the generation path could trigger one. The
    // boundary policy enforces this for the build; this is the product-side proof.
    const offenders = sourceFiles('convex/publicRead', CONVEX_ENTRY_EXTENSIONS).flatMap((path) => {
      const source = readFileSync(join(ROOT, path), 'utf8');
      return [...source.matchAll(/from\s+'([^']+)'/g)]
        .map((match) => match[1])
        .filter((specifier) => /\.\.\/(simulation|observability)\//.test(specifier) || /^(openai|@anthropic-ai|@google)/.test(specifier))
        .map((specifier) => `${path}: ${specifier}`);
    });
    expect(offenders).toEqual([]);
  });

  test('the anonymous read path is queries only — a query cannot schedule or write', () => {
    for (const entry of ALLOWED.filter((candidate) => candidate.gate === 'anonymous')) {
      expect(entry.kind).toBe('query');
      expect(registered(entry).isQuery).toBe(true);
    }
  });
});

describe('private data never survives a public read', () => {
  test('every private field is stripped at every nesting depth', async () => {
    const store = new MemoryReadStore();
    const seeded = {
      title: 'public title',
      prompt: 'SYSTEM: you are a narrator',
      apiKey: 'sk-live-should-never-appear',
      secret: 'classified',
      privateNote: 'operator only',
      token: 'bearer-abc',
      memory: ['what the character privately recalls'],
      knowledge: { private: 'hidden fact' },
      scenes: [
        {
          summary: 'public summary',
          prompt: 'nested prompt',
          characters: [{ name: '艾拉', memories: ['nested memory'], password: 'hunter2' }],
        },
      ],
    } as unknown as JsonValue;
    await commitReadModelVersion(store, {
      worldId: SECRET_WORLD,
      modelKind: 'liveState' as ReadModelKind,
      modelRef: `live:${SECRET_WORLD}`,
      payload: seeded,
      sourceEventIds: ['evt-1'],
      status: 'published',
      now: 1,
    });

    const served = await serveReadModel(store, SECRET_WORLD, 'liveState' as ReadModelKind, `live:${SECRET_WORLD}`);
    const text = JSON.stringify(served?.payload);
    for (const leak of [
      'SYSTEM: you are a narrator',
      'sk-live-should-never-appear',
      'classified',
      'operator only',
      'bearer-abc',
      'what the character privately recalls',
      'hidden fact',
      'nested prompt',
      'nested memory',
      'hunter2',
    ]) {
      expect(text).not.toContain(leak);
    }
    // What a viewer is meant to see is still there.
    expect(text).toContain('public title');
    expect(text).toContain('public summary');
    expect(text).toContain('艾拉');
  });

  test('the private-field strip is applied on the way out as well as on the way in', () => {
    // Defence in depth: a row persisted under an older contract cannot leak on read.
    expect(sanitizeForPublic({ prompt: 'x', ok: 1 } as unknown as JsonValue)).toEqual({ ok: 1 });
    const readModelSource = readFileSync(join(ROOT, 'convex/publicRead/readModel.ts'), 'utf8');
    expect(readModelSource).toContain('payload: sanitizeForPublic(served.payload)');
  });

  test('the dynamic projection forbids dialogue and private character interiority', () => {
    for (const field of ['dialogue', 'memory', 'memories', 'prompt', 'apiKey', 'token', 'secret', 'privateGoal', 'fear']) {
      expect(PUBLIC_DYNAMIC_FORBIDDEN_FIELDS).toContain(field);
    }
  });
});

describe('the deployment routes zero public HTTP endpoints', () => {
  test('convex/http.ts registers no route and no httpAction', () => {
    // GAP 2: `POST /replicate_webhook` was an unauthenticated httpAction that made the
    // server fetch an attacker-influenced URL and insert a row.
    const source = readFileSync(join(ROOT, 'convex/http.ts'), 'utf8');
    expect(source).not.toMatch(/http\.route\(/);
    expect(source).toContain('httpRouter()');
    expect(clientReachableRegistrations(source)).toEqual([]);
  });

  test('the music module and its button are gone, and replicate is not a dependency', () => {
    expect(existsSync(join(ROOT, 'convex/music.ts'))).toBe(false);
    expect(existsSync(join(ROOT, 'src/components/buttons/MusicButton.tsx'))).toBe(false);
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.replicate).toBeUndefined();
    expect(pkg.devDependencies?.replicate).toBeUndefined();
  });

  test('no httpAction is named anywhere under convex/, in any registration shape', () => {
    expect(policy.publicFunctionSurface.forbiddenRegistrations).toContain('httpAction');
    // Deliberately NOT `clientReachableRegistrations`: that regex anchors on an
    // assignment, and the idiomatic Convex route binds the action to no name at all.
    // Policy allows zero HTTP endpoints, so naming the identifier is the whole test.
    const offenders = sourceFiles('convex', CONVEX_ENTRY_EXTENSIONS).filter((path) =>
      namesHttpAction(readFileSync(join(ROOT, path), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  test('the inline http.route() shape — the one the extraction regex misses — is caught', () => {
    // A fixture, not the repo: this is the discriminating half. If it ever passes both
    // checks, the ban above has become decorative and a webhook can be re-added silently.
    const inline = [
      "import { httpRouter } from 'convex/server';",
      'const http = httpRouter();',
      "http.route({ path: '/replicate_webhook', method: 'POST', handler: httpAction(async (ctx, request) => {",
      "  await ctx.runMutation(internal.music.insert, await request.json());",
      '}) });',
      'export default http;',
    ].join('\n');
    // The blind spot itself, pinned so it cannot be mistaken for coverage.
    expect(clientReachableRegistrations(inline)).toEqual([]);
    // The identifier check is what actually stops it.
    expect(namesHttpAction(inline)).toBe(true);
    expect(namesHttpAction('export const hook = httpAction(async () => {});')).toBe(true);
    expect(namesHttpAction('const routes = [{ handler: httpAction(async () => {}) }];')).toBe(true);
    // Prose about the ban is not a registration; `convex/http.ts` documents it at length.
    expect(namesHttpAction('/** No `httpAction` may be added here. */')).toBe(false);
  });
});
