/**
 * Public Dynamic Projection contract tests (FR-N003 / ART-115).
 *
 * The suite is organised by acceptance criterion because the criteria are the contract: a
 * failure here should name the promise that broke, not just the function that threw.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { mistwoodCharacterSeed } from '../canon/mistwoodSeed';
import {
  createMultiHopFixture,
  createSingleMoveFixture,
  createZeroEventFixture,
  FIXTURE_ACCEPTED_AT_MS,
  MISTWOOD_SEED_PLACEMENTS,
} from '../visualRuntime/fixtures';
import type { MovementTrajectory } from '../visualRuntime/motion';
import type { AcceptedEventLike, VisualRuntimeInput } from '../visualRuntime/visualSyncPlanner';
import {
  commitReadModelVersion,
  invalidateReadModel,
  sanitizeForPublic,
  serveReadModel,
  SERVABLE_STATUS,
  type JsonValue,
  type PublishedReadModel,
  type PublicReadStore,
  type ReadModelKind,
  type StoredReadModel,
} from './readModel';
import {
  assertPublicDynamicProjection,
  buildPublicDynamicProjection,
  excludedCharacterIds,
  PUBLIC_ANIMATION_STATES,
  PUBLIC_DIRECTIONS,
  PUBLIC_DYNAMIC_FORBIDDEN_FIELDS,
  PUBLIC_DYNAMIC_OPTIONAL_ROOT_FIELDS,
  PUBLIC_DYNAMIC_ROOT_FIELDS,
  PUBLIC_DYNAMIC_RUNTIME_VERSION,
  PUBLIC_MOTION_OPTIONAL_FIELDS,
  PUBLIC_MOTION_REQUIRED_FIELDS,
  PUBLIC_MOTION_TYPES,
  PUBLIC_WORLD_STATUSES,
  PublicDynamicProjectionError,
  seedPlacementsFromCharacterRows,
  selectPublicDynamicProjection,
  toPublicCharacterMotion,
  toPublicDirection,
  toPublicMotionType,
  type PublicCharacterMotion,
  type PublicDynamicProjection,
} from './publicDynamicProjection';
import {
  publicCharacterMotionValidator,
  publicDynamicProjectionValidator,
} from './publicDynamicProjectionValidators';

const WORLD_ID = 'mistwood';

function project(
  fixture: VisualRuntimeInput,
  over: Partial<Parameters<typeof buildPublicDynamicProjection>[0]> = {},
): PublicDynamicProjection {
  return buildPublicDynamicProjection({
    worldId: WORLD_ID,
    nowMs: fixture.nowMs,
    runtime: { mapId: fixture.mapId, grid: fixture.grid, bindings: fixture.bindings },
    seedPlacements: MISTWOOD_SEED_PLACEMENTS,
    acceptedEvents: fixture.acceptedEvents,
    worldStatus: 'running',
    activeScenes: [],
    ...over,
  });
}

/** A fixture with extra accepted events appended, keeping the map context intact. */
function withEvents(fixture: VisualRuntimeInput, events: readonly AcceptedEventLike[]): VisualRuntimeInput {
  return { ...fixture, acceptedEvents: [...fixture.acceptedEvents, ...events] };
}

function lifeEvent(sequenceNumber: number, characterId: string, alive: boolean): AcceptedEventLike {
  return {
    eventId: `life#${sequenceNumber}`,
    sequenceNumber,
    worldDay: 1,
    timeSlot: 'morning',
    acceptedAt: FIXTURE_ACCEPTED_AT_MS + sequenceNumber,
    stateChanges: [{ type: 'character_life_changed', characterId, alive } as never],
  };
}

function activeEvent(sequenceNumber: number, characterId: string, active: boolean): AcceptedEventLike {
  return {
    eventId: `active#${sequenceNumber}`,
    sequenceNumber,
    worldDay: 1,
    timeSlot: 'morning',
    acceptedAt: FIXTURE_ACCEPTED_AT_MS + sequenceNumber,
    stateChanges: [
      { type: 'character_state_changed', characterId, field: 'active', toValue: active } as never,
    ],
  };
}

