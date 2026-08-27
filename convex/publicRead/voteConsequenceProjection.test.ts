/**
 * The consequence builder's four buckets and the two promises they exist to keep
 * (FR-J002 / ART-46).
 *
 * The describe blocks are named for the acceptance criterion each settles. The most important
 * suite here is AC#2's: it pins TODAY'S REAL PRODUCTION SHAPE — Canon where no event carries a
 * `causedByEventIds` edge — and requires `direct` and `downstream` to come out empty. If someone
 * later "improves" the builder by inferring causality from adjacency, slot membership, or
 * Director context, that suite is what turns red.
 */

import {
  buildVoteConsequenceProjection,
  validateVoteConsequenceLinks,
  VoteConsequenceError,
  VOTE_CONSEQUENCE_LOOKAHEAD_DAYS,
  VOTE_CONSEQUENCE_MODEL_KIND,
  VOTE_CONSEQUENCE_SCHEMA_VERSION,
  type VoteConsequenceEventInput,
  type VoteConsequenceProjection,
} from './voteConsequenceProjection';

const WORLD_ID = 'mistwood';
const DAY = 7;
const SCENE = 'mistwood:7:morning:grouping:scene:1';
const OTHER_SCENE = 'mistwood:7:evening:grouping:scene:2';

function event(
  sequenceNumber: number,
  over: Partial<VoteConsequenceEventInput> = {},
): VoteConsequenceEventInput {
  return {
    eventId: `mistwood#event#${sequenceNumber}`,
    sequenceNumber,
    worldDay: DAY,
    timeSlot: 'morning',
    eventType: 'conversation',
    idempotencyKey: `scene:${sequenceNumber}`,
    causedByEventIds: [],
    publicSummary: `事件 ${sequenceNumber}`,
    publicationStatus: 'published',
    sceneId: null,
    ...over,
  };
}

/** The accepted event a winning vote produced: the `vote:` prefix is the whole marker. */
function voteEvent(sequenceNumber: number, over: Partial<VoteConsequenceEventInput> = {}) {
  return event(sequenceNumber, {
    idempotencyKey: `vote:${WORLD_ID}:${DAY}`,
    eventType: 'world_event',
    publicSummary: '全鎮停電。',
    ...over,
  });
}

const id = (sequenceNumber: number) => `mistwood#event#${sequenceNumber}`;

function build(input: {
  events: readonly VoteConsequenceEventInput[];
  /** Defaults to the events' own ids — i.e. a wiring that fed the builder only Canon. */
  acceptedEventIds?: readonly string[];
  appliedEventIds?: readonly string[];
  contextInterventionEventIdsByScene?: Record<string, readonly string[]>;
  targetWorldDay?: number;
}): VoteConsequenceProjection {
  return buildVoteConsequenceProjection({
    worldId: WORLD_ID,
    targetWorldDay: input.targetWorldDay ?? DAY,
    events: input.events,
    acceptedEventIds: input.acceptedEventIds ?? input.events.map((event) => event.eventId),
    appliedEventIds: input.appliedEventIds ?? [],
    contextInterventionEventIdsByScene: input.contextInterventionEventIdsByScene ?? {},
  });
}

const eventIds = (nodes: ReadonlyArray<{ eventId: string }>) => nodes.map((node) => node.eventId);

