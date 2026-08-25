/**
 * Daily environment vote — the whole decision layer (FR-J001, ART-45).
 *
 * Pure module: no Convex, no clock, no randomness, no I/O. Every rule with a correctness
 * boundary lives here so it can be unit-tested directly, and the Convex adapter in
 * {@link ./environmentVoteFunctions.ts} is left with nothing but row access.
 *
 * ## The five acceptance criteria, and where each is decided
 *
 * | AC | Rule | Here |
 * |---|---|---|
 * | #1 candidates pass safety + Canon checks | {@link validateBallotCandidates} |
 * | #2 per-device daily limit | {@link evaluateVoteSubmission} |
 * | #3 exactly one winner after cutoff | {@link closeRound} |
 * | #4 winner injected as a Proposed World Event | {@link buildWinningIntervention} + `simulation` |
 * | #5 winning dictates no outcome | the catalog's shape (`ENVIRONMENT_VOTE_CATALOG`) |
 *
 * ## Abuse resistance is a requirement, not a footnote
 *
 * `deviceKey` is supplied by the client and is therefore a claim, not an identity: anyone
 * willing to clear storage can present a new one. That is stated plainly rather than papered
 * over, and it is why the limit is not the only control:
 *
 *  - **Attempts are counted, not just accepted votes.** A caller probing the surface with
 *    malformed candidate ids burns the same budget as a caller voting, so the surface cannot be
 *    used as a free oracle ({@link MAX_ATTEMPTS_PER_DEVICE_PER_ROUND}).
 *  - **The ballot is a closed set.** A viewer submits a catalog id, never text, so the
 *    worst a forged submission can achieve is a vote for something the world already sanctioned.
 *  - **A round is capped in total.** {@link MAX_SUBMISSIONS_PER_ROUND} bounds the work one round
 *    can ever cause, so key rotation degrades the tally's meaning but cannot degrade the
 *    deployment.
 *
 * The rejected alternative was to key the limit on an IP hash. It fails in both directions —
 * a shared NAT silently disenfranchises a whole building, and a rotating residential proxy
 * defeats it anyway — while adding a personal-data field the PRD's §15 minimisation rules would
 * then have to carry. A weaker control with no privacy cost beat a comparable control with one.
 */

import {
  ENVIRONMENT_VOTE_CATALOG,
  findEnvironmentVoteCandidate,
  VIEWER_VOTE_IDEMPOTENCY_PREFIX,
  type EnvironmentVoteCandidate,
} from '../shared/environmentVoteCatalog';
import { classifyViewerInput } from '../safety/viewerInput';

/** How many candidates a daily ballot offers. FR-J001: 「每日提供 3–4 個環境事件候選」. */
export const MIN_BALLOT_CANDIDATES = 3;
export const MAX_BALLOT_CANDIDATES = 4;

/** FR-J001 AC#2 「每個裝置每日投票次數受限」. One accepted vote per device per daily round. */
export const MAX_ACCEPTED_VOTES_PER_DEVICE_PER_ROUND = 1;

/**
 * Total submissions one device may make against one round, accepted or refused.
 *
 * Deliberately larger than the accepted-vote limit so an honest viewer who mistypes a route or
 * double-clicks is not locked out, and deliberately small so the endpoint cannot be used to
 * enumerate what the classifier rejects.
 */
export const MAX_ATTEMPTS_PER_DEVICE_PER_ROUND = 5;

/**
 * Hard ceiling on one round's SUBMISSIONS — accepted and refused alike.
 *
 * Counting submissions rather than accepted votes is what makes the ceiling a real bound: one
 * row is written per (round, device), so a caller rotating device keys to evade
 * {@link MAX_ACCEPTED_VOTES_PER_DEVICE_PER_ROUND} is buying rows out of this budget. Capping
 * accepted votes alone would have left the row count unbounded, which is the resource that
 * actually costs something.
 */
export const MAX_SUBMISSIONS_PER_ROUND = 100_000;

/** Accepted shape of an opaque device key: an opaque token, never prose and never an identity. */
const DEVICE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;

export const VOTE_REJECTION_CODES = [
  'VOTE_ROUND_NOT_OPEN',
  'VOTE_ROUND_FULL',
  'VOTE_CANDIDATE_UNKNOWN',
  'VOTE_DEVICE_KEY_INVALID',
  'VOTE_DEVICE_LIMIT_REACHED',
  'VOTE_DEVICE_ATTEMPTS_EXHAUSTED',
  'VOTE_INPUT_REJECTED',
] as const;
export type VoteRejectionCode = (typeof VOTE_REJECTION_CODES)[number];

export type VoteSubmission = {
  worldId: string;
  /** Opaque, client-supplied, untrusted. Validated structurally; never logged as-is. */
  deviceKey: string;
  /** Untrusted. Must name a catalog entry that is on today's ballot. */
  candidateId: string;
};

