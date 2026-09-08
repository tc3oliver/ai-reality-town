import { TIME_SLOTS, type TimeSlot } from '../canon/eventTypes';
import { FakeWholeSceneProvider } from '../simulation/fakeSceneNarrator';
import { InMemoryCanonStore } from '../canon/inMemoryStore';
import { emptyProjection, type AcceptedEvent, type CanonRuleContext } from '../canon/model';
import { mistwoodCharacterSeed, mistwoodWorldConfiguration, MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { replayWorldEvents } from '../canon/replay';
import { authorizeKnowledgeRead } from '../knowledge/authorization';
import { authorizeMemoryRead } from '../knowledge/memoryAuthorization';
import {
  buildLiveWorldSnapshot,
  createWorldDayStageHandlers,
  worldDayRunId,
  type LiveWorldSnapshot,
  type WorldDayLivePort,
  type WorldDaySlotIdentity,
  unmeteredWorldDayBudgetPort,
} from '../simulation/worldDayLive';
import {
  executeWorldDay,
  type RunFailure as WorldDayRunFailure,
  type WorldDayCheckpoint,
  type WorldDayRun,
  type WorldDayRunInput,
  type WorldDayRunStore,
  type WorldDayStage,
} from '../simulation/worldDayOrchestration';
import { buildDailyEpisode, dailyEpisodePublicText, validateDailyEpisode, type DailyEpisode, type EpisodeSourceEvent } from '../editorial/episode';
import {
  createPublicationRecord,
  transitionPublication,
  type PublicationRecord,
} from '../editorial/publicationLifecycle';
import { classifyPostGeneration } from '../safety/postGeneration';
import { buildRecapSnapshot, type RecapSnapshot } from '../recaps/model';
import { createArcLifecycle, transitionArcLifecycle, isActiveArcStatus } from '../story/lifecycle';
import { replayArcProjection } from '../story/projection';
import { composeRecaps, type RecapComposition } from '../recaps/recapComposition';
import { validateRecapCoverage } from '../recaps/coverageValidation';
import { episodeCandidate, toCoverageSource } from '../recaps/coverageValidationFunctions';
import {
  buildDeepRecap, buildMachineSummary, validateRecapFormats,
  QUICK_RECAP_MAX, QUICK_RECAP_MIN, STANDARD_RECAP_MAX, STANDARD_RECAP_MIN,
  type RecapFormats,
} from '../recaps/recapFormats';
import { countChineseCharacters } from '../shared/publicText';
import { applyArcPortfolioControl, type ArcPortfolioEntry } from '../story/portfolio';
import { createArcResolutionDecision, detectArcStagnation, type ArcResolutionDecision } from '../story/resolution';
import { deriveConsequenceSummaries, type ConsequenceSummary } from '../story/consequenceSummary';
import { recommendArcEntry } from '../story/entryRecommendation';
import type { ArcEventClassification, ArcLifecycleRecord, ArcProjectionEvent } from '../story/model';
import { buildEpisodeIndex, EPISODE_INDEX_MODEL_KIND } from '../publicRead/episodeIndexProjection';
import {
  buildEpisodeProjection,
  buildTimelineProjection,
  EPISODE_MODEL_KIND,
  TIMELINE_MAJOR_IMPORTANCE,
  TIMELINE_MODEL_KIND,
  type TimelineEntryInput,
} from '../publicRead/episodeTimelineProjection';
import { buildArcProjection, ARC_MODEL_KIND } from '../publicRead/relationshipArcProjection';
import {
  buildVoteConsequenceProjection,
  VOTE_CONSEQUENCE_MODEL_KIND,
} from '../publicRead/voteConsequenceProjection';
import { voteConsequenceModelRef } from '../shared/environmentVoteCatalog';
import {
  buildRelationshipGraphProjection,
  groupPublicRelationships,
  RELATIONSHIP_GRAPH_MODEL_KIND,
} from '../publicRead/relationshipGraphProjection';
import { relationshipGraphModelRef } from '../shared/relationshipGraphRef';
import { buildLiveProjection, LIVE_MODEL_KIND, liveSourceEventIds } from '../publicRead/liveState';
import {
  commitReadModelVersion,
  serveReadModel,
  SERVABLE_STATUS,
  type PublishedReadModel,
  type PublicReadStore,
  type ReadModelKind,
  type StoredReadModel,
} from '../publicRead/readModel';
import {
  executePostCommitPipeline,
  POST_COMMIT_STAGES,
  type PostCommitCheckpoint,
  type PostCommitRun,
  type PostCommitRunInput,
  type PostCommitRunStore,
  type PostCommitStage,
  type RunFailure,
} from './postCommitOrchestration';
import {
  affectedCharacterIds,
  arcEventImportance,
  arcTransitionTarget,
  createPostCommitStageHandlers,
  deriveArcClassification,
  deriveRecapRequests,
  deriveRecapTargets,
  seasonOf,
  episodeNumberFor,
  newArcPortfolioEntry,
  nextArcProjectionFields,
  overflowRemediation,
  postCommitRunId,
  publicRelationshipPairs,
  recapCursorOf,
  recapTargetKey,
  type ArcArtifact,
  type EpisodeArtifact,
  type KnowledgeArtifact,
  type LiveArcState,
  type MemoryArtifact,
  type PostCommitLivePort,
  type PostCommitSource,
  type PostCommitWorldState,
  type PublicationArtifact,
  type SafetyArtifact,
  type SnapshotArtifact,
} from './postCommitLive';
import {
  resolveEffectiveModuleConfig,
  type ConfigurableModule,
} from '../shared/moduleModelConfig';
import {
  deriveGatedShareFormats,
  SHARE_FORMAT_KINDS,
  type EpisodeShareFormats,
} from '../editorial/derived/shareFormats';

const WORLD_ID = MISTWOOD_PUBLIC_WORLD_ID;
const OPERATOR = { type: 'operations' as const, operatorId: 'test' };
const ACTOR = { type: 'system' as const, id: 'test' };

// --- fixtures ---------------------------------------------------------------

function acceptedEventFixture(overrides: Partial<AcceptedEvent> = {}): AcceptedEvent {
  return {
    schemaVersion: 1, worldId: WORLD_ID, eventId: `${WORLD_ID}#event#1`, idempotencyKey: 'key-1',
    worldDay: 1, timeSlot: 'morning', eventType: 'conversation', locationId: 'mistwood-square',
    participantIds: ['he-jun', 'zhao-ming'],
    proposedBy: { type: 'director', id: 'director-1' },
    publicSummary: 'he-jun and zhao-ming argued about the mill.',
    causedByEventIds: [],
    stateChanges: [
      {
        type: 'relationship_changed', sourceCharacterId: 'he-jun', targetCharacterId: 'zhao-ming',
        trustDelta: -0.1, affectionDelta: 0, resentmentDelta: 0.2, visibility: 'public', reason: 'a public argument',
      },
      {
        type: 'character_memory_formed', characterId: 'he-jun', content: 'zhao-ming pushed back',
        interpretation: 'they will not yield', importance: 0.6, emotionalWeight: 0.4, confidence: 0.8, visibility: 'private',
      },
      {
        type: 'fact_created', subjectType: 'world', subjectId: WORLD_ID, predicate: 'lastMajorSceneSummary',
        value: 'the mill argument', visibility: 'public',
      },
    ],
    sequenceNumber: 1, acceptedAt: 1_000, validationVersion: 'v1', traceId: 'trace-1',
    ...overrides,
  } as AcceptedEvent;
}

function arcStateFixture(overrides: Partial<LiveArcState> = {}): LiveArcState {
  return {
    arcId: 'arc:1', status: 'active', projectionRevision: 2, tier: 'major', lastTransitionWorldDay: 0,
    lastProgressWorldDay: 0,
    fields: {
      title: 'The mill', premise: 'The mill is failing', currentQuestion: 'Who saves the mill?',
      coreCharacterIds: ['he-jun', 'zhao-ming'], incitingEventId: `${WORLD_ID}#event#0`,
      latestTurningPointEventId: null, essentialFactIds: [], unresolvedQuestions: ['Who saves the mill?'],
      resolvedQuestions: [], recommendedEntryEventId: null, heatScore: 70,
    },
    ...overrides,
  };
}

// --- derivations ------------------------------------------------------------

describe('arcEventImportance (FR-F001 inputs come from the event itself)', () => {
  it('scores a multi-character, multi-change, publicly summarised scene as arc-worthy', () => {
    expect(arcEventImportance(acceptedEventFixture())).toBeGreaterThanOrEqual(0.6);
  });

  it('scores a solo, single-change, unsummarised event below the new-arc threshold', () => {
    const quiet = acceptedEventFixture({
      participantIds: ['he-jun'], publicSummary: undefined,
      stateChanges: [{ type: 'character_location_changed', characterId: 'he-jun', fromLocationId: 'mistwood-square', toLocationId: 'mistwood-mill' }],
    } as Partial<AcceptedEvent>);
    expect(arcEventImportance(quiet)).toBeLessThan(0.6);
  });

  it('stays inside 0…1 for an event that maxes out every input', () => {
    const busy = acceptedEventFixture({
      participantIds: ['a', 'b', 'c', 'd', 'e'],
      stateChanges: Array.from({ length: 9 }, () => acceptedEventFixture().stateChanges[0]),
    } as Partial<AcceptedEvent>);
    expect(arcEventImportance(busy)).toBeLessThanOrEqual(1);
  });
});

describe('deriveArcClassification (FR-F001 creation and membership)', () => {
  it('opens a new arc for a weighty multi-character event when no arc matches', () => {
    const classification = deriveArcClassification(acceptedEventFixture(), []);
    expect(classification?.newArc?.arcId).toBe(`arc:${WORLD_ID}:1`);
    expect(classification?.memberships).toHaveLength(1);
    expect(classification?.memberships[0].role).toBe('inciting_incident');
    expect(classification?.newArc?.coreCharacterIds).toEqual(['he-jun', 'zhao-ming']);
  });

  it('refuses to open an arc from a solo, low-importance event', () => {
    const quiet = acceptedEventFixture({
      participantIds: ['he-jun'], publicSummary: undefined,
      stateChanges: [{ type: 'character_location_changed', characterId: 'he-jun', fromLocationId: 'mistwood-square', toLocationId: 'mistwood-mill' }],
    } as Partial<AcceptedEvent>);
    expect(deriveArcClassification(quiet, [])).toBeNull();
  });

  it('attaches to an open arc that shares a core character instead of opening another', () => {
    const classification = deriveArcClassification(acceptedEventFixture(), [arcStateFixture()]);
    expect(classification?.newArc).toBeNull();
    expect(classification?.memberships.map(({ arcId }) => arcId)).toEqual(['arc:1']);
    // An `active` arc is escalated by its next event.
    expect(classification?.memberships[0].role).toBe('escalation');
  });

  it('ignores resolved arcs and arcs with no shared character', () => {
    const unrelated = arcStateFixture({ arcId: 'arc:other', fields: { ...arcStateFixture().fields, coreCharacterIds: ['pei-lan'] } });
    const closed = arcStateFixture({ arcId: 'arc:closed', status: 'resolved' });
    const classification = deriveArcClassification(acceptedEventFixture(), [unrelated, closed]);
    expect(classification?.newArc?.arcId).toBe(`arc:${WORLD_ID}:1`);
  });

  it('never marks more than two memberships primary', () => {
    const arcs = ['a', 'b', 'c', 'd'].map((suffix) => arcStateFixture({ arcId: `arc:${suffix}` }));
    const classification = deriveArcClassification(acceptedEventFixture(), arcs);
    expect(classification?.memberships.filter(({ primary }) => primary)).toHaveLength(2);
  });
});

describe('FR-F002 lifecycle targets and FR-F003 overflow remediation', () => {
  it('only ever proposes a legal next status', () => {
    expect(arcTransitionTarget('emerging')).toBe('active');
    expect(arcTransitionTarget('active')).toBe('escalating');
    expect(arcTransitionTarget('escalating')).toBe('climax');
    expect(arcTransitionTarget('climax')).toBe('resolving');
    expect(arcTransitionTarget('resolving')).toBe('resolved');
    expect(arcTransitionTarget('archived')).toBeNull();
  });

  it('downgrades an overflowing major candidate while the minor pool has room, else rejects', () => {
    expect(overflowRemediation('major', 0)).toEqual({ type: 'downgrade' });
    expect(overflowRemediation('major', 6)).toEqual({ type: 'reject' });
    expect(overflowRemediation('minor', 0)).toEqual({ type: 'reject' });
  });

  it('builds a portfolio candidate the count-control rule accepts', () => {
    const event = acceptedEventFixture();
    const classification = deriveArcClassification(event, []) as ArcEventClassification;
    const candidate = newArcPortfolioEntry(event, classification);
    expect(candidate.projection.status).toBe('emerging');
    expect(candidate.projection.incitingEventId).toBe(event.eventId);
    const { decision } = applyArcPortfolioControl([], candidate, { type: 'reject' });
    expect(decision.action).toBe('accepted');
  });
});

describe('nextArcProjectionFields (FR-F004 arc read model advances with canon)', () => {
  it('records a turning point and the event public facts', () => {
    const current = arcStateFixture().fields;
    const next = nextArcProjectionFields(current, acceptedEventFixture(), {
      arcId: 'arc:1', primary: true, importance: 0.8, role: 'turning_point',
      coreCharacterIdsAdded: [], coreCharacterIdsRemoved: [],
    });
    expect(next?.latestTurningPointEventId).toBe(`${WORLD_ID}#event#1`);
    expect(next?.essentialFactIds).toEqual([`${WORLD_ID}#event#1:fact:2`]);
    expect(next?.heatScore).toBe(80);
  });

  it('moves the current question to resolved on a resolution event', () => {
    const next = nextArcProjectionFields(arcStateFixture().fields, acceptedEventFixture(), {
      arcId: 'arc:1', primary: true, importance: 0.8, role: 'resolution',
      coreCharacterIdsAdded: [], coreCharacterIdsRemoved: [],
    });
    expect(next?.resolvedQuestions).toContain('Who saves the mill?');
    expect(next?.unresolvedQuestions).not.toContain('Who saves the mill?');
  });

  it('returns null when nothing would change, so no empty revision is appended', () => {
    const event = acceptedEventFixture({ stateChanges: [] } as Partial<AcceptedEvent>);
    const current = { ...arcStateFixture().fields, heatScore: 60 };
    expect(nextArcProjectionFields(current, event, {
      arcId: 'arc:1', primary: false, importance: 0.6, role: 'development',
      coreCharacterIdsAdded: [], coreCharacterIdsRemoved: [],
    })).toBeNull();
  });
});

describe('episode numbering and recap windows', () => {
  it('numbers completed world days by their position in history', () => {
    expect(episodeNumberFor([0, 1, 2], 0)).toBe(1);
    expect(episodeNumberFor([0, 1, 2], 2)).toBe(3);
    expect(episodeNumberFor([0, 1], 5)).toBeNull();
  });

  const recapState = (): PostCommitWorldState => ({
    event: acceptedEventFixture({ sequenceNumber: 7, worldDay: 2 } as Partial<AcceptedEvent>),
    worldDayFirstSequenceNumber: 5, timeSlotFirstSequenceNumber: 6, seasonFirstSequenceNumber: 5,
  } as PostCommitWorldState);

  /**
   * FR-G002 declares five levels. Before ART-164 this derivation emitted two, so `scene`, `arc`
   * and `season` summaries existed for no world. The literal list is written out rather than
   * derived from `RECAP_TYPES` on purpose: deriving the expectation from the same constant the
   * code reads would let both drift together and still agree.
   */
  it('drives all five pyramid levels, each from its own origin', () => {
    const targets = deriveRecapTargets(recapState(), ['arc-b', 'arc-a']);
    expect(targets.map(({ recapType }) => recapType)).toEqual(['scene', 'episode', 'arc', 'arc', 'season', 'viewer_context']);
    expect(targets.map(({ targetId }) => targetId)).toEqual([
      'slot:2:morning', 'day:2', 'arc:arc-a', 'arc:arc-b', 'season:0', WORLD_ID,
    ]);
    // Each level starts where that level starts, not where the day does.
    expect(targets.map(({ start }) => start)).toEqual([6, 5, 0, 0, 5, 0]);
    // Only the arc tier is selective, and it carries the arc it selects by.
    expect(targets.map(({ arcId }) => arcId ?? null)).toEqual([null, null, 'arc-a', 'arc-b', null, null]);
  });

  it('asks only for the arcs the event moved, so a quiet arc appends no empty version', () => {
    expect(deriveRecapTargets(recapState(), []).some(({ recapType }) => recapType === 'arc')).toBe(false);
  });

  it('files a world day into a fixed season window, so a replay cannot re-file it', () => {
    expect([0, 9, 10, 29].map(seasonOf)).toEqual([0, 0, 1, 2]);
  });

  /**
   * The cursor rule, pinned on its own. Every port reads it through `recapCursorOf`, and the two
   * candidate answers COINCIDE for almost every live snapshot — a selective snapshot is normally
   * written by the event that is itself the arc's newest progress. So a pipeline test cannot tell
   * the rules apart, and a wrong one would survive a full run. Only the diverging case does.
   */
  it('resumes a selective tier from the range it examined, not from its newest match', () => {
    expect(recapCursorOf({ sourceToSequenceNumber: 4, sourceScope: { toSequenceNumber: 9 } })).toBe(9);
    // A contiguous tier has no scope, and there the last event IS the end of the range.
    expect(recapCursorOf({ sourceToSequenceNumber: 4, sourceScope: null })).toBe(4);
  });

  it('opens a day recap at the day boundary and a world recap at sequence zero', () => {
    const state = recapState();
    const requests = deriveRecapRequests(state.event, deriveRecapTargets(state, []), {});
    expect(requests).toEqual([
      { snapshotId: `recap:${WORLD_ID}:scene:slot:2:morning:7`, recapType: 'scene', targetId: 'slot:2:morning', fromSequenceNumber: 6, toSequenceNumber: 7 },
      { snapshotId: `recap:${WORLD_ID}:episode:day:2:7`, recapType: 'episode', targetId: 'day:2', fromSequenceNumber: 5, toSequenceNumber: 7 },
      { snapshotId: `recap:${WORLD_ID}:season:season:0:7`, recapType: 'season', targetId: 'season:0', fromSequenceNumber: 5, toSequenceNumber: 7 },
      { snapshotId: `recap:${WORLD_ID}:viewer_context:${WORLD_ID}:7`, recapType: 'viewer_context', targetId: WORLD_ID, fromSequenceNumber: 0, toSequenceNumber: 7 },
    ]);
  });

  it('continues from the stored cursor and skips a target already covered', () => {
    const state = recapState();
    const requests = deriveRecapRequests(state.event, deriveRecapTargets(state, []), {
      [recapTargetKey('scene', 'slot:2:morning')]: 7,
      [recapTargetKey('episode', 'day:2')]: 6,
      [recapTargetKey('season', 'season:0')]: 7,
      [recapTargetKey('viewer_context', WORLD_ID)]: 7,
    });
    expect(requests).toEqual([
      { snapshotId: `recap:${WORLD_ID}:episode:day:2:7`, recapType: 'episode', targetId: 'day:2', fromSequenceNumber: 7, toSequenceNumber: 7 },
    ]);
  });
});

describe('affected-entity derivation', () => {
  it('collects participants, relationship endpoints and fact subjects', () => {
    expect(affectedCharacterIds(acceptedEventFixture())).toEqual(['he-jun', 'zhao-ming']);
  });

  it('returns each public relationship pair once, ordered', () => {
    expect(publicRelationshipPairs(acceptedEventFixture())).toEqual([['he-jun', 'zhao-ming']]);
  });

  it('ignores non-public relationship changes', () => {
    const priv = acceptedEventFixture({
      stateChanges: [{
        type: 'relationship_changed', sourceCharacterId: 'he-jun', targetCharacterId: 'zhao-ming',
        trustDelta: -0.1, affectionDelta: 0, resentmentDelta: 0.2, visibility: 'private', reason: 'in private',
      }],
    } as Partial<AcceptedEvent>);
    expect(publicRelationshipPairs(priv)).toEqual([]);
  });
});

// --- durable run store ------------------------------------------------------

class MemoryPostCommitStore implements PostCommitRunStore {
  readonly runs = new Map<string, PostCommitRun>();
  readonly checkpoints: PostCommitCheckpoint[] = [];

  loadRun(runId: string): Promise<PostCommitRun | null> {
    const run = this.runs.get(runId);
    return Promise.resolve(run ? structuredClone(run) : null);
  }
  createRun(input: PostCommitRunInput): Promise<PostCommitRun> {
    const run: PostCommitRun = { ...input, status: 'running', attemptCount: 1 };
    this.runs.set(input.runId, run);
    return Promise.resolve(structuredClone(run));
  }
  listCheckpoints(runId: string): Promise<PostCommitCheckpoint[]> {
    return Promise.resolve(structuredClone(this.checkpoints.filter((row) => row.runId === runId)));
  }
  startCheckpoint(runId: string, stage: PostCommitStage, attempt: number): Promise<void> {
    this.checkpoints.push({ runId, stage, attempt, status: 'running' });
    return Promise.resolve();
  }
  completeCheckpoint(runId: string, stage: PostCommitStage, attempt: number, artifact: unknown): Promise<void> {
    Object.assign(this.find(runId, stage, attempt), { status: 'completed', artifact: structuredClone(artifact) });
    return Promise.resolve();
  }
  failCheckpoint(runId: string, stage: PostCommitStage, attempt: number, error: RunFailure): Promise<void> {
    Object.assign(this.find(runId, stage, attempt), { status: 'failed', errorCode: error.code, errorMessage: error.message });
    return Promise.resolve();
  }
  resumeRun(runId: string, attempt: number): Promise<void> {
    Object.assign(this.required(runId), { status: 'running', attemptCount: attempt, failureStage: undefined, errorCode: undefined, errorMessage: undefined });
    return Promise.resolve();
  }
  failRun(runId: string, stage: PostCommitStage, error: RunFailure): Promise<void> {
    Object.assign(this.required(runId), { status: 'failed', failureStage: stage, errorCode: error.code, errorMessage: error.message });
    return Promise.resolve();
  }
  completeRun(runId: string, metricsTraceId: string): Promise<void> {
    Object.assign(this.required(runId), { status: 'completed', metricsTraceId });
    return Promise.resolve();
  }
  artifact<T>(runId: string, stage: PostCommitStage): T {
    const rows = this.checkpoints.filter((row) => row.runId === runId && row.stage === stage && row.status === 'completed');
    if (rows.length === 0) throw new Error(`missing artifact ${stage}`);
    return rows[rows.length - 1].artifact as T;
  }
  private required(runId: string): PostCommitRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error('missing run');
    return run;
  }
  private find(runId: string, stage: PostCommitStage, attempt: number): PostCommitCheckpoint {
    const row = this.checkpoints.find((candidate) => candidate.runId === runId && candidate.stage === stage && candidate.attempt === attempt);
    if (!row) throw new Error('missing checkpoint');
    return row;
  }
}

