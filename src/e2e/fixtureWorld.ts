import type { FixtureScenario } from './fixtureScenario';
import { MISTWOOD_CHARACTER_VISUALS } from '../../data/mistwoodCharacters';
import { mistwoodLocationFootprints } from '../../data/mistwood';
import { voteConsequenceModelRef } from '../../convex/shared/environmentVoteCatalog';
import { relationshipGraphModelRef } from '../../convex/shared/relationshipGraphRef';

/**
 * The deterministic world the browser E2E suite watches (FR-Q006 / ART-137).
 *
 * ## Why a fixture at all
 *
 * PRD 2.0 §22 makes browser evidence a release gate, and evidence has to be reproducible. A live
 * deployment is not: its characters are wherever the last accepted slot put them, its replay
 * exists or does not, and its safety gate may have withheld the scene the spec was going to
 * assert on. A suite written against that would either be flaky or would assert nothing specific
 * enough to catch a regression.
 *
 * ## The fixture rule (ART-107 §8)
 *
 * Every identifier here is DERIVED from production data rather than invented: character ids come
 * from `MISTWOOD_CHARACTER_VISUALS` (the mirror of the production visual roster, pinned against
 * `buildMistwoodCharacterVisualBindings()`) and location ids from `mistwoodLocationFootprints`.
 * `fixtureWorld.test.ts` asserts both, so a fixture that drifted from the seed — the exact
 * failure ART-107 §8 forbids — fails a unit test rather than producing a green E2E run against a
 * world that does not exist.
 *
 * ## What is deliberately NOT here
 *
 * No private field of any kind: no `privateProfile`, `privateGoal`, `fear` or secret. The
 * payloads below are shaped like the PUBLISHED projections, which are already field-allowlisted
 * server-side — so this fixture cannot put on screen something the real surface would not.
 */

/** Every resident, in roster order. Twelve of them, which AC#2's upper bound asks for. */
export const FIXTURE_CHARACTER_IDS: readonly string[] = MISTWOOD_CHARACTER_VISUALS.map(
  (visual) => visual.characterId,
);

export const FIXTURE_WORLD_ID = 'mistwood';
export const FIXTURE_WORLD_DAY = 7;
export const FIXTURE_TIME_SLOT = 'evening';

const MILL = 'mistwood-mill';
const HALL = 'mistwood-hall';

/** A footprint's centre, so a fixture character stands somewhere the map actually has. */
function centreOf(locationId: string): { x: number; y: number } {
  const footprint = mistwoodLocationFootprints.find((candidate) => candidate.id === locationId);
  if (footprint === undefined) {
    throw new Error(`fixture references a location Mistwood does not have: ${locationId}`);
  }
  return {
    x: footprint.rect.x + Math.floor(footprint.rect.width / 2),
    y: footprint.rect.y + Math.floor(footprint.rect.height / 2),
  };
}

/**
 * The four animation states AC#4 requires to be distinguishable, assigned to the first four
 * residents. `activity` is the fifth state the projection can carry and is given to a fifth so
 * the spec can prove the four it names are told apart from a state that is not one of them.
 */
const ANIMATION_ASSIGNMENT = ['walking', 'idle', 'speaking', 'thinking', 'activity'] as const;

/**
 * One motion per resident.
 *
 * The first is WALKING across a real distance with an `arriveAt` far enough ahead that the
 * interpolation is still in flight while the spec samples it twice — that is what makes AC#3's
 * "moving smoothly from one point to another" observable rather than a claim. The rest stand
 * still, so the only thing moving on screen is the thing under test.
 */