/** What the caller already knows about this device's history against this round. */
export type DeviceVoteHistory = {
  acceptedVotes: number;
  attempts: number;
};

export type VoteDecision =
  | { accepted: true; candidateId: string }
  | { accepted: false; code: VoteRejectionCode };

/**
 * One daily ballot: the candidates on offer and the instant voting stops.
 *
 * `roundKey` is derived, not stored-and-trusted, so two callers can never disagree about which
 * round a submission belongs to.
 */
export type VoteRound = {
  worldId: string;
  worldDay: number;
  candidateIds: readonly string[];
  /** Voting is open while `now < cutoffAt`. */
  cutoffAt: number;
  /** Every submission this round has seen, accepted or refused. See {@link MAX_SUBMISSIONS_PER_ROUND}. */
  submissionCount: number;
};

export const roundKey = (worldId: string, worldDay: number): string => `${worldId}:${worldDay}`;

/**
 * How long a daily ballot stays open once it is created.
 *
 * Shorter than a real day on purpose: the round must close, elect, and have its winner queued
 * before the world reaches the slot it is meant to affect, and the world clock is faster than
 * wall-clock. A round the world outran would be a vote with no consequence, which is worse than
 * a short one.
 */
export const VOTE_ROUND_DURATION_MS = 6 * 60 * 60 * 1000;

/** Stable, order-independent fingerprint. Same construction the simulation layer uses. */
function fingerprint(value: string, seed = 2166136261): number {
  let hash = seed;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * The value stored in place of a device's token (§15 data minimisation).
 *
 * NON-CRYPTOGRAPHIC, and named a digest rather than a hash for that reason. It is not defending
 * a secret: the token is a random string the browser generated for this purpose and that means
 * nothing anywhere else. What it buys is that a leaked `environmentVoteBallots` row does not
 * hand anyone the value a browser is still presenting, so the table cannot be replayed against
 * the live surface.
 *
 * Two independently seeded passes are concatenated for **64 bits**, not for strength. A single
 * 32-bit pass collides with near-certainty across {@link MAX_SUBMISSIONS_PER_ROUND} rows, and a
 * collision here does not leak anything — it silently merges two strangers' vote budgets and
 * refuses an honest viewer who has not voted. Correctness, not secrecy, is what sets the width.
 */
export function deviceDigest(deviceKey: string): string {
  const low = fingerprint(deviceKey).toString(16).padStart(8, '0');
  const high = fingerprint(deviceKey, 0x811c9dc5 ^ 0x5bf03635).toString(16).padStart(8, '0');
  return `fnv1a64:${high}${low}`;
}

/**
 * Today's 3–4 candidates, chosen deterministically from the catalog (AC#1 offer side).
 *
 * Deterministic because the ballot must be identical for every viewer of the same world-day and
 * must survive a server restart mid-round: a randomly drawn ballot would let two viewers vote on
 * different slates and would make the tally meaningless. The rotation is a stride co-prime with
 * the catalog size, so consecutive days do not repeat the same slate.
 */
export function selectDailyCandidates(worldId: string, worldDay: number): EnvironmentVoteCandidate[] {
  const size = ENVIRONMENT_VOTE_CATALOG.length;
  const seed = fingerprint(roundKey(worldId, worldDay));
  const count = MIN_BALLOT_CANDIDATES + (seed % (MAX_BALLOT_CANDIDATES - MIN_BALLOT_CANDIDATES + 1));
  const start = seed % size;
  // 3 is co-prime with the catalog's 7 entries, so the stride visits distinct indices.
  const stride = 3;
  const chosen: EnvironmentVoteCandidate[] = [];
  for (let step = 0; step < count; step += 1) {
    chosen.push(ENVIRONMENT_VOTE_CATALOG[(start + step * stride) % size]);
  }
  return chosen;
}

export type CandidateValidationIssue = {
  candidateId: string;
  code: 'CANDIDATE_UNSAFE_TEXT' | 'CANDIDATE_NOT_ENVIRONMENTAL' | 'CANDIDATE_DUPLICATE';
  reasonCodes: string[];
};

/**
 * FR-J001 AC#1 「候選事件通過安全與 Canon 檢查」.
 *
 * Two independent gates, run over the catalog rather than over viewer text:
 *
 *  - **Safety.** Every ballot string is classified by {@link classifyViewerInput}, the same
 *    FR-L003 policy applied to any untrusted viewer submission. The catalog is repository
 *    source, so this can only fail if a future edit introduces something the policy forbids —
 *    which is exactly the regression worth catching, and it catches it in a unit test rather
 *    than after the sentence has been shown to the public.
 *  - **Canon shape.** A candidate must describe the WORLD. A `predicate` or `value` naming a
 *    character, an outcome or a Canon write is refused, so the 不可接受 list (命令角色殺人、
 *    指定犯人、直接改寫 Canon Fact) cannot re-enter through the catalog.
 *
 * Returns issues rather than throwing: a ballot with one bad entry should serve the rest, and a
 * caller that wants a hard failure can assert the list is empty.
 */
export function validateBallotCandidates(
  candidates: readonly EnvironmentVoteCandidate[],
): CandidateValidationIssue[] {
  const issues: CandidateValidationIssue[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.candidateId)) {
      issues.push({ candidateId: candidate.candidateId, code: 'CANDIDATE_DUPLICATE', reasonCodes: [] });
      continue;
    }
    seen.add(candidate.candidateId);
    const reasonCodes = [candidate.title, candidate.description, candidate.publicSummary]
      .flatMap((text) => classifyViewerInput({ surface: 'vote_choice', text }).reasonCodes);
    if (reasonCodes.length > 0) {
      issues.push({
        candidateId: candidate.candidateId,
        code: 'CANDIDATE_UNSAFE_TEXT',
        reasonCodes: [...new Set(reasonCodes)],
      });
      continue;
    }
    if (!isEnvironmentalShape(candidate)) {
      issues.push({ candidateId: candidate.candidateId, code: 'CANDIDATE_NOT_ENVIRONMENTAL', reasonCodes: [] });
    }
  }
  return issues;
}

