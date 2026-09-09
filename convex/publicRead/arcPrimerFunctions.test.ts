/**
 * The Convex WIRING of the three-minute arc primer (FR-H002, ART-176).
 *
 * This file did not exist. `arcPrimer.test.ts` covers the pure builder, and the rebuild that feeds
 * it was untested — which is how it came to be the last consumer of an accepted event's
 * `publicSummary` under `convex/publicRead/` with no safety gate at all, and the only one that
 * still read the whole accepted-event log on a per-commit path.
 *
 * Two claims carry it. That a Scene the safety gate refuses cannot narrate itself here — including
 * after the fact, through `refreshArcPrimers`, because this rebuild is otherwise called only for
 * the arcs a committed event MOVED and a resolved arc is never moved again. And that the reads are
 * point lookups on the ids the primer names, so the cost does not grow with the world.
 */

import type { StateChange } from '../canon/model';
import { rebuildArcPrimer, refreshArcPrimers } from './arcPrimerFunctions';

const WORLD_ID = 'mistwood';
const ARC_ID = 'arc-mill';
const CLEAN_SCENE = 'mistwood:3:morning:grouping:scene:1';
const REFUSED_SCENE = 'mistwood:3:evening:grouping:scene:2';
const TURNING_POINT_SUMMARY = '磨坊前的休戰,鎮民都看見了。';
const NOW = 5_000;

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };

const handler = rebuildArcPrimer as unknown as Registered;
const refreshHandler = refreshArcPrimers as unknown as Registered;

const eventId = (sequenceNumber: number) => `${WORLD_ID}#event#${sequenceNumber}`;

/**
 * The `db` double, plus a record of which `canonEvents` sequence numbers were looked up.
 *
 * The count is asserted rather than assumed: the read this rebuild replaced was a table-wide
 * `.collect()`, and a fake that answered a collect the same way a point lookup does would make
 * the bound untestable.
 */
