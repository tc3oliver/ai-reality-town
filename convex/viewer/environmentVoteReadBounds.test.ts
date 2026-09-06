/**
 * ART-155 — the environment vote's reads are bounded by the round row, not by turnout.
 *
 * The defect these tests exist for was a size mismatch nobody had written down in one place:
 * `MAX_SUBMISSIONS_PER_ROUND` allowed 100,000 ballot rows per round, one row per (round, device),
 * while Convex refuses any single query that reads more than 16,384 documents. Both consumers of
 * a round's ballots — the ANONYMOUS `getEnvironmentVoteBallot` query and the closing cron —
 * `.collect()`ed them whole. Past ~16k rows the public ballot threw for every visitor at once and
 * the cron could never close the round again, so the surface stayed permanently stuck rather than
 * degrading.
 *
 * Nothing tested `environmentVoteFunctions.ts` at all before this file: `environmentVote.test.ts`
 * covers the pure policy, which was never wrong. The bug lived entirely in the wiring, so these
 * tests drive the registered `query` / `internalMutation` exports through `_handler`.
 *
 * The load-bearing piece is {@link createDb}'s document limit. A double that happily returned
 * 20,000 rows from one `.collect()` would let the original code pass every assertion below — the
 * tally would be right, the round would close, and the test would prove nothing. Convex's refusal
 * IS the failure mode, so the double has to reproduce it.
 */

import { jest } from '@jest/globals';

import { getEnvironmentVoteBallot, submitEnvironmentVote, tickEnvironmentVoteRounds } from './environmentVoteFunctions';
import {
  CONVEX_MAX_DOCUMENTS_PER_QUERY,
  MAX_SUBMISSIONS_PER_ROUND,
  countersFromBallots,
  selectDailyCandidates,
  tallyFromCounters,
  tallyRound,
  type VoteRound,
} from './environmentVote';

type Row = Record<string, unknown>;
type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };

type BallotCandidate = { candidateId: string; title: string; description: string; votes: number };
type BallotResult = { totalVotes: number; candidates: BallotCandidate[] } | null;
type SubmitResult = { accepted: boolean; code: string | null };
type TickResult = { worldCount: number; opened: number; closed: number; queued: number };
type IndexBuilder = { eq: (field: string, value: unknown) => IndexBuilder };

const WORLD_ID = 'mistwood';
const WORLD_DAY = 4;
const NOW = 1_700_000_000_000;

const CANDIDATES = selectDailyCandidates(WORLD_ID, WORLD_DAY).map((candidate) => candidate.candidateId);

/** `[table]: { [indexName]: orderedFieldList }`, transcribed from `convex/viewer/schema.ts`. */
const INDEXES: Record<string, Record<string, readonly string[]>> = {
  environmentVoteRounds: {
    by_world_and_day: ['worldId', 'worldDay'],
    by_world_and_status: ['worldId', 'status'],
  },
  environmentVoteBallots: {
    by_round_and_device: ['worldId', 'worldDay', 'deviceDigest'],
    by_round: ['worldId', 'worldDay'],
  },
  environmentVoteInterventions: {
    by_world_and_target_day: ['worldId', 'targetWorldDay', 'status'],
    by_idempotency_key: ['idempotencyKey'],
  },
  worldSchedules: { by_mode_and_status: ['mode', 'status'] },
};

/**
 * An in-memory `db` that refuses an over-large read the way Convex does.
 *
 * `maxDocumentsPerQuery` defaults to the real limit. Every terminal read reports how many rows it
 * returned, so the assertions below can talk about read COST as well as read correctness — a
 * regression to `.collect()` that stayed under the limit would still be a regression, and
 * `reads.max` catches it.
 */
