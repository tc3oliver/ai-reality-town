/**
 * The safety gate on the cached onboarding summary (ART-125, extending FR-P004 / ART-132).
 *
 * The third instance of one gap, after `liveState` (ART-132 itself) and the Timeline projection
 * (ART-124). `rebuildOnboardingSummary` is a public TEXT surface — it reads `publicSummary`
 * straight off `canonEvents`, harvests `fact_created` predicates and values off their
 * `stateChanges`, and copies the day's narration straight off `dailyEpisodes.keyScenes` — and it
 * had no safety gate at all. All three land in `summaryText`, which is served to every first-time
 * visitor on the homepage and, since ART-125 (FR-O007), on the live map's story overlay.
 *
 * Handler-level, following the pattern `episodeTimelineProjectionFunctions.test.ts` established:
 * the registered mutation's `_handler` runs against a fake `ctx`, so the join, the redaction and
 * the publish are exercised as they actually run. Every assertion is made on the PUBLISHED
 * PAYLOAD, because the point of gating at rebuild time is that the refused sentence is never
 * written down — only the payload can show that.
 *
 * Each gated field is covered by a PAIR of tests, following
 * `visualReplayFunctions.test.ts`'s convention: one that publishes the refused text when nothing
 * is withheld — proving the fixture really does route it onto the surface, so the gated test is
 * not passing vacuously — and one that proves the gate removes it.
 */

import { rebuildOnboardingSummary } from './onboardingSummaryFunctions';

const WORLD_ID = 'mistwood';
const CLEAN_SCENE = 'mistwood:3:morning:grouping:scene:1';
const WITHHELD_SCENE = 'mistwood:3:evening:grouping:scene:2';

const SAFE_SUMMARY = '眾人在磨坊前簽下休戰。';
const REFUSED_SUMMARY = 'POISONED_EVENT: 一段安全分類器拒絕發佈的場景敘述。';
const REFUSED_FACT = 'POISONED_FACT';
const REFUSED_NARRATION = 'POISONED_EPISODE: 這一段敘事重述了被拒絕的場景。';
const SAFE_NARRATION = '磨坊前的休戰,鎮民都看見了。';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const handler = rebuildOnboardingSummary as unknown as Registered;

/**
 * The slice of Convex this handler uses. Index constraints are `eq` chains, so filtering by the
 * captured constraints reproduces them; `createdAt` ordering is modelled because
 * `readWithheldSceneLabels` reads the override ledger through it. `lt` is modelled the same way
 * `voteConsequenceProjectionFunctions.test.ts` models `gte` — a captured range constraint applied
 * alongside the `eq` ones — because the ART-100 tail read pages with `.lt('sequenceNumber', …)`
 * rather than an unconditional collect.
 */
