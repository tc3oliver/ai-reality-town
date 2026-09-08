/**
 * The FR-M004 degradation ladder (PRD §16.3). ART-91.
 *
 * Pure: no Convex, no clock, no randomness, no I/O. It is handed what the last authoring attempt
 * did and returns the world's next degradation state plus the transition that produced it.
 *
 * ## The ladder, in order, and what each rung actually changes
 *
 * | rung | `level` | what the world does at this level |
 * | --- | --- | --- |
 * | 1 | `normal` | full authoring; same-model retry is the per-call budget the provider already has |
 * | 2 | `compatible_model` | authoring uses the module's configured `fallbackModel` |
 * | 3 | `fewer_scenes` | the Director plans at most {@link REDUCED_SCENES_PER_SLOT} major scenes |
 * | 4 | `rules_only` | no provider call at all; the slot commits deterministic events |
 * | 5 | `deferred_summaries` | rules-only, and non-essential summaries are skipped and backfilled |
 * | 6 | `paused` | no new simulation is admitted until an operator resumes |
 *
 * `advanceDegradation` moves at most ONE rung per decision and never skips: rung 3 is only
 * reachable from rung 2, and so on. That is the whole of AC#1, and it is a property of this
 * function rather than of its callers — {@link nextLevel} is a total function on the ordered list,
 * so a caller cannot request a jump.
 *
 * ## What escalates, and what does not
 *
 * Only a PROVIDER-side failure escalates: the model refused, timed out, ran out of routes, ran out
 * of allowance, or was not configured. A refusal that says something about the REQUEST —
 * prohibited content, a malformed schema, a Canon rejection — must not, because no rung of this
 * ladder makes a rejected request acceptable, and escalating on one would degrade a world for
 * saying something the safety gate correctly refused. {@link isDegradationTrigger} is that split,
 * and it is deliberately conservative: an unrecognised code does not escalate.
 *
 * ## What the ladder must never do, and how that is guaranteed here
 *
 * FR-M004 forbids skipping Canon Validation, Safety Validation, Idempotency and Event Persistence.
 * This module cannot skip them because it does not run them: it returns a LEVEL, and every level's
 * events still travel the same `validate_structured_output` → `validate_canon` →
 * `commit_accepted_events` path in `worldDayLive.ts`. The rules-only rung produces PROPOSALS, not
 * accepted events — see `convex/simulation/rulesOnlyAuthor.ts`. A rung that bypassed a gate would
 * have to be written somewhere else entirely, which is the point of keeping the decision pure.
 *
 * It also must not fall back to the deterministic fake author. It cannot: `sceneAuthorFor` is a
 * closed two-value mode with no default, and this module never names it. Rung 4 is rules-only,
 * which is a different thing — deterministic PROPOSALS derived from world state, not narrated
 * scenes pretending a model wrote them.
 *
 * ## Recovery
 *
 * A successful authored slot at any degraded level recovers ONE rung, so a world that was pushed
 * down by a transient outage climbs back at the same speed it fell. `paused` is the exception:
 * nothing recovers automatically from it, because pausing is the rung that says the automatic
 * responses are exhausted, and an operator resuming is the signal that the cause was addressed.
 * {@link resumeFromPause} is that operator action, and it returns to `rules_only` rather than to
 * `normal` — a world that just failed six ways does not get its full budget back on one click.
 */

export const DEGRADATION_LEVELS = [
  'normal',
  'compatible_model',
  'fewer_scenes',
  'rules_only',
  'deferred_summaries',
  'paused',
] as const;
export type DegradationLevel = (typeof DEGRADATION_LEVELS)[number];

/** Major scenes per slot at rung 3. One, because 「減少主要場景」 with three still costs three calls. */
export const REDUCED_SCENES_PER_SLOT = 1;

/**
 * Consecutive provider failures at one level before the ladder moves down.
 *
 * Two, not one: a single failure is what the per-call retry budget already exists to absorb, and
 * degrading on it would move a world down a rung for one 500. Two consecutive failures at the same
 * level is the smallest signal that the level itself is not working.
 */
export const FAILURES_BEFORE_ESCALATION = 2;

/**
 * Provider-side failure codes that mean "this level is not working".
 *
 * Every one of them is a statement about the model, the route or the allowance. Codes that are
 * statements about the REQUEST are deliberately absent: see the module note.
 */
export const DEGRADATION_TRIGGER_CODES: ReadonlySet<string> = new Set([
  'LLM_HTTP_RETRYABLE',
  'LLM_TIMEOUT',
  'LLM_NETWORK_ERROR',
  'LLM_FREE_ROUTES_EXHAUSTED',
  'LLM_CONFIG_MISSING',
  'LLM_AUTH_REQUIRED',
  'LLM_CHAT_INCOMPATIBLE',
  'SCENE_SIMULATION_FAILED',
  'SCENE_AUTHORING_DEFERRED',
  'SCENE_BUDGET_REFUSED',
  'SCENE_BUDGET_DEFERRED',
]);