describe('AC#1 — the view identifies trigger, direct effects, downstream events, and uncertain ones', () => {
  it('names the vote-triggered event off Canon\'s own idempotency key', () => {
    const payload = build({ events: [event(0), voteEvent(1), event(2)] });
    expect(payload.trigger?.eventId).toBe(id(1));
    expect(payload.trigger?.provenance).toEqual({
      basis: 'vote_idempotency_key',
      sourceEventIds: [id(1)],
    });
    expect(payload.trigger?.depth).toBe(0);
    expect(payload.schemaVersion).toBe(VOTE_CONSEQUENCE_SCHEMA_VERSION);
    expect(VOTE_CONSEQUENCE_MODEL_KIND).toBe('voteConsequence');
  });

  it('places an event whose causedByEventIds names the trigger in `direct`, at depth 1', () => {
    const payload = build({ events: [voteEvent(1), event(2, { causedByEventIds: [id(1)] })] });
    expect(eventIds(payload.direct)).toEqual([id(2)]);
    expect(payload.direct[0].depth).toBe(1);
    expect(payload.direct[0].path).toEqual([id(1), id(2)]);
    expect(payload.direct[0].provenance).toEqual({
      basis: 'canon_caused_by',
      sourceEventIds: [id(1)],
    });
    expect(payload.downstream).toEqual([]);
  });

  it('walks a multi-hop chain into `downstream`, recording each link\'s real path and depth', () => {
    const payload = build({
      events: [
        voteEvent(1),
        event(2, { causedByEventIds: [id(1)] }),
        event(3, { causedByEventIds: [id(2)] }),
        event(4, { causedByEventIds: [id(3)] }),
      ],
    });
    expect(eventIds(payload.direct)).toEqual([id(2)]);
    expect(eventIds(payload.downstream)).toEqual([id(3), id(4)]);
    expect(payload.downstream.map((node) => node.depth)).toEqual([2, 3]);
    expect(payload.downstream[1].path).toEqual([id(1), id(2), id(3), id(4)]);
    // Depth ≥ 2 is still a Canon edge, so it still says so — the honesty is in the DEPTH and
    // the path, not in downgrading the basis.
    expect(payload.downstream[1].provenance.basis).toBe('canon_caused_by');
    expect(payload.explicitCausalEdgeCount).toBe(3);
  });

  it('places a context-linked event with no causal edge in `uncertain`, with no depth or path', () => {
    const payload = build({
      events: [voteEvent(1), event(2, { sceneId: SCENE })],
      contextInterventionEventIdsByScene: { [SCENE]: [id(1)] },
    });
    expect(eventIds(payload.uncertain)).toEqual([id(2)]);
    expect(payload.uncertain[0].depth).toBeNull();
    expect(payload.uncertain[0].path).toEqual([]);
    expect(payload.uncertain[0].provenance).toEqual({
      basis: 'director_plan_context',
      sourceEventIds: [id(1)],
    });
  });

  it('publishes an empty, non-throwing payload for a day with no viewer intervention', () => {
    // The read has to RESOLVE for the view to be able to say 「這一天沒有觀眾投票事件」.
    const payload = build({ events: [event(0), event(1)] });
    expect(payload.trigger).toBeNull();
    expect(payload.direct).toEqual([]);
    expect(payload.downstream).toEqual([]);
    expect(payload.uncertain).toEqual([]);
    expect(payload.sourceEventIds).toEqual([]);
  });

  it('ignores a vote event from a different world day', () => {
    const payload = build({ events: [voteEvent(1, { worldDay: DAY - 1 })] });
    expect(payload.trigger).toBeNull();
  });

  it('prefers the trigger the vote ledger confirms it applied', () => {
    // Two `vote:`-prefixed events on the day; the ledger names the later one. Canon says both
    // happened, the ledger says which one this round produced, and only their agreement is
    // evidence.
    const payload = build({
      events: [voteEvent(1), voteEvent(2)],
      appliedEventIds: [id(2)],
    });
    expect(payload.trigger?.eventId).toBe(id(2));
  });

  it('ignores a ledger row naming an event Canon does not have', () => {
    const payload = build({ events: [voteEvent(1)], appliedEventIds: ['mistwood#event#999'] });
    expect(payload.trigger?.eventId).toBe(id(1));
  });
});

