/**
 * FR-B003 — persona deviation detection and character summaries (ART-11).
 *
 * Every test here names the criterion it settles. The two that matter most are negatives:
 * AC#2 requires that an unsupported reversal does not enter Canon, so it is settled by committing
 * through the real pipeline and then asserting the store is still empty — not by inspecting a
 * return value that a broken commit would produce anyway.
 */

import { commitProposedEvent } from './commit';
import { InMemoryCanonStore } from './inMemoryStore';
import {
  PERSONA_JUSTIFICATIONS,
  PERSONA_MARKER_MIN_MEMORY_IMPORTANCE,
  PERSONA_SIGNIFICANT_RELATIONSHIP_SWING,
  assessPersonaDeviations,
  buildCharacterSummaries,
  personaAnchorFromSeed,
  type PersonaAnchor,
  type PersonaJustification,
} from './personaDeviation';
import {
  emptyProjection,
  type AcceptedEvent,
  type CanonRuleContext,
  type ProposedEvent,
  type StateChange,
  type WorldProjection,
} from './model';
import { validateCanon, validateEventStructure } from './validators';

const LIN: PersonaAnchor = {
  characterId: 'lin', occupation: 'reporter', organizationIds: ['press'],
  personalityTraits: ['observant', 'stubborn'], values: ['truth'],
};
const WU: PersonaAnchor = {
  characterId: 'wu', occupation: 'courier', organizationIds: [],
  personalityTraits: ['impulsive'], values: ['freedom'],
};
const ANCHORS = { lin: LIN, wu: WU };

const context: CanonRuleContext = {
  worldId: 'w', rules: [], characterIds: ['lin', 'wu', 'gao'],
  locationIds: ['paper', 'hall'], organizationIds: ['press', 'council'],
  initialCharacterAlive: { lin: true, wu: true, gao: true },
  characterPersonas: ANCHORS,
};

function proposal(overrides: Partial<ProposedEvent> = {}): ProposedEvent {
  return {
    schemaVersion: 1, worldId: 'w', idempotencyKey: 'persona-1',
    proposedBy: { type: 'character', id: 'lin' }, worldDay: 3, timeSlot: 'evening',
    eventType: 'conversation', participantIds: ['lin', 'wu'], causedByEventIds: [],
    stateChanges: [], ...overrides,
  };
}

function accepted(sequenceNumber: number, overrides: Partial<ProposedEvent> = {}): AcceptedEvent {
  return {
    ...proposal({ idempotencyKey: `persona-${sequenceNumber}`, ...overrides }),
    eventId: `w#event#${sequenceNumber}`, sequenceNumber, acceptedAt: 1_700_000_000_000 + sequenceNumber,
    validationVersion: 'canon-v1', traceId: `trace-${sequenceNumber}`,
  };
}

/** A projection in which `lin` already trusts `wu` warmly, so a swing can invert it. */
function trusting(trust = 50): WorldProjection {
  return {
    ...emptyProjection('w'),
    relationships: {
      'lin|wu': { trust, affection: 20, resentment: 0, fear: 0, dependency: 0, familiarity: 40, lastUpdatedEventId: 'seed' },
    },
  };
}

function relationshipChange(overrides: Partial<Extract<StateChange, { type: 'relationship_changed' }>> = {}): StateChange {
  return {
    type: 'relationship_changed', sourceCharacterId: 'lin', targetCharacterId: 'wu',
    trustDelta: 0, affectionDelta: 0, resentmentDelta: 0, fearDelta: 0, dependencyDelta: 0,
    familiarityDelta: 0, reason: 'a private reason that must never reach an operator surface',
    visibility: 'private', ...overrides,
  };
}

/** The four supports, each expressed as the extra state changes (or fields) that provide it. */
const SUPPORTS: Record<PersonaJustification, Partial<ProposedEvent>> = {
  emotional_change: {
    stateChanges: [{ type: 'character_state_changed', characterId: 'lin', field: 'emotion', toValue: 'devastated', reason: 'the source recanted' }],
  },
  major_event_cause: { causedByEventIds: ['w#event#0'] },
  goal_conflict: {
    stateChanges: [relationshipChange({ targetCharacterId: 'gao', resentmentDelta: 5 })],
    participantIds: ['lin', 'wu', 'gao'],
  },
  growth_or_breakdown: {
    stateChanges: [{
      type: 'character_memory_formed', characterId: 'lin', content: 'the night the story died',
      interpretation: 'I was wrong to trust him', importance: PERSONA_MARKER_MIN_MEMORY_IMPORTANCE,
      emotionalWeight: -0.9, confidence: 0.9, visibility: 'private',
    }],
  },
};

