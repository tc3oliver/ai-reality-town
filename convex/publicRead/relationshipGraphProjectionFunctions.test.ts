/**
 * The relationship-graph WIRING (FR-I007 / ART-44).
 *
 * ## Why this file exists
 *
 * `relationshipGraphProjection.test.ts` covers the pure builder, and the two post-commit harnesses
 * run the real builder through the real pipeline — but both harnesses RE-IMPLEMENT the assembly
 * rather than calling `rebuildRelationshipGraphProjection`, so neither is evidence about this
 * layer. That is the same shape of gap that let ART-95's delta-as-level defect survive: the pure
 * builder was always handed the right kind of value, and nothing tested the code that decided what
 * to hand it.
 *
 * The wiring is where ART-46's real defects lived — unbounded reads, a validator fed its own
 * input, wrong rebuild ordering — so it is tested here directly, against the registered handler,
 * over an in-memory `db`.
 *
 * The `memoryCtx` shim is the one from `episodeTimelineProjectionFunctions.test.ts`: index
 * constraints are `eq` chains, so filtering the captured constraints reproduces them.
 */

import { rebuildRelationshipGraphProjection } from './relationshipGraphProjectionFunctions';
import { relationshipGraphModelRef } from '../shared/relationshipGraphRef';
import {
  RELATIONSHIP_GRAPH_MAX_NODES,
  RELATIONSHIP_GRAPH_MODEL_KIND,
  type RelationshipGraphProjection,
} from './relationshipGraphProjection';

const WORLD_ID = 'mistwood';
const TODAY = 7;

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const handler = rebuildRelationshipGraphProjection as unknown as Registered;

