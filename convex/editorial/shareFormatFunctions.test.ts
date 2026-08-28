/**
 * The Convex wiring for episode-derived share formats (FR-G005 / ART-36).
 *
 * Handler-level, following the pattern `safetyOverrideFunctions.test.ts` established: the
 * registered mutation's `_handler` is invoked directly with a fake `ctx`, so the dedup check, the
 * index-scoped reads, the safety gate and the publication call are exercised as they actually
 * run rather than as they are declared.
 *
 * Two claims carry this file.
 *
 * First, that the accepted-event set the provenance check uses is read from the accepted-event
 * log and NOT from the Episode blob. The fixture makes those two DISAGREE — the stored Episode
 * cites an event the log does not contain — and the handler is expected to refuse. A wiring that
 * passed the Episode's own ids to the validator would return `manual_release_required` here and
 * nothing else in the suite would notice.
 *
 * Second, that the automated pipeline cannot publish. The publication record it creates is
 * `generated`, and the actor it creates it as is refused `publish` by the FR-K004 lifecycle —
 * asserted against the real `transitionPublication`, not against a copy of its rules.
 */

import { getFunctionName } from 'convex/server';

import { transitionPublication, createPublicationRecord, PUBLICATION_CONTENT_KINDS } from './publicationLifecycle';
import { shareFormatsContentRef, shareFormatsSafetySourceId } from './derived/shareFormats';
import { generateEpisodeShareFormats, getEpisodeShareFormats } from './shareFormatFunctions';

const WORLD_ID = 'mistwood';
const WORLD_DAY = 4;
const EPISODE_NUMBER = 4;
const NOW = 1_700_000_000_000;

type Row = Record<string, unknown>;
type Tables = {
  episodeShareFormats: Row[];
  dailyEpisodes: Row[];
  canonEvents: Row[];
  safetyStatusOverrides: Row[];
  postGenerationSafetyClassifications: Row[];
};

type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<never> };
const generate = generateEpisodeShareFormats as unknown as Registered;
const read = getEpisodeShareFormats as unknown as Registered;

/** A stored Episode blob, as `generateAcceptedEventEpisode` writes it. */
function episodeBlob(over: Row = {}): Row {
  return {
    schemaVersion: 1, worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: EPISODE_NUMBER,
    title: `World Day ${WORLD_DAY}`, headline: 'Public e1',
    oneLineSummary: 'Public e1 Public e2',
    keyScenes: [
      { title: 'Key scene 1', summary: 'Public e1', sourceEventIds: [`${WORLD_ID}#event#1`], publicFactIds: [] },
      { title: 'Key scene 2', summary: 'Public e2', sourceEventIds: [`${WORLD_ID}#event#2`], publicFactIds: [] },
      { title: 'Key scene 3', summary: 'Public e3', sourceEventIds: [`${WORLD_ID}#event#3`], publicFactIds: [] },
    ],
    relationshipChanges: [], newQuestions: ['Question e1?'], resolvedQuestions: [],
    arcIds: ['arc-1'], characterIds: ['character-e1'],
    nextEpisodeTease: 'What consequences will tomorrow bring?',
    sourceEventIds: [1, 2, 3].map((n) => `${WORLD_ID}#event#${n}`),
    ...over,
  };
}

function episodeRow(over: Row = {}): Row {
  return {
    schemaVersion: 1, worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: EPISODE_NUMBER,
    status: 'ready', episode: episodeBlob(),
    safetyClassificationId: `episode:${WORLD_ID}:${WORLD_DAY}`,
    sourceEventIds: [1, 2, 3].map((n) => `${WORLD_ID}#event#${n}`),
    createdAt: 1_000, ...over,
  };
}

/** Accepted-event rows, from which the handler derives ids via `deriveEventId`. */
const acceptedRows = (sequenceNumbers: readonly number[]): Row[] => sequenceNumbers.map((sequenceNumber) => ({
  worldId: WORLD_ID, worldDay: WORLD_DAY, sequenceNumber, createdAt: sequenceNumber,
}));

function emptyTables(over: Partial<Tables> = {}): Tables {
  return {
    episodeShareFormats: [],
    dailyEpisodes: [episodeRow()],
    canonEvents: acceptedRows([1, 2, 3]),
    safetyStatusOverrides: [],
    postGenerationSafetyClassifications: [],
    ...over,
  };
}

