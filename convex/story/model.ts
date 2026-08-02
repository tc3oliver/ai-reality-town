/**
 * Story projection boundary (Phase 0 placeholder).
 *
 * The story layer will derive narrative projections (arcs, tensions, beats) from the
 * append-only canon event log. It is a READ model over canon — it never writes canon
 * state directly. Phase 0 only declares the boundary; no story engine is implemented.
 */

import type { EventId } from '../shared/ids';

/**
 * A future story projection record. Kept as an explicit type so later phases can fill it
 * without re-drawing the boundary.
 */
export type StoryProjection = {
  worldId: string;
  lastSequenceNumber: number;
  arcs: StoryArc[];
};

export type StoryArc = {
  id: string;
  summary: string;
  participantIds: string[];
  sourceEventIds: EventId[];
  status: StoryArcStatus;
};

export const STORY_ARC_STATUSES = [
  'emerging', 'active', 'escalating', 'climax', 'resolving', 'resolved', 'archived',
] as const;
export type StoryArcStatus = (typeof STORY_ARC_STATUSES)[number];

export type ArcLifecycleTransition = {
  transitionId: string;
  fromStatus: StoryArcStatus | null;
  toStatus: StoryArcStatus;
  sourceEventId: string;
  sourceEventSequenceNumber: number;
  reason: string;
  changedAt: number;
};

export type ArcLifecycleRecord = {
  schemaVersion: 1;
  worldId: string;
  arcId: string;
  status: StoryArcStatus;
  revision: number;
  transitions: ArcLifecycleTransition[];
};
