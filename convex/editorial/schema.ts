import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const editorialTables = {
  dailyEpisodes: defineTable({
    schemaVersion: v.literal(1), worldId: v.string(), worldDay: v.number(), episodeNumber: v.number(),
    status: v.union(v.literal('ready'), v.literal('withheld'), v.literal('failed')),
    episode: v.optional(v.any()), safetyClassificationId: v.optional(v.string()), errorCode: v.optional(v.string()),
    sourceEventIds: v.array(v.string()), createdAt: v.number(),
  })
    .index('by_world_and_day', ['worldId', 'worldDay'])
    .index('by_world_and_episode', ['worldId', 'episodeNumber']),

  // Independent publication lifecycle (FR-K004). Separate from canon: rows here
  // govern only the visibility of derived public content. Deleting/superseding
  // a record never touches an accepted Canon Event.
  /**
   * Episode-derived share formats (FR-G005 / ART-36).
   *
   * A pure PROJECTION of an already-accepted Daily Episode, kept in its own table rather than as
   * a column on `dailyEpisodes` because the two carry different decisions: the Episode's status
   * is about the Episode, and a share format can be refused (or regenerated under a revised
   * safety label) while the Episode it quotes stays published.
   *
   * `formats` is `v.any()` for the same reason `dailyEpisodes.episode` is — the shape is owned by
   * `derived/shareFormats.ts` and validated there on the way in and on the way out. Reads are
   * index-scoped to one world day; nothing sweeps this table world-wide.
   *
   * `blocked` rows deliberately keep `formats` UNSET. Copy the safety gate refused is not stored
   * where a later reader could find it and mistake a row's existence for permission to use it;
   * `reasonCodes` records why, which is what a reviewer actually needs.
   */
  episodeShareFormats: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    worldDay: v.number(),
    episodeNumber: v.number(),
    /**
     * `manual_release_required` is the BEST outcome available: an administrator may take this
     * copy by hand. There is deliberately no `published` value — this deployment has no external
     * transport, and FR-G005 AC#3 is enforced by that absence rather than by a status word.
     */
    status: v.union(v.literal('manual_release_required'), v.literal('blocked'), v.literal('failed')),
    formats: v.optional(v.any()),
    safetyClassificationId: v.optional(v.string()),
    reasonCodes: v.array(v.string()),
    errorCode: v.optional(v.string()),
    /** The accepted events the source Episode cited (FR-G005 AC#2). */
    sourceEventIds: v.array(v.string()),
    createdAt: v.number(),
  })
    .index('by_world_and_day', ['worldId', 'worldDay'])
    .index('by_world_and_status', ['worldId', 'status']),

  publicationRecords: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    // ART-36 widened this from a single literal. See `PublicationContentKind`: derived share copy
    // rides the SAME lifecycle so that FR-G005 AC#3 inherits FR-K004's admin-only `publish`.
    contentKind: v.union(v.literal('episode'), v.literal('episode_share')),
    contentRef: v.string(),
    publicationId: v.string(),
    status: v.union(
      v.literal('generated'),
      v.literal('validated'),
      v.literal('safety_review'),
      v.literal('ready'),
      v.literal('published'),
      v.literal('withheld'),
      v.literal('superseded'),
    ),
    version: v.number(),
    summary: v.optional(v.string()),
    audit: v.array(v.any()),
    // True for the live (non-superseded) record of a contentRef. Exactly one
    // current record per (worldId, contentRef) is maintained by the wiring.
    isCurrent: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_world_and_content', ['worldId', 'contentRef'])
    .index('by_current', ['worldId', 'contentRef', 'isCurrent'])
    .index('by_world_and_status', ['worldId', 'status']),
};