/** Index ORDER is modelled: the override ledger is read `by_world_source_and_created`. */
function fakeDb(tables: Tables) {
  return {
    query(table: keyof Tables) {
      let rows = [...tables[table]].sort((left, right) =>
        Number(left.createdAt ?? 0) - Number(right.createdAt ?? 0));
      const chain = {
        withIndex(_name: string, build: (q: unknown) => unknown) {
          const constraints: Array<[string, unknown]> = [];
          const q = { eq(field: string, value: unknown) { constraints.push([field, value]); return q; } };
          build(q);
          rows = rows.filter((row) => constraints.every(([field, value]) => row[field] === value));
          return chain;
        },
        order(direction: 'asc' | 'desc') {
          if (direction === 'desc') rows = [...rows].reverse();
          return chain;
        },
        take(count: number) { return Promise.resolve(rows.slice(0, count)); },
        collect() { return Promise.resolve(rows); },
        unique() { return Promise.resolve(rows[0] ?? null); },
        first() { return Promise.resolve(rows[0] ?? null); },
      };
      return chain;
    },
    insert(table: keyof Tables, row: Row) {
      tables[table].push(row);
      return Promise.resolve(`${table}-${tables[table].length}`);
    },
    patch() { throw new Error('the share-format wiring must not patch a row'); },
    delete() { throw new Error('the share-format wiring must not delete a row'); },
  };
}

function shareCtx(tables: Tables) {
  const mutations: Row[] = [];
  const ctx = {
    db: fakeDb(tables),
    runMutation: (ref: unknown, args: Row) => {
      const target = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
      mutations.push({ target, ...args });
      return Promise.resolve({ publicationId: 'pub:x:1', status: 'generated', version: 1, deduplicated: false });
    },
  };
  return { ctx, mutations };
}

const run = (tables: Tables, over: Row = {}) =>
  generate._handler(shareCtx(tables).ctx, { worldId: WORLD_ID, worldDay: WORLD_DAY, createdAt: NOW, ...over });

describe('generateEpisodeShareFormats — the happy path', () => {
  it('derives, gates and records the copy for a ready Episode', async () => {
    const tables = emptyTables();
    const { ctx, mutations } = shareCtx(tables);
    const result = await generate._handler(ctx, { worldId: WORLD_ID, worldDay: WORLD_DAY, createdAt: NOW }) as Row;

    expect(result).toMatchObject({
      status: 'manual_release_required', reasonCodes: [], episodeNumber: EPISODE_NUMBER, deduplicated: false,
    });
    expect(tables.episodeShareFormats).toHaveLength(1);
    const row = tables.episodeShareFormats[0];
    expect(row.status).toBe('manual_release_required');
    expect(row.sourceEventIds).toEqual([1, 2, 3].map((n) => `${WORLD_ID}#event#${n}`));
    expect((row.formats as Row).sourceEpisode).toMatchObject({
      worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: EPISODE_NUMBER,
      contentRef: `episode:${WORLD_ID}:${WORLD_DAY}`,
    });
    // The derived copy's own safety verdict is recorded under its own source id, so an operator
    // can withhold the share copy without touching the Episode's classification.
    expect(tables.postGenerationSafetyClassifications).toHaveLength(1);
    expect(tables.postGenerationSafetyClassifications[0]).toMatchObject({
      sourceId: shareFormatsSafetySourceId(WORLD_ID, WORLD_DAY), kind: 'public_artifact', label: 'allow',
    });
    // ...and the publication record is created for the SHARE content reference, as `episode_share`.
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      target: 'editorial/publicationLifecycleFunctions:createEpisodePublication',
      contentRef: shareFormatsContentRef(WORLD_ID, WORLD_DAY),
      contentKind: 'episode_share',
      actor: { type: 'system', id: 'episode-share-formats' },
      summary: null,
    });
  });

  it('is idempotent per world day', async () => {
    const tables = emptyTables();
    await run(tables);
    const { ctx, mutations } = shareCtx(tables);
    const second = await generate._handler(ctx, { worldId: WORLD_ID, worldDay: WORLD_DAY, createdAt: NOW + 1 }) as Row;
    expect(second).toMatchObject({ status: 'manual_release_required', deduplicated: true });
    expect(tables.episodeShareFormats).toHaveLength(1);
    // A repeat neither re-classifies nor creates a second publication record.
    expect(mutations).toEqual([]);
  });

  it('reads only through indexes, and never patches or deletes', async () => {
    // `fakeDb.patch`/`delete` throw. Reaching either would fail this test rather than pass it.
    await expect(run(emptyTables())).resolves.toMatchObject({ status: 'manual_release_required' });
    const source = (await import('node:fs')).readFileSync('convex/editorial/shareFormatFunctions.ts', 'utf8');
    // EVERY table read is index-scoped. Asserted as a property of each `.query(...)` rather than
    // as a count of `withIndex` calls, so adding a read does not have to update a number -- and
    // adding an UNSCOPED one still fails. An unbounded sweep of a `v.any()` table on a per-day
    // path is what this exists to stop.
    const reads = [...source.matchAll(/\.query\('(\w+)'\)\s*(\.\w+)/g)];
    expect(reads.length).toBeGreaterThanOrEqual(4);
    for (const [, table, next] of reads) expect({ table, next }).toEqual({ table, next: '.withIndex' });
  });
});

