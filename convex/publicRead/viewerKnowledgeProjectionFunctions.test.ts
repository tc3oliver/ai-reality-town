/**
 * The Convex WIRING of the FR-I005 viewer-knowledge model (ART-169), run against the registered
 * handlers over an in-memory `db` — the pattern `worldCharacterProjectionFunctions.test.ts` and
 * `relationshipGraphProjectionFunctions.test.ts` use for the same purpose.
 *
 * The pure builder's suite proves the RULES. What only this file can prove is that the wiring
 * hands it the right things: that the publication status it reads is the current record's real
 * status rather than a pre-filtered one, that a withheld Scene's provenance is actually resolved,
 * that the reads stay bounded as a world ages, and that a published row appears in the store
 * where the public query will find it.
 */

import type { StateChange } from '../canon/model';

import { viewerKnowledgeModelRef } from '../shared/viewerKnowledgeRef';
import { VIEWER_KNOWLEDGE_MODEL_KIND } from './viewerKnowledgeProjection';
import {
  VIEWER_KNOWLEDGE_EPISODE_WINDOW,
  rebuildViewerKnowledgeProjections,
  refreshViewerKnowledgeProjections,
} from './viewerKnowledgeProjectionFunctions';

const WORLD_ID = 'mistwood';
const CHARACTER_ID = 'zhao-ming';
const SECRET_ID = 'secret-zhaoming-payments';
const SECRET_CONTENT = 'Zhao Ming found payments to a dormant station account.';
const SCENE_ID = 'mistwood:5:evening:grouping:scene:1';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type RegisteredMutation = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };

const rebuildHandler = rebuildViewerKnowledgeProjections as unknown as RegisteredMutation;
const refreshHandler = refreshViewerKnowledgeProjections as unknown as RegisteredMutation;

/**
 * The `db` double. Modelled on `worldCharacterProjectionFunctions.test.ts`'s `memoryCtx`,
 * including the descending order and the `take` bound — both are load-bearing here, because the
 * whole point of the Episode window is that it stops reading.
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
            eq(field: string, value: unknown) { constraints[field] = value; return builder; },
            gt(field: string, value: number) { lowerExclusive[field] = value; return builder; },
          };
          if (build) build(builder);
          const matched = (tables[table] ?? []).filter((row) =>
            Object.entries(constraints).every(([field, value]) => row[field] === value)
            && Object.entries(lowerExclusive).every(([field, value]) => Number(row[field]) > value));
          const ascending = [...matched].sort((left, right) =>
            Number(left.sequenceNumber ?? left.worldDay ?? left.lastSequenceNumber ?? left.createdAt ?? 0)
            - Number(right.sequenceNumber ?? right.worldDay ?? right.lastSequenceNumber ?? right.createdAt ?? 0));
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
  return { db } as Parameters<typeof rebuildHandler._handler>[0];
}

function canonRow(input: {
  sequenceNumber: number;
  worldDay: number;
  stateChanges: StateChange[];
  sceneId?: string;
}): Row {
  return {
    worldId: WORLD_ID,
    sequenceNumber: input.sequenceNumber,
    worldDay: input.worldDay,
    acceptedAt: 1_000 + input.sequenceNumber,
    validationVersion: 'canon-v1',
    traceId: `trace-${input.sequenceNumber}`,
    payload: {
      schemaVersion: 1,
      worldId: WORLD_ID,
      idempotencyKey: `event-${input.sequenceNumber}`,
      proposedBy: { type: 'system' },
      worldDay: input.worldDay,
      timeSlot: 'evening',
      eventType: 'conversation',
      participantIds: [CHARACTER_ID],
      causedByEventIds: [],
      publicSummary: null,
      stateChanges: input.stateChanges,
      ...(input.sceneId === undefined ? {} : { metadata: { sceneId: input.sceneId } }),
    },
  };
}

/** The event id `deriveEventId` mints, which is what the ledger and the Episode both cite. */
const eventIdOf = (sequenceNumber: number) => `${WORLD_ID}#event#${sequenceNumber}`;

function publicFact(value: string, visibility = 'public'): StateChange {
  return {
    type: 'fact_created',
    subjectType: 'character',
    subjectId: CHARACTER_ID,
    predicate: 'ledgerFinding',
    value,
    visibility,
  } as StateChange;
}

function baseTables(over: Partial<Tables> = {}): Tables {
  return {
    canonEvents: [canonRow({ sequenceNumber: 0, worldDay: 5, stateChanges: [publicFact(SECRET_CONTENT)], sceneId: SCENE_ID })],
    canonSnapshots: [],
    worldSecrets: [{
      worldId: WORLD_ID,
      secretId: SECRET_ID,
      payload: { id: SECRET_ID, content: SECRET_CONTENT, initialKnowerCharacterIds: [CHARACTER_ID] },
    }],
    dailyEpisodes: [{
      worldId: WORLD_ID, worldDay: 5, episodeNumber: 5, status: 'ready',
      sourceEventIds: [eventIdOf(0)], createdAt: 1_000,
    }],
    publicationRecords: [{
      worldId: WORLD_ID, contentRef: `episode:${WORLD_ID}:5`, contentKind: 'episode',
      publicationId: 'pub:1', status: 'published', version: 1, isCurrent: true,
      audit: [], createdAt: 1_000, updatedAt: 1_000,
    }],
    publishedReadModels: [],
    postGenerationSafetyClassifications: [],
    safetyStatusOverrides: [],
    worldSchedules: [{ worldId: WORLD_ID, mode: 'live', status: 'running' }],
    ...over,
  };
}

