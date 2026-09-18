/**
 * What the in-authoring check accepts, the commit stages accept (ART-208).
 *
 * ## The contradiction this exists to resolve
 *
 * Three things were true on the acceptance deployment at once, and could not be:
 *
 *  - the ART-205 in-authoring Canon check PASSED every scene it saw;
 *  - stage 8 then refused those scenes with `DUPLICATE_CHARACTER_MOVEMENT`;
 *  - `authoringFailures` held ZERO `SCENE_CANON_REJECTED` rows, across every slot ever run.
 *
 * If both checks validated the same candidate with the same validator, at most two of those could
 * hold. They validate different candidates: `simulate_scenes` runs
 *
 *     withSceneProvenance(withArrivalStateChanges(result, world.snapshot))
 *
 * AFTER `authorSlotScenes` returns, and `withArrivalStateChanges` PREPENDS a
 * `character_location_changed` to the first proposed event for every participant whose projected
 * location differs from the scene's. The in-authoring check runs inside `simulateWholeScene` and
 * never sees it.
 *
 * ## Why it started mattering when it did
 *
 * `withArrivalStateChanges`'s own docblock states the premise it was built on: "The author never
 * sees the world projection, so it cannot state the movement precondition." ART-200 made that
 * false — each participant is now told their own origin and their own legal destinations, so the
 * author proposes movements itself. The orchestrator then injects a second one for the same
 * character, and Canon allows one per event.
 *
 * ## What these tests are
 *
 * The real functions, in the real order, with nothing between them mocked: parse → in-authoring
 * validation → `withArrivalStateChanges` → `withSceneProvenance` → stage 7 → stage 8. A candidate
 * the first check accepts must survive to the last, and when it does not these say which boundary
 * changed it rather than only that a code differed.
 */

import { emptyProjection, type ProposedEvent, type WorldProjection } from '../canon/model';
import { validateCanon, validateEventStructure } from '../canon/validators';
import type { GroupedScene } from './sceneGrouping';
import { finalizeWholeSceneOutput, parseWholeSceneOutput } from './sceneSimulation';
import { withArrivalStateChanges, withSceneProvenance, type LiveWorldSnapshot } from './worldDayLive';

const WORLD_ID = 'mistwood';
const HALL = 'mistwood-hall';
const MILL = 'mistwood-mill';
const PAPER = 'mistwood-paper';

/** `gao-wenrui` is at the mill; the scene is at the hall. That is what makes an arrival apply. */
const scene: GroupedScene = {
  schemaVersion: 1, sceneId: 'grouping:mistwood:9:morning:scene:1',
  groupingRunId: 'grouping:mistwood:9:morning', directorRunId: 'director:mistwood:9',
  worldId: WORLD_ID, worldDay: 9, timeSlot: 'morning', locationId: HALL,
  participantIds: ['gao-wenrui', 'lin-yingxue'], sourceIntentIds: ['i1', 'i2'],
  arcIds: ['arc-ledger'], trigger: '帳冊的缺頁', dramaticPressure: '鎮長在午前抵達',
};

const location = (locationId: string, connected: string[]) => ({
  locationId, name: locationId, description: '', locationType: 'civic',
  capacity: 8, connectedLocationIds: connected, active: true, lastUpdatedEventId: 'seed',
});

/** The projection both validations are performed against. Identical for each, deliberately. */
function world(): WorldProjection {
  const projection = emptyProjection(WORLD_ID);
  projection.characterAlive['gao-wenrui'] = true;
  projection.characterAlive['lin-yingxue'] = true;
  // The premise: one participant is NOT standing where the scene happens.
  projection.characterLocations['gao-wenrui'] = MILL;
  projection.characterLocations['lin-yingxue'] = HALL;
  // Fully connected between the three, so a movement the author proposes is legal on its own
  // merits. A fixture that made it illegal would have the in-authoring check refuse it, and this
  // file would then be testing the validator rather than the agreement between two of them.
  projection.locations[HALL] = location(HALL, [MILL, PAPER]);
  projection.locations[MILL] = location(MILL, [HALL, PAPER]);
  projection.locations[PAPER] = location(PAPER, [HALL, MILL]);
  return projection;
}

