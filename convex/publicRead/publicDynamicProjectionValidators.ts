/**
 * Convex validators for the Public Dynamic Projection (FR-N003 / ART-115).
 *
 * Kept out of `publicDynamicProjection.ts` so that module stays free of `convex/values` and
 * therefore importable from a plain-Node test without pulling in the Convex runtime.
 *
 * These mirror {@link assertPublicDynamicProjection} rather than replacing it. The
 * hand-written assertions are the enforcement point — they run on the write path and again
 * on the read path, and they catch things a structural validator cannot express (an
 * `arriveAt` before its `startedAt`, a repeated `characterId`). These validators exist so
 * the same contract can be declared to Convex where a function signature needs it, and a
 * test pins the two against each other so they cannot drift apart.
 */

import { v } from 'convex/values';

export const publicPointValidator = v.object({
  x: v.number(),
  y: v.number(),
});

export const publicMotionTypeValidator = v.union(
  v.literal('canon'), v.literal('ambient'), v.literal('idle'), v.literal('replay'),
);

export const publicAnimationStateValidator = v.union(
  v.literal('idle'), v.literal('walking'), v.literal('speaking'),
  v.literal('thinking'), v.literal('activity'),
);

export const publicDirectionValidator = v.union(
  v.literal('up'), v.literal('down'), v.literal('left'), v.literal('right'),
);

export const publicWorldStatusValidator = v.union(
  v.literal('running'), v.literal('paused'), v.literal('unknown'),
);

export const publicCharacterMotionValidator = v.object({
  characterId: v.string(),
  semanticLocationId: v.string(),
  motionType: publicMotionTypeValidator,
  motionSequence: v.number(),
  from: publicPointValidator,
  to: publicPointValidator,
  startedAt: v.number(),
  arriveAt: v.number(),
  animationState: publicAnimationStateValidator,
  direction: publicDirectionValidator,
  sourceEventIds: v.optional(v.array(v.string())),
});

export const publicActiveSceneValidator = v.object({
  title: v.string(),
  summary: v.string(),
  sourceEventIds: v.array(v.string()),
});

export const publicDynamicProjectionValidator = v.object({
  worldId: v.string(),
  mapId: v.string(),
  runtimeVersion: v.number(),
  snapshotSequence: v.number(),
  updatedAt: v.number(),
  worldStatus: publicWorldStatusValidator,
  characters: v.array(publicCharacterMotionValidator),
  activeScenes: v.array(publicActiveSceneValidator),
});
