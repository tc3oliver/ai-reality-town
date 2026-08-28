/**
 * The scoped relationship graph (FR-I007 + NFR-002 / ART-44).
 *
 * Every criterion is tested with a NEGATIVE alongside the positive, because each of the three is
 * a claim about what the graph does NOT show, and a suite that only ever asserts presence would
 * pass just as happily on a builder that rendered the whole world.
 */

import {
  RELATIONSHIP_GRAPH_MAX_CHANGE_REASONS,
  RELATIONSHIP_GRAPH_MAX_NODES,
  RELATIONSHIP_GRAPH_MAX_REASON_CHARS,
  RELATIONSHIP_GRAPH_MODEL_KIND,
  RELATIONSHIP_GRAPH_NODE_ORDERING,
  RELATIONSHIP_GRAPH_RECENT_CHANGE_WINDOW_DAYS,
  RelationshipGraphError,
  assertRelationshipGraphBounds,
  buildRelationshipGraphProjection,
  dominantRelationshipType,
  isWithinRecentChangeWindow,
  selectCurrentArc,
  graphPairKey,
  groupPublicRelationships,
  type CanonRelationshipHistoryEntry,
  type GraphArcInput,
  type GraphRelationshipInput,
  type RelationshipGraphProjection,
} from './relationshipGraphProjection';
import { accumulatePublicRelationshipDimensions } from './relationshipArcProjection';

const WORLD_ID = 'mistwood';
const TODAY = 10;

function pairKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

/** One entry of Canon's `relationshipHistory`, in the shape the reducer records it. */
function canonEntry(over: Partial<CanonRelationshipHistoryEntry> = {}): CanonRelationshipHistoryEntry {
  return {
    sourceCharacterId: 'a',
    targetCharacterId: 'b',
    trustDelta: 1,
    affectionDelta: 0,
    resentmentDelta: 0,
    fearDelta: 0,
    dependencyDelta: 0,
    familiarityDelta: 0,
    reason: '兩人在磨坊起了爭執',
    visibility: 'public',
    sourceEventId: 'w#event#1',
    sequenceNumber: 1,
    worldDay: TODAY,
    ...over,
  };
}

function relationship(
  source: string,
  target: string,
  changes: ReadonlyArray<{ worldDay: number; reason?: string; trustDelta?: number; affectionDelta?: number; resentmentDelta?: number; fearDelta?: number; dependencyDelta?: number; familiarityDelta?: number }>,
  visibility = 'public',
): GraphRelationshipInput {
  return {
    pairKey: pairKey(source, target),
    sourceCharacterId: source,
    targetCharacterId: target,
    visibility,
    changeHistory: changes.map((change, index) => ({
      eventId: `${WORLD_ID}#event#${source}-${target}-${index}`,
      reason: change.reason ?? '兩人在磨坊起了爭執',
      worldDay: change.worldDay,
      trustDelta: change.trustDelta ?? 1,
      affectionDelta: change.affectionDelta ?? 0,
      resentmentDelta: change.resentmentDelta ?? 0,
      fearDelta: change.fearDelta ?? 0,
      dependencyDelta: change.dependencyDelta ?? 0,
      familiarityDelta: change.familiarityDelta ?? 0,
    })),
  };
}

function arc(over: Partial<GraphArcInput> = {}): GraphArcInput {
  return {
    arcId: 'arc:mistwood:50',
    title: '磨坊之爭',
    status: 'escalating',
    coreCharacterIds: ['he-jun', 'zhao-ming'],
    ...over,
  };
}

function build(over: {
  targetWorldDay?: number;
  arcs?: readonly GraphArcInput[];
  relationships?: readonly GraphRelationshipInput[];
} = {}): RelationshipGraphProjection {
  return buildRelationshipGraphProjection({
    worldId: WORLD_ID,
    targetWorldDay: over.targetWorldDay ?? TODAY,
    arcs: over.arcs ?? [arc()],
    relationships: over.relationships ?? [],
  });
}

