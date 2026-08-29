/**
 * The safety gate on the public Timeline projection (ART-124, extending FR-P004 / ART-132).
 *
 * The Timeline is a public TEXT surface — every entry carries an accepted event's
 * `publicSummary` — and it had no safety gate at all. ART-132 redacted withheld summaries out of
 * the `liveState` model and the Visual Replay, but `rebuildTimelineProjection` copied the same
 * sentences straight off the Canon rows. So a Scene an operator had withheld went on narrating
 * itself here indefinitely, on the character page's "recent major events" list and — once
 * ART-124 wired the same read into the live map — on the character card this task builds.
 *
 * Handler-level, following the pattern `safetyOverrideFunctions.test.ts` established: the
 * registered mutation's `_handler` runs against a fake `ctx`, so the join, the redaction and the
 * publish are exercised as they actually run. The assertion is deliberately made on the
 * PUBLISHED PAYLOAD rather than on an intermediate value: the whole point of gating at rebuild
 * time is that the refused sentence is never written down, and only the payload can show that.
 */

import { rebuildTimelineProjection } from './episodeTimelineProjectionFunctions';
import { rowToAcceptedEvent } from '../canon/serialize';
import { buildTimelineProjection, type TimelineEntryInput, type TimelineProjection } from './episodeTimelineProjection';

const WORLD_ID = 'mistwood';
const CLEAN_SCENE = 'mistwood:3:morning:grouping:scene:1';
const WITHHELD_SCENE = 'mistwood:3:evening:grouping:scene:2';

const SAFE_SUMMARY = '眾人在磨坊前簽下休戰。';
const REFUSED_SUMMARY = 'POISONED: 一段安全分類器拒絕發佈的場景敘述。';

/** Above `TIMELINE_MAJOR_IMPORTANCE`, so both events survive the major-event filter. */
const MAJOR = 5;

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const handler = rebuildTimelineProjection as unknown as Registered;

/**
 * The slice of Convex these handlers use. Index constraints are `eq` chains, so filtering by the
 * captured constraints reproduces them; `createdAt` ordering is modelled because
 * `readWithheldSceneLabels` reads the override ledger through it.
 *
 * `reads`, when supplied, tallies document reads per table (ART-100) — the same optional
 * accounting `relationshipGraphProjectionFunctions.test.ts` added for the same reason: a
 * regression back to an unbounded `collect()` must turn a pinned read-count assertion red rather
 * than pass silently.
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
          const builder = {
            eq(field: string, value: unknown) {
              constraints[field] = value;
              return builder;
            },
          };
          if (build) build(builder);
          const matched = (tables[table] ?? []).filter((row) =>
            Object.entries(constraints).every(([field, value]) => row[field] === value));
          const ascending = [...matched].sort((left, right) =>
            Number(left.createdAt ?? 0) - Number(right.createdAt ?? 0));
          const chain = (rows: Row[]) => ({
            order: (direction: 'asc' | 'desc') => chain(direction === 'desc' ? [...rows].reverse() : rows),
            take: (count2: number) => Promise.resolve(count(table, rows.slice(0, count2))),
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
  return { db } as Parameters<typeof handler._handler>[0];
}

function canonRow(sequenceNumber: number, publicSummary: string, sceneId?: string): Row {
  return {
    worldId: WORLD_ID,
    sequenceNumber,
    acceptedAt: 1_000 + sequenceNumber,
    validationVersion: '1',
    traceId: `trace-${sequenceNumber}`,
    payload: {
      schemaVersion: 1,
      worldId: WORLD_ID,
      idempotencyKey: `event-${sequenceNumber}`,
      proposedBy: { type: 'system' },
      worldDay: 3,
      timeSlot: 'evening',
      eventType: 'conversation',
      participantIds: ['zhao-ming', 'he-jun'],
      causedByEventIds: [],
      publicSummary,
      stateChanges: [],
      ...(sceneId === undefined ? {} : { metadata: { sceneId } }),
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

/** Two major events, one per Scene, plus the arc classifications that make them major. */
function baseTables(over: Partial<Tables> = {}): Tables {
  return {
    canonEvents: [
      canonRow(0, SAFE_SUMMARY, CLEAN_SCENE),
      canonRow(1, REFUSED_SUMMARY, WITHHELD_SCENE),
    ],
    storyArcEventClassifications: [
      { worldId: WORLD_ID, sourceEventSequenceNumber: 0, memberships: [{ arcId: 'arc-mill', importance: MAJOR }] },
      { worldId: WORLD_ID, sourceEventSequenceNumber: 1, memberships: [{ arcId: 'arc-mill', importance: MAJOR }] },
    ],
    dailyEpisodes: [],
    postGenerationSafetyClassifications: [],
    safetyStatusOverrides: [],
    publishedReadModels: [],
    ...over,
  };
}

