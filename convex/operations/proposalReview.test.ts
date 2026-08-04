/**
 * Unit tests for the pure proposed-event review derivation (FR-K002).
 *
 * Covers the three acceptance criteria at the level where they are decided:
 *  - AC#1: every FR-K002 field is present on the record.
 *  - AC#2: the response is filterable and role-redacted.
 *  - AC#3: rejection reasons are stable codes; free text is never classified.
 */

import type { LlmTraceRecord } from '../observability/llmTrace';
import {
  authorizeOperator,
  isUnauthorizedError,
  parseOperatorRegistry,
} from './operatorAuthorization';
import {
  buildProposalReview,
  filterProposalReviews,
  matchesProposalReviewFilter,
  reviewPageLimit,
  scrubMetadata,
  stableReasonCode,
  traceForOperatorRole,
  SAFETY_REVIEW_REQUIRED_CODE,
  UNCLASSIFIED_REJECTION_CODE,
  type ProposalReviewSource,
} from './proposalReview';

const SLOT_ORDER = ['morning', 'noon', 'afternoon', 'evening', 'night'] as const;

const TRACE: LlmTraceRecord = {
  schemaVersion: 1,
  traceId: 'mistwood:day:3:slot:noon',
  worldId: 'mistwood',
  worldDay: 3,
  runId: 'run-3-noon',
  sceneId: 'scene-1',
  arcId: 'arc-well',
  characterIds: ['ada', 'ben'],
  model: 'fake-model',
  promptVersion: 'v1',
  inputTokens: 120,
  outputTokens: 80,
  latencyMs: 42,
  retryCount: 0,
  validationResult: 'passed',
  finalStatus: 'succeeded',
  recordedAt: 1_700_000_000,
};

function source(over: Partial<ProposalReviewSource> = {}): ProposalReviewSource {
  return {
    scene: {
      sceneId: 'scene-1',
      simulationRunId: 'scene-1:simulation',
      worldId: 'mistwood',
      worldDay: 3,
      timeSlot: 'noon',
      locationId: 'well',
      participantIds: ['ada', 'ben'],
      arcIds: ['arc-well'],
    },
    proposal: {
      schemaVersion: 1,
      idempotencyKey: 'mistwood:3:noon:1',
      eventType: 'conversation',
      worldDay: 3,
      timeSlot: 'noon',
      locationId: 'well',
      participantIds: ['ada'],
      causedByEventIds: [],
      publicSummary: 'Ada asks Ben about the well.',
      proposedBy: { type: 'character', id: 'ada' },
      stateChanges: [{ type: 'character_location_changed', characterId: 'ada', fromLocationId: 'home', toLocationId: 'well' }],
      metadata: { tone: 'tense' },
    },
    safety: { label: 'allow', reasonCodes: [], warningCodes: [], classifiedTextHash: 'fnv1a32:0000beef' },
    reviewStatus: 'not_required',
    commit: null,
    rejection: null,
    classifiedArcIds: [],
    trace: TRACE,
    providerTrace: { provider: 'fake', model: 'fake-model', inputTokens: 120, outputTokens: 80, latencyMs: 42, retryCount: 0 },
    ...over,
  };
}

const COMMIT = {
  eventId: 'mistwood#event#7',
  sequenceNumber: 7,
  validationVersion: 'canon-v1',
  traceId: 'mistwood:day:3:slot:noon',
  acceptedAt: 1_700_000_100,
};