const nodeIds = (projection: RelationshipGraphProjection) =>
  projection.nodes.map((node) => node.characterId);

// ---------------------------------------------------------------------------
// AC#1 — the DEFAULT scope: current-arc core people, one hop, last seven days.
// ---------------------------------------------------------------------------

describe('AC#1 — the default graph is current-arc core people, one hop, last seven days', () => {
  it('seeds from the current arc’s core characters', () => {
    const projection = build();
    expect(projection.arc).toEqual({ arcId: 'arc:mistwood:50', title: '磨坊之爭', status: 'escalating' });
    expect(nodeIds(projection)).toEqual(['he-jun', 'zhao-ming']);
    expect(projection.nodes.every((node) => node.isCoreCharacter && node.hop === 0)).toBe(true);
  });

  it('includes a core character with no recent relationship at all', () => {
    // 「當前 Arc 核心人物」 is a scope, not a filter on activity. A core character nobody has
    // interacted with this week is a fact about the arc, not an absence to hide.
    const projection = build({ relationships: [] });
    expect(nodeIds(projection)).toContain('zhao-ming');
    expect(projection.nodes.find((node) => node.characterId === 'zhao-ming')?.edgeCount).toBe(0);
  });

  it('adds one-hop neighbours, and does NOT add their neighbours', () => {
    const projection = build({
      relationships: [
        relationship('he-jun', 'lin-wan', [{ worldDay: TODAY }]),
        // Two hops: `lin-wan` is on the graph, but this pair touches no core character.
        relationship('lin-wan', 'chen-yu', [{ worldDay: TODAY }]),
      ],
    });
    expect(nodeIds(projection).sort()).toEqual(['he-jun', 'lin-wan', 'zhao-ming']);
    expect(nodeIds(projection)).not.toContain('chen-yu');
    // ...and the two-hop edge is not drawn either, not even between nodes that are both present.
    expect(projection.edges.map((edge) => edge.pairKey)).toEqual([pairKey('he-jun', 'lin-wan')]);
    /**
     * The two-hop pair is not a CANDIDATE either, which is the half of this claim the node and
     * edge lists alone cannot make.
     *
     * A fault injection that removed the one-hop filter left both lists identical — node
     * selection drops `chen-yu` anyway, so the edge dangles and is discarded downstream. What
     * changed was the accounting: `candidateEdgeCount` became 2 and the graph reported omitting a
     * relationship FR-I007 never scoped it to, which is a false statement about what a viewer is
     * missing. Asserting the counts is what makes the filter load-bearing.
     */
    expect(projection.candidateEdgeCount).toBe(1);
    expect(projection.omittedEdgeCount).toBe(0);
  });

  it('an edge between two one-hop neighbours is not drawn even when both are on the graph', () => {
    // Both `lin-wan` and `chen-yu` are neighbours of core characters, so both are nodes. The edge
    // BETWEEN them is still two hops from the arc, and drawing it would quietly widen the default.
    const projection = build({
      relationships: [
        relationship('he-jun', 'lin-wan', [{ worldDay: TODAY }]),
        relationship('zhao-ming', 'chen-yu', [{ worldDay: TODAY }]),
        relationship('lin-wan', 'chen-yu', [{ worldDay: TODAY }]),
      ],
    });
    expect(nodeIds(projection).sort()).toEqual(['chen-yu', 'he-jun', 'lin-wan', 'zhao-ming']);
    expect(projection.edges.map((edge) => edge.pairKey).sort())
      .toEqual([pairKey('he-jun', 'lin-wan'), pairKey('zhao-ming', 'chen-yu')].sort());
    expect(projection.candidateEdgeCount).toBe(2);
    expect(projection.omittedEdgeCount).toBe(0);
  });

  it('includes a change seven world days old and excludes one eight days old', () => {
    // The exact boundary FR-I007's 「最近七日」 turns on, pinned in both directions.
    const projection = build({
      relationships: [
        relationship('he-jun', 'seven-days', [{ worldDay: TODAY - 7 }]),
        relationship('he-jun', 'eight-days', [{ worldDay: TODAY - 8 }]),
      ],
    });
    expect(nodeIds(projection)).toContain('seven-days');
    expect(nodeIds(projection)).not.toContain('eight-days');
    expect(RELATIONSHIP_GRAPH_RECENT_CHANGE_WINDOW_DAYS).toBe(7);
  });

  it('excludes a pair whose only change is in the target day’s future', () => {
    // A day-3 graph that showed a day-6 change would not be a graph of day 3.
    const projection = build({
      targetWorldDay: 3,
      relationships: [relationship('he-jun', 'later', [{ worldDay: 6 }])],
    });
    expect(nodeIds(projection)).not.toContain('later');
    expect(projection.edges).toEqual([]);
  });

  it('publishes an empty graph, not a failure, when the world has no active arc', () => {
    const projection = build({ arcs: [arc({ status: 'resolved' }), arc({ arcId: 'arc:2', status: 'archived' })] });
    expect(projection.arc).toBeNull();
    expect(projection.nodes).toEqual([]);
    expect(projection.edges).toEqual([]);
    expect(projection.candidateNodeCount).toBe(0);
  });

  it('picks the arc nearest its peak when several are active, deterministically', () => {
    const climax = arc({ arcId: 'arc:climax', status: 'climax' });
    const active = arc({ arcId: 'arc:active', status: 'active' });
    expect(selectCurrentArc([active, climax])?.arcId).toBe('arc:climax');
    expect(selectCurrentArc([climax, active])?.arcId).toBe('arc:climax');
    // Same status ties break on arcId, so input order never decides.
    expect(selectCurrentArc([
      arc({ arcId: 'arc:b', status: 'active' }),
      arc({ arcId: 'arc:a', status: 'active' }),
    ])?.arcId).toBe('arc:a');
  });

  it('declares the relationship graph model kind', () => {
    expect(RELATIONSHIP_GRAPH_MODEL_KIND).toBe('relationshipGraph');
  });

  it('is deterministic — identical inputs produce an identical payload', () => {
    const relationships = [
      relationship('he-jun', 'lin-wan', [{ worldDay: TODAY }]),
      relationship('zhao-ming', 'chen-yu', [{ worldDay: TODAY - 1 }]),
    ];
    expect(build({ relationships })).toEqual(build({ relationships }));
  });
});

