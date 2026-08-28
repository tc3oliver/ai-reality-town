/**
 * The E2E fixture is a real payload, not a plausible one (FR-Q006 / ART-137).
 *
 * ## Why this test exists, concretely
 *
 * The first version of `fixtureReplay()` invented `{ motions, summaryRef }` for a replay scene.
 * Nothing rejected it — the client reads defensively — and nothing played it, so the replay
 * silently never started and three browser criteria failed in ways that looked like product
 * defects. The suite was testing a world that does not exist.
 *
 * Running each fixture payload through the PRODUCTION assertion — the same one the server applies
 * when it reads a stored projection back — makes that class of mistake impossible. A fixture that
 * drifts from the contract now fails a fast unit test rather than producing a confusing browser
 * failure, or worse, a green run against a shape the real surface would never emit.
 *
 * ## And the fixture rule (ART-107 §8)
 *
 * Every identifier must come from production data. That is asserted here rather than trusted,
 * because "use the production ids" is exactly the kind of rule that holds until someone adds one
 * more character in a hurry.
 */

import { MISTWOOD_CHARACTER_VISUALS } from '../../data/mistwoodCharacters';
import { mistwoodLocationFootprints } from '../../data/mistwood';
import { assertPublicDynamicProjection } from '../../convex/publicRead/publicDynamicProjection';
import { assertVisualReplay } from '../../convex/publicRead/visualReplay';
import {
  assertRelationshipGraphBounds,
  type RelationshipGraphProjection,
} from '../../convex/publicRead/relationshipGraphProjection';
import { relationshipGraphModelRef } from '../../convex/shared/relationshipGraphRef';
import {
  FIXTURE_CHARACTER_IDS,
  FIXTURE_WORLD_DAY,
  FIXTURE_WORLD_ID,
  fixtureProjection,
  fixtureReadModel,
  fixtureReplay,
  fixtureRuntimeSnapshot,
  fixtureScenes,
} from './fixtureWorld';

describe('the fixture is a payload the real surface could have produced', () => {
  test('the dynamic projection passes the production assertion', () => {
    // The same check `getPublicDynamicProjection` applies to a stored payload on read.
    expect(() => assertPublicDynamicProjection(fixtureProjection(1_000))).not.toThrow();
  });

  test('the visual replay passes the production assertion', () => {
    // The one that was wrong. `assertVisualReplay` checks the field sets, the step union, and
    // that each scene's `durationMs` is the sum of its steps and inside [MIN, MAX].
    expect(() => assertVisualReplay(fixtureReplay().replay)).not.toThrow();
  });

  test('the assertions are not vacuous', () => {
    // A guard that accepted anything would make every test above meaningless.
    expect(() => assertVisualReplay({ ...fixtureReplay().replay, scenes: 'nope' })).toThrow();
    expect(() => assertPublicDynamicProjection({ worldId: 'mistwood' })).toThrow();
    // ...and specifically the shape the first version of the fixture used, so this test names
    // the actual mistake rather than a generic one.
    const invented = {
      ...fixtureReplay().replay,
      scenes: [{ sceneId: 's', worldDay: 7, timeSlot: 'evening', locationId: 'mistwood-mill',
        motions: [], summaryRef: { publicSummaryId: 'x', publicationVersion: 1 }, durationMs: 1_200 }],
    };
    expect(() => assertVisualReplay(invented)).toThrow();
  });

  test('the relationship graph passes the production bound assertion (FR-I007 / ART-44)', () => {
    // The same check `buildRelationshipGraphProjection` ends with: the thirty-node cap, the
    // truncation counts adding up, no dangling edge, and no change outside the seven-day window.
    // A fixture that broke any of them would put the browser evidence behind a graph the product
    // could not have published.
    const payload = fixtureReadModel(relationshipGraphModelRef(FIXTURE_WORLD_ID, FIXTURE_WORLD_DAY))
      ?.payload as RelationshipGraphProjection;
    expect(payload).toBeDefined();
    expect(() => assertRelationshipGraphBounds(payload)).not.toThrow();
    // ...and it is not vacuous: the same payload with a mis-stated omission count is refused.
    expect(() => assertRelationshipGraphBounds({ ...payload, candidateNodeCount: 99 })).toThrow();
  });

  test('every text a replay step addresses is resolvable', () => {
    // A step whose `publicSummaryId` is in no `texts` entry renders the card's honest fallback
    // rather than the sentence, which would make an E2E assertion on the text flaky-by-design.
    const { replay, texts } = fixtureReplay();
    const available = new Set(texts.map((entry) => entry.publicSummaryId));
    for (const scene of replay.scenes) {
      for (const step of scene.steps) {
        if (step.type === 'eventCard') expect(available.has(step.publicSummaryId)).toBe(true);
      }
    }
  });
});

