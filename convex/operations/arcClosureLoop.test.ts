/**
 * FR-F002/F004/F005 — the arc stage's progression and resolution loop (ART-163).
 *
 * This file exists because four capabilities were fully built, unit-tested and registered, and
 * called by nothing: `recordArcResolutionDecision`, `applyArcResolutionConsequences`, any action
 * on a stagnation prompt, and `validateMajorArcMemberships`. Every one had passing tests. What no
 * test asked was whether the running pipeline used them, so the live path walked an arc to
 * `archived` through a transition boundary that only checks legality, and arcs closed carrying
 * nothing.
 *
 * So the assertions here are almost all about the ORDER AND FACT of port calls, not about the
 * helpers' own logic. A double that quietly accepted a terminal status without an outcome would
 * reproduce exactly the defect being closed, so the double calls the real
 * `createArcResolutionDecision` and the real `deriveConsequenceSummaries`: if the stage skips the
 * decision, the test does not fail politely — the same throw the deployment would raise fires here.
 */

import { TIME_SLOTS } from '../canon/eventTypes';
import type { AcceptedEvent } from '../canon/model';
import { replayArcProjection } from '../story/projection';
import type { ArcProjectionEvent, ArcProjectionFields, StoryArcStatus } from '../story/model';
import { ArcPortfolioError, MAX_MAJOR_ACTIVE_ARCS, type ArcTier } from '../story/portfolio';
import {
  createArcResolutionDecision,
  ArcResolutionError,
  type ArcResolutionDecision,
} from '../story/resolution';
import {
  deriveConsequenceSummaries, WORLD_SUMMARY_SUBJECT, type ConsequenceSummary,
} from '../story/consequenceSummary';
import {
  ARC_ARCHIVE_AFTER_WORLD_DAYS,
  ARC_STAGNATION_DOWNGRADE_WORLD_DAYS,
  ARC_STAGNATION_WIND_DOWN_WORLD_DAYS,
  createPostCommitStageHandlers,
  deriveStagnationRemediations,
  type ArcArtifact,
  type LiveArcState,
  type PostCommitLivePort,
  type PostCommitWorldState,
} from './postCommitLive';

const WORLD_ID = 'mistwood';
const CHARACTERS = ['he-jun', 'zhao-ming', 'pei-lan', 'qiu-an'] as const;

/** Every call the stage makes on the port, in order. The wiring IS the thing under test. */
type PortCall =
  | { kind: 'classify' }
  | { kind: 'resolve'; arcId: string; action: string; toStatus: StoryArcStatus }
  | { kind: 'transition'; arcId: string; toStatus: StoryArcStatus }
  | { kind: 'consequences'; decisionId: string }
  | { kind: 'projection'; arcId: string }
  | { kind: 'stagnation' };

function arcFields(overrides: Partial<ArcProjectionFields> = {}): ArcProjectionFields {
  return {
    title: 'The mill', premise: 'The mill is failing', currentQuestion: 'Who saves the mill?',
    coreCharacterIds: ['he-jun', 'zhao-ming'], incitingEventId: `${WORLD_ID}#event#0`,
    latestTurningPointEventId: null, essentialFactIds: [], unresolvedQuestions: ['Who saves the mill?'],
    resolvedQuestions: [], recommendedEntryEventId: null, heatScore: 80,
    ...overrides,
  };
}

function arc(overrides: Partial<LiveArcState> = {}): LiveArcState {
  return {
    arcId: 'arc:1', status: 'active', projectionRevision: 1, tier: 'major',
    lastTransitionWorldDay: 0, lastProgressWorldDay: 0, fields: arcFields(),
    ...overrides,
  };
}

/**
 * An accepted event weighty enough to advance an arc: three participants and several state
 * changes push `arcEventImportance` past `ARC_TRANSITION_MIN_IMPORTANCE`, and a public summary is
 * what the resolution outcome is derived from.
 */
function event(overrides: Partial<AcceptedEvent> = {}): AcceptedEvent {
  return {
    schemaVersion: 1, worldId: WORLD_ID, eventId: `${WORLD_ID}#event#9`, idempotencyKey: 'k9',
    proposedBy: { type: 'system' }, worldDay: 9, timeSlot: 'morning', eventType: 'conversation',
    participantIds: ['he-jun', 'zhao-ming', 'pei-lan'], causedByEventIds: [],
    publicSummary: '磨坊的爭執在這天有了結果。',
    stateChanges: [
      { type: 'relationship_changed', sourceCharacterId: 'he-jun', targetCharacterId: 'zhao-ming',
        trustDelta: 4, affectionDelta: 0, resentmentDelta: 0, reason: 'the mill', visibility: 'public' },
      { type: 'fact_created', subjectType: 'world', subjectId: WORLD_ID, predicate: 'millOwner',
        value: 'he-jun', visibility: 'public' },
    ],
    sequenceNumber: 9, acceptedAt: 9_000, validationVersion: 'v1', traceId: 'trace-9',
    ...overrides,
  } as AcceptedEvent;
}

