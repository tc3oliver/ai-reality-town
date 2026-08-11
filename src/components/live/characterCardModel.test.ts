/**
 * Unit tests for the public character card's display model (ART-124 / FR-O006).
 *
 * Two headline claims, matching the two things the task calls out as high risk.
 *
 * **AC#5 — the privacy boundary.** The card is the primary path from "who is that" to narrative
 * understanding, which makes it the most direct private-data exposure risk on the live map. The
 * poisoned-source case below is the same shape `characterRoute.test.ts` uses for the character
 * page: a payload carrying every forbidden field is fed in, and the resulting model is checked
 * both for forbidden KEYS and for the forbidden VALUES as literal strings, because a leak that
 * renamed the key on the way through would pass a key-only assertion.
 *
 * **AC#6 — visual identity.** The card and the canvas must resolve the same character to the
 * same sprite. Asserted by composing both models from one roster and comparing the keys, rather
 * than by pinning a key by hand — a hand-written expectation would keep passing if the two
 * lookups diverged and both happened to be wrong the same way.
 *
 * Pure jest (no jsdom).
 */

import { mistwoodCharacterSpriteKeys } from '../../../data/mistwoodCharacters';
import { mistwoodLocationFootprints, mistwoodWorldMap } from '../../../data/mistwood';
import { characterTargetId } from '../world/cameraModel';
import { composeReadOnlyWorldViewModel } from '../world/worldViewModel';
import type { PublicCharacterMotion } from '../world/worldViewModel';
import type { CharacterProjection, CharacterRecentEvent } from '../public/characterRoute';
import {
  CHARACTER_CARD_RECENT_EVENT_LIMIT,
  characterIdFromFocusTargetId,
  composeCharacterCardViewModel,
  forbiddenKeysInCharacterCard,
  type CharacterCardSceneInput,
} from './characterCardModel';

const WORLD_ID = 'mistwood';
/** A palette-variant resident, so the sprite assertion covers the non-trivial branch. */
const CHARACTER_ID = 'zhao-ming';
const MILL = 'mistwood-mill';

function character(overrides: Partial<CharacterProjection> = {}): CharacterProjection {
  return {
    id: CHARACTER_ID, worldId: WORLD_ID, name: '趙銘', age: 41, occupation: '磨坊工',
    publicProfile: '北水磨坊的常客。', personality: '寡言', values: '守信',
    publicGoal: '修好水車', fear: '洪水', currentLocationId: 'mistwood-square',
    healthState: '健康', emotionalState: '平靜', financialState: '拮据', alive: true, active: true,
    ...overrides,
  };
}

function motion(overrides: Partial<PublicCharacterMotion> = {}): PublicCharacterMotion {
  return {
    characterId: CHARACTER_ID, semanticLocationId: MILL, motionType: 'canon', motionSequence: 3,
    from: { x: 36, y: 18 }, to: { x: 38, y: 18 }, startedAt: 0, arriveAt: 1_000,
    animationState: 'walking', direction: 'right',
    ...overrides,
  };
}

const scenes: CharacterCardSceneInput[] = [
  {
    title: '修水車', sceneId: `7:evening:${MILL}`, status: 'active',
    participantCharacterIds: [CHARACTER_ID, 'he-jun'], arcIds: ['arc-mill', 'arc-truce'],
  },
  {
    title: '別的場景', sceneId: '7:evening:mistwood-hall', status: 'active',
    participantCharacterIds: ['he-jun'], arcIds: ['arc-hall'],
  },
  {
    title: '昨天的事', sceneId: `6:noon:${MILL}`, status: 'ended',
    participantCharacterIds: [CHARACTER_ID], arcIds: ['arc-old'],
  },
];

const recentEvents: CharacterRecentEvent[] = [
  { eventId: 'e1', worldDay: 3, timeSlot: 'noon', publicSummary: '簽下休戰。', episodeNumber: 3 },
  { eventId: 'e2', worldDay: 5, timeSlot: 'night', publicSummary: null, episodeNumber: null },
];

function compose(overrides: Partial<Parameters<typeof composeCharacterCardViewModel>[0]> = {}) {
  return composeCharacterCardViewModel({
    worldId: WORLD_ID,
    characterId: CHARACTER_ID,
    character: character(),
    motion: motion(),
    scenes,
    recentEvents,
    spriteKeys: mistwoodCharacterSpriteKeys,
    footprints: mistwoodLocationFootprints,
    ...overrides,
  });
}

describe('characterIdFromFocusTargetId', () => {
  it('round-trips the id the camera model produces, and refuses every other target', () => {
    // Derived from the producer rather than written out again, so the two cannot drift.
    expect(characterIdFromFocusTargetId(characterTargetId(CHARACTER_ID))).toBe(CHARACTER_ID);
    expect(characterIdFromFocusTargetId('location:mistwood-mill')).toBeNull();
    expect(characterIdFromFocusTargetId('scene:7:evening:mistwood-mill')).toBeNull();
    expect(characterIdFromFocusTargetId('town')).toBeNull();
    expect(characterIdFromFocusTargetId(characterTargetId(''))).toBeNull();
  });
});

