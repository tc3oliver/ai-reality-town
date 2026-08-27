/**
 * The audited safety-status override (FR-P004 / ART-132, AC#3).
 *
 * Handler-level, following the pattern `dynamicViewMetricsFunctions.test.ts` established: the
 * registered mutation's `_handler` is invoked directly with a fake `ctx`, so the authorization
 * gate, the ledger append and the projection refresh are exercised as they actually run rather
 * than as they are declared.
 *
 * Two claims carry this file. First, that an override never edits the classifier's row — the
 * fixture is stringified before and after every applied call, because a design where an
 * operator flipped the stored label would destroy both the verdict and the
 * `SAFETY_CLASSIFICATION_CONFLICT` invariant that depends on it, while still passing any test
 * that only checked the effective answer. Second, that the override actually reaches the public
 * surface: the last block runs the resulting tables back through the same join and the same
 * scene builder the rebuild uses, and asserts the scene is now a placeholder.
 */

import { getFunctionName } from 'convex/server';

import { readEffectiveSafetyLabels } from '../safety/effectiveSafetyLabels';
import {
  buildActiveScenePresentations,
  WITHHELD_SCENE_TITLE,
  type SceneEventLike,
  type SceneSafetyLabel,
} from '../publicRead/activeScenePresentation';
import { OPS_UNAUTHORIZED } from './operatorAuthorization';
import { overridePostGenerationSafetyLabel } from './safetyOverrideFunctions';

const WORLD_ID = 'mistwood';
const SCENE_ID = 'mistwood:3:evening:grouping:scene:1';
const CLASSIFICATION_ID = `${SCENE_ID}:simulation:safety`;
const NOW = 1_700_000_000_000;
const REASON = 'a viewer report was upheld on review';

type Registered = {
  isMutation?: boolean;
  isPublic?: boolean;
  isInternal?: boolean;
  _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

const handler = overridePostGenerationSafetyLabel as unknown as Registered;

const REGISTRY = JSON.stringify([
  { operatorId: 'op-admin', role: 'admin', subjects: [], token: 'correct-horse-battery-staple' },
  { operatorId: 'op-plain', role: 'operator', subjects: [], token: 'a-different-long-token-value' },
]);

const ADMIN = { operatorId: 'op-admin', operatorToken: 'correct-horse-battery-staple' };
const OPERATOR = { operatorId: 'op-plain', operatorToken: 'a-different-long-token-value' };

// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Tables = {
  postGenerationSafetyClassifications: Row[];
  safetyStatusOverrides: Row[];
  operatorAuditLog: Row[];
};

function classificationRow(label = 'withhold'): Row {
  return {
    policyVersion: 1,
    worldId: WORLD_ID,
    classificationId: CLASSIFICATION_ID,
    sourceId: SCENE_ID,
    kind: 'scene',
    label,
    reasonCodes: ['EXTREME_VIOLENCE_DETAIL'],
    warningCodes: [],
    classifiedTextHash: 'fnv1a32:deadbeef',
    createdAt: 1_000,
  };
}

function emptyTables(over: Partial<Tables> = {}): Tables {
  return {
    postGenerationSafetyClassifications: [classificationRow()],
    safetyStatusOverrides: [],
    operatorAuditLog: [],
    ...over,
  };
}

/**
 * Index ORDER is modelled, not just index filtering: `safetyStatusOverrides` is keyed
 * `['worldId', 'sourceId', 'createdAt']`, and the handler's post-write verification reads the
 * newest row with `.order('desc').take(1)`. A fake that returned insertion order would make the
 * backdating test below pass for the wrong reason — insertion order and `createdAt` order are
 * exactly what diverge in that case.
 */
function fakeDb(tables: Tables) {
  return {
    query(table: keyof Tables) {
      let rows = [...tables[table]].sort((left, right) =>
        Number(left.createdAt ?? 0) - Number(right.createdAt ?? 0));
      const chain = {
        withIndex(_name: string, build: (q: unknown) => unknown) {
          const constraints: Array<[string, unknown]> = [];
          const q = { eq(field: string, value: unknown) { constraints.push([field, value]); return q; } };
          build(q);
          rows = rows.filter((row) => constraints.every(([field, value]) => row[field] === value));
          return chain;
        },
        order(direction: 'asc' | 'desc') {
          if (direction === 'desc') rows = [...rows].reverse();
          return chain;
        },
        take(count: number) { return Promise.resolve(rows.slice(0, count)); },
        collect() { return Promise.resolve(rows); },
        unique() { return Promise.resolve(rows[0] ?? null); },
        first() { return Promise.resolve(rows[0] ?? null); },
      };
      return chain;
    },
    insert(table: keyof Tables, row: Row) {
      tables[table].push(row);
      return Promise.resolve(`${table}-${tables[table].length}`);
    },
  };
}

