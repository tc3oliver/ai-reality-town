/**
 * Two values on one row do not run together (ART-193).
 *
 * Every defect here was invisible in review and obvious on screen. JSX collapses the newline
 * between two sibling elements to NOTHING, so markup an author laid out across three lines renders
 * as one unbroken string — 「高文睿信任 · 強度 10共同修復水車」, 「磨坊對質兩派在磨坊為停工的水車爭
 * 執。」, 「蘇美珍在地圖上查看」. The source looks spaced out, which is exactly why reading it does
 * not find them.
 *
 * So these assert the RENDERED text of a composed row, not the presence of its pieces. A test that
 * checked 「the name is there」 and 「the reason is there」 passed throughout the defect.
 *
 * `renderToStaticMarkup` would not do: the a11y suite reads markup, and markup is where the
 * whitespace still looks fine. `textContent` on a mounted tree is what a viewer and a screen reader
 * actually get.
 */

import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { CharacterPageView } from './CharacterPage';
import { HomepageView } from './Homepage';
import { EpisodeDetailView, type EpisodeProjection } from './EpisodeDetail';
import { composeCharacterViewModel } from './characterRoute';
import { composeHomepageViewModel } from './homeRoute';
import { composeWorldNames } from './worldNames';
import { timelineMetaLabel } from './timelineRoute';
import { RelationshipGraphBody } from './RelationshipGraphView';
import { composeRelationshipGraphViewModel } from './relationshipGraphRoute';

const WORLD_ID = 'mistwood';

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

const render = (node: React.ReactNode): string => {
  act(() => { root.render(node); });
  return container.textContent ?? '';
};

/** Collapse runs of whitespace, so the assertions are about SEPARATION rather than about layout. */
const spaced = (text: string): string => text.replace(/\s+/gu, ' ');

describe('the character page’s 主要關係 row', () => {
  const vm = composeCharacterViewModel({
    worldId: WORLD_ID,
    character: { id: 'he-jun', name: '何俊' } as never,
    recentEvents: [],
    characters: [{ characterId: 'gao-wenrui', displayName: '高文睿' }],
    relationshipGraph: {
      worldDay: 7,
      arc: null,
      edges: [{
        sourceCharacterId: 'he-jun',
        targetCharacterId: 'gao-wenrui',
        relationshipType: 'trust',
        strength: 10,
        lastChangedWorldDay: 7,
        recentChanges: [{ reason: '共同修復水車' }],
      }],
      nodes: [],
      relationshipTypes: ['trust'],
      scope: {},
    } as never,
  });

  it('separates the name, the type and the reason', () => {
    // The live defect, verbatim: 「高文睿信任 · 強度 10共同修復水車」.
    const text = spaced(render(<CharacterPageView worldId={WORLD_ID} vm={vm} />));
    expect(text).not.toContain('高文睿信任');
    expect(text).not.toContain('強度 10共同修復水車');
    expect(text).toContain('高文睿 信任 · 強度 10 共同修復水車');
  });
});

describe('the home page’s 進行中的場景 row', () => {
  const vm = composeHomepageViewModel({
    worldId: WORLD_ID,
    summary: null,
    world: null,
    live: {
      worldTime: { worldDay: 7, timeSlot: 'evening' },
      activeScenes: [{
        title: '磨坊對質',
        summary: '兩派在磨坊為停工的水車爭執。',
        sceneId: '7:evening:mistwood-mill',
      }],
    } as never,
    base: '',
  });

  it('separates a scene’s title from its summary', () => {
    // 「磨坊對質兩派在磨坊為停工的水車爭執。」 read as one strange sentence.
    const text = spaced(render(<HomepageView worldId={WORLD_ID} vm={vm} />));
    expect(text).not.toContain('磨坊對質兩派');
    expect(text).toContain('磨坊對質 兩派在磨坊為停工的水車爭執。');
  });
});

