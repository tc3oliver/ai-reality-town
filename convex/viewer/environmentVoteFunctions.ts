/**
 * Convex wiring for the daily environment vote (FR-J001 / ART-45).
 *
 * ## This file holds the deployment's ONLY viewer-reachable write
 *
 * Everything else a public visitor can reach is a read. That is not an accident of what got
 * built — it is machine-enforced by `architecture/module-boundaries.json`, and this module is
 * the single declared exception. The `viewerWriteBoundary` policy section requires a
 * viewer-gated mutation to live under `convex/viewer`, to be declared twice (once on the public
 * surface, once as a viewer write), to be capped in number, to name the safety classifier and
 * the rate limiter, and to name no Canon-write symbol at all. `check-boundaries.mjs` fails the
 * build on any of those, so this file cannot quietly grow a second write or a path to Canon.
 *
 * The guarantee the rest of the product depends on is unchanged and is still proven, but it is
 * now proven as what the PRD actually claims — PRD 2.0 §22.16 「公開**觀看**不執行任何成功
 * Mutation」 and FR-O009's `/live` scope — rather than by a blanket ban that FR-J001 makes
 * impossible to keep. `docs/daily-environment-vote.md` §2 records that reasoning and the
 * alternative that was rejected.
 *
 * ## Why the ballot read does not take a device key
 *
 * {@link getEnvironmentVoteBallot} deliberately has no per-viewer argument. A `deviceKey` in a
 * query's arguments would put the identifier into every cached read of a page anyone can load,
 * to save one round trip and tell the client something it already knows. The client remembers
 * its own submission locally; the server is what ENFORCES the limit, and it does so in the
 * mutation where the value is needed anyway.
 */

import { v } from 'convex/values';
import type { GenericQueryCtx } from 'convex/server';

import { internalMutation, mutation, query } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import { findEnvironmentVoteCandidate } from '../shared/environmentVoteCatalog';
import {
  buildWinningIntervention,
  closeRound,
  deviceDigest,
  evaluateVoteSubmission,
  selectDailyCandidates,
  tallyRound,
  validateBallotCandidates,
  VOTE_ROUND_DURATION_MS,
  type VoteRound,
} from './environmentVote';

type QueryDb = GenericQueryCtx<DataModel>['db'];

type RoundRow = {
  worldId: string;
  worldDay: number;
  candidateIds: string[];
  cutoffAt: number;
  status: 'open' | 'closed';
  voteCount: number;
  submissionCount: number;
  winnerCandidateId?: string;
};

const toVoteRound = (row: RoundRow): VoteRound => ({
  worldId: row.worldId,
  worldDay: row.worldDay,
  candidateIds: row.candidateIds,
  cutoffAt: row.cutoffAt,
  submissionCount: row.submissionCount,
});

/** The round a world is currently voting in, or `null` when none is open. */
async function loadOpenRound(db: QueryDb, worldId: string) {
  return db
    .query('environmentVoteRounds')
    .withIndex('by_world_and_status', (q) => q.eq('worldId', worldId).eq('status', 'open'))
    .first();
}

const ballotCandidateValidator = v.object({
  candidateId: v.string(),
  title: v.string(),
  description: v.string(),
  votes: v.number(),
});

const ballotValidator = v.object({
  worldId: v.string(),
  worldDay: v.number(),
  /** The day a winner would be applied to, so the ballot can say what it affects. */
  targetWorldDay: v.number(),
  cutoffAt: v.number(),
  candidates: v.array(ballotCandidateValidator),
  totalVotes: v.number(),
});

/**
 * The anonymous ballot read (FR-J001 offer side).
 *
 * A `query`, gated `anonymous`, exactly like every other public read. It exposes the ids,
 * labels and running counts of a round that is already open and nothing else: no device
 * digest, no per-viewer state, no world internals. Returns `null` when no round is open,
 * which is what makes `voteAvailable` on the homepage an honest derivation rather than a
 * hard-coded constant.
 */
