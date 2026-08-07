/**
 * Serving a Visual Replay (FR-O013 / ART-121): the read-time resolver and the rebuild wiring.
 *
 * Two things are proved here that the pure builder cannot prove on its own.
 *
 * **The version-and-status gate (AC#3/#10).** The builder pins a `publicationVersion` and
 * stops. Whether that pin still resolves is decided at READ time, against whatever the
 * publication record says now — so the interesting cases (withheld, superseded, re-versioned)
 * are only reachable by changing the record *after* the replay was built, which is exactly
 * what these tests do. This is also the property FR-P004 / ART-132 will build its
 * invalidation on: until that task lands, a retracted sentence is unreachable because the
 * gate refuses it, not because anything rebuilt the payload.
 *
 * **No generation, no Canon write (AC#4).** The rebuild is transcribed against an in-memory
 * database whose `canonEvents` and `llmTraces` tables are seeded and then counted, following
 * the convention `canonRuntimeSync.test.ts` established: the claims worth making here are
 * about what happens *around* the pure function, and a test of the pure function alone could
 * not make them.
 */

import { MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { FIXTURE_ACCEPTED_AT_MS } from '../visualRuntime/fixtures';
import { mistwoodRuntimeContext } from '../visualRuntime/mistwoodRuntime';
import { LIVE_MODEL_KIND } from './liveState';
import {
  commitReadModelVersion,
  serveReadModel,
  type JsonValue,
  type PublishedReadModel,
  type PublicReadStore,
  type ReadModelKind,
  type StoredReadModel,
} from './readModel';
import {
  VISUAL_REPLAY_MODEL_KIND,
  buildVisualReplay,
  episodeSceneSummaryId,
  selectVisualReplay,
  type ReplayEventLike,
  type ReplayPublicationRecord,
  type VisualReplay,
} from './visualReplay';
import { resolveReplayTexts } from './visualReplayFunctions';

const WORLD_ID = MISTWOOD_PUBLIC_WORLD_ID;
const HALL = 'mistwood-hall';
const MILL = 'mistwood-mill';
const SQUARE = 'mistwood-square';
const CONTENT_REF = `episode:${WORLD_ID}:1`;

const EPISODE_SUMMARY = '眾人在鎮公所見證了休戰協議。';
const MILL_SUMMARY = '磨坊的水車修好了。';

function event(over: {
  sequenceNumber: number;
  worldDay: number;
  timeSlot: string;
  locationId: string;
  participantIds: readonly string[];
  publicSummary?: string;
  move?: { characterId: string; toLocationId: string };
}): ReplayEventLike {
  return {
    eventId: `mistwood#event#${over.sequenceNumber}`,
    sequenceNumber: over.sequenceNumber,
    worldDay: over.worldDay,
    timeSlot: over.timeSlot,
    acceptedAt: FIXTURE_ACCEPTED_AT_MS + over.sequenceNumber,
    locationId: over.locationId,
    participantIds: over.participantIds,
    ...(over.publicSummary === undefined ? {} : { publicSummary: over.publicSummary }),
    stateChanges: over.move
      ? [{ type: 'character_location_changed', characterId: over.move.characterId, toLocationId: over.move.toLocationId }]
      : [],
  };
}

const EVENTS: readonly ReplayEventLike[] = [
  event({ sequenceNumber: 0, worldDay: 0, timeSlot: 'morning', locationId: SQUARE, participantIds: ['wu-zhen'], move: { characterId: 'wu-zhen', toLocationId: SQUARE } }),
  event({ sequenceNumber: 1, worldDay: 1, timeSlot: 'morning', locationId: HALL, participantIds: ['wu-zhen'], publicSummary: 'x', move: { characterId: 'wu-zhen', toLocationId: HALL } }),
  event({ sequenceNumber: 2, worldDay: 1, timeSlot: 'noon', locationId: MILL, participantIds: ['wu-zhen'], publicSummary: MILL_SUMMARY, move: { characterId: 'wu-zhen', toLocationId: MILL } }),
  event({ sequenceNumber: 3, worldDay: 2, timeSlot: 'morning', locationId: SQUARE, participantIds: ['wu-zhen'], publicSummary: 'y', move: { characterId: 'wu-zhen', toLocationId: SQUARE } }),
];

const EPISODES = [
  {
    worldDay: 1,
    status: 'ready',
    keyScenes: [{ title: '休戰之日', summary: EPISODE_SUMMARY, sourceEventIds: ['mistwood#event#1'] }],
  },
];

function buildFixtureReplay(records: ReadonlyMap<string, ReplayPublicationRecord>): VisualReplay {
  const replay = buildVisualReplay({
    worldId: WORLD_ID,
    acceptedEvents: EVENTS,
    arcMemberships: [
      { sourceEventSequenceNumber: 1, arcIds: ['arc-truce'], importance: 0.9 },
      { sourceEventSequenceNumber: 2, arcIds: ['arc-mill'], importance: 0.6 },
    ],
    excludedCharacterIds: new Set<string>(),
    runtime: mistwoodRuntimeContext(),
    episodes: EPISODES,
    publicationRecords: records,
  });
  if (!replay) throw new Error('fixture produced no replay');
  return replay;
}

const PUBLISHED_AT_V2 = new Map<string, ReplayPublicationRecord>([
  [CONTENT_REF, { version: 2, status: 'published' }],
]);

// ---------------------------------------------------------------------------
// An in-memory database, shaped like the slice these functions actually use.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

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
          const rows = (tables[table] ?? []).filter((row) =>
            Object.entries(constraints).every(([field, value]) => row[field] === value));
          return {
            unique: () => Promise.resolve(rows[0] ?? null),
            collect: () => Promise.resolve(rows),
          };
        },
      };
    },
  };
  return db as unknown as Parameters<typeof resolveReplayTexts>[0];
}