describe('FR-K002 AC#1: the review record carries every reviewable field', () => {
  it('reports a committed proposal with its event, participants, state changes, arcs, trace, and safety label', () => {
    const record = buildProposalReview(
      source({ commit: COMMIT, classifiedArcIds: ['arc-debt'] }),
      'operator',
    );

    expect(record).toMatchObject({
      worldId: 'mistwood',
      idempotencyKey: 'mistwood:3:noon:1',
      sceneId: 'scene-1',
      worldDay: 3,
      timeSlot: 'noon',
      eventType: 'conversation',
      disposition: 'committed',
      validationResult: 'accepted',
      rejectionReasonCode: null,
      rejectionStage: null,
    });
    expect(record.proposedEvent.publicSummary).toBe('Ada asks Ben about the well.');
    // Participants are the union of the proposal's and the scene's, so a
    // reviewer sees everyone who was in the room, not only the actor.
    expect(record.participantIds).toEqual(['ada', 'ben']);
    expect(record.stateChanges).toEqual([
      { type: 'character_location_changed', characterId: 'ada', fromLocationId: 'home', toLocationId: 'well' },
    ]);
    // Related arcs union the planned arcs with the classification of the accepted event.
    expect(record.relatedArcIds).toEqual(['arc-well', 'arc-debt']);
    expect(record.safety.label).toBe('allow');
    expect(record.modelTrace).toMatchObject({ traceId: TRACE.traceId, model: 'fake-model' });
    expect(record.providerTrace).toMatchObject({ provider: 'fake', latencyMs: 42 });
    expect(record.commit).toEqual(COMMIT);
  });

  it('does not let a caller mutate the review record back into its source', () => {
    const input = source({ commit: COMMIT });
    const record = buildProposalReview(input, 'admin');
    (record.stateChanges[0] as unknown as { characterId: string }).characterId = 'tampered';
    record.relatedArcIds = [];
    expect(input.proposal.stateChanges[0].characterId).toBe('ada');
    expect(input.scene.arcIds).toEqual(['arc-well']);
  });
});

describe('FR-K002 AC#3: rejection reasons are stable codes, never classified free text', () => {
  it('passes a recorded canon error code through unchanged', () => {
    const record = buildProposalReview(
      source({ rejection: { reasonCode: 'TELEPORTATION_NOT_ALLOWED', stage: 'validate_canon', runId: 'run-3-noon' } }),
      'operator',
    );
    expect(record.disposition).toBe('rejected');
    expect(record.validationResult).toBe('rejected');
    expect(record.rejectionReasonCode).toBe('TELEPORTATION_NOT_ALLOWED');
    expect(record.rejectionStage).toBe('validate_canon');
  });

  it.each([
    ['a free-text message', 'Character ada cannot move from home to well'],
    ['a lowercase word', 'teleportation'],
    ['an empty string', ''],
    ['a missing code', null],
  ])('collapses %s to the placeholder rather than inventing a category', (_label, value) => {
    const record = buildProposalReview(
      source({ rejection: { reasonCode: value, stage: 'validate_canon', runId: 'run-3-noon' } }),
      'operator',
    );
    expect(record.rejectionReasonCode).toBe(UNCLASSIFIED_REJECTION_CODE);
    // The free text itself is never surfaced anywhere on the record.
    expect(JSON.stringify(record)).not.toContain('cannot move from home');
  });

  it('accepts only SCREAMING_SNAKE_CASE codes', () => {
    expect(stableReasonCode('PARTICIPANT_MISMATCH')).toBe('PARTICIPANT_MISMATCH');
    expect(stableReasonCode('OPS_SLOT_COMMITTED')).toBe('OPS_SLOT_COMMITTED');
    expect(stableReasonCode('Participant_Mismatch')).toBe(UNCLASSIFIED_REJECTION_CODE);
    expect(stableReasonCode('participant mismatch')).toBe(UNCLASSIFIED_REJECTION_CODE);
    expect(stableReasonCode(undefined)).toBe(UNCLASSIFIED_REJECTION_CODE);
  });
});

describe('FR-K002: disposition precedence follows what actually happened', () => {
  it('reports accepted Canon even when the slot later failed', () => {
    // A slot can fail after one proposal committed. Accepted history is never
    // re-judged, so the committed proposal must not be reported as rejected.
    const record = buildProposalReview(
      source({ commit: COMMIT, rejection: { reasonCode: 'SEQUENCE_CONFLICT', stage: 'commit_accepted_events', runId: 'r' } }),
      'operator',
    );
    expect(record.disposition).toBe('committed');
    expect(record.rejectionReasonCode).toBeNull();
  });

  it('reports a safety-withheld scene as withheld with the safety reason code', () => {
    const record = buildProposalReview(
      source({
        reviewStatus: 'required',
        safety: { label: 'withhold', reasonCodes: ['EXTREME_VIOLENCE_DETAIL'], warningCodes: ['NON_GRAPHIC_VIOLENCE'], classifiedTextHash: 'fnv1a32:1' },
      }),
      'operator',
    );
    expect(record.disposition).toBe('withheld');
    // Safety refused before Canon validation ran, so claiming a validation
    // verdict would be false.
    expect(record.validationResult).toBe('not_run');
    expect(record.rejectionReasonCode).toBe('EXTREME_VIOLENCE_DETAIL');
    expect(record.rejectionStage).toBe('safety');
  });

  it('reports a withheld scene with no category using the review placeholder', () => {
    const record = buildProposalReview(
      source({
        reviewStatus: 'required',
        safety: { label: 'human_review_required', reasonCodes: [], warningCodes: [], classifiedTextHash: 'fnv1a32:2' },
      }),
      'operator',
    );
    expect(record.rejectionReasonCode).toBe(SAFETY_REVIEW_REQUIRED_CODE);
  });

  it('reports an in-flight proposal as pending with no reason code', () => {
    const record = buildProposalReview(source(), 'operator');
    expect(record.disposition).toBe('pending');
    expect(record.validationResult).toBe('not_run');
    expect(record.rejectionReasonCode).toBeNull();
  });
});