function moveEvent(args: {
  sequenceNumber: number;
  characterId: string;
  fromLocationId: string;
  toLocationId: string;
}): AcceptedEventLike {
  return {
    eventId: `move#${args.sequenceNumber}`,
    sequenceNumber: args.sequenceNumber,
    worldDay: 1,
    timeSlot: 'morning',
    acceptedAt: FIXTURE_ACCEPTED_AT_MS + args.sequenceNumber,
    stateChanges: [
      {
        type: 'character_location_changed',
        characterId: args.characterId,
        fromLocationId: args.fromLocationId,
        toLocationId: args.toLocationId,
      } as never,
    ],
  };
}

function motionFor(projection: PublicDynamicProjection, characterId: string): PublicCharacterMotion {
  const motion = projection.characters.find((entry) => entry.characterId === characterId);
  if (!motion) throw new Error(`no published motion for ${characterId}`);
  return motion;
}

/** Every key appearing anywhere in a value, at any depth. */
function allKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) allKeys(entry, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      into.add(key);
      allKeys(entry, into);
    }
  }
  return into;
}

describe('AC#1 — publishes the PRD 2.0 §10.4 PublicCharacterMotion shape', () => {
  it('publishes exactly the specified root fields', () => {
    const projection = project(createZeroEventFixture());
    expect(Object.keys(projection).sort()).toEqual([...PUBLIC_DYNAMIC_ROOT_FIELDS].sort());
    expect(projection.worldId).toBe(WORLD_ID);
    expect(projection.runtimeVersion).toBe(PUBLIC_DYNAMIC_RUNTIME_VERSION);
    expect(projection.worldStatus).toBe('running');
  });

  it('adds the Canon day and slot only once there is an accepted event to read them from', () => {
    // ART-120 (FR-O011). Omitted rather than defaulted for a world with no history: `0` and
    // `'morning'` would be claims about a world that has not had a morning yet.
    const empty = project(createZeroEventFixture());
    expect('worldDay' in empty).toBe(false);
    expect('timeSlot' in empty).toBe(false);

    const moved = project(createSingleMoveFixture());
    expect(Object.keys(moved).sort()).toEqual(
      [...PUBLIC_DYNAMIC_ROOT_FIELDS, ...PUBLIC_DYNAMIC_OPTIONAL_ROOT_FIELDS].sort(),
    );
    expect(moved.worldDay).toBe(1);
    expect(moved.timeSlot).toBe('morning');
  });

  it('still accepts a payload persisted before the day and slot existed', () => {
    // The reason both fields are optional: `selectPublicDynamicProjection` re-validates the
    // stored payload on every read, and a required field would blank the map for every viewer
    // until the next Canon commit rebuilt it.
    const { worldDay: _day, timeSlot: _slot, ...legacy } = project(createSingleMoveFixture());
    expect(() => assertPublicDynamicProjection(legacy)).not.toThrow();
    expect(selectPublicDynamicProjection({ dynamic: legacy })).toEqual(legacy);
  });

  it('publishes exactly the specified per-character fields', () => {
    const projection = project(createSingleMoveFixture());
    const idle = motionFor(projection, 'gao-wenrui');
    const canon = motionFor(projection, 'wu-zhen');
    expect(Object.keys(idle).sort()).toEqual([...PUBLIC_MOTION_REQUIRED_FIELDS].sort());
    expect(Object.keys(canon).sort()).toEqual(
      [...PUBLIC_MOTION_REQUIRED_FIELDS, ...PUBLIC_MOTION_OPTIONAL_FIELDS].sort(),
    );
  });

  it('omits sourceEventIds rather than publishing an empty array for a never-moved character', () => {
    const projection = project(createZeroEventFixture());
    for (const motion of projection.characters) {
      expect('sourceEventIds' in motion).toBe(false);
    }
  });

  it('publishes active scenes with title, summary and provenance only', () => {
    const projection = project(createZeroEventFixture(), {
      activeScenes: [{ title: 'A tense meeting', summary: 'The council stalls.', sourceEventIds: ['evt-1'] }],
    });
    expect(projection.activeScenes).toEqual([
      { title: 'A tense meeting', summary: 'The council stalls.', sourceEventIds: ['evt-1'] },
    ]);
  });
});