async function rebuild(tables: Tables, characterIds = [CHARACTER_ID], reads?: Record<string, number>) {
  return rebuildHandler._handler(memoryCtx(tables, reads), {
    worldId: WORLD_ID, characterIds, now: 5_000,
  }) as Promise<{ modelRefs: string[]; rebuiltCharacterCount: number }>;
}

/** The payload a rebuild published, read back out of the store. */
function publishedPayload(tables: Tables, characterId = CHARACTER_ID): Record<string, unknown> | null {
  const modelRef = viewerKnowledgeModelRef(characterId);
  const row = (tables.publishedReadModels ?? [])
    .filter((entry) => entry.isCurrent && entry.modelRef === modelRef)
    .at(-1);
  return (row?.payload as Record<string, unknown> | undefined) ?? null;
}

describe('rebuildViewerKnowledgeProjections', () => {
  it('publishes a servable row under the shared modelRef and kind', async () => {
    const tables = baseTables();
    const { modelRefs } = await rebuild(tables);
    expect(modelRefs).toEqual([viewerKnowledgeModelRef(CHARACTER_ID)]);
    const row = (tables.publishedReadModels ?? [])[0];
    expect(row).toMatchObject({
      worldId: WORLD_ID,
      modelKind: VIEWER_KNOWLEDGE_MODEL_KIND,
      modelRef: `viewerKnowledge:${CHARACTER_ID}`,
      status: 'published',
      isCurrent: true,
    });
  });

  it('joins the world secret to the published event that revealed it', async () => {
    const tables = baseTables();
    await rebuild(tables);
    expect(publishedPayload(tables)).toMatchObject({
      characterId: CHARACTER_ID,
      viewerKnownSecrets: [{
        secretId: SECRET_ID,
        content: SECRET_CONTENT,
        revealingEventId: eventIdOf(0),
        revealedOnWorldDay: 5,
        publicationRef: `episode:${WORLD_ID}:5`,
      }],
    });
  });

  it('reads the CURRENT publication record rather than assuming one is published', async () => {
    // The wiring could have read only `by_world_and_status('published')`, which is one lookup
    // cheaper and would have made the pure layer's status rule unreachable from this side. Here
    // the only change is the record's own status.
    const tables = baseTables();
    (tables.publicationRecords[0]).status = 'ready';
    await rebuild(tables);
    const payload = publishedPayload(tables);
    expect(payload).toMatchObject({ viewerKnownSecrets: [] });
    expect(JSON.stringify(payload)).not.toContain(SECRET_CONTENT);
  });

  it('treats a superseded record as unpublished, even with a stale published one behind it', async () => {
    const tables = baseTables();
    tables.publicationRecords[0].isCurrent = false;
    tables.publicationRecords.push({
      worldId: WORLD_ID, contentRef: `episode:${WORLD_ID}:5`, contentKind: 'episode',
      publicationId: 'pub:2', status: 'superseded', version: 2, isCurrent: true,
      audit: [], createdAt: 2_000, updatedAt: 2_000,
    });
    await rebuild(tables);
    expect(JSON.stringify(publishedPayload(tables))).not.toContain(SECRET_CONTENT);
  });

  it('resolves Scene provenance and drops a withheld revealing event', async () => {
    const tables = baseTables({
      postGenerationSafetyClassifications: [{
        worldId: WORLD_ID, classificationId: 'c1', sourceId: SCENE_ID,
        label: 'withhold', createdAt: 2_000,
      }],
    });
    await rebuild(tables);
    const payload = publishedPayload(tables);
    expect(payload).toMatchObject({ viewerKnownSecrets: [], dramaticIronyFacts: [] });
    expect(JSON.stringify(payload)).not.toContain(SECRET_CONTENT);
  });

  it('brings the secret back when an operator releases the Scene', async () => {
    const tables = baseTables({
      postGenerationSafetyClassifications: [{
        worldId: WORLD_ID, classificationId: 'c1', sourceId: SCENE_ID,
        label: 'withhold', createdAt: 2_000,
      }],
      safetyStatusOverrides: [{
        worldId: WORLD_ID, sourceId: SCENE_ID, label: 'allow', createdAt: 3_000,
      }],
    });
    await rebuild(tables);
    expect(publishedPayload(tables)).toMatchObject({ viewerKnownSecrets: [{ secretId: SECRET_ID }] });
  });

  it('does not sweep events for Scene provenance when nothing in the world is withheld', async () => {
    // Scene provenance can only ever REMOVE rows, so the empty withheld set is the one case where
    // skipping the sweep changes no answer — and skipping it is what keeps a rebuild from reading
    // a day of events per considered day on every accepted event.
    //
    // Asserted as a DIFFERENCE rather than as zero: the Canon projection this build already needs
    // reads `canonEvents` itself, so an absolute figure would be pinning that instead.
    const clean: Record<string, number> = {};
    await rebuild(baseTables(), [CHARACTER_ID], clean);

    const withheld: Record<string, number> = {};
    await rebuild(baseTables({
      postGenerationSafetyClassifications: [{
        worldId: WORLD_ID, classificationId: 'c1', sourceId: SCENE_ID,
        label: 'withhold', createdAt: 2_000,
      }],
    }), [CHARACTER_ID], withheld);

    expect(withheld.canonEvents).toBeGreaterThan(clean.canonEvents);
  });

  it('stops reading Episodes at the window, however old the world is', async () => {
    const episodes = Array.from({ length: VIEWER_KNOWLEDGE_EPISODE_WINDOW + 20 }, (_, index) => ({
      worldId: WORLD_ID, worldDay: index, episodeNumber: index, status: 'ready',
      sourceEventIds: [eventIdOf(index)], createdAt: 1_000 + index,
    }));
    const reads: Record<string, number> = {};
    await rebuild(baseTables({ dailyEpisodes: episodes }), [CHARACTER_ID], reads);
    expect(reads.dailyEpisodes).toBe(VIEWER_KNOWLEDGE_EPISODE_WINDOW);
    // One point read of the current publication record per considered day, and no more.
    expect(reads.publicationRecords ?? 0).toBeLessThanOrEqual(VIEWER_KNOWLEDGE_EPISODE_WINDOW);
  });

  it('reads the world once for many characters', async () => {
    const reads: Record<string, number> = {};
    await rebuild(baseTables(), [CHARACTER_ID, 'qiu-an', 'he-jun'], reads);
    // The Episode window is read once, not once per character — the reason the port method takes
    // a list rather than a single id.
    expect(reads.dailyEpisodes).toBe(1);
    expect(reads.worldSecrets).toBe(1);
  });

  it('publishes an empty row for a character with nothing to say', async () => {
    const tables = baseTables();
    await rebuild(tables, ['he-jun']);
    expect(publishedPayload(tables, 'he-jun')).toMatchObject({
      characterId: 'he-jun',
      viewerKnownSecrets: [],
    });
  });

  it('refuses an unusable world id rather than publishing an unaddressable row', async () => {
    await expect(rebuild(baseTables(), []).then(() => rebuildHandler._handler(
      memoryCtx(baseTables()), { worldId: '  ', characterIds: [CHARACTER_ID], now: 1 },
    ))).rejects.toThrow(/VIEWER_KNOWLEDGE_INVALID/);
  });
});