/**
 * Predicates a world-environment fact may use, and the character/outcome vocabulary it may not.
 *
 * An allowlist on the key and a denylist on the value: the key space is ours and small enough to
 * enumerate, while the value is prose and can only be screened. Both must pass.
 */
const ENVIRONMENT_PREDICATE_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;
const NON_ENVIRONMENTAL_PATTERN =
  /\b(?:character|player|npc|kill|murder|die|dies|dead|love|loves|marry|culprit|guilty|confess|secret|canon|fact_created|event)\b/i;

function isEnvironmentalShape(candidate: EnvironmentVoteCandidate): boolean {
  if (!ENVIRONMENT_PREDICATE_PATTERN.test(candidate.predicate)) return false;
  if (NON_ENVIRONMENTAL_PATTERN.test(candidate.predicate)) return false;
  return !NON_ENVIRONMENTAL_PATTERN.test(candidate.value);
}

/** Whether the round is still accepting ballots. Split out so the clock is always the caller's. */
export const isRoundOpen = (round: VoteRound, now: number): boolean =>
  Number.isFinite(now) && now < round.cutoffAt;

/**
 * FR-J001 AC#2 — the whole per-device decision, in one pure function.
 *
 * Ordered so the cheapest and least informative refusals come first: an exhausted device is
 * refused before its submission is even parsed, so burning the budget yields nothing. Every
 * branch returns a stable code and none of them echoes the submission.
 */
export function evaluateVoteSubmission(input: {
  round: VoteRound;
  submission: VoteSubmission;
  history: DeviceVoteHistory;
  now: number;
}): VoteDecision {
  const { round, submission, history, now } = input;

  if (history.attempts >= MAX_ATTEMPTS_PER_DEVICE_PER_ROUND) {
    return { accepted: false, code: 'VOTE_DEVICE_ATTEMPTS_EXHAUSTED' };
  }
  if (!isRoundOpen(round, now)) return { accepted: false, code: 'VOTE_ROUND_NOT_OPEN' };
  if (round.submissionCount >= MAX_SUBMISSIONS_PER_ROUND) return { accepted: false, code: 'VOTE_ROUND_FULL' };
  if (!DEVICE_KEY_PATTERN.test(submission.deviceKey)) {
    return { accepted: false, code: 'VOTE_DEVICE_KEY_INVALID' };
  }
  // FR-L003 defence in depth. The catalog check below would refuse an injection payload anyway,
  // but the classifier refuses it BEFORE the id is compared, so it never reaches a code path
  // that could log it.
  if (classifyViewerInput({ surface: 'vote_choice', text: submission.candidateId }).label === 'reject') {
    return { accepted: false, code: 'VOTE_INPUT_REJECTED' };
  }
  if (history.acceptedVotes >= MAX_ACCEPTED_VOTES_PER_DEVICE_PER_ROUND) {
    return { accepted: false, code: 'VOTE_DEVICE_LIMIT_REACHED' };
  }
  const candidate = findEnvironmentVoteCandidate(submission.candidateId);
  if (candidate === null || !round.candidateIds.includes(candidate.candidateId)) {
    return { accepted: false, code: 'VOTE_CANDIDATE_UNKNOWN' };
  }
  return { accepted: true, candidateId: candidate.candidateId };
}

export type VoteTally = Array<{ candidateId: string; votes: number }>;