export const getEnvironmentVoteBallot = query({
  args: { worldId: v.string() },
  returns: v.union(ballotValidator, v.null()),
  handler: async (ctx, args) => {
    const row = await loadOpenRound(ctx.db, args.worldId);
    if (!row) return null;
    const ballots = await ctx.db
      .query('environmentVoteBallots')
      .withIndex('by_round', (q) => q.eq('worldId', row.worldId).eq('worldDay', row.worldDay))
      .collect();
    const cast = ballots.flatMap((ballot) =>
      ballot.candidateId === undefined ? [] : [{ candidateId: ballot.candidateId }]);
    const tally = tallyRound(toVoteRound(row), cast);
    return {
      worldId: row.worldId,
      worldDay: row.worldDay,
      targetWorldDay: row.targetWorldDay,
      cutoffAt: row.cutoffAt,
      candidates: tally.map((entry) => {
        const candidate = findEnvironmentVoteCandidate(entry.candidateId);
        return {
          candidateId: entry.candidateId,
          title: candidate?.title ?? entry.candidateId,
          description: candidate?.description ?? '',
          votes: entry.votes,
        };
      }),
      totalVotes: cast.length,
    };
  },
});

const voteResultValidator = v.object({
  accepted: v.boolean(),
  code: v.union(v.string(), v.null()),
});

/**
 * Cast one vote (FR-J001 AC#2).
 *
 * The whole decision is {@link evaluateVoteSubmission}, a pure function; this handler only
 * fetches the two rows it needs and applies the verdict. Three properties are worth naming
 * because they are what an abuse-resistance claim rests on:
 *
 *  - **The attempt is recorded whether or not it is accepted.** A refusal that cost nothing
 *    would make the attempt budget decorative, and the endpoint an oracle for probing what the
 *    classifier rejects.
 *  - **No submitted value is echoed.** The result is `accepted` plus a stable code. A caller
 *    learns the verdict on their own submission and nothing about the world, the round's
 *    internals, or any other device.
 *  - **Nothing here can reach Canon.** `viewer` may not depend on `canon`
 *    (`architecture/module-boundaries.json`), so a winning vote leaves this module as a queued
 *    intervention and is turned into a Proposed World Event by `simulation`, which then puts it
 *    through the same structural and Canon validation every other proposal faces.
 */
