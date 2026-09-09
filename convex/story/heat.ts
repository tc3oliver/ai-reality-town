/**
 * FR-F006 Arc Heat Score — traceable, inspectable, deterministic (ART-32).
 *
 * ## What was here before
 *
 * `heatScore` is not a new field. It has been on `StoryArcProjectionData` since ART-65, it is
 * validated to 0–100, and `portfolio.ts` already orders by it — so it has been deciding what a
 * viewer sees on the homepage for a long time. What it was NOT is a heat score. Both places that
 * produced it wrote the same line:
 *
 *     heatScore: Math.round(membership.importance * 100)
 *
 * That is ONE of the six signals FR-F006 lists (最近事件重要性), read off the single event being
 * processed. It has three consequences worth naming rather than leaving to be rediscovered:
 *
 *  - **Nothing decays.** 新鮮度 is not merely unweighted, it is unrepresentable: the value depends
 *    only on the latest event, so an arc that has not moved for ten world days keeps whatever
 *    number its last event happened to carry until another event arrives.
 *  - **A quiet climax loses to a loud aside.** 是否接近高潮 has no influence at all, so a
 *    `climax` arc advanced by a low-importance scene sorts below an `emerging` one advanced by a
 *    high-importance one.
 *  - **It is not traceable (AC#1) and has no composition to view (AC#3),** because a single
 *    multiplication has neither.
 *
 * ## The shape, and why it is this shape
 *
 * Six weighted components, each carrying its own value, its own evidence, and whether it was
 * measured at all. The composite renormalises by MEASURED weight — the FR-M002 pattern from
 * `convex/quality/evaluator.ts` — so a signal the deployment cannot currently observe does not
 * silently depress every arc by the same amount. That distinction matters here more than it looks:
 * "every arc scores 0.6 because nobody is watching" and "every arc scores 0.6 because we cannot
 * see who is watching" order arcs identically but mean opposite things, and only one of them is
 * something an operator should act on.
 *
 * Every component is a pure function of values the caller passes in. No clock, no randomness, no
 * database: the same input produces the same score on every machine and on every replay, which is
 * what makes AC#1's 「可追蹤」 checkable rather than merely claimed.
 *
 * ## Evidence carries ids and counts, never content
 *
 * A component's `evidence` is the same discipline `EvidenceRef` follows in `convex/quality`: event
 * ids, character ids, counts, world days. Never a summary, never a question, never a scene. The
 * breakdown is persisted and read by an operator surface, and the surest way for it not to leak
 * unpublished narrative is for it never to hold any.
 */

import { opaqueDigest } from '../shared/opaqueDigest';
import type { StoryArcStatus } from './model';

export const ARC_HEAT_DEFINITION_VERSION = 1;

/** The six signals FR-F006 requires, in the order the requirement lists them. */
export const ARC_HEAT_COMPONENTS = [
  'recent_importance',
  'unresolved_tension',
  'core_attention',
  'viewer_interaction',
  'freshness',
  'climax_proximity',
] as const;
export type ArcHeatComponentKey = (typeof ARC_HEAT_COMPONENTS)[number];

/**
 * Weights, summing to 1.
 *
 * Deliberately flat-ish rather than tuned. There is no traffic to tune against yet — §16.1's
 * figures need a live deployment — so a weighting presented as optimised would be a guess wearing
 * a number. The two departures from equal are the two the requirement's own wording justifies:
 * 最近事件重要性 leads the list and is the signal the previous implementation used alone, and
 * 是否接近高潮 is the one signal that is about the arc's POSITION rather than its recent activity,
 * which is what stops a climax from being buried by a quiet slot.
 */
export const ARC_HEAT_WEIGHTS: Readonly<Record<ArcHeatComponentKey, number>> = {
  recent_importance: 0.25,
  unresolved_tension: 0.15,
  core_attention: 0.15,
  viewer_interaction: 0.15,
  freshness: 0.15,
  climax_proximity: 0.15,
};

/**
 * How close each lifecycle status is to the arc's peak, from 0 to 1.
 *
 * `resolved` and `archived` are 0 rather than 1: the question 「是否接近高潮」 asks how much is
 * still coming, and an arc whose climax has passed has none of it left. An arc that scored highest
 * at the moment it ended would hold the homepage against arcs that are still moving.
 */