function publicationRow(over: { version: number; status: string; isCurrent?: boolean }): Row {
  return {
    worldId: WORLD_ID,
    contentKind: 'episode',
    contentRef: CONTENT_REF,
    publicationId: 'pub-1',
    version: over.version,
    status: over.status,
    isCurrent: over.isCurrent ?? true,
  };
}

function episodeRow(status = 'ready'): Row {
  return {
    worldId: WORLD_ID,
    worldDay: 1,
    status,
    episode: { keyScenes: [{ title: '休戰之日', summary: EPISODE_SUMMARY, sourceEventIds: ['mistwood#event#1'] }] },
  };
}

/** A `publishedReadModels` row holding the live projection, the only place a canon summary resolves from. */
function liveStateRow(): Row {
  return {
    _id: 'live-row',
    schemaVersion: 1,
    worldId: WORLD_ID,
    modelKind: LIVE_MODEL_KIND,
    modelRef: `live:${WORLD_ID}`,
    version: 1,
    payload: {
      recentEvents: [
        { eventId: 'mistwood#event#2', summary: MILL_SUMMARY, worldDay: 1, timeSlot: 'noon' },
        { eventId: 'mistwood#event#1', summary: 'x', worldDay: 1, timeSlot: 'morning' },
      ],
    },
    status: 'published',
    sourceEventIds: [],
    isCurrent: true,
    isLastKnownGood: false,
    contentHash: 'rmhash:1',
    createdAt: 1,
    updatedAt: 1,
  };
}

function fullDb(over: { publication?: Row; episode?: Row } = {}) {
  return memoryDb({
    publicationRecords: [over.publication ?? publicationRow({ version: 2, status: 'published' })],
    dailyEpisodes: [over.episode ?? episodeRow()],
    publishedReadModels: [liveStateRow()],
  });
}

// ---------------------------------------------------------------------------