describe('the Episode page’s 關連角色 row', () => {
  const EPISODE: EpisodeProjection = {
    episodeNumber: 3,
    worldDay: 7,
    title: '世界第 7 天',
    headline: '',
    oneLineSummary: '',
    keyScenes: [],
    relationshipChanges: [],
    newQuestions: [],
    resolvedQuestions: [],
    arcIds: [],
    characterIds: ['su-meizhen'],
    nextEpisodeTease: '',
  };

  it('separates a character’s name from the map link beside it', () => {
    // 「蘇美珍在地圖上查看」.
    const names = composeWorldNames({
      characters: [{ characterId: 'su-meizhen', displayName: '蘇美珍' }],
    });
    const text = spaced(render(
      <EpisodeDetailView worldId={WORLD_ID} worldDay={7} episode={EPISODE} names={names} />,
    ));
    expect(text).not.toContain('蘇美珍在地圖上查看');
    expect(text).toContain('蘇美珍 在地圖上查看');
  });
});

describe('a separator is never printed with nothing after it', () => {
  /**
   * The mirror image of the defects above, and reachable for a different reason: a published
   * payload is unvalidated JSON, so `eventType` can be absent. The timeline assembled its meta
   * line in JSX and printed 「[日 3 中午 · ]」 — the separator, then nothing.
   *
   * Asserted on `timelineMetaLabel` rather than on the rendered page because that is where the
   * composition now lives, which is the point of having moved it there.
   */
  it('drops the event type AND its separator when the entry carries none', () => {
    expect(timelineMetaLabel({ worldDay: 3, timeSlot: 'noon' })).toBe('[日 3 中午]');
  });

  it('drops the time slot and its space the same way', () => {
    expect(timelineMetaLabel({ worldDay: 3 })).toBe('[日 3]');
  });

  it('joins both when both are present', () => {
    expect(timelineMetaLabel({ worldDay: 3, timeSlot: 'noon', eventType: 'conversation' }))
      .toBe('[日 3 中午 · 對話]');
  });

  it('never leaves a dangling separator, for any combination', () => {
    const combinations = [
      { worldDay: 1 },
      { worldDay: 1, timeSlot: 'noon' },
      { worldDay: 1, eventType: 'conversation' },
      { worldDay: 1, timeSlot: '', eventType: '' },
      { worldDay: 1, timeSlot: null, eventType: undefined },
    ];
    for (const entry of combinations) {
      const label = timelineMetaLabel(entry);
      expect(label).not.toMatch(/·\s*\]/u);
      expect(label).not.toMatch(/\[\s*·/u);
      expect(label.startsWith('[日 1')).toBe(true);
    }
  });
});

describe('punctuation carries no space before it', () => {
  it('keeps the relationship graph’s comma attached to what precedes it', () => {
    /**
     * The same mechanism inverted: a line break INSIDE a text run becomes a space, and this one
     * broke immediately before a comma — 「(強度 30) ,最近變化於世界日 7」.
     *
     * Scanned over the whole rendered page rather than one row, because the defect is a property
     * of how the source is wrapped and could reappear anywhere a long text run is reflowed.
     */
    const vm = composeRelationshipGraphViewModel({
      worldId: WORLD_ID,
      worldDay: 7,
      projection: {
        worldDay: 7,
        arc: { arcId: 'arc-mill', title: '磨坊之爭', status: 'active' },
        edges: [{
          sourceCharacterId: 'he-jun',
          targetCharacterId: 'gao-wenrui',
          relationshipType: 'trust',
          strength: 30,
          lastChangedWorldDay: 7,
          recentChanges: [{ reason: '共同修復水車' }],
        }],
        nodes: [
          { characterId: 'he-jun', isCoreCharacter: true },
          { characterId: 'gao-wenrui', isCoreCharacter: false },
        ],
        relationshipTypes: ['trust'],
        scope: {},
      } as never,
      filter: { relationshipType: null },
      latestWorldDay: 7,
      characters: {
        'he-jun': { name: '何俊' } as never,
        'gao-wenrui': { name: '高文睿' } as never,
      },
    });
    const text = render(<RelationshipGraphBody worldId={WORLD_ID} vm={vm} />);
    for (const mark of [',', '。', ';', ':', '、']) {
      expect(text).not.toContain(` ${mark}`);
    }
    expect(spaced(text)).toContain('(強度 30),最近變化於世界日 7');
  });
});