function memoryCtx(tables: Tables) {
  const db = {
    query(table: string) {
      return {
        withIndex(_index: string, build?: (q: unknown) => unknown) {
          const constraints: Row = {};
          const rangeConstraints: Array<[string, number]> = [];
          const builder = {
            eq(field: string, value: unknown) {
              constraints[field] = value;
              return builder;
            },
            lt(field: string, value: number) {
              rangeConstraints.push([field, value]);
              return builder;
            },
          };
          if (build) build(builder);
          const matched = (tables[table] ?? []).filter((row) =>
            Object.entries(constraints).every(([field, value]) => row[field] === value)
            && rangeConstraints.every(([field, value]) => Number(row[field] ?? 0) < value));
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
  return { db } as Parameters<typeof handler._handler>[0];
}

function canonRow(input: {
  sequenceNumber: number;
  publicSummary: string;
  sceneId?: string;
  stateChanges?: Row[];
}): Row {
  return {
    worldId: WORLD_ID,
    sequenceNumber: input.sequenceNumber,
    acceptedAt: 1_000 + input.sequenceNumber,
    validationVersion: '1',
    traceId: `trace-${input.sequenceNumber}`,
    payload: {
      schemaVersion: 1,
      worldId: WORLD_ID,
      idempotencyKey: `event-${input.sequenceNumber}`,
      proposedBy: { type: 'system' },
      worldDay: 3,
      timeSlot: 'evening',
      eventType: 'conversation',
      participantIds: ['zhao-ming', 'he-jun'],
      causedByEventIds: [],
      publicSummary: input.publicSummary,
      stateChanges: input.stateChanges ?? [],
      ...(input.sceneId === undefined ? {} : { metadata: { sceneId: input.sceneId } }),
    },
  };
}

function classificationRow(sourceId: string, label: string): Row {
  return {
    policyVersion: 1, worldId: WORLD_ID, classificationId: `${sourceId}:simulation:safety`,
    sourceId, kind: 'scene', label, reasonCodes: [], warningCodes: [],
    classifiedTextHash: 'fnv1a32:deadbeef', createdAt: 1_000,
  };
}

function overrideRow(sourceId: string, label: string, createdAt: number): Row {
  return {
    worldId: WORLD_ID, sourceId, classificationId: `${sourceId}:simulation:safety`,
    label, reason: 'a viewer report was upheld on review', actor: 'op-admin', createdAt,
  };
}

/** The event id `rowToAcceptedEvent` derives for a sequence number. */
const eventId = (sequenceNumber: number) => `${WORLD_ID}#event#${sequenceNumber}`;

function baseTables(over: Partial<Tables> = {}): Tables {
  return {
    canonEvents: [
      canonRow({ sequenceNumber: 0, publicSummary: SAFE_SUMMARY, sceneId: CLEAN_SCENE }),
      // The most RECENT event, and therefore the one the major-event pick reaches first.
      canonRow({
        sequenceNumber: 1,
        publicSummary: REFUSED_SUMMARY,
        sceneId: WITHHELD_SCENE,
        stateChanges: [{
          type: 'fact_created', visibility: 'public', subjectType: 'world',
          subjectId: WORLD_ID, factId: 'fact-1', predicate: REFUSED_FACT, value: REFUSED_FACT,
        }],
      }),
    ],
    storyArcEventClassifications: [],
    storyArcPortfolioEntries: [],
    storyArcRecommendedEntries: [],
    dailyEpisodes: [],
    postGenerationSafetyClassifications: [],
    safetyStatusOverrides: [],
    publishedReadModels: [],
    ...over,
  };
}

/** A published episode whose FIRST key scene narrates the withheld event. */
function narratedEpisode(): Row[] {
  return [{
    worldId: WORLD_ID,
    worldDay: 3,
    episodeNumber: 3,
    status: 'ready',
    episode: {
      keyScenes: [
        { title: '拒絕的一幕', summary: REFUSED_NARRATION, sourceEventIds: [eventId(1)] },
        { title: '磨坊', summary: SAFE_NARRATION, sourceEventIds: [eventId(0)] },
      ],
    },
  }];
}

type OnboardingPayload = {
  summaryText: string;
  structured: {
    majorEvent: { eventId: string; publicSummary: string } | null;
    facts: Array<{ factId: string; predicate: string }>;
    scene: { title: string; summary: string } | null;
  };
};

async function publishedSummary(tables: Tables): Promise<OnboardingPayload> {
  await handler._handler(memoryCtx(tables), { worldId: WORLD_ID, now: 5_000 });
  const row = (tables.publishedReadModels ?? []).at(-1);
  expect(row).toBeDefined();
  return row!.payload as OnboardingPayload;
}

const withheldTables = (over: Partial<Tables> = {}) => baseTables({
  postGenerationSafetyClassifications: [
    classificationRow(CLEAN_SCENE, 'allow'),
    classificationRow(WITHHELD_SCENE, 'withhold'),
  ],
  ...over,
});

describe('rebuildOnboardingSummary — a withheld Scene never introduces the world', () => {
  it('would leak the refused summary without the gate — the failure this test exists to catch', async () => {
    const payload = await publishedSummary(baseTables());
    // The fixture really does route the refused sentence onto the public surface, twice over:
    // as the picked major event and inside the composed ~300-字 introduction.
    expect(payload.structured.majorEvent?.publicSummary).toBe(REFUSED_SUMMARY);
    expect(payload.summaryText).toContain('POISONED_EVENT');
  });

  it('picks the next showable event instead once the Scene is refused', async () => {
    const payload = await publishedSummary(withheldTables());
    // SKIPPED rather than nulled: unlike the Timeline this model has no positions and no
    // addressing, so leading with `(無摘要)` would be strictly worse than leading with the best
    // showable event.
    expect(payload.structured.majorEvent?.publicSummary).toBe(SAFE_SUMMARY);
    expect(payload.structured.majorEvent?.eventId).toBe(eventId(0));
    // ...and the refused sentence was never written into the payload at all, which is the
    // property read-time filtering could not give.
    expect(JSON.stringify(payload)).not.toContain('POISONED');
  });

  it('would leak a refused fact into the introduction without the gate', async () => {
    expect((await publishedSummary(baseTables())).summaryText).toContain(REFUSED_FACT);
  });

  it('harvests no fact from a refused Scene', async () => {
    // `fact_created` predicates and values are LLM-authored public text, which is why ART-124
    // brought them inside the post-generation classifier's input. `redactWithheldSummaries`
    // drops only `publicSummary`, so this needs its own skip — and its own test.
    const payload = await publishedSummary(withheldTables());
    expect(payload.structured.facts).toHaveLength(0);
    expect(JSON.stringify(payload)).not.toContain(REFUSED_FACT);
  });

  it('would leak the episode narration of a refused Scene without the gate', async () => {
    const payload = await publishedSummary(baseTables({ dailyEpisodes: narratedEpisode() }));
    expect(payload.structured.scene?.summary).toBe(REFUSED_NARRATION);
    expect(payload.summaryText).toContain('POISONED_EPISODE');
  });

  it('falls through to the next key scene when the first narrates a refused event', async () => {
    // Dropping the event's own summary is not enough: a key scene RETELLS the event, and both
    // this surface and the Visual Replay prefer that narration when it exists.
    const payload = await publishedSummary(withheldTables({ dailyEpisodes: narratedEpisode() }));
    expect(payload.structured.scene).toEqual({ title: '磨坊', summary: SAFE_NARRATION });
    expect(JSON.stringify(payload)).not.toContain('POISONED');
  });

  it('drops it after an operator override withholds a Scene the classifier had allowed', async () => {
    // The live case, and the one this gap actually leaked: a Scene is published, a viewer
    // reports it, an operator withholds it — and the world's introduction went on quoting it.
    const payload = await publishedSummary(baseTables({
      postGenerationSafetyClassifications: [
        classificationRow(CLEAN_SCENE, 'allow'),
        classificationRow(WITHHELD_SCENE, 'allow'),
      ],
      safetyStatusOverrides: [overrideRow(WITHHELD_SCENE, 'withhold', 2_000)],
      dailyEpisodes: narratedEpisode(),
    }));
    expect(payload.structured.majorEvent?.publicSummary).toBe(SAFE_SUMMARY);
    expect(JSON.stringify(payload)).not.toContain('POISONED');
  });

  it('restores it when a later override releases the Scene', async () => {
    const payload = await publishedSummary(baseTables({
      postGenerationSafetyClassifications: [
        classificationRow(CLEAN_SCENE, 'allow'),
        classificationRow(WITHHELD_SCENE, 'withhold'),
      ],
      safetyStatusOverrides: [overrideRow(WITHHELD_SCENE, 'allow', 3_000)],
    }));
    expect(payload.structured.majorEvent?.publicSummary).toBe(REFUSED_SUMMARY);
  });

  it('treats human_review_required as withholding, exactly as the dynamic surface does', async () => {
    const payload = await publishedSummary(baseTables({
      postGenerationSafetyClassifications: [classificationRow(WITHHELD_SCENE, 'human_review_required')],
    }));
    expect(payload.structured.majorEvent?.publicSummary).toBe(SAFE_SUMMARY);
  });

  it('does NOT redact an event with no resolvable Scene provenance', async () => {
    // ART-132's convention: Canon carries seed, system and remediation events no classifier ever
    // examined, plus everything accepted before provenance was stamped. Silence means "never in
    // scope", not "refused" — reading it as refusal would blank the introduction wholesale.
    const payload = await publishedSummary(baseTables({
      canonEvents: [
        canonRow({ sequenceNumber: 0, publicSummary: SAFE_SUMMARY }),
        canonRow({ sequenceNumber: 1, publicSummary: REFUSED_SUMMARY }),
      ],
      postGenerationSafetyClassifications: [classificationRow(WITHHELD_SCENE, 'withhold')],
    }));
    expect(payload.structured.majorEvent?.publicSummary).toBe(REFUSED_SUMMARY);
  });

  it('redacts by event id, so a refusal cannot be applied to its neighbour', async () => {
    // Keyed on the event id rather than on a position in a parallel array. The refused Scene is
    // the NEWEST — so an ungated build picks it, and an off-by-one build withholds the wrong row
    // — while its clean neighbour carries a fact that must survive untouched.
    const payload = await publishedSummary(baseTables({
      canonEvents: [
        canonRow({
          sequenceNumber: 0,
          publicSummary: SAFE_SUMMARY,
          sceneId: CLEAN_SCENE,
          stateChanges: [{
            type: 'fact_created', visibility: 'public', subjectType: 'world',
            subjectId: WORLD_ID, factId: 'fact-clean', predicate: '休戰', value: '已簽署',
          }],
        }),
        canonRow({ sequenceNumber: 1, publicSummary: REFUSED_SUMMARY, sceneId: WITHHELD_SCENE }),
      ],
      postGenerationSafetyClassifications: [classificationRow(WITHHELD_SCENE, 'withhold')],
    }));
    expect(payload.structured.majorEvent?.eventId).toBe(eventId(0));
    expect(payload.structured.majorEvent?.publicSummary).toBe(SAFE_SUMMARY);
    // The neighbour lost nothing: its fact is still harvested and still in the introduction.
    expect(payload.structured.facts.map((fact) => fact.factId)).toEqual([`${eventId(0)}:fact:0`]);
    expect(payload.summaryText).toContain('休戰');
    expect(JSON.stringify(payload)).not.toContain('POISONED');
  });

  it('publishes the world’s placeholder when every event is refused, never refused text', async () => {
    const payload = await publishedSummary(baseTables({
      canonEvents: [
        canonRow({ sequenceNumber: 0, publicSummary: SAFE_SUMMARY, sceneId: WITHHELD_SCENE }),
        canonRow({ sequenceNumber: 1, publicSummary: REFUSED_SUMMARY, sceneId: WITHHELD_SCENE }),
      ],
      postGenerationSafetyClassifications: [classificationRow(WITHHELD_SCENE, 'withhold')],
    }));
    expect(payload.structured.majorEvent).toBeNull();
    expect(payload.summaryText).toBe('這個世界正等待你來探索。');
  });
});

/**
 * A `ctx` that records every `.take(n)` a `canonEvents` query asks for, so a test can pin the
 * SHAPE of the tail read (a bounded page, not a whole-log `.collect()`) rather than just its
 * result. A regression back to the old unconditional `by_world_and_sequence` collect leaves this
 * array empty — `.collect()` is never `.take()` — which is exactly what should turn these tests
 * red.
 *
 * `canonRowsRead` records the ACTUAL length each `.take()` resolved to, not the requested count —
 * the total-rows-read guard needs the true cost, and a page near exhaustion resolves to fewer
 * rows than it asked for.
 */
function recordingCtx(tables: Tables) {
  const canonTakes: number[] = [];
  const canonRowsRead: number[] = [];
  const inner = memoryCtx(tables) as { db: Record<string, unknown> };
  type Chain = {
    order: (direction: 'asc' | 'desc') => Chain;
    take: (count: number) => Promise<Row[]>;
    collect: () => Promise<Row[]>;
    first: () => Promise<Row | null>;
    unique: () => Promise<Row | null>;
  };
  function wrap(chain: Chain): Chain {
    return {
      order: (direction) => wrap(chain.order(direction)),
      take: (count) => {
        canonTakes.push(count);
        return chain.take(count).then((rows) => {
          canonRowsRead.push(rows.length);
          return rows;
        });
      },
      collect: () => chain.collect(),
      first: () => chain.first(),
      unique: () => chain.unique(),
    };
  }
  const db = {
    ...inner.db,
    query(table: string) {
      const rawQuery = (inner.db.query as (t: string) => {
        withIndex: (i: string, b?: (q: unknown) => unknown) => Chain;
      })(table);
      if (table !== 'canonEvents') return rawQuery;
      return {
        withIndex(index: string, build?: (q: unknown) => unknown) {
          return wrap(rawQuery.withIndex(index, build));
        },
      };
    },
  };
  return { ctx: { db } as Parameters<typeof handler._handler>[0], canonTakes, canonRowsRead };
}

/** `n` events, with the major-event summary and the three facts always at the very tail. */
function tailLoadedCanonEvents(count: number): Row[] {
  const rows: Row[] = [];
  for (let sequenceNumber = 0; sequenceNumber < count; sequenceNumber += 1) {
    const isTail = sequenceNumber >= count - 3;
    rows.push(canonRow({
      sequenceNumber,
      publicSummary: sequenceNumber === count - 1 ? SAFE_SUMMARY : '',
      stateChanges: isTail ? [{
        type: 'fact_created', visibility: 'public', subjectType: 'world',
        subjectId: WORLD_ID, factId: `fact-${sequenceNumber}`,
        predicate: `predicate-${sequenceNumber}`, value: `value-${sequenceNumber}`,
      }] : [],
    }));
  }
  return rows;
}

describe('rebuildOnboardingSummary — the tail read stays bounded (ART-100)', () => {
  it('reads a fixed-size page, not the whole log, when the answer sits near the tail', async () => {
    const { ctx, canonTakes } = recordingCtx(baseTables({ canonEvents: tailLoadedCanonEvents(300) }));
    const result = await handler._handler(ctx, { worldId: WORLD_ID, now: 5_000 }) as { modelRef: string };
    expect(result.modelRef).toBe(`onboarding:${WORLD_ID}`);
    // One bounded page (`START_WINDOW`), never the 300-row table a `.collect()` would have read.
    expect(canonTakes).toEqual([25]);
  });

  it('does not grow the number of documents read as the total accepted-event count grows', async () => {
    // The same "answer near the tail" shape at two different world sizes. If the read scaled
    // with total accepted-event count (the regression this guards against), the larger world
    // would need a bigger page; it must not.
    const small = recordingCtx(baseTables({ canonEvents: tailLoadedCanonEvents(300) }));
    const large = recordingCtx(baseTables({ canonEvents: tailLoadedCanonEvents(600) }));
    await handler._handler(small.ctx, { worldId: WORLD_ID, now: 5_000 });
    await handler._handler(large.ctx, { worldId: WORLD_ID, now: 5_000 });
    expect(small.canonTakes).toEqual(large.canonTakes);
  });

  it('still finds the right answer once the log outgrows the first page', async () => {
    // A facts harvest that needs more than one page (`START_WINDOW = 25`): the tail's newest 57
    // events carry no facts at all, so the loop must grow the window and keep going rather than
    // settling for whatever the first page happened to contain.
    const rows: Row[] = [];
    for (let sequenceNumber = 0; sequenceNumber < 60; sequenceNumber += 1) {
      rows.push(canonRow({
        sequenceNumber,
        publicSummary: sequenceNumber === 59 ? SAFE_SUMMARY : '',
        stateChanges: sequenceNumber < 3 ? [{
          type: 'fact_created', visibility: 'public', subjectType: 'world',
          subjectId: WORLD_ID, factId: `fact-${sequenceNumber}`,
          predicate: `predicate-${sequenceNumber}`, value: `value-${sequenceNumber}`,
        }] : [],
      }));
    }
    const tables = baseTables({ canonEvents: rows });
    const { ctx, canonTakes, canonRowsRead } = recordingCtx(tables);
    await handler._handler(ctx, { worldId: WORLD_ID, now: 5_000 });
    const published = (tables.publishedReadModels ?? []).at(-1);
    const payload = published!.payload as {
      structured: { facts: Array<{ factId: string }> };
    };
    // Reverse-chronological: event 2's fact is reached first, then event 1's, then event 0's.
    expect(payload.structured.facts.map((fact) => fact.factId)).toEqual([
      `${eventId(2)}:fact:0`, `${eventId(1)}:fact:0`, `${eventId(0)}:fact:0`,
    ]);
    // The page grew (25 -> 50) to reach the early facts, and each page continued from a
    // `.lt('sequenceNumber', …)` cursor rather than re-taking the tail — so the second page (50
    // requested) only had 35 rows left to give (60 total - the first page's 25), which is what
    // ends the loop, rather than a third page ever being asked for.
    expect(canonTakes).toEqual([25, 50]);
    // Exactly the log size: the first page's 25 rows plus the second page's 35 remaining rows,
    // each row counted once. The pre-fix code re-took the tail at each doubling instead of
    // continuing from a cursor, so it would have read 25 + 50 + 60 = 135 rows here — more than
    // double the log.
    expect(canonRowsRead.reduce((total, count) => total + count, 0)).toBe(60);
  });
});

describe('rebuildOnboardingSummary — total rows read never exceeds the log (ART-100 regression)', () => {
  it('never reads more canonEvents rows than the log contains, even in the pathological case that ' +
    'never satisfies the loop', async () => {
    // The shape the reviewer flagged: fewer than 3 qualifying facts (zero, here) AND no showable
    // major event (every `publicSummary` is empty), so `majorEventSource !== null && facts.length
    // >= 3` never holds. The loop can only stop on `exhausted`, so it pages all the way to the
    // end of a 60-event log on every post-commit run — and a re-take-the-tail implementation
    // would pay for that tail again at every doubling (25 + 50 + 60 = 135 rows for this same log).
    // A cursor that continues past what it has already read must still finish at exactly 60.
    const rows: Row[] = [];
    for (let sequenceNumber = 0; sequenceNumber < 60; sequenceNumber += 1) {
      rows.push(canonRow({ sequenceNumber, publicSummary: '' }));
    }
    const tables = baseTables({ canonEvents: rows });
    const { ctx, canonTakes, canonRowsRead } = recordingCtx(tables);
    await handler._handler(ctx, { worldId: WORLD_ID, now: 5_000 });
    const totalRowsRead = canonRowsRead.reduce((total, count) => total + count, 0);
    expect(totalRowsRead).toBeLessThanOrEqual(60);
    expect(totalRowsRead).toBe(60);
    expect(canonTakes).toEqual([25, 50]);
  });

  it('never exceeds the log size in the normal (non-pathological) multi-page case either', async () => {
    // Same 60-event log as "still finds the right answer once the log outgrows the first page",
    // restated here as an explicit total-reads bound rather than an exact page-size pin, so this
    // test keeps failing the same way even if the paging chunk size ever changes.
    const rows: Row[] = [];
    for (let sequenceNumber = 0; sequenceNumber < 60; sequenceNumber += 1) {
      rows.push(canonRow({
        sequenceNumber,
        publicSummary: sequenceNumber === 59 ? SAFE_SUMMARY : '',
        stateChanges: sequenceNumber < 3 ? [{
          type: 'fact_created', visibility: 'public', subjectType: 'world',
          subjectId: WORLD_ID, factId: `fact-${sequenceNumber}`,
          predicate: `predicate-${sequenceNumber}`, value: `value-${sequenceNumber}`,
        }] : [],
      }));
    }
    const tables = baseTables({ canonEvents: rows });
    const { ctx, canonRowsRead } = recordingCtx(tables);
    await handler._handler(ctx, { worldId: WORLD_ID, now: 5_000 });
    expect(canonRowsRead.reduce((total, count) => total + count, 0)).toBeLessThanOrEqual(60);
  });
});

describe('rebuildOnboardingSummary — key-scene redaction reaches outside the tail window (ART-100)', () => {
  it('still redacts a withheld key scene whose source event sits far before the read window', async () => {
    // The major-event pick and the fact harvest both settle within the first page (near the
    // tail, sequence ~300), but the latest episode's key scene narrates a much OLDER event
    // (sequence 5) that the bounded tail window never reads. `withheldEvents` from that window
    // must not be reused to judge this scene — it would wrongly read as "not withheld" simply
    // because the window never saw it.
    const rows = tailLoadedCanonEvents(300);
    rows[5] = canonRow({ sequenceNumber: 5, publicSummary: '', sceneId: WITHHELD_SCENE });
    const payload = await publishedSummary(baseTables({
      canonEvents: rows,
      dailyEpisodes: [{
        worldId: WORLD_ID, worldDay: 3, episodeNumber: 3, status: 'ready',
        episode: { keyScenes: [{ title: '很久以前', summary: REFUSED_NARRATION, sourceEventIds: [eventId(5)] }] },
      }],
      postGenerationSafetyClassifications: [classificationRow(WITHHELD_SCENE, 'withhold')],
    }));
    expect(payload.structured.scene).toBeNull();
    expect(JSON.stringify(payload)).not.toContain('POISONED');
  });

  it('publishes that same key scene once its Scene is allowed — proving the fixture really reaches it', async () => {
    const rows = tailLoadedCanonEvents(300);
    rows[5] = canonRow({ sequenceNumber: 5, publicSummary: '', sceneId: CLEAN_SCENE });
    const payload = await publishedSummary(baseTables({
      canonEvents: rows,
      dailyEpisodes: [{
        worldId: WORLD_ID, worldDay: 3, episodeNumber: 3, status: 'ready',
        episode: { keyScenes: [{ title: '很久以前', summary: SAFE_NARRATION, sourceEventIds: [eventId(5)] }] },
      }],
    }));
    expect(payload.structured.scene).toEqual({ title: '很久以前', summary: SAFE_NARRATION });
  });
});
