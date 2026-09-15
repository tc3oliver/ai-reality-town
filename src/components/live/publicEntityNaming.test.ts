/**
 * No public surface prints an entity id where a name is available (ART-186).
 *
 * One file across five modules on purpose. The defect was not five defects: it was one missing
 * table, and its signature was that the SAME twelve residents were named differently depending on
 * which part of the live page you were looking at. A test per module would have let that property
 * — the one that actually broke — go unasserted, because each module was individually consistent
 * with itself.
 *
 * The fixture is the shape the live world publishes: a `liveState` payload with `displayName` on
 * every character (ART-183 added it), two arcs with titles, and ONE location, because
 * `convex/publicRead/liveFold.ts` folds locations from empty over `location_state_changed` and
 * publishes only what an event has described. Every other Mistwood location is seeded and absent —
 * which is the state that made the text live view say 「未知位置」 about a character the map was
 * drawing inside a named building.
 */

import { focusTargetsFrom } from '../world/cameraModel';
import { composeStaticMap } from './staticMapModel';
import { composeCharacterCardViewModel } from './characterCardModel';
import { composeActiveScenePanel, type ActiveSceneInput } from './activeSceneModel';
import { composeLiveViewModel, type LiveProjection } from '../public/liveRoute';
import { composeWorldNames, named, namedList, EMPTY_WORLD_NAMES } from '../public/worldNames';
import type { PublicCharacterMotion } from '../world/worldViewModel';

const MILL = 'mistwood-mill';
const HALL = 'mistwood-hall';

/** The authored footprints, cut to the two this file needs. Names as `data/mistwood.ts` has them. */
const FOOTPRINTS = [
  { id: MILL, name: 'Northwater Mill', rect: { x: 0, y: 0, width: 4, height: 4 }, vocabulary: '磨坊' },
  { id: HALL, name: 'Town Hall', rect: { x: 8, y: 0, width: 4, height: 4 }, vocabulary: '鎮公所' },
] as const;

/**
 * The published payload. `locations` holds ONLY the mill: the hall is seeded and no event has
 * described it, so it is not in the fold. See this file's header.
 */
const LIVE: LiveProjection = {
  worldTime: { worldDay: 3, timeSlot: 'night' },
  locations: [{
    locationId: MILL, name: '北水磨坊', description: '', locationType: 'industrial', active: true,
  }],
  characters: [
    { characterId: 'he-jun', locationId: MILL, alive: true, displayName: '何俊' },
    { characterId: 'zhao-ming', locationId: HALL, alive: true, displayName: '趙銘' },
    // No `displayName`: their projection has not been built yet. They must still be identifiable.
    { characterId: 'wu-zhen', locationId: HALL, alive: true },
  ],
  recentEvents: [],
  activeArcs: [
    { arcId: 'arc-mill', title: '磨坊之爭', currentQuestion: '水車修得好嗎?', status: 'active' },
  ],
  activeScenes: [{
    title: '帳目攤開',
    summary: '兩人把帳目重新攤開。',
    sceneId: `3:night:${MILL}`,
    locationId: MILL,
    participantCharacterIds: ['he-jun', 'zhao-ming'],
    arcIds: ['arc-mill'],
    status: 'active',
  }],
  publishedEpisodeStatus: 'ready',
};

const NAMES = composeWorldNames({ ...LIVE, footprints: FOOTPRINTS });

const motion = (characterId: string, locationId: string): PublicCharacterMotion => ({
  characterId,
  semanticLocationId: locationId,
  motionType: 'idle',
  motionSequence: 1,
  from: { x: 1, y: 1 },
  to: { x: 1, y: 1 },
  startedAt: 0,
  arriveAt: 0,
  direction: 'down',
  animationState: 'idle',
} as PublicCharacterMotion);

const MOTIONS = [motion('he-jun', MILL), motion('zhao-ming', HALL), motion('wu-zhen', HALL)];
const MAP = { width: 16, height: 8, tileDim: 32 };

describe('the name table', () => {
  it('prefers a published name and falls back to the id, never to a blank', () => {
    expect(named(NAMES.characters, 'he-jun')).toBe('何俊');
    expect(named(NAMES.characters, 'wu-zhen')).toBe('wu-zhen');
    expect(named(NAMES.characters, 'nobody')).toBe('nobody');
  });

  it('lets a Canon-described location override its authored default', () => {
    // The mill is in the published payload as 北水磨坊; the authored footprint says Northwater
    // Mill. Canon has re-described it, so Canon wins.
    expect(named(NAMES.locations, MILL)).toBe('北水磨坊');
  });

  it('names a seeded location the published payload omits entirely', () => {
    // The defect this half of the task exists for: the hall is in no published payload at all.
    expect(LIVE.locations.map((location) => location.locationId)).not.toContain(HALL);
    expect(named(NAMES.locations, HALL)).toBe('Town Hall');
  });

  it('drops an entry whose name is just the id, so a test can tell "unnamed" from "named"', () => {
    const names = composeWorldNames({
      characters: [{ characterId: 'he-jun', displayName: 'he-jun' }],
    });
    expect(names.characters.size).toBe(0);
  });

  it('joins a list with the Chinese separator', () => {
    expect(namedList(NAMES.characters, ['he-jun', 'zhao-ming'])).toBe('何俊、趙銘');
  });

  it('degrades to ids with no sources at all, which is the pre-ART-186 behaviour', () => {
    expect(named(EMPTY_WORLD_NAMES.characters, 'he-jun')).toBe('he-jun');
  });
});

