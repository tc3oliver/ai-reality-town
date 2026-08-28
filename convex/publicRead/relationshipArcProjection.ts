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

import { RELATIONSHIP_MAX, RELATIONSHIP_MIN } from '../shared/constants';

export const RELATIONSHIP_ARC_SCHEMA_VERSION = 1;
export const RELATIONSHIP_MODEL_KIND = 'relationship' as const;
export const ARC_MODEL_KIND = 'arc' as const;

export type PublicFact = {
  factId: string;
  predicate: string;
  value: string | number | boolean;
  sourceEventId: string;
};

/**
 * The six dimensions Canon tracks per relationship, in the order every consumer iterates them.
 *
 * Exported rather than repeated, because ART-95's defect was in part a consequence of six
 * near-identical lines written out by hand: five of them were wrong in the same way and the sixth
 * had to be read carefully to confirm it was wrong too.
 */
export const RELATIONSHIP_DIMENSIONS = [
  'trust', 'affection', 'resentment', 'fear', 'dependency', 'familiarity',
] as const;
export type RelationshipDimension = (typeof RELATIONSHIP_DIMENSIONS)[number];

/** Accumulated public levels for one pair. Levels, not deltas — see {@link accumulatePublicRelationshipDimensions}. */
export type RelationshipDimensions = Record<RelationshipDimension, number>;

/** One public `relationship_changed` state change, as this module needs it. */
export type RelationshipDeltaInput = {
  trustDelta: number;
  affectionDelta: number;
  resentmentDelta: number;
  /** Additive v1 fields; legacy events that omit them accumulate as zero, as the reducer does. */
  fearDelta?: number;
  dependencyDelta?: number;
  familiarityDelta?: number;
};

/**
 * One published change, as `RelationshipProjection.changeHistory` has always carried it.
 *
 * DELIBERATELY UNCHANGED by ART-95's repair, which is a behaviour fix and carries no payload
 * shape change. Widening this to six deltas and a `worldDay` was drafted while ART-44's graph was
 * planned to read it, and reverted once the graph moved to Canon: a shape change here alters
 * every relationship row's `contentHash`, so every pair in every world publishes a new version on
 * its next rebuild. Paying that for a field nothing reads is churn, and mixing it into this fix
 * would make the two changes reviewable only together.
 *
 * The three additive v1 dimensions (fear, dependency, familiarity) therefore still have no
 * published per-change provenance, only an accumulated level. That predates this task; ART-43 is
 * the next consumer and the right place to decide whether the public surface needs them.
 */
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

/**
 * Coerce an unreadable value to zero, then clamp to Canon's declared relationship range (ART-95).
 *
 * This used to be `BOUNDED`, which did only the first half: it was a finite-number coercion named
 * as if it clamped, sitting under a docblock that told a reader「Dimensions are bounded」. Of the
 * two available repairs — rename the function to match the code, or make the code match the name
 * and the documentation — this takes the second, because the bound is not decorative. Canon's own
 * deterministic reducer clamps to exactly `[RELATIONSHIP_MIN, RELATIONSHIP_MAX]`
 * (`convex/canon/reducer.ts`), so a published level outside that range could not correspond to
 * any state the world is actually in. Renaming would have made the surface honest about being
 * unbounded while leaving it free to publish a number Canon cannot hold.
 *
 * The two steps are ordered, and the order is the point. A non-finite input becomes 0, NOT
 * `RELATIONSHIP_MAX`: `Infinity` is not "maximum trust", it is a value nobody can read, and
 * clamping it to 100 would publish the strongest possible claim about a relationship on the
 * strength of a garbage number. Only after that does the finite value get clamped.
 */
function clampPublicRelationshipDimension(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value < RELATIONSHIP_MIN) return RELATIONSHIP_MIN;
  if (value > RELATIONSHIP_MAX) return RELATIONSHIP_MAX;
  return value;
}

