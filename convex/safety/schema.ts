import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const safetyTables = {
  postGenerationSafetyClassifications: defineTable({
    policyVersion: v.literal(1),
    worldId: v.string(),
    classificationId: v.string(),
    sourceId: v.string(),
    kind: v.union(v.literal('scene'), v.literal('public_artifact')),
    label: v.union(v.literal('allow'), v.literal('allow_with_warning'), v.literal('withhold'), v.literal('human_review_required')),
    reasonCodes: v.array(v.string()),
    warningCodes: v.array(v.string()),
    classifiedTextHash: v.string(),
    createdAt: v.number(),
  })
    .index('by_world_and_classification', ['worldId', 'classificationId'])
    .index('by_world_and_label', ['worldId', 'label'])
    // FR-P004 / ART-132. The public projection knows a Scene id, never a classification id:
    // `sourceId` IS the Scene id, so the dynamic surface asks by source and this index is the
    // only way to answer it as a point read rather than a scan of the world's classifications.
    .index('by_world_and_source', ['worldId', 'sourceId']),

  /**
   * Operator revisions of a post-generation safety label (FR-P004 / ART-132).
   *
   * APPEND-ONLY, and a SEPARATE table on purpose. `postGenerationSafetyClassifications` is
   * written exactly once per classification and is protected by a conflict check that refuses
   * a reused id carrying different content; making it mutable so an operator could flip a
   * label would dissolve that invariant and destroy the record of what the classifier actually
   * decided. Instead the original row is never touched, every revision is a new row here, and
   * the effective label is derived (latest `createdAt` wins) — so the classifier's verdict,
   * every operator revision, and who made it all remain readable after the fact.
   *
   * KEYED ON `sourceId`, NOT `classificationId`. An operator overriding a label is deciding
   * about a SCENE ("do not show what happened in the mill at noon"), and `sourceId` is the
   * stable identity of that scene, whereas `classificationId` identifies one classification
   * RUN over it. Keying on the run would silently orphan the decision the moment a slot retry
   * re-classified the same scene under a new run id — the content would come back, and nothing
   * would say so. `classificationId` is still recorded, because which run the operator was
   * looking at is part of the account of why they decided what they did.
   */
  safetyStatusOverrides: defineTable({
    worldId: v.string(),
    /** The Scene this governs — `postGenerationSafetyClassifications.sourceId`. */
    sourceId: v.string(),
    /** The classification run the operator was reading when they decided. Recorded, not keyed. */
    classificationId: v.string(),
    label: v.union(v.literal('allow'), v.literal('allow_with_warning'), v.literal('withhold'), v.literal('human_review_required')),
    reason: v.string(),
    /** The verified operator identity, as `operatorAuditLog.operatorId` records it. */
    actor: v.string(),
    createdAt: v.number(),
  })
    // `createdAt` is in the key so "the newest override for this Scene" is a `take(1)` rather
    // than a collect-and-sort, and the `worldId` prefix still answers "every override in this
    // world" for the rebuild's single bounded sweep.
    .index('by_world_source_and_created', ['worldId', 'sourceId', 'createdAt']),
};
