/**
 * The administrator's publication decision (FR-K004 / ART-171).
 *
 * Two harnesses, because two different claims need proving and one harness cannot make both.
 *
 * **A recorded-dispatch ctx** for the gate: who may call, what they must supply, and — the part
 * that has been forgotten twice in this repository — the EXACT set of surfaces the decision
 * refreshes. It records the function each `runMutation` targets rather than counting calls,
 * because "a rebuild ran" and "all of them did" stopped being the same claim at ART-125.
 *
 * **A real-dispatch ctx** for the consequence: the actual `advancePublication`,
 * `rebuildEpisodeProjection` and `refreshViewerKnowledgeProjections` handlers over one shared
 * table set. That is what settles ART-171's AC#5 — that publishing an Episode makes the secret
 * its events revealed reach the character page — through the real join rather than by asserting
 * that a mutation was called. The three remaining refreshes (live, onboarding, voteConsequence)
 * are stubbed there deliberately: they are proven in their own suites and in
 * `safetyOverrideFunctions.test.ts`, and dispatching them here would drag a Live-projection
 * fixture into a test about publication.
 */

import { getFunctionName } from 'convex/server';

import { composeCharacterViewModel, type CharacterViewerKnowledgeInput } from '../../src/components/public/characterRoute';
import type { StateChange } from '../canon/model';
import { rebuildEpisodeProjection } from '../publicRead/episodeTimelineProjectionFunctions';
import { refreshViewerKnowledgeProjections } from '../publicRead/viewerKnowledgeProjectionFunctions';
import { advancePublication } from '../editorial/publicationLifecycleFunctions';
import { rebuildViewerKnowledgeProjections } from '../publicRead/viewerKnowledgeProjectionFunctions';
import { viewerKnowledgeModelRef } from '../shared/viewerKnowledgeRef';
import { OPS_UNAUTHORIZED } from './operatorAuthorization';
import { decideEpisodePublication } from './publicationControlFunctions';

const WORLD_ID = 'mistwood';
const WORLD_DAY = 5;
const CONTENT_REF = `episode:${WORLD_ID}:${WORLD_DAY}`;
const CHARACTER_ID = 'zhao-ming';
const SECRET_ID = 'secret-zhaoming-payments';
const SECRET_CONTENT = 'Zhao Ming found payments to a dormant station account.';
const NOW = 1_700_000_000_000;
const REASON = 'the editor signed off on day five';

