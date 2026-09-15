/**
 * A static public page names what it links to (ART-187).
 *
 * Four pages rendered an internal identifier as the VISIBLE TEXT of a link pointing at that
 * identifier — the Episode page's 關連角色 and 關連故事線, the character page's 主要關係, the arc
 * page's 起始事件, and both filter dropdowns. ART-186 fixed the live surfaces; this is the same
 * defect on the pages that are not the map.
 *
 * The last block is the one worth having. The character page and the relationship graph read the
 * SAME published edge, and before this task one printed a slug while the other printed a name — so
 * the assertion is that the two agree, not that each is individually non-empty.
 */

import { characterRelationships, composeCharacterViewModel } from './characterRoute';
import { composeArcViewModel } from './arcRoute';
import { composeTimelineViewModel } from './timelineRoute';
import { composeEpisodeListViewModel } from './episodeListRoute';
import { composeRelationshipGraphViewModel } from './relationshipGraphRoute';
import { composeWorldNames, named } from './worldNames';

const WORLD = 'mistwood';

const NAMES = composeWorldNames({
  characters: [
    { characterId: 'he-jun', displayName: '何俊' },
    { characterId: 'zhao-ming', displayName: '趙銘' },
  ],
  locations: [{ locationId: 'mistwood-mill', name: '北水磨坊' }],
  activeArcs: [{ arcId: 'arc-mill', title: '磨坊之爭' }],
  footprints: [{ id: 'mistwood-hall', name: 'Town Hall' }],
});

const GRAPH = {
  worldDay: 5,
  arc: { arcId: 'arc-mill', title: '磨坊之爭', status: 'active' },
  edges: [{
    sourceCharacterId: 'he-jun',
    targetCharacterId: 'zhao-ming',
    relationshipType: 'trust',
    strength: 6,
    lastChangedWorldDay: 5,
    recentChanges: [{ reason: '共同查帳' }],
  }],
  nodes: [
    { characterId: 'he-jun', isCoreCharacter: true },
    { characterId: 'zhao-ming', isCoreCharacter: true },
  ],
  relationshipTypes: ['trust'],
  scope: {},
} as never;

describe('the character page', () => {
  const vm = composeCharacterViewModel({
    worldId: WORLD,
    character: { id: 'he-jun', name: '何俊', currentLocationId: 'mistwood-hall' } as never,
    recentEvents: [],
    locations: [{ locationId: 'mistwood-mill', name: '北水磨坊' }],
    characters: [
      { characterId: 'he-jun', displayName: '何俊' },
      { characterId: 'zhao-ming', displayName: '趙銘' },
    ],
    footprints: [{ id: 'mistwood-hall', name: 'Town Hall' }],
    relationshipGraph: GRAPH,
  });

  it('names the other end of a relationship', () => {
    expect(vm.relationships.map((relationship) => relationship.otherName)).toEqual(['趙銘']);
  });

  it('keeps the id on the row, because that is what the link is built from', () => {
    // The name is presentation; the id is still the thing the href resolves to. Losing it would
    // turn a naming fix into a navigation bug.
    expect(vm.relationships[0].href).toContain('zhao-ming');
  });

  it('names a seeded location under 所在地 rather than printing its id', () => {
    // `mistwood-hall` is in no published payload — see `worldNames.ts` on why that is by
    // construction. Before ART-186/187 this row read 「所在地:mistwood-hall」.
    expect(vm.locationName).toBe('Town Hall');
  });

  it('falls back to the id when nothing names the other person', () => {
    expect(characterRelationships('he-jun', WORLD, GRAPH)[0].otherName).toBe('zhao-ming');
  });
});

describe('the character page and the relationship graph describe one edge the same way', () => {
  it('uses the same name for the same person', () => {
    /**
     * The property the task is actually about. Both read the published FR-I007 graph; the graph
     * page resolved names through `character:<id>` and the character page did not resolve them at
     * all, so 「趙銘」 on one page was 「zhao-ming」 on the other.
     */
    const page = composeCharacterViewModel({
      worldId: WORLD,
      character: { id: 'he-jun', name: '何俊' } as never,
      recentEvents: [],
      characters: [{ characterId: 'zhao-ming', displayName: '趙銘' }],
      relationshipGraph: GRAPH,
    });
    const graph = composeRelationshipGraphViewModel({
      worldId: WORLD,
      worldDay: 5,
      projection: GRAPH,
      filter: { relationshipType: null },
      latestWorldDay: 5,
      characters: { 'he-jun': { name: '何俊' } as never, 'zhao-ming': { name: '趙銘' } as never },
    });
    const fromGraph = graph.nodes
      .find((node) => node.characterId === 'he-jun')?.relationships[0]?.otherName;
    expect(page.relationships[0].otherName).toBe(fromGraph);
    expect(fromGraph).toBe('趙銘');
  });
});