function memoryCtx(tables: Tables) {
  const sequenceNumbersLookedUp: number[] = [];
  let canonEventsCollected = false;
  const db = {
    query(table: string) {
      return {
        withIndex(_index: string, build?: (q: unknown) => unknown) {
          const constraints: Row = {};
          const builder = {
            eq(field: string, value: unknown) { constraints[field] = value; return builder; },
            gt() { return builder; },
          };
          if (build) build(builder);
          if (table === 'canonEvents' && typeof constraints.sequenceNumber === 'number') {
            sequenceNumbersLookedUp.push(constraints.sequenceNumber);
          }
          const matched = (tables[table] ?? []).filter((row) =>
            Object.entries(constraints).every(([field, value]) => row[field] === value));
          const chain = (rows: Row[]) => ({
            order: (direction: 'asc' | 'desc') => chain(direction === 'desc' ? [...rows].reverse() : rows),
            take: (n: number) => Promise.resolve(rows.slice(0, n)),
            collect: () => {
              if (table === 'canonEvents' && constraints.sequenceNumber === undefined) canonEventsCollected = true;
              return Promise.resolve(rows);
            },
            first: () => Promise.resolve(rows[0] ?? null),
            unique: () => Promise.resolve(rows[0] ?? null),
          });
          return chain(matched);
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
  return {
    ctx: { db } as Parameters<typeof handler._handler>[0],
    sequenceNumbersLookedUp,
    canonEventsCollected: () => canonEventsCollected,
  };
}

function canonRow(sequenceNumber: number, sceneId: string | undefined, stateChanges: StateChange[] = []): Row {
  return {
    worldId: WORLD_ID,
    sequenceNumber,
    acceptedAt: 1_000 + sequenceNumber,
    validationVersion: '1',
    traceId: `trace-${sequenceNumber}`,
    payload: {
      schemaVersion: 1, worldId: WORLD_ID, idempotencyKey: `event-${sequenceNumber}`,
      proposedBy: { type: 'system' }, worldDay: 3, timeSlot: 'morning',
      eventType: 'conversation', participantIds: ['zhao-ming'], causedByEventIds: [],
      publicSummary: TURNING_POINT_SUMMARY, stateChanges,
      ...(sceneId === undefined ? {} : { metadata: { sceneId } }),
    },
  };
}

const nameFact = (characterId: string, name: string): StateChange => ({
  type: 'fact_created', subjectType: 'character', subjectId: characterId,
  predicate: 'name', value: name, visibility: 'public',
} as StateChange);

function baseTables(over: Partial<Tables> = {}): Tables {
  return {
    storyArcLifecycles: [{ worldId: WORLD_ID, arcId: ARC_ID, status: 'escalating' }],
    storyArcProjectionEvents: [{
      worldId: WORLD_ID, arcId: ARC_ID, revision: 0,
      fields: {
        title: '磨坊之爭', premise: '水車停轉引發爭執。', currentQuestion: '水車修得好嗎?',
        coreCharacterIds: ['zhao-ming'], incitingEventId: eventId(1),
        latestTurningPointEventId: eventId(2), essentialFactIds: [], recommendedEntryEventId: null,
        unresolvedQuestions: ['誰付修理費?'], resolvedQuestions: [], heatScore: 42,
      },
    }],
    storyArcRecommendedEntries: [],
    canonEvents: [
      canonRow(1, CLEAN_SCENE, [nameFact('zhao-ming', '趙明')]),
      canonRow(2, CLEAN_SCENE),
    ],
    postGenerationSafetyClassifications: [],
    safetyStatusOverrides: [],
    publishedReadModels: [],
    ...over,
  };
}

async function publishedPrimer(tables: Tables) {
  const { ctx, sequenceNumbersLookedUp, canonEventsCollected } = memoryCtx(tables);
  await handler._handler(ctx, { worldId: WORLD_ID, arcId: ARC_ID, now: NOW });
  const row = (tables.publishedReadModels ?? []).filter((entry) => entry.isCurrent).at(-1);
  expect(row).toBeDefined();
  return {
    payload: (row!.payload as {
      structured: { turningPoint: { summary: string } | null; characters: Array<{ name: string }> };
    }).structured,
    whole: row!.payload,
    sequenceNumbersLookedUp,
    canonEventsCollected: canonEventsCollected(),
  };
}

describe('rebuildArcPrimer — a withheld Scene never narrates itself here', () => {
  it('publishes the turning-point summary while no Scene is refused', async () => {
    const { payload } = await publishedPrimer(baseTables());
    expect(payload.turningPoint?.summary).toBe(TURNING_POINT_SUMMARY);
  });

  it('publishes no turning point when the Scene that produced it is refused', async () => {
    const { payload, whole } = await publishedPrimer(baseTables({
      canonEvents: [canonRow(1, CLEAN_SCENE, [nameFact('zhao-ming', '趙明')]), canonRow(2, REFUSED_SCENE)],
      postGenerationSafetyClassifications: [{
        worldId: WORLD_ID, classificationId: 'c1', sourceId: REFUSED_SCENE,
        label: 'withhold', createdAt: 2_000,
      }],
    }));
    expect(payload.turningPoint).toBeNull();
    // The sentence is nowhere in the WHOLE payload — `primerText` retells the turning point in
    // prose, so checking only the structured half would miss the copy a viewer actually reads.
    expect(JSON.stringify(whole)).not.toContain(TURNING_POINT_SUMMARY);
  });

  it('brings it back when an operator releases the Scene', async () => {
    const { payload } = await publishedPrimer(baseTables({
      canonEvents: [canonRow(1, CLEAN_SCENE, [nameFact('zhao-ming', '趙明')]), canonRow(2, REFUSED_SCENE)],
      postGenerationSafetyClassifications: [{
        worldId: WORLD_ID, classificationId: 'c1', sourceId: REFUSED_SCENE,
        label: 'withhold', createdAt: 2_000,
      }],
      safetyStatusOverrides: [{
        worldId: WORLD_ID, sourceId: REFUSED_SCENE, label: 'allow', createdAt: 3_000,
      }],
    }));
    expect(payload.turningPoint?.summary).toBe(TURNING_POINT_SUMMARY);
  });

  it('drops a character name a refused Scene wrote, falling back to the id', async () => {
    // The same rule `characterSourceFrom` applies: the biography a withheld Scene wrote is
    // withheld too. An unnamed character renders as their id, which is what the builder has
    // always done for one it could not name.
    const { payload } = await publishedPrimer(baseTables({
      canonEvents: [canonRow(1, REFUSED_SCENE, [nameFact('zhao-ming', '趙明')]), canonRow(2, CLEAN_SCENE)],
      postGenerationSafetyClassifications: [{
        worldId: WORLD_ID, classificationId: 'c1', sourceId: REFUSED_SCENE,
        label: 'withhold', createdAt: 2_000,
      }],
    }));
    expect(payload.characters.map((character) => character.name)).toEqual(['zhao-ming']);
  });

  it('does NOT withhold an event with no Scene provenance', async () => {
    const { payload } = await publishedPrimer(baseTables({
      canonEvents: [canonRow(1, undefined, [nameFact('zhao-ming', '趙明')]), canonRow(2, undefined)],
      postGenerationSafetyClassifications: [{
        worldId: WORLD_ID, classificationId: 'c1', sourceId: REFUSED_SCENE,
        label: 'withhold', createdAt: 2_000,
      }],
    }));
    expect(payload.turningPoint?.summary).toBe(TURNING_POINT_SUMMARY);
  });
});

describe('rebuildArcPrimer — the canon read is bounded by the ids the primer names', () => {
  it('looks up exactly the inciting and turning-point events, and never collects the log', async () => {
    const tables = baseTables({
      canonEvents: [
        ...Array.from({ length: 40 }, (_unused, index) => canonRow(100 + index, CLEAN_SCENE)),
        canonRow(1, CLEAN_SCENE, [nameFact('zhao-ming', '趙明')]),
        canonRow(2, CLEAN_SCENE),
      ],
    });
    const { sequenceNumbersLookedUp, canonEventsCollected } = await publishedPrimer(tables);
    expect([...sequenceNumbersLookedUp].sort((left, right) => left - right)).toEqual([1, 2]);
    // The read this replaced was a table-wide collect on a per-commit path (CLAUDE.md §9).
    expect(canonEventsCollected).toBe(false);
  });

  it('refuses a turning-point id that does not round-trip to its own sequence number', async () => {
    // A malformed reference must not resolve to whatever event happens to sit at the number it
    // parsed to. The lookup is by number; the identity check is on the derived id.
    const tables = baseTables();
    (tables.storyArcProjectionEvents[0].fields as { latestTurningPointEventId: string })
      .latestTurningPointEventId = `${WORLD_ID}#event#2#tampered`;
    const { payload } = await publishedPrimer(tables);
    expect(payload.turningPoint).toBeNull();
  });
});

describe('refreshArcPrimers — the safety path this rebuild had no entry point for', () => {
  it('re-derives every primer the world has published, and only primers', async () => {
    const tables = baseTables();
    await handler._handler(memoryCtx(tables).ctx, { worldId: WORLD_ID, arcId: ARC_ID, now: NOW });
    // An `arc:<id>` row shares the model KIND and must not be mistaken for a primer.
    tables.publishedReadModels.push({
      worldId: WORLD_ID, modelKind: 'arc', modelRef: `arc:${ARC_ID}`, status: 'published',
      isCurrent: true, payload: {}, version: 1,
    });
    tables.postGenerationSafetyClassifications = [{
      worldId: WORLD_ID, classificationId: 'c1', sourceId: CLEAN_SCENE,
      label: 'withhold', createdAt: 9_000,
    }];

    const result = await refreshHandler._handler(memoryCtx(tables).ctx, {
      worldId: WORLD_ID, now: NOW + 1,
    }) as { modelRefs: string[] };
    expect(result.modelRefs).toEqual([`primer:${ARC_ID}`]);

    // ...and the withhold actually took effect on the re-derived row. Without this entry point a
    // resolved arc's primer would keep the refused sentence forever: the ordinary rebuild runs
    // only for the arcs a committed event moved.
    const latest = tables.publishedReadModels.filter((row) => row.modelRef === `primer:${ARC_ID}` && row.isCurrent).at(-1);
    expect(JSON.stringify(latest?.payload)).not.toContain(TURNING_POINT_SUMMARY);
  });

  it('does nothing for a world that has published no primer', async () => {
    const result = await refreshHandler._handler(memoryCtx(baseTables()).ctx, {
      worldId: WORLD_ID, now: NOW,
    }) as { modelRefs: string[] };
    expect(result.modelRefs).toEqual([]);
  });
});
