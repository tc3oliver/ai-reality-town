/**
 * The static floor plan's geometry (FR-O010 / ART-127 AC#1, ladder rung 3).
 *
 * The load-bearing test here is the last one: the plan is built from the REAL Mistwood
 * footprints and the REAL camera targets, and is required to agree with the animated map
 * about who is where. A second rendering path that quietly disagrees with the first is the
 * obvious failure mode of this rung, and the worst kind, because it only shows up in the
 * degraded state nobody is looking at.
 */

import { mistwoodLocationFootprints, mistwoodWorldMap } from '../../../data/mistwood';
import type { FocusTarget } from '../world/cameraModel';
import type { ReadOnlyWorldCharacter, ReadOnlyWorldViewModel } from '../world/worldViewModel';
import { STATIC_MAP_BETWEEN_LABEL, composeStaticMap } from './staticMapModel';

const TILE = 16;

const FOOTPRINTS = [
  { id: 'mill', name: '磨坊', rect: { x: 0, y: 0, width: 4, height: 4 } },
  { id: 'square', name: '廣場', rect: { x: 10, y: 0, width: 4, height: 4 } },
  { id: 'empty-room', name: '空屋', rect: { x: 20, y: 0, width: 4, height: 4 } },
] as const;

function character(overrides: Partial<ReadOnlyWorldCharacter>): ReadOnlyWorldCharacter {
  return {
    characterId: 'he-jun',
    spriteKey: 'f1',
    semanticLocationId: 'mill',
    x: 16,
    y: 16,
    orientation: 90,
    animationState: 'idle',
    motionType: 'canon',
    isAmbient: false,
    isMoving: false,
    ...overrides,
  };
}

function viewModel(characters: ReadOnlyWorldCharacter[]): ReadOnlyWorldViewModel {
  return {
    map: mistwoodWorldMap,
    worldWidth: 40 * TILE,
    worldHeight: 10 * TILE,
    characters,
  };
}

const TARGETS: FocusTarget[] = [
  { kind: 'town', id: 'town', label: '全鎮', point: { x: 0, y: 0 } },
  { kind: 'character', id: 'character:he-jun', label: '何俊', point: { x: 16, y: 16 } },
  { kind: 'character', id: 'character:pei-lan', label: '裴嵐', point: { x: 176, y: 16 } },
];

describe('the plan', () => {
  test('rooms are the footprints, converted from tiles into the view model’s pixel space', () => {
    const model = composeStaticMap({
      viewModel: viewModel([]),
      footprints: FOOTPRINTS,
      targets: TARGETS,
      tileSize: TILE,
    });
    expect(model.rooms[0]).toEqual({ id: 'mill', name: '磨坊', x: 0, y: 0, width: 64, height: 64 });
    expect(model.rooms[1].x).toBe(160);
  });

  test('the viewBox is the map’s own extent, so the plan is to scale', () => {
    const model = composeStaticMap({
      viewModel: viewModel([]),
      footprints: FOOTPRINTS,
      targets: TARGETS,
      tileSize: TILE,
    });
    expect(model.width).toBe(40 * TILE);
    expect(model.height).toBe(10 * TILE);
  });

  test('names come from the camera’s targets, so the plan and the controls cannot disagree', () => {
    const model = composeStaticMap({
      viewModel: viewModel([character({})]),
      footprints: FOOTPRINTS,
      targets: TARGETS,
      tileSize: TILE,
    });
    expect(model.occupants[0].label).toBe('何俊');
  });

  test('a character with no target falls back to their id rather than to a blank marker', () => {
    const model = composeStaticMap({
      viewModel: viewModel([character({ characterId: 'nobody' })]),
      footprints: FOOTPRINTS,
      targets: TARGETS,
      tileSize: TILE,
    });
    // An unnamed dot on a plan is worse than a dot labelled with a slug: the slug is at least
    // matchable against the rest of the page.
    expect(model.occupants[0].label).toBe('nobody');
  });
});