describe('refreshViewerKnowledgeProjections', () => {
  it('re-derives every character that already has a published model, and only those', async () => {
    const tables = baseTables();
    await rebuild(tables, [CHARACTER_ID, 'qiu-an']);
    // A withhold lands after publication; the refresh is what carries it to this surface.
    tables.postGenerationSafetyClassifications.push({
      worldId: WORLD_ID, classificationId: 'c1', sourceId: SCENE_ID, label: 'withhold', createdAt: 9_000,
    });
    const result = await refreshHandler._handler(memoryCtx(tables), {
      worldId: WORLD_ID, now: 9_000,
    }) as { modelRefs: string[] };
    expect([...result.modelRefs].sort()).toEqual([
      viewerKnowledgeModelRef('qiu-an'),
      viewerKnowledgeModelRef(CHARACTER_ID),
    ].sort());
    expect(JSON.stringify(publishedPayload(tables))).not.toContain(SECRET_CONTENT);
  });

  it('does nothing for a world that has published none', async () => {
    const result = await refreshHandler._handler(memoryCtx(baseTables()), {
      worldId: WORLD_ID, now: 9_000,
    }) as { modelRefs: string[] };
    expect(result.modelRefs).toEqual([]);
  });
});

/**
 * Where the two triggers are actually proven, so a reader does not look for them here.
 *
 * An earlier version of this file asserted both by scanning source text for the function name.
 * Both assertions were useless and one was demonstrably so: removing the pipeline's call left the
 * name behind in the port interface declaration in the same file, so the scan passed against a
 * pipeline that had stopped calling it.
 *
 *  - The post-commit trigger: `convex/operations/postCommitLive.test.ts` asserts that stage 19's
 *    published `modelRefs` contain a `viewerKnowledge:` ref for every character the event touched,
 *    AFTER `live:<world>`. Deleting the stage call turns that test red.
 *  - The safety trigger: `convex/operations/safetyOverrideFunctions.test.ts` runs the override
 *    handler against an in-memory ctx and pins the EXHAUSTIVE list of rebuilds it dispatches.
 *    Removing this model from `refreshPublicTextModels` turns that test red.
 */