export function fixtureMotions(nowMs: number) {
  const mill = centreOf(MILL);
  const hall = centreOf(HALL);
  return FIXTURE_CHARACTER_IDS.map((characterId, index) => {
    const walking = index === 0;
    const animationState = ANIMATION_ASSIGNMENT[index] ?? 'idle';
    const anchor = index % 2 === 0 ? mill : hall;
    return {
      characterId,
      semanticLocationId: index % 2 === 0 ? MILL : HALL,
      motionType: walking ? ('canon' as const) : ('idle' as const),
      motionSequence: index + 1,
      from: walking ? mill : { x: anchor.x + (index % 3), y: anchor.y + (index % 2) },
      to: walking ? hall : { x: anchor.x + (index % 3), y: anchor.y + (index % 2) },
      startedAt: walking ? nowMs : nowMs - 60_000,
      // Deliberately long: a walk that has already finished by the time the page paints is a
      // teleport, and would make AC#3 unobservable no matter how correct the renderer is.
      arriveAt: walking ? nowMs + 60_000 : nowMs - 60_000,
      animationState,
      direction: 'down' as const,
    };
  });
}

/** One active scene and one ended scene, so AC#6 and the Episode link both have something. */
export function fixtureScenes() {
  return [
    {
      title: '磨坊對質',
      summary: '兩派在磨坊為停工的水車爭執。',
      sourceEventIds: ['mistwood#event#101'],
      sceneId: `${FIXTURE_WORLD_DAY}:${FIXTURE_TIME_SLOT}:${MILL}`,
      locationId: MILL,
      // Sorted and duplicate-free, which the production validator requires: an unsorted list
      // would mean the same scene serialised two ways and re-derived as a change.
      participantCharacterIds: [FIXTURE_CHARACTER_IDS[0], FIXTURE_CHARACTER_IDS[1]].sort(),
      arcIds: ['arc-mill'],
      status: 'active' as const,
      publicationStatus: 'published' as const,
      startedAt: 1_000,
    },
    {
      title: '鎮公所休戰',
      summary: '眾人見證休戰簽署。',
      sourceEventIds: ['mistwood#event#102'],
      sceneId: `${FIXTURE_WORLD_DAY}:${FIXTURE_TIME_SLOT}:${HALL}`,
      locationId: HALL,
      participantCharacterIds: [FIXTURE_CHARACTER_IDS[2]],
      arcIds: ['arc-truce'],
      status: 'ended' as const,
      publicationStatus: 'published' as const,
      startedAt: 900,
      endedAt: 950,
    },
  ];
}

export function fixtureProjection(nowMs: number) {
  return {
    worldId: FIXTURE_WORLD_ID,
    mapId: 'mistwood',
    runtimeVersion: 1,
    snapshotSequence: 1,
    /**
     * Two minutes ago, not a sentinel.
     *
     * It was `1_000` — an arbitrary small number that no assertion looked at until ART-127's
     * ladder started rendering a relative age from it, at which point the live map cheerfully
     * announced 「20689 天前更新」. The value was never wrong for what it was used for; it
     * became wrong the moment something read it as a time. A fixture standing in for a real
     * Canon `acceptedAt` should look like one.
     */
    updatedAt: Math.max(0, nowMs - 120_000),
    worldStatus: 'running' as const,
    characters: fixtureMotions(nowMs),
    activeScenes: fixtureScenes(),
    worldDay: FIXTURE_WORLD_DAY,
    timeSlot: FIXTURE_TIME_SLOT,
  };
}

/**
 * A two-scene replay in the REAL `VisualReplay` shape (AC#9).
 *
 * Written against `convex/publicRead/visualReplay.ts`'s contract rather than against what the
 * client happens to read, and `fixtureWorld.test.ts` runs it through the production
 * `assertVisualReplay`. The first version of this file invented `{ motions, summaryRef }` — a
 * shape nothing rejects and nothing plays, so the replay silently never started and three E2E
 * criteria failed for a reason that looked like a product defect. Validating the fixture against
 * the same assertion the server uses is what makes that class of mistake impossible.
 *
 * Durations sit at `REPLAY_SCENE_MIN_MS`, the shortest a real scene may be, so the suite observes
 * a genuine playback without waiting a minute for it.
 *
 * `replayId` is stable, because `replaySession` keys its once-per-tab auto-play mark on it: an
 * unstable id would auto-play on every reload and AC#9's "once" half would be unobservable.
 */