describe('composeCharacterCardViewModel — identity and public background (AC#1)', () => {
  it('carries name, occupation and public background from the projection', () => {
    const vm = compose();
    expect(vm.hasContent).toBe(true);
    expect(vm.name).toBe('趙銘');
    expect(vm.occupation).toBe('磨坊工');
    expect(vm.publicProfile).toBe('北水磨坊的常客。');
  });

  it('falls back to the character id, never to another resident, when nothing has arrived yet', () => {
    const vm = compose({ character: undefined, motion: null, scenes: null, recentEvents: null });
    expect(vm.hasContent).toBe(false);
    expect(vm.name).toBe(CHARACTER_ID);
    expect(vm.occupation).toBe('—');
    expect(vm.recentEvents).toEqual([]);
    expect(vm.activeArcs).toEqual([]);
  });

  it('tells a read in flight apart from a projection that was never built', () => {
    // `useQuery` returns `undefined` while reading and the served value afterwards;
    // `serveReadModel` returns `null` for a character whose model has never been published.
    // Collapsing the two is how a card shows "loading…" forever for something not coming.
    expect(compose({ character: undefined }).status).toBe('loading');
    expect(compose({ character: null }).status).toBe('unavailable');
    expect(compose().status).toBe('ready');
    expect(compose({ character: null }).hasContent).toBe(false);
    expect(compose().hasContent).toBe(true);
  });

  it('still describes the live motion when the projection is unavailable', () => {
    // The half that does not depend on the projection: the map is still drawing this character,
    // so the card degrades to what it knows rather than to nothing.
    const vm = compose({ character: null });
    expect(vm.status).toBe('unavailable');
    expect(vm.locationLabel).toBe(
      mistwoodLocationFootprints.find((footprint) => footprint.id === MILL)?.name,
    );
    expect(vm.movementLabel).toBe('正在前往目的地');
    expect(vm.spriteAssetKey).toBe(mistwoodCharacterSpriteKeys[CHARACTER_ID]);
    expect(vm.characterHref).toBe('#character/mistwood/zhao-ming');
  });
});

describe('location, movement and activity (AC#2)', () => {
  it('names the location the way the map names it, from the motion the map is drawing', () => {
    const vm = compose();
    // `Northwater Mill`, not the raw slug, and not the projection's stale `currentLocationId`.
    expect(vm.locationLabel).toBe(
      mistwoodLocationFootprints.find((footprint) => footprint.id === MILL)?.name,
    );
    expect(vm.movementLabel).toBe('正在前往目的地');
    expect(vm.activityLabel).toBe('移動中');
    expect(vm.emotionalState).toBe('平靜');
  });

  it('describes an in-zone drift and a standing character differently', () => {
    expect(compose({ motion: motion({ motionType: 'ambient', animationState: 'idle' }) }))
      .toMatchObject({ movementLabel: '在附近走動', activityLabel: '待著' });
    expect(compose({ motion: motion({ motionType: 'idle', animationState: 'idle' }) }))
      .toMatchObject({ movementLabel: '停留原地', activityLabel: '待著' });
  });

  it('falls back to the projection’s location when the character has no published motion', () => {
    const vm = compose({ motion: null });
    expect(vm.locationLabel).toBe(
      mistwoodLocationFootprints.find((footprint) => footprint.id === 'mistwood-square')?.name,
    );
    // No motion means no honest answer about movement, so it says so rather than guessing.
    expect(vm.movementLabel).toBe('—');
    expect(vm.activityLabel).toBe('—');
  });

  it('shows a location the map has no footprint for as its raw id, never as a blank', () => {
    expect(compose({ motion: motion({ semanticLocationId: 'somewhere-unmapped' }) }).locationLabel)
      .toBe('somewhere-unmapped');
    expect(compose({ motion: null, character: character({ currentLocationId: null }) }).locationLabel)
      .toBe('—');
  });
});

describe('public goal, active arcs and recent events (AC#3)', () => {
  it('lists only the arcs of ACTIVE scenes this character is actually in', () => {
    const vm = compose();
    expect(vm.publicGoal).toBe('修好水車');
    // `arc-hall` belongs to a scene without this character; `arc-old` to an ended one.
    expect(vm.activeArcs).toEqual([
      { arcId: 'arc-mill', sceneTitle: '修水車' },
      { arcId: 'arc-truce', sceneTitle: '修水車' },
    ]);
  });

  it('lists an arc once even when two concurrent scenes carry it', () => {
    const vm = compose({
      scenes: [
        scenes[0],
        { ...scenes[0], title: '另一幕', sceneId: '7:evening:mistwood-hall' },
      ],
    });
    expect(vm.activeArcs.map((arc) => arc.arcId)).toEqual(['arc-mill', 'arc-truce']);
  });

  it('labels recent events and links only those with a published episode', () => {
    const vm = compose();
    expect(vm.recentEvents).toHaveLength(2);
    expect(vm.recentEvents[0].label).toBe('[日 3 noon] 簽下休戰。');
    expect(vm.recentEvents[0].episodeHref).toBe('#episode/mistwood/3');
    expect(vm.recentEvents[1].label).toContain('(無摘要)');
    expect(vm.recentEvents[1].episodeHref).toBeNull();
  });

  it('bounds the recent list and keeps the newest end of it', () => {
    const many: CharacterRecentEvent[] = Array.from({ length: 12 }, (_unused, index) => ({
      eventId: `e${index}`, worldDay: index, timeSlot: 'noon',
      publicSummary: `第 ${index} 件事`, episodeNumber: null,
    }));
    const vm = compose({ recentEvents: many });
    expect(vm.recentEvents).toHaveLength(CHARACTER_CARD_RECENT_EVENT_LIMIT);
    // The tail, not the head: the timeline payload runs oldest-first.
    expect(vm.recentEvents.at(-1)?.eventId).toBe('e11');
  });
});