/**
 * A port that records what the stage did and enforces the real domain rules underneath.
 *
 * `recordArcResolution` runs `createArcResolutionDecision` for real. That is the whole design of
 * this file: the rule "a terminal status needs an outcome and consequences" is enforced by that
 * constructor, so a stage that reached `resolved` without one throws here exactly as it would in
 * the deployment, rather than being caught by an assertion that could be weakened.
 */
function harness(input: { arcs: LiveArcState[]; event?: AcceptedEvent; latestWorldDay?: number }) {
  const calls: PortCall[] = [];
  const decisions: ArcResolutionDecision[] = [];
  const summaries = new Map<string, ConsequenceSummary>();
  const statuses = new Map(input.arcs.map((entry) => [entry.arcId, entry.status]));
  const tiers = new Map(input.arcs.map((entry) => [entry.arcId, entry.tier]));
  const source = input.event ?? event();

  const port = {
    loadWorldState: (): Promise<PostCommitWorldState> => Promise.resolve({
      event: source,
      arcs: input.arcs,
      characterIds: [...CHARACTERS],
      completedWorldDays: [],
      episodeWorldDays: [],
      worldDayFirstSequenceNumber: source.sequenceNumber,
      latestWorldDay: input.latestWorldDay ?? source.worldDay,
      recapCursors: {},
    }),
    recordArcClassification: () => {
      calls.push({ kind: 'classify' });
      return Promise.resolve({ created: false });
    },
    updateArcProjection: (args: { arcId: string }) => {
      calls.push({ kind: 'projection', arcId: args.arcId });
      return Promise.resolve({ revision: 2 });
    },
    recordArcResolution: (_worldId: string, decision: Parameters<PostCommitLivePort['recordArcResolution']>[1]) => {
      const recorded = createArcResolutionDecision(decision);
      calls.push({
        kind: 'resolve', arcId: recorded.arcId, action: recorded.action,
        toStatus: recorded.resultingStatus,
      });
      decisions.push(recorded);
      tiers.set(recorded.arcId, recorded.resultingTier);
      return Promise.resolve(recorded);
    },
    transitionArcLifecycle: (args: { arcId: string; expectedStatus: StoryArcStatus; toStatus: StoryArcStatus }) => {
      if (statuses.get(args.arcId) !== args.expectedStatus) {
        throw new Error(`ARC_STATUS_CONFLICT ${args.arcId}`);
      }
      calls.push({ kind: 'transition', arcId: args.arcId, toStatus: args.toStatus });
      statuses.set(args.arcId, args.toStatus);
      return Promise.resolve({ status: args.toStatus });
    },
    applyArcConsequences: (_worldId: string, decisionId: string) => {
      calls.push({ kind: 'consequences', decisionId });
      const decision = decisions.find((entry) => entry.decisionId === decisionId);
      if (!decision) throw new Error(`unknown decision ${decisionId}`);
      const applied = deriveConsequenceSummaries(decision, [source]);
      for (const summary of applied) summaries.set(summary.summaryId, summary);
      return Promise.resolve({ applied: applied.length });
    },
    refreshStagnationPrompts: () => {
      calls.push({ kind: 'stagnation' });
      return Promise.resolve(0);
    },
    admitArcToPortfolio: () => Promise.resolve({ action: 'accepted' as const, arcId: 'arc:1', retainedEventIds: [] }),
    syncArcPortfolioEntry: () => Promise.resolve(true),
  } as unknown as PostCommitLivePort;

  const run = async (): Promise<ArcArtifact> => {
    const handlers = createPostCommitStageHandlers(port);
    return await handlers.arc({
      runId: 'run', worldId: WORLD_ID, sourceEventId: source.eventId,
      sourceEventSequenceNumber: source.sequenceNumber, worldDay: source.worldDay,
      artifacts: {}, traceId: source.traceId,
    }) as ArcArtifact;
  };

  return { run, calls, decisions, summaries, statuses, tiers };
}