async function publishedTimeline(tables: Tables) {
  await handler._handler(memoryCtx(tables), { worldId: WORLD_ID, now: 5_000 });
  const row = (tables.publishedReadModels ?? []).at(-1);
  expect(row).toBeDefined();
  return row!.payload as { entries: Array<{ eventId: string; publicSummary: string | null }> };
}

describe('rebuildTimelineProjection — a withheld Scene never narrates itself on the timeline', () => {
  it('publishes both summaries when nothing is refused', async () => {
    const payload = await publishedTimeline(baseTables());
    expect(payload.entries.map((entry) => entry.publicSummary))
      .toEqual([SAFE_SUMMARY, REFUSED_SUMMARY]);
  });

  it('drops the summary of an event whose Scene the classifier refused', async () => {
    const payload = await publishedTimeline(baseTables({
      postGenerationSafetyClassifications: [
        classificationRow(CLEAN_SCENE, 'allow'),
        classificationRow(WITHHELD_SCENE, 'withhold'),
      ],
    }));
    // The entry SURVIVES, and loses only its text: the event happened, and dropping the row
    // would silently renumber a public history.
    expect(payload.entries).toHaveLength(2);
    expect(payload.entries[1].publicSummary).toBeNull();
    // ...and the refused sentence was never written into the payload at all, which is the
    // property that read-time filtering could not give.
    expect(JSON.stringify(payload)).not.toContain('POISONED');
    // The clean Scene is untouched — the gate is per-Scene, not per-world.
    expect(payload.entries[0].publicSummary).toBe(SAFE_SUMMARY);
  });

  it('drops it after an operator override withholds a Scene the classifier had allowed', async () => {
    // The live case, and the one this gap actually leaked: a Scene is published, a viewer
    // reports it, an operator withholds it — and the timeline went on serving the sentence.
    const payload = await publishedTimeline(baseTables({
      postGenerationSafetyClassifications: [
        classificationRow(CLEAN_SCENE, 'allow'),
        classificationRow(WITHHELD_SCENE, 'allow'),
      ],
      safetyStatusOverrides: [overrideRow(WITHHELD_SCENE, 'withhold', 2_000)],
    }));
    expect(payload.entries[1].publicSummary).toBeNull();
    expect(JSON.stringify(payload)).not.toContain('POISONED');
  });

  it('restores it when a later override releases the Scene', async () => {
    const payload = await publishedTimeline(baseTables({
      postGenerationSafetyClassifications: [
        classificationRow(CLEAN_SCENE, 'allow'),
        classificationRow(WITHHELD_SCENE, 'withhold'),
      ],
      safetyStatusOverrides: [overrideRow(WITHHELD_SCENE, 'allow', 3_000)],
    }));
    expect(payload.entries[1].publicSummary).toBe(REFUSED_SUMMARY);
  });

  it('treats human_review_required as withholding, exactly as the dynamic surface does', async () => {
    const payload = await publishedTimeline(baseTables({
      postGenerationSafetyClassifications: [classificationRow(WITHHELD_SCENE, 'human_review_required')],
    }));
    expect(payload.entries[1].publicSummary).toBeNull();
  });

  it('does NOT redact an event with no resolvable Scene provenance', async () => {
    // ART-132's convention: Canon carries seed, system and remediation events no classifier ever
    // examined, plus everything accepted before provenance was stamped. Silence means "never in
    // scope", not "refused" — reading it as refusal would blank the public history wholesale.
    const tables = baseTables({
      canonEvents: [canonRow(0, SAFE_SUMMARY), canonRow(1, REFUSED_SUMMARY)],
      postGenerationSafetyClassifications: [classificationRow(WITHHELD_SCENE, 'withhold')],
    });
    const payload = await publishedTimeline(tables);
    expect(payload.entries.map((entry) => entry.publicSummary))
      .toEqual([SAFE_SUMMARY, REFUSED_SUMMARY]);
  });

  it('redacts by event id, so a refusal cannot be applied to its neighbour', async () => {
    // Keyed on the event id rather than on a position in a parallel array. Asserted by putting
    // the refused Scene FIRST, where an off-by-one would silently redact the wrong row.
    const payload = await publishedTimeline(baseTables({
      canonEvents: [
        canonRow(0, REFUSED_SUMMARY, WITHHELD_SCENE),
        canonRow(1, SAFE_SUMMARY, CLEAN_SCENE),
      ],
      postGenerationSafetyClassifications: [classificationRow(WITHHELD_SCENE, 'withhold')],
    }));
    expect(payload.entries[0].publicSummary).toBeNull();
    expect(payload.entries[1].publicSummary).toBe(SAFE_SUMMARY);
  });
});