/** The snapshot `simulate_scenes` hands the injection, agreeing with the projection above. */
const snapshot = {
  characters: [
    { characterId: 'gao-wenrui', currentLocationId: MILL },
    { characterId: 'lin-yingxue', currentLocationId: HALL },
  ],
} as unknown as LiveWorldSnapshot;

const TRACE = {
  provider: 'fake' as const, requestedModel: 'm', resolvedModel: 'm', upstreamProvider: null,
  rateLimit: null, inputTokens: 1, outputTokens: 1, latencyMs: 1, retryCount: 0,
};

/** A model-shaped scene answer, as the provider returns one. */
const modelAnswer = (stateChanges: unknown[], eventType = 'movement') => ({
  schemaVersion: 1, sceneId: scene.sceneId, sceneSummary: '兩人在大廳對質。',
  keyActions: [{ characterId: 'gao-wenrui', action: '推出帳冊。' }],
  dialogueHighlights: [],
  proposedEvents: [{
    schemaVersion: 1, worldId: WORLD_ID, idempotencyKey: `${scene.sceneId}:1`,
    proposedBy: { type: 'system' }, worldDay: scene.worldDay, timeSlot: scene.timeSlot,
    eventType, locationId: HALL, participantIds: ['gao-wenrui'],
    causedByEventIds: [], publicSummary: '他離開磨坊。', stateChanges,
  }],
  relationshipChanges: [], knowledgeChanges: [], memories: [], rumors: [], continuityWarnings: [],
});

/**
 * The pipeline, with the real functions in the real order and nothing between them mocked.
 *
 * Returns what each boundary saw, so a disagreement can be attributed rather than merely observed.
 */
function runPipeline(answer: unknown) {
  const projection = world();

  // --- authoring: parse, then the ART-205 in-authoring Canon check -------------
  const parsed = parseWholeSceneOutput(answer, scene);
  const authoringCandidate = parsed.proposedEvents;
  const inAuthoring = authoringCandidate
    .map((event) => validateEventStructure(event) ?? validateCanon(event, projection))
    .find((error) => error !== null) ?? null;

  const result = finalizeWholeSceneOutput('sim:cross-stage', scene, parsed, 1, TRACE);

  // --- the two transforms `simulate_scenes` applies AFTER authoring ------------
  const arrived = withArrivalStateChanges(result, snapshot);
  const stamped = withSceneProvenance(arrived);
  const commitCandidate = stamped.output.proposedEvents;

  // --- stage 7, then stage 8, on what those transforms produced ----------------
  const structural = commitCandidate
    .map((event) => validateEventStructure(event)).find((error) => error !== null) ?? null;
  const canon = structural !== null ? null : commitCandidate
    .map((event) => validateCanon(event, projection)).find((error) => error !== null) ?? null;

  return { authoringCandidate, commitCandidate, inAuthoring, structural, canon };
}

/** Every `character_location_changed` in one event, as `characterId -> count`. */
const movementsIn = (event: ProposedEvent): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const change of event.stateChanges) {
    if (change.type === 'character_location_changed') {
      counts[change.characterId] = (counts[change.characterId] ?? 0) + 1;
    }
  }
  return counts;
};

// =============================================================================
// The invariant
// =============================================================================