describe('the arc page never prints a Canon event key', () => {
  const arc = {
    arcId: 'arc-mill',
    title: '磨坊之爭',
    status: 'active',
    incitingEventId: 'mistwood#event#50',
    latestTurningPointEventId: 'mistwood#event#74',
    coreCharacterIds: [],
    essentialBackstory: [],
    relatedEpisodes: [],
    unresolvedQuestions: [],
  } as never;

  it('renders the published words for the inciting event', () => {
    const vm = composeArcViewModel({
      worldId: WORLD,
      arc,
      primer: null,
      eventSummaries: new Map([['mistwood#event#50', '磨坊在那天停工。']]),
    });
    expect(vm.incitingEventSummary).toBe('磨坊在那天停工。');
  });

  it('resolves to null, never to the key, when nothing published names the event', () => {
    // The timeline is major-events-only by construction, so a miss is a real and expected state.
    const vm = composeArcViewModel({ worldId: WORLD, arc, primer: null, eventSummaries: new Map() });
    expect(vm.incitingEventSummary).toBeNull();
    expect(vm.latestTurningPoint?.summary).toBeNull();
    expect(JSON.stringify(vm)).not.toContain('mistwood#event#50');
  });

  it('prefers the primer’s own turning-point summary over the timeline’s', () => {
    // The primer's was written ABOUT this turning point; the timeline's is the general fallback.
    const vm = composeArcViewModel({
      worldId: WORLD,
      arc,
      primer: {
        structured: { turningPoint: { eventId: 'mistwood#event#74', summary: '審計被要求公開。' } },
      } as never,
      eventSummaries: new Map([['mistwood#event#74', '一般時間軸的說法。']]),
    });
    expect(vm.latestTurningPoint?.summary).toBe('審計被要求公開。');
  });
});

describe('the filter dropdowns offer names and select on ids', () => {
  const timelineEntry = {
    eventId: 'e1',
    worldDay: 3,
    timeSlot: 'night',
    eventType: 'conversation',
    publicSummary: '兩人對帳。',
    arcIds: ['arc-mill'],
    characterIds: ['he-jun'],
    episodeNumber: 1,
  };

  it('labels the timeline’s arc and character options', () => {
    const vm = composeTimelineViewModel({
      worldId: WORLD,
      projection: { entries: [timelineEntry] } as never,
      filter: { arc: null, character: null, eventType: null },
      names: NAMES,
    });
    expect(vm.arcOptions).toEqual([{ value: 'arc-mill', label: '磨坊之爭' }]);
    expect(vm.characterOptions).toEqual([{ value: 'he-jun', label: '何俊' }]);
  });

  it('still filters on the id, so naming changed the label and nothing else', () => {
    const vm = composeTimelineViewModel({
      worldId: WORLD,
      projection: { entries: [timelineEntry] } as never,
      filter: { arc: 'arc-mill', character: null, eventType: null },
      names: NAMES,
    });
    expect(vm.entries).toHaveLength(1);
  });

  it('labels the episode list’s options too', () => {
    const vm = composeEpisodeListViewModel({
      worldId: WORLD,
      index: {
        episodes: [], arcIds: ['arc-mill'], characterIds: ['he-jun', 'nobody'],
      } as never,
      filter: { arc: null, character: null },
      names: NAMES,
    });
    expect(vm.arcOptions).toEqual([{ value: 'arc-mill', label: '磨坊之爭' }]);
    // An unresolved id keeps the id as its label, so the filter stays usable rather than
    // offering a blank row a viewer cannot tell apart from another blank row.
    expect(vm.characterOptions)
      .toEqual([{ value: 'he-jun', label: '何俊' }, { value: 'nobody', label: 'nobody' }]);
  });
});

describe('the shared table behaves the same on these pages as on the live ones', () => {
  it('is the same fallback rule, because it is the same function', () => {
    expect(named(NAMES.characters, 'he-jun')).toBe('何俊');
    expect(named(NAMES.characters, 'nobody')).toBe('nobody');
  });
});
