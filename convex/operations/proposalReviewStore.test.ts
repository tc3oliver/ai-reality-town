/**
 * Integration test for the FR-K002 review assembly over durable records.
 *
 * `proposalReviewFunctions.ts` is thin: it authorizes, then calls the store
 * helpers exercised here. Driving those helpers against an in-memory Convex
 * `db` double proves "an authorized operator can see the proposal, its
 * validation result, its rejection reason, its trace, its participants, its
 * state changes, its arcs, and its safety label" by execution rather than by
 * reading the wiring — the same approach `opsConsoleControls.test.ts` uses for
 * the FR-K001 controls.
 */

import type { GenericQueryCtx } from 'convex/server';
import type { DataModel } from '../_generated/dataModel';
import { UNCLASSIFIED_REJECTION_CODE } from './proposalReview';
import { listProposalReviews, readProposalReview } from './proposalReviewStore';

type QueryDb = GenericQueryCtx<DataModel>['db'];
type Row = Record<string, unknown> & { _id: string };

/**
 * Minimal in-memory stand-in for the Convex `db` surface these helpers use.
 * `withIndex` is modelled as an equality filter over the fields the caller
 * constrains, which is behaviourally equivalent for the indexes in play.
 */
function createFakeDb() {
  const tables = new Map<string, Row[]>();
  let counter = 0;
  const rowsOf = (table: string): Row[] => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table) as Row[];
  };
  const db = {
    insert(table: string, doc: Record<string, unknown>) {
      const _id = `${table}:${(counter += 1)}`;
      rowsOf(table).push({ ...doc, _id });
      return Promise.resolve(_id);
    },
    query(table: string) {
      return {
        withIndex(_index: string, build?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown) {
          const constraints: [string, unknown][] = [];
          const builder = { eq: (field: string, value: unknown) => { constraints.push([field, value]); return builder; } };
          build?.(builder);
          const matched = () => rowsOf(table).filter((row) => constraints.every(([field, value]) => row[field] === value));
          const cursor = {
            unique() {
              const rows = matched();
              if (rows.length > 1) throw new Error('unique() matched multiple rows');
              return Promise.resolve(rows[0] ?? null);
            },
            collect() { return Promise.resolve(matched()); },
            first() { return Promise.resolve(matched()[0] ?? null); },
            order() { return cursor; },
          };
          return cursor;
        },
      };
    },
    rowsOf,
  };
  return db;
}

type FakeDb = ReturnType<typeof createFakeDb>;
const asDb = (db: FakeDb): QueryDb => db as unknown as QueryDb;

const WORLD = 'mistwood';
const T0 = 1_700_000_000;

type SceneSeed = {
  sceneId: string;
  worldDay: number;
  timeSlot: string;
  status: 'validated' | 'review_required';
  idempotencyKeys: string[];
  arcIds?: string[];
  participantIds?: string[];
  safety?: { label: string; reasonCodes: string[]; warningCodes: string[] };
};