function createDb(tables: Record<string, Row[]>, maxDocumentsPerQuery = CONVEX_MAX_DOCUMENTS_PER_QUERY) {
  const reads: number[] = [];
  let nextId = 0;

  function deliver(table: string, rows: Row[]): Row[] {
    if (rows.length > maxDocumentsPerQuery) {
      // The real message is longer; the shape — a thrown error, not a truncated result — is what
      // matters, and truncating instead would silently manufacture a wrong tally.
      throw new Error(`CONVEX_TOO_MANY_DOCUMENTS: read ${rows.length} documents from '${table}', limit ${maxDocumentsPerQuery}`);
    }
    reads.push(rows.length);
    return rows;
  }

  return {
    reads: {
      count: () => reads.length,
      total: () => reads.reduce((sum, n) => sum + n, 0),
      max: () => reads.reduce((best, n) => Math.max(best, n), 0),
      reset: () => { reads.length = 0; },
    },
    db: {
      query(table: string) {
        return {
          withIndex(indexName: string, build?: (q: IndexBuilder) => unknown) {
            const fields = INDEXES[table]?.[indexName];
            if (!fields) throw new Error(`unknown index '${indexName}' on '${table}'`);
            const eq: Array<[string, unknown]> = [];
            const builder: IndexBuilder = {
              eq(field: string, value: unknown) {
                if (fields[eq.length] !== field) {
                  throw new Error(`'${table}.${indexName}': expected eq('${fields[eq.length]}'), got '${field}'`);
                }
                eq.push([field, value]);
                return builder;
              },
            };
            if (build) build(builder);
            const matched = (tables[table] ?? []).filter((row) => eq.every(([field, value]) => row[field] === value));
            return {
              collect: () => Promise.resolve(deliver(table, matched)),
              take: (n: number) => Promise.resolve(deliver(table, matched.slice(0, n))),
              first: () => Promise.resolve(deliver(table, matched.slice(0, 1))[0] ?? null),
              unique: () => {
                if (matched.length > 1) throw new Error(`'${table}.${indexName}': unique() matched ${matched.length}`);
                return Promise.resolve(deliver(table, matched.slice(0, 1))[0] ?? null);
              },
            };
          },
        };
      },
      insert(table: string, row: Row) {
        const _id = `${table}:${(nextId += 1)}`;
        (tables[table] ??= []).push({ ...row, _id });
        return Promise.resolve(_id);
      },
      patch(id: string, patch: Row) {
        for (const rows of Object.values(tables)) {
          const row = rows.find((candidate) => candidate._id === id);
          if (row) { Object.assign(row, patch); return Promise.resolve(undefined); }
        }
        throw new Error(`patch target not found: ${id}`);
      },
    },
  };
}

function roundRow(over: Row = {}): Row {
  return {
    _id: 'environmentVoteRounds:seed',
    schemaVersion: 1,
    worldId: WORLD_ID,
    worldDay: WORLD_DAY,
    candidateIds: CANDIDATES,
    cutoffAt: NOW + 60_000,
    targetWorldDay: WORLD_DAY + 1,
    status: 'open',
    voteCount: 0,
    submissionCount: 0,
    votesByCandidate: {},
    createdAt: NOW - 1_000,
    ...over,
  };
}

/** `count` ballot rows, spread deterministically across the ballot's candidates. */
function ballotRows(count: number): Row[] {
  return Array.from({ length: count }, (_unused, index) => ({
    _id: `environmentVoteBallots:${index}`,
    schemaVersion: 1,
    worldId: WORLD_ID,
    worldDay: WORLD_DAY,
    deviceDigest: `digest-${index}`,
    candidateId: CANDIDATES[index % CANDIDATES.length],
    attempts: 1,
    createdAt: NOW - 500,
    updatedAt: NOW - 500,
  }));
}

const voteRound = (row: Row): VoteRound => ({
  worldId: row.worldId as string,
  worldDay: row.worldDay as number,
  candidateIds: row.candidateIds as string[],
  cutoffAt: row.cutoffAt as number,
  submissionCount: row.submissionCount as number,
});

/** The counters a round row currently holds, as a typed value rather than an `unknown` field. */
const countersOf = (row: Row): Record<string, number> => row.votesByCandidate as Record<string, number>;

/** The `{ candidateId }` list a tally helper takes, from stored ballot rows. */
function castOf(rows: readonly Row[]): Array<{ candidateId: string }> {
  const cast: Array<{ candidateId: string }> = [];
  for (const row of rows) {
    if (typeof row.candidateId === 'string') cast.push({ candidateId: row.candidateId });
  }
  return cast;
}