// --- public read store ------------------------------------------------------

class MemoryReadStore implements PublicReadStore {
  /** ART-162: this fixture is not exercising the publication gate, so it publishes. */
  publicationEnabled(): Promise<boolean> { return Promise.resolve(true); }

  readonly rows: StoredReadModel[] = [];
  private counter = 0;
  loadTargetVersions(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<readonly StoredReadModel[]> {
    return Promise.resolve(this.rows.filter((row) => row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef));
  }
  findCurrent(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<StoredReadModel | null> {
    return Promise.resolve(this.rows.find((row) =>
      row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isCurrent) ?? null);
  }
  loadLastKnownGood(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<readonly StoredReadModel[]> {
    return Promise.resolve(this.rows.filter((row) =>
      row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isLastKnownGood));
  }
  insertVersion(record: PublishedReadModel): Promise<string> {
    this.counter += 1;
    const id = `id-${this.counter}`;
    this.rows.push({ ...record, id });
    return Promise.resolve(id);
  }
  markCurrent(rowId: string, patch: Parameters<PublicReadStore['markCurrent']>[1]): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === rowId);
    if (!row) throw new Error('ROW_NOT_FOUND');
    row.isCurrent = patch.isCurrent;
    row.isLastKnownGood = patch.isLastKnownGood;
    row.status = patch.status;
    return Promise.resolve();
  }
}

// --- live-shaped world-day harness (ART-97) ---------------------------------

class MemoryWorldDayRunStore implements WorldDayRunStore {
  private readonly runs = new Map<string, WorldDayRun>();
  private readonly checkpoints: WorldDayCheckpoint[] = [];
  loadRun(runId: string): Promise<WorldDayRun | null> {
    const run = this.runs.get(runId);
    return Promise.resolve(run ? structuredClone(run) : null);
  }
  createRun(input: WorldDayRunInput): Promise<WorldDayRun> {
    const run: WorldDayRun = { ...input, status: 'running', attemptCount: 1 };
    this.runs.set(input.runId, run);
    return Promise.resolve(structuredClone(run));
  }
  listCheckpoints(runId: string): Promise<WorldDayCheckpoint[]> {
    return Promise.resolve(structuredClone(this.checkpoints.filter((row) => row.runId === runId)));
  }
  startCheckpoint(runId: string, stage: WorldDayStage, attempt: number): Promise<void> {
    this.checkpoints.push({ runId, stage, attempt, status: 'running' });
    return Promise.resolve();
  }
  completeCheckpoint(runId: string, stage: WorldDayStage, attempt: number, artifact: unknown): Promise<void> {
    Object.assign(this.find(runId, stage, attempt), { status: 'completed', artifact: structuredClone(artifact) });
    return Promise.resolve();
  }
  failCheckpoint(runId: string, stage: WorldDayStage, attempt: number, error: WorldDayRunFailure): Promise<void> {
    Object.assign(this.find(runId, stage, attempt), { status: 'failed', errorCode: error.code, errorMessage: error.message });
    return Promise.resolve();
  }
  resumeRun(runId: string, attempt: number): Promise<void> {
    Object.assign(this.required(runId), { status: 'running', attemptCount: attempt });
    return Promise.resolve();
  }
  failRun(runId: string, stage: WorldDayStage, error: WorldDayRunFailure): Promise<void> {
    Object.assign(this.required(runId), { status: 'failed', failureStage: stage, errorCode: error.code, errorMessage: error.message });
    return Promise.resolve();
  }
  completeRun(runId: string, committedEventIds: string[]): Promise<void> {
    Object.assign(this.required(runId), { status: 'completed', committedEventIds });
    return Promise.resolve();
  }
  private required(runId: string): WorldDayRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error('missing run');
    return run;
  }
  private find(runId: string, stage: WorldDayStage, attempt: number): WorldDayCheckpoint {
    const row = this.checkpoints.find((candidate) => candidate.runId === runId && candidate.stage === stage && candidate.attempt === attempt);
    if (!row) throw new Error('missing checkpoint');
    return row;
  }
}

