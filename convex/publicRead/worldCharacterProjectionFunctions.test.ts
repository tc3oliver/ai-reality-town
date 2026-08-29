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
import { emptyProjection } from '../canon/model';
import { replayWorldEvents } from '../canon/replay';
import { rowToAcceptedEvent } from '../canon/serialize';
import { buildSnapshot } from '../canon/snapshots';
import { readWithheldSceneLabels } from '../safety/effectiveSafetyLabels';
import { buildCharacterProjection } from './worldCharacterProjection';
import {
  characterSourceFrom,
  characterSourceFromProjection,
  rebuildCharacterProjection,
  rebuildWorldProjection,
} from './worldCharacterProjectionFunctions';

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

// ---------------------------------------------------------------------------
// ART-100: the Convex WIRING (`rebuildWorldProjection` / `rebuildCharacterProjection`), run
// against the registered handlers over an in-memory `db`, the way
// `relationshipGraphProjectionFunctions.test.ts` proves ITS snapshot substitution.
// ---------------------------------------------------------------------------

type Tables = Record<string, Row[]>;
type RegisteredMutation = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };

const worldHandler = rebuildWorldProjection as unknown as RegisteredMutation;
const characterHandler = rebuildCharacterProjection as unknown as RegisteredMutation;

/**
 * The `db` double both mutations run against. Modelled on
 * `relationshipGraphProjectionFunctions.test.ts`'s `memoryCtx` — including the `gt` range bound,
 * which is load-bearing here for the same reason: modelling it as a no-op would let an unbounded
 * collect pass every read-cost assertion below.
 */
function memoryCtx(tables: Tables, reads?: Record<string, number>) {
  const count = (table: string, rows: Row[]) => {
    if (reads) reads[table] = (reads[table] ?? 0) + rows.length;
    return rows;
  };
  const db = {
    query(table: string) {
      return {
        withIndex(_index: string, build?: (q: unknown) => unknown) {
          const constraints: Row = {};
          const lowerExclusive: Record<string, number> = {};
          const builder = {
            eq(field: string, value: unknown) {
              constraints[field] = value;
              return builder;
            },
            gt(field: string, value: number) {
              lowerExclusive[field] = value;
              return builder;
            },
          };
          if (build) build(builder);
          const matched = (tables[table] ?? []).filter((row) =>
            Object.entries(constraints).every(([field, value]) => row[field] === value)
            && Object.entries(lowerExclusive).every(([field, value]) => Number(row[field]) > value));
          const ascending = [...matched].sort((left, right) =>
            Number(left.sequenceNumber ?? left.lastSequenceNumber ?? left.createdAt ?? 0)
            - Number(right.sequenceNumber ?? right.lastSequenceNumber ?? right.createdAt ?? 0));
          const chain = (rows: Row[]) => ({
            order: (direction: 'asc' | 'desc') => chain(direction === 'desc' ? [...rows].reverse() : rows),
            take: (n: number) => Promise.resolve(count(table, rows.slice(0, n))),
            collect: () => Promise.resolve(count(table, rows)),
            first: () => Promise.resolve(count(table, rows.slice(0, 1))[0] ?? null),
            unique: () => Promise.resolve(count(table, rows.slice(0, 1))[0] ?? null),
          });
          return chain(ascending);
        },
      };
    },
    insert(table: string, row: Row) {
      const _id = `${table}:${(tables[table] ?? []).length}`;
      (tables[table] ??= []).push({ ...row, _id });
      return Promise.resolve(_id);
    },
    patch(id: string, patch: Row) {
      for (const rows of Object.values(tables)) {
        const row = rows.find((candidate) => candidate._id === id);
        if (row) Object.assign(row, patch);
      }
      return Promise.resolve();
    },
  };
  return { db } as Parameters<typeof worldHandler._handler>[0];
}

function baseTables(over: Partial<Tables> = {}): Tables {
  return {
    canonEvents: [],
    canonSnapshots: [],
    worldSchedules: [{ worldId: WORLD_ID, mode: 'live', status: 'running' }],
    publishedReadModels: [],
    postGenerationSafetyClassifications: [],
    safetyStatusOverrides: [],
    ...over,
  };
}