describe('generateEpisodeShareFormats — refusal paths', () => {
  it('blocks a withheld Episode and stores no copy', async () => {
    const tables = emptyTables({ dailyEpisodes: [episodeRow({ status: 'withheld', episode: undefined })] });
    const result = await run(tables) as Row;
    expect(result).toMatchObject({ status: 'blocked', reasonCodes: ['SHARE_SOURCE_EPISODE_NOT_READY'] });
    // Refused content is not stored where a later reader could mistake its presence for permission.
    expect(tables.episodeShareFormats[0].formats).toBeUndefined();
    expect(tables.episodeShareFormats[0].status).toBe('blocked');
  });

  it('blocks a failed Episode', async () => {
    const tables = emptyTables({
      dailyEpisodes: [episodeRow({ status: 'failed', episode: undefined, errorCode: 'EPISODE_SECRET_LEAK' })],
    });
    expect(await run(tables)).toMatchObject({ status: 'blocked', reasonCodes: ['SHARE_SOURCE_EPISODE_NOT_READY'] });
  });

  it('records a failure when the stored Episode blob is unreadable', async () => {
    const tables = emptyTables({ dailyEpisodes: [episodeRow({ episode: { headline: 'partial' } })] });
    const result = await run(tables) as Row;
    expect(result).toMatchObject({ status: 'failed', errorCode: 'SHARE_SOURCE_EPISODE_UNREADABLE' });
    expect(tables.episodeShareFormats[0].formats).toBeUndefined();
  });

  it('writes nothing at all for a day with no Episode', async () => {
    const tables = emptyTables({ dailyEpisodes: [] });
    expect(await run(tables)).toMatchObject({ status: 'absent', episodeNumber: null });
    expect(tables.episodeShareFormats).toEqual([]);
    expect(tables.postGenerationSafetyClassifications).toEqual([]);
  });

  it('refuses copy whose provenance the accepted-event log does not support', async () => {
    // THE non-tautology test. The stored Episode cites three events; the log holds two. A wiring
    // that validated the copy against the Episode's own ids would succeed here.
    const tables = emptyTables({ canonEvents: acceptedRows([1, 2]) });
    const result = await run(tables) as Row;
    expect(result).toMatchObject({ status: 'failed', reasonCodes: ['SHARE_SOURCE_NOT_ACCEPTED'] });
    expect(tables.episodeShareFormats[0].formats).toBeUndefined();

    // ...and the same Episode against the complete log is accepted, so the refusal above is
    // about the provenance and not about the fixture being broken in some other way.
    expect(await run(emptyTables())).toMatchObject({ status: 'manual_release_required' });
  });

  it('blocks copy an operator has withheld, and releases it again when they revoke', async () => {
    const sourceId = shareFormatsSafetySourceId(WORLD_ID, WORLD_DAY);
    const override = (label: string, createdAt: number): Row => ({
      worldId: WORLD_ID, sourceId, classificationId: `${sourceId}:safety`,
      label, reason: 'reviewed', actor: 'op-admin', createdAt,
    });
    const withheld = emptyTables({ safetyStatusOverrides: [override('withhold', 10)] });
    expect(await run(withheld)).toMatchObject({ status: 'blocked', reasonCodes: ['SHARE_SAFETY_WITHHELD'] });
    expect(withheld.episodeShareFormats[0].formats).toBeUndefined();

    const revoked = emptyTables({ safetyStatusOverrides: [override('withhold', 10), override('allow', 20)] });
    expect(await run(revoked)).toMatchObject({ status: 'manual_release_required' });
  });

  it('blocks copy the classifier itself refuses', async () => {
    const unsafe = episodeBlob({
      headline: 'A guide with graphic dismemberment.',
      oneLineSummary: 'A guide with graphic dismemberment.',
    });
    const tables = emptyTables({ dailyEpisodes: [episodeRow({ episode: unsafe })] });
    expect(await run(tables)).toMatchObject({ status: 'blocked', reasonCodes: ['SHARE_SAFETY_WITHHELD'] });
    expect(tables.postGenerationSafetyClassifications[0]).toMatchObject({
      label: 'withhold', reasonCodes: ['EXTREME_VIOLENCE_DETAIL'],
    });
  });

  it('rejects a malformed request before touching the database', async () => {
    const tables = emptyTables();
    await expect(run(tables, { worldDay: -1 })).rejects.toThrow(/invalid share-format generation request/);
    await expect(run(tables, { worldId: '  ' })).rejects.toThrow(/invalid share-format generation request/);
    await expect(run(tables, { createdAt: Number.NaN })).rejects.toThrow(/invalid share-format generation request/);
    expect(tables.episodeShareFormats).toEqual([]);
  });
});