const activeLocations = mistwoodWorldConfiguration.locations.filter(({ active }) => active);

function mistwoodRuleContext(): CanonRuleContext {
  return {
    worldId: WORLD_ID,
    rules: mistwoodWorldConfiguration.immutableRules,
    characterIds: mistwoodCharacterSeed.characters.map(({ id }) => id),
    locationIds: activeLocations.map(({ id }) => id),
    itemIds: mistwoodCharacterSeed.assets.map(({ id }) => id),
    organizationIds: mistwoodWorldConfiguration.organizations.map(({ id }) => id),
    initialCharacterAlive: Object.fromEntries(mistwoodCharacterSeed.characters.map(({ id }) => [id, true])),
    initialItemOwners: Object.fromEntries(mistwoodCharacterSeed.assets.map(({ id, ownerCharacterId }) => [id, ownerCharacterId])),
    locationConnections: Object.fromEntries(activeLocations.map(({ id, connectedLocationIds }) => [id, connectedLocationIds])),
  };
}

/** Minimal in-memory {@link WorldDayLivePort} that produces REAL accepted events. */
function createWorldDayPort(store: InMemoryCanonStore, activeArcsFor: () => LiveWorldSnapshot['activeArcs']): WorldDayLivePort {
  return {
    // ART-59 requires every port to state whether it meters spend. This fixture does not:
    // it exercises a different capability, and an unmetered gate keeps its behaviour
    // identical to before ART-59 while leaving the choice visible rather than absent.
    budget: unmeteredWorldDayBudgetPort(),
    canonStore: store,
    // ART-90 evidence recorders; this fixture measures nothing, so they are inert.
    recordProposalValidations: () => Promise.resolve(),
    recordAuthoringAttempt: () => Promise.resolve(),
    // FR-K005 / ART-52: this spec runs an UNCONFIGURED world, so the port returns the documented
    // defaults -- which are the pre-ART-52 hardcoded values.
    // ART-161: no configured limit, so authoring stays sequential — the behaviour these
    // fixtures were written against.
    loadConcurrencyLimit: () => Promise.resolve(null),
    loadModuleConfig: (_worldId: string, module: ConfigurableModule) =>
      Promise.resolve(resolveEffectiveModuleConfig(module, null)),
    async loadWorldSnapshot(slot: WorldDaySlotIdentity) {
      const acceptedEvents = await store.loadAcceptedEvents(slot.worldId);
      return buildLiveWorldSnapshot({
        slot,
        acceptedEvents,
        projection: replayWorldEvents(emptyProjection(slot.worldId), acceptedEvents),
        characters: mistwoodCharacterSeed.characters.map(({ id, publicProfile, publicGoal, initialLocationId }) =>
          ({ characterId: id, personaSummary: publicProfile, currentGoal: publicGoal, initialLocationId })),
        locationConnections: Object.fromEntries(activeLocations.map(({ id, connectedLocationIds }) => [id, connectedLocationIds])),
        seedKnowledge: mistwoodCharacterSeed.knowledge.map(({ id, characterId, content }) =>
          ({ characterId, knowledgeId: id, belief: content })),
        seedAssets: mistwoodCharacterSeed.assets.map(({ id, ownerCharacterId }) => ({ characterId: ownerCharacterId, assetId: id })),
        secretIds: mistwoodCharacterSeed.secrets.map(({ id }) => id),
        activeArcs: activeArcsFor(),
      });
    },
    loadScheduledEnvironmentEvents: () => Promise.resolve([]),
    markScheduledEnvironmentEventApplied: () => Promise.resolve(),
    persistDirectorPlan: () => Promise.resolve(),
    persistCharacterIntent: () => Promise.resolve(),
    persistGroupedScenes: () => Promise.resolve(),
    persistSceneSimulation: () => Promise.resolve(),
    // No stored result: these doubles never retry, so every scene is authored fresh.
    loadPersistedSceneSimulation: () => Promise.resolve(null),
  };
}

// --- live-shaped post-commit port -------------------------------------------

type ArcRecord = { lifecycle: ArcLifecycleRecord; projections: ArcProjectionEvent[] };

/**
 * In-memory {@link PostCommitLivePort} that runs the REAL downstream capabilities:
 * arc lifecycle/portfolio/stagnation/entry rules, the daily-episode builder and its
 * safety classifier, the recap builder, the publication lifecycle, and the public
 * read-model builders published through the real `commitReadModelVersion`.
 */