async function seedScene(db: FakeDb, seed: SceneSeed) {
  const participantIds = seed.participantIds ?? ['ada', 'ben'];
  await db.insert('sceneSimulationRuns', {
    schemaVersion: 1,
    worldId: WORLD,
    simulationRunId: `${seed.sceneId}:simulation`,
    groupingRunId: `${WORLD}:day:${seed.worldDay}:grouping`,
    sceneId: seed.sceneId,
    status: seed.status,
    createdAt: T0,
    result: {
      schemaVersion: 1,
      simulationRunId: `${seed.sceneId}:simulation`,
      scene: {
        schemaVersion: 1, sceneId: seed.sceneId, groupingRunId: `${WORLD}:day:${seed.worldDay}:grouping`,
        directorRunId: `${WORLD}:day:${seed.worldDay}:director`, worldId: WORLD,
        worldDay: seed.worldDay, timeSlot: seed.timeSlot, locationId: 'well',
        participantIds, sourceIntentIds: [], arcIds: seed.arcIds ?? ['arc-well'],
        trigger: 'director', dramaticPressure: 'medium',
      },
      output: {
        schemaVersion: 1, sceneId: seed.sceneId, sceneSummary: 'They meet at the well.',
        keyActions: [], dialogueHighlights: [], relationshipChanges: [], knowledgeChanges: [],
        memories: [], rumors: [], continuityWarnings: [],
        proposedEvents: seed.idempotencyKeys.map((idempotencyKey, index) => ({
          schemaVersion: 1, worldId: WORLD, idempotencyKey,
          proposedBy: { type: 'character', id: participantIds[0] },
          worldDay: seed.worldDay, timeSlot: seed.timeSlot, eventType: 'conversation',
          locationId: 'well', participantIds: [participantIds[0]], causedByEventIds: [],
          publicSummary: `Proposal ${index + 1}`,
          stateChanges: [{ type: 'character_location_changed', characterId: participantIds[0], fromLocationId: 'home', toLocationId: 'well' }],
          metadata: { tone: 'tense', prompt: 'SYSTEM: never surface me' },
        })),
      },
      safety: {
        policyVersion: 1, classificationId: `${seed.sceneId}:simulation:safety`, worldId: WORLD,
        sourceId: seed.sceneId, kind: 'scene',
        label: seed.safety?.label ?? 'allow',
        reasonCodes: seed.safety?.reasonCodes ?? [],
        warningCodes: seed.safety?.warningCodes ?? [],
        classifiedTextHash: 'fnv1a32:0000beef',
      },
      reviewStatus: seed.status === 'review_required' ? 'required' : 'not_required',
      attemptCount: 1,
      trace: { provider: 'fake', model: 'fake-model', inputTokens: 120, outputTokens: 80, latencyMs: 42, retryCount: 0 },
    },
  });
}

async function seedCommit(db: FakeDb, idempotencyKey: string, sequenceNumber: number, worldDay: number, timeSlot: string) {
  await db.insert('canonEvents', {
    worldId: WORLD, sequenceNumber, schemaVersion: 1, eventType: 'conversation',
    worldDay, timeSlot, participantIds: ['ada'], causedByEventIds: [],
    payload: {}, validationVersion: 'canon-v1', idempotencyKey,
    traceId: `${WORLD}:day:${worldDay}:slot:${timeSlot}`, acceptedAt: T0 + 100,
  });
}

async function seedFailedRun(db: FakeDb, worldDay: number, timeSlot: string, over: Record<string, unknown> = {}) {
  await db.insert('worldDayRuns', {
    runId: `${WORLD}:day:${worldDay}:slot:${timeSlot}`, worldId: WORLD, worldDay, timeSlot,
    status: 'failed', attemptCount: 1, failureStage: 'validate_canon',
    errorCode: 'TELEPORTATION_NOT_ALLOWED', errorMessage: 'ada cannot move from home to well',
    createdAt: T0, updatedAt: T0 + 10, ...over,
  });
}

async function seedTrace(db: FakeDb, over: Record<string, unknown> = {}) {
  await db.insert('llmTraces', {
    schemaVersion: 1, traceId: `${WORLD}:trace:1`, worldId: WORLD, worldDay: 3,
    runId: `${WORLD}:day:3:slot:noon`, sceneId: 'scene-noon', arcId: 'arc-well',
    characterIds: ['ada', 'ben'], model: 'fake-model', promptVersion: 'v1',
    inputTokens: 120, outputTokens: 80, latencyMs: 42, retryCount: 0,
    validationResult: 'passed', finalStatus: 'succeeded', recordedAt: T0, ...over,
  });
}

