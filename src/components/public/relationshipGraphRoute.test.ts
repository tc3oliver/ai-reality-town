/**
 * The public relationship graph page's pure logic (FR-I007 / ART-44).
 *
 * The server-side guarantees are tested where they are enforced
 * (`convex/publicRead/relationshipGraphProjection.test.ts`). What is tested HERE is the second
 * half of the claim: that the page renders what was published, never widens it, states the scope
 * and the truncation in words, and produces a text equivalent that carries everything the diagram
 * does.
 */

import {
  KNOWN_NODE_ORDERING,
  MAX_GRAPH_SUMMARY_CHARS,
  NO_SUMMARY,
  RELATIONSHIP_TYPE_LABELS,
  composeRelationshipGraphViewModel,
  currentWorldDay,
  edgeMatchesFilter,
  layoutRelationshipGraph,
  parseRelationshipGraphRoute,
  relationshipGraphHref,
  type GraphCharacterPayload,
  type RelationshipGraphPayload,
} from './relationshipGraphRoute';

const WORLD_ID = 'mistwood';
const DAY = 7;

function payload(over: Partial<RelationshipGraphPayload> = {}): RelationshipGraphPayload {
  return {
    worldDay: DAY,
    arc: { arcId: 'arc:mistwood:50', title: '磨坊之爭', status: 'escalating' },
    nodes: [
      { characterId: 'he-jun', isCoreCharacter: true, hop: 0, edgeCount: 2 },
      { characterId: 'zhao-ming', isCoreCharacter: true, hop: 0, edgeCount: 1 },
      { characterId: 'lin-wan', isCoreCharacter: false, hop: 1, edgeCount: 1 },
    ],
    edges: [
      {
        pairKey: 'he-jun:zhao-ming', sourceCharacterId: 'he-jun', targetCharacterId: 'zhao-ming',
        relationshipType: 'resentment', strength: 30, lastChangedWorldDay: DAY,
        recentChanges: [{ eventId: 'e1', worldDay: DAY, reason: '為停工的水車爭執' }],
        changeCountInWindow: 4,
      },
      {
        pairKey: 'he-jun:lin-wan', sourceCharacterId: 'he-jun', targetCharacterId: 'lin-wan',
        relationshipType: 'trust', strength: 20, lastChangedWorldDay: DAY - 2,
        recentChanges: [{ eventId: 'e2', worldDay: DAY - 2, reason: '一同修好水車' }],
        changeCountInWindow: 1,
      },
    ],
    relationshipTypes: ['trust', 'resentment'],
    scope: { windowDays: 7, nodeLimit: 30, nodeOrdering: KNOWN_NODE_ORDERING },
    candidateNodeCount: 3,
    candidateEdgeCount: 2,
    omittedNodeCount: 0,
    omittedEdgeCount: 0,
    ...over,
  };
}

/** The live `character:<id>` reads the page makes, keyed by id. */
function characters(over: Record<string, GraphCharacterPayload | undefined> = {}) {
  return {
    'he-jun': { name: '何俊', occupation: '管事', publicProfile: '磨坊管事。', alive: true },
    'zhao-ming': { name: '趙明', occupation: null, publicProfile: null, alive: true },
    'lin-wan': { name: '林晚', occupation: '工匠', publicProfile: '水車工匠。', alive: true },
    ...over,
  };
}

function compose(over: {
  worldDay?: number;
  projection?: RelationshipGraphPayload | null;
  relationshipType?: string | null;
  latestWorldDay?: number | null;
  characters?: Record<string, GraphCharacterPayload | undefined>;
} = {}) {
  return composeRelationshipGraphViewModel({
    worldId: WORLD_ID,
    worldDay: over.worldDay ?? DAY,
    projection: over.projection === undefined ? payload() : over.projection,
    filter: { relationshipType: over.relationshipType ?? null },
    latestWorldDay: over.latestWorldDay === undefined ? DAY : over.latestWorldDay,
    characters: over.characters === undefined ? characters() : over.characters,
  });
}