export function isDegradationTrigger(code: string | null | undefined): boolean {
  return typeof code === 'string' && DEGRADATION_TRIGGER_CODES.has(code);
}

/** The next rung down, or `null` at the bottom. Total on the ordered list, so no rung is skipped. */
export function nextLevel(level: DegradationLevel): DegradationLevel | null {
  const index = DEGRADATION_LEVELS.indexOf(level);
  return index < 0 || index >= DEGRADATION_LEVELS.length - 1 ? null : DEGRADATION_LEVELS[index + 1];
}

/** The next rung up, or `null` at the top. */
export function previousLevel(level: DegradationLevel): DegradationLevel | null {
  const index = DEGRADATION_LEVELS.indexOf(level);
  return index <= 0 ? null : DEGRADATION_LEVELS[index - 1];
}

export type DegradationState = {
  schemaVersion: 1;
  worldId: string;
  level: DegradationLevel;
  /** Consecutive provider failures observed at the CURRENT level. */
  consecutiveFailures: number;
  /** The code that last moved this world, for an operator reading the state alone. */
  lastTriggerCode: string | null;
  /** World-time position of the last transition, so a trace can be placed in the world. */
  lastTransitionWorldDay: number;
  lastTransitionAt: number;
};

export const DEGRADATION_TRANSITION_REASONS = [
  'provider_failures_at_level',
  'authoring_succeeded',
  'operator_resume',
  'operator_override',
] as const;
export type DegradationTransitionReason = (typeof DEGRADATION_TRANSITION_REASONS)[number];

/**
 * One traceable move (AC#2). Every field is an id, a level, a code or a number — never a payload.
 *
 * `transitionId` is derived from the world and the slot that caused it, so a retried slot
 * re-derives the same id and the transition log records one move rather than one per attempt.
 */
export type DegradationTransition = {
  schemaVersion: 1;
  transitionId: string;
  worldId: string;
  fromLevel: DegradationLevel;
  toLevel: DegradationLevel;
  reason: DegradationTransitionReason;
  /** The stable provider code that caused it, when a failure did. */
  triggerCode: string | null;
  worldDay: number;
  timeSlot: string;
  /** Failures counted at `fromLevel` when the move was made. */
  consecutiveFailures: number;
  createdAt: number;
};

export type SlotOutcomeSignal = {
  worldId: string;
  worldDay: number;
  timeSlot: string;
  /** Whether the slot's authoring produced scenes. */
  authored: boolean;
  /** The stable code authoring failed with, when it did. */
  errorCode: string | null;
  at: number;
};

export const initialDegradationState = (worldId: string): DegradationState => ({
  schemaVersion: 1,
  worldId,
  level: 'normal',
  consecutiveFailures: 0,
  lastTriggerCode: null,
  lastTransitionWorldDay: 0,
  lastTransitionAt: 0,
});

const transitionId = (signal: SlotOutcomeSignal, kind: string): string =>
  `degradation:${signal.worldId}:${signal.worldDay}:${signal.timeSlot}:${kind}`;

export type DegradationDecision = {
  state: DegradationState;
  /** `null` when the signal changed nothing — the common case, and not a transition. */
  transition: DegradationTransition | null;
};

/**
 * Fold one slot outcome into the world's degradation state.
 *
 * Pure and total. The three cases, in the order they are decided:
 *
 *  1. **The slot authored.** Any degraded world recovers one rung; a `normal` world stays normal.
 *     A recovered world's failure count resets, because the count is "failures at THIS level".
 *  2. **The slot failed for a provider-side reason.** The count rises; at
 *     {@link FAILURES_BEFORE_ESCALATION} the world moves down one rung and the count resets so the
 *     new rung gets its own chance. At `paused` there is nowhere to go, so the count keeps rising
 *     and the state records it — a paused world that keeps failing is a fact an operator needs.
 *  3. **The slot failed for any other reason.** Nothing moves. A Canon rejection, a safety refusal
 *     or a lease conflict says nothing about whether the model is working.
 */