export const ARC_CLIMAX_PROXIMITY: Readonly<Record<StoryArcStatus, number>> = {
  emerging: 0.2,
  active: 0.4,
  escalating: 0.7,
  climax: 1,
  resolving: 0.5,
  resolved: 0,
  archived: 0,
};

/**
 * World days after which an untouched arc has fully cooled.
 *
 * Seven, which is a world week: long enough that a slow arc is not written off after one quiet
 * day, short enough that an abandoned one leaves the homepage within a week of world time.
 */
export const ARC_FRESHNESS_WINDOW_DAYS = 7;

/**
 * Core-character appearances counted for 核心人物關注度, before the ratio saturates.
 *
 * An arc with six core characters and one with two are not comparable by raw count, so attention
 * is measured as the SHARE of the arc's own core cast that the recent window touched.
 */
export const ARC_ATTENTION_MIN_CORE = 1;

/** Viewer interactions treated as "fully engaged", so the component saturates rather than growing without bound. */
export const ARC_INTERACTION_SATURATION = 20;

/** Unresolved questions treated as maximum tension. */
export const ARC_TENSION_SATURATION = 3;

/**
 * What a component measured, and what it measured it from.
 *
 * `value` is `null` exactly when `status` is `no_observations`. Never `0` in that case — that is
 * the same rule `MetricObservation` states for rates, for the same reason.
 */
export type ArcHeatComponentResult = {
  key: ArcHeatComponentKey;
  weight: number;
  value: number | null;
  status: 'measured' | 'no_observations';
  /** Ids and counts only. Never narrative text. */
  evidence: Readonly<Record<string, number | string | readonly string[]>>;
  /** Why it could not be measured. Non-null exactly when `status` is `no_observations`. */
  unmeasuredReason: string | null;
};

export type ArcHeatScore = {
  definitionVersion: typeof ARC_HEAT_DEFINITION_VERSION;
  worldId: string;
  arcId: string;
  /** 0–100, matching the range `parseArcProjectionFields` already validates. */
  score: number;
  components: ArcHeatComponentResult[];
  /** The weight actually measured. The composite is renormalised by this, and it is published. */
  measuredWeight: number;
  /** FNV-1a over the canonical breakdown: two runs agreeing is checkable without a diff. */
  digest: string;
};

export type ArcHeatInput = {
  worldId: string;
  arcId: string;
  status: StoryArcStatus;
  /** The world day the score is being computed AS OF — the event that triggered it. */
  currentWorldDay: number;
  /** The world day the arc last made progress. Drives 新鮮度. */
  lastProgressWorldDay: number;
  /** Importance of the event being folded, 0–1, as the classifier scored it. */
  eventImportance: number;
  /** The event that triggered this computation, for the trail. */
  sourceEventId: string;
  /** The arc's declared core cast. */
  coreCharacterIds: readonly string[];
  /** Participants of the event being folded. Their overlap with the core cast is 核心人物關注度. */
  eventParticipantIds: readonly string[];
  unresolvedQuestionCount: number;
  /**
   * Viewer interactions with this arc, or `null` when the deployment cannot observe them.
   *
   * `null` is not zero. A world with no analytics rollup and a world nobody is watching are
   * different states, and the composite renormalises rather than scoring the first as the second.
   */
  viewerInteractionCount: number | null;
};

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

/** Values are reported to four decimals, matching `roundRate`; a component value is a report. */
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