const ballot = getEnvironmentVoteBallot as unknown as Registered;
const submit = submitEnvironmentVote as unknown as Registered;
const tick = tickEnvironmentVoteRounds as unknown as Registered;

beforeEach(() => { jest.spyOn(Date, 'now').mockReturnValue(NOW); });
afterEach(() => { jest.restoreAllMocks(); });

describe('ART-155: the ceiling and the read limit are consistent', () => {
  /**
   * The whole finding in one assertion. `MAX_SUBMISSIONS_PER_ROUND` was 100,000 — six times the
   * limit — so "the round is capped" and "the round can be read" were two claims that could not
   * both be true. Any future raise has to move both numbers or fail here.
   */
  it('a round can never hold more ballot rows than one query may read', () => {
    expect(MAX_SUBMISSIONS_PER_ROUND).toBeLessThan(CONVEX_MAX_DOCUMENTS_PER_QUERY);
  });

  /**
   * The migration path and the fast path must be the same answer, or a round would change its
   * tally the moment it was migrated.
   */
  it('the counter tally and the ballot tally agree on the same round', () => {
    const round = voteRound(roundRow());
    const ballots = castOf(ballotRows(37));
    expect(tallyFromCounters(round, countersFromBallots(round, ballots))).toEqual(tallyRound(round, ballots));
  });

  /** Every candidate on the ballot appears even at zero, and a stale counter is not surfaced. */
  it('reports unvoted candidates at zero and ignores counters for ids not on this ballot', () => {
    const round = voteRound(roundRow());
    const tally = tallyFromCounters(round, { [CANDIDATES[0]]: 3, 'retired-option': 99 });
    expect(tally).toHaveLength(CANDIDATES.length);
    expect(tally.find((entry) => entry.candidateId === CANDIDATES[0])?.votes).toBe(3);
    expect(tally.every((entry) => entry.candidateId !== 'retired-option')).toBe(true);
    expect(tally.filter((entry) => entry.votes === 0)).toHaveLength(CANDIDATES.length - 1);
  });
});

describe('ART-155: a round larger than the Convex read limit still works', () => {
  // One more row than a single query may return. Before ART-155 both handlers below collected
  // this set whole, so both threw.
  const OVERSIZED = CONVEX_MAX_DOCUMENTS_PER_QUERY + 1;

  function oversizedWorld() {
    const rows = ballotRows(OVERSIZED);
    const counters = countersFromBallots(voteRound(roundRow()), castOf(rows));
    return {
      environmentVoteRounds: [roundRow({ voteCount: OVERSIZED, submissionCount: OVERSIZED, votesByCandidate: counters })],
      environmentVoteBallots: rows,
      environmentVoteInterventions: [] as Row[],
      worldSchedules: [{
        _id: 'worldSchedules:1', worldId: WORLD_ID, mode: 'public', status: 'running',
        publishEnabled: true, nextWorldDay: WORLD_DAY,
      }],
      expectedCounters: counters,
    };
  }

  it('serves the public ballot without reading a single ballot row', async () => {
    const tables = oversizedWorld();
    const { db, reads } = createDb(tables as unknown as Record<string, Row[]>);

    const result = await ballot._handler({ db }, { worldId: WORLD_ID }) as BallotResult;

    expect(result?.totalVotes).toBe(OVERSIZED);
    for (const entry of result?.candidates ?? []) {
      expect(entry.votes).toBe(tables.expectedCounters[entry.candidateId]);
    }
    // The round row, and nothing else. Not merely "under the limit" — the point of the counter is
    // that turnout stops being an input to the read cost at all.
    expect(reads.total()).toBe(1);
  });

  it('closes the round from the cron without reading a single ballot row', async () => {
    const tables = oversizedWorld();
    // Expired, so this tick must actually close it rather than skip it.
    tables.environmentVoteRounds[0].cutoffAt = NOW - 1;
    const { db, reads } = createDb(tables as unknown as Record<string, Row[]>);

    const outcome = await tick._handler({ db }, {}) as TickResult;

    expect(outcome.closed).toBe(1);
    expect(tables.environmentVoteRounds[0].status).toBe('closed');
    expect(tables.environmentVoteRounds[0].winnerCandidateId).toBeDefined();
    expect(tables.environmentVoteInterventions).toHaveLength(1);
    // Round + schedules + the round-exists probe + the duplicate-intervention probe. No ballots.
    expect(reads.max()).toBeLessThanOrEqual(1);
  });

  /**
   * The proof that the double is doing its job. If `createDb` did not enforce the limit, both
   * tests above would also have passed on the ORIGINAL code, and would have proved nothing.
   */
  it('the harness itself refuses an over-large read, so the tests above are not vacuous', () => {
    const tables = oversizedWorld();
    const { db } = createDb(tables as unknown as Record<string, Row[]>);
    expect(() => db.query('environmentVoteBallots')
      .withIndex('by_round', (q: IndexBuilder) => q.eq('worldId', WORLD_ID).eq('worldDay', WORLD_DAY))
      .collect()).toThrow(/CONVEX_TOO_MANY_DOCUMENTS/);
  });
});