/** Rule context that can corroborate `w#event#0` as a cause `lin` was materially part of. */
const withKnownCause: CanonRuleContext = {
  ...context,
  knownEventIds: ['w#event#0'],
  knownEventParticipantIds: { 'w#event#0': ['lin', 'wu'] },
};

const trustReversal = relationshipChange({ trustDelta: -100 });

describe('AC#1 — a high-importance persona deviation is flagged', () => {
  it('flags a supported reversal and records it as a turning point in the summary', () => {
    const event = accepted(0, {
      stateChanges: [trustReversal, ...(SUPPORTS.emotional_change.stateChanges ?? [])],
    });
    const [assessment] = assessPersonaDeviations(event, trusting(), { anchors: ANCHORS });
    expect(assessment).toMatchObject({
      characterId: 'lin', severity: 'reversal', outcome: 'flag', justifications: ['emotional_change'],
      signals: [{ kind: 'relationship_polarity_reversed', dimension: 'trust', from: 50, to: -50 }],
    });

    const summaries = buildCharacterSummaries(trusting(), [event], ANCHORS);
    expect(summaries.lin.flags).toEqual([expect.objectContaining({
      eventId: 'w#event#0', sequenceNumber: 0, worldDay: 3, timeSlot: 'evening',
      severity: 'reversal', turningPoint: true,
    })]);
    // AC#3's refresh signal, observable without diffing the flag list.
    expect(summaries.lin.version).toBe(2);
    expect(summaries.lin.lastTurningPointEventId).toBe('w#event#0');
    // A character who did nothing keeps the seeded persona, and still gets a summary.
    expect(summaries.wu).toEqual({ characterId: 'wu', anchor: WU, version: 1, flags: [], lastTurningPointEventId: null });
  });

  it('flags leaving a seeded trade and a seeded organization, from the seed rather than the projection', () => {
    // Neither field has ever been written by an event, so the projection holds nothing for `lin`.
    // Detection has to fall back to the seeded anchor, or a character's FIRST departure — the only
    // one that departs from persona at all — would be the one departure nobody ever sees.
    const quit = proposal({
      stateChanges: [
        { type: 'character_state_changed', characterId: 'lin', field: 'occupation', toValue: 'innkeeper', reason: 'walked out' },
        { type: 'character_state_changed', characterId: 'lin', field: 'organization_memberships', toValue: [], reason: 'left the paper' },
        ...(SUPPORTS.growth_or_breakdown.stateChanges ?? []),
      ],
    });
    expect(validateEventStructure(quit)).toBeNull();
    const [assessment] = assessPersonaDeviations(quit, emptyProjection('w'), { anchors: ANCHORS });
    expect(assessment.signals).toEqual([
      { kind: 'occupation_abandoned', severity: 'reversal', from: 'reporter', to: 'innkeeper' },
      { kind: 'seeded_organization_left', severity: 'reversal', organizationIds: ['press'] },
    ]);
    expect(assessment.outcome).toBe('flag');
    expect(validateCanon(quit, emptyProjection('w'), context)).toBeNull();
  });

  it('flags a large same-sign swing without calling it a turning point', () => {
    // Trusting someone you already trusted rather more is a big move within the character, not a
    // new character. If this ever became a turning point, every summary would be "refreshed" by
    // ordinary drama and the version number would stop meaning anything.
    const event = accepted(0, {
      stateChanges: [
        relationshipChange({ trustDelta: PERSONA_SIGNIFICANT_RELATIONSHIP_SWING }),
        ...(SUPPORTS.emotional_change.stateChanges ?? []),
      ],
    });
    const [assessment] = assessPersonaDeviations(event, trusting(), { anchors: ANCHORS });
    expect(assessment).toMatchObject({ severity: 'deviation', outcome: 'flag' });
    expect(assessment.signals).toEqual([{
      kind: 'relationship_swing', severity: 'deviation', targetCharacterId: 'wu',
      dimension: 'trust', from: 50, to: 90,
    }]);

    const summary = buildCharacterSummaries(trusting(), [event], ANCHORS).lin;
    expect(summary.flags).toHaveLength(1);
    expect(summary.flags[0].turningPoint).toBe(false);
    expect(summary.version).toBe(1);
    expect(summary.lastTurningPointEventId).toBeNull();
  });

  it('leaves ordinary play alone', () => {
    const cases: Array<[string, ProposedEvent, WorldProjection]> = [
      ['a swing one point below the threshold', proposal({
        stateChanges: [relationshipChange({ trustDelta: -(PERSONA_SIGNIFICANT_RELATIONSHIP_SWING - 1) })],
      }), trusting(20)],
      ['a character with no seeded anchor', proposal({
        participantIds: ['gao', 'wu'], proposedBy: { type: 'character', id: 'gao' },
        stateChanges: [relationshipChange({ sourceCharacterId: 'gao', trustDelta: -100 })],
      }), { ...emptyProjection('w'), relationships: { 'gao|wu': { trust: 60, affection: 0, resentment: 0, fear: 0, dependency: 0, familiarity: 0, lastUpdatedEventId: 'seed' } } }],
      ['a second job move, once the seeded trade is already gone', proposal({
        stateChanges: [{ type: 'character_state_changed', characterId: 'lin', field: 'occupation', toValue: 'archivist', reason: 'a further move' }],
      }), { ...emptyProjection('w'), characterStates: { lin: { occupation: 'innkeeper', lastUpdatedEventId: 'earlier' } } }],
    ];
    for (const [label, event, projection] of cases) {
      expect([label, assessPersonaDeviations(event, projection, { anchors: ANCHORS })]).toEqual([label, []]);
      expect([label, validateCanon(event, projection, context)]).toEqual([label, null]);
    }
  });

  it('does not call a first-ever relationship a reversal', () => {
    // Nothing was inverted: the pair had no recorded standing to invert. It is still a major
    // action, so it is reported — as a deviation needing review, not as a reversal to refuse.
    const [assessment] = assessPersonaDeviations(
      proposal({ stateChanges: [relationshipChange({ trustDelta: -60 })] }),
      emptyProjection('w'), { anchors: ANCHORS },
    );
    expect(assessment).toMatchObject({
      severity: 'deviation', outcome: 'review',
      signals: [{ kind: 'relationship_swing', from: 0, to: -60 }],
    });
  });

  it('never lets an unflagged first relationship hide behind a mixed event', () => {
    // Two dimensions move at once; both must be reported, and the reversal must set the severity
    // for the whole assessment rather than the deviation it is bundled with.
    const event = proposal({
      stateChanges: [
        relationshipChange({ trustDelta: -100, dependencyDelta: 60 }),
        ...(SUPPORTS.emotional_change.stateChanges ?? []),
      ],
    });
    const [assessment] = assessPersonaDeviations(event, trusting(), { anchors: ANCHORS });
    expect(assessment.signals.map((signal) => signal.kind))
      .toEqual(['relationship_polarity_reversed', 'relationship_swing']);
    expect(assessment.severity).toBe('reversal');
  });
});