describe('FR-K002 AC#1: a committed proposal reviews as accepted', () => {
  it('assembles the proposal, validation result, trace, participants, state changes, arcs, and safety label', async () => {
    const db = createFakeDb();
    await seedScene(db, { sceneId: 'scene-noon', worldDay: 3, timeSlot: 'noon', status: 'validated', idempotencyKeys: ['k-1'] });
    await seedCommit(db, 'k-1', 7, 3, 'noon');
    await seedTrace(db);
    await db.insert('storyArcEventClassifications', {
      schemaVersion: 1, worldId: WORLD, sourceEventId: `${WORLD}#event#7`, sourceEventSequenceNumber: 7,
      memberships: [{ arcId: 'arc-debt', primary: true }], newArc: null, createdAt: T0,
    });

    const record = await readProposalReview(asDb(db), { worldId: WORLD, role: 'operator', idempotencyKey: 'k-1' });

    expect(record).toMatchObject({
      worldId: WORLD, idempotencyKey: 'k-1', sceneId: 'scene-noon', worldDay: 3, timeSlot: 'noon',
      disposition: 'committed', validationResult: 'accepted', rejectionReasonCode: null,
    });
    expect(record?.commit).toEqual({
      eventId: 'mistwood#event#7', sequenceNumber: 7, validationVersion: 'canon-v1',
      traceId: 'mistwood:day:3:slot:noon', acceptedAt: T0 + 100,
    });
    expect(record?.participantIds).toEqual(['ada', 'ben']);
    expect(record?.stateChanges).toEqual([
      { type: 'character_location_changed', characterId: 'ada', fromLocationId: 'home', toLocationId: 'well' },
    ]);
    expect(record?.relatedArcIds).toEqual(['arc-well', 'arc-debt']);
    expect(record?.safety.label).toBe('allow');
    expect(record?.modelTrace).toMatchObject({ traceId: 'mistwood:trace:1', model: 'fake-model', promptVersion: 'v1' });
    expect(record?.providerTrace).toMatchObject({ provider: 'fake', model: 'fake-model' });
  });

  it('reports accepted Canon even when the same slot also recorded a failure', async () => {
    const db = createFakeDb();
    await seedScene(db, { sceneId: 'scene-noon', worldDay: 3, timeSlot: 'noon', status: 'validated', idempotencyKeys: ['k-1', 'k-2'] });
    await seedCommit(db, 'k-1', 7, 3, 'noon');
    await seedFailedRun(db, 3, 'noon');

    const records = await listProposalReviews(asDb(db), { worldId: WORLD, role: 'operator' });
    expect(records.map(({ idempotencyKey, disposition }) => [idempotencyKey, disposition])).toEqual([
      ['k-1', 'committed'],
      ['k-2', 'rejected'],
    ]);
  });
});

describe('FR-K002 AC#3: a rejected proposal reviews with its stable reason code', () => {
  it('reports the recorded canon error code and stage, and never the free-text message', async () => {
    const db = createFakeDb();
    await seedScene(db, { sceneId: 'scene-noon', worldDay: 3, timeSlot: 'noon', status: 'validated', idempotencyKeys: ['k-1'] });
    await seedFailedRun(db, 3, 'noon');

    const record = await readProposalReview(asDb(db), { worldId: WORLD, role: 'operator', idempotencyKey: 'k-1' });

    expect(record).toMatchObject({
      disposition: 'rejected', validationResult: 'rejected',
      rejectionReasonCode: 'TELEPORTATION_NOT_ALLOWED', rejectionStage: 'validate_canon',
    });
    expect(JSON.stringify(record)).not.toContain('cannot move from home');
  });

  it('collapses a failure recorded without a machine code to the placeholder', async () => {
    const db = createFakeDb();
    await seedScene(db, { sceneId: 'scene-noon', worldDay: 3, timeSlot: 'noon', status: 'validated', idempotencyKeys: ['k-1'] });
    await seedFailedRun(db, 3, 'noon', { errorCode: undefined });

    const record = await readProposalReview(asDb(db), { worldId: WORLD, role: 'operator', idempotencyKey: 'k-1' });
    expect(record?.rejectionReasonCode).toBe(UNCLASSIFIED_REJECTION_CODE);
  });

  it('reports a proposal whose slot never failed as pending, not rejected', async () => {
    const db = createFakeDb();
    await seedScene(db, { sceneId: 'scene-noon', worldDay: 3, timeSlot: 'noon', status: 'validated', idempotencyKeys: ['k-1'] });

    const record = await readProposalReview(asDb(db), { worldId: WORLD, role: 'operator', idempotencyKey: 'k-1' });
    expect(record).toMatchObject({ disposition: 'pending', validationResult: 'not_run', rejectionReasonCode: null });
  });

  it('does not attribute another slot\'s failure to this proposal', async () => {
    const db = createFakeDb();
    await seedScene(db, { sceneId: 'scene-noon', worldDay: 3, timeSlot: 'noon', status: 'validated', idempotencyKeys: ['k-1'] });
    await seedFailedRun(db, 3, 'night');

    const record = await readProposalReview(asDb(db), { worldId: WORLD, role: 'operator', idempotencyKey: 'k-1' });
    expect(record?.disposition).toBe('pending');
  });
});