// ---------------------------------------------------------------------------
// AC#2 — date switching, type filtering, summaries, change reasons.
// ---------------------------------------------------------------------------

describe('AC#2 — date switching, relationship types, summaries, change reasons', () => {
  it('date switching moves the window, so a day-3 graph and a day-10 graph differ', () => {
    const relationships = [relationship('he-jun', 'lin-wan', [{ worldDay: 2 }])];
    const day3 = build({ targetWorldDay: 3, relationships });
    const day10 = build({ targetWorldDay: 10, relationships });
    // Day 3: the change is one day old, well inside the window.
    expect(nodeIds(day3)).toContain('lin-wan');
    // Day 10: the same change is eight days old and has aged out.
    expect(nodeIds(day10)).not.toContain('lin-wan');
    expect(day3.worldDay).toBe(3);
    expect(day10.worldDay).toBe(10);
  });

  it('date switching moves the LEVELS, not just the caption', () => {
    // The levels are re-folded over the changes up to the target day, so a graph of day 5 shows
    // where the relationship stood on day 5 — not today's numbers under yesterday's heading.
    const relationships = [relationship('he-jun', 'lin-wan', [
      { worldDay: 5, trustDelta: 10 },
      { worldDay: 9, trustDelta: 30 },
    ])];
    expect(build({ targetWorldDay: 5, relationships }).edges[0].dimensions.trust).toBe(10);
    expect(build({ targetWorldDay: 10, relationships }).edges[0].dimensions.trust).toBe(40);
  });

  it('types an edge by its dominant dimension and offers only the types present', () => {
    const projection = build({
      relationships: [
        relationship('he-jun', 'ally', [{ worldDay: TODAY, trustDelta: 40, resentmentDelta: 1 }]),
        relationship('zhao-ming', 'enemy', [{ worldDay: TODAY, trustDelta: 1, resentmentDelta: 40 }]),
      ],
    });
    const byPair = new Map(projection.edges.map((edge) => [edge.pairKey, edge]));
    expect(byPair.get(pairKey('he-jun', 'ally'))?.relationshipType).toBe('trust');
    expect(byPair.get(pairKey('zhao-ming', 'enemy'))?.relationshipType).toBe('resentment');
    // The filter is offered only the types that are actually on the graph — no empty options.
    expect(projection.relationshipTypes).toEqual(['trust', 'resentment']);
  });

  it('reports a relationship that has moved and moved back as neutral, not as nothing', () => {
    const projection = build({
      relationships: [relationship('he-jun', 'lin-wan', [
        { worldDay: TODAY - 1, trustDelta: 20 },
        { worldDay: TODAY, trustDelta: -20 },
      ])],
    });
    expect(projection.edges[0].relationshipType).toBe('neutral');
    expect(projection.edges[0].strength).toBe(0);
    // It is still an edge: the pair DID change this week, which is what the default is about.
    expect(nodeIds(projection)).toContain('lin-wan');
  });

  it('breaks a dominance tie on a fixed dimension order rather than on iteration order', () => {
    const tied = dominantRelationshipType({
      trust: 5, affection: 5, resentment: 5, fear: 5, dependency: 5, familiarity: 5,
    });
    expect(tied).toEqual({ relationshipType: 'trust', strength: 5 });
    // Magnitude, not sign: a strongly negative dimension is as dominant as a strongly positive one.
    expect(dominantRelationshipType({
      trust: 1, affection: 0, resentment: 0, fear: -40, dependency: 0, familiarity: 0,
    })).toEqual({ relationshipType: 'fear', strength: 40 });
  });

  it('carries each edge’s change reasons, newest first and bounded', () => {
    const projection = build({
      relationships: [relationship('he-jun', 'lin-wan', [
        { worldDay: TODAY - 3, reason: '第三舊' },
        { worldDay: TODAY - 2, reason: '第二舊' },
        { worldDay: TODAY - 1, reason: '第二新' },
        { worldDay: TODAY, reason: '最新' },
      ])],
    });
    const edge = projection.edges[0];
    expect(edge.recentChanges.map((change) => change.reason)).toEqual(['最新', '第二新', '第二舊']);
    expect(edge.recentChanges).toHaveLength(RELATIONSHIP_GRAPH_MAX_CHANGE_REASONS);
    // The count is published, so a view can say「另有 N 次變化」rather than implying there were three.
    expect(edge.changeCountInWindow).toBe(4);
    // Each change carries its own world day, so nothing has to be joined against the timeline.
    expect(edge.recentChanges[0].worldDay).toBe(TODAY);
    expect(edge.lastChangedWorldDay).toBe(TODAY);
  });

  it('bounds a long change reason instead of publishing a paragraph', () => {
    const projection = build({
      relationships: [relationship('he-jun', 'lin-wan', [{ worldDay: TODAY, reason: '爭'.repeat(200) }])],
    });
    const reason = projection.edges[0].recentChanges[0].reason;
    expect(reason.length).toBeLessThanOrEqual(RELATIONSHIP_GRAPH_MAX_REASON_CHARS);
    expect(reason.endsWith('…')).toBe(true);
  });

  it('publishes NO character text — 人物摘要 is the view’s read, not this payload’s', () => {
    /**
     * The safety property behind AC#2's 人物摘要, asserted as an absence.
     *
     * Character text is subject to ART-132's retroactive withhold, and a past day's graph is
     * never rebuilt, so a summary frozen into this payload could never self-heal. The node
     * therefore carries only graph structure and the view reads `character:<id>` live.
     *
     * Asserted over the node's own key set rather than by naming the fields that were removed:
     * a future field carrying character prose would fail this without anyone remembering to
     * extend the list.
     */
    const projection = build({
      relationships: [relationship('he-jun', 'lin-wan', [{ worldDay: TODAY }])],
    });
    expect(projection.nodes.length).toBeGreaterThan(0);
    for (const node of projection.nodes) {
      expect(Object.keys(node).sort())
        .toEqual(['characterId', 'edgeCount', 'hop', 'isCoreCharacter']);
    }
    // Nothing anywhere in the payload carries a name, a profile or an occupation.
    const serialised = JSON.stringify(projection);
    for (const field of ['"name"', '"summary"', '"publicProfile"', '"occupation"', '"alive"']) {
      expect(serialised).not.toContain(field);
    }
  });
});