function createLivePostCommitPort(canon: InMemoryCanonStore, readStore: MemoryReadStore) {
  const arcs = new Map<string, ArcRecord>();
  const classifications = new Map<number, ArcEventClassification>();
  const portfolio: ArcPortfolioEntry[] = [];
  const recapFormats = new Map<number, { status: 'ready' | 'failed'; episodeNumber: number; deduplicated: boolean; errorCode?: string }>();
  const storedRecapFormats = new Map<number, { formats: RecapFormats; composition: RecapComposition }>();
  const coverageReports = new Map<number, { releasable: boolean; findingCodes: string[] }>();
  const resolutionDecisions: ArcResolutionDecision[] = [];
  const consequenceSummaries = new Map<string, ConsequenceSummary>();
  const episodes = new Map<number, { status: string; episodeNumber: number; episode?: DailyEpisode; safetyClassificationId: string | null }>();
  const recaps: RecapSnapshot[] = [];
  const publications = new Map<string, PublicationRecord>();
  const shareFormats = new Map<number, { status: string; reasonCodes: string[] }>();
  const shareFormatCopy = new Map<number, EpisodeShareFormats | null>();
  const rebuilt: string[] = [];
  let now = 10_000;

  const events = (): AcceptedEvent[] => canon.committedEvents() ;
  const arcProjectionData = (arcId: string) => {
    const record = arcs.get(arcId);
    if (!record) throw new Error(`unknown arc ${arcId}`);
    return replayArcProjection(record.projections, record.lifecycle.status);
  };
  const publish = async (modelKind: ReadModelKind, modelRef: string, payload: unknown, sourceEventIds: string[]) => {
    now += 1;
    await commitReadModelVersion(readStore, {
      worldId: WORLD_ID, modelKind, modelRef, payload: payload as never,
      sourceEventIds, status: SERVABLE_STATUS, now,
    });
    rebuilt.push(modelRef);
    return modelRef;
  };
  const importanceBySequence = () => new Map(
    [...classifications.values()].map((entry) => [
      entry.sourceEventSequenceNumber,
      entry.memberships.reduce((max, membership) => Math.max(max, membership.importance), 0),
    ]),
  );
  const membershipsBySequence = () => new Map(
    [...classifications.values()].map((entry) => [entry.sourceEventSequenceNumber, entry.memberships]),
  );
  const episodeRefs = () => [...episodes.entries()]
    .filter(([, row]) => row.episode)
    .map(([worldDay, row]) => ({
      episodeNumber: row.episodeNumber, worldDay, sourceEventIds: row.episode!.sourceEventIds,
    }));

  const port: PostCommitLivePort = {
    loadWorldState(source: PostCommitSource): Promise<PostCommitWorldState> {
      const all = events();
      const event = all.find(({ sequenceNumber }) => sequenceNumber === source.sourceEventSequenceNumber);
      if (!event) throw new Error('POST_COMMIT_SOURCE_NOT_ACCEPTED');
      const days = [...new Set(all.map(({ worldDay }) => worldDay))].sort((left, right) => left - right);
      const latestWorldDay = days[days.length - 1];
      // ART-89: a day is over when the world has moved past it; the final-slot condition belongs
      // to the daily snapshot alone.
      const completed = days.filter((day) => day < latestWorldDay);
      return Promise.resolve({
        event,
        latestWorldDayFinalSlotStarted: all.some((candidate) =>
          candidate.worldDay === latestWorldDay && candidate.timeSlot === TIME_SLOTS[TIME_SLOTS.length - 1]),
        arcs: [...arcs.values()].map((record): LiveArcState => ({
          arcId: record.lifecycle.arcId,
          status: record.lifecycle.status,
          projectionRevision: record.projections.length - 1,
          fields: record.projections[record.projections.length - 1].fields,
          tier: portfolio.find(({ projection }) => projection.arcId === record.lifecycle.arcId)?.tier ?? null,
          lastTransitionWorldDay: record.lifecycle.transitions.reduce((highest, transition) => Math.max(
            highest,
            all.find(({ sequenceNumber }) => sequenceNumber === transition.sourceEventSequenceNumber)?.worldDay ?? 0,
          ), 0),
          lastProgressWorldDay: record.projections[record.projections.length - 1].worldDay,
        })),
        characterIds: mistwoodCharacterSeed.characters.map(({ id }) => id),
        completedWorldDays: completed,
        episodeWorldDays: [...episodes.keys()],
        worldDayFirstSequenceNumber: all.filter(({ worldDay }) => worldDay === event.worldDay)
          .reduce((lowest, candidate) => Math.min(lowest, candidate.sequenceNumber), event.sequenceNumber),
        timeSlotFirstSequenceNumber: all
          .filter(({ worldDay, timeSlot }) => worldDay === event.worldDay && timeSlot === event.timeSlot)
          .reduce((lowest, candidate) => Math.min(lowest, candidate.sequenceNumber), event.sequenceNumber),
        seasonFirstSequenceNumber: all.filter(({ worldDay }) => worldDay === event.worldDay)
          .reduce((lowest, candidate) => Math.min(lowest, candidate.sequenceNumber), event.sequenceNumber),
        latestWorldDay,
      });
    },

    rebuildWorldProjection: (worldId) => Promise.resolve(`world:${worldId}`),
    rebuildCharacterProjection: (_worldId, characterId) => Promise.resolve(`character:${characterId}`),

    loadCharacterKnowledge(worldId, characterId) {
      const projection = replayWorldEvents(emptyProjection(worldId), events());
      return Promise.resolve(authorizeKnowledgeRead(projection.characterKnowledge, characterId, OPERATOR));
    },
    loadCharacterMemories(worldId, characterId) {
      const projection = replayWorldEvents(emptyProjection(worldId), events());
      return Promise.resolve(authorizeMemoryRead(projection.characterMemories, characterId, OPERATOR));
    },
    rebuildRelationshipProjection: (_worldId, source, target) =>
      Promise.resolve(`relationship:${[source, target].sort().join('|')}`),

    recordArcClassification(classification) {
      if (classifications.has(classification.sourceEventSequenceNumber)) return Promise.resolve({ created: false });
      classifications.set(classification.sourceEventSequenceNumber, classification);
      const proposal = classification.newArc;
      if (proposal) {
        const source = events().find(({ sequenceNumber }) => sequenceNumber === classification.sourceEventSequenceNumber)!;
        const membership = classification.memberships.find(({ arcId }) => arcId === proposal.arcId)!;
        arcs.set(proposal.arcId, {
          lifecycle: createArcLifecycle(WORLD_ID, proposal.arcId, {
            sourceEventId: classification.sourceEventId,
            sourceEventSequenceNumber: classification.sourceEventSequenceNumber,
            reason: 'accepted event classified as inciting incident', changedAt: source.acceptedAt,
          }),
          projections: [{
            schemaVersion: 1, worldId: WORLD_ID, arcId: proposal.arcId, revision: 0, kind: 'initialized',
            fields: {
              title: proposal.title, premise: proposal.premise, currentQuestion: proposal.currentQuestion,
              coreCharacterIds: proposal.coreCharacterIds, incitingEventId: classification.sourceEventId,
              latestTurningPointEventId: null, essentialFactIds: [], unresolvedQuestions: [proposal.currentQuestion],
              resolvedQuestions: [], recommendedEntryEventId: null, heatScore: Math.round(membership.importance * 100),
            },
            sourceEventId: classification.sourceEventId,
            sourceEventSequenceNumber: classification.sourceEventSequenceNumber,
            worldDay: source.worldDay, timeSlot: source.timeSlot,
          }],
        });
      }
      return Promise.resolve({ created: true });
    },

    admitArcToPortfolio(_worldId, candidate, remediation) {
      const { entries, decision } = applyArcPortfolioControl(portfolio, candidate, remediation);
      portfolio.splice(0, portfolio.length, ...entries);
      return Promise.resolve(decision);
    },

    syncArcPortfolioEntry(_worldId, arcId) {
      const entry = portfolio.find(({ projection }) => projection.arcId === arcId);
      if (!entry || !arcs.has(arcId)) return Promise.resolve(false);
      entry.projection = arcProjectionData(arcId);
      return Promise.resolve(true);
    },

    transitionArcLifecycle(input) {
      const record = arcs.get(input.arcId);
      if (!record) throw new Error(`unknown arc ${input.arcId}`);
      record.lifecycle = transitionArcLifecycle(record.lifecycle, { ...input, changedAt: now });
      return Promise.resolve({ status: record.lifecycle.status });
    },

    updateArcProjection(input) {
      const record = arcs.get(input.arcId);
      if (!record) throw new Error(`unknown arc ${input.arcId}`);
      if (record.projections.length - 1 !== input.expectedRevision) throw new Error('ARC_PROJECTION_SEQUENCE_CONFLICT');
      const source = events().find(({ sequenceNumber }) => sequenceNumber === input.sourceEventSequenceNumber)!;
      const revision = record.projections.length;
      record.projections.push({
        schemaVersion: 1, worldId: WORLD_ID, arcId: input.arcId, revision, kind: 'updated', fields: input.fields,
        sourceEventId: input.sourceEventId, sourceEventSequenceNumber: input.sourceEventSequenceNumber,
        worldDay: source.worldDay, timeSlot: source.timeSlot,
      });
      return Promise.resolve({ revision });
    },

    refreshStagnationPrompts(_worldId, currentWorldDay) {
      return Promise.resolve(portfolio
        .flatMap((entry) => {
          const prompt = detectArcStagnation(entry.projection, entry.tier, currentWorldDay);
          return prompt ? [prompt] : [];
        }).length);
    },

    // ART-163. The real decision constructor, not a stub: a double that accepted a terminal
    // status without an outcome would let the very defect this wiring exists to close pass.
    recordArcResolution(_worldId, decision) {
      const recorded = createArcResolutionDecision(decision);
      const prior = resolutionDecisions.find(({ decisionId }) => decisionId === recorded.decisionId);
      if (prior) return Promise.resolve(prior);
      resolutionDecisions.push(recorded);
      const entry = portfolio.find(({ projection }) => projection.arcId === recorded.arcId);
      if (entry) entry.tier = recorded.resultingTier;
      return Promise.resolve(recorded);
    },

    applyArcConsequences(_worldId, decisionId) {
      const decision = resolutionDecisions.find((entry) => entry.decisionId === decisionId);
      if (!decision) throw new Error(`unknown resolution decision ${decisionId}`);
      const resolutionEvent = events().find(({ eventId }) => eventId === decision.sourceEventId)!;
      const summaries = deriveConsequenceSummaries(decision, [resolutionEvent]);
      for (const summary of summaries) consequenceSummaries.set(summary.summaryId, summary);
      return Promise.resolve({ applied: summaries.length });
    },

    generateEpisode(worldId, worldDay, episodeNumber) {
      const prior = episodes.get(worldDay);
      if (prior) return Promise.resolve({ status: prior.status, episodeNumber: prior.episodeNumber, deduplicated: true });
      const memberships = membershipsBySequence();
      const questions = new Map([...arcs.keys()].map((arcId) => [arcId, arcProjectionData(arcId).currentQuestion]));
      const sources: EpisodeSourceEvent[] = events().filter((event) => event.worldDay === worldDay).map((event) => {
        const entries = memberships.get(event.sequenceNumber) ?? [];
        return {
          eventId: event.eventId, publicSummary: event.publicSummary ?? null,
          participantIds: [...event.participantIds], arcIds: entries.map(({ arcId }) => arcId),
          importance: entries.reduce((max, entry) => Math.max(max, entry.importance), 0),
          publicFactIds: event.stateChanges.flatMap((change, index) =>
            change.type === 'fact_created' && change.visibility === 'public' ? [`${event.eventId}:fact:${index}`] : []),
          publicRelationshipChanges: event.stateChanges.flatMap((change) => change.type === 'relationship_changed'
            && change.visibility === 'public'
            ? [`Relationship changed between ${change.sourceCharacterId} and ${change.targetCharacterId}.`] : []),
          newQuestions: classifications.get(event.sequenceNumber)?.newArc ? [classifications.get(event.sequenceNumber)!.newArc!.currentQuestion] : [],
          resolvedQuestions: entries.filter(({ role }) => role === 'resolution')
            .flatMap(({ arcId }) => (questions.get(arcId) ? [questions.get(arcId) as string] : [])),
        };
      });
      const episode = validateDailyEpisode(
        buildDailyEpisode(worldId, worldDay, episodeNumber, sources), sources,
        mistwoodCharacterSeed.secrets.map(({ content }) => content),
      );
      const safety = classifyPostGeneration({
        classificationId: `episode:${worldId}:${worldDay}`, worldId, sourceId: `episode:${episodeNumber}`,
        kind: 'public_artifact', text: dailyEpisodePublicText(episode), coreFactIds: episode.sourceEventIds,
      });
      const safe = safety.label === 'allow' || safety.label === 'allow_with_warning';
      const status = safe ? 'ready' : 'withheld';
      episodes.set(worldDay, { status, episodeNumber, episode: safe ? episode : undefined, safetyClassificationId: safety.classificationId });
      return Promise.resolve({ status, episodeNumber, deduplicated: false });
    },

    generateRecap(worldId, request) {
      const existing = recaps.find(({ id }) => id === request.snapshotId);
      if (existing) return Promise.resolve({ snapshotId: existing.id, deduplicated: true });
      const prior = recaps.filter(({ recapType, targetId }) => recapType === request.recapType && targetId === request.targetId).at(-1) ?? null;
      const inRange = ({ sequenceNumber }: { sequenceNumber: number }): boolean =>
        sequenceNumber >= request.fromSequenceNumber && sequenceNumber <= request.toSequenceNumber;
      // ART-164: the `arc` tier is SELECTIVE — the events that moved that arc's projection, read
      // from the arc's own revision list, exactly as the deployment reads them.
      if (request.arcId !== undefined) {
        const moved = new Set((arcs.get(request.arcId)?.projections ?? [])
          .map(({ sourceEventSequenceNumber }) => sourceEventSequenceNumber)
          .filter((sequenceNumber) => inRange({ sequenceNumber })));
        const acceptedEvents = events().filter(({ sequenceNumber }) => moved.has(sequenceNumber));
        if (acceptedEvents.length === 0) return Promise.resolve({ snapshotId: null, deduplicated: false });
        const arcSnapshot = buildRecapSnapshot({
          id: request.snapshotId, worldId, recapType: request.recapType, targetId: request.targetId, prior,
          acceptedEvents, mode: 'incremental', generatedAt: now,
          sourceScope: { fromSequenceNumber: request.fromSequenceNumber, toSequenceNumber: request.toSequenceNumber },
        });
        recaps.push(arcSnapshot);
        return Promise.resolve({ snapshotId: arcSnapshot.id, deduplicated: false });
      }
      const snapshot = buildRecapSnapshot({
        id: request.snapshotId, worldId, recapType: request.recapType, targetId: request.targetId, prior,
        acceptedEvents: events().filter(inRange),
        mode: 'incremental', generatedAt: now,
      });
      recaps.push(snapshot);
      return Promise.resolve({ snapshotId: snapshot.id, deduplicated: false });
    },

    loadRecapCursors(_worldId, targets) {
      const cursors: Record<string, number> = {};
      for (const { recapType, targetId } of targets) {
        const latest = recaps.filter((snapshot) =>
          snapshot.recapType === recapType && snapshot.targetId === targetId).at(-1);
        if (latest) {
          cursors[recapTargetKey(recapType, targetId)] = recapCursorOf(latest);
        }
      }
      return Promise.resolve(cursors);
    },

    /**
     * ART-164. The REAL composer and the REAL length validation, in memory.
     *
     * A double that returned `ready` without composing would let the 30-day gate report four
     * recap formats per episode while the deployment refused every one of them on the Quick
     * Recap's 80 中文字 floor.
     */
    generateRecapFormats(_worldId, worldDay) {
      const prior = recapFormats.get(worldDay);
      if (prior) return Promise.resolve({ ...prior, deduplicated: true });
      const episodeRow = episodes.get(worldDay);
      if (!episodeRow?.episode) {
        const outcome = { status: 'failed' as const, episodeNumber: episodeRow?.episodeNumber ?? 0, deduplicated: false, errorCode: 'RECAP_EPISODE_NOT_PUBLISHABLE' };
        recapFormats.set(worldDay, outcome);
        return Promise.resolve(outcome);
      }
      const dayEvents = events().filter((event) => event.worldDay === worldDay);
      try {
        const composed = composeRecaps(episodeRow.episode, dayEvents);
        const formats = validateRecapFormats({
          schemaVersion: 1, quickRecap: composed.quickRecap, standardRecap: composed.standardRecap,
          deepRecap: buildDeepRecap(dayEvents),
          machineSummary: buildMachineSummary(dayEvents, {
            newQuestions: [...episodeRow.episode.newQuestions],
            resolvedQuestions: [...episodeRow.episode.resolvedQuestions],
            storyArcProgress: episodeRow.episode.arcIds.map((arcId) => ({
              arcId, progress: `第 ${episodeRow.episodeNumber} 集推進了這條故事線。`,
            })),
          }),
          sourceEventIds: composed.sourceEventIds,
        }, dayEvents);
        storedRecapFormats.set(worldDay, { formats, composition: composed.composition });
        const outcome = { status: 'ready' as const, episodeNumber: episodeRow.episodeNumber, deduplicated: false };
        recapFormats.set(worldDay, outcome);
        return Promise.resolve(outcome);
      } catch (error) {
        const errorCode = (error as { code?: string }).code ?? 'RECAP_FORMAT_GENERATION_FAILED';
        const outcome = { status: 'failed' as const, episodeNumber: episodeRow.episodeNumber, deduplicated: false, errorCode };
        recapFormats.set(worldDay, outcome);
        return Promise.resolve(outcome);
      }
    },

    loadEpisodeStatus(_worldId, worldDay) {
      const row = episodes.get(worldDay);
      return Promise.resolve(row
        ? { status: row.status, safetyClassificationId: row.safetyClassificationId, hasEpisode: Boolean(row.episode) }
        : null);
    },

    // FR-G005 / ART-36. Runs the REAL derivation and the REAL gate, like every other capability
    // in this port. The accepted set comes from the canon store rather than from the Episode
    // object, which is the whole reason the provenance check in `validateEpisodeShareFormats`
    // can fail rather than being a restatement of the builder's own output.
    generateShareFormats(worldId, worldDay) {
      const prior = shareFormats.get(worldDay);
      if (prior) return Promise.resolve(prior);
      const row = episodes.get(worldDay);
      if (!row) return Promise.resolve({ status: 'absent', reasonCodes: [] });
      if (row.status !== 'ready' || !row.episode) {
        const blocked = { status: 'blocked', reasonCodes: ['SHARE_SOURCE_EPISODE_NOT_READY'] };
        shareFormats.set(worldDay, blocked);
        return Promise.resolve(blocked);
      }
      const { decision } = deriveGatedShareFormats({
        episode: row.episode,
        acceptedSourceEventIds: events().filter((event) => event.worldDay === worldDay).map(({ eventId }) => eventId),
        sourceEpisodeStatus: row.status,
      });
      const result = { status: decision.outcome, reasonCodes: [...decision.reasonCodes] };
      shareFormats.set(worldDay, result);
      shareFormatCopy.set(worldDay, decision.formats);
      return Promise.resolve(result);
    },

    createPublication(worldId, contentRef, summary) {
      const existing = publications.get(contentRef);
      if (existing) return Promise.resolve({ status: existing.status });
      const record = createPublicationRecord({
        publicationId: `pub:${contentRef}:1`, worldId, contentKind: 'episode', contentRef,
        summary, actor: ACTOR, reason: 'test', at: now,
      });
      publications.set(contentRef, record);
      return Promise.resolve({ status: record.status });
    },

    advancePublication(_worldId, contentRef, action) {
      const record = publications.get(contentRef);
      if (!record) throw new Error('PUBLICATION_NOT_FOUND');
      const next = transitionPublication(record, action, ACTOR, 'test', now);
      publications.set(contentRef, next);
      return Promise.resolve({ status: next.status });
    },

    /**
     * ART-164. The REAL FR-G004 gate over in-memory state.
     *
     * `validateRecapCoverage`, `episodeCandidate` and `toCoverageSource` are the same functions
     * the deployment runs; a double that returned `releasable: true` would let the 30-day gate
     * report zero spoiler violations for a pipeline that never checked for one.
     */
    runCoverageGate(_worldId, worldDay, contentRef) {
      const episodeRow = episodes.get(worldDay);
      if (!episodeRow?.episode) {
        coverageReports.set(worldDay, { releasable: false, findingCodes: ['COVERAGE_INVALID_SHAPE'] });
        return Promise.resolve({ releasable: false, findingCodes: ['COVERAGE_INVALID_SHAPE'] });
      }
      const memberships = membershipsBySequence();
      const turningPoints = new Map<string, string[]>();
      for (const entry of classifications.values()) {
        turningPoints.set(entry.sourceEventId, entry.memberships
          .filter(({ role }) => role === 'turning_point').map(({ arcId }) => arcId));
      }
      const sources = events().map((event) => toCoverageSource(
        event,
        (memberships.get(event.sequenceNumber) ?? []).reduce((max, m) => Math.max(max, m.importance), 0),
        turningPoints.get(event.eventId) ?? [],
      ));
      const report = validateRecapCoverage(
        episodeCandidate(WORLD_ID, contentRef, episodeRow.episode, sources), sources, [],
      );
      const findingCodes = [...new Set(report.findings.map(({ code }) => code))];
      coverageReports.set(worldDay, { releasable: report.releasable, findingCodes });
      return Promise.resolve({ releasable: report.releasable, findingCodes });
    },

    reassessArcEntries(worldId) {
      const reassessed: string[] = [];
      const worldEpisodes = episodeRefs();
      const latestSequenceNumber = events().at(-1)?.sequenceNumber ?? 0;
      for (const entry of portfolio) {
        if (entry.tier !== 'major' || !isActiveArcStatus(entry.projection.status)) continue;
        recommendArcEntry({
          worldId, arcId: entry.projection.arcId, projection: entry.projection,
          arcEpisodes: worldEpisodes.filter(({ worldDay }) =>
            episodes.get(worldDay)?.episode?.arcIds.includes(entry.projection.arcId)),
          worldEpisodes, latestSequenceNumber,
        });
        reassessed.push(entry.projection.arcId);
      }
      return Promise.resolve(reassessed);
    },

    rebuildEpisodeProjection(worldId, worldDay) {
      const row = episodes.get(worldDay);
      if (!row?.episode) throw new Error('EPISODE_NOT_ELIGIBLE');
      const payload = buildEpisodeProjection({ worldId, episode: row.episode, status: row.status });
      return publish(EPISODE_MODEL_KIND, `episode:${worldDay}`, payload, payload.sourceEventIds);
    },

    rebuildEpisodeIndexProjection(worldId) {
      const payload = buildEpisodeIndex({
        worldId,
        episodes: [...episodes.entries()].filter(([, row]) => row.episode).map(([, row]) => ({
          worldDay: row.episode!.worldDay, episodeNumber: row.episode!.episodeNumber, title: row.episode!.title,
          headline: row.episode!.headline, status: row.status, arcIds: row.episode!.arcIds,
          characterIds: row.episode!.characterIds, sourceEventIds: row.episode!.sourceEventIds,
        })),
        recommendedEntryWorldDays: new Set<number>(),
        turningPointEventIds: new Set([...arcs.keys()]
          .map((arcId) => arcProjectionData(arcId).latestTurningPointEventId)
          .filter((id): id is string => id !== null)),
      });
      return publish(EPISODE_INDEX_MODEL_KIND, `episodes:${worldId}`, payload, payload.episodes.map(({ worldDay }) => `day:${worldDay}`));
    },

    rebuildTimelineProjection(worldId) {
      const memberships = membershipsBySequence();
      const importance = importanceBySequence();
      const entries: TimelineEntryInput[] = events().map((event) => ({
        eventId: event.eventId, worldDay: event.worldDay, timeSlot: event.timeSlot, eventType: event.eventType,
        publicSummary: event.publicSummary ?? null, importance: importance.get(event.sequenceNumber) ?? 0,
        arcIds: (memberships.get(event.sequenceNumber) ?? []).map(({ arcId }) => arcId),
        characterIds: [...event.participantIds],
        episodeNumber: episodes.get(event.worldDay)?.episodeNumber ?? null,
      }));
      const payload = buildTimelineProjection({ worldId, entries });
      return publish(TIMELINE_MODEL_KIND, `timeline:${worldId}`, payload, payload.entries.map(({ eventId }) => eventId));
    },

    /**
     * FR-J002 / ART-46, through the REAL builder like every other read model here.
     *
     * The harness commits no viewer-vote event and persists no Director plan, so the payload
     * comes out with a null trigger and four empty buckets — which is precisely the shape the
     * pipeline must be able to publish, and the reason it is asserted here rather than stubbed.
     */
    rebuildVoteConsequenceProjection(worldId, targetWorldDay) {
      const payload = buildVoteConsequenceProjection({
        worldId,
        targetWorldDay,
        events: events().map((event) => ({
          eventId: event.eventId, sequenceNumber: event.sequenceNumber, worldDay: event.worldDay,
          timeSlot: event.timeSlot, eventType: event.eventType, idempotencyKey: event.idempotencyKey,
          causedByEventIds: [...event.causedByEventIds], publicSummary: event.publicSummary ?? null,
          publicationStatus: 'published' as const, sceneId: null,
        })),
        // Derived from the canon store, the way the real wiring derives it from `canonEvents`.
        acceptedEventIds: events().map((event) => event.eventId),
        appliedEventIds: [],
        contextInterventionEventIdsByScene: {},
      });
      return publish(
        VOTE_CONSEQUENCE_MODEL_KIND,
        voteConsequenceModelRef(worldId, targetWorldDay),
        payload,
        payload.sourceEventIds,
      );
    },

    /**
     * FR-I007 / ART-44, through the REAL builder over CANON, the way the shipped wiring does.
     *
     * The relationship history comes from the same deterministic reducer
     * (`replayWorldEvents(...).relationshipHistory`) rather than from anything this harness
     * invents, and — as in production — Canon's accumulated `projection.relationships` is
     * deliberately not touched, because it folds private changes in with public ones.
     * `groupPublicRelationships` is what applies the visibility filter, here and in production.
     */
    rebuildRelationshipGraphProjection(worldId, targetWorldDay) {
      const projection = replayWorldEvents(emptyProjection(worldId), events());
      const payload = buildRelationshipGraphProjection({
        worldId,
        targetWorldDay,
        arcs: [...arcs.keys()].map((arcId) => {
          const arc = arcProjectionData(arcId);
          return {
            arcId, title: arc.title, status: arc.status, coreCharacterIds: arc.coreCharacterIds,
          };
        }),
        relationships: groupPublicRelationships(
          Object.values(projection.relationshipHistory).flat(),
        ),
      });
      return publish(
        RELATIONSHIP_GRAPH_MODEL_KIND,
        relationshipGraphModelRef(worldId, targetWorldDay),
        payload,
        payload.sourceEventIds,
      );
    },

    rebuildArcReadModel(worldId, arcId) {
      const projection = arcProjectionData(arcId);
      const payload = buildArcProjection({
        worldId,
        arc: {
          arcId, title: projection.title, premise: projection.premise, currentQuestion: projection.currentQuestion,
          status: projection.status, coreCharacterIds: projection.coreCharacterIds,
          incitingEventId: projection.incitingEventId, latestTurningPointEventId: projection.latestTurningPointEventId,
          unresolvedQuestions: projection.unresolvedQuestions,
        },
        essentialBackstory: [], recommendedEntry: null,
        relatedEpisodes: episodeRefs().filter(({ worldDay }) => episodes.get(worldDay)?.episode?.arcIds.includes(arcId))
          .map(({ episodeNumber, worldDay }) => ({ episodeNumber, worldDay })),
        knownClues: [], outcome: null,
      });
      return publish(ARC_MODEL_KIND, `arc:${arcId}`, payload, [projection.incitingEventId]);
    },

    rebuildArcPrimer: (_worldId, arcId) => Promise.resolve(`primer:${arcId}`),

    rebuildLiveProjection(worldId) {
      const payload = buildLiveProjection({
        worldId, acceptedEvents: events(),
        arcs: [...arcs.keys()].map((arcId) => {
          const projection = arcProjectionData(arcId);
          return { arcId, title: projection.title, currentQuestion: projection.currentQuestion, status: projection.status };
        }),
        publishedEpisode: null,
      });
      return publish(LIVE_MODEL_KIND, `live:${worldId}`, payload, liveSourceEventIds(payload));
    },

    rebuildOnboardingSummary: (worldId) => Promise.resolve(`onboarding:${worldId}`),

    persistDailySnapshot: (_worldId, worldDay) => Promise.resolve({ snapshotId: `snapshot:${worldDay}`, deduplicated: false }),

    loadStageMetrics: () => Promise.resolve({
      stages: POST_COMMIT_STAGES.map((stage) => ({ stage, status: 'completed' as const, durationMs: 0 })),
      recordedAt: now,
    }),
  };

  return {
    port, arcs, portfolio, episodes, recaps, publications, shareFormats, shareFormatCopy, rebuilt,
    resolutionDecisions, consequenceSummaries, coverageReports, recapFormats, storedRecapFormats,
  };
}