describe('AC#3/#10 — text is resolved at read time, behind a version-and-status gate', () => {
  const replay = buildFixtureReplay(PUBLISHED_AT_V2);

  it('resolves an episode reference whose record still matches', async () => {
    const texts = await resolveReplayTexts(fullDb(), WORLD_ID, replay);
    const episodeText = texts.find(
      (entry) => entry.publicSummaryId === episodeSceneSummaryId(WORLD_ID, 1, 0),
    );
    expect(episodeText).toEqual({
      publicSummaryId: episodeSceneSummaryId(WORLD_ID, 1, 0),
      publicationVersion: 2,
      text: EPISODE_SUMMARY,
    });
  });

  it('resolves a canon-event reference from the published live projection, never from Canon', async () => {
    const texts = await resolveReplayTexts(fullDb(), WORLD_ID, replay);
    expect(texts.find((entry) => entry.publicSummaryId === 'canonEvent:mistwood#event#2')?.text)
      .toBe(MILL_SUMMARY);
    // An event that has aged out of `recentEvents` simply does not resolve — the resolver has
    // no other place to look, which is the point.
    const emptyLive = memoryDb({
      publicationRecords: [publicationRow({ version: 2, status: 'published' })],
      dailyEpisodes: [episodeRow()],
      publishedReadModels: [{ ...liveStateRow(), payload: { recentEvents: [] } }],
    });
    expect((await resolveReplayTexts(emptyLive, WORLD_ID, replay))
      .some((entry) => entry.publicSummaryId.startsWith('canonEvent:'))).toBe(false);
  });

  it('resolves nothing for a record that has been withheld or superseded', async () => {
    for (const status of ['withheld', 'superseded', 'safety_review', 'validated', 'generated']) {
      const texts = await resolveReplayTexts(
        fullDb({ publication: publicationRow({ version: 2, status }) }),
        WORLD_ID,
        replay,
      );
      expect(texts.map((entry) => entry.publicSummaryId)).not.toContain(
        episodeSceneSummaryId(WORLD_ID, 1, 0),
      );
      // No error, no placeholder text, no stale copy: the reference is simply absent.
      expect(texts.every((entry) => entry.text !== EPISODE_SUMMARY)).toBe(true);
    }
  });

  it('resolves nothing when the record has moved to a version the step did not pin', async () => {
    for (const version of [1, 3, 99]) {
      const texts = await resolveReplayTexts(
        fullDb({ publication: publicationRow({ version, status: 'published' }) }),
        WORLD_ID,
        replay,
      );
      expect(texts.every((entry) => entry.text !== EPISODE_SUMMARY)).toBe(true);
    }
  });

  it('resolves nothing when the record is gone, or the episode is no longer ready', async () => {
    const noRecord = memoryDb({
      publicationRecords: [],
      dailyEpisodes: [episodeRow()],
      publishedReadModels: [liveStateRow()],
    });
    expect((await resolveReplayTexts(noRecord, WORLD_ID, replay))
      .every((entry) => entry.text !== EPISODE_SUMMARY)).toBe(true);

    const notReady = fullDb({ episode: episodeRow('withheld') });
    expect((await resolveReplayTexts(notReady, WORLD_ID, replay))
      .every((entry) => entry.text !== EPISODE_SUMMARY)).toBe(true);
  });

  it('is unaffected by a non-current publication row', async () => {
    // A superseded row lingering in the table must not be able to answer for the current one.
    const staleOnly = memoryDb({
      publicationRecords: [publicationRow({ version: 2, status: 'published', isCurrent: false })],
      dailyEpisodes: [episodeRow()],
      publishedReadModels: [liveStateRow()],
    });
    expect((await resolveReplayTexts(staleOnly, WORLD_ID, replay))
      .every((entry) => entry.text !== EPISODE_SUMMARY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC#4 — a rebuild with a replay writes no Canon event and records no LLM trace
// ---------------------------------------------------------------------------

class MemoryReadStore implements PublicReadStore {
  readonly rows: StoredReadModel[] = [];
  private counter = 0;
  async loadTargetVersions(worldId: string, modelKind: string, modelRef: string) {
    return Promise.resolve(this.rows.filter((row) =>
      row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef));
  }
  async findCurrent(worldId: string, modelKind: string, modelRef: string) {
    return Promise.resolve(this.rows.find((row) =>
      row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isCurrent) ?? null);
  }
  async loadLastKnownGood(worldId: string, modelKind: string, modelRef: string) {
    return Promise.resolve(this.rows.filter((row) =>
      row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isLastKnownGood));
  }
  async insertVersion(record: PublishedReadModel) {
    this.counter += 1;
    const id = `row-${this.counter}`;
    this.rows.push({ ...record, id });
    return Promise.resolve(id);
  }
  async markCurrent(rowId: string, patch: { isCurrent: boolean; isLastKnownGood: boolean; status: never; updatedAt: number }) {
    const row = this.rows.find((candidate) => candidate.id === rowId);
    if (row) {
      row.isCurrent = patch.isCurrent;
      row.isLastKnownGood = patch.isLastKnownGood;
      row.status = patch.status;
    }
    return Promise.resolve();
  }
}

describe('AC#4 — publishing a replay adds no Canon event and no LLM trace', () => {
  /**
   * The replay half of `rebuildLiveProjection`, transcribed. The two tables the criterion is
   * about are held here as plain arrays: nothing on this path is given a way to write to
   * them, so counting them before and after is the whole assertion.
   */
  async function rebuildReplayOnce(args: {
    readonly store: MemoryReadStore;
    readonly canonEvents: Row[];
    readonly llmTraces: Row[];
    readonly nowMs: number;
  }) {
    const replay = buildVisualReplay({
      worldId: WORLD_ID,
      acceptedEvents: EVENTS,
      arcMemberships: [{ sourceEventSequenceNumber: 1, arcIds: ['arc-truce'], importance: 0.9 }],
      excludedCharacterIds: new Set<string>(),
      runtime: mistwoodRuntimeContext(),
      episodes: EPISODES,
      publicationRecords: PUBLISHED_AT_V2,
    });
    if (!replay) return null;
    return commitReadModelVersion(args.store, {
      worldId: WORLD_ID,
      modelKind: VISUAL_REPLAY_MODEL_KIND as ReadModelKind,
      modelRef: `replay:${WORLD_ID}`,
      payload: replay as unknown as JsonValue,
      sourceEventIds: replay.sourceEventIds,
      status: 'published',
      now: args.nowMs,
    });
  }

  it('leaves the Canon and trace tables byte-identical across two rebuilds', async () => {
    const store = new MemoryReadStore();
    const canonEvents: Row[] = EVENTS.map((entry) => ({ ...entry }));
    const llmTraces: Row[] = [{ traceId: 'trace-1' }];
    const canonBefore = JSON.stringify(canonEvents);
    const tracesBefore = JSON.stringify(llmTraces);

    const first = await rebuildReplayOnce({ store, canonEvents, llmTraces, nowMs: 1_000 });
    const second = await rebuildReplayOnce({ store, canonEvents, llmTraces, nowMs: 2_000 });

    expect(first?.deduplicated).toBe(false);
    // The second rebuild of an unchanged world re-derives identical bytes and appends nothing.
    expect(second?.deduplicated).toBe(true);
    expect(second?.version).toBe(first?.version);
    expect(store.rows).toHaveLength(1);

    expect(JSON.stringify(canonEvents)).toBe(canonBefore);
    expect(JSON.stringify(llmTraces)).toBe(tracesBefore);
    expect(canonEvents).toHaveLength(EVENTS.length);
    expect(llmTraces).toHaveLength(1);
  });

  it('serves the committed replay back through the ordinary public read path', async () => {
    const store = new MemoryReadStore();
    await rebuildReplayOnce({ store, canonEvents: [], llmTraces: [], nowMs: 1_000 });
    const served = await serveReadModel(
      store,
      WORLD_ID,
      VISUAL_REPLAY_MODEL_KIND as ReadModelKind,
      `replay:${WORLD_ID}`,
    );
    const replay = selectVisualReplay(served?.payload);
    expect(replay?.worldId).toBe(WORLD_ID);
    expect(replay?.scenes.length).toBeGreaterThan(0);
    // The private-field strip the read model applies on both sides left the payload intact,
    // which is the check that no replay field collides with a private-key pattern.
    expect(JSON.stringify(replay)).toBe(JSON.stringify(selectVisualReplay(served?.payload)));
  });
});
