/**
 * Rung 5 of the FR-M004 ladder at the recap stage: 「延後非必要摘要」 (ART-91).
 *
 * The whole decision is which tiers a degraded world may skip, and the interesting half is the one
 * it may NOT. `episode` is not deferrable: the Episode is the day's public record and the artifact
 * the FR-M002 coverage gate obliges, so deferring it would leave a world day of accepted Canon that
 * no published content accounts for — which §16.2 counts as a coverage failure. Degradation must
 * not manufacture the exact gap the quality metrics exist to detect. Every case below therefore
 * asserts the presence of `episode` alongside the absence of the four deferred tiers; asserting
 * only the absences would pass just as well for a stage that deferred everything.
 *
 * Two levels of evidence, because they can disagree:
 *
 *  1. `deriveRecapTargets` directly, which is where the filter lives;
 *  2. the REAL `recap` stage handler from `createPostCommitStageHandlers`, driven with a port whose
 *     `defersSummaries` answers true and then false. That is what proves the stage consults the
 *     flag at all — a filter that is never called is invisible to a unit test of the filter.
 *
 * Skipping a tier needs no backfill queue and none is asserted, because there is nothing to assert:
 * a skipped tier's cursor is left where it was, so the next non-deferred run covers the same range.
 * The cursor IS the backlog.
 */

import type { AcceptedEvent } from '../canon/model';
import { CANON_VALIDATION_VERSION } from '../shared/constants';
import { deriveEventId } from '../shared/ids';
import type { StageContext } from './postCommitOrchestration';
import {
  DEFERRABLE_RECAP_TYPES,
  createPostCommitStageHandlers,
  deriveRecapTargets,
  postCommitRunId,
  recapTargetKey,
  seasonOf,
  type ArcArtifact,
  type PostCommitLivePort,
  type PostCommitWorldState,
  type RecapArtifact,
  type RecapRequest,
  type RecapTarget,
} from './postCommitLive';

const WORLD_ID = 'mistwood-public';
const WORLD_DAY = 3;
const SEQUENCE = 40;
const ARC_IDS = ['arc-ledger', 'arc-water'];

const sourceEvent = (): AcceptedEvent => ({
  schemaVersion: 1,
  worldId: WORLD_ID,
  idempotencyKey: `slot:${WORLD_ID}:${WORLD_DAY}:noon:1`,
  proposedBy: { type: 'director' },
  worldDay: WORLD_DAY,
  timeSlot: 'noon',
  eventType: 'conversation',
  locationId: 'mistwood-hall',
  participantIds: ['gao-wenrui', 'pei-lan'],
  causedByEventIds: [],
  publicSummary: '議會在中午就水道修繕的付款順序交換了意見。',
  stateChanges: [{
    type: 'fact_created',
    subjectType: 'location',
    subjectId: 'mistwood-hall',
    predicate: 'lastCouncilSession',
    value: `${WORLD_DAY}:noon`,
    visibility: 'public',
  }],
  eventId: deriveEventId(WORLD_ID, SEQUENCE),
  acceptedAt: 1_700_000_000_000,
  sequenceNumber: SEQUENCE,
  validationVersion: CANON_VALIDATION_VERSION,
  traceId: `trace-${SEQUENCE}`,
});

/**
 * A hand-built world state. The three origins differ from one another on purpose: a stage that
 * confused the slot origin with the day origin would still produce five targets, and only distinct
 * numbers make the confusion visible.
 */
const worldState = (): PostCommitWorldState => ({
  event: sourceEvent(),
  arcs: [],
  characterIds: ['gao-wenrui', 'pei-lan'],
  completedWorldDays: [0, 1, 2],
  episodeWorldDays: [0, 1, 2],
  worldDayFirstSequenceNumber: 30,
  timeSlotFirstSequenceNumber: 36,
  seasonFirstSequenceNumber: 0,
  latestWorldDay: WORLD_DAY,
  latestWorldDayFinalSlotStarted: false,
});

const typesOf = (targets: readonly RecapTarget[]): string[] => targets.map(({ recapType }) => recapType);

// --- the filter itself -------------------------------------------------------