type Registered = {
  isMutation?: boolean;
  isPublic?: boolean;
  isInternal?: boolean;
  _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

const handler = decideEpisodePublication as unknown as Registered;

const REGISTRY = JSON.stringify([
  { operatorId: 'op-admin', role: 'admin', subjects: [], token: 'correct-horse-battery-staple' },
  { operatorId: 'op-plain', role: 'operator', subjects: [], token: 'a-different-long-token-value' },
]);
const ADMIN = { operatorId: 'op-admin', operatorToken: 'correct-horse-battery-staple' };
const OPERATOR = { operatorId: 'op-plain', operatorToken: 'a-different-long-token-value' };

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/** The `db` double, modelled on `viewerKnowledgeProjectionFunctions.test.ts`'s. */
function memoryDb(tables: Tables) {
  return {
    query(table: string) {
      return {
        withIndex(_index: string, build?: (q: unknown) => unknown) {
          const constraints: Row = {};
          const builder = {
            eq(field: string, value: unknown) { constraints[field] = value; return builder; },
            gt() { return builder; },
          };
          if (build) build(builder);
          const matched = (tables[table] ?? []).filter((row) =>
            Object.entries(constraints).every(([field, value]) => row[field] === value));
          const ascending = [...matched].sort((left, right) =>
            Number(left.sequenceNumber ?? left.worldDay ?? left.createdAt ?? 0)
            - Number(right.sequenceNumber ?? right.worldDay ?? right.createdAt ?? 0));
          const chain = (rows: Row[]) => ({
            order: (direction: 'asc' | 'desc') => chain(direction === 'desc' ? [...rows].reverse() : rows),
            take: (n: number) => Promise.resolve(rows.slice(0, n)),
            collect: () => Promise.resolve(rows),
            first: () => Promise.resolve(rows[0] ?? null),
            unique: () => Promise.resolve(rows[0] ?? null),
          });
          return chain(ascending);
        },
      };
    },
    insert(table: string, row: Row) {
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
}

function canonRow(sequenceNumber: number, stateChanges: StateChange[]): Row {
  return {
    worldId: WORLD_ID,
    sequenceNumber,
    worldDay: WORLD_DAY,
    acceptedAt: 1_000 + sequenceNumber,
    validationVersion: 'canon-v1',
    traceId: `trace-${sequenceNumber}`,
    payload: {
      schemaVersion: 1, worldId: WORLD_ID, idempotencyKey: `event-${sequenceNumber}`,
      proposedBy: { type: 'system' }, worldDay: WORLD_DAY, timeSlot: 'evening',
      eventType: 'conversation', participantIds: [CHARACTER_ID], causedByEventIds: [],
      publicSummary: null, stateChanges,
    },
  };
}

const eventIdOf = (sequenceNumber: number) => `${WORLD_ID}#event#${sequenceNumber}`;

const revealingFact: StateChange = {
  type: 'fact_created', subjectType: 'character', subjectId: CHARACTER_ID,
  predicate: 'ledgerFinding', value: SECRET_CONTENT, visibility: 'public',
} as StateChange;

function baseTables(publicationStatus = 'ready'): Tables {
  return {
    canonEvents: [canonRow(0, [revealingFact])],
    canonSnapshots: [],
    worldSecrets: [{
      worldId: WORLD_ID, secretId: SECRET_ID,
      payload: { id: SECRET_ID, content: SECRET_CONTENT, initialKnowerCharacterIds: [CHARACTER_ID] },
    }],
    dailyEpisodes: [{
      worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: WORLD_DAY, status: 'ready',
      sourceEventIds: [eventIdOf(0)], createdAt: 1_000,
      episode: {
        schemaVersion: 1, worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: WORLD_DAY,
        title: '第五日', headline: '帳本離開了磨坊', oneLineSummary: '一份舊帳本在夜裡被搬走。',
        keyScenes: [{ title: '磨坊夜話', summary: '兩人在磨坊裡談了很久。', sourceEventIds: [eventIdOf(0)] }],
        relationshipChanges: [], newQuestions: [], resolvedQuestions: [],
        arcIds: [], characterIds: [CHARACTER_ID], nextEpisodeTease: '明天會怎樣?',
        sourceEventIds: [eventIdOf(0)],
      },
    }],
    publicationRecords: [{
      worldId: WORLD_ID, contentRef: CONTENT_REF, contentKind: 'episode',
      publicationId: `pub:${CONTENT_REF}:1`, status: publicationStatus, version: 1, isCurrent: true,
      schemaVersion: 1, audit: [], createdAt: 1_000, updatedAt: 1_000,
    }],
    publishedReadModels: [],
    postGenerationSafetyClassifications: [],
    safetyStatusOverrides: [],
    worldSchedules: [{ worldId: WORLD_ID, mode: 'live', status: 'running', publishEnabled: true }],
    operatorAuditLog: [],
  };
}

// ---------------------------------------------------------------------------
// The gate, over a recorded dispatch
// ---------------------------------------------------------------------------

function recordingCtx(tables: Tables) {
  const dispatched: Row[] = [];
  const ctx = {
    auth: { getUserIdentity: () => Promise.resolve(null) },
    db: memoryDb(tables),
    runMutation: (ref: unknown, args: Row) => {
      const target = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
      dispatched.push({ target, ...args });
      if (target.includes('advancePublication')) {
        return Promise.resolve({ publicationId: `pub:${CONTENT_REF}:1`, status: 'published', version: 1 });
      }
      if (target.includes('rebuildEpisodeProjection')) {
        return Promise.resolve({ modelRef: `episode:${WORLD_DAY}`, version: 2, deduplicated: false, withdrawnVersions: [] });
      }
      if (target.includes('rebuildLiveProjection')) {
        return Promise.resolve({ modelRef: `live:${WORLD_ID}`, version: 4, correlatedEventCount: 0 });
      }
      if (target.includes('rebuildOnboardingSummary')) {
        return Promise.resolve({ modelRef: `onboarding:${WORLD_ID}`, version: 3 });
      }
      if (target.includes('refreshVoteConsequenceProjections')) {
        return Promise.resolve({ modelRefs: [], rebuiltDayCount: 0 });
      }
      if (target.includes('refreshViewerKnowledgeProjections')) {
        return Promise.resolve({ modelRefs: [viewerKnowledgeModelRef(CHARACTER_ID)], rebuiltCharacterCount: 1 });
      }
      throw new Error(`undispatched mutation ${target}`);
    },
  };
  return { ctx, dispatched };
}

const args = (over: Row = {}) => ({
  ...ADMIN, worldId: WORLD_ID, worldDay: WORLD_DAY, decision: 'publish', reason: REASON, now: NOW, ...over,
});

describe('decideEpisodePublication — authorization comes first', () => {
  const previous = process.env.SIMULATION_OPS_OPERATORS;
  beforeEach(() => { process.env.SIMULATION_OPS_OPERATORS = REGISTRY; });
  afterAll(() => { process.env.SIMULATION_OPS_OPERATORS = previous; });

  it('is a public mutation, so the gate is the only thing between a client and the lifecycle', () => {
    expect(handler.isMutation).toBe(true);
    expect(handler.isPublic).toBe(true);
    expect(handler.isInternal).toBeFalsy();
  });

  it('refuses an operator who is not an administrator', async () => {
    // FR-K004 reserves these actions for an administrator. The pure lifecycle would refuse too,
    // but only AFTER the record had been read — the console gate must refuse first.
    const tables = baseTables();
    const { ctx, dispatched } = recordingCtx(tables);
    await expect(handler._handler(ctx, args(OPERATOR))).rejects.toThrow(OPS_UNAUTHORIZED);
    expect(dispatched).toEqual([]);
    expect(tables.operatorAuditLog).toEqual([]);
  });

  it('refuses an unauthenticated caller and an empty registry alike', async () => {
    const { ctx } = recordingCtx(baseTables());
    await expect(handler._handler(ctx, {
      worldId: WORLD_ID, worldDay: WORLD_DAY, decision: 'publish', reason: REASON, now: NOW,
    })).rejects.toThrow(OPS_UNAUTHORIZED);

    // An unset registry denies everyone: the console fails closed, so even the correct admin
    // token is refused.
    process.env.SIMULATION_OPS_OPERATORS = '';
    const closed = recordingCtx(baseTables());
    await expect(handler._handler(closed.ctx, args())).rejects.toThrow(OPS_UNAUTHORIZED);
    expect(closed.dispatched).toEqual([]);
    process.env.SIMULATION_OPS_OPERATORS = REGISTRY;
  });

  it('refuses a blank reason before anything is applied', async () => {
    const tables = baseTables();
    const { ctx, dispatched } = recordingCtx(tables);
    await expect(handler._handler(ctx, args({ reason: '   ' })))
      .rejects.toThrow(/PUBLICATION_REASON_REQUIRED/);
    expect(dispatched).toEqual([]);
  });

  it('refuses a world day that cannot address an Episode', async () => {
    const { ctx, dispatched } = recordingCtx(baseTables());
    await expect(handler._handler(ctx, args({ worldDay: -1 })))
      .rejects.toThrow(/PUBLICATION_INVALID_DAY/);
    await expect(handler._handler(ctx, args({ worldDay: 1.5 })))
      .rejects.toThrow(/PUBLICATION_INVALID_DAY/);
    expect(dispatched).toEqual([]);
  });
});

describe('decideEpisodePublication — the surface follows the decision', () => {
  const previous = process.env.SIMULATION_OPS_OPERATORS;
  beforeEach(() => { process.env.SIMULATION_OPS_OPERATORS = REGISTRY; });
  afterAll(() => { process.env.SIMULATION_OPS_OPERATORS = previous; });

  it('refreshes EVERY cached public surface, and the Episode read model, in one transaction', async () => {
    const tables = baseTables();
    const { ctx, dispatched } = recordingCtx(tables);
    const result = await handler._handler(ctx, args()) as { viewerKnowledgeRefresh: string[] };

    // Exhaustive and ORDERED. The transition first — nothing may re-derive a surface from a
    // record that has not moved yet — then the Episode read model, then the shared refresh list.
    expect(dispatched.map(({ target }) => target)).toEqual([
      'editorial/publicationLifecycleFunctions:advancePublication',
      'publicRead/episodeTimelineProjectionFunctions:rebuildEpisodeProjection',
      'publicRead/liveStateFunctions:rebuildLiveProjection',
      'publicRead/onboardingSummaryFunctions:rebuildOnboardingSummary',
      'publicRead/voteConsequenceProjectionFunctions:refreshVoteConsequenceProjections',
      'publicRead/viewerKnowledgeProjectionFunctions:refreshViewerKnowledgeProjections',
    ]);
    // FR-I005's is reported back, because it is the surface a release changes most.
    expect(result.viewerKnowledgeRefresh).toEqual([viewerKnowledgeModelRef(CHARACTER_ID)]);
  });

  it('passes the operator through as the lifecycle actor, never a hard-coded one', async () => {
    const { ctx, dispatched } = recordingCtx(baseTables());
    await handler._handler(ctx, args());
    expect(dispatched[0]).toMatchObject({
      contentRef: CONTENT_REF,
      action: 'publish',
      actor: { type: 'admin', id: 'op-admin' },
      reason: REASON,
      now: NOW,
    });
  });

  it('reports the status the transition RETURNED, not the one that was asked for', async () => {
    const tables = baseTables();
    const { ctx } = recordingCtx(tables);
    const result = await handler._handler(ctx, args({ decision: 'withhold' })) as { status: string; decision: string };
    // The stub returns `published` whatever was asked. Echoing the request would have reported a
    // withhold that never happened — the same failure mode `safetyOverrideFunctions` guards
    // against by re-reading its ledger.
    expect(result.decision).toBe('withhold');
    expect(result.status).toBe('published');
  });

  it('audits the decision with the operator, the content and the resulting status', async () => {
    const tables = baseTables();
    const { ctx } = recordingCtx(tables);
    await handler._handler(ctx, args());
    expect(tables.operatorAuditLog).toHaveLength(1);
    expect(tables.operatorAuditLog[0]).toMatchObject({
      worldId: WORLD_ID,
      capability: 'publication.decide',
      target: CONTENT_REF,
      reason: REASON,
      outcome: 'applied',
      resultCode: 'PUBLICATION_PUBLISHED',
    });
  });
});

// ---------------------------------------------------------------------------
// The consequence, over the REAL handlers (AC#5)
// ---------------------------------------------------------------------------

const REAL_DISPATCH: Record<string, Registered> = {
  'editorial/publicationLifecycleFunctions:advancePublication': advancePublication as unknown as Registered,
  'publicRead/episodeTimelineProjectionFunctions:rebuildEpisodeProjection': rebuildEpisodeProjection as unknown as Registered,
  'publicRead/viewerKnowledgeProjectionFunctions:refreshViewerKnowledgeProjections': refreshViewerKnowledgeProjections as unknown as Registered,
};

function realCtx(tables: Tables) {
  const ctx: { auth: unknown; db: unknown; runMutation: (ref: unknown, args: Row) => Promise<unknown> } = {
    auth: { getUserIdentity: () => Promise.resolve(null) },
    db: memoryDb(tables),
    runMutation: (ref: unknown, mutationArgs: Row) => {
      const target = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
      const real = REAL_DISPATCH[target];
      if (real) return real._handler(ctx, mutationArgs);
      // Stubbed on purpose: the Live projection, the onboarding summary and the per-day
      // consequence models are proven in their own suites and by
      // `safetyOverrideFunctions.test.ts`'s exhaustive refresh list. Dispatching them here would
      // drag a whole Live fixture into a test about publication and prove nothing extra.
      if (target.includes('rebuildLiveProjection')) return Promise.resolve({ modelRef: `live:${WORLD_ID}`, version: 1, correlatedEventCount: 0 });
      if (target.includes('rebuildOnboardingSummary')) return Promise.resolve({ modelRef: `onboarding:${WORLD_ID}`, version: 1 });
      if (target.includes('refreshVoteConsequenceProjections')) return Promise.resolve({ modelRefs: [] });
      throw new Error(`undispatched mutation ${target}`);
    },
  };
  return ctx;
}

/** The `viewerKnowledge` payload currently servable for the character, or null. */
function viewerKnowledgePayload(tables: Tables): CharacterViewerKnowledgeInput | null {
  const modelRef = viewerKnowledgeModelRef(CHARACTER_ID);
  const row = (tables.publishedReadModels ?? [])
    .filter((entry) => entry.isCurrent && entry.modelRef === modelRef).at(-1);
  return (row?.payload as CharacterViewerKnowledgeInput | undefined) ?? null;
}

const servableEpisodeVersions = (tables: Tables): number[] => (tables.publishedReadModels ?? [])
  .filter((row) => row.modelRef === `episode:${WORLD_DAY}` && (row.isCurrent || row.isLastKnownGood))
  .map((row) => Number(row.version));

describe('AC#5 — releasing an Episode puts its secret on the character page', () => {
  const previous = process.env.SIMULATION_OPS_OPERATORS;
  beforeEach(() => { process.env.SIMULATION_OPS_OPERATORS = REGISTRY; });
  afterAll(() => { process.env.SIMULATION_OPS_OPERATORS = previous; });

  /** Seed the viewer-knowledge model so the refresh (which reads the store) has a target. */
  async function seedViewerKnowledge(tables: Tables) {
    const seed = rebuildViewerKnowledgeProjections as unknown as Registered;
    await seed._handler(realCtx(tables), { worldId: WORLD_ID, characterIds: [CHARACTER_ID], now: NOW - 1 });
  }

  it('publishes nothing while the record is still `ready`', async () => {
    const tables = baseTables('ready');
    await seedViewerKnowledge(tables);
    const payload = viewerKnowledgePayload(tables);
    expect(payload?.viewerKnownSecrets).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain(SECRET_CONTENT);
  });

  it('makes the secret viewer-known the moment an administrator releases the day', async () => {
    const tables = baseTables('ready');
    await seedViewerKnowledge(tables);

    await handler._handler(realCtx(tables), args({ decision: 'publish' }));

    const payload = viewerKnowledgePayload(tables);
    expect(payload?.viewerKnownSecrets).toHaveLength(1);
    // Through the page's own model, so this is the sentence a viewer would read rather than a
    // row in a store. This is the whole chain FR-I005 asks for, end to end.
    const vm = composeCharacterViewModel({
      worldId: WORLD_ID,
      character: null,
      recentEvents: null,
      viewerKnowledge: payload,
    });
    expect(vm.viewerKnownSecrets).toEqual([{
      secretId: SECRET_ID,
      content: SECRET_CONTENT,
      revealedOnWorldDay: WORLD_DAY,
      episodeHref: `#episode/${WORLD_ID}/${WORLD_DAY}`,
    }]);
  });

  it('takes it straight back off when the administrator withholds the day', async () => {
    const tables = baseTables('ready');
    await seedViewerKnowledge(tables);
    await handler._handler(realCtx(tables), args({ decision: 'publish' }));
    expect(viewerKnowledgePayload(tables)?.viewerKnownSecrets).toHaveLength(1);

    await handler._handler(realCtx(tables), args({ decision: 'withhold', now: NOW + 1 }));

    const payload = viewerKnowledgePayload(tables);
    expect(payload?.viewerKnownSecrets).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain(SECRET_CONTENT);
  });

  it('withdraws the Episode read model itself, fallbacks included', async () => {
    const tables = baseTables('ready');
    await seedViewerKnowledge(tables);
    // Two published versions, so there IS a last-known-good to fall back to. Withdrawing only
    // the current row would leave the older copy of the same withheld Episode serving.
    await handler._handler(realCtx(tables), args({ decision: 'publish' }));
    await handler._handler(realCtx(tables), args({ decision: 'withhold', now: NOW + 1 }));
    await handler._handler(realCtx(tables), args({ decision: 'resume_to_ready', now: NOW + 2 }));
    expect(servableEpisodeVersions(tables).length).toBeGreaterThan(0);

    await handler._handler(realCtx(tables), args({ decision: 'withhold', now: NOW + 3 }));
    expect(servableEpisodeVersions(tables)).toEqual([]);
  });

  it('does not let the next accepted event republish a withheld Episode', async () => {
    // The reason `rebuildEpisodeProjection` had to become publication-aware. The post-commit
    // pipeline calls it on every accepted event; before ART-171 the very next commit would have
    // undone the administrator's withhold.
    const tables = baseTables('ready');
    await seedViewerKnowledge(tables);
    await handler._handler(realCtx(tables), args({ decision: 'publish' }));
    await handler._handler(realCtx(tables), args({ decision: 'withhold', now: NOW + 1 }));
    expect(servableEpisodeVersions(tables)).toEqual([]);

    const pipelineRebuild = rebuildEpisodeProjection as unknown as Registered;
    await pipelineRebuild._handler(realCtx(tables), { worldId: WORLD_ID, worldDay: WORLD_DAY, now: NOW + 2 });
    expect(servableEpisodeVersions(tables)).toEqual([]);
  });

  it('still publishes an Episode with no publication record at all', async () => {
    // Silence is not a refusal: an Episode that predates FR-K004 has no record, and treating
    // that as withheld would blank the public episode page for every world that predates it.
    const tables = baseTables('ready');
    tables.publicationRecords = [];
    const pipelineRebuild = rebuildEpisodeProjection as unknown as Registered;
    await pipelineRebuild._handler(realCtx(tables), { worldId: WORLD_ID, worldDay: WORLD_DAY, now: NOW });
    expect(servableEpisodeVersions(tables)).toEqual([1]);
  });

  it('refuses to publish into a world whose publication gate is closed', async () => {
    // ART-162's gate, applied by `advancePublication` and not restated here. An administrator
    // cannot override a suppressed world by hand — which is the asymmetry that gate is for.
    const tables = baseTables('ready');
    tables.worldSchedules[0].publishEnabled = false;
    await seedViewerKnowledge(tables);
    await expect(handler._handler(realCtx(tables), args({ decision: 'publish' })))
      .rejects.toThrow(/PUBLICATION_SUPPRESSED|publishEnabled/);
    // Nothing was published AT ALL, not merely nothing secret: the same gate that refuses the
    // transition also suppresses every read-model commit in a suppressed world
    // (`writeStore(...).publicationEnabled`), which is why the seed above wrote no row either.
    expect(viewerKnowledgePayload(tables)).toBeNull();
    expect(JSON.stringify(tables.publishedReadModels)).not.toContain(SECRET_CONTENT);
  });
});