/**
 * Votes per candidate, in the round's own candidate order.
 *
 * Every candidate on the ballot appears, including those with zero votes: a tally that omitted
 * them would render as though the option had not been offered. Ballots for an id that is not on
 * this ballot are ignored rather than counted, so a row written before a ballot changed cannot
 * elect something nobody could vote for.
 */
export function tallyRound(round: VoteRound, ballots: readonly { candidateId: string }[]): VoteTally {
  const counts = new Map<string, number>(round.candidateIds.map((candidateId) => [candidateId, 0]));
  for (const ballot of ballots) {
    const current = counts.get(ballot.candidateId);
    if (current !== undefined) counts.set(ballot.candidateId, current + 1);
  }
  return round.candidateIds.map((candidateId) => ({ candidateId, votes: counts.get(candidateId) ?? 0 }));
}

export type RoundOutcome =
  | { status: 'open' }
  | { status: 'closed'; winner: null; tally: VoteTally; reason: 'NO_VOTES' }
  | { status: 'closed'; winner: EnvironmentVoteCandidate; tally: VoteTally; reason: 'ELECTED' };

/**
 * FR-J001 AC#3 「投票截止後只有一項勝出」.
 *
 * One winner or none, never two. Ties are broken by the round's own candidate order, which is
 * itself deterministic ({@link selectDailyCandidates}) — so a tie resolves the same way on every
 * machine and on every re-run, which is what makes the closing idempotent. A drawn round is NOT
 * left for an operator to settle: an unresolved tie would either block the day or invite a
 * hand-picked winner, and both are worse than a rule stated in advance.
 *
 * Zero votes elects nobody. Injecting an unvoted event would let the ballot manufacture world
 * changes nobody asked for, which is a stronger claim than 「勝出」 supports.
 */
export function closeRound(round: VoteRound, ballots: readonly { candidateId: string }[], now: number): RoundOutcome {
  if (isRoundOpen(round, now)) return { status: 'open' };
  const tally = tallyRound(round, ballots);
  const leader = tally.reduce<{ candidateId: string; votes: number } | null>(
    (best, entry) => (best === null || entry.votes > best.votes ? entry : best),
    null,
  );
  if (leader === null || leader.votes === 0) {
    return { status: 'closed', winner: null, tally, reason: 'NO_VOTES' };
  }
  const winner = findEnvironmentVoteCandidate(leader.candidateId);
  if (winner === null) return { status: 'closed', winner: null, tally, reason: 'NO_VOTES' };
  return { status: 'closed', winner, tally, reason: 'ELECTED' };
}

/**
 * The row the winner becomes: a queued intervention, NOT a canonical event (AC#4).
 *
 * The viewer module deliberately stops here. It records *which catalog entry won and for which
 * slot*, and the `simulation` module builds the Proposed World Event from the same catalog and
 * commits it through the existing structural + Canon pipeline. Two consequences worth stating:
 *
 *  - The ballot has no path to Canon. `viewer` may not depend on `canon`
 *    (`architecture/module-boundaries.json`), so this is enforced by the build rather than by
 *    this comment.
 *  - The winning event is still subject to rejection. Canon validation is not softened for a
 *    voted event, so a winner that would contradict established world rules is refused exactly
 *    as a Director proposal would be — 「勝出」 buys a proposal, not an outcome (AC#5).
 *
 * `idempotencyKey` is derived from the round, so closing the same round twice proposes the same
 * event once. That is the same guarantee the commit pipeline already relies on.
 */
export type WinningIntervention = {
  worldId: string;
  worldDay: number;
  targetWorldDay: number;
  candidateId: string;
  idempotencyKey: string;
  votes: number;
};

export function buildWinningIntervention(
  round: VoteRound,
  outcome: RoundOutcome,
  /**
   * The slot the winner is applied to, decided at CLOSE time rather than at open.
   *
   * A target fixed when the ballot opened would silently expire: if the world advanced past
   * `worldDay + 1` while the round was still running, the queue would hold an intervention for
   * a day that had already been simulated and it would never be applied. Deciding here, against
   * the world's current position, is what makes 「勝出事件注入」 a guarantee rather than a race.
   */
  targetWorldDay: number,
): WinningIntervention | null {
  if (outcome.status !== 'closed' || outcome.winner === null) return null;
  const votes = outcome.tally.find((entry) => entry.candidateId === outcome.winner.candidateId)?.votes ?? 0;
  return {
    worldId: round.worldId,
    worldDay: round.worldDay,
    targetWorldDay: Math.max(targetWorldDay, round.worldDay + 1),
    candidateId: outcome.winner.candidateId,
    idempotencyKey:
      `${VIEWER_VOTE_IDEMPOTENCY_PREFIX}${roundKey(round.worldId, round.worldDay)}:${outcome.winner.candidateId}`,
    votes,
  };
}