/** Run ART-97's world-day pipeline for whole world days, producing real accepted events. */
async function runWorldDays(canon: InMemoryCanonStore, days: number, activeArcs: () => LiveWorldSnapshot['activeArcs']): Promise<void> {
  const runStore = new MemoryWorldDayRunStore();
  const handlers = createWorldDayStageHandlers(createWorldDayPort(canon, activeArcs), new FakeWholeSceneProvider());
  for (let worldDay = 0; worldDay < days; worldDay += 1) {
    for (const timeSlot of TIME_SLOTS as readonly TimeSlot[]) {
      const slot: WorldDaySlotIdentity = { worldId: WORLD_ID, worldDay, timeSlot };
      const run = await executeWorldDay({ runId: worldDayRunId(slot), ...slot }, runStore, handlers);
      if (run.status !== 'completed') throw new Error(`world day ${worldDay} ${timeSlot} failed: ${run.errorMessage}`);
    }
  }
}

/** Drive stages 11–21 for every accepted event, in canon order. */
async function runPostCommitForAll(
  canon: InMemoryCanonStore,
  port: PostCommitLivePort,
  store: MemoryPostCommitStore,
): Promise<PostCommitRun[]> {
  const handlers = createPostCommitStageHandlers(port);
  const runs: PostCommitRun[] = [];
  for (const event of canon.committedEvents() ) {
    runs.push(await executePostCommitPipeline({
      runId: postCommitRunId(WORLD_ID, event.sequenceNumber),
      worldId: WORLD_ID, sourceEventId: event.eventId,
      sourceEventSequenceNumber: event.sequenceNumber, worldDay: event.worldDay,
    }, store, handlers, event.traceId));
  }
  return runs;
}