describe('ART-155: the tally is maintained on the round, in the vote transaction', () => {
  function world() {
    return {
      environmentVoteRounds: [roundRow()],
      environmentVoteBallots: [] as Row[],
      environmentVoteInterventions: [] as Row[],
      worldSchedules: [] as Row[],
    };
  }

  it('increments the voted candidate and leaves the others alone', async () => {
    const tables = world();
    const { db } = createDb(tables as unknown as Record<string, Row[]>);

    await submit._handler({ db }, { worldId: WORLD_ID, deviceKey: 'device-aaaaaaaa', candidateId: CANDIDATES[1] });

    expect(tables.environmentVoteRounds[0].votesByCandidate).toEqual({ [CANDIDATES[1]]: 1 });
    expect(tables.environmentVoteRounds[0].voteCount).toBe(1);
  });

  /**
   * A refused submission still records its attempt (that is what makes the attempt budget real),
   * but it must NOT move the tally — otherwise probing the surface would inflate a candidate.
   */
  it('does not touch the tally when the submission is refused', async () => {
    const tables = world();
    const { db } = createDb(tables as unknown as Record<string, Row[]>);

    const result = await submit._handler({ db }, { worldId: WORLD_ID, deviceKey: 'device-bbbbbbbb', candidateId: 'not-a-candidate' }) as SubmitResult;

    expect(result.accepted).toBe(false);
    expect(tables.environmentVoteRounds[0].votesByCandidate).toEqual({});
    expect(tables.environmentVoteRounds[0].submissionCount).toBe(1);
    expect(tables.environmentVoteRounds[0].voteCount).toBe(0);
  });

  /**
   * ART-155 / audit finding N-2, and the reason the ART-155 bound is sound at all.
   *
   * `VOTE_ROUND_FULL` used to fall through to the insert, so a round sitting at its ceiling kept
   * allocating one row per new device — forever, since `environmentVoteBallots` is deliberately
   * never vacuumed. The ceiling capped accepted VOTES and nothing else, which is precisely what
   * made the read limit reachable. It also falsifies the claim this whole task rests on: "a
   * round's ballots fit in one query" is only true while ROWS are capped.
   */
  it('a full round allocates no row for a device it has never seen', async () => {
    const tables = world();
    tables.environmentVoteRounds[0].submissionCount = MAX_SUBMISSIONS_PER_ROUND;
    const { db } = createDb(tables as unknown as Record<string, Row[]>);

    const result = await submit._handler({ db }, {
      worldId: WORLD_ID, deviceKey: 'device-cccccccc', candidateId: CANDIDATES[0],
    }) as SubmitResult;

    expect(result).toEqual({ accepted: false, code: 'VOTE_ROUND_FULL' });
    expect(tables.environmentVoteBallots).toHaveLength(0);
    // Not even the round row moves: past the ceiling this surface stops being a way to write.
    expect(tables.environmentVoteRounds[0].submissionCount).toBe(MAX_SUBMISSIONS_PER_ROUND);
  });

  /**
   * The other half, so the rule above cannot be satisfied by refusing to record anything. A
   * refusal that JUDGED the submission must still cost an attempt, or the endpoint becomes a free
   * oracle for probing what the classifier rejects.
   */
  it('a judged refusal still records its attempt', async () => {
    const tables = world();
    const { db } = createDb(tables as unknown as Record<string, Row[]>);

    await submit._handler({ db }, { worldId: WORLD_ID, deviceKey: 'device-dddddddd', candidateId: 'not-a-candidate' });

    expect(tables.environmentVoteBallots).toHaveLength(1);
    expect(tables.environmentVoteBallots[0].attempts).toBe(1);
    expect(tables.environmentVoteBallots[0].candidateId).toBeUndefined();
  });

  /** The counter and the ballot rows must not be able to disagree. */
  it('agrees with a tally recomputed from the ballots it wrote', async () => {
    const tables = world();
    const { db } = createDb(tables as unknown as Record<string, Row[]>);

    for (let index = 0; index < 9; index += 1) {
      await submit._handler({ db }, {
        worldId: WORLD_ID,
        deviceKey: `device-${String(index).padStart(8, '0')}`,
        candidateId: CANDIDATES[index % CANDIDATES.length],
      });
    }

    const round = voteRound(tables.environmentVoteRounds[0]);
    expect(tallyFromCounters(round, countersOf(tables.environmentVoteRounds[0])))
      .toEqual(tallyRound(round, castOf(tables.environmentVoteBallots)));
  });
});