describe('the fixture rule (ART-107 §8): production identifiers only', () => {
  test('every character id is a production resident', () => {
    const production = new Set(MISTWOOD_CHARACTER_VISUALS.map((v) => v.characterId));
    expect(FIXTURE_CHARACTER_IDS.length).toBe(production.size);
    for (const id of FIXTURE_CHARACTER_IDS) expect(production.has(id)).toBe(true);
    // Twelve, which is the roster AC#2's upper bound names.
    expect(FIXTURE_CHARACTER_IDS.length).toBe(12);
  });

  test('every location id is a production footprint', () => {
    const production = new Set(mistwoodLocationFootprints.map((f) => f.id));
    for (const scene of fixtureScenes()) expect(production.has(scene.locationId)).toBe(true);
    for (const motion of fixtureProjection(0).characters) {
      expect(production.has(motion.semanticLocationId)).toBe(true);
    }
    for (const scene of fixtureReplay().replay.scenes) expect(production.has(scene.locationId)).toBe(true);
  });

  test('every character a scene or replay names is one of the residents', () => {
    const residents = new Set(FIXTURE_CHARACTER_IDS);
    for (const scene of fixtureScenes()) {
      for (const id of scene.participantCharacterIds) expect(residents.has(id)).toBe(true);
    }
    for (const scene of fixtureReplay().replay.scenes) {
      for (const participant of scene.participants) expect(residents.has(participant.characterId)).toBe(true);
    }
  });

  test('a character projection exists for every resident, and for no one else', () => {
    for (const id of FIXTURE_CHARACTER_IDS) {
      expect(fixtureReadModel(`character:${id}`)).not.toBeNull();
    }
    // An id the world does not have returns null, which is what the real read model does for a
    // character whose projection was never published — so the card's "unavailable" branch is
    // reachable rather than being an untested path.
    expect(fixtureReadModel('character:not-a-resident')).toBeNull();
    expect(fixtureReadModel('nonsense:xyz')).toBeNull();
  });
});

describe('the states AC#4 asks to be distinguishable are actually present', () => {
  test('four different animation states are carried by four different residents', () => {
    const motions = fixtureProjection(0).characters;
    const states = motions.slice(0, 4).map((motion) => motion.animationState);
    expect(new Set(states)).toEqual(new Set(['walking', 'idle', 'speaking', 'thinking']));
    // ...on four DIFFERENT characters, since the browser suite reads one card per character.
    expect(new Set(motions.slice(0, 4).map((m) => m.characterId)).size).toBe(4);
  });

  test('exactly one resident is mid-walk, so AC#3 observes one thing moving', () => {
    const motions = fixtureProjection(1_000).characters;
    const inFlight = motions.filter((motion) => motion.arriveAt > motion.startedAt);
    expect(inFlight).toHaveLength(1);
    // ...and its arrival is far enough ahead that it is still walking while the suite samples.
    expect(inFlight[0].arriveAt - 1_000).toBeGreaterThan(10_000);
  });
});

describe('the fixture carries no private field', () => {
  test('a character projection has only publicly-projected keys', () => {
    const payload = fixtureReadModel(`character:${FIXTURE_CHARACTER_IDS[0]}`)?.payload as Record<
      string,
      unknown
    >;
    for (const forbidden of [
      'privateProfile', 'privateGoal', 'fear', 'secretContents', 'knowledge', 'memory',
      'prompt', 'rawModelOutput', 'adminNotes',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(payload, forbidden)).toBe(false);
    }
    // ...and it did produce something, so this is not passing on an empty object.
    expect(payload.name).toBeTruthy();
  });

  test('the runtime snapshot reports a state the badge can render', () => {
    expect(fixtureRuntimeSnapshot(1_000_000).freshness).toBe('live');
  });

  test('the runtime snapshot actually holds a world state, which is the point of it', () => {
    // ART-127 wired the live map's second ladder rung to this table. An empty snapshot is not a
    // plausible last-valid one — it holds nothing to fall back TO — and it went unnoticed
    // because until then only the homepage's freshness chip read it, and that reads no
    // positions. Pinned against the same production assertion the projection is held to.
    const snapshot = fixtureRuntimeSnapshot(1_000_000);
    expect(snapshot.characterStates.length).toBe(FIXTURE_CHARACTER_IDS.length);
    for (const motion of snapshot.characterStates) {
      expect(FIXTURE_CHARACTER_IDS).toContain(motion.characterId);
    }
    // Ages must be plausible too: the ladder renders a relative "last updated" from these, and
    // a sentinel timestamp reads as a confidently wrong claim about how old the world is.
    expect(snapshot.contentUpdatedAt).toBeGreaterThan(0);
    expect(snapshot.observedAt).toBeGreaterThanOrEqual(snapshot.contentUpdatedAt);
  });
});

describe('the onboarding summary can feed the homepage first screen (FR-P001)', () => {
  test('it names four residents, with production ids and real bindings', () => {
    // The first screen draws up to four characters with their sprite bindings. Without them the
    // screen renders with nobody in it — a valid degraded state, and therefore NOT something a
    // browser failure would obviously explain. It cost a debugging round; now it is pinned.
    const payload = fixtureReadModel(`onboarding:${'mistwood'}`)?.payload as {
      structured: { characters: Array<{ characterId: string; name: string }> };
    };
    expect(payload.structured.characters).toHaveLength(4);
    for (const character of payload.structured.characters) {
      const binding = MISTWOOD_CHARACTER_VISUALS.find((v) => v.characterId === character.characterId);
      expect(binding).toBeDefined();
      expect(character.name).toBe(binding!.displayName);
    }
  });
});