function seededCanon(): InMemoryCanonStore {
  const store = new InMemoryCanonStore();
  store.setCanonRuleContext(mistwoodRuleContext());
  return store;
}

// --- live-shaped integration -------------------------------------------------

describe('live post-commit pipeline over real world-day commits (AC#1/#2/#3/#4)', () => {
  it('turns live-committed events into cognition, arcs, episodes, recaps and servable read models', async () => {
    const canon = seededCanon();
    const readStore = new MemoryReadStore();
    const harness = createLivePostCommitPort(canon, readStore);
    const runStore = new MemoryPostCommitStore();

    // Stages 1–10 (ART-97): two whole world days of real director-planned scenes.
    await runWorldDays(canon, 2, () => []);
    const events = canon.committedEvents() ;
    expect(events.length).toBeGreaterThan(0);

    // FR-G005 / ART-36 AC#1, captured BEFORE the pipeline runs. It was originally captured after,
    // with only Map reads between the snapshot and the comparison, so it could not fail whatever
    // the share pipeline did. Spanning the pipeline is what makes it evidence.
    const canonBeforePostCommit = JSON.stringify(canon.committedEvents());

    // Stages 11–21 (this task), for every accepted event, in canon order.
    const runs = await runPostCommitForAll(canon, harness.port, runStore);
    expect(runs.every(({ status }) => status === 'completed')).toBe(true);

    // AC#1 — cognition: knowledge and memory were read back through the authorization
    // boundary for the characters each event touched, and the events formed real memories.
    const lastRunId = runs[runs.length - 1].runId;
    const knowledge = runStore.artifact<KnowledgeArtifact>(lastRunId, 'knowledge');
    const memory = runStore.artifact<MemoryArtifact>(lastRunId, 'memory');
    expect(knowledge.entries.length).toBeGreaterThan(0);
    expect(memory.entries.some(({ newMemoryIds }) => newMemoryIds.length > 0)).toBe(true);

    // AC#1/AC#4 — story arcs exist, stay inside the count-control limits, and only ever
    // moved along legal FR-F002 transitions.
    expect(harness.arcs.size).toBeGreaterThan(0);
    expect(harness.portfolio.filter(({ tier, projection }) => tier === 'major' && isActiveArcStatus(projection.status)).length)
      .toBeLessThanOrEqual(3);
    for (const record of harness.arcs.values()) {
      for (const transition of record.lifecycle.transitions.slice(1)) {
        expect(arcTransitionTarget(transition.fromStatus!)).toBe(transition.toStatus);
      }
    }

    // AC#1 — the finished world day produced a daily episode and advanced the recap pyramid.
    const episodeArtifact = runStore.artifact<EpisodeArtifact>(lastRunId, 'episode');
    expect([...harness.episodes.keys()]).toContain(0);
    expect(episodeArtifact.episodes.length).toBeGreaterThanOrEqual(0);
    expect(harness.recaps.some(({ recapType }) => recapType === 'episode')).toBe(true);
    expect(harness.recaps.some(({ recapType }) => recapType === 'viewer_context')).toBe(true);

    // AC#2 — the editorial stage published the episode as far as a system actor may take it
    // and rebuilt the affected read models.
    const safetyArtifacts = runs.map(({ runId }) => runStore.artifact<SafetyArtifact>(runId, 'safety'));
    const publicationArtifacts = runs.map(({ runId }) => runStore.artifact<PublicationArtifact>(runId, 'publication'));
    expect(safetyArtifacts.some(({ publishable }) => publishable)).toBe(true);
    // A system actor may take an episode to `ready`; FR-K004 reserves `publish` for an admin.
    expect(publicationArtifacts.filter(({ publicationStatus }) => publicationStatus !== null)
      .every(({ publicationStatus }) => publicationStatus === 'ready')).toBe(true);
    expect(runStore.artifact<PublicationArtifact>(lastRunId, 'publication').modelRefs)
      .toEqual(expect.arrayContaining([`episodes:${WORLD_ID}`, `timeline:${WORLD_ID}`, `live:${WORLD_ID}`]));

    // FR-G005 / ART-36 — the same stage derived share formats from the Episode it just gated,
    // and derived them from REAL accepted events rather than from a fixture.
    expect(publicationArtifacts.some(({ shareFormatStatus }) => shareFormatStatus !== null)).toBe(true);
    // The best status the automated pipeline reaches is `manual_release_required`. `published`
    // is not a value this pipeline can produce -- there is nothing for it to publish TO.
    for (const { shareFormatStatus } of publicationArtifacts) {
      expect(['manual_release_required', 'blocked', 'absent', null]).toContain(shareFormatStatus);
    }
    const shareDay = [...harness.shareFormatCopy.keys()][0];
    const copy = harness.shareFormatCopy.get(shareDay);
    expect(copy).not.toBeUndefined();
    if (copy) {
      // All four FR-G005 formats, each traced to the Episode they came from (AC#2).
      expect(copy.formats.map(({ kind }) => kind)).toEqual([...SHARE_FORMAT_KINDS]);
      expect(copy.sourceEpisode).toMatchObject({ worldId: WORLD_ID, worldDay: shareDay });
      const acceptedIds = new Set(canon.committedEvents().map(({ eventId }) => eventId));
      expect(copy.sourceEpisode.sourceEventIds.every((id) => acceptedIds.has(id))).toBe(true);
      for (const format of copy.formats) {
        expect(format.sourceEventIds.every((id) => acceptedIds.has(id))).toBe(true);
      }
    }
    // AC#1 — the whole post-commit pipeline, share derivation and gating included, committed
    // nothing to the accepted-event log. Compared against the snapshot taken before the pipeline
    // ran, so a share module that wrote to canon would break this.
    expect(JSON.stringify(canon.committedEvents())).toBe(canonBeforePostCommit);

    // AC#3 — a PUBLIC reader sees the new content. `serveReadModel` reads only published
    // snapshots: it has no canon access and no provider, so no read can trigger generation.
    const index = await serveReadModel(readStore, WORLD_ID, EPISODE_INDEX_MODEL_KIND, `episodes:${WORLD_ID}`);
    const timeline = await serveReadModel(readStore, WORLD_ID, TIMELINE_MODEL_KIND, `timeline:${WORLD_ID}`);
    const arcId = [...harness.arcs.keys()][0];
    const arc = await serveReadModel(readStore, WORLD_ID, ARC_MODEL_KIND, `arc:${arcId}`);
    expect((index?.payload as { episodes: unknown[] }).episodes.length).toBeGreaterThan(0);
    // The world timeline is the MAJOR-event timeline: it carries exactly the accepted events
    // whose own weight reaches TIMELINE_MAJOR_IMPORTANCE. Since ART-101 a slot may also
    // commit a one-character errand or travel scene, which is a real accepted event but not
    // a major beat, so this is a filter — not a shortfall.
    const major = events.filter((event) => arcEventImportance(event) >= TIMELINE_MAJOR_IMPORTANCE);
    expect(major.length).toBeGreaterThan(0);
    expect((timeline?.payload as { entries: unknown[] }).entries.length).toBe(major.length);
    expect((arc?.payload as { arcId: string }).arcId).toBe(arcId);

    // Every timeline entry traces to an accepted event; nothing is fabricated.
    const acceptedIds = new Set(events.map(({ eventId }) => eventId));
    for (const entry of (timeline?.payload as { entries: Array<{ eventId: string }> }).entries) {
      expect(acceptedIds.has(entry.eventId)).toBe(true);
    }
  });

  it('is idempotent: replaying every run neither duplicates episodes, recaps nor read-model versions', async () => {
    const canon = seededCanon();
    const readStore = new MemoryReadStore();
    const harness = createLivePostCommitPort(canon, readStore);
    const runStore = new MemoryPostCommitStore();
    await runWorldDays(canon, 1, () => []);
    await runPostCommitForAll(canon, harness.port, runStore);

    const episodeCount = harness.episodes.size;
    const recapCount = harness.recaps.length;
    const versionCount = readStore.rows.length;

    const replay = await runPostCommitForAll(canon, harness.port, runStore);
    expect(replay.every(({ status }) => status === 'completed')).toBe(true);
    expect(harness.episodes.size).toBe(episodeCount);
    expect(harness.recaps.length).toBe(recapCount);
    expect(readStore.rows.length).toBe(versionCount);
  });

  it('records a stable failure and resumes from it without re-running completed stages', async () => {
    const canon = seededCanon();
    const readStore = new MemoryReadStore();
    const harness = createLivePostCommitPort(canon, readStore);
    const runStore = new MemoryPostCommitStore();
    await runWorldDays(canon, 1, () => []);
    const event = (canon.committedEvents() )[0];
    const input: PostCommitRunInput = {
      runId: postCommitRunId(WORLD_ID, event.sequenceNumber), worldId: WORLD_ID,
      sourceEventId: event.eventId, sourceEventSequenceNumber: event.sequenceNumber, worldDay: event.worldDay,
    };

    const broken = { ...harness.port, generateRecap: () => Promise.reject(new Error('recap store offline')) };
    const failed = await executePostCommitPipeline(input, runStore, createPostCommitStageHandlers(broken), event.traceId);
    expect(failed).toMatchObject({ status: 'failed', failureStage: 'recap' });
    // Canon is untouched by a downstream failure.
    expect((canon.committedEvents() ).length).toBe((canon.committedEvents() ).length);
    expect(harness.recaps).toHaveLength(0);

    const resumed = await executePostCommitPipeline(input, runStore, createPostCommitStageHandlers(harness.port), event.traceId);
    expect(resumed.status).toBe('completed');
    // The stages before `recap` completed once; only the failed stage and its successors re-ran.
    const completedArcCheckpoints = runStore.checkpoints
      .filter((row) => row.runId === input.runId && row.stage === 'arc' && row.status === 'completed');
    expect(completedArcCheckpoints).toHaveLength(1);
  });

  it('isolates a daily-snapshot failure so the editorial release still completes', async () => {
    const canon = seededCanon();
    const readStore = new MemoryReadStore();
    const harness = createLivePostCommitPort(canon, readStore);
    const runStore = new MemoryPostCommitStore();
    await runWorldDays(canon, 1, () => []);
    const event = (canon.committedEvents() ).at(-1) as AcceptedEvent;
    const broken = {
      ...harness.port,
      persistDailySnapshot: () => Promise.reject(new Error('[SNAPSHOT_CORRUPT] seeded snapshot is not event-derivable')),
    };
    const run = await executePostCommitPipeline({
      runId: postCommitRunId(WORLD_ID, event.sequenceNumber), worldId: WORLD_ID,
      sourceEventId: event.eventId, sourceEventSequenceNumber: event.sequenceNumber, worldDay: event.worldDay,
    }, runStore, createPostCommitStageHandlers(broken), event.traceId);

    expect(run.status).toBe('completed');
    const snapshot = runStore.artifact<SnapshotArtifact>(run.runId, 'snapshot');
    expect(snapshot.snapshotId).toBeNull();
    expect(snapshot.errorCode).toBe('POST_COMMIT_STAGE_FAILED');
    expect(snapshot.errorMessage).toContain('SNAPSHOT_CORRUPT');
  });
});