describe('AC#2 — downstream outcomes are never labelled as directly caused by the vote', () => {
  it('reports NO direct and NO downstream effects on canon that carries no causal edge', () => {
    /**
     * TODAY'S PRODUCTION SHAPE, and the single most important assertion in this file.
     *
     * Every event the running system commits has `causedByEventIds: []` — the vote-injected
     * proposal hard-codes it and the deterministic provider always emits it. A view that
     * "helpfully" attributed the day's events to the vote would be inventing the finding
     * FR-J002 exists to report. So: nothing in `direct`, nothing in `downstream`, and
     * everything the Director was told about lands in `uncertain` where it belongs.
     */
    const payload = build({
      events: [
        voteEvent(1, { sceneId: null }),
        event(2, { sceneId: SCENE }),
        event(3, { sceneId: SCENE }),
        event(4, { sceneId: OTHER_SCENE }),
      ],
      contextInterventionEventIdsByScene: { [SCENE]: [id(1)], [OTHER_SCENE]: [id(1)] },
    });
    expect(payload.direct).toEqual([]);
    expect(payload.downstream).toEqual([]);
    expect(payload.explicitCausalEdgeCount).toBe(0);
    expect(eventIds(payload.uncertain)).toEqual([id(2), id(3), id(4)]);
    expect(payload.uncertain.every((node) => node.provenance.basis === 'director_plan_context'))
      .toBe(true);
    // Not one node in the payload claims a Canon causal edge.
    expect(JSON.stringify(payload)).not.toContain('canon_caused_by');
  });

  it('leaves an unrelated event out of every bucket', () => {
    // No causal edge and no Director-context membership. There is no evidence to display, so
    // it is displayed nowhere — an "everything since the vote" bucket is exactly the overclaim.
    const payload = build({
      events: [
        voteEvent(1),
        event(2, { causedByEventIds: [id(1)] }),
        event(3, { sceneId: OTHER_SCENE }),
      ],
      contextInterventionEventIdsByScene: { [SCENE]: [id(1)] },
    });
    const placed = [
      ...eventIds(payload.direct),
      ...eventIds(payload.downstream),
      ...eventIds(payload.uncertain),
    ];
    expect(placed).not.toContain(id(3));
    expect(payload.sourceEventIds).not.toContain(id(3));
  });

  it('does not put a causally-linked event in `uncertain` as well', () => {
    // Mutually exclusive buckets, earlier bucket wins: the same event counted twice would
    // double what the view claims the vote touched.
    const payload = build({
      events: [voteEvent(1), event(2, { causedByEventIds: [id(1)], sceneId: SCENE })],
      contextInterventionEventIdsByScene: { [SCENE]: [id(1)] },
    });
    expect(eventIds(payload.direct)).toEqual([id(2)]);
    expect(payload.uncertain).toEqual([]);
  });

  it('does not treat a scene whose plan context names a DIFFERENT intervention as uncertain', () => {
    const payload = build({
      events: [voteEvent(1), event(2, { sceneId: SCENE })],
      contextInterventionEventIdsByScene: { [SCENE]: ['mistwood#event#900'] },
    });
    expect(payload.uncertain).toEqual([]);
  });

  it('terminates on a causal cycle instead of looping', () => {
    const payload = build({
      events: [
        voteEvent(1),
        event(2, { causedByEventIds: [id(1), id(3)] }),
        event(3, { causedByEventIds: [id(2)] }),
      ],
    });
    expect(eventIds(payload.direct)).toEqual([id(2)]);
    expect(eventIds(payload.downstream)).toEqual([id(3)]);
  });

  it('is deterministic: bucket order follows sequence number regardless of input order', () => {
    const rows = [
      voteEvent(1),
      event(4, { causedByEventIds: [id(3)] }),
      event(2, { causedByEventIds: [id(1)] }),
      event(3, { causedByEventIds: [id(1)] }),
    ];
    const forward = build({ events: rows });
    const reversed = build({ events: [...rows].reverse() });
    expect(eventIds(forward.direct)).toEqual([id(2), id(3)]);
    expect(eventIds(forward.downstream)).toEqual([id(4)]);
    expect(JSON.stringify(reversed)).toEqual(JSON.stringify(forward));
  });
});

