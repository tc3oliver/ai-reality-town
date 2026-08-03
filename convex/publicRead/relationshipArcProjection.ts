/**
 * Publication-safe Relationship and Story Arc projections (PRD §13.3, FR-I006).
 *
 * Pure builders with explicit field projection. Relationship projection exposes
 * bounded public dimensions + change history/reasons and excludes hidden-secret
 * leakage (private-visibility relationships are never projected) (AC#1). Arc
 * projection exposes every published FR-I006 field, with outcome only when the
 * arc is resolved (AC#2). Both rebuild deterministically (AC#3). Pure module —
 * no Convex imports, no clock, no randomness, no Canon mutation.
 *
 * Published via the public read-model infrastructure (modelKind `relationship` /
 * `arc`); public reads reuse the generic failure-isolated getPublishedReadModel.
 */

export const RELATIONSHIP_ARC_SCHEMA_VERSION = 1;
export const RELATIONSHIP_MODEL_KIND = 'relationship' as const;
export const ARC_MODEL_KIND = 'arc' as const;

export type PublicFact = {
  factId: string;
  predicate: string;
  value: string | number | boolean;
  sourceEventId: string;
};

export type RelationshipChange = {
  eventId: string;
  reason: string;
  trustDelta: number;
  affectionDelta: number;
  resentmentDelta: number;
};

export type RelationshipProjection = {
  schemaVersion: typeof RELATIONSHIP_ARC_SCHEMA_VERSION;
  worldId: string;
  pairKey: string;
  sourceCharacterId: string;
  targetCharacterId: string;
  trust: number;
  affection: number;
  resentment: number;
  fear: number;
  dependency: number;
  familiarity: number;
  visibility: 'public';
  lastUpdatedEventId: string;
  changeHistory: RelationshipChange[];
};

export type ArcSummary = {
  arcId: string;
  title: string;
  premise: string;
  currentQuestion: string;
  status: string;
  coreCharacterIds: readonly string[];
  incitingEventId: string;
  latestTurningPointEventId: string | null;
  unresolvedQuestions: readonly string[];
};

export type ArcOutcome = {
  summary: string;
  sourceEventIds: string[];
};

export type ArcProjection = {
  schemaVersion: typeof RELATIONSHIP_ARC_SCHEMA_VERSION;
  worldId: string;
  arcId: string;
  title: string;
  premise: string;
  currentQuestion: string;
  status: string;
  coreCharacterIds: string[];
  essentialBackstory: PublicFact[];
  incitingEventId: string;
  latestTurningPointEventId: string | null;
  recommendedEntry: { episodeNumber: number; worldDay: number } | null;
  relatedEpisodes: Array<{ episodeNumber: number; worldDay: number }>;
  knownClues: PublicFact[];
  unresolvedQuestions: string[];
  outcome: ArcOutcome | null;
};

export class RelationshipArcError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'RelationshipArcError';
  }
}

const BOUNDED = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function pairKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

/**
 * Build the publication-safe Relationship projection (AC#1). Only public-
 * visibility relationships are projected; private ones are rejected outright so
 * hidden feelings never leak. Dimensions are bounded; change history carries
 * reasons.
 */
export function buildRelationshipProjection(input: {
  worldId: string;
  sourceCharacterId: string;
  targetCharacterId: string;
  trust: number;
  affection: number;
  resentment: number;
  fear: number;
  dependency: number;
  familiarity: number;
  visibility: string;
  lastUpdatedEventId: string;
  changeHistory: readonly RelationshipChange[];
}): RelationshipProjection {
  if (input.worldId.trim().length === 0) throw new RelationshipArcError('RELATIONSHIP_INVALID', 'worldId must be non-empty');
  if (input.sourceCharacterId.trim().length === 0 || input.targetCharacterId.trim().length === 0) {
    throw new RelationshipArcError('RELATIONSHIP_INVALID', 'source and target character ids are required');
  }
  if (input.visibility !== 'public') {
    throw new RelationshipArcError('RELATIONSHIP_PRIVATE', 'only public-visibility relationships may be projected');
  }
  return {
    schemaVersion: RELATIONSHIP_ARC_SCHEMA_VERSION,
    worldId: input.worldId,
    pairKey: pairKey(input.sourceCharacterId, input.targetCharacterId),
    sourceCharacterId: input.sourceCharacterId,
    targetCharacterId: input.targetCharacterId,
    trust: BOUNDED(input.trust),
    affection: BOUNDED(input.affection),
    resentment: BOUNDED(input.resentment),
    fear: BOUNDED(input.fear),
    dependency: BOUNDED(input.dependency),
    familiarity: BOUNDED(input.familiarity),
    visibility: 'public',
    lastUpdatedEventId: input.lastUpdatedEventId,
    changeHistory: input.changeHistory.map((change) => ({ ...change })),
  };
}

/**
 * Build the publication-safe Story Arc projection (AC#2). Exposes every FR-I006
 * field; `outcome` is attached only when supplied (resolved arcs). Resolved/
 * archived arcs are not filtered here — callers exclude them from active
 * context — but their published page still carries the outcome.
 */
export function buildArcProjection(input: {
  worldId: string;
  arc: ArcSummary;
  essentialBackstory: readonly PublicFact[];
  recommendedEntry: { episodeNumber: number; worldDay: number } | null;
  relatedEpisodes: ReadonlyArray<{ episodeNumber: number; worldDay: number }>;
  knownClues: readonly PublicFact[];
  outcome: ArcOutcome | null;
}): ArcProjection {
  if (input.worldId.trim().length === 0) throw new RelationshipArcError('ARC_INVALID', 'worldId must be non-empty');
  if (input.arc.arcId.trim().length === 0) throw new RelationshipArcError('ARC_INVALID', 'arcId must be non-empty');
  return {
    schemaVersion: RELATIONSHIP_ARC_SCHEMA_VERSION,
    worldId: input.worldId,
    arcId: input.arc.arcId,
    title: input.arc.title,
    premise: input.arc.premise,
    currentQuestion: input.arc.currentQuestion,
    status: input.arc.status,
    coreCharacterIds: [...new Set(input.arc.coreCharacterIds)],
    essentialBackstory: input.essentialBackstory.map((fact) => ({ ...fact })),
    incitingEventId: input.arc.incitingEventId,
    latestTurningPointEventId: input.arc.latestTurningPointEventId,
    recommendedEntry: input.recommendedEntry ? { ...input.recommendedEntry } : null,
    relatedEpisodes: [...input.relatedEpisodes].sort((a, b) => a.episodeNumber - b.episodeNumber).map((episode) => ({ ...episode })),
    knownClues: input.knownClues.map((fact) => ({ ...fact })),
    unresolvedQuestions: [...input.arc.unresolvedQuestions],
    outcome: input.outcome ? { summary: input.outcome.summary, sourceEventIds: [...input.outcome.sourceEventIds] } : null,
  };
}