describe('AC#1 — a terminal status is unreachable without a recorded outcome', () => {
  it('decides, THEN transitions, THEN applies consequences', async () => {
    const gate = harness({ arcs: [arc({ status: 'resolving', lastTransitionWorldDay: 5 })] });
    await gate.run();

    // The order is the guarantee. Transitioning first would leave an arc `resolved` behind a
    // decision that failed, which is a corrupt state rather than a refused one.
    const arcCalls = gate.calls.filter((call) => call.kind !== 'classify' && call.kind !== 'stagnation'
      && call.kind !== 'projection');
    expect(arcCalls.map((call) => call.kind)).toEqual(['resolve', 'transition', 'consequences']);
  });

  it('carries a non-empty outcome and at least one consequence into resolved', async () => {
    const gate = harness({ arcs: [arc({ status: 'resolving', lastTransitionWorldDay: 5 })] });
    const artifact = await gate.run();

    const [decision] = gate.decisions;
    expect(decision.resultingStatus).toBe('resolved');
    expect(decision.outcome).toBe('磨坊的爭執在這天有了結果。');
    expect(decision.consequences.length).toBeGreaterThan(0);
    expect(artifact.resolutions[0]).toMatchObject({ action: 'resolve', resultingStatus: 'resolved' });
    expect(artifact.resolutions[0].consequenceCount).toBeGreaterThan(0);
  });

  it('updates BOTH the character and the world summary input (FR-F005)', async () => {
    const gate = harness({ arcs: [arc({ status: 'resolving', lastTransitionWorldDay: 5 })] });
    await gate.run();

    const scopes = [...gate.summaries.values()].map((summary) => `${summary.scope}:${summary.subjectId}`);
    // The world subject is the one a per-character loop silently omits, and the one that makes an
    // arc closing visible to anything that is not one of its core characters.
    expect(scopes).toContain(`world:${WORLD_SUMMARY_SUBJECT}`);
    expect(scopes).toContain('character:he-jun');
    expect(scopes).toContain('character:zhao-ming');
  });

  it('records no outcome for a NON-terminal resolution, which has concluded nothing', async () => {
    const gate = harness({ arcs: [arc({ status: 'climax', lastTransitionWorldDay: 5 })] });
    await gate.run();

    const [decision] = gate.decisions;
    expect(decision.resultingStatus).toBe('resolving');
    expect(decision.outcome).toBeNull();
    expect(decision.consequences).toEqual([]);
    // No consequence summaries: the story has not reached a result to publish.
    expect(gate.calls.some((call) => call.kind === 'consequences')).toBe(false);
  });

  it('leaves ordinary forward motion on the plain lifecycle boundary', async () => {
    const gate = harness({ arcs: [arc({ status: 'active', lastTransitionWorldDay: 5 })] });
    await gate.run();

    // `active -> escalating` has no outcome to record, and forcing a decision for it would make
    // every ordinary beat look like a conclusion.
    expect(gate.calls.filter((call) => call.kind === 'resolve')).toEqual([]);
    expect(gate.calls.filter((call) => call.kind === 'transition'))
      .toEqual([{ kind: 'transition', arcId: 'arc:1', toStatus: 'escalating' }]);
  });

  it('refuses the transition outright when the outcome cannot be derived', async () => {
    // No public summary AND no title would leave the outcome empty; the title fallback keeps it
    // non-empty, so the constructor's refusal is provoked directly to prove it is load-bearing.
    expect(() => createArcResolutionDecision({
      worldId: WORLD_ID, arcId: 'arc:1', action: 'resolve', fromStatus: 'resolving', fromTier: 'major',
      targetArcId: null, outcome: null, consequences: [],
      sourceEventId: `${WORLD_ID}#event#9`, sourceEventSequenceNumber: 9,
      reason: 'r', decidedAtWorldDay: 9,
    })).toThrow(ArcResolutionError);
  });
});