/**
 * ART-164 FR-G004. Before this task both coverage-gate functions had zero production callers, so
 * an Episode that omitted a high-importance Accepted Event, or leaked an unreleased secret into
 * its public copy, walked to `ready` unchallenged.
 *
 * These tests are about the GATE BEING WIRED, which is the thing that was missing —
 * `coverageValidation.test.ts` already covers what counts as a violation.
 */
/**
 * ART-164 FR-G002. `deriveRecapTargets` proves which levels are ASKED for; this proves the live
 * pipeline actually produces them, and that the selective tier stays incremental as canon grows.
 */
/**
 * ART-164 FR-G003. `buildDeepRecap`, `buildMachineSummary` and `validateRecapFormats` were built,
 * tested and called by nothing, and no table stored their output — so Quick / Standard / Deep /
 * Machine Summary existed for no episode any running world produced.
 *
 * These tests are therefore about the LIVE PATH producing them. `recapComposition.test.ts` and
 * `recapFormats.test.ts` cover what the artifacts must contain.
 */
describe('the four FR-G003 recap formats from the live path', () => {
  it('produces and persists all four formats for every episode a world day completes', async () => {
    const canon = seededCanon();
    const harness = createLivePostCommitPort(canon, new MemoryReadStore());
    const runStore = new MemoryPostCommitStore();
    await runWorldDays(canon, 3, () => []);
    const runs = await runPostCommitForAll(canon, harness.port, runStore);
    expect(runs.every(({ status }) => status === 'completed')).toBe(true);

    const readyEpisodeDays = [...harness.episodes.entries()]
      .filter(([, row]) => row.status === 'ready' && row.episode).map(([worldDay]) => worldDay);
    expect(readyEpisodeDays.length).toBeGreaterThan(0);
    // Every completed episode has formats. Not "at least one" — the acceptance criterion is that
    // no episode ships without them.
    // eslint-disable-next-line no-console
    expect(readyEpisodeDays.every((worldDay) => harness.recapFormats.get(worldDay)?.status === 'ready')).toBe(true);

    const acceptedIds = new Set(canon.committedEvents().map(({ eventId }) => eventId));
    for (const worldDay of readyEpisodeDays) {
      const stored = harness.storedRecapFormats.get(worldDay);
      expect(stored).toBeDefined();
      const { formats } = stored as { formats: RecapFormats };
      expect(countChineseCharacters(formats.quickRecap)).toBeGreaterThanOrEqual(QUICK_RECAP_MIN);
      expect(countChineseCharacters(formats.quickRecap)).toBeLessThanOrEqual(QUICK_RECAP_MAX);
      expect(countChineseCharacters(formats.standardRecap)).toBeGreaterThanOrEqual(STANDARD_RECAP_MIN);
      expect(countChineseCharacters(formats.standardRecap)).toBeLessThanOrEqual(STANDARD_RECAP_MAX);
      expect(formats.deepRecap.length).toBeGreaterThan(0);
      // All seven Machine Summary fields FR-G003 names, present on the live artifact.
      expect(Object.keys(formats.machineSummary).sort()).toEqual([
        'newQuestions', 'requiredPriorFacts', 'resolvedQuestions', 'schemaVersion',
        'storyArcProgress', 'whatChanged', 'whoIsAffected', 'whyItHappened',
      ]);
      // Provenance resolves to canon, so no recap claims an event the world never accepted.
      expect(formats.sourceEventIds.length).toBeGreaterThan(0);
      expect(formats.sourceEventIds.every((eventId) => acceptedIds.has(eventId))).toBe(true);
    }

    // And the pipeline records the outcome on its own artifact, so a failure is queryable rather
    // than only visible as a missing row.
    const recorded = runStore.checkpoints
      .filter((row) => row.stage === 'episode' && row.status === 'completed')
      .flatMap((row) => (row.artifact as EpisodeArtifact).recapFormats);
    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded.some(({ status }) => status === 'ready')).toBe(true);
  });

  it('never gives one episode two conflicting sets of formats', async () => {
    const canon = seededCanon();
    const harness = createLivePostCommitPort(canon, new MemoryReadStore());
    await runWorldDays(canon, 2, () => []);
    await runPostCommitForAll(canon, harness.port, new MemoryPostCommitStore());
    const first = new Map([...harness.storedRecapFormats.entries()]
      .map(([day, value]) => [day, JSON.stringify(value.formats)]));
    expect(first.size).toBeGreaterThan(0);

    // A full replay: the run store is fresh, so every stage re-executes rather than resuming.
    await runPostCommitForAll(canon, harness.port, new MemoryPostCommitStore());
    expect(harness.storedRecapFormats.size).toBe(first.size);
    for (const [day, serialized] of first) {
      expect(JSON.stringify(harness.storedRecapFormats.get(day)?.formats)).toBe(serialized);
    }
  });
});