function operatorCtx(tables: Tables, rebuildResult: Row = {}) {
  const rebuilds: Row[] = [];
  const ctx = {
    auth: { getUserIdentity: () => Promise.resolve(null) },
    db: fakeDb(tables),
    runMutation: (ref: unknown, args: Row) => {
      // Recorded WITH the function it targets. Since ART-125 the override refreshes several
      // independent read models and "a rebuild ran" is no longer the same claim as "all of them
      // did" — ART-46 added a third, and this assertion is what caught its absence.
      const target = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
      rebuilds.push({ target, ...args });
      if (target.includes('rebuildOnboardingSummary')) {
        return Promise.resolve({ modelRef: `onboarding:${WORLD_ID}`, version: 3, deduplicated: false });
      }
      if (target.includes('refreshVoteConsequenceProjections')) {
        return Promise.resolve({ modelRefs: [`voteConsequence:${WORLD_ID}:7`], rebuiltDayCount: 1 });
      }
      return Promise.resolve({
        modelRef: `live:${WORLD_ID}`,
        version: 7,
        // The rebuild answers "how many accepted events does this Scene actually govern".
        // Defaulted to 1 so the ordinary path reads as "this reached content"; the
        // uncorrelated case sets it to 0 explicitly.
        correlatedEventCount: 1,
        ...rebuildResult,
      });
    },
  };
  return { ctx, rebuilds };
}

/** A `ctx` whose database throws on any access, to prove the gate refuses before it reads. */
function anonymousCtx() {
  const db = new Proxy({}, {
    get(_target, property) {
      throw new Error(`unauthorized caller reached the database: .${String(property)}`);
    },
  });
  return {
    auth: { getUserIdentity: () => Promise.resolve(null) },
    db,
    runMutation: () => Promise.reject(new Error('unauthorized caller reached a mutation')),
  };
}

const args = (over: Row = {}) => ({
  ...ADMIN,
  worldId: WORLD_ID,
  reason: REASON,
  classificationId: CLASSIFICATION_ID,
  label: 'allow',
  now: NOW,
  ...over,
});

describe('overridePostGenerationSafetyLabel — authorization comes first', () => {
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

  it('is a public mutation, so the gate is the only thing between a client and the ledger', () => {
    expect(handler.isMutation).toBe(true);
    expect(handler.isPublic).toBe(true);
    expect(handler.isInternal).toBeFalsy();
  });

  it('refuses an unauthenticated caller before reading a single row', async () => {
    await expect(handler._handler(anonymousCtx(), {
      worldId: WORLD_ID, reason: REASON, classificationId: CLASSIFICATION_ID, label: 'allow', now: NOW,
    })).rejects.toThrow(OPS_UNAUTHORIZED);
  });

  it('refuses an operator who is not an administrator', async () => {
    // Releasing content the safety classifier refused is the highest-consequence publication
    // decision in the system; being trusted to pause a world does not confer it.
    await expect(handler._handler(anonymousCtx(), {
      ...OPERATOR, worldId: WORLD_ID, reason: REASON, classificationId: CLASSIFICATION_ID, label: 'allow', now: NOW,
    })).rejects.toThrow(OPS_UNAUTHORIZED);
  });

  it('refuses forged credentials and an empty registry alike, with the same error', async () => {
    await expect(handler._handler(anonymousCtx(), args({ operatorToken: 'guessed' })))
      .rejects.toThrow(OPS_UNAUTHORIZED);
    process.env.SIMULATION_OPS_OPERATORS = '[]';
    await expect(handler._handler(anonymousCtx(), args())).rejects.toThrow(OPS_UNAUTHORIZED);
  });

  it('refuses a blank reason, so no override is applied without one', async () => {
    const tables = emptyTables();
    await expect(handler._handler(operatorCtx(tables).ctx, args({ reason: '  ' }))).rejects.toThrow();
    // The audit row and the ledger row are written in the same transaction, so a refused
    // audit means a refused override. Here that is asserted directly.
    expect(tables.safetyStatusOverrides).toHaveLength(0);
  });

  it('refuses an override of a classification that does not exist', async () => {
    const tables = emptyTables({ postGenerationSafetyClassifications: [] });
    await expect(handler._handler(operatorCtx(tables).ctx, args()))
      .rejects.toThrow('SAFETY_CLASSIFICATION_NOT_FOUND');
    expect(tables.safetyStatusOverrides).toHaveLength(0);
  });
});