export function fixtureReplay() {
  const mill = centreOf(MILL);
  const hall = centreOf(HALL);
  const scene = (
    index: number,
    locationId: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    summaryId: string,
  ) => ({
    sceneId: `${FIXTURE_WORLD_DAY}:${FIXTURE_TIME_SLOT}:${locationId}`,
    worldDay: FIXTURE_WORLD_DAY,
    timeSlot: FIXTURE_TIME_SLOT,
    locationId,
    sourceEventIds: [`mistwood#event#${100 + index}`],
    participants: [
      { characterId: FIXTURE_CHARACTER_IDS[index], startPosition: from, endPosition: to },
    ],
    steps: [
      { type: 'move' as const, characterId: FIXTURE_CHARACTER_IDS[index], to, durationMs: 16_000 },
      {
        type: 'eventCard' as const,
        refKind: 'canonEventSummary' as const,
        publicSummaryId: summaryId,
        publicationVersion: 1,
        durationMs: 4_000,
      },
    ],
    // Always the sum of the steps' durations, and inside [MIN, MAX] — both are contract, and
    // both are checked by `assertVisualReplay`.
    durationMs: 20_000,
  });

  return {
    replay: {
      schemaVersion: 1 as const,
      replayId: `replay:${FIXTURE_WORLD_ID}:102`,
      worldId: FIXTURE_WORLD_ID,
      worldDay: FIXTURE_WORLD_DAY,
      timeSlot: FIXTURE_TIME_SLOT,
      sourceEventIds: ['mistwood#event#101', 'mistwood#event#102'],
      scenes: [
        scene(0, MILL, mill, hall, 'sum-1'),
        scene(1, HALL, hall, mill, 'sum-2'),
      ],
      totalDurationMs: 40_000,
    },
    texts: [
      { publicSummaryId: 'sum-1', publicationVersion: 1, text: '兩派在磨坊爭執。' },
      { publicSummaryId: 'sum-2', publicationVersion: 1, text: '眾人見證休戰簽署。' },
    ],
  };
}

