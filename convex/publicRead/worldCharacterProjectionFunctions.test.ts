/**
 * The safety gate on the public Character projection (ART-124, extending FR-P004 / ART-132).
 *
 * ART-132 closed the gap between the post-generation safety classification and the dynamic
 * surface's NARRATIVE text — scene cards, event summaries, the replay. It did not close it for
 * a character's BIOGRAPHY, and that path was wide open: `publicProfile`, `publicGoal`,
 * `personality`, `values`, `fear`, `behaviorRules` and `occupation` are all LLM-writable after
 * world creation, through the generic `fact_created` / `character_state_changed` state changes
 * a scene proposes, and they land verbatim on the public character page and the character card.
 * A scene classified `withhold` therefore had its summary suppressed while the biography it
 * wrote in the same breath stayed fully public.
 *
 * ART-124 closes it with the SAME machinery rather than a second one: the classifier's input is
 * widened to include those values (`sceneSimulation.ts`), and the projection folds them through
 * ART-132's existing bounded `readWithheldSceneLabels` sweep. This file proves the projection
 * half — both the pure fold, and the retroactive-override path end to end, by running the same
 * join the rebuild runs over real table fixtures and feeding its answer into the same builder.
 */

import type { AcceptedEvent, StateChange } from '../canon/model';
import { readWithheldSceneLabels } from '../safety/effectiveSafetyLabels';
import { buildCharacterProjection } from './worldCharacterProjection';
import { characterSourceFrom } from './worldCharacterProjectionFunctions';

const WORLD_ID = 'mistwood';
const CHARACTER_ID = 'zhao-ming';
const CLEAN_SCENE = 'mistwood:3:morning:grouping:scene:1';
const POISONED_SCENE = 'mistwood:3:evening:grouping:scene:2';

const SAFE_PROFILE = '北水磨坊的常客,話不多。';
const POISONED_PROFILE = 'POISONED: 一段安全分類器拒絕發佈的角色描述。';

function event(
  eventId: string,
  stateChanges: StateChange[],
  sceneId?: string,
  sequenceNumber = 0,
): AcceptedEvent {
  return {
    schemaVersion: 1,
    eventId,
    worldId: WORLD_ID,
    sequenceNumber,
    idempotencyKey: eventId,
    proposedBy: { type: 'system' },
    worldDay: 3,
    timeSlot: 'morning',
    eventType: 'conversation',
    participantIds: [CHARACTER_ID],
    causedByEventIds: [],
    stateChanges,
    acceptedAt: 1_000 + sequenceNumber,
    validationVersion: '1',
    traceId: `trace-${eventId}`,
    ...(sceneId === undefined ? {} : { metadata: { sceneId } }),
  };
}

function fact(predicate: string, value: string): StateChange {
  return {
    type: 'fact_created',
    subjectType: 'character',
    subjectId: CHARACTER_ID,
    predicate,
    value,
    visibility: 'public',
  };
}

function stateChange(field: string, toValue: string | boolean): StateChange {
  return {
    type: 'character_state_changed',
    characterId: CHARACTER_ID,
    field,
    toValue,
    reason: 'the scene said so',
  } as StateChange;
}

const occupation = (toValue: string): StateChange => stateChange('occupation', toValue);

