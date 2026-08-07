/**
 * Convex validators for the Visual Replay (FR-O013 / ART-121).
 *
 * Kept out of `visualReplay.ts` so that module stays free of `convex/values` and therefore
 * importable from a plain-Node test without pulling in the Convex runtime — the same split
 * ART-115 and ART-116 use for their own contracts.
 *
 * These mirror {@link assertVisualReplay} rather than replacing it. The hand-written
 * assertions remain the enforcement point: they run on write and again on read, and they
 * catch what a structural validator cannot express — that a scene's `durationMs` equals the
 * sum of its steps, that no forbidden field appears at any depth, that the scene count is
 * within 1–3. A test pins the two together so they cannot drift.
 */

import { v } from 'convex/values';

export const replayPointValidator = v.object({
  x: v.number(),
  y: v.number(),
});

export const replayParticipantValidator = v.object({
  characterId: v.string(),
  startPosition: replayPointValidator,
  endPosition: replayPointValidator,
});

export const replayMoveStepValidator = v.object({
  type: v.literal('move'),
  characterId: v.string(),
  to: replayPointValidator,
  durationMs: v.number(),
});

export const replayWaitStepValidator = v.object({
  type: v.literal('wait'),
  durationMs: v.number(),
});

/** Declared so ART-123 widens this contract rather than redefining it; never produced today. */
export const replayDialogueStepValidator = v.object({
  type: v.literal('dialogue'),
  characterId: v.string(),
  refKind: v.literal('publicExcerpt'),
  publicExcerptId: v.string(),
  publicationVersion: v.number(),
  durationMs: v.number(),
});

export const replayEventCardStepValidator = v.object({
  type: v.literal('eventCard'),
  refKind: v.union(v.literal('episodeScene'), v.literal('canonEventSummary')),
  publicSummaryId: v.string(),
  publicationVersion: v.number(),
  durationMs: v.number(),
});

export const replayStepValidator = v.union(
  replayMoveStepValidator,
  replayWaitStepValidator,
  replayDialogueStepValidator,
  replayEventCardStepValidator,
);

export const replaySceneValidator = v.object({
  sceneId: v.string(),
  worldDay: v.number(),
  timeSlot: v.string(),
  locationId: v.string(),
  sourceEventIds: v.array(v.string()),
  participants: v.array(replayParticipantValidator),
  steps: v.array(replayStepValidator),
  durationMs: v.number(),
});

export const visualReplayValidator = v.object({
  schemaVersion: v.literal(1),
  replayId: v.string(),
  worldId: v.string(),
  worldDay: v.number(),
  timeSlot: v.string(),
  sourceEventIds: v.array(v.string()),
  scenes: v.array(replaySceneValidator),
  totalDurationMs: v.number(),
});

/**
 * One resolved text, joined to the address that asked for it.
 *
 * The `publicationVersion` travels back with the text so a client can see WHICH version it
 * was handed. An address whose current publication record no longer matches is simply absent
 * from the list — there is no "stale" variant of this shape, because there is no stale copy
 * to describe.
 */
export const replayResolvedTextValidator = v.object({
  publicSummaryId: v.string(),
  publicationVersion: v.number(),
  text: v.string(),
});

export const visualReplayResponseValidator = v.object({
  replay: visualReplayValidator,
  texts: v.array(replayResolvedTextValidator),
});