describe('overridePostGenerationSafetyLabel — the ledger is additive and audited', () => {
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

  it('appends the override, audits it, and leaves the classification row byte-identical', async () => {
    const tables = emptyTables();
    const before = JSON.stringify(tables.postGenerationSafetyClassifications);
    const { ctx, rebuilds } = operatorCtx(tables);

    const result = await handler._handler(ctx, args({ label: 'allow' }));

    expect(tables.safetyStatusOverrides).toEqual([{
      worldId: WORLD_ID,
      // Recorded against the SCENE. The classification run is kept alongside it as part of the
      // account of what the operator was reading, but it is not what the ledger is keyed on.
      sourceId: SCENE_ID,
      classificationId: CLASSIFICATION_ID,
      label: 'allow',
      reason: REASON,
      actor: 'op-admin',
      createdAt: NOW,
    }]);
    // THE INVARIANT: the classifier's verdict is still readable, unchanged, afterwards.
    expect(JSON.stringify(tables.postGenerationSafetyClassifications)).toBe(before);
    expect(result).toMatchObject({
      classificationId: CLASSIFICATION_ID,
      sourceId: SCENE_ID,
      originalLabel: 'withhold',
      effectiveLabel: 'allow',
      correlatedEventCount: 1,
      createdAt: NOW,
      refresh: { modelRef: `live:${WORLD_ID}`, version: 7 },
      // ART-125: the onboarding summary is the SECOND cached public text surface built from the
      // same Canon summaries. Reported separately so an operator can see both were re-derived.
      onboardingRefresh: { modelRef: `onboarding:${WORLD_ID}`, version: 3 },
      // ART-46: the THIRD such surface, and the only one keyed per world day. Reported as a
      // list because one withhold can touch several days, and because nothing else would ever
      // rebuild a past day — the commit pipeline only refreshes a bounded trailing window.
      voteConsequenceRefresh: [`voteConsequence:${WORLD_ID}:7`],
    });

    expect(tables.operatorAuditLog).toHaveLength(1);
    expect(tables.operatorAuditLog[0]).toMatchObject({
      worldId: WORLD_ID,
      operatorId: 'op-admin',
      role: 'admin',
      capability: 'safety.override',
      target: SCENE_ID,
      reason: REASON,
      outcome: 'applied',
      resultCode: 'SAFETY_LABEL_ALLOW',
      at: NOW,
    });
    // AC#3: the public projections are rebuilt in the same call, not at some later commit, and
    // the dynamic one is told which Scene to report correlation for.
    //
    // EVERY cached public text surface is refreshed, and this list is deliberately exhaustive —
    // it is the check that fails when someone adds a read model carrying Canon text and forgets
    // the safety path. It has now done that twice: ART-125's onboarding summary and ART-46's
    // per-day consequence model. Rebuilding only the live projection would leave the other two
    // quoting the withheld sentence until the next Canon commit, which on a paused or finished
    // world never comes — and for a past world day, never at all.
    //
    // If you are here because you added a surface: add it to `refreshPublicTextModels`, not to
    // the handler.
    expect(rebuilds).toEqual([
      {
        target: 'publicRead/liveStateFunctions:rebuildLiveProjection',
        worldId: WORLD_ID, now: NOW, correlateSceneId: SCENE_ID,
      },
      {
        target: 'publicRead/onboardingSummaryFunctions:rebuildOnboardingSummary',
        worldId: WORLD_ID, now: NOW,
      },
      {
        target: 'publicRead/voteConsequenceProjectionFunctions:refreshVoteConsequenceProjections',
        worldId: WORLD_ID, now: NOW,
      },
    ]);
  });

  it('appends a second override rather than replacing the first', async () => {
    const tables = emptyTables();
    const { ctx } = operatorCtx(tables);
    await handler._handler(ctx, args({ label: 'allow', now: NOW }));
    await handler._handler(ctx, args({ label: 'withhold', now: NOW + 60_000 }));

    // Both decisions survive, in order, with their reasons and their actors — which is the
    // whole reason this is a ledger and not a column.
    expect(tables.safetyStatusOverrides.map((row) => row.label)).toEqual(['allow', 'withhold']);
    expect(tables.operatorAuditLog).toHaveLength(2);
  });

  it('never writes to Canon, and names no Canon table', async () => {
    const tables = emptyTables();
    const { ctx } = operatorCtx(tables);
    await handler._handler(ctx, args());
    // `fakeDb` only knows three tables; a write to any other would have thrown on the way in.
    expect(Object.keys(tables)).toEqual([
      'postGenerationSafetyClassifications', 'safetyStatusOverrides', 'operatorAuditLog',
    ]);
  });
});