describe('placing people', () => {
  test('the declared location wins, because it is the Canon-anchored answer', () => {
    // Coordinates that sit inside `square`, with a `semanticLocationId` that says `mill`. The
    // declared field is what Canon accepted; x/y are a rendering of it, and ART-120's in-zone
    // drift means they can legitimately wander within a zone.
    const model = composeStaticMap({
      viewModel: viewModel([character({ semanticLocationId: 'mill', x: 170, y: 16 })]),
      footprints: FOOTPRINTS,
      targets: TARGETS,
      tileSize: TILE,
    });
    expect(model.occupants[0].roomId).toBe('mill');
  });

  test('an unauthored location id falls back to a geometric hit test rather than crashing', () => {
    const model = composeStaticMap({
      viewModel: viewModel([character({ semanticLocationId: 'not-a-room', x: 170, y: 16 })]),
      footprints: FOOTPRINTS,
      targets: TARGETS,
      tileSize: TILE,
    });
    expect(model.occupants[0].roomId).toBe('square');
  });

  test('someone in no room at all is on the road, not dropped from the plan', () => {
    const model = composeStaticMap({
      viewModel: viewModel([character({ semanticLocationId: 'nowhere', x: 500, y: 500 })]),
      footprints: FOOTPRINTS,
      targets: TARGETS,
      tileSize: TILE,
    });
    expect(model.occupants).toHaveLength(1);
    expect(model.occupants[0].roomId).toBeNull();
    expect(model.roster.at(-1)?.roomName).toBe(STATIC_MAP_BETWEEN_LABEL);
  });
});

describe('the roster', () => {
  test('groups people by room, in plan order, and omits rooms nobody is in', () => {
    const model = composeStaticMap({
      viewModel: viewModel([
        character({ characterId: 'pei-lan', semanticLocationId: 'square', x: 170, y: 16 }),
        character({ characterId: 'he-jun', semanticLocationId: 'mill', x: 16, y: 16 }),
      ]),
      footprints: FOOTPRINTS,
      targets: TARGETS,
      tileSize: TILE,
    });
    expect(model.roster.map((group) => group.roomName)).toEqual(['磨坊', '廣場']);
    // `empty-room` is absent: an empty heading is noise in a summary whose entire job is
    // answering "where is everyone".
    expect(model.roster.some((group) => group.roomId === 'empty-room')).toBe(false);
  });

  test('names every character exactly once, so nobody is lost between the plan and the list', () => {
    const characters = [
      character({ characterId: 'he-jun', semanticLocationId: 'mill' }),
      character({ characterId: 'pei-lan', semanticLocationId: 'square', x: 170, y: 16 }),
      character({ characterId: 'lost', semanticLocationId: 'nowhere', x: 900, y: 900 }),
    ];
    const model = composeStaticMap({
      viewModel: viewModel(characters),
      footprints: FOOTPRINTS,
      targets: TARGETS,
      tileSize: TILE,
    });
    const rostered = model.roster.flatMap((group) => group.occupants.map((o) => o.characterId));
    expect(rostered.sort()).toEqual(characters.map((c) => c.characterId).sort());
  });

  test('ordering within a room is deterministic', () => {
    const build = (ids: string[]) =>
      composeStaticMap({
        viewModel: viewModel(ids.map((id) => character({ characterId: id, semanticLocationId: 'mill' }))),
        footprints: FOOTPRINTS,
        targets: TARGETS,
        tileSize: TILE,
      }).roster[0].occupants.map((occupant) => occupant.characterId);

    // Same people, opposite input order: a plan that reshuffled its roster per render would
    // make the degraded rung look like it was still updating when nothing had changed.
    expect(build(['b', 'a', 'c'])).toEqual(build(['c', 'b', 'a']));
  });
});

describe('agreement with the animated map', () => {
  /**
   * The whole point of projecting from the same view model. Built against the REAL footprints
   * so a change to the authored map is checked here too, rather than against a fixture that
   * would keep agreeing with itself after the real data moved.
   */
  test('every character the renderer would draw appears on the plan, at the same coordinates', () => {
    const characters = mistwoodLocationFootprints.slice(0, 4).map((footprint, index) =>
      character({
        characterId: `c${index}`,
        semanticLocationId: footprint.id,
        x: footprint.rect.x * mistwoodWorldMap.tileDim,
        y: footprint.rect.y * mistwoodWorldMap.tileDim,
      }));

    const model = composeStaticMap({
      viewModel: viewModel(characters),
      footprints: mistwoodLocationFootprints,
      targets: TARGETS,
      tileSize: mistwoodWorldMap.tileDim,
    });

    expect(model.occupants).toHaveLength(characters.length);
    for (const drawn of characters) {
      const placed = model.occupants.find((occupant) => occupant.characterId === drawn.characterId);
      // Identical coordinates, not merely "close": the plan re-derives nothing, so any
      // difference at all would mean a second position source had crept in.
      expect(placed).toMatchObject({ x: drawn.x, y: drawn.y });
      expect(placed?.roomId).toBe(drawn.semanticLocationId);
    }
  });
});