describe('AC#2 / AC#3 — no private or runtime-only data escapes', () => {
  const projection = project(createMultiHopFixture());
  const serialized = JSON.stringify(projection);

  it('names no forbidden field at any nesting depth', () => {
    const keys = allKeys(projection);
    for (const forbidden of PUBLIC_DYNAMIC_FORBIDDEN_FIELDS) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it('carries no private seed value, even under an innocent-looking key', () => {
    const privateValues = mistwoodCharacterSeed.characters.flatMap((character) => [
      character.privateProfile,
      character.privateGoal,
      character.fear,
    ]);
    expect(privateValues.length).toBeGreaterThan(0);
    for (const value of privateValues) {
      expect(serialized).not.toContain(value);
    }
  });

  it('is a fixed point of the public sanitiser — nothing is left for it to strip', () => {
    expect(sanitizeForPublic(projection as unknown as JsonValue)).toEqual(projection);
  });

  it('rejects a payload carrying Visual Runtime planning detail', () => {
    const runtimeOnlyFields = ['movementPhase', 'originLocationId', 'waypoints', 'mapId'];
    for (const field of runtimeOnlyFields) {
      const leaky = {
        ...projection,
        characters: [{ ...projection.characters[0], [field]: 'anything' }],
      };
      expect(() => assertPublicDynamicProjection(leaky)).toThrow(PublicDynamicProjectionError);
      expect(() => assertPublicDynamicProjection(leaky)).toThrow(/PUBLIC_DYNAMIC_UNKNOWN_FIELD/);
    }
  });

  it('rejects an unknown root field such as the runtime problem list', () => {
    expect(() => assertPublicDynamicProjection({ ...projection, problems: [] })).toThrow(
      /PUBLIC_DYNAMIC_UNKNOWN_FIELD/,
    );
  });

  it('publishes the map id once at the root, never per motion', () => {
    expect(projection.mapId).toBe('mistwood-v1');
    for (const motion of projection.characters) expect('mapId' in motion).toBe(false);
  });
});

describe('AC#4 — every field is covered by runtime schema validation', () => {
  const valid = project(createSingleMoveFixture());

  it('accepts the projection it just produced', () => {
    expect(() => assertPublicDynamicProjection(valid)).not.toThrow();
  });

  const rootCases: ReadonlyArray<readonly [string, unknown]> = [
    ['non-object', 42],
    ['missing worldId', { ...valid, worldId: undefined }],
    ['empty worldId', { ...valid, worldId: '' }],
    ['non-string mapId', { ...valid, mapId: 7 }],
    ['zero runtimeVersion', { ...valid, runtimeVersion: 0 }],
    ['fractional runtimeVersion', { ...valid, runtimeVersion: 1.5 }],
    ['negative snapshotSequence', { ...valid, snapshotSequence: -1 }],
    ['NaN updatedAt', { ...valid, updatedAt: Number.NaN }],
    ['Infinity updatedAt', { ...valid, updatedAt: Number.POSITIVE_INFINITY }],
    ['negative updatedAt', { ...valid, updatedAt: -1 }],
    ['out-of-enum worldStatus', { ...valid, worldStatus: 'sleeping' }],
    ['non-array characters', { ...valid, characters: {} }],
    ['non-array activeScenes', { ...valid, activeScenes: null }],
  ];

  it.each(rootCases)('rejects a projection with a %s', (_label, candidate) => {
    expect(() => assertPublicDynamicProjection(candidate)).toThrow(PublicDynamicProjectionError);
  });

  const motionCases: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['empty characterId', { characterId: '' }],
    ['empty semanticLocationId', { semanticLocationId: '' }],
    ['out-of-enum motionType', { motionType: 'teleport' }],
    ['out-of-enum animationState', { animationState: 'sprinting' }],
    ['out-of-enum direction', { direction: 'north-east' }],
    ['negative motionSequence', { motionSequence: -1 }],
    ['fractional motionSequence', { motionSequence: 1.5 }],
    ['non-finite motionSequence', { motionSequence: Number.NaN }],
    ['non-object from', { from: 'origin' }],
    ['non-finite point coordinate', { to: { x: Number.POSITIVE_INFINITY, y: 0 } }],
    ['point with an extra field', { to: { x: 0, y: 0, z: 0 } }],
    ['arriveAt before startedAt', { startedAt: 100, arriveAt: 99 }],
    ['non-array sourceEventIds', { sourceEventIds: 'evt-1' }],
    ['empty-string sourceEventId', { sourceEventIds: [''] }],
  ];

  it.each(motionCases)('rejects a motion with a %s', (_label, patch) => {
    const candidate = { ...valid, characters: [{ ...valid.characters[0], ...patch }] };
    expect(() => assertPublicDynamicProjection(candidate)).toThrow(PublicDynamicProjectionError);
  });

  it('rejects two motions for the same character', () => {
    const candidate = { ...valid, characters: [valid.characters[0], { ...valid.characters[0] }] };
    expect(() => assertPublicDynamicProjection(candidate)).toThrow(/exactly one motion/);
  });

  it('rejects a scene missing its provenance', () => {
    const candidate = { ...valid, activeScenes: [{ title: 't', summary: 's' }] };
    expect(() => assertPublicDynamicProjection(candidate)).toThrow(PublicDynamicProjectionError);
  });

  it('keeps the Convex validators aligned with the hand-written whitelist', () => {
    const motionFields = (publicCharacterMotionValidator as unknown as {
      fields: Record<string, { isOptional: string }>;
    }).fields;
    const required = Object.keys(motionFields).filter((key) => motionFields[key].isOptional === 'required');
    const optional = Object.keys(motionFields).filter((key) => motionFields[key].isOptional === 'optional');
    expect(required.sort()).toEqual([...PUBLIC_MOTION_REQUIRED_FIELDS].sort());
    expect(optional.sort()).toEqual([...PUBLIC_MOTION_OPTIONAL_FIELDS].sort());

    const rootFields = (publicDynamicProjectionValidator as unknown as {
      fields: Record<string, { isOptional: string }>;
    }).fields;
    expect(
      Object.keys(rootFields).filter((key) => rootFields[key].isOptional === 'required').sort(),
    ).toEqual([...PUBLIC_DYNAMIC_ROOT_FIELDS].sort());
    expect(
      Object.keys(rootFields).filter((key) => rootFields[key].isOptional === 'optional').sort(),
    ).toEqual([...PUBLIC_DYNAMIC_OPTIONAL_ROOT_FIELDS].sort());
  });

  it('keeps the Convex enum unions aligned with the hand-written enums', () => {
    const members = (validator: unknown): string[] =>
      ((validator as { members: { value: string }[] }).members).map((member) => member.value).sort();
    const motionFields = (publicCharacterMotionValidator as unknown as {
      fields: Record<string, unknown>;
    }).fields;
    expect(members(motionFields.motionType)).toEqual([...PUBLIC_MOTION_TYPES].sort());
    expect(members(motionFields.animationState)).toEqual([...PUBLIC_ANIMATION_STATES].sort());
    expect(members(motionFields.direction)).toEqual([...PUBLIC_DIRECTIONS].sort());
    const rootFields = (publicDynamicProjectionValidator as unknown as {
      fields: Record<string, unknown>;
    }).fields;
    expect(members(rootFields.worldStatus)).toEqual([...PUBLIC_WORLD_STATUSES].sort());
  });

  it('re-validates on the way out and rejects a payload that drifted in storage', () => {
    expect(selectPublicDynamicProjection({ dynamic: valid })).toEqual(valid);
    expect(selectPublicDynamicProjection({ dynamic: null })).toBeNull();
    expect(selectPublicDynamicProjection({})).toBeNull();
    expect(() =>
      selectPublicDynamicProjection({ dynamic: { ...valid, worldStatus: 'exploded' } }),
    ).toThrow(PublicDynamicProjectionError);
  });
});

describe('AC#5 / AC#8 — the read path cannot write, and carries no authorization branch', () => {
  const sources = ['publicDynamicProjection.ts', 'publicDynamicProjectionValidators.ts'].map((name) => ({
    name,
    source: readFileSync(join(process.cwd(), 'convex/publicRead', name), 'utf8'),
  }));

  it('names no write API anywhere in the projection modules', () => {
    // A Convex write has to travel through a database handle or a mutation constructor, so
    // those are the strings scanned for. Bare `.delete(` is not among them: it also matches
    // an ordinary `Set.delete`, which would make this guard fire on code that writes nothing.
    const writeApis = ['ctx.db', 'internalMutation', 'mutation(', 'db.insert(', 'db.patch(', 'db.replace(', 'db.delete('];
    for (const { name, source } of sources) {
      for (const api of writeApis) {
        expect(`${name}:${source.includes(api)}`).toBe(`${name}:false`);
      }
    }
  });

  it('imports no Convex function context, so there is nowhere for a write to go', () => {
    const pure = sources.find((entry) => entry.name === 'publicDynamicProjection.ts');
    expect(pure?.source).not.toContain('_generated');
    expect(pure?.source).not.toContain("from 'convex/");
  });

  it('declares the public projection read as a query taking only a worldId', () => {
    const wiring = readFileSync(join(process.cwd(), 'convex/publicRead/liveStateFunctions.ts'), 'utf8');
    expect(wiring).toContain('export const getPublicDynamicProjection = query({');
    const declaration = wiring.slice(wiring.indexOf('export const getPublicDynamicProjection'));
    const args = declaration.slice(declaration.indexOf('args:'), declaration.indexOf('handler:'));
    expect(args).toContain('worldId: v.string()');
    expect(args).not.toContain('identity');
    expect(args).not.toContain('viewer');
  });

  it('serving a projection mutates no stored row', () => {
    return (async () => {
      const store = new MemoryReadStore();
      await commitLive(store, project(createZeroEventFixture()));
      const before = JSON.stringify(store.rows);
      const served = await serveReadModel(store, WORLD_ID, LIVE_KIND, LIVE_REF);
      expect(selectPublicDynamicProjection(served?.payload)?.characters).toHaveLength(12);
      expect(JSON.stringify(store.rows)).toBe(before);
    })();
  });
});

describe('AC#6 — a failed update retains the last valid published version', () => {
  it('serves the previous projection after the current version is marked failed', async () => {
    const store = new MemoryReadStore();
    await commitLive(store, project(createZeroEventFixture()));
    await commitLive(store, project(createSingleMoveFixture()), 2_000);
    await invalidateReadModel(store, {
      worldId: WORLD_ID, modelKind: LIVE_KIND, modelRef: LIVE_REF, status: 'failed', now: 3_000,
    });

    const served = await serveReadModel(store, WORLD_ID, LIVE_KIND, LIVE_REF);
    expect(served?.servedFrom).toBe('last_known_good');
    const dynamic = selectPublicDynamicProjection(served?.payload);
    expect(dynamic?.characters).toHaveLength(12);
    // The retained fallback is the zero-event projection, so nobody is mid-walk.
    expect(dynamic?.characters.every((motion) => motion.motionType === 'idle')).toBe(true);
  });

  it('leaves the serving version untouched when the projection write itself throws', async () => {
    const store = new MemoryReadStore();
    await commitLive(store, project(createZeroEventFixture()));
    store.insertShouldThrow = true;
    await expect(commitLive(store, project(createSingleMoveFixture()), 2_000)).rejects.toThrow(
      'PROJECTION_WRITE_UNAVAILABLE',
    );

    const served = await serveReadModel(store, WORLD_ID, LIVE_KIND, LIVE_REF);
    expect(served?.servedFrom).toBe('current');
    expect(selectPublicDynamicProjection(served?.payload)?.characters).toHaveLength(12);
  });
});

describe('AC#7 — motionType distinguishes canon, ambient, idle and replay', () => {
  it('maps every runtime motion type, sending bootstrap to idle', () => {
    expect(toPublicMotionType('bootstrap')).toBe('idle');
    expect(toPublicMotionType('canon')).toBe('canon');
    expect(toPublicMotionType('ambient')).toBe('ambient');
    expect(toPublicMotionType('replay')).toBe('replay');
  });

  it('reports a freshly seeded world as entirely idle', () => {
    const projection = project(createZeroEventFixture());
    expect(new Set(projection.characters.map((motion) => motion.motionType))).toEqual(new Set(['idle']));
  });

  it('reports exactly the moved character as canon motion', () => {
    const projection = project(createSingleMoveFixture());
    const canon = projection.characters.filter((motion) => motion.motionType === 'canon');
    expect(canon.map((motion) => motion.characterId)).toEqual(['wu-zhen']);
  });

  it('reports a character who has finished a Canon walk as ambient-eligible', () => {
    // ART-120 (FR-O011). `ambient` says "standing inside a Canon zone, so in-zone drift is
    // permitted here"; it is not a position. The drift is derived on the client, which is why
    // this projection carries no per-minute coordinate for it.
    const fixture = createSingleMoveFixture();
    const settled = project({ ...fixture, nowMs: FIXTURE_ACCEPTED_AT_MS + 60 * 60 * 1000 });
    const moved = motionFor(settled, 'wu-zhen');
    expect(moved.motionType).toBe('ambient');
    expect(moved.animationState).toBe('idle');
    expect(moved.from).toEqual(moved.to);
    expect(moved.semanticLocationId).toBe('mistwood-square');
  });

  it('accepts replay in the contract without producing it', () => {
    const projection = project(createMultiHopFixture());
    const produced = new Set(projection.characters.map((motion) => motion.motionType));
    expect(produced.has('replay')).toBe(false);
    const widened = { ...projection, characters: [{ ...projection.characters[0], motionType: 'replay' }] };
    expect(() => assertPublicDynamicProjection(widened)).not.toThrow();
  });

  it('collapses the eight compass directions onto the four sprite facings', () => {
    expect(toPublicDirection('north')).toBe('up');
    expect(toPublicDirection('south')).toBe('down');
    expect(toPublicDirection('east')).toBe('right');
    expect(toPublicDirection('west')).toBe('left');
    expect(toPublicDirection('north-east')).toBe('right');
    expect(toPublicDirection('south-east')).toBe('right');
    expect(toPublicDirection('north-west')).toBe('left');
    expect(toPublicDirection('south-west')).toBe('left');
  });
});

describe('AC#9 / AC#11 — every seeded character appears before its first event', () => {
  const projection = project(createZeroEventFixture());

  it('publishes all twelve seeded residents with zero accepted events', () => {
    expect(projection.characters).toHaveLength(12);
    expect(projection.characters.map((motion) => motion.characterId).sort()).toEqual(
      MISTWOOD_SEED_PLACEMENTS.map((placement) => placement.characterId).sort(),
    );
    expect(projection.snapshotSequence).toBe(0);
    expect(projection.updatedAt).toBe(0);
  });

  it('places each of them at their seeded location, standing still', () => {
    for (const placement of MISTWOOD_SEED_PLACEMENTS) {
      const motion = motionFor(projection, placement.characterId);
      expect(motion.semanticLocationId).toBe(placement.initialLocationId);
      expect(motion.motionType).toBe('idle');
      expect(motion.animationState).toBe('idle');
      expect(motion.motionSequence).toBe(0);
      expect(motion.from).toEqual(motion.to);
      expect(motion.sourceEventIds).toBeUndefined();
    }
  });

  it('derives seed placements from the real seed rows, skipping unusable ones', () => {
    const rows = mistwoodCharacterSeed.characters.map((character) => ({
      characterId: character.id,
      payload: character as unknown,
    }));
    const placements = seedPlacementsFromCharacterRows(rows);
    expect(placements).toHaveLength(12);
    expect(placements).toEqual([...placements].sort((a, b) => a.characterId.localeCompare(b.characterId)));
    expect(placements).toEqual([...MISTWOOD_SEED_PLACEMENTS].sort((a, b) => a.characterId.localeCompare(b.characterId)));
  });

  it('skips a row whose seed payload has no usable initialLocationId', () => {
    const placements = seedPlacementsFromCharacterRows([
      { characterId: 'ok', payload: { initialLocationId: 'loc-1' } },
      { characterId: 'missing', payload: {} },
      { characterId: 'wrong-type', payload: { initialLocationId: 42 } },
      { characterId: 'empty', payload: { initialLocationId: '' } },
      { characterId: 'null-payload', payload: null },
      { characterId: '', payload: { initialLocationId: 'loc-2' } },
    ]);
    expect(placements).toEqual([{ characterId: 'ok', initialLocationId: 'loc-1' }]);
  });
});

describe('AC#10 — event-derived state overrides the seed bootstrap', () => {
  it('replaces the seeded position of the moved character and leaves the rest bootstrapped', () => {
    const projection = project(createSingleMoveFixture());
    const moved = motionFor(projection, 'wu-zhen');
    expect(moved.motionType).toBe('canon');
    expect(moved.semanticLocationId).toBe('mistwood-square');
    expect(moved.motionSequence).toBe(2);
    expect(moved.sourceEventIds).toEqual(['mistwood#event#1']);

    const untouched = projection.characters.filter((motion) => motion.characterId !== 'wu-zhen');
    expect(untouched).toHaveLength(11);
    expect(untouched.every((motion) => motion.motionType === 'idle' && motion.motionSequence === 0)).toBe(true);
  });

  it('gives an event-derived motion a strictly higher motionSequence than any bootstrap', () => {
    const projection = project(createSingleMoveFixture());
    const canon = projection.characters.filter((motion) => motion.motionType === 'canon');
    const idle = projection.characters.filter((motion) => motion.motionType === 'idle');
    const lowestCanon = Math.min(...canon.map((motion) => motion.motionSequence));
    const highestIdle = Math.max(...idle.map((motion) => motion.motionSequence));
    expect(lowestCanon).toBeGreaterThan(highestIdle);
  });

  it('lets the last hop of a multi-hop history win', () => {
    const projection = project(createMultiHopFixture());
    const moved = motionFor(projection, 'lin-yingxue');
    expect(moved.semanticLocationId).toBe('mistwood-inn');
    expect(moved.motionSequence).toBe(4);
    expect(moved.sourceEventIds).toEqual(['mistwood#event#3']);
    expect(projection.snapshotSequence).toBe(4);
  });
});

describe('life and activity exclusion', () => {
  it('withholds a character Canon recorded as dead', () => {
    const fixture = withEvents(createZeroEventFixture(), [lifeEvent(1, 'he-jun', false)]);
    const ids = project(fixture).characters.map((motion) => motion.characterId);
    expect(ids).not.toContain('he-jun');
    expect(ids).toHaveLength(11);
  });

  it('withholds a character explicitly deactivated', () => {
    const fixture = withEvents(createZeroEventFixture(), [activeEvent(1, 'qiu-an', false)]);
    expect(project(fixture).characters.map((motion) => motion.characterId)).not.toContain('qiu-an');
  });

  it('republishes a character a later event brought back', () => {
    const fixture = withEvents(createZeroEventFixture(), [
      lifeEvent(1, 'he-jun', false),
      lifeEvent(2, 'he-jun', true),
    ]);
    expect(project(fixture).characters.map((motion) => motion.characterId)).toContain('he-jun');
  });

  it('folds exclusions in sequence order regardless of input order', () => {
    const ordered = [lifeEvent(1, 'a', false), lifeEvent(2, 'a', true)];
    expect(excludedCharacterIds(ordered).has('a')).toBe(false);
    expect(excludedCharacterIds([...ordered].reverse()).has('a')).toBe(false);
    expect(excludedCharacterIds([lifeEvent(2, 'a', false), lifeEvent(1, 'a', true)]).has('a')).toBe(true);
  });

  it('keeps a dead character in the anchor chain, so the living do not move because of them', () => {
    const base = project(createSingleMoveFixture());
    const withDeath = project(withEvents(createSingleMoveFixture(), [lifeEvent(9, 'he-jun', false)]));
    for (const motion of withDeath.characters) {
      const original = motionFor(base, motion.characterId);
      expect(motion.from).toEqual(original.from);
      expect(motion.to).toEqual(original.to);
    }
  });
});

describe('determinism — the payload is derived from Canon, not from a clock', () => {
  it('produces byte-identical output for two different planning instants past every arrival', () => {
    const settled = FIXTURE_ACCEPTED_AT_MS + 10_000_000;
    const first = project(createSingleMoveFixture(settled));
    const second = project(createSingleMoveFixture(settled + 5_000_000));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.updatedAt).toBe(FIXTURE_ACCEPTED_AT_MS + 1);
    expect(first.updatedAt).not.toBe(settled);
  });

  it('derives updatedAt and snapshotSequence from the last accepted event', () => {
    expect(project(createZeroEventFixture())).toMatchObject({ snapshotSequence: 0, updatedAt: 0 });
    expect(project(createSingleMoveFixture())).toMatchObject({
      snapshotSequence: 2, updatedAt: FIXTURE_ACCEPTED_AT_MS + 1,
    });
    expect(project(createMultiHopFixture())).toMatchObject({
      snapshotSequence: 4, updatedAt: FIXTURE_ACCEPTED_AT_MS + 3,
    });
  });

  it('never regresses snapshotSequence as history grows', () => {
    const sequences = [createZeroEventFixture(), createSingleMoveFixture(), createMultiHopFixture()]
      .map((fixture) => project(fixture).snapshotSequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });

  it('deduplicates an unchanged rebuild instead of appending a version row', async () => {
    const store = new MemoryReadStore();
    const first = await commitLive(store, project(createZeroEventFixture()));
    const second = await commitLive(store, project(createZeroEventFixture()), 2_000);
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(store.rows).toHaveLength(1);
  });

  it('orders characters by id, so Convex row order cannot change the payload', () => {
    const ids = project(createZeroEventFixture()).characters.map((motion) => motion.characterId);
    expect(ids).toEqual([...ids].sort());
    const shuffled = buildPublicDynamicProjection({
      worldId: WORLD_ID,
      nowMs: createZeroEventFixture().nowMs,
      runtime: createZeroEventFixture(),
      seedPlacements: [...MISTWOOD_SEED_PLACEMENTS].reverse(),
      acceptedEvents: [],
      worldStatus: 'running',
      activeScenes: [],
    });
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(project(createZeroEventFixture())));
  });
});

