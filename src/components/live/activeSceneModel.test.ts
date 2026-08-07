/**
 * The active scene panel's correctness boundaries (FR-O003 / ART-122 AC#2/#3/#5).
 *
 * Pure jest (no jsdom): the module under test has no React, DOM or Convex dependency, which
 * is what lets "an ended scene links to its Episode" be a unit test rather than a click.
 */

import { mistwoodLocationFootprints } from '../../../data/mistwood';
import { sceneTargetId } from '../world/cameraModel';
import { composeActiveScenePanel, sceneWorldDay, type ActiveSceneInput } from './activeSceneModel';

const WORLD_ID = 'mistwood';
const HALL = 'mistwood-hall';

function compose(scenes: readonly ActiveSceneInput[]) {
  return composeActiveScenePanel({ scenes, footprints: mistwoodLocationFootprints, worldId: WORLD_ID });
}

describe('AC#2 — a scene carries its title, summary, participants and story arcs', () => {
  test('composes the full display record', () => {
    const model = compose([{
      title: '簽約',
      summary: '眾人見證休戰。',
      sceneId: `3:evening:${HALL}`,
      locationId: HALL,
      participantCharacterIds: ['cassia', 'rowan'],
      arcIds: ['arc-truce'],
      status: 'active',
    }]);

    expect(model.hasScenes).toBe(true);
    expect(model.scenes).toEqual([{
      key: `3:evening:${HALL}`,
      title: '簽約',
      summary: '眾人見證休戰。',
      // The footprint's authored name, not the raw slug: the panel and the map label must
      // agree about what the same place is called.
      locationLabel: 'Town Hall',
      participantCharacterIds: ['cassia', 'rowan'],
      arcIds: ['arc-truce'],
      ended: false,
      focusTargetId: sceneTargetId(`3:evening:${HALL}`),
      episodeHref: null,
    }]);
  });

  test('degrades every optional field without dropping the scene', () => {
    // Exactly the shape a last-known-good payload persisted before ART-122 carries.
    const [scene] = compose([{ title: '舊場景', summary: '摘要。' }]).scenes;
    expect(scene.locationLabel).toBeNull();
    expect(scene.participantCharacterIds).toEqual([]);
    expect(scene.arcIds).toEqual([]);
    expect(scene.focusTargetId).toBeNull();
    expect(scene.episodeHref).toBeNull();
    expect(scene.key).toBe('scene-0');
  });

  test('shows an unmapped location by its id rather than hiding it', () => {
    const [scene] = compose([{ title: 't', summary: 's', sceneId: 'x', locationId: 'unmapped-place' }]).scenes;
    expect(scene.locationLabel).toBe('unmapped-place');
    // Nameable but not placeable: the panel says where it is and offers no camera button.
    expect(scene.focusTargetId).toBeNull();
  });

  test('is empty, not broken, when no scene is published', () => {
    expect(compose([])).toEqual({ hasScenes: false, scenes: [] });
  });
});

describe('AC#5 — an ended scene becomes an Episode entry point', () => {
  test('links an ended scene to its world day’s Episode', () => {
    const [scene] = compose([{
      title: '簽約', summary: 's', sceneId: `7:evening:${HALL}`, locationId: HALL, status: 'ended',
    }]).scenes;
    expect(scene.ended).toBe(true);
    expect(scene.episodeHref).toBe('#episode/mistwood/7');
  });

  test('an active scene has no Episode link', () => {
    const [scene] = compose([{
      title: '簽約', summary: 's', sceneId: `7:evening:${HALL}`, locationId: HALL, status: 'active',
    }]).scenes;
    expect(scene.episodeHref).toBeNull();
  });

  test('recovers the world day from the sceneId, and gives up cleanly when it cannot', () => {
    expect(sceneWorldDay('12:dawn:mistwood-hall')).toBe(12);
    expect(sceneWorldDay('0:dawn:x')).toBe(0);
    expect(sceneWorldDay(undefined)).toBeNull();
    expect(sceneWorldDay('not-a-day:dawn:x')).toBeNull();
    expect(sceneWorldDay('-1:dawn:x')).toBeNull();
  });
});