/** The published read models the map and the homepage ask for, by `modelRef`. */
export function fixtureReadModel(modelRef: string): { payload: unknown } | null {
  if (modelRef === `onboarding:${FIXTURE_WORLD_ID}`) {
    return {
      payload: {
        summaryText: '磨坊之爭正在升溫,兩派剛在鎮公所簽下休戰。',
        structured: {
          majorEvent: { eventId: 'mistwood#event#102', publicSummary: '眾人見證休戰簽署。' },
          importance: 4,
          // The homepage's first screen (FR-P001 / ART-129) draws up to four of these with their
          // sprite bindings. Absent, the screen renders with nobody in it — which is a valid
          // degraded state and therefore not something an E2E failure would obviously explain.
          characters: MISTWOOD_CHARACTER_VISUALS.slice(0, 4).map((visual) => ({
            characterId: visual.characterId,
            name: visual.displayName,
          })),
          facts: [
            { factId: 'f1', predicate: 'millStopped', value: true },
            { factId: 'f2', predicate: 'auditRequested', value: true },
            { factId: 'f3', predicate: 'truceSigned', value: true },
          ],
          question: '休戰能撐過冬天嗎?',
          recommendedEpisode: { episodeNumber: 3, worldDay: FIXTURE_WORLD_DAY },
        },
      },
    };
  }
  if (modelRef === `live:${FIXTURE_WORLD_ID}`) {
    // The COMPLETE `LiveProjection`, not just the arcs the story overlay reads. The text Live
    // View — the non-map equivalent NFR2-006 makes a release gate — reads the same model and
    // walks `characters`, `locations`, `recentEvents` and `activeScenes`; a partial payload made
    // that page render nothing at all, which the accessibility suite caught and the map suite
    // never would have, because the map does not read those fields.
    return {
      payload: {
        worldTime: { worldDay: FIXTURE_WORLD_DAY, timeSlot: FIXTURE_TIME_SLOT },
        locations: mistwoodLocationFootprints.map((footprint) => ({
          locationId: footprint.id,
          name: footprint.name,
          description: footprint.vocabulary,
          locationType: 'public',
          active: footprint.id === MILL || footprint.id === HALL,
        })),
        characters: FIXTURE_CHARACTER_IDS.map((characterId, index) => ({
          characterId,
          locationId: index % 2 === 0 ? MILL : HALL,
          alive: true,
        })),
        recentEvents: [
          {
            eventId: 'mistwood#event#102',
            summary: '眾人見證休戰簽署。',
            worldDay: FIXTURE_WORLD_DAY,
            timeSlot: FIXTURE_TIME_SLOT,
          },
        ],
        activeArcs: [
          { arcId: 'arc-truce', title: '休戰協議', currentQuestion: '休戰能撐過冬天嗎?', status: 'climax' },
          { arcId: 'arc-mill', title: '磨坊之爭', currentQuestion: '水車修得好嗎?', status: 'active' },
        ],
        activeScenes: fixtureScenes(),
        publishedEpisodeStatus: 'ready',
      },
    };
  }
  if (modelRef === `timeline:${FIXTURE_WORLD_ID}`) {
    return {
      payload: {
        entries: [
          {
            eventId: 'mistwood#event#102',
            worldDay: 3,
            timeSlot: 'noon',
            publicSummary: '眾人見證休戰簽署。',
            characterIds: [...FIXTURE_CHARACTER_IDS],
            episodeNumber: 3,
          },
        ],
      },
    };
  }
  if (modelRef === voteConsequenceModelRef(FIXTURE_WORLD_ID, FIXTURE_WORLD_DAY)) {
    /**
     * The consequence model (FR-J002 / ART-46), in TODAY'S REAL PRODUCTION SHAPE.
     *
     * A trigger, no causal edge, and one event the Director's plan context mentioned the vote
     * to. That is what a live world actually publishes — no provider writes `causedByEventIds`
     * — so a fixture with a tidy invented causal chain would put the browser evidence behind a
     * state the product has never been in, which ART-107 §8 forbids.
     *
     * The key is built with the SAME `voteConsequenceModelRef` the server and the homepage use,
     * not a template string that happens to match today. A fixture and a client that spell a key
     * two ways is the ART-146 failure exactly, and `fixtureConvexClient` THROWS on an unhandled
     * query — taking the whole page down, not just this section.
     */
    return {
      payload: {
        worldId: FIXTURE_WORLD_ID,
        targetWorldDay: FIXTURE_WORLD_DAY,
        trigger: {
          eventId: 'mistwood#event#100',
          sequenceNumber: 100,
          worldDay: FIXTURE_WORLD_DAY,
          timeSlot: FIXTURE_TIME_SLOT,
          eventType: 'world_event',
          publicSummary: '全鎮停電。',
          publicationStatus: 'published',
          bucket: 'trigger',
          depth: 0,
          path: ['mistwood#event#100'],
          provenance: { basis: 'vote_idempotency_key', sourceEventIds: ['mistwood#event#100'] },
        },
        direct: [],
        downstream: [],
        uncertain: [
          {
            eventId: 'mistwood#event#101',
            sequenceNumber: 101,
            worldDay: FIXTURE_WORLD_DAY,
            timeSlot: FIXTURE_TIME_SLOT,
            eventType: 'conversation',
            publicSummary: '兩派在磨坊為停工的水車爭執。',
            publicationStatus: 'published',
            bucket: 'uncertain',
            depth: null,
            path: [],
            provenance: {
              basis: 'director_plan_context',
              sourceEventIds: ['mistwood#event#100'],
            },
          },
        ],
        explicitCausalEdgeCount: 0,
      },
    };
  }
  if (modelRef === relationshipGraphModelRef(FIXTURE_WORLD_ID, FIXTURE_WORLD_DAY)) {
    /**
     * The scoped relationship graph (FR-I007 / ART-44), in the shape the SERVER publishes.
     *
     * Written against `convex/publicRead/relationshipGraphProjection.ts`'s contract rather than
     * against what the page happens to read, and `fixtureWorld.test.ts` runs it through the
     * production `assertRelationshipGraphBounds` — so a fixture that broke the thirty-node cap or
     * misreported its own truncation fails a unit test instead of producing a green E2E run
     * against a graph the product could not have published.
     *
     * Two core characters, two one-hop neighbours and one relationship type per edge, so the type
     * filter has something to narrow and the diagram has both rings. The counts are deliberately
     * inconsistent-free: `candidate* = rendered + omitted` on both axes, which is the invariant
     * the assertion checks.
     *
     * The key is built with the SAME `relationshipGraphModelRef` the server and the page use.
     * A fixture and a client that spell a key two ways is the ART-146 failure exactly, and
     * `fixtureConvexClient` THROWS on an unhandled query — taking the whole page down.
     */
    const core = FIXTURE_CHARACTER_IDS.slice(0, 2);
    const neighbours = FIXTURE_CHARACTER_IDS.slice(2, 4);
    /**
     * A node carries graph STRUCTURE only — no name, summary or occupation.
     *
     * That mirrors the server exactly: character text is read live from `character:<id>` (already
     * answered by the branch below), because a past day's graph is never rebuilt and a summary
     * frozen into it could not honour a retroactive withhold.
     */
    const node = (characterId: string, isCoreCharacter: boolean, edgeCount: number) => ({
      characterId,
      isCoreCharacter,
      hop: isCoreCharacter ? 0 : 1,
      edgeCount,
    });
    const edge = (
      first: string,
      second: string,
      relationshipType: string,
      strength: number,
      reason: string,
    ) => {
      // Endpoints derived from the SORTED key, exactly as `groupPublicRelationships` derives them
      // server-side. Taking them from the raw arguments was harmless while every caller happened
      // to pass them in order, and would have made the fixture disagree with the contract it
      // claims to be written against the first time one did not.
      const [sourceCharacterId, targetCharacterId] = [first, second].sort();
      return {
      pairKey: `${sourceCharacterId}:${targetCharacterId}`,
      sourceCharacterId,
      targetCharacterId,
      relationshipType,
      strength,
      dimensions: {
        trust: relationshipType === 'trust' ? strength : 0,
        affection: 0,
        resentment: relationshipType === 'resentment' ? strength : 0,
        fear: 0,
        dependency: 0,
        familiarity: 0,
      },
      lastChangedWorldDay: FIXTURE_WORLD_DAY,
      recentChanges: [
        { eventId: 'mistwood#event#101', worldDay: FIXTURE_WORLD_DAY, reason },
      ],
      changeCountInWindow: 1,
      };
    };
    return {
      payload: {
        schemaVersion: 1,
        worldId: FIXTURE_WORLD_ID,
        worldDay: FIXTURE_WORLD_DAY,
        arc: { arcId: 'arc-mill', title: '磨坊之爭', status: 'escalating' },
        nodes: [
          node(core[0], true, 2),
          node(core[1], true, 1),
          node(neighbours[0], false, 1),
          node(neighbours[1], false, 1),
        ],
        edges: [
          edge(core[0], core[1], 'resentment', 30, '兩派為停工的水車爭執'),
          edge(core[0], neighbours[0], 'trust', 20, '在鎮公所一同見證休戰'),
          edge(core[1], neighbours[1], 'trust', 10, '共同修復水車'),
        ],
        relationshipTypes: ['trust', 'resentment'],
        scope: { windowDays: 7, nodeLimit: 30, nodeOrdering: 'core_first_then_recent_change_desc' },
        candidateNodeCount: 4,
        candidateEdgeCount: 3,
        omittedNodeCount: 0,
        omittedEdgeCount: 0,
        sourceEventIds: ['mistwood#event#101'],
      },
    };
  }
  if (modelRef === `episodes:${FIXTURE_WORLD_ID}`) {
    /**
     * The published Episode Index (FR-I004), which the return recap (FR-H004 / ART-39) reads for
     * three separate things: the episodes a returning viewer missed, the world's followable
     * character and arc vocabulary, and the latest world day — which is what names the
     * `voteConsequence:` model the recap then asks for.
     *
     * The last episode sits on `FIXTURE_WORLD_DAY` on purpose, so that derived key is exactly the
     * one the vote-consequence branch above already answers. A fixture whose latest day disagreed
     * would send the recap at a `modelRef` nothing handles, and `fixtureReadModel` returning null
     * there would silently degrade the vote section rather than fail — the quieter half of the
     * ART-146 shape.
     *
     * Ids are DERIVED, per ART-107 §8: characters from the production visual roster, arcs from
     * the same two the fixture's scenes and live projection already use.
     */
    const arcIds = ['arc-mill', 'arc-truce'];
    const episodes = [3, 5, FIXTURE_WORLD_DAY].map((worldDay, index) => ({
      worldDay,
      episodeNumber: index + 1,
      title: `第 ${index + 1} 集`,
      headline: index === 2 ? '眾人見證休戰簽署。' : '磨坊之爭持續升溫。',
      arcIds: index === 2 ? ['arc-truce'] : ['arc-mill'],
      characterIds: [FIXTURE_CHARACTER_IDS[index], FIXTURE_CHARACTER_IDS[index + 1]],
      isRecommendedEntry: index === 1,
      isTurningPoint: index === 2,
    }));
    return {
      payload: {
        schemaVersion: 1,
        worldId: FIXTURE_WORLD_ID,
        episodes,
        arcIds,
        characterIds: [...FIXTURE_CHARACTER_IDS],
      },
    };
  }
  if (modelRef.startsWith('character:')) {
    const characterId = modelRef.slice('character:'.length);
    const visual = MISTWOOD_CHARACTER_VISUALS.find((c) => c.characterId === characterId);
    if (visual === undefined) return null;
    // Only the server-allowlisted public fields. Nothing private has a value to omit here
    // because nothing private was ever put in.
    return {
      payload: {
        id: characterId,
        worldId: FIXTURE_WORLD_ID,
        name: visual.displayName,
        age: 34,
        occupation: '鎮民',
        publicProfile: '霧林鎮的居民。',
        personality: '沉穩',
        values: '守信',
        publicGoal: '把水車修好',
        currentLocationId: MILL,
        healthState: '健康',
        emotionalState: '平靜',
        financialState: '普通',
        alive: true,
        active: true,
      },
    };
  }
  return null;
}