describe('a candidate the in-authoring check accepts is not refused later by the same rule', () => {
  it('holds when the author moves a participant who is not yet in the scene', () => {
    /**
     * The live failure, reproduced without a provider. ART-200 tells `gao-wenrui` they are at the
     * mill and may go to the hall, so the author proposes exactly that — and the orchestrator then
     * injects the same arrival, giving one character two movements in one event.
     */
    const { inAuthoring, structural, canon } = runPipeline(modelAnswer([{
      type: 'character_location_changed', characterId: 'gao-wenrui',
      fromLocationId: MILL, toLocationId: HALL,
    }]));

    expect(inAuthoring).toBeNull();
    expect(structural).toBeNull();
    // Before ART-208 this was DUPLICATE_CHARACTER_MOVEMENT, and nothing anywhere said why: the
    // in-authoring check had passed the same scene moments earlier.
    expect(canon).toBeNull();
  });

  it('holds when the author moves that participant somewhere ELSE entirely', () => {
    // A harder case: the author sends them to the paper mill rather than into the scene. The
    // injected arrival would both duplicate the movement and contradict its destination.
    const { inAuthoring, canon } = runPipeline(modelAnswer([{
      type: 'character_location_changed', characterId: 'gao-wenrui',
      fromLocationId: MILL, toLocationId: PAPER,
    }]));

    expect(inAuthoring).toBeNull();
    expect(canon).toBeNull();
  });

  it('holds for a scene the author proposes no movement in', () => {
    // The negative control for the fix: the arrival must still be injected when the author did
    // NOT move the character, or a participant standing elsewhere would act in a room they never
    // entered.
    const { commitCandidate, inAuthoring, canon } = runPipeline(modelAnswer([{
      type: 'character_memory_formed', characterId: 'gao-wenrui',
      content: '停頓。', interpretation: '有所隱瞞。',
      importance: 0.5, emotionalWeight: 0.4, confidence: 0.7, visibility: 'private',
    }], 'conversation'));

    expect(inAuthoring).toBeNull();
    expect(canon).toBeNull();
    // The arrival IS present — this is what `withArrivalStateChanges` is for.
    expect(movementsIn(commitCandidate[0])['gao-wenrui']).toBe(1);
  });
});

// =============================================================================
// Which boundary changed the candidate
// =============================================================================

describe('the boundary between the two validations', () => {
  it('never gives one character two movements in one event', () => {
    /**
     * Stated as the property rather than as a code, so it fails the same way whichever rule Canon
     * happens to name. This is the thing `withArrivalStateChanges` was doing.
     */
    const { commitCandidate } = runPipeline(modelAnswer([{
      type: 'character_location_changed', characterId: 'gao-wenrui',
      fromLocationId: MILL, toLocationId: HALL,
    }]));

    for (const event of commitCandidate) {
      for (const [characterId, count] of Object.entries(movementsIn(event))) {
        expect({ characterId, count }).toEqual({ characterId, count: 1 });
      }
    }
  });

  it('does not discard or rewrite a stateChange the author wrote', () => {
    /**
     * The other half of "the candidate must not be mutated": the fix must skip the INJECTION, not
     * drop the author's movement. Dropping it would make the two validations agree by deleting the
     * thing they disagreed about, which is the shape of a fix that hides a defect.
     */
    const authored = {
      type: 'character_location_changed', characterId: 'gao-wenrui',
      fromLocationId: MILL, toLocationId: PAPER,
    };
    const { authoringCandidate, commitCandidate } = runPipeline(modelAnswer([authored]));

    expect(authoringCandidate[0].stateChanges).toContainEqual(authored);
    expect(commitCandidate[0].stateChanges).toContainEqual(authored);
  });

  it('adds only scene provenance to a scene that needed no arrival', () => {
    // With both participants already in the room, the ONLY difference the two transforms may make
    // is the `metadata.sceneId` stamp. Anything else is a candidate mutation.
    const bothPresent = {
      characters: [
        { characterId: 'gao-wenrui', currentLocationId: HALL },
        { characterId: 'lin-yingxue', currentLocationId: HALL },
      ],
    } as unknown as LiveWorldSnapshot;

    const parsed = parseWholeSceneOutput(modelAnswer([{
      type: 'character_memory_formed', characterId: 'gao-wenrui',
      content: '停頓。', interpretation: '有所隱瞞。',
      importance: 0.5, emotionalWeight: 0.4, confidence: 0.7, visibility: 'private',
    }], 'conversation'), scene);
    const result = finalizeWholeSceneOutput('sim:untouched', scene, parsed, 1, TRACE);
    const after = withSceneProvenance(withArrivalStateChanges(result, bothPresent));

    expect(after.output.proposedEvents[0].stateChanges).toEqual(parsed.proposedEvents[0].stateChanges);
    expect(after.output.proposedEvents[0].metadata).toEqual({ sceneId: scene.sceneId });
  });
});