describe('DEFERRABLE_RECAP_TYPES (FR-M004 rung 5)', () => {
  it('is exactly the four tiers nobody is obliged to publish', () => {
    expect([...DEFERRABLE_RECAP_TYPES].sort()).toEqual(['arc', 'scene', 'season', 'viewer_context']);
  });

  /**
   * The one assertion this file exists for.
   *
   * An unpublished world day is a coverage failure the FR-M002 story-quality evaluator measures
   * against Canon, not against the episodes that were stored — so a deferred Episode would not
   * merely delay content, it would put the world below the §16.2 高重要度摘要覆蓋率 target for a
   * day that can never be recovered by a later cursor pass, because the Episode tier is assembled
   * per world day rather than swept by a watermark. Degradation is allowed to make the world
   * quieter; it is not allowed to make the world unaccounted for.
   */
  it('does not contain episode', () => {
    expect(DEFERRABLE_RECAP_TYPES.has('episode')).toBe(false);
  });
});

describe('deriveRecapTargets defers the right four tiers', () => {
  it('emits the whole pyramid when the world is not degraded', () => {
    const targets = deriveRecapTargets(worldState(), ARC_IDS, false);
    expect(typesOf(targets)).toEqual(['scene', 'episode', 'arc', 'arc', 'season', 'viewer_context']);
    expect(targets).toEqual([
      { recapType: 'scene', targetId: `slot:${WORLD_DAY}:noon`, start: 36 },
      { recapType: 'episode', targetId: `day:${WORLD_DAY}`, start: 30 },
      { recapType: 'arc', targetId: 'arc:arc-ledger', start: 0, arcId: 'arc-ledger' },
      { recapType: 'arc', targetId: 'arc:arc-water', start: 0, arcId: 'arc-water' },
      { recapType: 'season', targetId: `season:${seasonOf(WORLD_DAY)}`, start: 0 },
      { recapType: 'viewer_context', targetId: WORLD_ID, start: 0 },
    ]);
  });

  it('drops scene, arc, season and viewer_context — and keeps episode — when it defers', () => {
    const targets = deriveRecapTargets(worldState(), ARC_IDS, true);
    expect(typesOf(targets)).toEqual(['episode']);
    // The kept target is unchanged, not a reduced version of itself: the day's record is composed
    // over the same range it would have been at full health.
    expect(targets).toEqual([{ recapType: 'episode', targetId: `day:${WORLD_DAY}`, start: 30 }]);
  });

  it('drops exactly the deferrable set and nothing else', () => {
    // Compared by target KEY, not by object identity: the two calls build separate objects, and an
    // identity comparison would report every target as dropped whatever the filter did.
    const key = ({ recapType, targetId }: RecapTarget): string => recapTargetKey(recapType, targetId);
    const full = deriveRecapTargets(worldState(), ARC_IDS, false);
    const deferred = deriveRecapTargets(worldState(), ARC_IDS, true);
    const kept = new Set(deferred.map(key));
    const dropped = full.filter((target) => !kept.has(key(target))).map(({ recapType }) => recapType);
    expect(new Set(dropped)).toEqual(new Set(DEFERRABLE_RECAP_TYPES));
    for (const target of deferred) expect(DEFERRABLE_RECAP_TYPES.has(target.recapType)).toBe(false);
  });

  it('defaults to deferring nothing, so every pre-ART-91 caller is unchanged', () => {
    expect(deriveRecapTargets(worldState(), ARC_IDS)).toEqual(deriveRecapTargets(worldState(), ARC_IDS, false));
  });

  it('still composes the Episode when the degraded day moved no arcs at all', () => {
    expect(typesOf(deriveRecapTargets(worldState(), [], true))).toEqual(['episode']);
  });
});

// --- the real stage, driven through the port ---------------------------------

/**
 * A port carrying only the four methods the `recap` stage calls.
 *
 * The narrowing cast is deliberate rather than a shortcut: every other method is genuinely absent,
 * so a recap stage that reached for one would throw rather than quietly succeed against a stub that
 * returned a plausible empty value.
 */
function recapOnlyPort(defersSummaries: boolean, generated: RecapRequest[]): PostCommitLivePort {
  const port: Pick<PostCommitLivePort,
    'loadWorldState' | 'defersSummaries' | 'loadRecapCursors' | 'generateRecap'> = {
    loadWorldState: () => Promise.resolve(worldState()),
    defersSummaries: () => Promise.resolve(defersSummaries),
    // No prior snapshots: every target starts at its own origin, so nothing is dropped for being
    // already covered and the only thing that can remove a tier is the deferral under test.
    loadRecapCursors: () => Promise.resolve({}),
    generateRecap: (_worldId, request) => {
      generated.push(request);
      return Promise.resolve({ snapshotId: request.snapshotId, deduplicated: false });
    },
  };
  return port as PostCommitLivePort;
}

