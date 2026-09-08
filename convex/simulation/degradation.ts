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
 *
 * ## Only a slot that CALLED a model says anything about the model (ART-165)
 *
 * "A successful authored slot" was the intent from the start, and it is not what the runtime fed
 * this function. `driveOneWorld` recorded `authored: true` for any completed slot, including a
 * rules-only one — which completes precisely because it calls no model. A world that reached
 * `rules_only` therefore committed its deterministic events, was credited with an authoring it had
 * not performed, and climbed straight back to `fewer_scenes`. Escalating past `rules_only` needs
 * failures AT `rules_only`, and a rules-only slot does not fail, so `deferred_summaries` and
 * `paused` were implemented, tested, exposed through an operator resume — and unreachable by the
 * outage they exist for. A world in a total outage oscillated between two rungs forever, paying for
 * a failed provider call two slots in every three.
 *
 * {@link SlotOutcomeSignal.usedProvider} is that split. A slot that called no model advances
 * nothing but {@link DegradationState.slotsSinceProviderProbe}; only a slot that called one can
 * recover a rung or escalate one.
 *
 * That alone would strand a rules-only world forever, because it would never call a model again and
 * so could never learn the outage had ended. {@link shouldProbeProvider} is the other half: once a
 * no-provider world has run {@link SLOTS_BETWEEN_PROVIDER_PROBES} slots, the next one is admitted
 * as the cheapest possible real authoring attempt. A probe that authors climbs a rung; a probe that
 * fails counts a failure, so the two lowest rungs are now reached by the failure they are declared
 * for. A `paused` world never probes — that is what paused means.
 *
 * ## One slot moves the world once
 *
 * `applyDecision` deduplicates the transition ROW on its derived id, and the schema note used to
 * claim that meant a replayed slot could not walk the ladder. It did not: the state row is patched
 * whether or not the transition was new, so two deliveries of one failure counted two failures.
 * {@link DegradationState.lastSignalKey} closes it here, in the pure decision, where it holds for
 * every caller rather than for the one that remembers.
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

/**
 * Slots a no-provider world runs before it spends one asking whether the provider is back.
 *
 * Five, which is one world day: long enough that an outage is not re-tested every few minutes, and
 * short enough that a world does not sit on deterministic events for days after the model returns.
 */
export const SLOTS_BETWEEN_PROVIDER_PROBES = 5;

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
  /**
   * Slots run on a rung that calls no model since the provider was last actually tried (ART-165).
   *
   * Counts only while the world's rung is a no-provider one; a world that is calling the model
   * every slot has nothing to probe and holds this at zero.
   */
  slotsSinceProviderProbe: number;
  /**
   * `worldDay:timeSlot` of the outcome that last moved this world, so a re-delivered outcome
   * changes nothing (ART-165). Null on a world no slot has reported yet.
   */
  lastSignalKey: string | null;
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
  /**
   * Whether the slot called a language model at all (ART-165).
   *
   * A rules-only slot did not, so its completion is not evidence that the provider works — and its
   * failure is not evidence that the provider is broken. Both are statements about the derivation.
   */
  usedProvider: boolean;
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
  slotsSinceProviderProbe: 0,
  lastSignalKey: null,
});

const transitionId = (signal: SlotOutcomeSignal, kind: string): string =>
  `degradation:${signal.worldId}:${signal.worldDay}:${signal.timeSlot}:${kind}`;

export type DegradationDecision = {
  state: DegradationState;
  /** `null` when the signal changed nothing — the common case, and not a transition. */
  transition: DegradationTransition | null;
};

/** `worldDay:timeSlot` — the slot's identity, which is what one outcome is about. */
const signalKeyOf = (signal: SlotOutcomeSignal): string => `${signal.worldDay}:${signal.timeSlot}`;

/**
 * Fold one slot outcome into the world's degradation state.
 *
 * Pure and total. The cases, in the order they are decided:
 *
 *  0. **This slot already moved the world.** Nothing happens. One slot moves the world once,
 *     however many times its outcome is delivered (ART-165).
 *  1. **The slot called no model.** Nothing about the ladder's rung changes; the probe counter
 *     advances, and only while the world's rung is one that calls no model. A rules-only slot is
 *     not evidence about the provider in either direction (ART-165).
 *  2. **The slot authored.** Any degraded world recovers one rung; a `normal` world stays normal.
 *     A recovered world's failure count resets, because the count is "failures at THIS level".
 *  3. **The slot failed for a provider-side reason.** The count rises; at
 *     {@link FAILURES_BEFORE_ESCALATION} the world moves down one rung and the count resets so the
 *     new rung gets its own chance. At `paused` there is nowhere to go, so the count keeps rising
 *     and the state records it — a paused world that keeps failing is a fact an operator needs.
 *  4. **The slot failed for any other reason.** Nothing moves. A Canon rejection, a safety refusal
 *     or a lease conflict says nothing about whether the model is working.
 */