describe('parseRelationshipGraphRoute', () => {
  it('accepts a world with and without a day', () => {
    expect(parseRelationshipGraphRoute('#graph/mistwood')).toEqual({ worldId: 'mistwood', worldDay: null });
    expect(parseRelationshipGraphRoute('#graph/mistwood/7')).toEqual({ worldId: 'mistwood', worldDay: 7 });
    expect(parseRelationshipGraphRoute('graph/mistwood/0')).toEqual({ worldId: 'mistwood', worldDay: 0 });
  });

  it('rejects anything it cannot resolve, so the page shows a format hint', () => {
    for (const hash of ['#graph', '#graph/', '#graph//7', '#graph/mistwood/-1', '#graph/mistwood/x', '#timeline/mistwood', '']) {
      expect(parseRelationshipGraphRoute(hash)).toBeNull();
    }
  });

  it('round-trips an encoded world identifier', () => {
    const href = relationshipGraphHref('world/one', 3);
    expect(parseRelationshipGraphRoute(href)).toEqual({ worldId: 'world/one', worldDay: 3 });
  });
});

describe('currentWorldDay', () => {
  it('reads the published clock and refuses anything that is not one', () => {
    expect(currentWorldDay({ worldTime: { worldDay: 7 } })).toBe(7);
    expect(currentWorldDay({ worldTime: { worldDay: 0 } })).toBe(0);
    for (const live of [null, {}, { worldTime: null }, { worldTime: { worldDay: -1 } }, { worldTime: { worldDay: 1.5 } }]) {
      expect(currentWorldDay(live as never)).toBeNull();
    }
  });
});

describe('AC#2 — date switching', () => {
  it('offers both neighbours in the middle of the published range', () => {
    const vm = compose({ worldDay: 4, latestWorldDay: 9 });
    expect(vm.previousDayHref).toBe('#graph/mistwood/3');
    expect(vm.nextDayHref).toBe('#graph/mistwood/5');
  });

  it('offers no next day at the world’s current day, and no previous day at day zero', () => {
    expect(compose({ worldDay: 9, latestWorldDay: 9 }).nextDayHref).toBeNull();
    expect(compose({ worldDay: 0, latestWorldDay: 9 }).previousDayHref).toBeNull();
  });

  it('offers no next day when the world has published no clock', () => {
    // Better than guessing a bound: a link to a day the world has not reached would resolve to an
    // unpublished graph, which reads like a fault.
    expect(compose({ worldDay: 4, latestWorldDay: null }).nextDayHref).toBeNull();
  });
});