describe('FR-K002 AC#2: the response is secret-safe and role-redacted', () => {
  it('gives a read-only viewer only the public trace projection', () => {
    const record = buildProposalReview(source({ commit: COMMIT }), 'viewer');
    expect(record.modelTrace).toEqual({
      schemaVersion: 1, traceId: TRACE.traceId, worldId: 'mistwood', worldDay: 3, finalStatus: 'succeeded',
    });
    // Token accounting, model identity, and prompt version stay operator-only.
    expect(record.modelTrace).not.toHaveProperty('model');
    expect(record.modelTrace).not.toHaveProperty('promptVersion');
    expect(record.modelTrace).not.toHaveProperty('inputTokens');
  });

  it('gives operator and admin the full accounting record', () => {
    for (const role of ['operator', 'admin'] as const) {
      const record = buildProposalReview(source({ commit: COMMIT }), role);
      expect(record.modelTrace).toEqual(TRACE);
    }
  });

  it('withholds provider-supplied proposal metadata from a viewer', () => {
    expect(buildProposalReview(source(), 'viewer').proposedEvent.metadata).toBeUndefined();
    expect(buildProposalReview(source(), 'operator').proposedEvent.metadata).toEqual({ tone: 'tense' });
  });

  it('scrubs prompt, secret, and credential-shaped metadata keys for every role', () => {
    const record = buildProposalReview(
      source({
        proposal: {
          ...source().proposal,
          metadata: {
            tone: 'tense',
            prompt: 'SYSTEM: you are ada',
            apiKey: 'sk-live-should-never-appear',
            nested: { responseBody: 'raw model output', keep: 1, authorization: 'Bearer abc' },
          },
        },
      }),
      'admin',
    );
    expect(record.proposedEvent.metadata).toEqual({ tone: 'tense', nested: { keep: 1 } });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('sk-live-should-never-appear');
    expect(serialized).not.toContain('SYSTEM: you are ada');
    expect(serialized).not.toContain('raw model output');
  });

  it('scrubs recursively and leaves non-sensitive values untouched', () => {
    expect(scrubMetadata({ a: 1, secretToken: 'x', deep: { messages: ['hi'], ok: true } }))
      .toEqual({ a: 1, deep: { ok: true } });
  });

  it('returns no trace at all when none was recorded', () => {
    expect(traceForOperatorRole(null, 'admin')).toBeNull();
    expect(buildProposalReview(source({ trace: null }), 'admin').modelTrace).toBeNull();
  });
});

