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

export type ArcProgressTime = {
  worldDay: number;
  timeSlot: 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';
  sourceEventId: string;
};

/** Complete FR-F003 Story read model. Null means the milestone is not established yet. */
export type StoryArcProjectionData = {
  schemaVersion: 1;
  worldId: string;
  arcId: string;
  title: string;
  premise: string;
  currentQuestion: string;
  status: StoryArcStatus;
  coreCharacterIds: string[];
  incitingEventId: string;
  latestTurningPointEventId: string | null;
  essentialFactIds: string[];
  unresolvedQuestions: string[];
  resolvedQuestions: string[];
  recommendedEntryEventId: string | null;
  heatScore: number;
  lastProgressTime: ArcProgressTime;
  revision: number;
};

export type ArcProjectionFields = Omit<
  StoryArcProjectionData,
  'schemaVersion' | 'worldId' | 'arcId' | 'status' | 'lastProgressTime' | 'revision'
>;

export type ArcProjectionEvent = {
  schemaVersion: 1;
  worldId: string;
  arcId: string;
  revision: number;
  kind: 'initialized' | 'updated';
  fields: ArcProjectionFields;
  sourceEventId: string;
  sourceEventSequenceNumber: number;
  worldDay: number;
  timeSlot: ArcProgressTime['timeSlot'];
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

export const ARC_EVENT_ROLES = [
  'inciting_incident', 'development', 'escalation', 'turning_point',
  'climax', 'resolution', 'aftermath',
] as const;
export type ArcEventRole = (typeof ARC_EVENT_ROLES)[number];

export type ArcEventMembership = {
  arcId: string;
  primary: boolean;
  importance: number;
  role: ArcEventRole;
  coreCharacterIdsAdded: string[];
  coreCharacterIdsRemoved: string[];
};

export type NewArcProposal = {
  arcId: string;
  title: string;
  premise: string;
  currentQuestion: string;
  coreCharacterIds: string[];
};

/** Story-only classification of one immutable Accepted Event. */
export type ArcEventClassification = {
  schemaVersion: 1;
  worldId: string;
  sourceEventId: string;
  sourceEventSequenceNumber: number;
  memberships: ArcEventMembership[];
  newArc: NewArcProposal | null;
};