describe('the live map chrome', () => {
  it('labels every character focus target with a name', () => {
    const targets = focusTargetsFrom({
      motions: MOTIONS, footprints: FOOTPRINTS, map: MAP, nowMs: 0, characterNames: NAMES.characters,
    });
    const labels = targets.filter((target) => target.kind === 'character').map((t) => t.label);
    expect(labels).toEqual(expect.arrayContaining(['何俊', '趙銘']));
    // An unnamed resident still gets a button, labelled by id — losing the button would lose the
    // only way to focus them.
    expect(labels).toContain('wu-zhen');
  });

  it('gives the floor plan the SAME names, because it takes them from these targets', () => {
    const targets = focusTargetsFrom({
      motions: MOTIONS, footprints: FOOTPRINTS, map: MAP, nowMs: 0, characterNames: NAMES.characters,
    });
    const plan = composeStaticMap({
      viewModel: {
        worldWidth: MAP.width * MAP.tileDim,
        worldHeight: MAP.height * MAP.tileDim,
        characters: MOTIONS.map((entry) => ({
          characterId: entry.characterId,
          semanticLocationId: entry.semanticLocationId,
          x: 16,
          y: 16,
        })),
      } as never,
      footprints: FOOTPRINTS,
      targets,
      tileSize: MAP.tileDim,
    });
    expect(plan.occupants.map((occupant) => occupant.label))
      .toEqual(expect.arrayContaining(['何俊', '趙銘']));
    expect(plan.occupants.map((occupant) => occupant.label)).not.toContain('he-jun');
  });

  it('still labels by id when no table is supplied', () => {
    const targets = focusTargetsFrom({ motions: MOTIONS, footprints: FOOTPRINTS, map: MAP, nowMs: 0 });
    expect(targets.find((target) => target.kind === 'character')?.label).toBe('he-jun');
  });
});

describe('the character card', () => {
  const card = (names = NAMES) => composeCharacterCardViewModel({
    worldId: 'mistwood',
    characterId: 'he-jun',
    character: { name: '何俊', occupation: '磨坊主管' } as never,
    motion: MOTIONS[0] as never,
    scenes: LIVE.activeScenes as ActiveSceneInput[],
    recentEvents: [],
    spriteKeys: {},
    footprints: FOOTPRINTS as never,
    names,
  });

  it('names the person this character is talking to', () => {
    expect(card().conversationPartnerNames).toEqual(['趙銘']);
  });

  it('titles the arc rather than printing its id', () => {
    expect(card().activeArcs.map((arc) => arc.title)).toEqual(['磨坊之爭']);
  });

  it('falls back to ids with no table, which is what the card did before', () => {
    expect(card(EMPTY_WORLD_NAMES).conversationPartnerNames).toEqual(['zhao-ming']);
  });
});

describe('the active scene panel', () => {
  const panel = composeActiveScenePanel({
    scenes: LIVE.activeScenes as ActiveSceneInput[],
    footprints: FOOTPRINTS as never,
    worldId: 'mistwood',
    names: NAMES,
  });

  it('names its participants and titles its arcs', () => {
    expect(panel.scenes[0].participantNames).toEqual(['何俊', '趙銘']);
    expect(panel.scenes[0].arcTitles).toEqual(['磨坊之爭']);
  });
});

describe('the text live view, which is the map’s accessible equivalent', () => {
  const vm = composeLiveViewModel({ live: LIVE, worldId: 'mistwood', footprints: FOOTPRINTS });

  it('names each character in 角色位置', () => {
    expect(vm.characterPositions.map((position) => position.name))
      .toEqual(['何俊', '趙銘', 'wu-zhen']);
  });

  it('never says 未知位置 about a character whose location the payload publishes', () => {
    // The whole defect, in one assertion. 趙銘 is in the hall; the hall is in no published
    // payload; the map draws them inside it. The text view used to claim it did not know.
    const zhaoMing = vm.characterPositions.find((position) => position.characterId === 'zhao-ming');
    expect(zhaoMing?.locationLabel).toBe('Town Hall');
    expect(vm.characterPositions.map((position) => position.locationLabel))
      .not.toContain('未知位置');
  });

  it('still says 未知位置 when the payload names no location for the character at all', () => {
    const placeless = composeLiveViewModel({
      live: { ...LIVE, characters: [{ characterId: 'he-jun', locationId: null, alive: true }] },
      worldId: 'mistwood',
      footprints: FOOTPRINTS,
    });
    expect(placeless.characterPositions[0].locationLabel).toBe('未知位置');
  });

  it('names scene participants and arcs, exactly as the map panel does', () => {
    expect(vm.activeScenes[0].participantNames).toEqual(['何俊', '趙銘']);
    expect(vm.activeScenes[0].arcTitles).toEqual(['磨坊之爭']);
  });

  it('agrees with the map panel word for word', () => {
    // The property the whole task is about: two surfaces, one world, one set of names.
    const panel = composeActiveScenePanel({
      scenes: LIVE.activeScenes as ActiveSceneInput[],
      footprints: FOOTPRINTS as never,
      worldId: 'mistwood',
      names: NAMES,
    });
    expect(vm.activeScenes[0].participantNames).toEqual(panel.scenes[0].participantNames);
    expect(vm.activeScenes[0].arcTitles).toEqual(panel.scenes[0].arcTitles);
  });
});