export function advanceDegradation(state: DegradationState, signal: SlotOutcomeSignal): DegradationDecision {
  const signalKey = signalKeyOf(signal);
  if (state.lastSignalKey === signalKey) return { state, transition: null };
  const seen: DegradationState = { ...state, lastSignalKey: signalKey };

  if (!signal.usedProvider) {
    // Counted only on a rung that calls no model: a world authoring every slot has nothing to
    // probe, and a counter that rose there would send it probing for a provider it is already using.
    const idle = policyFor(state.level).usesProvider
      ? seen.slotsSinceProviderProbe
      : seen.slotsSinceProviderProbe + 1;
    return { state: { ...seen, slotsSinceProviderProbe: idle }, transition: null };
  }

  // The provider was tried, so whatever the outcome the world has just learned something about it.
  const probed: DegradationState = { ...seen, slotsSinceProviderProbe: 0 };

  if (signal.authored) {
    const recovered = previousLevel(probed.level);
    if (probed.level === 'normal' || recovered === null) {
      return { state: { ...probed, consecutiveFailures: 0 }, transition: null };
    }
    return {
      state: {
        ...probed,
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

  if (!isDegradationTrigger(signal.errorCode)) return { state: probed, transition: null };

  const failures = probed.consecutiveFailures + 1;
  const escalated = failures >= FAILURES_BEFORE_ESCALATION ? nextLevel(probed.level) : null;
  if (escalated === null) {
    return {
      state: { ...probed, consecutiveFailures: failures, lastTriggerCode: signal.errorCode },
      transition: null,
    };
  }
  return {
    state: {
      ...probed,
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
      // A resumed world spends a full world day on deterministic events before it asks the provider
      // anything. Resuming is an operator saying the cause was addressed, not evidence that it was.
      slotsSinceProviderProbe: 0,
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

/**
 * Whether this world's next slot should ask the provider whether it is back (ART-165).
 *
 * True only on a rung that otherwise calls no model, and never while `paused` — a paused world
 * admits no simulation at all, which is the whole content of that rung, and probing from it would
 * make the operator resume decorative.
 */
export function shouldProbeProvider(state: DegradationState): boolean {
  const policy = policyFor(state.level);
  if (policy.usesProvider || !policy.admitsSimulation) return false;
  return state.slotsSinceProviderProbe >= SLOTS_BETWEEN_PROVIDER_PROBES;
}

/**
 * The policy the world's NEXT slot runs under, probe included.
 *
 * A probe re-enables the provider for exactly one slot, at the cheapest setting the ladder has: the
 * fallback model and one major scene. Everything else the rung reduced stays reduced — a probe is a
 * question about the model, not a return to normal service, and `deferred_summaries` in particular
 * keeps deferring while it asks.
 *
 * Callers should use this rather than {@link policyFor} to decide what a slot may do, and
 * {@link policyFor} to describe the rung the world is ON. They differ for one slot in every
 * {@link SLOTS_BETWEEN_PROVIDER_PROBES}, and that difference is the recovery path.
 */
export function effectivePolicy(state: DegradationState): LevelPolicy {
  const base = policyFor(state.level);
  if (!shouldProbeProvider(state)) return base;
  return {
    ...base,
    usesProvider: true,
    usesFallbackModel: true,
    rulesOnly: false,
    maxMajorScenes: REDUCED_SCENES_PER_SLOT,
  };
}

/**
 * What a plan an authoring slot will run looks like at this level (FR-M004 rungs 2 and 3).
 *
 * `fewer_scenes` truncates the scene list rather than asking the Director to re-plan: the plan was
 * already validated against FR-C002, and a re-plan would be a second planner whose output nothing
 * had checked. Truncation keeps the scenes planned first, which is the Director's own priority
 * order.
 *
 * `compatible_model` swaps the module's configured `fallbackModel` into BOTH the reservation key and
 * the request. ART-91 swapped only `requestedModel`, which is read for exactly one thing — the
 * FR-M003 reservation — while the model that goes on the wire is `options.model`. So the rung
 * reserved budget against the fallback and then called the primary: it changed no call, and it
 * metered a bucket nothing spent from, which is the hazard `prepareQueuedWorldDaySlot`'s own
 * docblock argues against one layer up. An earlier version of this note said the rung "swaps the
 * requested model for the module's configured fallbackModel"; that was true of the field and false
 * of the call.
 *
 * A world with no fallback configured stays on its requested model and the level still applies its
 * other reductions: an absent fallback is not a reason to skip a rung.
 *
 * It lives here rather than beside its callers (ART-165) because those callers are Convex mutation
 * handlers, whose bodies do not execute under jest. Rungs 2 and 3 are the two rungs whose entire
 * observable effect is this function, and there was no named test that could fail if it stopped
 * working.
 */
export function degradedPlan<
  Plan extends {
    readonly scenes: readonly unknown[];
    readonly options: { readonly model?: string };
    readonly requestedModel: string;
    readonly fallbackModel: string | null;
  },
>(plan: Plan, policy: LevelPolicy): Plan {
  const scenes = policy.maxMajorScenes === null ? plan.scenes : plan.scenes.slice(0, policy.maxMajorScenes);
  const fallback = policy.usesFallbackModel ? plan.fallbackModel : null;
  if (fallback === null) return { ...plan, scenes };
  // Both, together. Either one alone is the defect: the reservation names the model the call must
  // use, and `simulateWholeScene` sends `options.model` whenever the budget gate did not change it.
  return { ...plan, scenes, requestedModel: fallback, options: { ...plan.options, model: fallback } };
}