/**
 * ART-100: bounding the Canon read to the events that can ever qualify.
 *
 * `rebuildTimelineProjection` used to `collect()` the world's whole `canonEvents` log on every
 * call — one of the last full-replay sites on the post-commit path, since this rebuild runs after
 * every accepted event (`postCommitLive.ts` stage 19). It now reads only the Canon rows for
 * sequence numbers `storyArcEventClassifications` (read in full regardless, unchanged by this
 * task) already shows as clearing `TIMELINE_MAJOR_IMPORTANCE` — the same WINDOW pattern
 * `relationshipArcProjectionFunctions.ts` uses for `rebuildArcProjection`.
 *
 * `entries` is still rebuilt from scratch on every call (no append, no cache), so the tests below
 * exercise the three retroactive surfaces the task named: a reclassification of an old event
 * crossing the threshold in either direction, and an episode renumbering changing a past
 * `episodeNumber`. Both must be visible on the very next rebuild, exactly as a full replay would
 * show them — nothing here is diffed against the prior publish.
 */
describe('ART-100: bounding the Canon read to the events that can ever qualify', () => {
  /** Ten events, five per world day, none carrying Scene provenance (redaction is out of scope here). */
  function dayEventRow(sequenceNumber: number, worldDay: number): Row {
    return {
      worldId: WORLD_ID,
      sequenceNumber,
      acceptedAt: 1_000 + sequenceNumber,
      validationVersion: '1',
      traceId: `trace-${sequenceNumber}`,
      payload: {
        schemaVersion: 1,
        worldId: WORLD_ID,
        idempotencyKey: `event-${sequenceNumber}`,
        proposedBy: { type: 'system' },
        worldDay,
        timeSlot: 'morning',
        eventType: 'conversation',
        participantIds: ['zhao-ming', 'he-jun'],
        causedByEventIds: [],
        publicSummary: `summary-${sequenceNumber}`,
        stateChanges: [],
      },
    };
  }

  function arcMembershipRow(sequenceNumber: number, importance: number): Row {
    return {
      worldId: WORLD_ID,
      sourceEventSequenceNumber: sequenceNumber,
      memberships: [{ arcId: 'arc-mill', importance }],
    };
  }

  function dailyEpisodeRow(worldDay: number, episodeNumber: number): Row {
    return {
      schemaVersion: 1, worldId: WORLD_ID, worldDay, episodeNumber, status: 'ready',
      episode: { keyScenes: [] }, sourceEventIds: [], createdAt: 1_000,
    };
  }

  /** sequences 1, 2, 4, 5, 7, 9 are deliberately never classified major. */
  function fixtureTables(over: Partial<Tables> = {}): Tables {
    return {
      canonEvents: Array.from({ length: 10 }, (_unused, sequenceNumber) =>
        dayEventRow(sequenceNumber, sequenceNumber < 5 ? 1 : 2)),
      storyArcEventClassifications: [
        arcMembershipRow(0, 5), arcMembershipRow(1, 0.3), arcMembershipRow(3, 5), arcMembershipRow(6, 5), arcMembershipRow(8, 0.2),
      ],
      dailyEpisodes: [dailyEpisodeRow(1, 1), dailyEpisodeRow(2, 2)],
      postGenerationSafetyClassifications: [],
      safetyStatusOverrides: [],
      publishedReadModels: [],
      ...over,
    };
  }

  async function publish(tables: Tables, reads?: Record<string, number>): Promise<TimelineProjection> {
    await handler._handler(memoryCtx(tables, reads), { worldId: WORLD_ID, now: 5_000 });
    const row = (tables.publishedReadModels ?? []).at(-1);
    expect(row).toBeDefined();
    return row!.payload as TimelineProjection;
  }

  /**
   * The full-replay reference (AC#3): every Canon row is considered and handed to the SAME
   * `buildTimelineProjection` the handler uses, unfiltered — the threshold filter lives inside
   * the builder, not here. This is independent of the handler's bounded read strategy, so
   * matching it is evidence the acceleration changed nothing observable.
   */
  function referencePayload(tables: Tables): TimelineProjection {
    const membershipsBySequence = new Map(
      (tables.storyArcEventClassifications ?? []).map((row) =>
        [row.sourceEventSequenceNumber as number, row.memberships as Array<{ arcId: string; importance: number }>]),
    );
    const episodeNumberByDay = new Map(
      (tables.dailyEpisodes ?? [])
        .filter((row) => row.episode)
        .map((row) => [row.worldDay as number, row.episodeNumber as number]),
    );
    const entries: TimelineEntryInput[] = (tables.canonEvents ?? []).map((row) => {
      const event = rowToAcceptedEvent(row as Parameters<typeof rowToAcceptedEvent>[0]);
      const memberships = membershipsBySequence.get(row.sequenceNumber as number) ?? [];
      const importance = memberships.reduce((max, membership) => Math.max(max, membership.importance), 0);
      return {
        eventId: event.eventId, worldDay: event.worldDay, timeSlot: event.timeSlot, eventType: event.eventType,
        publicSummary: event.publicSummary ?? null, importance,
        arcIds: memberships.map((membership) => membership.arcId), characterIds: [...event.participantIds],
        episodeNumber: episodeNumberByDay.get(event.worldDay) ?? null,
      };
    });
    return buildTimelineProjection({ worldId: WORLD_ID, entries });
  }

  it('publishes a payload identical to a full replay over the same canon prefix', async () => {
    const tables = fixtureTables();
    const expected = referencePayload(tables);
    const payload = await publish(tables);
    expect(payload).toEqual(expected);
    // Sanity: the fixture actually exercises both sides of the threshold, across both days.
    expect(payload.entries.map((entry) => entry.eventId)).toEqual([
      'mistwood#event#0', 'mistwood#event#3', 'mistwood#event#6',
    ]);
  });

  it('reads Canon rows only for the events that clear the major-event threshold', async () => {
    const many = Array.from({ length: 200 }, (_unused, sequenceNumber) => dayEventRow(sequenceNumber, 1));
    // Every 20th event is major; the rest sit below the threshold. 10 qualify out of 200.
    const classifications = many.map((_row, sequenceNumber) =>
      arcMembershipRow(sequenceNumber, sequenceNumber % 20 === 0 ? 5 : 0.1));
    const tables = fixtureTables({
      canonEvents: many,
      storyArcEventClassifications: classifications,
      dailyEpisodes: [dailyEpisodeRow(1, 1)],
    });

    const reads: Record<string, number> = {};
    await publish(tables, reads);

    expect(reads.canonEvents).toBe(10);
    expect(reads.canonEvents).toBeLessThan(many.length);
  });

  it('picks up a reclassification that pushes an old event across the threshold, in both directions', async () => {
    const tables = fixtureTables({
      storyArcEventClassifications: [arcMembershipRow(0, 5), arcMembershipRow(3, 0.2)],
    });
    const before = await publish(tables);
    expect(before.entries.map((entry) => entry.eventId)).not.toContain('mistwood#event#3');

    // A retroactive reclassification of an OLD event (ART-124/`reassessArcEntries`'s own case),
    // pushing it up across the threshold.
    tables.storyArcEventClassifications = [arcMembershipRow(0, 5), arcMembershipRow(3, 5)];
    const afterUp = await publish(tables);
    expect(afterUp.entries.map((entry) => entry.eventId)).toContain('mistwood#event#3');

    // And back down — the entry must be able to leave the Timeline too, not just join it.
    tables.storyArcEventClassifications = [arcMembershipRow(0, 5), arcMembershipRow(3, 0.1)];
    const afterDown = await publish(tables);
    expect(afterDown.entries.map((entry) => entry.eventId)).not.toContain('mistwood#event#3');
  });

  it('picks up an episode renumbering for a past world day', async () => {
    const tables = fixtureTables({
      storyArcEventClassifications: [arcMembershipRow(0, 5)],
      dailyEpisodes: [dailyEpisodeRow(1, 1)],
    });
    const before = await publish(tables);
    expect(before.entries[0].episodeNumber).toBe(1);

    // The episode this world day narrates gets renumbered — a real thing `episodeNumberFor`
    // does when an earlier day's episode generation is retried out of order.
    tables.dailyEpisodes = [dailyEpisodeRow(1, 7)];
    const after = await publish(tables);
    expect(after.entries[0].episodeNumber).toBe(7);
  });
});
