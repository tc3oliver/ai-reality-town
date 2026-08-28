/**
 * Viewer-domain tables (FR-H005 / ART-70; FR-J001 / ART-45; FR-H004 / ART-39).
 *
 * Three groups. `viewerEpisodeProgress` is a forward-compatible declaration for the future
 * "Watched Episodes Only" spoiler mode ({@link ./spoilerMode.ts}) that nothing writes to yet.
 * The `environmentVote*` tables are the daily environment ballot (§13.13 Viewer Intervention).
 * `viewerProgress` is the §13.12 Viewer Progress record behind the return recap (ART-39). The
 * latter two ARE written — by the two viewer-gated mutations this deployment exposes.
 *
 * ## Data minimisation (§15)
 *
 * No table here stores an IP address, a user agent, or any value the viewer did not choose to
 * present. The device identifier is stored only as a digest: the browser holds an opaque random
 * token, the deployment holds a fingerprint of it, and a leaked row therefore cannot be
 * correlated back to the value a browser still carries. The digest is a rate-limit key, not an
 * identity — see the abuse-resistance note in {@link ./environmentVote.ts}.
 *
 * The ballot's device token and the progress device token are DIFFERENT random values held under
 * different `localStorage` keys (`src/components/vote/voteDeviceKey.ts` versus
 * `src/components/recap/viewerProgressKey.ts`). Sharing one would make「這個裝置投了什麼」and
 * 「這個裝置讀到哪裡」joinable on a single column, which is precisely the correlation §15 asks
 * the product not to create for its own convenience.
 */