describe('FR-K002: a safety-withheld scene reviews as withheld with its safety label', () => {
  it('reports the safety label, reason codes, and warning codes', async () => {
    const db = createFakeDb();
    await seedScene(db, {
      sceneId: 'scene-night', worldDay: 3, timeSlot: 'night', status: 'review_required', idempotencyKeys: ['k-9'],
      safety: { label: 'withhold', reasonCodes: ['EXTREME_VIOLENCE_DETAIL'], warningCodes: ['NON_GRAPHIC_VIOLENCE'] },
    });

    const record = await readProposalReview(asDb(db), { worldId: WORLD, role: 'operator', idempotencyKey: 'k-9' });
    expect(record).toMatchObject({
      disposition: 'withheld', validationResult: 'not_run',
      rejectionReasonCode: 'EXTREME_VIOLENCE_DETAIL', rejectionStage: 'safety',
    });
    expect(record?.safety).toMatchObject({
      label: 'withhold', reasonCodes: ['EXTREME_VIOLENCE_DETAIL'], warningCodes: ['NON_GRAPHIC_VIOLENCE'],
    });
  });

  it('fails closed when a persisted safety decision is unreadable', async () => {
    const db = createFakeDb();
    await seedScene(db, { sceneId: 'scene-noon', worldDay: 3, timeSlot: 'noon', status: 'validated', idempotencyKeys: ['k-1'] });
    const row = db.rowsOf('sceneSimulationRuns')[0];
    (row.result as { safety: unknown }).safety = { label: 'not-a-label' };

    const record = await readProposalReview(asDb(db), { worldId: WORLD, role: 'operator', idempotencyKey: 'k-1' });
    // An unreadable safety decision is never evidence that content was safe.
    expect(record?.safety.label).toBe('human_review_required');
  });
});