describe('AC#3 — a safety status update removes the affected text from the public projection', () => {
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

  const PUBLISHED_TEXT = '眾人在磨坊達成協議。';
  const EVENTS: readonly SceneEventLike[] = [{
    eventId: 'mistwood#event#1',
    sequenceNumber: 1,
    worldDay: 3,
    timeSlot: 'evening',
    acceptedAt: 2_000,
    locationId: 'mistwood-mill',
    participantIds: ['wu-zhen'],
    publicSummary: PUBLISHED_TEXT,
    stateChanges: [],
    sceneId: SCENE_ID,
  }];

  /** The scene half of a rebuild, run against whatever the ledger says right now. */
  async function rebuildScenes(tables: Tables) {
    const labels = await readEffectiveSafetyLabels(
      fakeDb(tables) as unknown as Parameters<typeof readEffectiveSafetyLabels>[0],
      WORLD_ID,
      [SCENE_ID],
    );
    return buildActiveScenePresentations({
      acceptedEvents: EVENTS,
      arcMemberships: [],
      publishedEpisodeScenes: [],
      excludedCharacterIds: new Set<string>(),
      sceneSafetyLabels: new Map<string, SceneSafetyLabel>(Object.entries(labels)),
    }).scenes;
  }

  it('publishes the text while the classifier allowed it, and withdraws it after the override', async () => {
    const tables = emptyTables({ postGenerationSafetyClassifications: [classificationRow('allow')] });

    const before = await rebuildScenes(tables);
    expect(before[0].summary).toBe(PUBLISHED_TEXT);
    expect(before[0].publicationStatus).toBe('published');

    await handler._handler(operatorCtx(tables).ctx, args({ label: 'withhold' }));

    const after = await rebuildScenes(tables);
    expect(after[0].title).toBe(WITHHELD_SCENE_TITLE);
    expect(after[0].summary).toBe('');
    expect(after[0].publicationStatus).toBe('withheld');
    expect(JSON.stringify(after)).not.toContain(PUBLISHED_TEXT);
    // The scene is still THERE, with its provenance intact: withholding removes words, not
    // the world (AC#4/#5).
    expect(after[0].sourceEventIds).toEqual(['mistwood#event#1']);
    expect(after[0].locationId).toBe('mistwood-mill');
  });

  it('restores the text when a later override releases it again', async () => {
    const tables = emptyTables({ postGenerationSafetyClassifications: [classificationRow('allow')] });
    await handler._handler(operatorCtx(tables).ctx, args({ label: 'withhold', now: NOW }));
    expect((await rebuildScenes(tables))[0].publicationStatus).toBe('withheld');

    await handler._handler(operatorCtx(tables).ctx, args({ label: 'allow', now: NOW + 60_000 }));
    const released = await rebuildScenes(tables);
    expect(released[0].summary).toBe(PUBLISHED_TEXT);
    expect(released[0].publicationStatus).toBe('published');
    // And the whole decision history is still on the record.
    expect(tables.safetyStatusOverrides).toHaveLength(2);
  });
});