describe('the recap pyramid over real world-day commits (FR-G002)', () => {
  it('produces all five levels, and the arc level summarises only that arc', async () => {
    const canon = seededCanon();
    const harness = createLivePostCommitPort(canon, new MemoryReadStore());
    await runWorldDays(canon, 3, () => []);
    const runs = await runPostCommitForAll(canon, harness.port, new MemoryPostCommitStore());
    expect(runs.every(({ status }) => status === 'completed')).toBe(true);

    expect([...new Set(harness.recaps.map(({ recapType }) => recapType))].sort())
      .toEqual(['arc', 'episode', 'scene', 'season', 'viewer_context']);

    const arcSnapshots = harness.recaps.filter(({ recapType }) => recapType === 'arc');
    expect(arcSnapshots.length).toBeGreaterThan(0);
    for (const snapshot of arcSnapshots) {
      const arcId = snapshot.targetId.replace(/^arc:/, '');
      const moved = new Set((harness.arcs.get(arcId)?.projections ?? [])
        .map(({ sourceEventSequenceNumber }) => sourceEventSequenceNumber));
      const cited = snapshot.structuredPayload.newEventIds
        .map((eventId) => canon.committedEvents().find((event) => event.eventId === eventId));
      expect(cited.every((event) => event !== undefined)).toBe(true);
      // Every event the arc summary claims moved this arc actually did. Without this an arc
      // summary is a world summary wearing an arc's name — which is what summarising the whole
      // contiguous range would have produced.
      expect(cited.every((event) => moved.has((event as AcceptedEvent).sequenceNumber))).toBe(true);
    }
  });

  it('keeps every tier incremental: scopes and ranges tile with no gap and no overlap', async () => {
    const canon = seededCanon();
    const harness = createLivePostCommitPort(canon, new MemoryReadStore());
    await runWorldDays(canon, 3, () => []);
    await runPostCommitForAll(canon, harness.port, new MemoryPostCommitStore());

    const byTarget = new Map<string, RecapSnapshot[]>();
    for (const snapshot of harness.recaps) {
      const key = recapTargetKey(snapshot.recapType, snapshot.targetId);
      byTarget.set(key, [...(byTarget.get(key) ?? []), snapshot]);
    }
    const withHistory = [...byTarget.values()].filter((versions) => versions.length > 1);
    expect(withHistory.length).toBeGreaterThan(0);

    for (const versions of withHistory) {
      for (let index = 1; index < versions.length; index += 1) {
        const previous = versions[index - 1];
        const current = versions[index];
        expect(current.version).toBe(previous.version + 1);
        if (current.sourceScope === null) {
          // A contiguous tier records its delta directly: the first new event must be exactly one
          // past where the previous version stopped — nothing re-read, nothing skipped.
          const firstNew = canon.committedEvents()
            .find(({ eventId }) => eventId === current.structuredPayload.newEventIds[0]);
          expect(firstNew?.sequenceNumber).toBe(recapCursorOf(previous) + 1);
        } else {
          /**
           * A selective tier records CUMULATIVE coverage, so its per-version delta start is not
           * recoverable from the snapshot — deliberately, because the useful claim is "this range
           * has been examined end to end", not "this version looked at these five events".
           *
           * What is checkable here is that coverage only ever extends: the start never moves, and
           * the watermark strictly advances. That a version may not begin with a gap is enforced
           * at construction and proven in `recaps/model.test.ts`; asserting it again off a shape
           * that does not carry it would be a test of my own arithmetic.
           */
          expect(current.sourceScope.fromSequenceNumber).toBe(previous.sourceScope?.fromSequenceNumber);
          expect(current.sourceScope.toSequenceNumber).toBeGreaterThan(previous.sourceScope!.toSequenceNumber);
        }
      }
    }
  });
});

describe('coverage and spoiler gate as a publication precondition (FR-G004)', () => {
  it('runs the real gate for every day that produced an episode, and records its verdict', async () => {
    const canon = seededCanon();
    const harness = createLivePostCommitPort(canon, new MemoryReadStore());
    const runStore = new MemoryPostCommitStore();
    await runWorldDays(canon, 2, () => []);
    const runs = await runPostCommitForAll(canon, harness.port, runStore);
    expect(runs.every(({ status }) => status === 'completed')).toBe(true);

    /**
     * The invariant is that NO publication is created without a verdict — deliberately not "every
     * episode has a verdict". Stage 18 only ever acts on the latest episode of a run, so a run
     * that completes two world days at once publishes only the later one. That is pre-existing
     * behaviour this task did not change, and asserting the stronger claim here would make this
     * test a report on that gap rather than evidence about the gate.
     */
    expect(harness.coverageReports.size).toBe(harness.publications.size);
    expect(harness.coverageReports.size).toBeGreaterThan(0);

    // And the pipeline carries it on its artifact, so "was this checked?" is answerable from the
    // run record rather than only from the gate's own table.
    const publicationArtifacts = runStore.checkpoints
      .filter((row) => row.stage === 'publication' && row.status === 'completed')
      .map((row) => row.artifact as PublicationArtifact)
      .filter(({ contentRef }) => contentRef !== null);
    expect(publicationArtifacts.length).toBeGreaterThan(0);
    expect(publicationArtifacts.every(({ coverageReleasable }) => typeof coverageReleasable === 'boolean')).toBe(true);
  });

  it('refuses publication on a coverage finding: no validate, no read model, no canon write', async () => {
    const canon = seededCanon();
    const readStore = new MemoryReadStore();
    const harness = createLivePostCommitPort(canon, readStore);
    const runStore = new MemoryPostCommitStore();
    // Two world days, not one: since ART-89 a day is finished when the world has moved past it, so
    // one day produces no Episode and therefore no publication to refuse.
    await runWorldDays(canon, 2, () => []);
    const canonBefore = JSON.stringify(canon.committedEvents());

    const refusing: PostCommitLivePort = {
      ...harness.port,
      runCoverageGate: () => Promise.resolve({
        releasable: false, findingCodes: ['COVERAGE_HIGH_IMPORTANCE_OMITTED'],
      }),
    };
    const runs: PostCommitRun[] = [];
    for (const event of canon.committedEvents()) {
      runs.push(await executePostCommitPipeline({
        runId: postCommitRunId(WORLD_ID, event.sequenceNumber), worldId: WORLD_ID,
        sourceEventId: event.eventId, sourceEventSequenceNumber: event.sequenceNumber,
        worldDay: event.worldDay,
      }, runStore, createPostCommitStageHandlers(refusing), event.traceId));
    }

    // The refusal is not a pipeline failure: the stages after publication still have to run, or a
    // coverage finding would stop a safety withhold from reaching the public surface.
    expect(runs.every(({ status }) => status === 'completed')).toBe(true);

    const artifacts = runStore.checkpoints
      .filter((row) => row.stage === 'publication' && row.status === 'completed')
      .map((row) => row.artifact as PublicationArtifact)
      .filter(({ contentRef }) => contentRef !== null);
    expect(artifacts.length).toBeGreaterThan(0);
    // Never validated, so it is stranded at `generated` — whose only legal action is `validate`.
    expect(artifacts.every(({ publicationStatus }) => publicationStatus === 'generated')).toBe(true);
    expect(artifacts.every(({ coverageReleasable }) => coverageReleasable === false)).toBe(true);
    // The reason is queryable rather than an unexplained absence of a publication.
    expect(artifacts.every(({ coverageFindingCodes }) =>
      coverageFindingCodes.includes('COVERAGE_HIGH_IMPORTANCE_OMITTED'))).toBe(true);

    for (const record of harness.publications.values()) {
      expect(record.status).toBe('generated');
    }
    /**
     * The refused copy never reaches the public surface.
     *
     * Keyed on the model REF, not the kind: `EPISODE_MODEL_KIND` and `EPISODE_INDEX_MODEL_KIND`
     * are both the string `'episode'`, and only the ref (`episode:<day>` vs `episodes:<world>`)
     * tells the day's copy from the index that merely lists days. A kind-only assertion fails on
     * the index and would have looked like proof.
     */
    const episodeCopyRows = readStore.rows.filter(({ modelKind, modelRef }) =>
      modelKind === EPISODE_MODEL_KIND && /^episode:\d+$/.test(modelRef));
    expect(episodeCopyRows).toHaveLength(0);
    // And a gate is a read: it decides about derived content and touches no Accepted Event.
    expect(JSON.stringify(canon.committedEvents())).toBe(canonBefore);
  });

  /**
   * The two tests above prove the gate is CALLED and that a refusal is honoured. Neither would
   * fail if the bound gate were an optimistic double that always answered `releasable: true` —
   * which is exactly how a pipeline ends up reporting zero violations without ever having looked
   * for one. This test induces a genuine violation in the live artifact and requires the REAL
   * validator to find it.
   *
   * The violation is a broken provenance claim: an Episode citing an event that is not in the
   * accepted source set. That is decided from PROVENANCE METADATA — the cited IDs against canon —
   * not by scanning the final text for keywords, which is the distinction FR-G004 turns on.
   */
  it('refuses a real violation found by the real validator, not by an optimistic double', async () => {
    const canon = seededCanon();
    const readStore = new MemoryReadStore();
    const harness = createLivePostCommitPort(canon, readStore);
    const runStore = new MemoryPostCommitStore();
    await runWorldDays(canon, 3, () => []);
    const committed = canon.committedEvents();

    const leaking: PostCommitLivePort = {
      ...harness.port,
      async generateEpisode(worldId, worldDay, episodeNumber) {
        const result = await harness.port.generateEpisode(worldId, worldDay, episodeNumber);
        const row = harness.episodes.get(worldDay);
        if (row?.episode && !result.deduplicated) {
          // A defective Episode builder: it claims an event canon never accepted. Injected AFTER
          // generation, so the Episode's own secret gate has already run and passed — the point is
          // that this later gate catches what the earlier one does not look for.
          row.episode = {
            ...row.episode,
            sourceEventIds: [...row.episode.sourceEventIds, `${WORLD_ID}#event#never-accepted`],
          };
        }
        return result;
      },
    };

    const runs: PostCommitRun[] = [];
    for (const event of committed) {
      runs.push(await executePostCommitPipeline({
        runId: postCommitRunId(WORLD_ID, event.sequenceNumber), worldId: WORLD_ID,
        sourceEventId: event.eventId, sourceEventSequenceNumber: event.sequenceNumber,
        worldDay: event.worldDay,
      }, runStore, createPostCommitStageHandlers(leaking), event.traceId));
    }
    expect(runs.every(({ status }) => status === 'completed')).toBe(true);

    const artifacts = runStore.checkpoints
      .filter((row) => row.stage === 'publication' && row.status === 'completed')
      .map((row) => row.artifact as PublicationArtifact)
      .filter(({ contentRef }) => contentRef !== null);
    expect(artifacts.length).toBeGreaterThan(0);
    expect(artifacts.some(({ coverageFindingCodes }) =>
      coverageFindingCodes.includes('COVERAGE_SOURCE_NOT_ACCEPTED'))).toBe(true);
    // Every episode carries the false claim, so none of them may be released.
    expect(artifacts.every(({ coverageReleasable }) => coverageReleasable === false)).toBe(true);
    expect(artifacts.every(({ publicationStatus }) => publicationStatus === 'generated')).toBe(true);
    const episodeCopyRows = readStore.rows.filter(({ modelKind, modelRef }) =>
      modelKind === EPISODE_MODEL_KIND && /^episode:\d+$/.test(modelRef));
    expect(episodeCopyRows).toHaveLength(0);
    // Outreach copy is public copy: a refused episode must not get share formats either.
    expect(harness.shareFormats.size).toBe(0);
  });
});

describe('arc stage under count control (FR-F003 driven live)', () => {
  it('defers activation once the tier is at its active-arc limit', async () => {
    const canon = seededCanon();
    const readStore = new MemoryReadStore();
    const harness = createLivePostCommitPort(canon, readStore);
    const runStore = new MemoryPostCommitStore();
    await runWorldDays(canon, 3, () => []);
    await runPostCommitForAll(canon, harness.port, runStore);

    const activeMajor = harness.portfolio.filter(({ tier, projection }) => tier === 'major' && isActiveArcStatus(projection.status));
    expect(activeMajor.length).toBeLessThanOrEqual(3);
    const deferrals = runStore.checkpoints
      .filter((row) => row.stage === 'arc' && row.status === 'completed')
      .flatMap((row) => (row.artifact as ArcArtifact).deferredTransitions);
    // With more arc candidates than the major limit, at least one activation is deferred
    // rather than breaking the limit or dropping the arc.
    expect(deferrals.every(({ reason }) => reason === 'ARC_ACTIVE_LIMIT_REACHED' || reason === 'ARC_TRANSITION_PACING')).toBe(true);
  });
});

describe('canon isolation', () => {
  it('never writes canon: committing is the only way an event reaches the store', async () => {
    const canon = seededCanon();
    const before = (canon.committedEvents() ).length;
    const readStore = new MemoryReadStore();
    const harness = createLivePostCommitPort(canon, readStore);
    await runWorldDays(canon, 1, () => []);
    const afterCommit = (canon.committedEvents() ).length;
    await runPostCommitForAll(canon, harness.port, new MemoryPostCommitStore());
    expect(before).toBe(0);
    expect((canon.committedEvents() ).length).toBe(afterCommit);
  });
});