/** One accepted-event row. `stateChanges` is whatever the caller needs folded. */
function canonRow(input: {
  sequenceNumber: number;
  worldDay?: number;
  timeSlot?: string;
  stateChanges: StateChange[];
  sceneId?: string;
  participantIds?: string[];
}): Row {
  return {
    worldId: WORLD_ID,
    sequenceNumber: input.sequenceNumber,
    acceptedAt: 1_000 + input.sequenceNumber,
    validationVersion: 'canon-v1',
    traceId: `trace-${input.sequenceNumber}`,
    payload: {
      schemaVersion: 1,
      worldId: WORLD_ID,
      idempotencyKey: `event-${input.sequenceNumber}`,
      proposedBy: { type: 'system' },
      worldDay: input.worldDay ?? 1,
      timeSlot: input.timeSlot ?? 'morning',
      eventType: 'conversation',
      participantIds: input.participantIds ?? [CHARACTER_ID],
      causedByEventIds: [],
      publicSummary: null,
      stateChanges: input.stateChanges,
      ...(input.sceneId === undefined ? {} : { metadata: { sceneId: input.sceneId } }),
    },
  };
}

/**
 * A daily snapshot over the events through `throughSequence`, built the way stage 20 builds one
 * — `buildSnapshot` computes the integrity hash, so a hand-rolled row would be rejected by
 * `validateSnapshot` rather than exercising the path. This world has no seeded `initial`
 * snapshot, so its baseline is the empty projection and every substitution below must be EXACT.
 */
function snapshotRow(canonEvents: Row[], throughSequence: number, worldDay: number): Row {
  const prefix = canonEvents
    .filter((row) => Number(row.sequenceNumber) <= throughSequence)
    .map((row) => rowToAcceptedEvent(row as Parameters<typeof rowToAcceptedEvent>[0]));
  const snapshot = buildSnapshot(replayWorldEvents(emptyProjection(WORLD_ID), prefix), 900, worldDay);
  return { ...snapshot, kind: 'daily' };
}

function worldFact(predicate: string, value: string | number): StateChange {
  return { type: 'fact_created', subjectType: 'world', subjectId: WORLD_ID, predicate, value, visibility: 'public' };
}

function locationFact(locationId: string, predicate: string, value: string): StateChange {
  return { type: 'fact_created', subjectType: 'location', subjectId: locationId, predicate, value, visibility: 'public' };
}

/** A relationship change between two OTHER characters — padding that neither builder reads. */
function fillerChange(sequenceNumber: number): StateChange {
  return {
    type: 'relationship_changed',
    sourceCharacterId: 'he-jun',
    targetCharacterId: 'mei-lin',
    trustDelta: 1, affectionDelta: 0, resentmentDelta: 0,
    reason: `filler-${sequenceNumber}`,
    visibility: 'private',
  };
}

async function rebuildWorld(tables: Tables, reads?: Record<string, number>) {
  return worldHandler._handler(memoryCtx(tables, reads), { worldId: WORLD_ID, now: 5_000 }) as Promise<{
    modelRef: string; version: number; deduplicated: boolean;
  }>;
}

async function rebuildCharacter(tables: Tables, characterId = CHARACTER_ID, reads?: Record<string, number>) {
  return characterHandler._handler(memoryCtx(tables, reads), {
    worldId: WORLD_ID, characterId, now: 5_000,
  }) as Promise<{ modelRef: string; version: number; deduplicated: boolean }>;
}

/** The payload a rebuild published, read back out of the store, scoped to one `modelRef`. */
function publishedPayload(tables: Tables, modelRef: string): Record<string, unknown> {
  const rows = (tables.publishedReadModels ?? []).filter((row) => row.isCurrent && row.modelRef === modelRef);
  expect(rows).toHaveLength(1);
  return rows[0].payload as Record<string, unknown>;
}

/**
 * `totalEvents` events: World/location facts up front, `totalEvents - 20` filler events (padding
 * so the fixture is large enough that a bounded read is visibly smaller than a full one), then a
 * TEN-event tail that re-overrides `description` and the location's `name` — proving the fold
 * spanning the snapshot boundary is exact, not just the prefix — and ends on a distinct
 * `worldDay`/`timeSlot` so `latest` is pinned too.
 */