describe('an override that does not take effect fails loudly', () => {
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

  /**
   * `createdAt` comes from the caller's `now`, and "latest wins" is decided by `createdAt`. An
   * override submitted at or below an existing one's timestamp — a replayed request, a skewed
   * operator clock, a copy-pasted `now` — appends a row that loses that comparison and changes
   * nothing. Reporting it as a success would be the worst failure available to a safety
   * control: the operator believes the content is down, stops looking, and it is still public.
   */
  it('refuses a backdated timestamp instead of reporting a false success', async () => {
    const tables = emptyTables({
      postGenerationSafetyClassifications: [classificationRow('allow')],
      safetyStatusOverrides: [{
        worldId: WORLD_ID, sourceId: SCENE_ID, classificationId: CLASSIFICATION_ID,
        label: 'withhold', reason: 'earlier decision', actor: 'op-admin', createdAt: NOW,
      }],
    });

    await expect(handler._handler(operatorCtx(tables).ctx, args({ label: 'allow', now: NOW - 1 })))
      .rejects.toThrow('SAFETY_OVERRIDE_NOT_APPLIED');
  });

  it('applies an override sharing a timestamp with the one it supersedes', async () => {
    // A tie is NOT a backdate. The console's clock has millisecond resolution and an operator
    // can correct themselves inside one; the row appended second is the later decision, which
    // is both what `by_world_source_and_created` returns last and what
    // `resolveEffectiveSafetyLabel` picks. This test is the one that would fail if those two
    // ever stopped agreeing — and they must agree, because one is the rebuild's gate and the
    // other is this command's verification.
    const tables = emptyTables({
      postGenerationSafetyClassifications: [classificationRow('allow')],
      safetyStatusOverrides: [{
        worldId: WORLD_ID, sourceId: SCENE_ID, classificationId: CLASSIFICATION_ID,
        label: 'withhold', reason: 'earlier decision', actor: 'op-admin', createdAt: NOW,
      }],
    });
    const result = await handler._handler(operatorCtx(tables).ctx, args({ label: 'allow', now: NOW }));
    expect(result).toMatchObject({ effectiveLabel: 'allow' });
  });

  it('still applies an override whose timestamp genuinely moves the ledger forward', async () => {
    const tables = emptyTables({
      postGenerationSafetyClassifications: [classificationRow('allow')],
      safetyStatusOverrides: [{
        worldId: WORLD_ID, sourceId: SCENE_ID, classificationId: CLASSIFICATION_ID,
        label: 'withhold', reason: 'earlier decision', actor: 'op-admin', createdAt: NOW,
      }],
    });
    const result = await handler._handler(operatorCtx(tables).ctx, args({ label: 'allow', now: NOW + 1 }));
    expect(result).toMatchObject({ effectiveLabel: 'allow' });
  });

  it('reports the label the ledger actually resolves to, never the one that was asked for', async () => {
    // The returned `effectiveLabel` is re-read from the ledger after the append. Proved here by
    // the only route that can separate the two: a request whose label does not win.
    const tables = emptyTables({
      postGenerationSafetyClassifications: [classificationRow('allow')],
      safetyStatusOverrides: [{
        worldId: WORLD_ID, sourceId: SCENE_ID, classificationId: CLASSIFICATION_ID,
        label: 'human_review_required', reason: 'earlier decision', actor: 'op-admin', createdAt: NOW + 5_000,
      }],
    });
    await expect(handler._handler(operatorCtx(tables).ctx, args({ label: 'withhold' })))
      .rejects.toThrow('still resolves to human_review_required');
  });
});

describe('FR-P004 — an override that correlates to no content says so', () => {
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

  it('returns zero and audits a no_op when the Scene governs no accepted event', async () => {
    // `metadata.sceneId` is stamped only on events committed after ART-132 shipped. An override
    // of a Scene whose events predate it is a legitimate decision that changes nothing
    // observable — and an operator must be able to tell that from one that took effect, or they
    // will believe they have withheld content that is still on the map.
    const tables = emptyTables();
    const { ctx } = operatorCtx(tables, { correlatedEventCount: 0 });

    const result = await handler._handler(ctx, args({ label: 'withhold' }));

    expect(result).toMatchObject({ correlatedEventCount: 0, effectiveLabel: 'withhold' });
    expect(tables.operatorAuditLog[0]).toMatchObject({
      outcome: 'no_op',
      resultCode: 'SAFETY_LABEL_WITHHOLD_UNCORRELATED',
      target: SCENE_ID,
    });
    // The decision is still on the record: "changed nothing observable" is not "was refused".
    expect(tables.safetyStatusOverrides).toHaveLength(1);
  });

  it('audits an applied outcome when the Scene does govern accepted events', async () => {
    const tables = emptyTables();
    const { ctx } = operatorCtx(tables, { correlatedEventCount: 4 });
    const result = await handler._handler(ctx, args({ label: 'withhold' }));
    expect(result).toMatchObject({ correlatedEventCount: 4 });
    expect(tables.operatorAuditLog[0]).toMatchObject({
      outcome: 'applied',
      resultCode: 'SAFETY_LABEL_WITHHOLD',
    });
  });
});