/** A `live` runtime snapshot, so the homepage's freshness badge (ART-131 AC#3) has a verdict. */
export function fixtureRuntimeSnapshot(nowMs: number, scenario: FixtureScenario = 'stream') {
  /**
   * The `delayed` scenario ages the CONTENT, not the observation (FR-Q005 / ART-136).
   *
   * `classifyRuntimeFreshness` reports `delayed` when the content is between one and two slot
   * gaps old while the capture path is still confirming it — a world that has missed a slot,
   * not one whose monitoring has stopped. Ageing `observedAt` instead would produce `stale`,
   * which is a different state and a different set of figures.
   */
  const ageMs = scenario === 'delayed' ? 7 * 3_600_000 : 120_000;
  return {
    worldId: FIXTURE_WORLD_ID,
    runtimeVersion: 1,
    snapshotSequence: 1,
    sourceRuntimeSequence: 1,
    status: 'live' as const,
    freshness: scenario === 'delayed' ? ('delayed' as const) : ('live' as const),
    mapId: 'mistwood',
    /**
     * Populated with ART-127. It was `[]`, which is not a plausible last-valid snapshot: the
     * whole reason the table exists is to hold the world state when the projection cannot, and
     * an empty one holds nothing. It went unnoticed because until the ladder wired rung 2 up,
     * nothing on the live map read this at all — only the homepage's freshness chip did, and
     * that reads no positions.
     */
    characterStates: fixtureMotions(nowMs),
    activeSceneStates: fixtureScenes(),
    contentUpdatedAt: Math.max(0, nowMs - ageMs),
    createdAt: Math.max(0, nowMs - ageMs),
    observedAt: Math.max(0, nowMs - 60_000),
    contentAgeMs: ageMs,
    observationAgeMs: 60_000,
    thresholds: { delayedMaxAgeMs: 1, observationMaxAgeMs: 1 },
  };
}