// ---------------------------------------------------------------------------
// AC#3 — never the whole world, never more than thirty nodes, never silently.
// ---------------------------------------------------------------------------

describe('AC#3 — the default graph is bounded and says what it left out', () => {
  /** One core pair plus `count` neighbours of `he-jun`, all changed today. */
  function crowdedWorld(count: number, dayFor: (index: number) => number = () => TODAY) {
    return Array.from({ length: count }, (_unused, index) =>
      relationship('he-jun', `n${String(index).padStart(3, '0')}`, [{ worldDay: dayFor(index) }]));
  }

  it('never renders more than thirty nodes, however many qualify', () => {
    const projection = build({ relationships: crowdedWorld(200) });
    expect(projection.nodes).toHaveLength(RELATIONSHIP_GRAPH_MAX_NODES);
    expect(RELATIONSHIP_GRAPH_MAX_NODES).toBe(30);
  });

  it('reports what it omitted rather than truncating silently', () => {
    const projection = build({ relationships: crowdedWorld(200) });
    // 200 neighbours + 2 core characters qualified; 30 are rendered.
    expect(projection.candidateNodeCount).toBe(202);
    expect(projection.omittedNodeCount).toBe(202 - RELATIONSHIP_GRAPH_MAX_NODES);
    expect(projection.candidateEdgeCount).toBe(200);
    expect(projection.omittedEdgeCount).toBe(200 - projection.edges.length);
    // The two numbers are consistent with each other, which is what makes them checkable.
    expect(projection.nodes.length + projection.omittedNodeCount).toBe(projection.candidateNodeCount);
    expect(projection.edges.length + projection.omittedEdgeCount).toBe(projection.candidateEdgeCount);
  });

  it('truncates in the documented order — core first, then most recently changed', () => {
    // Neighbour `n000` changed today, `n001` yesterday, and so on: the oldest changes are the
    // ones that must be dropped.
    const projection = build({ relationships: crowdedWorld(40, (index) => TODAY - (index % 8)) });
    expect(projection.scope.nodeOrdering).toBe(RELATIONSHIP_GRAPH_NODE_ORDERING);
    // Both core characters survive, ahead of every neighbour.
    expect(nodeIds(projection).slice(0, 2)).toEqual(['he-jun', 'zhao-ming']);
    // Every retained neighbour changed at least as recently as every dropped one.
    const retained = new Set(nodeIds(projection));
    const ageOf = (index: number) => index % 8;
    const retainedAges = Array.from({ length: 40 }, (_u, i) => i)
      .filter((i) => retained.has(`n${String(i).padStart(3, '0')}`)).map(ageOf);
    const droppedAges = Array.from({ length: 40 }, (_u, i) => i)
      .filter((i) => !retained.has(`n${String(i).padStart(3, '0')}`)).map(ageOf);
    expect(Math.max(...retainedAges)).toBeLessThanOrEqual(Math.min(...droppedAges));
  });

  it('caps a core set that is itself over the limit, and still reports it', () => {
    // Not a shape this product produces. A cap that held except in the case nobody expected
    // would not be a cap.
    const core = Array.from({ length: 45 }, (_unused, index) => `core-${String(index).padStart(3, '0')}`);
    const projection = build({ arcs: [arc({ coreCharacterIds: core })] });
    expect(projection.nodes).toHaveLength(RELATIONSHIP_GRAPH_MAX_NODES);
    expect(projection.omittedNodeCount).toBe(15);
    // Truncated in the arc's own published order, so it is explicable.
    expect(nodeIds(projection)).toEqual(core.slice(0, RELATIONSHIP_GRAPH_MAX_NODES));
  });

  it('drops an edge whose far end lost the cap rather than drawing half of it', () => {
    const projection = build({ relationships: crowdedWorld(200) });
    const rendered = new Set(nodeIds(projection));
    for (const edge of projection.edges) {
      expect(rendered.has(edge.sourceCharacterId)).toBe(true);
      expect(rendered.has(edge.targetCharacterId)).toBe(true);
    }
  });

  it('never renders all characters and all relationships by default', () => {
    // FR-I007's 「不得預設渲染全部角色與全部關係」, stated as a test rather than as a promise: a
    // world with 60 residents and 200 public relationships publishes a graph of 30 and 28.
    const projection = build({ relationships: crowdedWorld(200) });
    expect(projection.nodes.length).toBeLessThan(62);
    expect(projection.edges.length).toBeLessThan(200);
    expect(projection.nodes.length).toBeLessThanOrEqual(RELATIONSHIP_GRAPH_MAX_NODES);
  });

  it('the bound assertion refuses an over-sized payload rather than publishing it', () => {
    const projection = build();
    const oversized: RelationshipGraphProjection = {
      ...projection,
      nodes: Array.from({ length: 31 }, (_unused, index) => ({
        characterId: `c${index}`, name: `c${index}`, summary: '', occupation: null, alive: true,
        isCoreCharacter: false, hop: 1 as const, edgeCount: 0,
      })),
      candidateNodeCount: 31,
      omittedNodeCount: 0,
    };
    expect(() => assertRelationshipGraphBounds(oversized)).toThrow(RelationshipGraphError);
    expect(() => assertRelationshipGraphBounds(oversized)).toThrow(/RELATIONSHIP_GRAPH_NODE_LIMIT/);
  });

  it('the bound assertion refuses a payload that under-reports its own truncation', () => {
    // The failure this exists for: a cap that drops nodes while claiming it dropped none still
    // satisfies「不超過 30」and is exactly the silent truncation AC#3 is about.
    const projection = build({ relationships: [relationship('he-jun', 'lin-wan', [{ worldDay: TODAY }])] });
    expect(() => assertRelationshipGraphBounds({ ...projection, candidateNodeCount: 99 }))
      .toThrow(/RELATIONSHIP_GRAPH_TRUNCATION_UNREPORTED/);
    expect(() => assertRelationshipGraphBounds({ ...projection, candidateEdgeCount: 99 }))
      .toThrow(/RELATIONSHIP_GRAPH_TRUNCATION_UNREPORTED/);
  });

  it('the bound assertion refuses a dangling edge and an out-of-window change', () => {
    const projection = build({ relationships: [relationship('he-jun', 'lin-wan', [{ worldDay: TODAY }])] });
    expect(() => assertRelationshipGraphBounds({
      ...projection,
      edges: [{ ...projection.edges[0], targetCharacterId: 'nobody' }],
    })).toThrow(/RELATIONSHIP_GRAPH_DANGLING_EDGE/);
    expect(() => assertRelationshipGraphBounds({
      ...projection,
      edges: [{
        ...projection.edges[0],
        recentChanges: [{ ...projection.edges[0].recentChanges[0], worldDay: TODAY - 40 }],
      }],
    })).toThrow(/RELATIONSHIP_GRAPH_WINDOW_VIOLATION/);
  });

  it('publishes the scope it was built under, so a view need not restate it', () => {
    expect(build().scope).toEqual({
      windowDays: RELATIONSHIP_GRAPH_RECENT_CHANGE_WINDOW_DAYS,
      nodeLimit: RELATIONSHIP_GRAPH_MAX_NODES,
      nodeOrdering: RELATIONSHIP_GRAPH_NODE_ORDERING,
    });
  });
});