function componentResults(input: ArcHeatInput): ArcHeatComponentResult[] {
  const coreCast = [...new Set(input.coreCharacterIds)];
  const participants = new Set(input.eventParticipantIds);
  const attending = coreCast.filter((characterId) => participants.has(characterId));
  const daysSinceProgress = Math.max(0, input.currentWorldDay - input.lastProgressWorldDay);

  const measured = (
    key: ArcHeatComponentKey,
    value: number,
    evidence: ArcHeatComponentResult['evidence'],
  ): ArcHeatComponentResult => ({
    key, weight: ARC_HEAT_WEIGHTS[key], value: round4(clamp01(value)),
    status: 'measured', evidence, unmeasuredReason: null,
  });

  return [
    measured('recent_importance', input.eventImportance, {
      eventImportance: round4(clamp01(input.eventImportance)),
      sourceEventId: input.sourceEventId,
    }),
    measured('unresolved_tension', input.unresolvedQuestionCount / ARC_TENSION_SATURATION, {
      unresolvedQuestions: input.unresolvedQuestionCount,
      saturation: ARC_TENSION_SATURATION,
    }),
    coreCast.length >= ARC_ATTENTION_MIN_CORE
      ? measured('core_attention', attending.length / coreCast.length, {
        attendingCoreCharacterIds: attending,
        coreCharacterCount: coreCast.length,
      })
      : {
        key: 'core_attention', weight: ARC_HEAT_WEIGHTS.core_attention, value: null,
        status: 'no_observations', evidence: { coreCharacterCount: 0 },
        // A share of an empty cast has no value. Scoring it 0 would rank an arc with no declared
        // core characters below one whose core cast simply was not in this scene.
        unmeasuredReason: 'the arc declares no core characters, so attention has no denominator',
      },
    input.viewerInteractionCount === null
      ? {
        key: 'viewer_interaction', weight: ARC_HEAT_WEIGHTS.viewer_interaction, value: null,
        status: 'no_observations', evidence: {},
        unmeasuredReason: 'no viewer-interaction rollup was supplied for this arc',
      }
      : measured('viewer_interaction', input.viewerInteractionCount / ARC_INTERACTION_SATURATION, {
        interactions: input.viewerInteractionCount,
        saturation: ARC_INTERACTION_SATURATION,
      }),
    measured('freshness', 1 - daysSinceProgress / ARC_FRESHNESS_WINDOW_DAYS, {
      daysSinceProgress,
      windowDays: ARC_FRESHNESS_WINDOW_DAYS,
    }),
    measured('climax_proximity', ARC_CLIMAX_PROXIMITY[input.status], {
      status: input.status,
    }),
  ];
}

/**
 * The arc's heat, and every number that produced it.
 *
 * Renormalised by measured weight: a component that could not be observed is left OUT of both the
 * numerator and the denominator rather than counted as zero. With every component measured the
 * denominator is 1 and this is an ordinary weighted mean; with one missing it is the weighted mean
 * of the rest, which is the only reading that does not assert something the deployment did not see.
 */
export function computeArcHeat(input: ArcHeatInput): ArcHeatScore {
  const components = componentResults(input);
  const measuredWeight = components
    .filter((component) => component.value !== null)
    .reduce((total, component) => total + component.weight, 0);
  const weighted = components
    .reduce((total, component) => total + (component.value ?? 0) * component.weight, 0);

  // Every component unmeasurable is possible only if the weights are all zero, which the constant
  // above forbids; the guard is here so the function is total rather than because it can fire.
  //
  // The result needs no clamp of its own. Every component value is already clamped to [0, 1] by
  // `measured`, and the weights are positive, so a weighted mean of them divided by the weight
  // that produced it is in [0, 1] by construction. An outer clamp would be a guard that cannot
  // fire — and this repository has shipped assertions that cannot fail before, so the invariant is
  // stated here instead of re-checked. `heat.test.ts` drives NaN, negative and out-of-range inputs
  // through the whole function and asserts the range, which is where the guarantee is held.
  const normalized = measuredWeight === 0 ? 0 : weighted / measuredWeight;
  const score = Math.round(normalized * 100);

  const canonical = JSON.stringify({
    definitionVersion: ARC_HEAT_DEFINITION_VERSION,
    worldId: input.worldId,
    arcId: input.arcId,
    score,
    components: components.map(({ key, weight, value, status }) => ({ key, weight, value, status })),
  });

  return {
    definitionVersion: ARC_HEAT_DEFINITION_VERSION,
    worldId: input.worldId,
    arcId: input.arcId,
    score,
    components,
    measuredWeight: round4(measuredWeight),
    digest: opaqueDigest(canonical),
  };
}

/**
 * Order arcs by heat, breaking every tie deterministically.
 *
 * Exported so the homepage's ordering has ONE definition (FR-F006 AC#2: the ordering must not be
 * left to the model). A comparator written out at each call site is how two surfaces come to
 * disagree about which arc is hottest, and an arc's position is the thing a viewer reads first.
 */
export function compareArcsByHeat(
  left: { arcId: string; heatScore: number },
  right: { arcId: string; heatScore: number },
): number {
  // Ties break on the arc id, so a re-run of the same world produces the same order rather than
  // whichever arc the underlying query happened to return first.
  return right.heatScore - left.heatScore || left.arcId.localeCompare(right.arcId);
}
