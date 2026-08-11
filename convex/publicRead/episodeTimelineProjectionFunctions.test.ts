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
 */
function memoryCtx(tables: Tables) {
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