const arcArtifact = (): ArcArtifact => ({
  classifiedArcIds: ARC_IDS,
  createdArcId: null,
  portfolioDecision: null,
  transitions: [],
  deferredTransitions: [],
  projectionRevisions: [],
  stagnationPromptCount: 0,
  resolutions: [],
});

const stageContext = (): StageContext => ({
  runId: postCommitRunId(WORLD_ID, SEQUENCE),
  worldId: WORLD_ID,
  sourceEventId: deriveEventId(WORLD_ID, SEQUENCE),
  sourceEventSequenceNumber: SEQUENCE,
  worldDay: WORLD_DAY,
  artifacts: { arc: arcArtifact() },
  traceId: `trace-${SEQUENCE}`,
});

async function runRecapStage(defers: boolean): Promise<{ artifact: RecapArtifact; requests: RecapRequest[] }> {
  const requests: RecapRequest[] = [];
  const handlers = createPostCommitStageHandlers(recapOnlyPort(defers, requests));
  const artifact = await handlers.recap(stageContext()) as RecapArtifact;
  return { artifact, requests };
}

describe('the real recap stage honours the world’s degradation level', () => {
  it('generates the whole pyramid for a healthy world', async () => {
    const { artifact, requests } = await runRecapStage(false);
    expect(requests.map(({ recapType }) => recapType))
      .toEqual(['scene', 'episode', 'arc', 'arc', 'season', 'viewer_context']);
    expect(artifact.snapshots.map(({ recapType }) => recapType))
      .toEqual(['scene', 'episode', 'arc', 'arc', 'season', 'viewer_context']);
  });

  it('generates only the Episode for a world on rung 5', async () => {
    const { artifact, requests } = await runRecapStage(true);
    expect(requests.map(({ recapType }) => recapType)).toEqual(['episode']);
    expect(artifact.snapshots.map(({ recapType }) => recapType)).toEqual(['episode']);
  });

  it('generates the episode tier in BOTH cases, over the same range', async () => {
    // The load-bearing comparison. If this ever differs, a degraded day's public record is being
    // composed from something other than the day.
    const healthy = (await runRecapStage(false)).requests.find(({ recapType }) => recapType === 'episode');
    const degraded = (await runRecapStage(true)).requests.find(({ recapType }) => recapType === 'episode');
    expect(healthy).toBeDefined();
    expect(degraded).toEqual(healthy);
    expect(degraded).toMatchObject({
      recapType: 'episode',
      targetId: `day:${WORLD_DAY}`,
      fromSequenceNumber: 30,
      toSequenceNumber: SEQUENCE,
    });
  });

  it('asks for no snapshot at all on the tiers it defers', async () => {
    const { requests } = await runRecapStage(true);
    for (const request of requests) {
      expect(DEFERRABLE_RECAP_TYPES.has(request.recapType)).toBe(false);
    }
    // …and the tiers it skipped are exactly the ones the healthy run produced beyond the Episode.
    const healthy = (await runRecapStage(false)).requests.map(({ recapType }) => recapType);
    expect(healthy.filter((recapType) => DEFERRABLE_RECAP_TYPES.has(recapType)).sort())
      .toEqual(['arc', 'arc', 'scene', 'season', 'viewer_context']);
  });

  it('leaves a deferred tier’s cursor untouched, which is the backfill', async () => {
    // Nothing was generated for `scene`, so nothing advanced its watermark; the next healthy run
    // reads the same cursor key and covers the same range. Asserted as the absence of a snapshot
    // for that key rather than as a queue entry, because there is no queue by design.
    const { artifact } = await runRecapStage(true);
    const sceneKey = recapTargetKey('scene', `slot:${WORLD_DAY}:noon`);
    expect(artifact.snapshots.map(({ recapType, targetId }) => recapTargetKey(recapType, targetId)))
      .not.toContain(sceneKey);
    const healthy = await runRecapStage(false);
    expect(healthy.artifact.snapshots.map(({ recapType, targetId }) => recapTargetKey(recapType, targetId)))
      .toContain(sceneKey);
  });
});