describe('unpublishable positions are omitted, never guessed', () => {
  it('drops a character whose destination has no active visual binding', () => {
    const fixture = withEvents(createZeroEventFixture(), [
      moveEvent({
        sequenceNumber: 1,
        characterId: 'shen-kai',
        fromLocationId: 'mistwood-square',
        toLocationId: 'mistwood-nowhere',
      }),
    ]);
    const projection = project(fixture);
    expect(projection.characters.map((motion) => motion.characterId)).not.toContain('shen-kai');
    expect(projection.characters).toHaveLength(11);
  });

  it('rejects an input with an empty worldId or a non-finite instant', () => {
    expect(() => project(createZeroEventFixture(), { worldId: '  ' })).toThrow(PublicDynamicProjectionError);
    expect(() => project(createZeroEventFixture(), { nowMs: Number.NaN })).toThrow(PublicDynamicProjectionError);
  });

  it('narrows a trajectory without carrying its planning detail across', () => {
    const trajectory: MovementTrajectory = {
      characterId: 'c1',
      mapId: 'map-1',
      motionType: 'bootstrap',
      movementPhase: 'bootstrap',
      from: { x: 1, y: 2 },
      to: { x: 1, y: 2 },
      startedAt: 0,
      arriveAt: 0,
      direction: 'north-east',
      animationState: 'idle',
      motionSequence: 0,
      semanticLocationId: 'loc-1',
      originLocationId: 'loc-0',
      waypoints: [{ point: { x: 1, y: 2 }, arriveAt: 0 }],
      sourceEventIds: [],
    };
    expect(toPublicCharacterMotion(trajectory)).toEqual({
      characterId: 'c1',
      semanticLocationId: 'loc-1',
      motionType: 'idle',
      motionSequence: 0,
      from: { x: 1, y: 2 },
      to: { x: 1, y: 2 },
      startedAt: 0,
      arriveAt: 0,
      animationState: 'idle',
      direction: 'right',
    });
  });
});