// ---------------------------------------------------------------------------
// Privacy — the property that must survive every other change to this build.
// ---------------------------------------------------------------------------

describe('a private relationship never reaches the graph', () => {
  it('refuses the whole build rather than silently dropping the private pair', () => {
    // Failing loudly leaves the PREVIOUS published graph serving. Dropping the edge quietly would
    // publish a graph that looks complete and is not, and nothing downstream could tell.
    expect(() => build({
      relationships: [relationship('he-jun', 'secret', [{ worldDay: TODAY }], 'private')],
    })).toThrow(RelationshipGraphError);
    expect(() => build({
      relationships: [relationship('he-jun', 'secret', [{ worldDay: TODAY }], 'private')],
    })).toThrow(/RELATIONSHIP_GRAPH_PRIVATE/);
  });

  it('refuses a relationship whose visibility cannot be read at all', () => {
    expect(() => build({
      relationships: [relationship('he-jun', 'unknown', [{ worldDay: TODAY }], 'something-else')],
    })).toThrow(/RELATIONSHIP_GRAPH_PRIVATE/);
  });

  it('a private history entry never becomes an input in the first place', () => {
    // Defence in depth, one layer up: the Canon grouping applies the visibility filter, so a
    // private change contributes neither a level, nor a reason, nor the existence of an edge.
    expect(groupPublicRelationships([canonEntry({ visibility: 'private' })])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Grouping Canon's relationship history — where the graph becomes publication-safe.
// ---------------------------------------------------------------------------

describe('groupPublicRelationships (the privacy filter and the direction merge)', () => {
  it('keeps public entries and drops private ones', () => {
    const grouped = groupPublicRelationships([
      canonEntry({ sourceCharacterId: 'a', targetCharacterId: 'b', trustDelta: 5 }),
      canonEntry({ sourceCharacterId: 'a', targetCharacterId: 'b', trustDelta: 90, visibility: 'private' }),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].changeHistory.map((change) => change.trustDelta)).toEqual([5]);
  });

  it('a pair whose ONLY history is private does not appear at all', () => {
    /**
     * Not "appears at zero". An edge at neutral would itself disclose that something private
     * happened between these two — the exact leak `convex/canon/queries.ts` keeps
     * `getRelationshipProjection` internal for.
     */
    const grouped = groupPublicRelationships([
      canonEntry({ sourceCharacterId: 'a', targetCharacterId: 'secret', visibility: 'private' }),
    ]);
    expect(grouped).toEqual([]);
  });

  it('never folds a private delta into a public level', () => {
    // The arithmetic form of the leak: Canon's own `RelationshipState` would report 95 here,
    // which is why this build re-folds the public entries instead of reading it.
    const grouped = groupPublicRelationships([
      canonEntry({ sourceCharacterId: 'a', targetCharacterId: 'b', trustDelta: 5 }),
      canonEntry({ sourceCharacterId: 'a', targetCharacterId: 'b', trustDelta: 90, visibility: 'private' }),
    ]);
    const levels = accumulatePublicRelationshipDimensions(grouped[0].changeHistory);
    expect(levels.trust).toBe(5);
  });

  it('merges both directions of a pair into one undirected edge, in sequence order', () => {
    // Canon's key is directional (`source|target`), so a mutual falling-out is two histories.
    // Picking one direction would report half of it.
    const grouped = groupPublicRelationships([
      canonEntry({ sourceCharacterId: 'b', targetCharacterId: 'a', sequenceNumber: 2, trustDelta: -3 }),
      canonEntry({ sourceCharacterId: 'a', targetCharacterId: 'b', sequenceNumber: 1, trustDelta: 10 }),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].pairKey).toBe('a:b');
    // Endpoints come from the sorted key, not from whichever direction arrived first.
    expect([grouped[0].sourceCharacterId, grouped[0].targetCharacterId]).toEqual(['a', 'b']);
    expect(grouped[0].changeHistory.map((change) => change.trustDelta)).toEqual([10, -3]);
  });

  it('carries all six deltas, which the published relationship model does not', () => {
    // The shape argument for reading Canon: `RelationshipChange` publishes three deltas and no
    // world day, so 關係類型篩選 and the seven-day window could not be built on it.
    const grouped = groupPublicRelationships([canonEntry({
      trustDelta: 1, affectionDelta: 2, resentmentDelta: 3,
      fearDelta: 4, dependencyDelta: 5, familiarityDelta: 6, worldDay: 9,
    })]);
    expect(grouped[0].changeHistory[0]).toEqual({
      eventId: 'w#event#1', worldDay: 9, reason: '兩人在磨坊起了爭執',
      trustDelta: 1, affectionDelta: 2, resentmentDelta: 3,
      fearDelta: 4, dependencyDelta: 5, familiarityDelta: 6,
    });
  });

  it('drops an entry with no usable world day rather than reading it as day zero', () => {
    expect(groupPublicRelationships([canonEntry({ worldDay: 1.5 })])).toEqual([]);
  });

  it('is deterministic and orders pairs stably', () => {
    const history = [
      canonEntry({ sourceCharacterId: 'z', targetCharacterId: 'y' }),
      canonEntry({ sourceCharacterId: 'a', targetCharacterId: 'b' }),
    ];
    expect(groupPublicRelationships(history).map((pair) => pair.pairKey)).toEqual(['a:b', 'y:z']);
    expect(groupPublicRelationships(history)).toEqual(groupPublicRelationships(history));
  });

  it('produces the sorted, undirected key the published relationship model uses', () => {
    expect(graphPairKey('b', 'a')).toBe('a:b');
    expect(graphPairKey('a', 'b')).toBe(graphPairKey('b', 'a'));
  });

  it('an empty history is an empty graph input, not a throw', () => {
    expect(groupPublicRelationships([])).toEqual([]);
  });
});

describe('isWithinRecentChangeWindow', () => {
  it.each([
    [10, 10, true],
    [3, 10, true],
    [10 - RELATIONSHIP_GRAPH_RECENT_CHANGE_WINDOW_DAYS, 10, true],
    [10 - RELATIONSHIP_GRAPH_RECENT_CHANGE_WINDOW_DAYS - 1, 10, false],
    [11, 10, false],
  ])('day %i against target %i is %s', (changedDay, targetDay, expected) => {
    expect(isWithinRecentChangeWindow(changedDay, targetDay)).toBe(expected);
  });
});

describe('input validation', () => {
  it('rejects an empty world and a nonsensical world day', () => {
    expect(() => buildRelationshipGraphProjection({
      worldId: '  ', targetWorldDay: 1, arcs: [], relationships: [],
    })).toThrow(/RELATIONSHIP_GRAPH_INVALID/);
    for (const targetWorldDay of [-1, 1.5, Number.NaN]) {
      expect(() => buildRelationshipGraphProjection({
        worldId: WORLD_ID, targetWorldDay, arcs: [], relationships: [],
      })).toThrow(/RELATIONSHIP_GRAPH_INVALID/);
    }
  });
});