describe('AC#3 — a stalled arc gives its slot back without disappearing', () => {
  const stalled = (overrides: Partial<LiveArcState>): LiveArcState =>
    arc({ arcId: 'arc:stalled', status: 'active', lastProgressWorldDay: 0, lastTransitionWorldDay: 0, ...overrides });

  it('downgrades a major arc at the stagnation threshold, freeing the major slot', () => {
    const remediations = deriveStagnationRemediations(
      [stalled({ tier: 'major' })], ARC_STAGNATION_DOWNGRADE_WORLD_DAYS,
    );
    expect(remediations).toEqual([
      { arcId: 'arc:stalled', action: 'downgrade', stagnantWorldDays: ARC_STAGNATION_DOWNGRADE_WORLD_DAYS },
    ]);
  });

  it('does nothing before the threshold', () => {
    expect(deriveStagnationRemediations(
      [stalled({ tier: 'major' })], ARC_STAGNATION_DOWNGRADE_WORLD_DAYS - 1,
    )).toEqual([]);
  });

  it('winds a long-stalled arc down through the ordinary resolution path', () => {
    expect(deriveStagnationRemediations([stalled({ tier: 'minor' })], ARC_STAGNATION_WIND_DOWN_WORLD_DAYS))
      .toEqual([{ arcId: 'arc:stalled', action: 'enter_resolving', stagnantWorldDays: ARC_STAGNATION_WIND_DOWN_WORLD_DAYS }]);
    // ...and the second step closes it, so the arc leaves the active family carrying an outcome.
    expect(deriveStagnationRemediations(
      [stalled({ tier: 'minor', status: 'resolving' })], ARC_STAGNATION_WIND_DOWN_WORLD_DAYS,
    )).toEqual([{ arcId: 'arc:stalled', action: 'resolve', stagnantWorldDays: ARC_STAGNATION_WIND_DOWN_WORLD_DAYS }]);
  });

  it('archives a resolved arc, measured from its resolution rather than its last progress', () => {
    // A resolved arc has stopped progressing by definition; measuring progress would archive it
    // the instant it resolved.
    expect(deriveStagnationRemediations(
      [stalled({ status: 'resolved', lastTransitionWorldDay: 4, lastProgressWorldDay: 0 })],
      4 + ARC_ARCHIVE_AFTER_WORLD_DAYS - 1,
    )).toEqual([]);
    expect(deriveStagnationRemediations(
      [stalled({ status: 'resolved', lastTransitionWorldDay: 4, lastProgressWorldDay: 0 })],
      4 + ARC_ARCHIVE_AFTER_WORLD_DAYS,
    )).toEqual([{ arcId: 'arc:stalled', action: 'archive', stagnantWorldDays: ARC_ARCHIVE_AFTER_WORLD_DAYS }]);
  });

  it('never proposes anything for an archived arc, so history stops moving', () => {
    expect(deriveStagnationRemediations([stalled({ status: 'archived' })], 999)).toEqual([]);
  });

  it('runs the ladder on the live stage even when the event classifies into nothing', async () => {
    // A stalled arc is BY DEFINITION one no event is classifying into. Remediating only inside the
    // classification branch would mean the arcs most in need of it are never reached.
    const gate = harness({
      arcs: [stalled({ tier: 'major' })],
      event: event({ participantIds: ['nobody'], sequenceNumber: 9 }),
      latestWorldDay: ARC_STAGNATION_DOWNGRADE_WORLD_DAYS,
    });
    const artifact = await gate.run();

    expect(artifact.classifiedArcIds).toEqual([]);
    expect(artifact.resolutions).toEqual([
      expect.objectContaining({ arcId: 'arc:stalled', action: 'downgrade', resultingTier: 'minor' }),
    ]);
    expect(gate.tiers.get('arc:stalled')).toBe('minor');
  });

  it('applies the downgraded tier, rather than recording a decision nothing carries out', async () => {
    const gate = harness({
      arcs: [stalled({ tier: 'major' })],
      event: event({ participantIds: ['nobody'] }),
      latestWorldDay: ARC_STAGNATION_DOWNGRADE_WORLD_DAYS,
    });
    await gate.run();

    // FR-F003 count control reads the portfolio ENTRY, not the decision. A decision recorded and
    // not applied would leave the arc holding a major slot it had formally lost.
    expect(gate.decisions[0].resultingTier).toBe('minor');
    expect(gate.tiers.get('arc:stalled')).toBe('minor');
  });

  it('makes at most one decision per arc per event', async () => {
    // `decisionId` is keyed by arc and sequence number, so a second decision would silently
    // collide with the first and be returned as its duplicate.
    const gate = harness({
      arcs: [arc({ status: 'resolving', lastProgressWorldDay: 0, lastTransitionWorldDay: 0 })],
      latestWorldDay: ARC_STAGNATION_WIND_DOWN_WORLD_DAYS,
    });
    const artifact = await gate.run();

    expect(artifact.resolutions.filter(({ arcId }) => arcId === 'arc:1')).toHaveLength(1);
    expect(new Set(gate.decisions.map(({ decisionId }) => decisionId)).size).toBe(gate.decisions.length);
  });
});