describe('ART-155: a round opened before the counter existed is migrated once', () => {
  function legacyWorld(status: 'open' | 'closed' = 'open', cutoffAt = NOW + 60_000) {
    const rows = ballotRows(11);
    const round = roundRow({ cutoffAt, status, voteCount: rows.length, submissionCount: rows.length });
    // A pre-ART-155 round: the field is ABSENT, not empty. `openDueRounds` writes `{}` on every
    // new round, so this is the only way the value can be missing.
    delete round.votesByCandidate;
    return {
      environmentVoteRounds: [round],
      environmentVoteBallots: rows,
      environmentVoteInterventions: [] as Row[],
      worldSchedules: [{
        _id: 'worldSchedules:1', worldId: WORLD_ID, mode: 'public', status: 'running',
        publishEnabled: true, nextWorldDay: WORLD_DAY,
      }],
    };
  }

  it('still serves the right tally from its ballots before migration', async () => {
    const tables = legacyWorld();
    const { db } = createDb(tables as unknown as Record<string, Row[]>);

    const result = await ballot._handler({ db }, { worldId: WORLD_ID }) as BallotResult;

    expect(result?.totalVotes).toBe(11);
    const round = voteRound(tables.environmentVoteRounds[0]);
    const expected = tallyRound(round, castOf(tables.environmentVoteBallots));
    expect((result?.candidates ?? []).map((entry) => ({ candidateId: entry.candidateId, votes: entry.votes })))
      .toEqual(expected);
  });

  it('is migrated by the cron while still open, and stops reading ballots afterwards', async () => {
    const tables = legacyWorld();
    const { db, reads } = createDb(tables as unknown as Record<string, Row[]>);

    await tick._handler({ db }, {});

    // Not closed — it has not expired — but it now carries the counters.
    expect(tables.environmentVoteRounds[0].status).toBe('open');
    const round = voteRound(tables.environmentVoteRounds[0]);
    expect(countersOf(tables.environmentVoteRounds[0]))
      .toEqual(countersFromBallots(round, castOf(tables.environmentVoteBallots)));

    reads.reset();
    await ballot._handler({ db }, { worldId: WORLD_ID });
    expect(reads.total()).toBe(1);
  });

  it('is migrated on the way past when it closes', async () => {
    const tables = legacyWorld('open', NOW - 1);
    const { db } = createDb(tables as unknown as Record<string, Row[]>);

    await tick._handler({ db }, {});

    expect(tables.environmentVoteRounds[0].status).toBe('closed');
    expect(tables.environmentVoteRounds[0].votesByCandidate).toBeDefined();
  });
});