export const submitEnvironmentVote = mutation({
  args: { worldId: v.string(), deviceKey: v.string(), candidateId: v.string() },
  returns: voteResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now();
    const row = await loadOpenRound(ctx.db, args.worldId);
    if (!row) return { accepted: false, code: 'VOTE_ROUND_NOT_OPEN' };

    const digest = deviceDigest(args.deviceKey);
    const existing = await ctx.db
      .query('environmentVoteBallots')
      .withIndex('by_round_and_device', (q) =>
        q.eq('worldId', row.worldId).eq('worldDay', row.worldDay).eq('deviceDigest', digest))
      .unique();

    const decision = evaluateVoteSubmission({
      round: toVoteRound(row),
      submission: { worldId: args.worldId, deviceKey: args.deviceKey, candidateId: args.candidateId },
      history: {
        acceptedVotes: existing?.candidateId === undefined ? 0 : 1,
        attempts: existing?.attempts ?? 0,
      },
      now,
    });

    // An exhausted device writes nothing at all: past the budget, the surface stops being a
    // way to create rows. Every other outcome records its attempt.
    if (!decision.accepted && decision.code === 'VOTE_DEVICE_ATTEMPTS_EXHAUSTED') {
      return { accepted: false, code: decision.code };
    }

    const accepted = decision.accepted;
    if (existing) {
      await ctx.db.patch(existing._id, {
        attempts: existing.attempts + 1,
        ...(accepted ? { candidateId: decision.candidateId } : {}),
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('environmentVoteBallots', {
        schemaVersion: 1,
        worldId: row.worldId,
        worldDay: row.worldDay,
        deviceDigest: digest,
        ...(accepted ? { candidateId: decision.candidateId } : {}),
        attempts: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(row._id, {
      submissionCount: row.submissionCount + 1,
      voteCount: row.voteCount + (accepted ? 1 : 0),
    });
    return { accepted, code: accepted ? null : decision.code };
  },
});

/**
 * Open due rounds and close expired ones. Cron target; never client-reachable.
 *
 * Both halves are idempotent, which is what lets a cron own them: opening checks for an
 * existing round on the same (world, day), and closing moves `status` from `open` to `closed`
 * in the same transaction that writes the winner, so a second run finds nothing open to elect.
 *
 * A round is also closed when the world has simply moved past its day. Cutoff alone would leave
 * a stale round collecting votes for a day that has already been simulated, and those votes
 * could never affect anything — closing on either condition is what keeps 「投票截止」 tied to
 * the world rather than only to the wall clock.
 */
export const tickEnvironmentVoteRounds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const schedules = await ctx.db
      .query('worldSchedules')
      .withIndex('by_mode_and_status', (q) => q.eq('mode', 'public'))
      .collect();

    let opened = 0;
    let closed = 0;
    let queued = 0;
    for (const schedule of schedules) {
      const open = await loadOpenRound(ctx.db, schedule.worldId);
      if (open) {
        const expired = now >= open.cutoffAt || schedule.nextWorldDay > open.worldDay;
        if (!expired) continue;
        const ballots = await ctx.db
          .query('environmentVoteBallots')
          .withIndex('by_round', (q) => q.eq('worldId', open.worldId).eq('worldDay', open.worldDay))
          .collect();
        const cast = ballots.flatMap((ballot) =>
          ballot.candidateId === undefined ? [] : [{ candidateId: ballot.candidateId }]);
        // Closing is decided against the cutoff, so a round closed early because the world moved
        // on is settled at its own cutoff instant rather than at a clock that has not reached it.
        const outcome = closeRound(toVoteRound(open), cast, Math.max(now, open.cutoffAt));
        const intervention = buildWinningIntervention(
          toVoteRound(open),
          outcome,
          schedule.nextWorldDay,
        );
        await ctx.db.patch(open._id, {
          status: 'closed',
          closedAt: now,
          ...(intervention ? { winnerCandidateId: intervention.candidateId } : {}),
        });
        closed += 1;
        if (intervention) {
          const duplicate = await ctx.db
            .query('environmentVoteInterventions')
            .withIndex('by_idempotency_key', (q) => q.eq('idempotencyKey', intervention.idempotencyKey))
            .unique();
          if (!duplicate) {
            await ctx.db.insert('environmentVoteInterventions', {
              schemaVersion: 1,
              worldId: intervention.worldId,
              worldDay: intervention.worldDay,
              targetWorldDay: intervention.targetWorldDay,
              candidateId: intervention.candidateId,
              idempotencyKey: intervention.idempotencyKey,
              votes: intervention.votes,
              status: 'queued',
              createdAt: now,
            });
            queued += 1;
          }
        }
        continue;
      }

      if (schedule.status !== 'running' || !schedule.publishEnabled) continue;
      const worldDay = schedule.nextWorldDay;
      const already = await ctx.db
        .query('environmentVoteRounds')
        .withIndex('by_world_and_day', (q) => q.eq('worldId', schedule.worldId).eq('worldDay', worldDay))
        .unique();
      if (already) continue;

      // AC#1: the slate is safety- and Canon-shape-checked BEFORE it is offered. A catalog edit
      // that introduced something the FR-L003 policy forbids opens no round at all rather than
      // publishing the sentence and relying on a later gate.
      const candidates = selectDailyCandidates(schedule.worldId, worldDay);
      if (validateBallotCandidates(candidates).length > 0) continue;

      await ctx.db.insert('environmentVoteRounds', {
        schemaVersion: 1,
        worldId: schedule.worldId,
        worldDay,
        candidateIds: candidates.map((candidate) => candidate.candidateId),
        cutoffAt: now + VOTE_ROUND_DURATION_MS,
        targetWorldDay: worldDay + 1,
        status: 'open',
        voteCount: 0,
        submissionCount: 0,
        createdAt: now,
      });
      opened += 1;
    }
    return { worldCount: schedules.length, opened, closed, queued };
  },
});