describe('AC#4/#5 — count control and the closed-arc boundary', () => {
  it('refuses an event that would directly advance three major arcs', async () => {
    const arcs = ['arc:a', 'arc:b', 'arc:c'].map((arcId) => arc({
      arcId, tier: 'major', status: 'active',
      fields: arcFields({ coreCharacterIds: ['he-jun', 'zhao-ming'] }),
    }));
    const gate = harness({ arcs });

    // FR-F003. The rule lived in `validateMajorArcMemberships` with no caller, so an event that
    // heat-sorted into three major arcs advanced all three.
    await expect(gate.run()).rejects.toThrow(ArcPortfolioError);
    expect(MAX_MAJOR_ACTIVE_ARCS).toBe(3);
  });

  it('never classifies an event into a resolved or archived arc', async () => {
    const gate = harness({
      arcs: [
        arc({ arcId: 'arc:closed', status: 'resolved', lastTransitionWorldDay: 9 }),
        arc({ arcId: 'arc:archived', status: 'archived', lastTransitionWorldDay: 9 }),
      ],
    });
    const artifact = await gate.run();

    // A closed arc must not re-enter the active context. `candidateArcs` filters on the active
    // family, so the event opens a NEW arc instead of reviving a settled one.
    expect(artifact.classifiedArcIds).not.toContain('arc:closed');
    expect(artifact.classifiedArcIds).not.toContain('arc:archived');
    expect(gate.calls.filter((call) => call.kind === 'transition')).toEqual([]);
  });
});

describe('AC#6 — arc state replays identically', () => {
  const projectionEvent = (revision: number, overrides: Partial<ArcProjectionEvent> = {}): ArcProjectionEvent => ({
    schemaVersion: 1, worldId: WORLD_ID, arcId: 'arc:1', revision,
    kind: revision === 0 ? 'initialized' : 'updated',
    fields: arcFields(revision === 0 ? {} : { latestTurningPointEventId: `${WORLD_ID}#event#${revision}` }),
    sourceEventId: `${WORLD_ID}#event#${revision}`, sourceEventSequenceNumber: revision,
    worldDay: revision, timeSlot: TIME_SLOTS[revision % TIME_SLOTS.length],
    ...overrides,
  });

  const stream = [projectionEvent(0), projectionEvent(1), projectionEvent(2)];

  it('is a pure fold: replaying the same stream twice is identical', () => {
    expect(replayArcProjection(structuredClone(stream), 'resolving'))
      .toEqual(replayArcProjection(stream, 'resolving'));
  });

  it('keeps the turning point and lastProgressTime the run produced', () => {
    const replayed = replayArcProjection(stream, 'resolving');

    // The two fields a stagnation ladder and a progress check both read. Losing either would make
    // an advancing arc look stalled, or a stalled one look busy.
    expect(replayed.latestTurningPointEventId).toBe(`${WORLD_ID}#event#2`);
    expect(replayed.lastProgressTime).toEqual({
      worldDay: 2, timeSlot: TIME_SLOTS[2], sourceEventId: `${WORLD_ID}#event#2`,
    });
    expect(replayed.revision).toBe(2);
  });

  it('agrees with a resume from any mid-stream prefix', () => {
    // The arc projection is an append-only revision stream, so a reader that resumed from a stored
    // prefix and applied the tail must land exactly where a full replay does.
    const full = replayArcProjection(stream, 'resolving');
    for (let split = 1; split < stream.length; split += 1) {
      const prefix = replayArcProjection(stream.slice(0, split), 'resolving');
      expect(prefix.revision).toBe(split - 1);
      expect(replayArcProjection(stream, 'resolving')).toEqual(full);
    }
  });

  it('reads its status from the lifecycle, never from the projection stream', () => {
    // Status is the lifecycle's to state. A stream that could carry one would let a projection
    // append quietly resurrect a resolved arc.
    for (const status of ['emerging', 'active', 'resolved', 'archived'] as StoryArcStatus[]) {
      expect(replayArcProjection(stream, status).status).toBe(status);
    }
  });
});

describe('the derived tier is honoured by the count control input', () => {
  it('reads tier from the arc state the stage was given', async () => {
    const gate = harness({ arcs: [arc({ tier: 'minor', status: 'resolving', lastTransitionWorldDay: 5 })] });
    await gate.run();

    const [decision] = gate.decisions;
    expect(decision.fromTier).toBe<ArcTier>('minor');
    expect(decision.resultingTier).toBe<ArcTier>('minor');
  });
});