describe('the link to the character page (AC#4)', () => {
  it('points at #character/<worldId>/<characterId>, encoded', () => {
    expect(compose().characterHref).toBe('#character/mistwood/zhao-ming');
    expect(compose({ worldId: 'a b', characterId: 'c/d' }).characterHref)
      .toBe('#character/a%20b/c%2Fd');
  });
});

describe('AC#5 — no private field can reach the card, even from a poisoned payload', () => {
  const POISON = {
    privateProfile: '不該外洩的私事',
    privateGoal: '秘密目標:找到失蹤的弟弟',
    knowledge: { secret: '未揭露的秘密' },
    memory: ['私人記憶'],
    memories: ['另一段私人記憶'],
    prompt: 'system prompt',
    rawModelOutput: 'raw model output',
    adminNotes: 'operator annotation',
    secret: 'secret value',
    token: 'abc123',
  };

  /** Every private string the poisoned payload carries, flattened. */
  const POISON_STRINGS = [
    '不該外洩的私事', '秘密目標:找到失蹤的弟弟', '未揭露的秘密', '私人記憶', '另一段私人記憶',
    'system prompt', 'raw model output', 'operator annotation', 'secret value', 'abc123',
  ];

  it('surfaces neither the forbidden keys nor the forbidden values', () => {
    const smuggled = { ...character(), ...POISON } as unknown as CharacterProjection;
    const vm = compose({ character: smuggled });

    // By key: the model is built from named fields, so nothing copied the payload wholesale.
    expect(forbiddenKeysInCharacterCard(vm)).toEqual([]);
    // ...and by literal value, which is what catches a leak that renamed the key on the way
    // through — a `secret` folded into a label would pass the key check and fail this one.
    const serialized = JSON.stringify(vm);
    for (const text of POISON_STRINGS) expect(serialized).not.toContain(text);
    // The allowed fields still came through, so this is not passing by composing nothing.
    expect(vm.publicGoal).toBe('修好水車');
    expect(vm.publicProfile).toBe('北水磨坊的常客。');
  });

  it('cannot be poisoned through the scene, motion or timeline inputs either', () => {
    const vm = compose({
      scenes: [{
        ...scenes[0],
        ...POISON,
      } as unknown as CharacterCardSceneInput],
      motion: { ...motion(), ...POISON } as unknown as ReturnType<typeof motion>,
      recentEvents: [{
        ...recentEvents[0], ...POISON,
      } as unknown as CharacterRecentEvent],
    });
    expect(forbiddenKeysInCharacterCard(vm)).toEqual([]);
    const serialized = JSON.stringify(vm);
    for (const text of POISON_STRINGS) expect(serialized).not.toContain(text);
  });
});

describe('AC#6 — the card and the map draw the same character', () => {
  it('resolves the sprite asset through the same roster the renderer draws from', () => {
    const world = composeReadOnlyWorldViewModel({
      map: mistwoodWorldMap,
      motions: [motion()],
      spriteKeys: mistwoodCharacterSpriteKeys,
      nowMs: 0,
    });
    const drawn = world.characters.find((entry) => entry.characterId === CHARACTER_ID);
    expect(drawn).toBeDefined();
    // Compared against what the renderer actually resolved, not against a hand-written key: a
    // pinned constant would keep passing if both lookups drifted the same way.
    expect(compose().spriteAssetKey).toBe(drawn!.spriteKey);
    // And this character is a palette variant, so the non-trivial branch is the one covered.
    expect(compose().spriteAssetKey).toContain('#');
  });

  it('resolves every resident the map can draw, and refuses one it cannot', () => {
    for (const characterId of Object.keys(mistwoodCharacterSpriteKeys)) {
      expect(compose({ characterId }).spriteAssetKey).toBe(mistwoodCharacterSpriteKeys[characterId]);
    }
    // A character with no visual binding draws nothing rather than borrowing another
    // resident's appearance (FR-N004 AC#6).
    expect(compose({ characterId: 'nobody' }).spriteAssetKey).toBeNull();
  });
});