function worldHistory(totalEvents: number): Row[] {
  const rows: Row[] = [
    canonRow({ sequenceNumber: 0, stateChanges: [worldFact('name', 'Mistwood')] }),
    canonRow({ sequenceNumber: 1, stateChanges: [worldFact('description', 'A foggy river town.')] }),
    canonRow({ sequenceNumber: 2, stateChanges: [locationFact('mill', 'name', 'North Mill')] }),
    canonRow({ sequenceNumber: 3, stateChanges: [worldFact('publicLaunchDay', 5)] }),
  ];
  const tailStart = totalEvents - 10;
  for (let seq = 4; seq < tailStart; seq += 1) {
    rows.push(canonRow({ sequenceNumber: seq, stateChanges: [fillerChange(seq)] }));
  }
  rows.push(canonRow({ sequenceNumber: tailStart, stateChanges: [worldFact('description', 'Lantern festival lights the docks.')] }));
  rows.push(canonRow({ sequenceNumber: tailStart + 1, stateChanges: [locationFact('mill', 'name', 'North Mill (rebuilt)')] }));
  for (let seq = tailStart + 2; seq < totalEvents - 1; seq += 1) {
    rows.push(canonRow({ sequenceNumber: seq, stateChanges: [fillerChange(seq)] }));
  }
  rows.push(canonRow({
    sequenceNumber: totalEvents - 1, worldDay: 6, timeSlot: 'night', stateChanges: [fillerChange(totalEvents - 1)],
  }));
  return rows;
}

describe('ART-100: rebuildWorldProjection resumes from a snapshot instead of replaying the whole log', () => {
  /** Snapshot covers everything up to (but not including) the 10-event tail. */
  function withSnapshot(totalEvents: number): Tables {
    const canonEvents = worldHistory(totalEvents);
    return baseTables({ canonEvents, canonSnapshots: [snapshotRow(canonEvents, totalEvents - 11, 5)] });
  }
  function withoutSnapshot(totalEvents: number): Tables {
    return baseTables({ canonEvents: worldHistory(totalEvents) });
  }

  it('publishes an identical payload whether or not a snapshot exists', async () => {
    const without = withoutSnapshot(60);
    await rebuildWorld(without);
    const withSnap = withSnapshot(60);
    await rebuildWorld(withSnap);
    expect(publishedPayload(withSnap, `world:${WORLD_ID}`)).toEqual(publishedPayload(without, `world:${WORLD_ID}`));
  });

  it('the tail correctly overrides values the snapshot already folded', async () => {
    const withSnap = withSnapshot(60);
    await rebuildWorld(withSnap);
    const payload = publishedPayload(withSnap, `world:${WORLD_ID}`);
    expect(payload.description).toBe('Lantern festival lights the docks.');
    expect(payload.currentWorldDay).toBe(6);
    expect(payload.currentTimeSlot).toBe('night');
    const publicFacts = payload.publicFacts as Array<{ subjectId: string; predicate: string; value: unknown }>;
    expect(publicFacts.filter((f) => f.subjectId === 'mill' && f.predicate === 'name')).toHaveLength(2);
  });

  it('reads a bounded number of documents regardless of total history (AC#1)', async () => {
    const smallReads: Record<string, number> = {};
    await rebuildWorld(withSnapshot(60), smallReads);
    const largeReads: Record<string, number> = {};
    await rebuildWorld(withSnapshot(120), largeReads);
    // The fast path's cost does not grow with history: same window + same 10-event tail either way.
    expect(smallReads.canonEvents).toBe(largeReads.canonEvents);
    expect(smallReads.canonEvents).toBe(30); // 10-event tail + the 20-event provenance window
    expect(smallReads.canonSnapshots).toBe(1);

    const fullReads: Record<string, number> = {};
    await rebuildWorld(withoutSnapshot(60), fullReads);
    expect(fullReads.canonEvents).toBe(60);
  });
});

/**
 * `totalEvents` events for `CHARACTER_ID`: a public profile + occupation + a location up front,
 * filler for everyone else in between, then a tail that (a) overrides `occupation` again, (b)
 * adds a brand-new fact, and (c) writes a PRIVATE `publicProfile` that must NOT clobber the
 * earlier public one — `characterSourceFrom`'s "skip private, do not clear" rule, reproduced by
 * `characterSourceFromProjection` over `projection.facts` rather than raw events.
 */