describe('AC#2 — an unsupported persona reversal is rejected or sent for review', () => {
  it('keeps an unsupported reversal out of Canon entirely', async () => {
    const store = new InMemoryCanonStore();
    store.setCanonRuleContext(context);
    // Establish the warm relationship through the pipeline, supported, so the reversal has
    // something real to invert and the whole scenario is one Canon actually produced.
    await commitProposedEvent(store, {
      proposed: proposal({
        idempotencyKey: 'warm', stateChanges: [
          relationshipChange({ trustDelta: 50 }),
          ...(SUPPORTS.emotional_change.stateChanges ?? []),
        ],
      }),
      traceId: 'trace-warm',
    });
    expect(store.committedEvents()).toHaveLength(1);

    await expect(commitProposedEvent(store, {
      proposed: proposal({ idempotencyKey: 'reversal', stateChanges: [trustReversal] }),
      traceId: 'trace-reversal',
    })).rejects.toMatchObject({ error: { code: 'UNSUPPORTED_PERSONA_REVERSAL' } });
    expect(store.committedEvents()).toHaveLength(1);
  });

  it('sends an unsupported same-sign deviation to human review instead of rejecting it outright', () => {
    const error = validateCanon(
      proposal({ stateChanges: [relationshipChange({ trustDelta: PERSONA_SIGNIFICANT_RELATIONSHIP_SWING })] }),
      trusting(), context,
    );
    expect(error).toMatchObject({ code: 'PERSONA_DEVIATION_REVIEW_REQUIRED' });
  });

  it('reports the structured signal and never the free-text reason', () => {
    // A rejection is read by every role that may inspect the world. `reason` on a private
    // relationship change may carry a secret, so the code path that explains a refusal must not
    // be the path that leaks one.
    const error = validateCanon(proposal({ stateChanges: [trustReversal] }), trusting(), context);
    expect(error).toMatchObject({
      code: 'UNSUPPORTED_PERSONA_REVERSAL',
      details: { characterId: 'lin', requiredJustifications: [...PERSONA_JUSTIFICATIONS] },
    });
    expect(JSON.stringify(error)).not.toContain('private reason');
  });

  it.each(PERSONA_JUSTIFICATIONS)('accepts the same reversal once %s supports it', (justification) => {
    const support = SUPPORTS[justification];
    const event = proposal({
      ...support,
      participantIds: support.participantIds ?? ['lin', 'wu'],
      stateChanges: [trustReversal, ...(support.stateChanges ?? [])],
    });
    expect(validateEventStructure(event)).toBeNull();
    expect(validateCanon(event, trusting(), withKnownCause)).toBeNull();
    const [assessment] = assessPersonaDeviations(event, trusting(), {
      anchors: ANCHORS, eventParticipants: withKnownCause.knownEventParticipantIds,
    });
    expect(assessment.justifications).toEqual([justification]);
    expect(assessment.outcome).toBe('flag');
  });

  it('does not let a reversal supply its own conflict', () => {
    // A trust reversal IS trust going down, so a naive "was there an adversarial relationship
    // change?" check would find the reversal itself and clear every reversal ever proposed.
    expect(validateCanon(proposal({ stateChanges: [trustReversal] }), trusting(), context))
      .toMatchObject({ code: 'UNSUPPORTED_PERSONA_REVERSAL' });
    expect(validateCanon(
      proposal({ stateChanges: [relationshipChange({ resentmentDelta: 60 })] }),
      { ...emptyProjection('w'), relationships: { 'lin|wu': { trust: 0, affection: 0, resentment: -20, fear: 0, dependency: 0, familiarity: 0, lastUpdatedEventId: 'seed' } } },
      context,
    )).toMatchObject({ code: 'UNSUPPORTED_PERSONA_REVERSAL' });
  });

  it('does not let a cited cause count unless it materially involved the character', () => {
    const cited = proposal({ causedByEventIds: ['w#event#0'], stateChanges: [trustReversal] });
    const withoutLin: CanonRuleContext = {
      ...withKnownCause, knownEventParticipantIds: { 'w#event#0': ['wu', 'gao'] },
    };
    expect(validateCanon(cited, trusting(), withoutLin))
      .toMatchObject({ code: 'UNSUPPORTED_PERSONA_REVERSAL' });
    expect(validateCanon(cited, trusting(), withKnownCause)).toBeNull();
  });

  it('stays inert without seeded anchors, and exempts a correction', () => {
    // Two ways a world reaches this gate legitimately unjudgeable. Neither may turn into a refusal:
    // an unseeded world would stop committing entirely, and re-judging a correction would report a
    // character as changed when only the account of them was fixed.
    const reversal = proposal({ stateChanges: [trustReversal] });
    const { characterPersonas: _omitted, ...unseeded } = context;
    expect(validateCanon(reversal, trusting(), unseeded)).toBeNull();
    expect(validateCanon(reversal, trusting(), null)).toBeNull();
    const correction = proposal({
      eventType: 'correction', proposedBy: { type: 'admin', id: 'ops' },
      causedByEventIds: ['w#event#0'], stateChanges: [trustReversal],
    });
    expect(validateCanon(correction, trusting(), {
      ...context, knownEventIds: ['w#event#0'], knownEventParticipantIds: { 'w#event#0': ['wu'] },
    })).toBeNull();
  });

  it('reports a malformed event as malformed, not as out of character', () => {
    // Ordering evidence: a persona verdict about a character who does not exist would tell an
    // operator nothing they can act on.
    const unknownCharacter = proposal({
      participantIds: ['lin', 'ghost'],
      stateChanges: [relationshipChange({ targetCharacterId: 'ghost', trustDelta: -100 })],
    });
    expect(validateCanon(unknownCharacter, trusting(), context))
      .toMatchObject({ code: 'UNKNOWN_CHARACTER_REFERENCE' });
  });
});