export function advanceDegradation(state: DegradationState, signal: SlotOutcomeSignal): DegradationDecision {
  if (signal.authored) {
    const recovered = previousLevel(state.level);
    if (state.level === 'normal' || recovered === null) {
      return { state: { ...state, consecutiveFailures: 0 }, transition: null };
    }
    return {
      state: {
        ...state,
        level: recovered,
        consecutiveFailures: 0,
        lastTransitionWorldDay: signal.worldDay,
        lastTransitionAt: signal.at,
      },
      transition: {
        schemaVersion: 1,
        transitionId: transitionId(signal, 'recover'),
        worldId: state.worldId,
        fromLevel: state.level,
        toLevel: recovered,
        reason: 'authoring_succeeded',
        triggerCode: null,
        worldDay: signal.worldDay,
        timeSlot: signal.timeSlot,
        consecutiveFailures: state.consecutiveFailures,
        createdAt: signal.at,
      },
    };
  }

  if (!isDegradationTrigger(signal.errorCode)) return { state, transition: null };

  const failures = state.consecutiveFailures + 1;
  const escalated = failures >= FAILURES_BEFORE_ESCALATION ? nextLevel(state.level) : null;
  if (escalated === null) {
    return {
      state: { ...state, consecutiveFailures: failures, lastTriggerCode: signal.errorCode },
      transition: null,
    };
  }
  return {
    state: {
      ...state,
      level: escalated,
      consecutiveFailures: 0,
      lastTriggerCode: signal.errorCode,
      lastTransitionWorldDay: signal.worldDay,
      lastTransitionAt: signal.at,
    },
    transition: {
      schemaVersion: 1,
      transitionId: transitionId(signal, `escalate:${escalated}`),
      worldId: state.worldId,
      fromLevel: state.level,
      toLevel: escalated,
      reason: 'provider_failures_at_level',
      triggerCode: signal.errorCode,
      worldDay: signal.worldDay,
      timeSlot: signal.timeSlot,
      consecutiveFailures: failures,
      createdAt: signal.at,
    },
  };
}

/**
 * An operator resuming a paused world (AC#1's recovery path).
 *
 * Returns to `rules_only`, not to `normal`. A world reaches `paused` only after every automatic
 * response has failed, and handing it the full model budget again on one click would put it
 * straight back into the outage it just descended through — with the ladder's own counter reset,
 * so it would take another twelve failures to get back here. Rules-only keeps the world advancing
 * on deterministic events while the next successful authored slot climbs it back one rung at a
 * time, on evidence rather than on optimism.
 */
export function resumeFromPause(state: DegradationState, at: number, operatorId: string): DegradationDecision {
  if (state.level !== 'paused') {
    return { state, transition: null };
  }
  return {
    state: {
      ...state,
      level: 'rules_only',
      consecutiveFailures: 0,
      lastTransitionWorldDay: state.lastTransitionWorldDay,
      lastTransitionAt: at,
    },
    transition: {
      schemaVersion: 1,
      transitionId: `degradation:${state.worldId}:resume:${at}:${operatorId}`,
      worldId: state.worldId,
      fromLevel: 'paused',
      toLevel: 'rules_only',
      reason: 'operator_resume',
      triggerCode: null,
      worldDay: state.lastTransitionWorldDay,
      timeSlot: 'operator',
      consecutiveFailures: 0,
      createdAt: at,
    },
  };
}

// --- what a level means to the rest of the pipeline ---------------------------

export type LevelPolicy = {
  /** Whether the slot may call a language model at all. */
  usesProvider: boolean;
  /** Whether authoring should ask for the module's configured `fallbackModel`. */
  usesFallbackModel: boolean;
  /** Major scenes the Director may plan, or `null` for the module default. */
  maxMajorScenes: number | null;
  /** Whether the slot commits deterministic rules-only proposals instead of authored scenes. */
  rulesOnly: boolean;
  /** Whether non-essential summaries are skipped and left for backfill. */
  defersSummaries: boolean;
  /** Whether new simulation work may be admitted at all. */
  admitsSimulation: boolean;
};

const POLICIES: Readonly<Record<DegradationLevel, LevelPolicy>> = {
  normal: { usesProvider: true, usesFallbackModel: false, maxMajorScenes: null, rulesOnly: false, defersSummaries: false, admitsSimulation: true },
  compatible_model: { usesProvider: true, usesFallbackModel: true, maxMajorScenes: null, rulesOnly: false, defersSummaries: false, admitsSimulation: true },
  fewer_scenes: { usesProvider: true, usesFallbackModel: true, maxMajorScenes: REDUCED_SCENES_PER_SLOT, rulesOnly: false, defersSummaries: false, admitsSimulation: true },
  rules_only: { usesProvider: false, usesFallbackModel: false, maxMajorScenes: REDUCED_SCENES_PER_SLOT, rulesOnly: true, defersSummaries: false, admitsSimulation: true },
  deferred_summaries: { usesProvider: false, usesFallbackModel: false, maxMajorScenes: REDUCED_SCENES_PER_SLOT, rulesOnly: true, defersSummaries: true, admitsSimulation: true },
  paused: { usesProvider: false, usesFallbackModel: false, maxMajorScenes: 0, rulesOnly: false, defersSummaries: true, admitsSimulation: false },
};

/**
 * What one level permits. Every rung below `compatible_model` keeps its predecessors' reductions:
 * a world on `rules_only` is also on fewer scenes, because climbing back through a rung it never
 * exercised would tell an operator nothing about whether that rung works.
 */
export const policyFor = (level: DegradationLevel): LevelPolicy => POLICIES[level];