function characterHistory(totalEvents: number, options: { dieAt?: number } = {}): Row[] {
  const rows: Row[] = [
    canonRow({ sequenceNumber: 0, stateChanges: [fact('publicProfile', SAFE_PROFILE)] }),
    canonRow({ sequenceNumber: 1, stateChanges: [occupation('磨坊工')] }),
    canonRow({
      sequenceNumber: 2,
      stateChanges: [{ type: 'character_location_changed', characterId: CHARACTER_ID, fromLocationId: 'a', toLocationId: 'b' }],
    }),
  ];
  if (options.dieAt !== undefined) {
    rows.push(canonRow({
      sequenceNumber: options.dieAt,
      stateChanges: [{ type: 'character_life_changed', characterId: CHARACTER_ID, alive: false, reason: 'the river' }],
    }));
  }
  const tailStart = totalEvents - 10;
  for (let seq = 3; seq < tailStart; seq += 1) {
    if (seq === options.dieAt) continue;
    rows.push(canonRow({ sequenceNumber: seq, stateChanges: [fillerChange(seq)] }));
  }
  rows.push(canonRow({ sequenceNumber: tailStart, stateChanges: [occupation('磨坊管理員')] }));
  rows.push(canonRow({ sequenceNumber: tailStart + 1, stateChanges: [fact('publicGoal', '修好水車')] }));
  rows.push(canonRow({
    sequenceNumber: tailStart + 2,
    stateChanges: [{ ...fact('publicProfile', 'PRIVATE-SHOULD-NEVER-PUBLISH'), visibility: 'private' } as StateChange],
  }));
  for (let seq = tailStart + 3; seq < totalEvents; seq += 1) {
    if (seq === options.dieAt) continue;
    rows.push(canonRow({ sequenceNumber: seq, stateChanges: [fillerChange(seq)] }));
  }
  // `dieAt` (when set) is pushed out of sequence order above; `replayWorldEvents` requires a
  // gapless ASCENDING sequence, and `snapshotRow` replays this array directly.
  return rows.sort((left, right) => Number(left.sequenceNumber) - Number(right.sequenceNumber));
}

