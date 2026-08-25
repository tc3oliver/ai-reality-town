/**
 * FR-J001 AC#4/#5 — the winning vote actually reaches Canon, as a PROPOSAL.
 *
 * `environmentVote.test.ts` settles the decision layer in isolation. This suite settles the part
 * that isolation cannot: that the thing the ballot elects is accepted by the REAL commit
 * pipeline, is subject to the REAL validation, and shows up in the REAL projection. Everything
 * below `buildWinningIntervention` is production code — `buildViewerVoteProposal`,
 * `commitProposedEvent`, `validateEventStructure`, `validateCanon`, `replayWorldEvents` — with
 * only the store swapped for its in-memory reference implementation.
 *
 * The rejection path is given equal weight on purpose. 「勝出不代表指定後續結果」 is only true
 * if a winning event can still be refused, so this proves it is.
 */

import { commitProposedEvent } from '../canon/commit';
import { InMemoryCanonStore } from '../canon/inMemoryStore';
import { emptyProjection } from '../canon/model';
import { replayWorldEvents } from '../canon/replay';
import { validateCanon, validateEventStructure } from '../canon/validators';
import { isCanonError } from '../shared/errors';
import { buildViewerVoteProposal } from '../simulation/worldDayLive';
import { buildWinningIntervention, closeRound, type VoteRound } from './environmentVote';

const WORLD = 'mistwood';
const CUTOFF = 500_000;
const SLOT = { worldId: WORLD, worldDay: 8, timeSlot: 'morning' as const };

const round: VoteRound = {
  worldId: WORLD,
  worldDay: 7,
  candidateIds: ['power_outage', 'heavy_storm', 'road_closure'],
  cutoffAt: CUTOFF,
  submissionCount: 3,
};

/** Run a whole ballot: cast votes, close, elect, and build the proposal the simulation would. */
function electedProposal(...votes: string[]) {
  const outcome = closeRound(round, votes.map((candidateId) => ({ candidateId })), CUTOFF);
  const intervention = buildWinningIntervention(round, outcome, SLOT.worldDay);
  if (intervention === null) return null;
  return buildViewerVoteProposal(intervention, SLOT);
}

describe('AC#4 — the winner is injected as a Proposed World Event', () => {
  test('the elected candidate becomes a structurally valid world_event proposal', () => {
    const proposal = electedProposal('power_outage', 'power_outage', 'heavy_storm')!;
    expect(validateEventStructure(proposal)).toBeNull();
    expect(proposal).toMatchObject({
      worldId: WORLD,
      eventType: 'world_event',
      // The world proposes it. A viewer is never recorded as an author, because a viewer has
      // no authority to author anything.
      proposedBy: { type: 'system', id: 'viewer_vote' },
      participantIds: [],
      worldDay: SLOT.worldDay,
      timeSlot: 'morning',
    });
    expect(proposal.stateChanges).toEqual([{
      type: 'fact_created',
      subjectType: 'world',
      subjectId: WORLD,
      predicate: 'power',
      value: 'outage',
      visibility: 'public',
    }]);
  });

  test('committing it through the real pipeline changes the world environment', async () => {
    const store = new InMemoryCanonStore();
    const proposal = electedProposal('power_outage')!;
    const result = await commitProposedEvent(store, { proposed: proposal, traceId: 'trace-vote' });

    expect(result.deduplicated).toBe(false);
    const projection = replayWorldEvents(emptyProjection(WORLD), await store.loadAcceptedEvents(WORLD));
    expect(projection.worldEnvironment.power).toMatchObject({ key: 'power', value: 'outage', visibility: 'public' });
    expect(projection.lastSequenceNumber).toBe(result.sequenceNumber);
    expect(store.committedEvents()).toHaveLength(1);
  });

  test('the accepted event is attributable to the vote without a side table', () => {
    // The `vote:` prefix on the idempotency key is the one marker that survives into accepted
    // Canon, which is what lets `buildLiveWorldSnapshot` report viewer-intervention events and
    // what FR-J002 will read back later.
    expect(electedProposal('power_outage')!.idempotencyKey).toBe('vote:mistwood:7:power_outage');
    expect(electedProposal('power_outage')!.metadata).toMatchObject({
      source: 'viewer_vote', candidateId: 'power_outage', roundWorldDay: 7, votes: 1,
    });
  });

  test('re-running the same closed round commits one event, not two', async () => {
    // The cron may close a round more than once, and a slot may be retried. Both collapse onto
    // the derived idempotency key.
    const store = new InMemoryCanonStore();
    const first = await commitProposedEvent(store, { proposed: electedProposal('heavy_storm')!, traceId: 't' });
    const second = await commitProposedEvent(store, { proposed: electedProposal('heavy_storm')!, traceId: 't' });

    expect(second.deduplicated).toBe(true);
    expect(second.eventId).toBe(first.eventId);
    expect(store.committedEvents()).toHaveLength(1);
  });

  test('a round nobody voted in proposes nothing at all', () => {
    expect(electedProposal()).toBeNull();
  });

  test('a queued id with no catalog entry proposes nothing rather than an empty event', () => {
    expect(buildViewerVoteProposal(
      { worldId: WORLD, candidateId: 'retired_candidate', idempotencyKey: 'vote:x', worldDay: 7, votes: 9 },
      SLOT,
    )).toBeNull();
  });
});

describe('AC#5 — winning buys a proposal, never an outcome', () => {
  test('a winning event is still refused when it violates an immutable world rule', async () => {
    // The point of the criterion. A vote does not soften Canon: the elected event faces exactly
    // the validation a Director proposal faces, and loses to it.
    const store = new InMemoryCanonStore();
    store.setCanonRuleContext({
      worldId: WORLD,
      rules: [{
        id: 'no-world-events',
        description: 'This world admits no world_event.',
        enforcement: { type: 'forbid_event_type', eventType: 'world_event' },
      }],
    });
    const proposal = electedProposal('power_outage')!;

    await expect(commitProposedEvent(store, { proposed: proposal, traceId: 't' })).rejects.toThrow();
    await commitProposedEvent(store, { proposed: proposal, traceId: 't' }).catch((thrown: unknown) => {
      expect(isCanonError(thrown) && thrown.error.code).toBe('IMMUTABLE_WORLD_RULE_VIOLATION');
    });
    expect(store.committedEvents()).toEqual([]);
  });

  test('the elected event changes the environment and nothing about any character', () => {
    const proposal = electedProposal('road_closure')!;
    const projection = replayWorldEvents(emptyProjection(WORLD), []);
    expect(validateCanon(proposal, projection, { worldId: WORLD, rules: [] })).toBeNull();
    // Every state change is a world fact. There is no character location, life state,
    // relationship, memory or knowledge change a vote could produce.
    for (const change of proposal.stateChanges) {
      expect(change.type).toBe('fact_created');
      expect(change).toMatchObject({ subjectType: 'world' });
    }
  });

  test('the proposal names no character, so it can never move or harm one', () => {
    const proposal = electedProposal('stranger_arrival', 'road_closure', 'road_closure')!;
    expect(proposal.participantIds).toEqual([]);
    expect(proposal.causedByEventIds).toEqual([]);
    expect(proposal.locationId).toBeUndefined();
  });
});
