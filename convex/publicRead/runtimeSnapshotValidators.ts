/**
 * Convex validators for the Public Runtime Snapshot (FR-N007 / ART-116).
 *
 * Kept out of `runtimeSnapshot.ts` so that module stays free of `convex/values` and
 * therefore importable from a plain-Node test without pulling in the Convex runtime — the
 * same split ART-115 uses for the dynamic projection.
 *
 * These mirror {@link assertPublicRuntimeSnapshot} rather than replacing it. The
 * hand-written assertions remain the enforcement point (they run on write and again on
 * read, and they catch things a structural validator cannot express, such as a repeated
 * `characterId`); these exist so the contract can be declared to Convex where a function
 * signature needs it, and a test pins the two together so they cannot drift.
 */

import { v } from 'convex/values';

import {
  publicActiveSceneValidator,
  publicCharacterMotionValidator,
} from './publicDynamicProjectionValidators';

/** Only the two states the world itself can be in are ever persisted. */
export const publicRuntimeSnapshotStatusValidator = v.union(
  v.literal('live'), v.literal('paused'),
);

/** The read-time verdict. Never stored — see `runtimeSnapshot.ts`. */
export const publicRuntimeFreshnessValidator = v.union(
  v.literal('live'), v.literal('delayed'), v.literal('paused'), v.literal('stale'),
);

export const publicRuntimeSnapshotThresholdsValidator = v.object({
  liveMaxAgeMs: v.number(),
  delayedMaxAgeMs: v.number(),
  observationMaxAgeMs: v.number(),
});

export const publicRuntimeSnapshotEnvelopeValidator = v.object({
  worldId: v.string(),
  runtimeVersion: v.number(),
  snapshotSequence: v.number(),
  sourceRuntimeSequence: v.number(),
  status: publicRuntimeSnapshotStatusValidator,
  freshness: publicRuntimeFreshnessValidator,
  mapId: v.string(),
  characterStates: v.array(publicCharacterMotionValidator),
  activeSceneStates: v.array(publicActiveSceneValidator),
  contentUpdatedAt: v.number(),
  createdAt: v.number(),
  observedAt: v.number(),
  contentAgeMs: v.number(),
  observationAgeMs: v.number(),
  thresholds: publicRuntimeSnapshotThresholdsValidator,
});