describe('FR-K002 AC#2: the assembled response is filterable and secret-safe', () => {
  async function seedWorld(db: FakeDb) {
    await seedScene(db, { sceneId: 'scene-noon', worldDay: 3, timeSlot: 'noon', status: 'validated', idempotencyKeys: ['k-1'] });
    await seedScene(db, {
      sceneId: 'scene-night', worldDay: 4, timeSlot: 'night', status: 'review_required', idempotencyKeys: ['k-2'],
      arcIds: ['arc-debt'], participantIds: ['cara'],
      safety: { label: 'withhold', reasonCodes: ['HATE_OR_DEHUMANIZATION'], warningCodes: [] },
    });
    await seedCommit(db, 'k-1', 7, 3, 'noon');
    await seedTrace(db);
  }

  it('returns the newest world day first and filters by day, disposition, arc, and participant', async () => {
    const db = createFakeDb();
    await seedWorld(db);
    const all = await listProposalReviews(asDb(db), { worldId: WORLD, role: 'operator' });
    expect(all.map(({ idempotencyKey }) => idempotencyKey)).toEqual(['k-2', 'k-1']);

    const byDay = await listProposalReviews(asDb(db), { worldId: WORLD, role: 'operator', filter: { worldDay: 3 } });
    expect(byDay.map(({ idempotencyKey }) => idempotencyKey)).toEqual(['k-1']);

    const withheld = await listProposalReviews(asDb(db), { worldId: WORLD, role: 'operator', filter: { disposition: 'withheld' } });
    expect(withheld.map(({ idempotencyKey }) => idempotencyKey)).toEqual(['k-2']);

    const byArc = await listProposalReviews(asDb(db), { worldId: WORLD, role: 'operator', filter: { arcId: 'arc-debt' } });
    expect(byArc.map(({ idempotencyKey }) => idempotencyKey)).toEqual(['k-2']);

    const byParticipant = await listProposalReviews(asDb(db), { worldId: WORLD, role: 'operator', filter: { participantId: 'ben' } });
    expect(byParticipant.map(({ idempotencyKey }) => idempotencyKey)).toEqual(['k-1']);
  });

  it('bounds the page', async () => {
    const db = createFakeDb();
    await seedWorld(db);
    expect(await listProposalReviews(asDb(db), { worldId: WORLD, role: 'operator', limit: 1 })).toHaveLength(1);
  });

  it('never leaks a provider-smuggled prompt, for any role', async () => {
    const db = createFakeDb();
    await seedWorld(db);
    for (const role of ['viewer', 'operator', 'admin'] as const) {
      const records = await listProposalReviews(asDb(db), { worldId: WORLD, role });
      expect(JSON.stringify(records)).not.toContain('SYSTEM: never surface me');
    }
  });

  it('gives a read-only viewer only the public trace projection', async () => {
    const db = createFakeDb();
    await seedWorld(db);
    const [record] = await listProposalReviews(asDb(db), { worldId: WORLD, role: 'viewer', filter: { worldDay: 3 } });
    expect(record.modelTrace).toEqual({
      schemaVersion: 1, traceId: 'mistwood:trace:1', worldId: WORLD, worldDay: 3, finalStatus: 'succeeded',
    });
    expect(record.proposedEvent.metadata).toBeUndefined();
  });

  it('scopes every read to the requested world', async () => {
    const db = createFakeDb();
    await seedWorld(db);
    expect(await listProposalReviews(asDb(db), { worldId: 'other-world', role: 'admin' })).toEqual([]);
    expect(await readProposalReview(asDb(db), { worldId: 'other-world', role: 'admin', idempotencyKey: 'k-1' })).toBeNull();
  });

  it('returns null for an unknown proposal rather than throwing', async () => {
    const db = createFakeDb();
    await seedWorld(db);
    expect(await readProposalReview(asDb(db), { worldId: WORLD, role: 'admin', idempotencyKey: 'no-such-key' })).toBeNull();
  });

  it('correlates the trace by run when no scene-scoped trace exists', async () => {
    const db = createFakeDb();
    await seedScene(db, { sceneId: 'scene-noon', worldDay: 3, timeSlot: 'noon', status: 'validated', idempotencyKeys: ['k-1'] });
    await seedFailedRun(db, 3, 'noon');
    await seedTrace(db, { sceneId: 'some-other-scene', worldDay: 99 });

    const record = await readProposalReview(asDb(db), { worldId: WORLD, role: 'admin', idempotencyKey: 'k-1' });
    expect(record?.modelTrace).toMatchObject({ runId: 'mistwood:day:3:slot:noon' });
  });

  it('reports no trace rather than an unrelated one', async () => {
    const db = createFakeDb();
    await seedScene(db, { sceneId: 'scene-noon', worldDay: 3, timeSlot: 'noon', status: 'validated', idempotencyKeys: ['k-1'] });
    await seedTrace(db, { sceneId: 'some-other-scene', worldDay: 3, runId: 'unrelated-run' });

    const record = await readProposalReview(asDb(db), { worldId: WORLD, role: 'admin', idempotencyKey: 'k-1' });
    expect(record?.modelTrace).toBeNull();
  });

  it('skips a scene that produced no proposals', async () => {
    const db = createFakeDb();
    await seedScene(db, { sceneId: 'scene-empty', worldDay: 3, timeSlot: 'noon', status: 'validated', idempotencyKeys: [] });
    expect(await listProposalReviews(asDb(db), { worldId: WORLD, role: 'admin' })).toEqual([]);
  });
});