function memoryCtx(tables: Tables) {
  const db = {
    query(table: string) {
      return {
        withIndex(_index: string, build?: (q: unknown) => unknown) {
          const constraints: Row = {};
          const builder = {
            eq(field: string, value: unknown) {
              constraints[field] = value;
              return builder;
            },
          };
          if (build) build(builder);
          const matched = (tables[table] ?? []).filter((row) =>
            Object.entries(constraints).every(([field, value]) => row[field] === value));
          const ascending = [...matched].sort((left, right) =>
            Number(left.createdAt ?? 0) - Number(right.createdAt ?? 0));
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
  return { db } as Parameters<typeof handler._handler>[0];
}

/** One accepted event carrying one `relationship_changed` state change. */
function relationshipEvent(input: {
  sequenceNumber: number;
  worldDay: number;
  source: string;
  target: string;
  visibility: 'public' | 'private';
  trustDelta?: number;
  reason?: string;
}): Row {
  return {
    worldId: WORLD_ID,
    sequenceNumber: input.sequenceNumber,
    acceptedAt: 1_000 + input.sequenceNumber,
    validationVersion: 'canon-v1',
    traceId: `trace-${input.sequenceNumber}`,
    payload: {
      schemaVersion: 1,
      worldId: WORLD_ID,
      idempotencyKey: `event-${input.sequenceNumber}`,
      proposedBy: { type: 'system' },
      worldDay: input.worldDay,
      timeSlot: 'evening',
      eventType: 'relationship_change',
      participantIds: [input.source, input.target],
      causedByEventIds: [],
      publicSummary: null,
      stateChanges: [{
        type: 'relationship_changed',
        sourceCharacterId: input.source,
        targetCharacterId: input.target,
        trustDelta: input.trustDelta ?? 10,
        affectionDelta: 0,
        resentmentDelta: 0,
        fearDelta: 0,
        dependencyDelta: 0,
        familiarityDelta: 0,
        reason: input.reason ?? '兩人在磨坊起了爭執',
        visibility: input.visibility,
      }],
    },
  };
}

function lifecycleRow(arcId: string, status: string): Row {
  return { worldId: WORLD_ID, arcId, status };
}

/** An arc projection revision. `fields` is what `parseArcProjectionFields` reads. */
function arcProjectionRow(arcId: string, revision: number, over: Record<string, unknown> = {}): Row {
  return {
    worldId: WORLD_ID,
    arcId,
    revision,
    // The COMPLETE `ArcProjectionFields` shape. `parseArcProjectionFields` rejects unknown keys
    // and requires every one of these, so a partial fixture would fail the parse rather than the
    // assertion — which is exactly what the first version of this file did, and is the reason
    // testing the wiring against the real parser is worth doing at all.
    fields: {
      title: `標題-r${revision}`,
      premise: '兩派因磨坊停工而對立。',
      currentQuestion: '審計會揭露什麼?',
      coreCharacterIds: ['he-jun', 'zhao-ming'],
      incitingEventId: `${WORLD_ID}#event#0`,
      latestTurningPointEventId: null,
      essentialFactIds: [],
      unresolvedQuestions: [],
      resolvedQuestions: [],
      recommendedEntryEventId: null,
      heatScore: 50,
      ...over,
    },
  };
}

function baseTables(over: Partial<Tables> = {}): Tables {
  return {
    canonEvents: [
      relationshipEvent({ sequenceNumber: 0, worldDay: TODAY, source: 'he-jun', target: 'zhao-ming', visibility: 'public' }),
    ],
    storyArcLifecycles: [lifecycleRow('arc-mill', 'escalating')],
    storyArcProjectionEvents: [arcProjectionRow('arc-mill', 0)],
    publishedReadModels: [],
    ...over,
  };
}

async function rebuild(tables: Tables, targetWorldDay = TODAY) {
  const result = await handler._handler(memoryCtx(tables), {
    worldId: WORLD_ID, targetWorldDay, now: 5_000,
  }) as { modelRef: string; version: number; deduplicated: boolean };
  return result;
}

/** The payload the rebuild published, read back out of the store. */
function publishedPayload(tables: Tables): RelationshipGraphProjection {
  const rows = (tables.publishedReadModels ?? []).filter((row) => row.isCurrent);
  expect(rows).toHaveLength(1);
  return rows[0].payload as RelationshipGraphProjection;
}

describe('the rebuild publishes through the ordinary read-model store', () => {
  it('publishes one current version under the shared modelRef and kind', async () => {
    const tables = baseTables();
    const result = await rebuild(tables);
    expect(result.modelRef).toBe(relationshipGraphModelRef(WORLD_ID, TODAY));
    expect(result.version).toBe(1);
    const row = (tables.publishedReadModels ?? [])[0];
    expect(row.modelKind).toBe(RELATIONSHIP_GRAPH_MODEL_KIND);
    expect(row.status).toBe('published');
    expect(row.isCurrent).toBe(true);
  });

  it('is idempotent — an unchanged world dedups instead of appending a version', async () => {
    const tables = baseTables();
    await rebuild(tables);
    const second = await rebuild(tables);
    expect(second.deduplicated).toBe(true);
    expect(second.version).toBe(1);
    expect(tables.publishedReadModels).toHaveLength(1);
  });

  it('rejects a nonsensical target day rather than publishing for one', async () => {
    for (const targetWorldDay of [-1, 1.5]) {
      await expect(rebuild(baseTables(), targetWorldDay)).rejects.toThrow(/RELATIONSHIP_GRAPH_INVALID/);
    }
  });
});

describe('reading the arc rows (the part no harness exercises)', () => {
  /**
   * Revisions are appended, so an updated arc has several rows. Reading the wrong one publishes a
   * stale title and — worse — a stale `coreCharacterIds`, which silently changes who the graph is
   * scoped to.
   *
   * Run in BOTH row orders on purpose. A single ascending fixture is passed by an implementation
   * that takes the last row; a single descending one is passed by an implementation that takes the
   * first. The first version of this test used an order in which "first" and "highest" happened to
   * coincide, and a fault injection that replaced the revision comparison with "keep the first"
   * did not fail it. Only the pair pins the actual rule.
   */
  it.each([
    ['ascending', [0, 1, 2]],
    ['descending', [2, 1, 0]],
  ] as Array<[string, number[]]>)(
    'uses the HIGHEST-revision projection row, whatever order the rows arrive in (%s)',
    async (_order, revisions) => {
      const coreFor = (revision: number) => (revision === 2 ? ['he-jun', 'zhao-ming'] : [`stale-r${revision}`]);
      const tables = baseTables({
        storyArcProjectionEvents: revisions.map((revision) =>
          arcProjectionRow('arc-mill', revision, { coreCharacterIds: coreFor(revision) })),
      });
      await rebuild(tables);
      const payload = publishedPayload(tables);
      expect(payload.arc?.title).toBe('標題-r2');
      expect(payload.nodes.map((node) => node.characterId)).toEqual(['he-jun', 'zhao-ming']);
    },
  );

  it('drops an arc whose lifecycle exists but which has no projection row', async () => {
    // The `flatMap(… ?? [])` in the wiring. A lifecycle with no projection has no title and no
    // core characters, so admitting it would scope the graph to nobody while naming an arc.
    const tables = baseTables({
      storyArcLifecycles: [lifecycleRow('arc-ghost', 'climax'), lifecycleRow('arc-mill', 'escalating')],
      // `arc-ghost` is at `climax` and would OUTRANK `arc-mill` if it were admitted.
      storyArcProjectionEvents: [arcProjectionRow('arc-mill', 0)],
    });
    await rebuild(tables);
    const payload = publishedPayload(tables);
    expect(payload.arc?.arcId).toBe('arc-mill');
    expect(payload.nodes.map((node) => node.characterId)).toEqual(['he-jun', 'zhao-ming']);
  });

  it('publishes an empty graph when the world has no arc at all', async () => {
    const tables = baseTables({ storyArcLifecycles: [], storyArcProjectionEvents: [] });
    await rebuild(tables);
    const payload = publishedPayload(tables);
    expect(payload.arc).toBeNull();
    expect(payload.nodes).toEqual([]);
  });

  it('reads arcs scoped to this world, not every world in the table', async () => {
    const tables = baseTables({
      storyArcLifecycles: [
        { worldId: 'other-world', arcId: 'arc-elsewhere', status: 'climax' },
        lifecycleRow('arc-mill', 'escalating'),
      ],
      storyArcProjectionEvents: [
        { worldId: 'other-world', arcId: 'arc-elsewhere', revision: 0, fields: arcProjectionRow('arc-elsewhere', 0).fields },
        arcProjectionRow('arc-mill', 0),
      ],
    });
    await rebuild(tables);
    expect(publishedPayload(tables).arc?.arcId).toBe('arc-mill');
  });
});

describe('reading Canon (the privacy boundary, at the layer that chooses the input)', () => {
  it('folds public relationship changes into edges', async () => {
    const tables = baseTables();
    await rebuild(tables);
    const payload = publishedPayload(tables);
    expect(payload.edges).toHaveLength(1);
    expect(payload.edges[0].pairKey).toBe('he-jun:zhao-ming');
    expect(payload.edges[0].dimensions.trust).toBe(10);
    expect(payload.edges[0].recentChanges[0].reason).toBe('兩人在磨坊起了爭執');
  });

  it('never publishes a private change — not its level, its reason, or its existence', async () => {
    /**
     * The wiring's half of the privacy property. `groupPublicRelationships` applies the filter,
     * but only if this layer hands it Canon's `relationshipHistory` rather than Canon's
     * accumulated `relationships`, which folds private deltas in with public ones and is
     * internal-only for exactly that reason.
     *
     * The private change here is worth 90 trust. If it ever reaches the payload, the number is
     * unmistakable.
     */
    const tables = baseTables({
      canonEvents: [
        relationshipEvent({ sequenceNumber: 0, worldDay: TODAY, source: 'he-jun', target: 'zhao-ming', visibility: 'public', trustDelta: 5 }),
        relationshipEvent({
          sequenceNumber: 1, worldDay: TODAY, source: 'he-jun', target: 'zhao-ming',
          visibility: 'private', trustDelta: 90, reason: '一個不該公開的祕密',
        }),
        relationshipEvent({
          sequenceNumber: 2, worldDay: TODAY, source: 'he-jun', target: 'secret-friend',
          visibility: 'private', trustDelta: 40, reason: '另一個祕密',
        }),
      ],
    });
    await rebuild(tables);
    const payload = publishedPayload(tables);
    expect(payload.edges[0].dimensions.trust).toBe(5);
    // The pair whose ONLY history is private is absent entirely — not present at zero, which
    // would itself disclose that something happened between them.
    expect(payload.nodes.map((node) => node.characterId)).not.toContain('secret-friend');
    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain('不該公開');
    expect(serialised).not.toContain('另一個祕密');
    expect(serialised).not.toContain('secret-friend');
  });

  it('publishes no character text at all (ART-132 retroactive withhold)', async () => {
    // The node set is graph structure only; 人物摘要 is the view's live `character:<id>` read,
    // because a past day's graph is never rebuilt and could not honour a later withhold.
    const tables = baseTables();
    await rebuild(tables);
    for (const node of publishedPayload(tables).nodes) {
      expect(Object.keys(node).sort()).toEqual(['characterId', 'edgeCount', 'hop', 'isCoreCharacter']);
    }
  });

  it('reads Canon scoped to this world', async () => {
    /**
     * Sequence numbers are PER WORLD and both worlds start at 0, which is what Canon actually
     * assigns (`deriveEventId(worldId, sequenceNumber)`).
     *
     * The first version of this test numbered across the two worlds and left this world's log
     * starting at 1, which `replayWorldEvents` rejected with `SEQUENCE_GAP`. That is a real
     * property of the wiring worth stating: the rebuild replays the reducer, so it depends on the
     * world-scoped read returning a GAPLESS log. A read that leaked another world's rows in — or
     * dropped one of this world's — fails loudly here rather than publishing a partial graph.
     */
    const tables = baseTables({
      canonEvents: [
        { ...relationshipEvent({ sequenceNumber: 0, worldDay: TODAY, source: 'he-jun', target: 'outsider', visibility: 'public' }), worldId: 'other-world' },
        relationshipEvent({ sequenceNumber: 0, worldDay: TODAY, source: 'he-jun', target: 'zhao-ming', visibility: 'public' }),
      ],
    });
    await rebuild(tables);
    expect(publishedPayload(tables).nodes.map((node) => node.characterId)).not.toContain('outsider');
  });
});

describe('the published payload honours the scope at the wiring layer too', () => {
  it('applies the seven-day window against the target day it was called with', async () => {
    const tables = baseTables({
      canonEvents: [
        relationshipEvent({ sequenceNumber: 0, worldDay: TODAY, source: 'he-jun', target: 'recent', visibility: 'public' }),
        relationshipEvent({ sequenceNumber: 1, worldDay: TODAY - 8, source: 'he-jun', target: 'stale', visibility: 'public' }),
      ],
    });
    await rebuild(tables);
    const ids = publishedPayload(tables).nodes.map((node) => node.characterId);
    expect(ids).toContain('recent');
    expect(ids).not.toContain('stale');
  });

  it('never publishes more than the NFR-002 node limit', async () => {
    const canonEvents = Array.from({ length: 90 }, (_unused, index) => relationshipEvent({
      sequenceNumber: index,
      worldDay: TODAY,
      source: 'he-jun',
      target: `neighbour-${String(index).padStart(3, '0')}`,
      visibility: 'public',
    }));
    const tables = baseTables({ canonEvents });
    await rebuild(tables);
    const payload = publishedPayload(tables);
    expect(payload.nodes.length).toBe(RELATIONSHIP_GRAPH_MAX_NODES);
    expect(payload.omittedNodeCount).toBeGreaterThan(0);
    expect(payload.nodes.length + payload.omittedNodeCount).toBe(payload.candidateNodeCount);
  });

  it('stamps provenance from the changes it actually published', async () => {
    const tables = baseTables();
    await rebuild(tables);
    const row = (tables.publishedReadModels ?? [])[0];
    const payload = publishedPayload(tables);
    expect(row.sourceEventIds).toEqual(payload.sourceEventIds);
    expect(payload.sourceEventIds.length).toBeGreaterThan(0);
  });
});