describe('FR-K002 AC#2: review data is filterable', () => {
  const records = [
    buildProposalReview(source({ commit: COMMIT }), 'operator'),
    buildProposalReview(source({
      scene: { ...source().scene, sceneId: 'scene-2', worldDay: 4, timeSlot: 'night', participantIds: ['cara'], arcIds: ['arc-debt'] },
      proposal: { ...source().proposal, idempotencyKey: 'mistwood:4:night:1', eventType: 'conflict', worldDay: 4, timeSlot: 'night', participantIds: ['cara'] },
      rejection: { reasonCode: 'DEAD_CHARACTER_ACTION', stage: 'validate_canon', runId: 'run-4-night' },
    }), 'operator'),
    buildProposalReview(source({
      scene: { ...source().scene, sceneId: 'scene-3', worldDay: 4, timeSlot: 'morning' },
      proposal: { ...source().proposal, idempotencyKey: 'mistwood:4:morning:1', worldDay: 4, timeSlot: 'morning' },
      reviewStatus: 'required',
      safety: { label: 'withhold', reasonCodes: ['HATE_OR_DEHUMANIZATION'], warningCodes: [], classifiedTextHash: 'fnv1a32:3' },
    }), 'operator'),
  ];

  it.each([
    ['disposition', { disposition: 'committed' as const }, ['mistwood:3:noon:1']],
    ['validation result', { validationResult: 'rejected' as const }, ['mistwood:4:night:1']],
    ['world day', { worldDay: 4 }, ['mistwood:4:night:1', 'mistwood:4:morning:1']],
    ['time slot', { timeSlot: 'morning' }, ['mistwood:4:morning:1']],
    ['event type', { eventType: 'conflict' }, ['mistwood:4:night:1']],
    ['safety label', { safetyLabel: 'withhold' as const }, ['mistwood:4:morning:1']],
    ['rejection reason code', { reasonCode: 'DEAD_CHARACTER_ACTION' }, ['mistwood:4:night:1']],
    ['safety reason code', { reasonCode: 'HATE_OR_DEHUMANIZATION' }, ['mistwood:4:morning:1']],
    ['participant', { participantId: 'cara' }, ['mistwood:4:night:1']],
    ['arc', { arcId: 'arc-debt' }, ['mistwood:4:night:1']],
    ['scene', { sceneId: 'scene-3' }, ['mistwood:4:morning:1']],
  ])('filters by %s', (_label, filter, expected) => {
    expect(filterProposalReviews(records, filter, SLOT_ORDER).map(({ idempotencyKey }) => idempotencyKey))
      .toEqual(expected);
  });

  it('orders newest world time first and bounds the page', () => {
    expect(filterProposalReviews(records, {}, SLOT_ORDER).map(({ idempotencyKey }) => idempotencyKey))
      .toEqual(['mistwood:4:night:1', 'mistwood:4:morning:1', 'mistwood:3:noon:1']);
    expect(filterProposalReviews(records, {}, SLOT_ORDER, 1)).toHaveLength(1);
  });

  it('combines filters conjunctively and returns nothing when they conflict', () => {
    expect(filterProposalReviews(records, { worldDay: 4, disposition: 'committed' }, SLOT_ORDER)).toEqual([]);
    expect(matchesProposalReviewFilter(records[0], { worldDay: 3, participantId: 'ben' })).toBe(true);
    expect(matchesProposalReviewFilter(records[0], { worldDay: 3, participantId: 'cara' })).toBe(false);
  });

  it('clamps the page limit into the console bounds', () => {
    expect(reviewPageLimit(undefined)).toBe(50);
    expect(reviewPageLimit(0)).toBe(1);
    expect(reviewPageLimit(10_000)).toBe(200);
    expect(reviewPageLimit(Number.NaN)).toBe(50);
  });
});

describe('FR-K002 AC#2: review is reachable only through the ART-48 authorization gate', () => {
  const registry = parseOperatorRegistry(JSON.stringify([
    { operatorId: 'ops-read', role: 'viewer', subjects: ['clerk|reader'] },
    { operatorId: 'ops-run', role: 'operator', subjects: ['clerk|runner'], worldIds: ['mistwood'] },
  ]));

  const authorize = (credentials: Parameters<typeof authorizeOperator>[0]['credentials'], worldId = 'mistwood') =>
    authorizeOperator({ credentials, registry, capability: 'world.inspect', worldId });

  it('admits a registered viewer, because review is a read', () => {
    expect(authorize({ identity: { subject: 'clerk|reader' } })).toMatchObject({ operatorId: 'ops-read', role: 'viewer' });
  });

  it.each([
    ['an anonymous caller', {}],
    ['an unknown subject', { identity: { subject: 'clerk|stranger' } }],
    ['a forged operator id without a token', { operatorId: 'ops-run' }],
  ])('denies %s with the uniform console denial', (_label, credentials) => {
    expect(() => authorize(credentials)).toThrow(/OPS_UNAUTHORIZED/);
    try {
      authorize(credentials);
    } catch (error) {
      expect(isUnauthorizedError(error)).toBe(true);
    }
  });

  it('denies a world outside the operator allowlist with the same denial', () => {
    expect(() => authorize({ identity: { subject: 'clerk|runner' } }, 'other-world')).toThrow(/OPS_UNAUTHORIZED/);
  });
});
