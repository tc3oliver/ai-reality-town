/**
 * Viewer-domain tables (FR-H005 / ART-70; FR-J001 / ART-45).
 *
 * Two groups. `viewerEpisodeProgress` is a forward-compatible declaration for the future
 * "Watched Episodes Only" spoiler mode ({@link ./spoilerMode.ts}) that nothing writes to yet.
 * The `environmentVote*` tables are the daily environment ballot (§13.13 Viewer Intervention),
 * and they ARE written — by the one viewer-gated mutation this deployment exposes.
 *
 * ## Data minimisation (§15)
 *
 * No table here stores an IP address, a user agent, or any value the viewer did not choose to
 * present. The device identifier is stored only as a digest: the browser holds an opaque random
 * token, the deployment holds a fingerprint of it, and a leaked row therefore cannot be
 * correlated back to the value a browser still carries. The digest is a rate-limit key, not an
 * identity — see the abuse-resistance note in {@link ./environmentVote.ts}.
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