/**
 * Accumulate public relationship deltas into the CURRENT levels of the pair (ART-95).
 *
 * ## The defect this replaces
 *
 * `rebuildRelationshipProjection` used to overwrite a `latest` record on every matching event and
 * assign `trust: change.trustDelta` — and the same for the other five dimensions — so the
 * published `RelationshipProjection.trust` was the LAST EVENT'S DELTA rather than the accumulated
 * level. A pair that moved +5, +5, +5 published `trust: 5`; a pair that moved +50 and then -1
 * published `trust: -1`, i.e. a close ally rendered as an enemy on the strength of one small
 * setback. The types already named the distinction — `RelationshipChange.trustDelta` against
 * `RelationshipProjection.trust` — which is what made the defect invisible at the call site.
 *
 * ## Why this mirrors the reducer rather than reading it
 *
 * Fold-then-clamp per step, with `familiarity` floored at zero, is exactly what
 * `convex/canon/reducer.ts` does for `relationship_changed`. It is re-implemented here rather
 * than imported because the two answer DIFFERENT questions and must not be collapsed into one:
 * the reducer folds EVERY change, public and private, into canonical world state; this folds only
 * the PUBLIC ones. Feeding private deltas in here would leak the size and direction of hidden
 * feelings through a public number, which is the leak `buildRelationshipProjection`'s
 * private-visibility rejection exists to prevent — a caller would have defeated it by arithmetic
 * rather than by publishing a field.
 *
 * So the published level is "where this relationship stands as far as the public record shows",
 * which is a smaller number than Canon's and is the only one this surface is entitled to.
 * Clamping per step rather than once at the end is what keeps the two consistent: a pair that
 * runs to +100 and then falls by 10 reads 90 in both, where clamping only the final sum would
 * read 90 in one and something else in the other.
 */
export function accumulatePublicRelationshipDimensions(
  changes: readonly RelationshipDeltaInput[],
): RelationshipDimensions {
  const levels: RelationshipDimensions = {
    trust: 0, affection: 0, resentment: 0, fear: 0, dependency: 0, familiarity: 0,
  };
  for (const change of changes) {
    levels.trust = clampPublicRelationshipDimension(levels.trust + toDelta(change.trustDelta));
    levels.affection = clampPublicRelationshipDimension(levels.affection + toDelta(change.affectionDelta));
    levels.resentment = clampPublicRelationshipDimension(levels.resentment + toDelta(change.resentmentDelta));
    levels.fear = clampPublicRelationshipDimension(levels.fear + toDelta(change.fearDelta));
    levels.dependency = clampPublicRelationshipDimension(levels.dependency + toDelta(change.dependencyDelta));
    // Floored at zero, as the reducer floors it: familiarity is a count of shared history and
    // cannot run negative — two people cannot know each other less than not at all.
    levels.familiarity = Math.max(
      0,
      clampPublicRelationshipDimension(levels.familiarity + toDelta(change.familiarityDelta)),
    );
  }
  return levels;
}

/** An absent or unreadable delta contributes nothing, matching the reducer's `?? 0`. */
function toDelta(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

/**
 * Build the publication-safe Relationship projection (AC#1). Only public-
 * visibility relationships are projected; private ones are rejected outright so
 * hidden feelings never leak. Dimensions are ACCUMULATED LEVELS clamped to
 * Canon's `[RELATIONSHIP_MIN, RELATIONSHIP_MAX]` range — see
 * {@link accumulatePublicRelationshipDimensions} and
 * {@link clampPublicRelationshipDimension}; change history carries reasons and
 * the world day each change landed on.
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
    trust: clampPublicRelationshipDimension(input.trust),
    affection: clampPublicRelationshipDimension(input.affection),
    resentment: clampPublicRelationshipDimension(input.resentment),
    fear: clampPublicRelationshipDimension(input.fear),
    dependency: clampPublicRelationshipDimension(input.dependency),
    familiarity: clampPublicRelationshipDimension(input.familiarity),
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