describe('characterSourceFrom — a withheld scene’s biography never reaches the projection', () => {
  it('publishes everything when no scene is refused', () => {
    const events = [
      event('e1', [fact('publicProfile', SAFE_PROFILE)], CLEAN_SCENE),
      event('e2', [fact('publicGoal', '修好水車')], POISONED_SCENE, 1),
    ];
    // Explicit empty set: the parameter is required precisely so that forgetting it is a
    // compile error rather than a silent fail-open republish.
    const source = characterSourceFrom(events, CHARACTER_ID, new Set());
    expect(source).toMatchObject({ publicProfile: SAFE_PROFILE, publicGoal: '修好水車' });
  });

  it('drops a fact_created value whose scene is refused, and only that value', () => {
    const events = [
      event('e1', [fact('publicProfile', SAFE_PROFILE)], CLEAN_SCENE),
      event('e2', [fact('publicGoal', POISONED_PROFILE)], POISONED_SCENE, 1),
    ];
    const source = characterSourceFrom(events, CHARACTER_ID, new Set([POISONED_SCENE]));

    // The refused predicate is absent entirely — it had no prior value to fall back to.
    expect(source.publicGoal).toBeUndefined();
    expect('publicGoal' in source).toBe(false);
    // ...and the string itself is nowhere in the payload, whatever key it might have taken.
    expect(JSON.stringify(source)).not.toContain('POISONED');
    // The clean scene's contribution is untouched: the gate is per-scene, not per-character.
    expect(source.publicProfile).toBe(SAFE_PROFILE);
  });

  it('falls back to the last known good value rather than blanking the field', () => {
    // The refused event is skipped as if it had never been accepted, so the field keeps the
    // value the earlier, allowed scene wrote. Blanking would punish the clean scene for the
    // refused one, and Canon still holds both — nothing here rewrites history.
    const events = [
      event('e1', [fact('publicProfile', SAFE_PROFILE)], CLEAN_SCENE),
      event('e2', [fact('publicProfile', POISONED_PROFILE)], POISONED_SCENE, 1),
    ];
    const source = characterSourceFrom(events, CHARACTER_ID, new Set([POISONED_SCENE]));
    expect(source.publicProfile).toBe(SAFE_PROFILE);
  });

  it('gates character_state_changed the same way', () => {
    const events = [
      event('e1', [occupation('磨坊工')], CLEAN_SCENE),
      event('e2', [occupation('POISONED: 一個被拒絕的職業描述')], POISONED_SCENE, 1),
    ];
    expect(characterSourceFrom(events, CHARACTER_ID, new Set([POISONED_SCENE])).occupation)
      .toBe('磨坊工');
  });

  it('leaves position and life alone, so a refused sentence cannot move a character', () => {
    // The same reason ART-132 left character motion untouched: withholding a location change
    // would make the map disagree with Canon about where somebody is standing.
    const events = [
      event('e1', [
        { type: 'character_location_changed', characterId: CHARACTER_ID, fromLocationId: 'a', toLocationId: 'b' },
        { type: 'character_life_changed', characterId: CHARACTER_ID, alive: false, reason: 'the river' },
        fact('publicProfile', POISONED_PROFILE),
      ], POISONED_SCENE),
    ];
    const source = characterSourceFrom(events, CHARACTER_ID, new Set([POISONED_SCENE]));
    expect(source.currentLocationId).toBe('b');
    expect(source.alive).toBe(false);
    expect(source.publicProfile).toBeUndefined();
  });

  it('never resurrects a deactivated character, however the deactivation was withheld', () => {
    // `active` is projected like the four narrative fields but asserts EXISTENCE, not prose.
    // Gating it would skip the deactivation, leave the field at its previous `true`, and put the
    // character projection at odds with `excludedCharacterIds` — which reads the same change on
    // the motion path and has no safety input at all. A character would then be listed as active
    // while being absent from the map.
    const events = [
      event('e1', [stateChange('active', true)], CLEAN_SCENE),
      event('e2', [
        stateChange('active', false),
        fact('publicProfile', POISONED_PROFILE),
      ], POISONED_SCENE, 1),
    ];
    const source = characterSourceFrom(events, CHARACTER_ID, new Set([POISONED_SCENE]));
    expect(source.active).toBe(false);
    // ...and the text in the very same event is still refused, so the carve-out is scoped to
    // existence rather than being a hole in the gate.
    expect(source.publicProfile).toBeUndefined();
    expect(JSON.stringify(source)).not.toContain('POISONED');
  });

  it('applies a reactivation from a withheld scene too, in both directions', () => {
    const events = [
      event('e1', [stateChange('active', false)], CLEAN_SCENE),
      event('e2', [stateChange('active', true)], POISONED_SCENE, 1),
    ];
    expect(characterSourceFrom(events, CHARACTER_ID, new Set([POISONED_SCENE])).active).toBe(true);
  });

  it('does NOT withhold an event with no resolvable scene provenance', () => {
    // ART-132's convention, and the reason it is a convention: Canon carries seed, system and
    // remediation events no post-generation classifier ever examined, plus everything accepted
    // before provenance was stamped. Reading their silence as a refusal would blank the public
    // character page for content that was never in question.
    const events = [
      event('seed', [fact('publicProfile', SAFE_PROFILE)]),
      event('blank', [fact('publicGoal', '修好水車')], '', 1),
    ];
    const source = characterSourceFrom(events, CHARACTER_ID, new Set([POISONED_SCENE, '']));
    expect(source).toMatchObject({ publicProfile: SAFE_PROFILE, publicGoal: '修好水車' });
  });

  it('ignores another character’s facts entirely, refused or not', () => {
    const events = [event('e1', [
      { ...fact('publicProfile', POISONED_PROFILE), subjectId: 'someone-else' } as StateChange,
    ], POISONED_SCENE)];
    expect(characterSourceFrom(events, CHARACTER_ID, new Set([POISONED_SCENE])))
      .toEqual({ id: CHARACTER_ID });
  });
});

// ---------------------------------------------------------------------------
// The retroactive path, over the real join.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/**
 * The slice of Convex `readWithheldSceneLabels` uses, modelled the way
 * `effectiveSafetyLabels.test.ts` models it — including the index ordering, so a fake that
 * returned insertion order could not make the test pass for the wrong reason.
 */