// ---------------------------------------------------------------------------
// In-memory read-model store. Duplicated from readModel.test.ts rather than
// shared, following this repo's convention of keeping each suite's fakes local.
// ---------------------------------------------------------------------------

const LIVE_KIND: ReadModelKind = 'liveState';
const LIVE_REF = `live:${WORLD_ID}`;

type MarkCurrentPatch = Parameters<PublicReadStore['markCurrent']>[1];

class MemoryReadStore implements PublicReadStore {
  readonly rows: StoredReadModel[] = [];
  private counter = 0;
  insertShouldThrow = false;

  loadTargetVersions(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<readonly StoredReadModel[]> {
    return Promise.resolve(this.rows.filter((row) => row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef));
  }
  findCurrent(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<StoredReadModel | null> {
    return Promise.resolve(this.rows.find((row) => row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isCurrent) ?? null);
  }
  loadLastKnownGood(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<readonly StoredReadModel[]> {
    return Promise.resolve(this.rows.filter((row) => row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isLastKnownGood));
  }
  insertVersion(record: PublishedReadModel): Promise<string> {
    if (this.insertShouldThrow) throw new Error('PROJECTION_WRITE_UNAVAILABLE');
    this.counter += 1;
    const id = `id-${this.counter}`;
    this.rows.push({ ...record, id });
    return Promise.resolve(id);
  }
  markCurrent(rowId: string, patch: MarkCurrentPatch): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === rowId);
    if (!row) throw new Error('ROW_NOT_FOUND');
    row.isCurrent = patch.isCurrent;
    row.isLastKnownGood = patch.isLastKnownGood;
    row.status = patch.status;
    return Promise.resolve();
  }
}

/** Publish a dynamic projection the way `rebuildLiveProjection` does: nested under `dynamic`. */
function commitLive(store: MemoryReadStore, dynamic: PublicDynamicProjection, now = 1_000) {
  return commitReadModelVersion(store, {
    worldId: WORLD_ID,
    modelKind: LIVE_KIND,
    modelRef: LIVE_REF,
    payload: { dynamic } as unknown as JsonValue,
    sourceEventIds: [],
    status: SERVABLE_STATUS,
    now,
  });
}