describe('AC#3 — every displayed causal link traces to accepted-event provenance', () => {
  const valid = (): VoteConsequenceProjection => build({
    events: [voteEvent(1), event(2, { causedByEventIds: [id(1)] })],
  });

  it('accepts a payload whose ids all resolve to accepted events', () => {
    const payload = valid();
    expect(validateVoteConsequenceLinks(payload, [id(1), id(2)])).toBe(payload);
  });

  it('rejects a node whose event is not accepted', () => {
    expect(() => validateVoteConsequenceLinks(valid(), [id(1)]))
      .toThrow(/VOTE_CONSEQUENCE_SOURCE_NOT_ACCEPTED/);
  });

  it('rejects a link whose provenance names a non-accepted event', () => {
    const payload = valid();
    payload.direct[0].provenance.sourceEventIds = ['mistwood#event#999'];
    let code: string | null = null;
    try {
      validateVoteConsequenceLinks(payload, [id(1), id(2)]);
    } catch (error) {
      code = error instanceof VoteConsequenceError ? error.code : null;
    }
    expect(code).toBe('VOTE_CONSEQUENCE_SOURCE_NOT_ACCEPTED');
  });

  it('rejects a link whose PATH steps through a non-accepted event', () => {
    // The path is the evidence a reader checks the chain against; an unverifiable step in it
    // is an unverifiable claim even when both endpoints are real.
    const payload = valid();
    payload.direct[0].path = [id(1), 'mistwood#event#998', id(2)];
    expect(() => validateVoteConsequenceLinks(payload, [id(1), id(2)]))
      .toThrow(/VOTE_CONSEQUENCE_SOURCE_NOT_ACCEPTED/);
  });

  it('rejects a link carrying no provenance at all', () => {
    const payload = valid();
    payload.direct[0].provenance.sourceEventIds = [];
    expect(() => validateVoteConsequenceLinks(payload, [id(1), id(2)]))
      .toThrow(/VOTE_CONSEQUENCE_SOURCE_NOT_ACCEPTED/);
  });

  it('rejects the same event appearing in two buckets', () => {
    const payload = valid();
    payload.uncertain = [{ ...payload.direct[0], bucket: 'uncertain', depth: null, path: [] }];
    expect(() => validateVoteConsequenceLinks(payload, [id(1), id(2)]))
      .toThrow(/VOTE_CONSEQUENCE_DUPLICATE_BUCKET/);
  });

  it('rejects an unknown provenance basis', () => {
    const payload = valid();
    payload.direct[0].provenance.basis = 'vibes' as never;
    expect(() => validateVoteConsequenceLinks(payload, [id(1), id(2)]))
      .toThrow(/VOTE_CONSEQUENCE_INVALID/);
  });

  it('refuses an invalid envelope', () => {
    expect(() => build({ events: [], targetWorldDay: -1 })).toThrow(/VOTE_CONSEQUENCE_INVALID/);
    expect(() => buildVoteConsequenceProjection({
      worldId: '  ', targetWorldDay: DAY, events: [], acceptedEventIds: [], appliedEventIds: [],
      contextInterventionEventIdsByScene: {},
    })).toThrow(/VOTE_CONSEQUENCE_INVALID/);
  });

  it('refuses to build when `events` carries something Canon has not accepted', () => {
    /**
     * THE CHECK THAT MAKES AC#3 REAL, and the one that was previously unreachable.
     *
     * `acceptedEventIds` used to be computed inside the builder as `events.map(e => e.eventId)`,
     * so the validator was handed its own input as the definition of "accepted" and
     * `VOTE_CONSEQUENCE_SOURCE_NOT_ACCEPTED` could not fire on the publish path no matter what
     * the wiring did. It is now a separate argument the wiring derives from the `canonEvents`
     * rows, and this test is the widening it is supposed to catch: event 2 reaches the builder
     * and claims a causal edge, but Canon never accepted it.
     */
    expect(() => build({
      events: [voteEvent(1), event(2, { causedByEventIds: [id(1)] })],
      acceptedEventIds: [id(1)],
    })).toThrow(/VOTE_CONSEQUENCE_SOURCE_NOT_ACCEPTED/);
  });

  it('validates the empty payload too, so nothing is published unvalidated', () => {
    // The no-trigger path used to return before the validator ran, which made the guarantee
    // stated in `docs/vote-consequence-tracking.md` §6 false for exactly one branch.
    expect(build({ events: [event(0)] }).trigger).toBeNull();
    expect(() => buildVoteConsequenceProjection({
      worldId: WORLD_ID, targetWorldDay: DAY, events: [event(0)],
      acceptedEventIds: [], appliedEventIds: [], contextInterventionEventIdsByScene: {},
    })).not.toThrow();
  });
});

describe('the day window the projection and the pipeline share', () => {
  it('pins the lookahead the Director context window implies', () => {
    // `RECENT_EVENT_WINDOW = 10` accepted events over five slots a day ≈ two world days, so a
    // Scene planned one day after the vote can still carry it. `publicRead` may not import the
    // simulation constant, so the derivation is pinned here instead of silently drifting.
    expect(VOTE_CONSEQUENCE_LOOKAHEAD_DAYS).toBe(1);
  });
});

describe('the safety gate\'s redaction survives into the payload (FR-P004 / ART-132)', () => {
  it('keeps a withheld node and carries its refusal, without its text', () => {
    const payload = build({
      events: [
        voteEvent(1),
        event(2, { causedByEventIds: [id(1)], publicSummary: null, publicationStatus: 'withheld' }),
      ],
    });
    expect(payload.direct[0].publicSummary).toBeNull();
    expect(payload.direct[0].publicationStatus).toBe('withheld');
    // The row survives: the event happened, and dropping it would misreport the chain's length.
    expect(payload.direct).toHaveLength(1);
  });
});
