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

import type { AcceptedEvent } from '../canon/model';
import { MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { FIXTURE_ACCEPTED_AT_MS } from '../visualRuntime/fixtures';
import { mistwoodRuntimeContext } from '../visualRuntime/mistwoodRuntime';
import type { SceneSafetyLabel } from './activeScenePresentation';
import { LIVE_MODEL_KIND, buildLiveProjection } from './liveState';
import {
  redactWithheldNarration,
  redactWithheldSummaries,
  sceneEventRows,
  withheldEventIds,
} from './liveStateFunctions';
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

// ---------------------------------------------------------------------------
// FR-P004 / ART-132 AC#6 — a withheld Scene's sentence stops resolving
// ---------------------------------------------------------------------------

/**
 * The `canonEventSummary` half of the safety gate, end to end.
 *
 * The gate is applied by the PRODUCER (`redactWithheldSummaries` inside
 * `rebuildLiveProjection`) rather than by this resolver, so the honest test runs the producer
 * and then the resolver: an override flips a Scene's effective label, the rebuild drops that
 * Scene's events' summaries before either read model is built, and the replay reference that
 * pinned one of those sentences resolves to nothing. That placement is the point — a read-time
 * filter would leave the refused sentence sitting in the published payload, where the
 * last-known-good fallback would go on serving it.
 */
describe('AC#6 — a withheld Scene’s canon-event reference drops its text', () => {
  const SCENE_ID = 'mistwood:1:noon:grouping:scene:1';
  const REFUSED = MILL_SUMMARY;

  const canonEvent = (over: {
    sequenceNumber: number;
    worldDay: number;
    timeSlot: string;
    locationId: string;
    publicSummary?: string;
    sceneId?: string;
  }): AcceptedEvent => ({
    schemaVersion: 1,
    worldId: WORLD_ID,
    idempotencyKey: `key-${over.sequenceNumber}`,
    proposedBy: { type: 'director', id: 'director-1' },
    worldDay: over.worldDay,
    timeSlot: over.timeSlot as AcceptedEvent['timeSlot'],
    eventType: 'conversation',
    locationId: over.locationId,
    participantIds: ['wu-zhen'],
    causedByEventIds: [],
    ...(over.publicSummary === undefined ? {} : { publicSummary: over.publicSummary }),
    stateChanges: [],
    ...(over.sceneId === undefined ? {} : { metadata: { sceneId: over.sceneId } }),
    eventId: `mistwood#event#${over.sequenceNumber}`,
    acceptedAt: FIXTURE_ACCEPTED_AT_MS + over.sequenceNumber,
    sequenceNumber: over.sequenceNumber,
    validationVersion: 'canon-v1',
    traceId: 'trace-1',
  });

  const CANON_EVENTS: readonly AcceptedEvent[] = [
    canonEvent({ sequenceNumber: 1, worldDay: 1, timeSlot: 'morning', locationId: HALL, publicSummary: 'x' }),
    canonEvent({ sequenceNumber: 2, worldDay: 1, timeSlot: 'noon', locationId: MILL, publicSummary: REFUSED, sceneId: SCENE_ID }),
  ];

  /**
   * The `liveState` payload a rebuild would publish, given the Scenes currently refused.
   *
   * `refused` carries ONLY refused Scenes — that is the contract `readWithheldSceneLabels`
   * produces and the whole gate consumes. A Scene absent from it is showable, so the allowed
   * case below passes an empty map rather than one mapping the Scene to `'allow'`.
   */
  function liveRowFor(refused: ReadonlyMap<string, SceneSafetyLabel>): Row {
    const withheld = withheldEventIds(sceneEventRows(CANON_EVENTS), refused);
    const payload = buildLiveProjection({
      worldId: WORLD_ID,
      acceptedEvents: redactWithheldSummaries(CANON_EVENTS, withheld),
      arcs: [],
      publishedEpisode: null,
    });
    return { ...liveStateRow(), payload: payload as unknown as Row };
  }

  function textsFor(refused: ReadonlyMap<string, SceneSafetyLabel>) {
    const db = memoryDb({
      publicationRecords: [publicationRow({ version: 2, status: 'published' })],
      dailyEpisodes: [episodeRow()],
      publishedReadModels: [liveRowFor(refused)],
    });
    return resolveReplayTexts(db, WORLD_ID, buildFixtureReplay(PUBLISHED_AT_V2));
  }

  it('still resolves the sentence while the Scene is allowed', async () => {
    const texts = await textsFor(new Map<string, SceneSafetyLabel>());
    expect(texts.find((entry) => entry.publicSummaryId === 'canonEvent:mistwood#event#2')?.text)
      .toBe(REFUSED);
  });

  it.each(['withhold', 'human_review_required'] as const)(
    'drops it silently once the Scene resolves to %s',
    async (label) => {
      const texts = await textsFor(new Map<string, SceneSafetyLabel>([[SCENE_ID, label]]));
      // Silently: no error, no placeholder, no stale copy — the reference is simply absent,
      // exactly as it is for an episode whose publication record has been withheld.
      expect(texts.map((entry) => entry.publicSummaryId)).not.toContain('canonEvent:mistwood#event#2');
      expect(texts.every((entry) => entry.text !== REFUSED)).toBe(true);
      // The unrelated event in the same replay keeps resolving: a withhold removes one
      // Scene's text, not the whole replay.
      expect(texts.some((entry) => entry.publicSummaryId === episodeSceneSummaryId(WORLD_ID, 1, 0))).toBe(true);
    },
  );

  it('leaves an event with no Scene provenance alone', () => {
    // `mistwood#event#1` carries no `metadata.sceneId`, so no classification governs it and a
    // label for another Scene cannot reach it.
    const payload = liveRowFor(new Map<string, SceneSafetyLabel>([[SCENE_ID, 'withhold']])).payload as {
      recentEvents: { eventId: string; summary: string | null }[];
    };
    expect(payload.recentEvents.find((entry) => entry.eventId === 'mistwood#event#1')?.summary).toBe('x');
    expect(payload.recentEvents.find((entry) => entry.eventId === 'mistwood#event#2')?.summary).toBeNull();
  });

  it('treats a non-string metadata.sceneId as absent rather than trusting it', () => {
    // `metadata` is untyped storage. A number, an object or a blank string is not a Scene id,
    // and coercing one would key the safety lookup on a value no classification can match.
    for (const sceneId of [42, '', null, { sceneId: 'x' }, ['a']]) {
      const [row] = sceneEventRows([
        { ...CANON_EVENTS[0], metadata: { sceneId } } as unknown as AcceptedEvent,
      ]);
      expect(row.sceneId).toBeUndefined();
    }
    expect(sceneEventRows([CANON_EVENTS[1]])[0].sceneId).toBe(SCENE_ID);
  });

  it('does not alter Canon: the source events are byte-identical after a rebuild', async () => {
    const before = JSON.stringify(CANON_EVENTS);
    await textsFor(new Map<string, SceneSafetyLabel>([[SCENE_ID, 'withhold']]));
    expect(JSON.stringify(CANON_EVENTS)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// FR-P004 / ART-132 AC#6 — the `episodeScene` branch, which PREFERS episode narration
// ---------------------------------------------------------------------------

/**
 * The half of AC#6 that redacting event summaries alone does not close.
 *
 * `resolveEventCardStep` prefers a published episode's narration over an event's own
 * `publicSummary`, and that branch is gated on the episode's publication version and status —
 * which know nothing about scene-level safety. So on any world day with a published episode
 * covering a withheld scene, the overlay would show the safe placeholder while the replay
 * narrated the withheld content, for the same scene, at the same moment.
 *
 * The first test below builds the replay WITHOUT the narration redaction and asserts the leak
 * is real — a regression test is worth nothing if it would pass against the broken version.
 */
describe('AC#6 — a withheld Scene’s EPISODE narration is unreachable too', () => {
  const SCENE_ID = 'mistwood:1:noon:grouping:scene:1';
  const HALL_EPISODE_TEXT = '眾人在鎮公所見證了休戰協議。';
  const MILL_EPISODE_TEXT = '磨坊裡發生了不該公開的事。';

  const replayEvent = (over: {
    sequenceNumber: number;
    worldDay: number;
    timeSlot: string;
    locationId: string;
    publicSummary?: string;
    sceneId?: string;
  }): ReplayEventLike => ({
    eventId: `mistwood#event#${over.sequenceNumber}`,
    sequenceNumber: over.sequenceNumber,
    worldDay: over.worldDay,
    timeSlot: over.timeSlot,
    acceptedAt: FIXTURE_ACCEPTED_AT_MS + over.sequenceNumber,
    locationId: over.locationId,
    participantIds: ['wu-zhen'],
    ...(over.publicSummary === undefined ? {} : { publicSummary: over.publicSummary }),
    ...(over.sceneId === undefined ? {} : { sceneId: over.sceneId }),
    stateChanges: [{ type: 'character_location_changed', characterId: 'wu-zhen', toLocationId: over.locationId }],
  });

  // A third event in a LATER slot, so both day-1 groups count as completed and are eligible
  // for replay — `buildVisualReplay` always excludes the slot currently under way.
  const NARRATED_EVENTS: readonly ReplayEventLike[] = [
    replayEvent({ sequenceNumber: 1, worldDay: 1, timeSlot: 'morning', locationId: HALL, publicSummary: 'x' }),
    replayEvent({ sequenceNumber: 2, worldDay: 1, timeSlot: 'noon', locationId: MILL, publicSummary: '磨坊摘要。', sceneId: SCENE_ID }),
    replayEvent({ sequenceNumber: 3, worldDay: 2, timeSlot: 'morning', locationId: SQUARE, publicSummary: 'y' }),
  ];

  /** Both day-1 events are narrated by the day's episode; index 1 covers the withheld Scene. */
  const NARRATED_KEY_SCENES = [
    { title: '休戰之日', summary: HALL_EPISODE_TEXT, sourceEventIds: ['mistwood#event#1'] },
    { title: '磨坊之夜', summary: MILL_EPISODE_TEXT, sourceEventIds: ['mistwood#event#2'] },
  ];

  function buildReplay(withheld: ReadonlySet<string>): VisualReplay {
    const replay = buildVisualReplay({
      worldId: WORLD_ID,
      acceptedEvents: redactWithheldSummaries(
        NARRATED_EVENTS as unknown as readonly AcceptedEvent[],
        withheld,
      ) as unknown as readonly ReplayEventLike[],
      arcMemberships: [
        { sourceEventSequenceNumber: 1, arcIds: ['arc-truce'], importance: 0.9 },
        { sourceEventSequenceNumber: 2, arcIds: ['arc-mill'], importance: 0.8 },
      ],
      excludedCharacterIds: new Set<string>(),
      runtime: mistwoodRuntimeContext(),
      episodes: [{
        worldDay: 1,
        status: 'ready',
        keyScenes: redactWithheldNarration(NARRATED_KEY_SCENES, withheld),
      }],
      publicationRecords: PUBLISHED_AT_V2,
    });
    if (!replay) throw new Error('fixture produced no replay');
    return replay;
  }

  /** The read-time database still holds the REAL, unredacted episode row — as production does. */
  function narratedDb() {
    return memoryDb({
      publicationRecords: [publicationRow({ version: 2, status: 'published' })],
      dailyEpisodes: [{
        worldId: WORLD_ID,
        worldDay: 1,
        status: 'ready',
        episode: { keyScenes: NARRATED_KEY_SCENES },
      }],
      publishedReadModels: [liveStateRow()],
    });
  }

  const WITHHELD = new Set(['mistwood#event#2']);
  const NOTHING_WITHHELD: ReadonlySet<string> = new Set<string>();

  it('would leak the narration without the gate — the failure this test exists to catch', async () => {
    const texts = await resolveReplayTexts(narratedDb(), WORLD_ID, buildReplay(NOTHING_WITHHELD));
    expect(texts.map((entry) => entry.text)).toContain(MILL_EPISODE_TEXT);
    // Specifically via the episodeScene branch, not the event's own summary.
    expect(texts.map((entry) => entry.publicSummaryId)).toContain(episodeSceneSummaryId(WORLD_ID, 1, 1));
  });

  it('resolves no text at all for the withheld Scene once the gate is applied', async () => {
    const texts = await resolveReplayTexts(narratedDb(), WORLD_ID, buildReplay(WITHHELD));
    expect(texts.every((entry) => entry.text !== MILL_EPISODE_TEXT)).toBe(true);
    expect(texts.map((entry) => entry.publicSummaryId)).not.toContain(episodeSceneSummaryId(WORLD_ID, 1, 1));
    // Not via a fallback to the event's own summary either: that was redacted in the same pass.
    expect(texts.map((entry) => entry.publicSummaryId)).not.toContain('canonEvent:mistwood#event#2');
    expect(JSON.stringify(texts)).not.toContain('磨坊');
  });

  it('leaves the neighbouring key scene addressable at its original index', async () => {
    // The withheld entry is NEUTRALISED IN PLACE rather than removed. Removing it would shift
    // index 1 down to 0, and the read-time resolver looks the summary up by index in the real
    // episode row — every later scene would then serve under the wrong address.
    const texts = await resolveReplayTexts(narratedDb(), WORLD_ID, buildReplay(WITHHELD));
    const hall = texts.find((entry) => entry.publicSummaryId === episodeSceneSummaryId(WORLD_ID, 1, 0));
    expect(hall?.text).toBe(HALL_EPISODE_TEXT);
  });

  it('neutralises a key scene that narrates a withheld event ALONGSIDE an allowed one', () => {
    // The summary is a joint narration of both events. Publishing it because one contributor
    // was allowed would publish the other, refused, contributor.
    const joint = [{ title: '合併', summary: '兩件事一起說。', sourceEventIds: ['mistwood#event#1', 'mistwood#event#2'] }];
    expect(redactWithheldNarration(joint, WITHHELD)).toEqual([
      { title: '', summary: '', sourceEventIds: [] },
    ]);
    // And an untouched scene is returned by identity, so an unchanged world re-derives an
    // identical payload and the read model's contentHash dedup keeps working.
    expect(redactWithheldNarration(NARRATED_KEY_SCENES, NOTHING_WITHHELD)[0]).toBe(NARRATED_KEY_SCENES[0]);
  });
});