function memoryDb(tables: Record<string, Row[]>) {
  const db = {
    query(table: string) {
      return {
        withIndex(_index: string, build: (q: unknown) => unknown) {
          const constraints: Row = {};
          const builder = {
            eq(field: string, value: unknown) {
              constraints[field] = value;
              return builder;
            },
          };
          build(builder);
          const matched = (tables[table] ?? []).filter((row) =>
            Object.entries(constraints).every(([field, value]) => row[field] === value));
          const ascending = [...matched].sort((left, right) =>
            Number(left.createdAt ?? 0) - Number(right.createdAt ?? 0));
          const chain = (rows: Row[]) => ({
            order: (direction: 'asc' | 'desc') => chain(direction === 'desc' ? [...rows].reverse() : rows),
            take: (count: number) => Promise.resolve(rows.slice(0, count)),
            collect: () => Promise.resolve(rows),
            first: () => Promise.resolve(rows[0] ?? null),
            unique: () => Promise.resolve(rows[0] ?? null),
          });
          return chain(ascending);
        },
      };
    },
  };
  return db as unknown as Parameters<typeof readWithheldSceneLabels>[0];
}

function classificationRow(label: string, sourceId: string): Row {
  return {
    policyVersion: 1,
    worldId: WORLD_ID,
    classificationId: `${sourceId}:simulation:safety`,
    sourceId,
    kind: 'scene',
    label,
    reasonCodes: [],
    warningCodes: [],
    classifiedTextHash: 'fnv1a32:deadbeef',
    createdAt: 1_000,
  };
}

function overrideRow(label: string, createdAt: number): Row {
  return {
    worldId: WORLD_ID,
    sourceId: POISONED_SCENE,
    classificationId: `${POISONED_SCENE}:simulation:safety`,
    label,
    reason: 'a viewer report was upheld on review',
    actor: 'op-admin',
    createdAt,
  };
}

/** What `rebuildCharacterProjection` does, with its two reads supplied as fixtures. */
async function rebuild(tables: Record<string, Row[]>, events: readonly AcceptedEvent[]) {
  const withheld = await readWithheldSceneLabels(memoryDb(tables), WORLD_ID);
  return buildCharacterProjection({
    worldId: WORLD_ID,
    source: characterSourceFrom(events, CHARACTER_ID, new Set(Object.keys(withheld))),
  });
}

describe('an operator override retroactively removes a published biography (AC#3-style)', () => {
  const events = [
    event('e1', [fact('publicProfile', SAFE_PROFILE)], CLEAN_SCENE),
    event('e2', [fact('publicGoal', POISONED_PROFILE)], POISONED_SCENE, 1),
  ];

  it('publishes it while the classifier allowed it', async () => {
    const projection = await rebuild({
      postGenerationSafetyClassifications: [
        classificationRow('allow', CLEAN_SCENE),
        classificationRow('allow', POISONED_SCENE),
      ],
      safetyStatusOverrides: [],
    }, events);
    expect(projection.publicGoal).toBe(POISONED_PROFILE);
  });

  it('drops it on the next rebuild once an override withholds the scene', async () => {
    // The whole point of doing this at REBUILD time rather than at read time: an override
    // re-runs the rebuild, so the refused text is never in the published payload for the
    // last-known-good fallback to keep serving.
    const projection = await rebuild({
      postGenerationSafetyClassifications: [
        classificationRow('allow', CLEAN_SCENE),
        classificationRow('allow', POISONED_SCENE),
      ],
      safetyStatusOverrides: [overrideRow('withhold', 2_000)],
    }, events);
    expect(projection.publicGoal).toBeNull();
    expect(JSON.stringify(projection)).not.toContain('POISONED');
    // Nothing else moved: the clean scene's contribution is byte-identical.
    expect(projection.publicProfile).toBe(SAFE_PROFILE);
  });

  it('withholds it directly when the classifier itself refused the scene', async () => {
    const projection = await rebuild({
      postGenerationSafetyClassifications: [
        classificationRow('allow', CLEAN_SCENE),
        classificationRow('human_review_required', POISONED_SCENE),
      ],
      safetyStatusOverrides: [],
    }, events);
    expect(projection.publicGoal).toBeNull();
  });

  it('brings it back when a later override releases the scene', async () => {
    // The gate is derived, not destructive: Canon still holds the event, so releasing the scene
    // republishes it on the next rebuild without anything being re-simulated.
    const projection = await rebuild({
      postGenerationSafetyClassifications: [
        classificationRow('allow', CLEAN_SCENE),
        classificationRow('withhold', POISONED_SCENE),
      ],
      safetyStatusOverrides: [overrideRow('allow', 3_000)],
    }, events);
    expect(projection.publicGoal).toBe(POISONED_PROFILE);
  });
});
