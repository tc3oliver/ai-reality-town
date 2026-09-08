import { defineTable } from 'convex/server';
import { v } from 'convex/values';

const recapType = v.union(v.literal('scene'), v.literal('episode'), v.literal('arc'), v.literal('season'), v.literal('viewer_context'));

export const recapTables = {
  recapSnapshots: defineTable({
    snapshotId: v.string(), schemaVersion: v.literal(1), worldId: v.string(), recapType, targetId: v.string(),
    sourceFromEventId: v.string(), sourceToEventId: v.string(), sourceFromSequenceNumber: v.number(),
    sourceToSequenceNumber: v.number(), content: v.string(), structuredPayload: v.any(), version: v.number(),
    /**
     * ART-164. Present only on a SELECTIVE tier (`arc`), where the events summarised are a subset
     * of the range examined. Optional rather than defaulted so rows written before this task stay
     * readable and keep meaning exactly what they meant: contiguous, event window == source range.
     */
    sourceScope: v.optional(v.object({ fromSequenceNumber: v.number(), toSequenceNumber: v.number() })),
    generatedAt: v.number(),
  })
    .index('by_snapshot_id', ['snapshotId'])
    .index('by_target_and_version', ['worldId', 'recapType', 'targetId', 'version'])
    .index('by_target_and_time', ['worldId', 'recapType', 'targetId', 'generatedAt']),

  /**
   * The four FR-G003 recap formats for one daily Episode (ART-164).
   *
   * Its own table rather than a column on `dailyEpisodes`, for the reason `episodeShareFormats`
   * is separate too: the two carry different decisions. An Episode can be `ready` while its
   * recaps failed to compose — a world day with too little public content to reach 80 中文字 is a
   * real state — and the Episode must not be re-derived or re-graded because a recap could not be
   * written.
   *
   * `formats` is `v.any()` and validated by `validateRecapFormats` on the way in and on the way
   * out, matching `dailyEpisodes.episode`. `failed` rows deliberately leave it UNSET: a recap the
   * length contract refused is not stored where a later reader could mistake its existence for
   * permission to publish it.
   *
   * `formatterVersion` is stored rather than inferred so a future composition change never leaves
   * an older row unidentifiable, and `composition` records what was dropped — truncation is never
   * silent here any more than anywhere else.
   */
  episodeRecapFormats: defineTable({
    schemaVersion: v.literal(1),
    formatterVersion: v.number(),
    worldId: v.string(),
    worldDay: v.number(),
    episodeNumber: v.number(),
    status: v.union(v.literal('ready'), v.literal('failed')),
    formats: v.optional(v.any()),
    composition: v.optional(v.any()),
    /** Accepted events the composed text actually accounts for. */
    sourceEventIds: v.array(v.string()),
    errorCode: v.optional(v.string()),
    errorDetails: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index('by_world_and_day', ['worldId', 'worldDay'])
    .index('by_world_and_episode', ['worldId', 'episodeNumber'])
    .index('by_world_and_status', ['worldId', 'status']),

  /**
   * The FR-G004 coverage and spoiler verdict for one release candidate (ART-164).
   *
   * Persisted on BOTH outcomes, not just refusals. A gate that only recorded its failures would
   * make "this episode was checked and passed" indistinguishable from "the gate never ran on this
   * episode" — which is exactly the state ART-164 found the whole gate in.
   *
   * `findings` is the structured verdict, so a reviewer sees which high-importance event was
   * omitted or which secret leaked rather than a boolean. Refusal evidence has to outlive the
   * decision, or an operator asked why a day never published has nothing to read.
   */
  episodeCoverageReports: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    worldDay: v.number(),
    contentRef: v.string(),
    releasable: v.boolean(),
    findingCodes: v.array(v.string()),
    report: v.any(),
    /** Set when the gate itself could not run, as opposed to running and refusing. */
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_world_and_day', ['worldId', 'worldDay'])
    .index('by_world_and_ref', ['worldId', 'contentRef'])
    .index('by_world_and_releasable', ['worldId', 'releasable']),

  /**
   * FR-G004 / §16.2 — an operator's explicit, reviewable reason for leaving a high-importance
   * Accepted Event out of the public record (ART-89).
   *
   * §16.2 reads 「至少 95% 的高重要度 Accepted Event 由已發布 recap 覆蓋，或帶有明確、可審查的排除理由」.
   * The second half had a TYPE (`CoverageExclusion`) and a check
   * (`COVERAGE_EXCLUSION_UNJUSTIFIED`) since ART-35, and no storage and no writer — every caller
   * passed `declaredExclusions: []`, so the check was unreachable and the clause was satisfied by
   * nothing. This is that storage.
   *
   * Append-only and one row per `(worldId, eventId)`: an exclusion is a decision about a
   * particular event, and re-declaring it must not create a second reason for the same omission.
   * It never touches Canon — the event stays accepted and stays in the denominator; the row only
   * records that a named operator said, in words, why it is not in a recap.
   */
  coverageExclusions: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    /** The world day the excluded event belongs to, so a window read is index-scoped. */
    worldDay: v.number(),
    eventId: v.string(),
    /** Non-empty by construction: an exclusion without a reason is what the gate refuses. */
    reason: v.string(),
    operatorId: v.string(),
    createdAt: v.number(),
  })
    .index('by_world_and_day', ['worldId', 'worldDay'])
    .index('by_world_and_event', ['worldId', 'eventId']),
};