describe('FR-G005 AC#3 — the automated pipeline cannot publish what it generated', () => {
  it('creates the share publication in `generated`, never `published`', async () => {
    const tables = emptyTables();
    const { ctx, mutations } = shareCtx(tables);
    const result = await generate._handler(ctx, { worldId: WORLD_ID, worldDay: WORLD_DAY, createdAt: NOW }) as Row;
    expect(result.publicationStatus).toBe('generated');
    // No transition is attempted at all -- the wiring calls `createEpisodePublication` and stops.
    expect(mutations.map(({ target }) => target)).toEqual([
      'editorial/publicationLifecycleFunctions:createEpisodePublication',
    ]);
  });

  it('is refused `publish` by the real lifecycle when it tries', () => {
    // Asserted against the SHIPPED `transitionPublication`, using the SHIPPED actor the wiring
    // creates records as. If `publish` ever stopped being administrator-only, this fails.
    const actor = { type: 'system' as const, id: 'episode-share-formats' };
    const record = createPublicationRecord({
      publicationId: 'pub:share:1', worldId: WORLD_ID, contentKind: 'episode_share',
      contentRef: shareFormatsContentRef(WORLD_ID, WORLD_DAY), summary: null,
      actor, reason: 'episode-derived share formats', at: NOW,
    });
    let ready = record;
    for (const action of ['validate', 'begin_safety_review', 'pass_safety_review'] as const) {
      ready = transitionPublication(ready, action, actor, 'pipeline', NOW);
    }
    expect(ready.status).toBe('ready');
    expect(() => transitionPublication(ready, 'publish', actor, 'pipeline', NOW))
      .toThrow(/action 'publish' requires an administrator/);
    // An administrator can, which is what makes the refusal above about the ACTOR and not about
    // derived content being unpublishable in principle.
    expect(transitionPublication(ready, 'publish', { type: 'admin', id: 'op-1' }, 'reviewed', NOW).status)
      .toBe('published');
  });

  it('declares `episode_share` as a first-class content kind', () => {
    expect(PUBLICATION_CONTENT_KINDS).toEqual(['episode', 'episode_share']);
  });
});

describe('getEpisodeShareFormats', () => {
  it('returns the recorded row for a world day, or null', async () => {
    const tables = emptyTables();
    await run(tables);
    const { ctx } = shareCtx(tables);
    expect(await read._handler(ctx, { worldId: WORLD_ID, worldDay: WORLD_DAY }))
      .toMatchObject({ status: 'manual_release_required' });
    expect(await read._handler(ctx, { worldId: WORLD_ID, worldDay: 99 })).toBeNull();
  });
});
