/**
 * The Convex WIRING of daily Episode generation (FR-G001, ART-177).
 *
 * This file did not exist, and that is how the defect it fixes survived: `episode.test.ts` covers
 * the pure builder, so nothing ever ran the handler that decides an Episode's safety status and
 * writes its row.
 *
 * What the handler did was store `safetyClassificationId` on the `dailyEpisodes` row and insert
 * the classification NOWHERE. Every Episode in every world therefore carried an id that resolved
 * to nothing, and `overridePostGenerationSafetyLabel` — which looks the classification up by that
 * id — threw `SAFETY_CLASSIFICATION_NOT_FOUND` for all of them. FR-P004 gives an operator the
 * authority to revise that decision; the deployment did not.
 */

import { classifyPostGeneration, isPubliclyShowable } from '../safety/postGeneration';
import { dailyEpisodePublicText, episodeSafetySourceId } from './episode';
import { generateAcceptedEventEpisode } from './episodeFunctions';

const WORLD_ID = 'mistwood';
const WORLD_DAY = 5;
const EPISODE_NUMBER = 5;
const NOW = 1_700_000_000_000;

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };

const handler = generateAcceptedEventEpisode as unknown as Registered;

function memoryCtx(tables: Tables) {
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
          const matched = (tables[table] ?? []).filter((row) =>
            Object.entries(constraints).every(([field, value]) => row[field] === value));
          const chain = (rows: Row[]) => ({
            order: (direction: 'asc' | 'desc') => chain(direction === 'desc' ? [...rows].reverse() : rows),
            take: (n: number) => Promise.resolve(rows.slice(0, n)),
            collect: () => Promise.resolve(rows),
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
    patch() { return Promise.resolve(); },
  };
  return { db } as Parameters<typeof handler._handler>[0];
}

function canonRow(sequenceNumber: number, publicSummary: string): Row {
  return {
    worldId: WORLD_ID,
    worldDay: WORLD_DAY,
    sequenceNumber,
    acceptedAt: 1_000 + sequenceNumber,
    validationVersion: '1',
    traceId: `trace-${sequenceNumber}`,
    payload: {
      schemaVersion: 1, worldId: WORLD_ID, idempotencyKey: `event-${sequenceNumber}`,
      proposedBy: { type: 'system' }, worldDay: WORLD_DAY, timeSlot: 'morning',
      eventType: 'conversation', participantIds: ['zhao-ming', 'he-jun'], causedByEventIds: [],
      publicSummary, stateChanges: [],
    },
  };
}

function baseTables(over: Partial<Tables> = {}): Tables {
  return {
    canonEvents: [
      canonRow(0, '趙明在磨坊翻閱舊帳本。'),
      canonRow(1, '何俊與趙明在磨坊前談了很久。'),
      canonRow(2, '鎮公所宣布水車聽證會。'),
    ],
    storyArcEventClassifications: [],
    worldSecrets: [],
    storyArcProjectionEvents: [],
    dailyEpisodes: [],
    postGenerationSafetyClassifications: [],
    ...over,
  };
}

const generate = (tables: Tables) => handler._handler(memoryCtx(tables), {
  worldId: WORLD_ID, worldDay: WORLD_DAY, episodeNumber: EPISODE_NUMBER, createdAt: NOW,
}) as Promise<{ status: string; episodeNumber: number; deduplicated: boolean }>;

describe('generateAcceptedEventEpisode records its classification in the ledger that governs it', () => {
  it('writes the classification the episode row points at, so the id resolves', async () => {
    const tables = baseTables();
    const result = await generate(tables);
    expect(result.status).toBe('ready');

    const episodeRow = tables.dailyEpisodes[0];
    const classification = tables.postGenerationSafetyClassifications[0];
    expect(classification).toBeDefined();
    // The join `overridePostGenerationSafetyLabel` performs: episode row → classification id →
    // ledger row. It resolved to nothing for every Episode until ART-177.
    expect(classification.classificationId).toBe(episodeRow.safetyClassificationId);
    expect(classification.worldId).toBe(WORLD_ID);
  });

  it('records it against the Episode source id the read models look it up by', async () => {
    // One definition of that id (`episodeSafetySourceId`), because the generator mints it and two
    // read-model rebuilds ask about it, in three different modules.
    const tables = baseTables();
    await generate(tables);
    expect(tables.postGenerationSafetyClassifications[0].sourceId)
      .toBe(episodeSafetySourceId(EPISODE_NUMBER));
  });

  it('is idempotent on the same content, and writes exactly one row', async () => {
    const tables = baseTables();
    await generate(tables);
    await generate(tables);
    // The second call short-circuits on the existing `dailyEpisodes` row, so the ledger keeps one
    // entry. The conflict-checked writer would also have deduplicated it had the call reached.
    expect(tables.postGenerationSafetyClassifications).toHaveLength(1);
  });

  it('records the classification even when the classifier refuses the Episode', async () => {
    // The withheld case is the one an operator is most likely to want to revise, so it must not
    // be the case with no ledger row.
    const tables = baseTables({
      // `CATEGORY_PATTERNS.EXTREME_VIOLENCE_DETAIL` matches `graphic dismemberment`. Written in
      // English because the classifier's patterns are, which is a limitation of the classifier
      // rather than of this test — and one worth seeing stated beside a zh-Hant world.
      canonEvents: [
        canonRow(0, 'The chronicle recorded graphic dismemberment at the mill that night.'),
        canonRow(1, '何俊與趙明在磨坊前談了很久。'),
        canonRow(2, '鎮公所宣布水車聽證會。'),
      ],
    });
    const result = await generate(tables);
    const classification = tables.postGenerationSafetyClassifications[0];
    expect(classification).toBeDefined();
    expect(classification.classificationId).toBe(tables.dailyEpisodes[0].safetyClassificationId);
    // The precondition that makes this case mean what its name says: the classifier really did
    // refuse this text. Without it the case would silently be a second copy of the `ready` one.
    expect(isPubliclyShowable(classification.label as never)).toBe(false);
    expect(result.status).toBe('withheld');
    // A refused Episode stores no body — and still gets its ledger row, which is the point.
    expect(tables.dailyEpisodes[0].episode).toBeUndefined();
  });

  it('decides publish/withhold with the one shared predicate', async () => {
    // `isPubliclyShowable` had ONE production caller while three sites wrote its body by hand,
    // and this was the site that decided whether an Episode is published at all. Asserted as an
    // agreement between the handler's answer and the predicate's, so moving a label across the
    // line moves both or fails here.
    const tables = baseTables();
    const result = await generate(tables);
    const label = tables.postGenerationSafetyClassifications[0].label as never;
    expect(result.status).toBe(isPubliclyShowable(label) ? 'ready' : 'withheld');
    expect(tables.dailyEpisodes[0].status).toBe(result.status);
  });

  it('records the classification the STORED episode text produces, not some other text', () => {
    // Derived independently: the expected classification is computed from the Episode the handler
    // wrote to `dailyEpisodes`, not read back from the handler's own call. A handler that
    // classified one text and stored another would pass every assertion above and fail here.
    const tables = baseTables();
    return generate(tables).then(() => {
      const stored = tables.postGenerationSafetyClassifications[0];
      const episode = tables.dailyEpisodes[0].episode as Parameters<typeof dailyEpisodePublicText>[0];
      const expected = classifyPostGeneration({
        classificationId: String(stored.classificationId),
        worldId: WORLD_ID,
        sourceId: episodeSafetySourceId(EPISODE_NUMBER),
        kind: 'public_artifact',
        text: dailyEpisodePublicText(episode),
        coreFactIds: episode.sourceEventIds,
      });
      expect(stored.classifiedTextHash).toBe(expected.classifiedTextHash);
      expect(stored.label).toBe(expected.label);
      expect(stored.reasonCodes).toEqual(expected.reasonCodes);
    });
  });
});