describe('AC#2 — relationship-type filtering', () => {
  it('narrows the edges and leaves the published node set alone', () => {
    const vm = compose({ relationshipType: 'trust' });
    expect(vm.visibleEdgeCount).toBe(1);
    expect(vm.lines).toHaveLength(1);
    // The nodes are what the server scoped to; a filter on type must not silently drop people.
    expect(vm.nodes.map((node) => node.characterId)).toEqual(['he-jun', 'zhao-ming', 'lin-wan']);
    // ...and a character with no matching edge says so rather than looking unconnected.
    expect(vm.nodes.find((node) => node.characterId === 'zhao-ming')?.relationships).toEqual([]);
  });

  it('offers only the types the published graph actually carries', () => {
    expect(compose().typeOptions).toEqual([
      { value: 'trust', label: '信任' },
      { value: 'resentment', label: '敵意' },
    ]);
    expect(compose({ projection: payload({ relationshipTypes: [] }) }).typeOptions).toEqual([]);
  });

  it('has a zh-Hant label for every type the server can publish', () => {
    for (const type of ['trust', 'affection', 'resentment', 'fear', 'dependency', 'familiarity', 'neutral']) {
      expect(RELATIONSHIP_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it('matches every edge when no type is selected', () => {
    expect(edgeMatchesFilter({ relationshipType: 'fear' }, { relationshipType: null })).toBe(true);
    expect(edgeMatchesFilter({ relationshipType: 'fear' }, { relationshipType: 'trust' })).toBe(false);
  });
});

describe('AC#2 — summaries and change reasons', () => {
  it('carries each character’s summary from the LIVE read, and says so when there is none', () => {
    const vm = compose();
    expect(vm.nodes[0].summary).toBe('磨坊管事。');
    // `zhao-ming` has a published projection with no `publicProfile`.
    expect(vm.nodes[1].summary).toBe(NO_SUMMARY);
  });

  it('labels a node by id, without a summary, while its character read is still in flight', () => {
    // `undefined` (in flight) and `null` (never published) render identically, because neither is
    // a claim about the person. A blank label would render an anonymous node.
    for (const value of [undefined, null]) {
      const vm = compose({ characters: characters({ 'he-jun': value }) });
      expect(vm.nodes[0].name).toBe('he-jun');
      expect(vm.nodes[0].summary).toBe(NO_SUMMARY);
      expect(vm.nodes[0].occupation).toBeNull();
    }
  });

  it('reflects a withheld profile immediately, because the summary is not frozen in the graph', () => {
    /**
     * The point of reading `character:<id>` live (ART-132 retroactive withhold).
     *
     * A past day's graph is published once and never rebuilt, so a summary carried in it could
     * never self-heal. Here the graph payload is byte-identical and only the character read has
     * changed — which is exactly what happens when a Scene is withheld on a later day.
     */
    const withheld = compose({ characters: characters({ 'he-jun': { name: '何俊', publicProfile: null, occupation: null } }) });
    expect(withheld.nodes[0].summary).toBe(NO_SUMMARY);
    expect(withheld.nodes[0].name).toBe('何俊');
  });

  it('bounds a long published profile rather than printing a paragraph', () => {
    const vm = compose({ characters: characters({ 'he-jun': { name: '何俊', publicProfile: '磨'.repeat(200) } }) });
    expect(vm.nodes[0].summary.length).toBeLessThanOrEqual(MAX_GRAPH_SUMMARY_CHARS);
    expect(vm.nodes[0].summary.endsWith('…')).toBe(true);
  });

  it('carries each relationship’s change reasons and the count it did not list', () => {
    const relationship = compose().nodes[0].relationships[0];
    expect(relationship.reasons).toEqual(['為停工的水車爭執']);
    // The published payload carries three reasons at most; four changes happened.
    expect(relationship.furtherChangeCount).toBe(3);
    expect(relationship.typeLabel).toBe('敵意');
    expect(relationship.lastChangedWorldDay).toBe(DAY);
  });

  it('names the other end from the graph’s own node list, not from the id', () => {
    expect(compose().nodes[0].relationships.map((r) => r.otherName)).toEqual(['趙明', '林晚']);
  });
});

describe('AC#3 — the scope and any truncation are stated, never implied', () => {
  it('states the scope even when nothing was omitted', () => {
    // The case this exists for: a small world whose default happens to be complete would
    // otherwise read as an unqualified picture of the whole town.
    const vm = compose();
    expect(vm.truncationNotice).toBeNull();
    expect(vm.scopeNotice).toContain('核心人物');
    expect(vm.scopeNotice).toContain('一階關係');
    expect(vm.scopeNotice).toContain('最近 7 個世界日');
    expect(vm.scopeNotice).toContain('不會顯示全部角色與全部關係');
  });

  it('states what was omitted, with the counts and the ordering it was omitted under', () => {
    const vm = compose({
      projection: payload({ candidateNodeCount: 84, candidateEdgeCount: 120, omittedNodeCount: 81, omittedEdgeCount: 118 }),
    });
    expect(vm.truncationNotice).toContain('84 人');
    expect(vm.truncationNotice).toContain('120 段關係');
    expect(vm.truncationNotice).toContain('未顯示 81 人');
    expect(vm.truncationNotice).toContain('118 段關係');
    expect(vm.truncationNotice).toContain('核心人物優先');
  });

  it('admits it cannot explain an ordering it does not recognise', () => {
    // A page that hard-coded the explanation would go on giving it after the server's rule
    // changed, which is a confident description of something that is no longer true.
    const vm = compose({
      projection: payload({
        scope: { windowDays: 7, nodeLimit: 30, nodeOrdering: 'some_future_ordering' },
        candidateNodeCount: 84, omittedNodeCount: 81,
      }),
    });
    expect(vm.truncationNotice).toContain('不認得');
    expect(vm.truncationNotice).not.toContain('核心人物優先');
  });

  it('degrades to an explicit empty state when the day has no published graph', () => {
    const vm = compose({ projection: null });
    expect(vm.hasContent).toBe(false);
    expect(vm.nodes).toEqual([]);
    expect(vm.points).toEqual([]);
    expect(vm.scopeNotice).toContain('尚未發布');
    // Date switching still works from an unpublished day, so a viewer is not stranded there.
    expect(vm.previousDayHref).toBe('#graph/mistwood/6');
  });
});

describe('the diagram layout is deterministic and encodes hop redundantly', () => {
  it('places core characters on an inner ring and neighbours on an outer one', () => {
    const points = layoutRelationshipGraph(compose().nodes);
    const radius = (characterId: string) => {
      const point = points.find((candidate) => candidate.characterId === characterId)!;
      return Math.hypot(point.x - 50, point.y - 50);
    };
    expect(radius('he-jun')).toBeLessThan(radius('lin-wan'));
    // The core ring is genuinely inside the outer one for every core character.
    expect(Math.max(radius('he-jun'), radius('zhao-ming'))).toBeLessThan(radius('lin-wan'));
  });

  it('produces the same geometry every time, with no randomness', () => {
    expect(layoutRelationshipGraph(compose().nodes)).toEqual(layoutRelationshipGraph(compose().nodes));
  });

  it('centres a lone core character rather than parking it on an arbitrary arc', () => {
    const points = layoutRelationshipGraph([
      { characterId: 'solo', name: '獨行', isCoreCharacter: true },
    ]);
    expect(points).toEqual([{ characterId: 'solo', name: '獨行', isCoreCharacter: true, x: 50, y: 50 }]);
  });

  it('draws only edges whose ends it has placed', () => {
    const vm = compose();
    expect(vm.lines.map((line) => line.pairKey)).toEqual(['he-jun:zhao-ming', 'he-jun:lin-wan']);
    for (const line of vm.lines) {
      expect(Number.isFinite(line.from.x) && Number.isFinite(line.to.y)).toBe(true);
    }
  });
});

/**
 * The facts the diagram encodes are all in the RENDERED node list.
 *
 * There used to be a `buildTextEquivalent` here producing a parallel prose block. It was computed
 * on every render, tested, documented as the a11y baseline — and never rendered. The choice was
 * to render it `sr-only` or delete it; deleting it is right, because the visible 人物與關係
 * section already carries every one of these facts, so an sr-only copy would make a screen reader
 * announce every relationship twice. The rendered markup is asserted in
 * `publicPages.a11y.test.tsx`; what is asserted here is that the view model CARRIES the facts that
 * section renders.
 */
describe('the view model carries everything the diagram encodes', () => {
  it('carries each character’s hop, and every relationship’s type, strength, day and reason', () => {
    const vm = compose();
    const heJun = vm.nodes.find((node) => node.characterId === 'he-jun')!;
    // Hop — what the picture encodes as distance from the centre.
    expect(heJun.isCoreCharacter).toBe(true);
    expect(vm.nodes.find((node) => node.characterId === 'lin-wan')!.isCoreCharacter).toBe(false);
    const relationship = heJun.relationships[0];
    expect(relationship.typeLabel).toBe('敵意');
    expect(relationship.strength).toBe(30);
    expect(relationship.lastChangedWorldDay).toBe(DAY);
    expect(relationship.reasons).toEqual(['為停工的水車爭執']);
    expect(relationship.furtherChangeCount).toBe(3);
  });

  it('places every rendered node in the diagram and vice versa, so neither can carry more', () => {
    const vm = compose();
    expect(vm.points.map((point) => point.characterId).sort())
      .toEqual(vm.nodes.map((node) => node.characterId).sort());
  });

  it('says a character has no changed relationships rather than listing nothing', () => {
    const vm = compose({ relationshipType: 'fear' });
    expect(vm.visibleEdgeCount).toBe(0);
    for (const node of vm.nodes) expect(node.relationships).toEqual([]);
  });
});

describe('the page cannot widen what the server scoped', () => {
  it('renders exactly the published nodes, and no filter produces more', () => {
    const published = payload();
    for (const relationshipType of [null, 'trust', 'resentment', 'fear']) {
      const vm = compose({ relationshipType });
      expect(vm.nodes).toHaveLength(published.nodes.length);
      expect(vm.visibleEdgeCount).toBeLessThanOrEqual(published.edges.length);
    }
  });

  it('links each character to their own page rather than expanding the graph in place', () => {
    // Following a character is navigation, not a wider default: the next page is that person's,
    // which is already field-allowlisted, and this graph stays the size it was published at.
    expect(compose().nodes[0].href).toBe('#character/mistwood/he-jun');
  });
});