import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const viewerTables = {
  /**
   * Per-viewer, per-episode watched progress. `viewerKey` is an opaque
   * viewer/device identifier (auth subject or device id); one row per watched
   * (worldId, viewerKey, worldDay). Indexed for fast "has this viewer watched
   * day N" lookups that the watchedOnly mode needs.
   */
  viewerEpisodeProgress: defineTable({
    worldId: v.string(),
    viewerKey: v.string(),
    worldDay: v.number(),
    episodeNumber: v.optional(v.number()),
    watchedAt: v.number(),
  }).index('by_viewer_world_day', ['worldId', 'viewerKey', 'worldDay']),

  /**
   * PRD §13.12 Viewer Progress — one row per (world, viewer), behind the FR-H004 return recap.
   *
   * NOT a reshape of `viewerEpisodeProgress` above. That table is row-per-watched-DAY and is
   * ART-70's declared-but-unpopulated forward compatibility evidence; §13.12 is a single
   * record-per-viewer with a last position and two follow sets. Two different shapes answering
   * two different questions, so this is a new table rather than a migration of one that ART-70's
   * 「不得阻止後續支援」claim rests on staying untouched.
   *
   * ## `viewerKey` is namespaced, deliberately
   *
   * `device:<digest>` today; `auth:<subject>` when a viewer sign-in exists. The namespace is part
   * of the stored value rather than a separate column so ART-71 (FR-J003) can write authenticated
   * rows ALONGSIDE anonymous ones and merge them explicitly, instead of having to rewrite every
   * existing row to make room for a second kind of identity. See `docs/device-return-recap.md` §4.
   *
   * ## What this row is NOT
   *
   * It is not an identity and it is not a security boundary against an adversary. The digest is
   * of a token the browser minted for itself; anyone presenting someone else's token IS that
   * viewer as far as this table can tell. Keying every read and write on the caller's own digest
   * through `by_world_and_viewer` is what makes cross-identity access structurally impossible by
   * ACCIDENT and by ENUMERATION — no caller-supplied row id, no scan — and that is the whole of
   * the claim. The same caveat {@link ./environmentVote.ts} makes for voting applies verbatim.
   */
  viewerProgress: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    /** `device:<digest>` or (later) `auth:<subject>`. Never a raw device token. */
    viewerKey: v.string(),
    /** `episode:<worldId>:<worldDay>`, or absent when the viewer has no recorded position. */
    lastViewedEpisodeId: v.optional(v.string()),
    followedCharacterIds: v.array(v.string()),
    followedArcIds: v.array(v.string()),
    /** One of `SPOILER_MODES` ({@link ./spoilerMode.ts}). Runtime-validated on write AND read. */
    spoilerMode: v.string(),
    /** Every submission from this viewer against this world, accepted and refused. */
    attempts: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_world_and_viewer', ['worldId', 'viewerKey']),

  /**
   * Row count per world, so the per-world ceiling is a lookup rather than a scan.
   *
   * ## Why this is a table of its own, which nothing else in this repo does
   *
   * Every other counter here is a COLUMN on the entity that owns the thing being counted —
   * `environmentVoteRounds.submissionCount` is on the round, because a round is a row and its
   * submissions belong to it. `viewerProgress` has no such owner: the thing being bounded is
   * "how many devices have a row in this world", and a world is not a row in this module. The
   * alternatives were both worse. Counting with `.take(CEILING + 1)` reads up to that many
   * documents on every single write, and Convex caps a transaction's reads well below the
   * ceiling this needs to enforce; hanging the count off `worldSchedules` would put a viewer
   * write on the same row the simulation scheduler patches every slot, so an abuse control would
   * start contending with the world clock.
   *
   * So: the first standalone derived counter in the repo, argued on that rather than on a
   * precedent that does not exist.
   *
   * ## It is increment-only, and that is safe only while `viewerProgress` is never vacuumed
   *
   * Nothing decrements this. `viewerProgress` is deliberately absent from `TablesToVacuum` in
   * `convex/crons.ts` — the same exclusion, and the same reason, that
   * `dynamicViewMetricRollups` and `publicRuntimeSnapshots` carry: deleting a row by
   * `_creationTime` would throw away a quiet viewer's whole progress rather than trimming
   * anything. If retention is ever enabled for `viewerProgress`, THIS COUNTER MUST GAIN A
   * RECONCILE PATH FIRST: it would otherwise drift monotonically upward as rows are deleted and
   * would eventually lock a world out of recording progress permanently, with no bug visible
   * anywhere except a `PROGRESS_WORLD_FULL` on a world holding almost no rows.
   * `viewerProgressVacuumExclusion.test.ts` fails if the table is added to that list.
   */
  viewerProgressCounters: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    rowCount: v.number(),
    updatedAt: v.number(),
  }).index('by_world', ['worldId']),

  /**
   * One daily ballot per (world, worldDay). FR-J001 AC#3 depends on this row being the single
   * place a round's outcome is recorded: `status` moves `open -> closed` exactly once, and the
   * winner is written in the same transaction, so a second close cannot elect a second winner.
   */
  environmentVoteRounds: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    worldDay: v.number(),
    /** Catalog ids on offer, 3–4 of them, in ballot order. */
    candidateIds: v.array(v.string()),
    cutoffAt: v.number(),
    /** The later world-day the winner is queued against. Never the day being voted on. */
    targetWorldDay: v.number(),
    status: v.union(v.literal('open'), v.literal('closed')),
    /** Accepted votes. Shown to viewers. */
    voteCount: v.number(),
    /** Every submission, accepted or refused. The abuse ceiling is checked against this. */
    submissionCount: v.number(),
    winnerCandidateId: v.optional(v.string()),
    closedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index('by_world_and_day', ['worldId', 'worldDay'])
    .index('by_world_and_status', ['worldId', 'status']),

  /**
   * One row per (round, device), carrying that device's whole history against the round.
   *
   * A row per device rather than a row per vote: the per-device limit and the attempt budget are
   * both properties of the pair, and a row-per-vote layout would have made "how many times has
   * this device tried" a scan instead of a lookup — which is exactly the query an abuse control
   * must not be slow at.
   */
  environmentVoteBallots: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    worldDay: v.number(),
    /** Digest of the client's opaque device token. Never the token itself. */
    deviceDigest: v.string(),
    /** The candidate this device elected, or absent when every submission was refused. */
    candidateId: v.optional(v.string()),
    /** Submissions from this device against this round, accepted and refused. */
    attempts: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_round_and_device', ['worldId', 'worldDay', 'deviceDigest'])
    .index('by_round', ['worldId', 'worldDay']),

  /**
   * The winner, queued for the simulation (§13.13, FR-J001 AC#4).
   *
   * The viewer module writes this row and stops. `convex/simulation` reads it, rebuilds the
   * Proposed World Event from `convex/shared/environmentVoteCatalog.ts`, and commits it through
   * the ordinary structural + Canon pipeline — so a voted event is proposed, never accepted, and
   * is refused on the same terms as any other proposal.
   */
  environmentVoteInterventions: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    /** The round that elected it. */
    worldDay: v.number(),
    /** The slot it is applied to. */
    targetWorldDay: v.number(),
    candidateId: v.string(),
    /** Derived from the round, so re-closing proposes the same event once. */
    idempotencyKey: v.string(),
    votes: v.number(),
    status: v.union(v.literal('queued'), v.literal('applied')),
    /** Set once the Canon pipeline accepts it. Absent while queued. */
    appliedEventId: v.optional(v.string()),
    createdAt: v.number(),
    appliedAt: v.optional(v.number()),
  }).index('by_world_and_target_day', ['worldId', 'targetWorldDay', 'status'])
    .index('by_idempotency_key', ['idempotencyKey']),
};