describe('AC#3 — a turning point refreshes the character summary', () => {
  const warm = accepted(0, {
    idempotencyKey: 'warm',
    stateChanges: [relationshipChange({ trustDelta: 50 }), ...(SUPPORTS.emotional_change.stateChanges ?? [])],
  });
  const betrayal = accepted(1, {
    idempotencyKey: 'betrayal',
    stateChanges: [trustReversal, ...(SUPPORTS.growth_or_breakdown.stateChanges ?? [])],
  });
  const resignation = accepted(2, {
    idempotencyKey: 'resignation',
    stateChanges: [
      { type: 'character_state_changed', characterId: 'lin', field: 'occupation', toValue: 'innkeeper', reason: 'walked out' },
      ...(SUPPORTS.emotional_change.stateChanges ?? []),
    ],
  });

  it('bumps the version once per turning point and tracks the event that caused it', () => {
    const summary = buildCharacterSummaries(emptyProjection('w'), [warm, betrayal, resignation], ANCHORS).lin;
    expect(summary.flags.map((flag) => [flag.eventId, flag.severity, flag.turningPoint])).toEqual([
      ['w#event#0', 'deviation', false],
      ['w#event#1', 'reversal', true],
      ['w#event#2', 'reversal', true],
    ]);
    expect(summary.version).toBe(3);
    expect(summary.lastTurningPointEventId).toBe('w#event#2');
    expect(summary.anchor).toEqual(LIN);
  });

  it('rebuilds identically, and judges each event against the world as it was before it', () => {
    const events = [warm, betrayal, resignation];
    expect(buildCharacterSummaries(emptyProjection('w'), events, ANCHORS))
      .toEqual(buildCharacterSummaries(emptyProjection('w'), events, ANCHORS));
    // `betrayal` reads as a reversal only because `warm` had already been folded in. Assessing it
    // against the empty projection — the mistake a summary built from a stale view would make —
    // produces a plain swing from zero instead.
    const [standalone] = assessPersonaDeviations(betrayal, emptyProjection('w'), { anchors: ANCHORS });
    expect(standalone.severity).toBe('deviation');
    const rebuilt = buildCharacterSummaries(emptyProjection('w'), events, ANCHORS);
    expect(rebuilt.lin.flags[1].signals).toEqual([{
      kind: 'relationship_polarity_reversed', severity: 'reversal', targetCharacterId: 'wu',
      dimension: 'trust', from: 50, to: -50,
    }]);
  });

  it('records unjustified history rather than hiding or re-judging it', () => {
    // Events accepted before this gate existed. Canon never re-judges accepted history, so the
    // summary reports them with an empty support list instead of dropping them.
    const legacy = accepted(0, { stateChanges: [relationshipChange({ trustDelta: -100 })] });
    const summary = buildCharacterSummaries(trusting(), [legacy], ANCHORS).lin;
    expect(summary.flags).toHaveLength(1);
    expect(summary.flags[0].justifications).toEqual([]);
    expect(summary.flags[0].turningPoint).toBe(true);
  });

  it('does not mutate the projection or the events it folds', () => {
    const events = [warm, betrayal];
    const before = JSON.stringify(events);
    const projection = trusting();
    const projectionBefore = JSON.stringify(projection);
    buildCharacterSummaries(projection, events, ANCHORS);
    expect(JSON.stringify(events)).toBe(before);
    expect(JSON.stringify(projection)).toBe(projectionBefore);
  });
});

describe('seeded anchors', () => {
  it('reads the structural fields and nothing private', () => {
    const anchor = personaAnchorFromSeed('lin', {
      id: 'lin', name: 'Lin Yingxue', occupation: 'reporter', organizationIds: ['press'],
      personalityTraits: ['observant'], values: ['truth'],
      privateProfile: 'she suspects her mentor hid evidence', privateGoal: 'find the ledger',
      fear: 'publishing an accusation she cannot prove', behaviorRules: ['two sources'],
    });
    expect(anchor).toEqual({
      characterId: 'lin', occupation: 'reporter', organizationIds: ['press'],
      personalityTraits: ['observant'], values: ['truth'],
    });
    expect(JSON.stringify(anchor)).not.toContain('mentor');
  });

  it('yields no anchor rather than throwing on a payload it cannot use', () => {
    for (const payload of [null, undefined, 'lin', [], {}, { occupation: '' }, { occupation: 7 }]) {
      expect(personaAnchorFromSeed('lin', payload)).toBeNull();
    }
    expect(personaAnchorFromSeed('lin', { occupation: 'reporter', organizationIds: ['press', 3] }))
      .toMatchObject({ organizationIds: ['press'] });
  });
});