describe('ART-100: rebuildCharacterProjection resumes from a snapshot instead of replaying the whole log', () => {
  function withSnapshot(totalEvents: number, options: { dieAt?: number } = {}): Tables {
    const canonEvents = characterHistory(totalEvents, options);
    return baseTables({ canonEvents, canonSnapshots: [snapshotRow(canonEvents, totalEvents - 11, 5)] });
  }
  function withoutSnapshot(totalEvents: number): Tables {
    return baseTables({ canonEvents: characterHistory(totalEvents) });
  }

  it('publishes an identical payload whether or not a snapshot exists', async () => {
    const without = withoutSnapshot(60);
    await rebuildCharacter(without);
    const withSnap = withSnapshot(60);
    await rebuildCharacter(withSnap);
    expect(publishedPayload(withSnap, `character:${CHARACTER_ID}`))
      .toEqual(publishedPayload(without, `character:${CHARACTER_ID}`));
  });

  it('the tail correctly overrides values the snapshot already folded, and a later private write never clobbers an earlier public one', async () => {
    const withSnap = withSnapshot(60);
    await rebuildCharacter(withSnap);
    const payload = publishedPayload(withSnap, `character:${CHARACTER_ID}`);
    expect(payload.occupation).toBe('磨坊管理員');
    expect(payload.publicGoal).toBe('修好水車');
    expect(payload.publicProfile).toBe(SAFE_PROFILE);
    expect(payload.currentLocationId).toBe('b');
    expect(JSON.stringify(payload)).not.toContain('PRIVATE-SHOULD-NEVER-PUBLISH');
  });

  it('reads a bounded number of documents regardless of total history (AC#1)', async () => {
    const smallReads: Record<string, number> = {};
    await rebuildCharacter(withSnapshot(60), CHARACTER_ID, smallReads);
    const largeReads: Record<string, number> = {};
    await rebuildCharacter(withSnapshot(120), CHARACTER_ID, largeReads);
    expect(smallReads.canonEvents).toBe(largeReads.canonEvents);
    expect(smallReads.canonEvents).toBe(30); // 10-event tail + the 20-event provenance window
    expect(smallReads.canonSnapshots).toBe(1);

    const fullReads: Record<string, number> = {};
    await rebuildCharacter(withoutSnapshot(60), CHARACTER_ID, fullReads);
    expect(fullReads.canonEvents).toBe(60);
  });

  describe('a currently-withheld Scene forces the full-log fallback, even with a snapshot present', () => {
    it('drops the withheld value and reads the whole log to do it', async () => {
      const canonEvents = [
        canonRow({ sequenceNumber: 0, stateChanges: [fact('publicProfile', SAFE_PROFILE)], sceneId: CLEAN_SCENE }),
        canonRow({ sequenceNumber: 1, stateChanges: [fact('publicGoal', POISONED_PROFILE)], sceneId: POISONED_SCENE }),
        canonRow({ sequenceNumber: 2, stateChanges: [fillerChange(2)] }),
        canonRow({ sequenceNumber: 3, stateChanges: [fillerChange(3)] }),
      ];
      const tables = baseTables({
        canonEvents,
        canonSnapshots: [snapshotRow(canonEvents, 1, 3)],
        postGenerationSafetyClassifications: [classificationRow('withhold', POISONED_SCENE)],
      });
      const reads: Record<string, number> = {};
      await rebuildCharacter(tables, CHARACTER_ID, reads);
      const payload = publishedPayload(tables, `character:${CHARACTER_ID}`);
      expect(payload.publicGoal).toBeNull();
      expect(payload.publicProfile).toBe(SAFE_PROFILE);
      // Not just correct — actually read every event, proving the escape hatch fired rather than
      // the (wrong, for a withheld world) bounded tail.
      expect(reads.canonEvents).toBe(canonEvents.length);
    });

    it('republishes once a later override releases the Scene, still via the full-log path', async () => {
      const canonEvents = [
        canonRow({ sequenceNumber: 0, stateChanges: [fact('publicProfile', SAFE_PROFILE)], sceneId: CLEAN_SCENE }),
        canonRow({ sequenceNumber: 1, stateChanges: [fact('publicGoal', POISONED_PROFILE)], sceneId: POISONED_SCENE }),
      ];
      const tables = baseTables({
        canonEvents,
        canonSnapshots: [snapshotRow(canonEvents, 1, 3)],
        postGenerationSafetyClassifications: [classificationRow('withhold', POISONED_SCENE)],
        safetyStatusOverrides: [overrideRow('allow', 3_000)],
      });
      await rebuildCharacter(tables);
      const payload = publishedPayload(tables, `character:${CHARACTER_ID}`);
      expect(payload.publicGoal).toBe(POISONED_PROFILE);
    });
  });

  describe('a character who has ever died forces the full-log fallback', () => {
    /**
     * `convex/canon/reducer.ts`'s `character_life_changed` case implicitly sets
     * `characterStates[id].active = false` as a side effect of the death — bookkeeping this
     * module's OWN fold (`characterSourceFrom`) does not do; only an explicit
     * `character_state_changed(field: 'active')` event moves `active` here. Trusting the
     * snapshot's collapsed `characterStates.active` for a character who has ever died would
     * silently publish the reducer's side effect instead of this module's rule. This is a defect
     * this task found, not one ART-100 was asked to fix, and the escape hatch exists to make sure
     * accelerating the read never introduces it.
     */
    it('does not inherit the reducer’s implicit active:false from a life change', async () => {
      const totalEvents = 60;
      const canonEvents = characterHistory(totalEvents, { dieAt: 5 });
      const tables = baseTables({
        canonEvents,
        canonSnapshots: [snapshotRow(canonEvents, totalEvents - 11, 5)],
      });
      const reads: Record<string, number> = {};
      await rebuildCharacter(tables, CHARACTER_ID, reads);
      const payload = publishedPayload(tables, `character:${CHARACTER_ID}`);
      expect(payload.alive).toBe(false);
      // No event here ever set `active` explicitly, so it defaults to `true` — unchanged from
      // pre-ART-100 behaviour, and NOT the reducer's `false`.
      expect(payload.active).toBe(true);
      // The escape hatch fired: the full log was read, not the bounded tail + window.
      expect(reads.canonEvents).toBe(totalEvents);
    });

    it('characterSourceFromProjection alone WOULD get this wrong — why the wiring must check first', () => {
      const events = [
        event('e1', [{ type: 'character_life_changed', characterId: CHARACTER_ID, alive: false, reason: 'the river' }]),
      ];
      const projection = replayWorldEvents(emptyProjection(WORLD_ID), events);
      const unsafe = characterSourceFromProjection(projection, CHARACTER_ID);
      expect(unsafe.active).toBe(false);
      // `characterSourceFrom` — the function that actually governs published output — disagrees:
      // it never touched `active` here, so it stays unset (defaults `true` downstream).
      const safe = characterSourceFrom(events, CHARACTER_ID, new Set());
      expect(safe.active).toBeUndefined();
    });
  });
});
