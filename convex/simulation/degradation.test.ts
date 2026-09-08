/**
 * The FR-M004 degradation ladder as a pure state machine (ART-91, AC#1/AC#2).
 *
 * `advanceDegradation` is the only place that decides which rung a world is on, so every guarantee
 * FR-M004 states about ORDER is a property of this file's subject rather than of its callers. The
 * cases below are written so that each one can fail alone:
 *
 *  - the ORDER cases assert the level after each move AND the transition's `fromLevel`/`toLevel`,
 *    because a ladder that jumped two rungs while reporting adjacent levels would pass an assertion
 *    on either half by itself;
 *  - the TRIGGER cases assert the level AND `consecutiveFailures`, because a non-provider code that
 *    silently incremented the counter would move the world two failures later — the escalation
 *    would be caused by a Canon rejection while every level assertion still read `normal`;
 *  - the POLICY case asserts the whole six-by-six table rather than the flags each rung is named
 *    for, because the reductions are cumulative and a rung that lost an inherited reduction looks
 *    correct on its own row.
 *
 * No Convex, no clock, no randomness: every signal carries its own `at`, so nothing here can pass
 * because of when it ran.
 */

import {
  DEGRADATION_LEVELS,
  DEGRADATION_TRIGGER_CODES,
  FAILURES_BEFORE_ESCALATION,
  REDUCED_SCENES_PER_SLOT,
  SLOTS_BETWEEN_PROVIDER_PROBES,
  advanceDegradation,
  degradedPlan,
  effectivePolicy,
  initialDegradationState,
  isDegradationTrigger,
  nextLevel,
  policyFor,
  previousLevel,
  resumeFromPause,
  shouldProbeProvider,
  type DegradationLevel,
  type DegradationState,
  type SlotOutcomeSignal,
} from './degradation';

const WORLD_ID = 'mistwood-public';
const OPERATOR = 'operator-qiu';

/** A provider-side code that is in the trigger set, used wherever the specific code is not the point. */
const OUTAGE = 'LLM_TIMEOUT';

const stateAt = (level: DegradationLevel, overrides: Partial<DegradationState> = {}): DegradationState => ({
  ...initialDegradationState(WORLD_ID),
  level,
  ...overrides,
});

/**
 * One slot outcome that CALLED a model. `at` is passed in so no case depends on the wall clock.
 *
 * `usedProvider` defaults to true because every case in this file is about what the ladder does with
 * evidence about the provider. The cases where a slot called no model say so explicitly, and that
 * asymmetry is the point of ART-165: a slot that called nothing is not evidence either way.
 */
const failure = (
  errorCode: string | null,
  overrides: Partial<SlotOutcomeSignal> = {},
): SlotOutcomeSignal => ({
  worldId: WORLD_ID,
  worldDay: 3,
  timeSlot: 'morning',
  authored: false,
  usedProvider: true,
  // ART-167. Every case below is a first attempt unless it says otherwise; a case about RETRY says
  // so by naming the attempt, and that is the distinction the ladder is built on.
  attempt: 1,
  errorCode,
  at: 1_700_000_000_000,
  ...overrides,
});

const authored = (overrides: Partial<SlotOutcomeSignal> = {}): SlotOutcomeSignal =>
  failure(null, { authored: true, ...overrides });

/** A completed rules-only slot: it finished, and it called nothing. */
const rulesOnlySlot = (overrides: Partial<SlotOutcomeSignal> = {}): SlotOutcomeSignal =>
  failure(null, { authored: true, usedProvider: false, ...overrides });

/**
 * The ladder written out by hand, from `normal` to the rung below it.
 *
 * Deliberately NOT `nextLevel(level)`. Deriving the expectation from the function under test is the
 * tautology this project has shipped before: `nextLevel` returning `index + 2` would move the
 * assertion with it and every case below would pass while the ladder skipped a rung. These pairs
 * are the PRD §16.3 order, typed out, so the test can disagree with the code.
 */
const ADJACENT_RUNGS: ReadonlyArray<[DegradationLevel, DegradationLevel]> = [
  ['normal', 'compatible_model'],
  ['compatible_model', 'fewer_scenes'],
  ['fewer_scenes', 'rules_only'],
  ['rules_only', 'deferred_summaries'],
  ['deferred_summaries', 'paused'],
];

// --- AC#1: the ladder moves one rung at a time, in order ---------------------

describe('the ladder never skips a rung (FR-M004 AC#1)', () => {
  it('declares the six rungs in the PRD §16.3 order', () => {
    expect([...DEGRADATION_LEVELS]).toEqual([
      'normal', 'compatible_model', 'fewer_scenes', 'rules_only', 'deferred_summaries', 'paused',
    ]);
  });

  it.each(ADJACENT_RUNGS)('from %s, two provider failures move to exactly %s', (level, expected) => {
    expect(nextLevel(level)).toBe(expected);

    const first = advanceDegradation(stateAt(level), failure(OUTAGE));
    expect(first.state.level).toBe(level);

    const second = advanceDegradation(first.state, failure(OUTAGE, { timeSlot: 'noon' }));
    expect(second.state.level).toBe(expected);
    expect(second.transition).not.toBeNull();
    // Both halves: a ladder that jumped while reporting adjacent levels, or reported a jump while
    // landing adjacent, fails exactly one of these.
    expect(second.transition?.fromLevel).toBe(level);
    expect(second.transition?.toLevel).toBe(expected);
    // …and it stops there. A third failure at the NEW level is only the first of that rung's two.
    const third = advanceDegradation(second.state, failure(OUTAGE, { timeSlot: 'afternoon' }));
    expect(third.state.level).toBe(expected);
    expect(third.transition).toBeNull();
  });

  it('walks normal → compatible_model → fewer_scenes → rules_only → deferred_summaries → paused in exactly ten failures', () => {
    let state = initialDegradationState(WORLD_ID);
    const transitions = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const decision = advanceDegradation(state, failure(OUTAGE, { worldDay: attempt, timeSlot: 'morning' }));
      state = decision.state;
      if (decision.transition) transitions.push(decision.transition);
    }

    expect(state.level).toBe('paused');
    // Five moves for six rungs: the count is the guarantee. Four would mean a rung was skipped and
    // ten failures still reached the bottom; six would mean one failure moved the world.
    expect(transitions).toHaveLength(DEGRADATION_LEVELS.length - 1);
    expect(transitions.map(({ fromLevel, toLevel }) => [fromLevel, toLevel])).toEqual([
      ['normal', 'compatible_model'],
      ['compatible_model', 'fewer_scenes'],
      ['fewer_scenes', 'rules_only'],
      ['rules_only', 'deferred_summaries'],
      ['deferred_summaries', 'paused'],
    ]);
    for (const transition of transitions) {
      expect(transition.reason).toBe('provider_failures_at_level');
      expect(transition.triggerCode).toBe(OUTAGE);
    }
  });

  it('keeps failing at paused without moving, and records that it is still failing', () => {
    // The bottom of the ladder has nowhere to go, so the count rises instead. An operator reading
    // the state row alone needs to see that a paused world is still being refused by the provider.
    let state = stateAt('paused');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const decision = advanceDegradation(state, failure(OUTAGE, { worldDay: attempt }));
      expect(decision.transition).toBeNull();
      state = decision.state;
    }
    expect(state.level).toBe('paused');
    expect(state.consecutiveFailures).toBe(4);
    expect(state.lastTriggerCode).toBe(OUTAGE);
    expect(nextLevel('paused')).toBeNull();
  });
});

describe('FAILURES_BEFORE_ESCALATION is the threshold, not a comment', () => {
  it('is two, so one failure is absorbed and the second moves the world', () => {
    expect(FAILURES_BEFORE_ESCALATION).toBe(2);
  });

  it('leaves the level untouched on the first failure and counts it', () => {
    const decision = advanceDegradation(initialDegradationState(WORLD_ID), failure(OUTAGE));
    expect(decision.transition).toBeNull();
    expect(decision.state.level).toBe('normal');
    expect(decision.state.consecutiveFailures).toBe(1);
    expect(decision.state.lastTriggerCode).toBe(OUTAGE);
  });

  it('moves on the second failure and resets the count so the new rung gets its own chance', () => {
    const first = advanceDegradation(initialDegradationState(WORLD_ID), failure(OUTAGE));
    const second = advanceDegradation(first.state, failure(OUTAGE, { timeSlot: 'noon' }));
    expect(second.state.level).toBe('compatible_model');
    expect(second.state.consecutiveFailures).toBe(0);
    // The transition records the count AT the level it left, which is what an operator needs to
    // read "two failures at compatible_model" rather than "zero failures, and yet it moved".
    expect(second.transition?.consecutiveFailures).toBe(FAILURES_BEFORE_ESCALATION);
  });
});

// --- AC#1: only a provider-side failure escalates ----------------------------

describe('only provider-side codes escalate', () => {
  it.each([...DEGRADATION_TRIGGER_CODES])('%s escalates after two failures', (code) => {
    expect(isDegradationTrigger(code)).toBe(true);
    const first = advanceDegradation(initialDegradationState(WORLD_ID), failure(code));
    expect(first.state.consecutiveFailures).toBe(1);
    const second = advanceDegradation(first.state, failure(code, { timeSlot: 'noon' }));
    expect(second.state.level).toBe('compatible_model');
    expect(second.transition?.triggerCode).toBe(code);
  });

  /**
   * Each of these says something about the REQUEST, not about the model. No rung of this ladder
   * makes a teleporting character legal or explicit content publishable, so escalating on one would
   * degrade a world for saying something the pipeline correctly refused.
   *
   * The COUNTER assertion matters as much as the level assertion: a code that failed to escalate but
   * still incremented would move the world on the next genuine provider failure alone, and every
   * level assertion in this file would still read the level it expected.
   */
  it.each([
    ['a Canon rejection', 'TELEPORTATION_NOT_ALLOWED'],
    ['a safety refusal', 'EXPLICIT_SEXUAL_CONTENT'],
    ['an unrecognised code', 'SOME_CODE_NOBODY_DECLARED'],
    ['no code at all', null],
  ])('%s moves neither the level nor the counter', (_description, code) => {
    expect(isDegradationTrigger(code)).toBe(false);
    let state = stateAt('compatible_model', { consecutiveFailures: 1 });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const decision = advanceDegradation(state, failure(code, { worldDay: attempt }));
      expect(decision.transition).toBeNull();
      state = decision.state;
    }
    expect(state.level).toBe('compatible_model');
    expect(state.consecutiveFailures).toBe(1);
  });

  it('does not treat a Canon or safety code as a trigger even in bulk', () => {
    expect(DEGRADATION_TRIGGER_CODES.has('TELEPORTATION_NOT_ALLOWED')).toBe(false);
    expect(DEGRADATION_TRIGGER_CODES.has('EXPLICIT_SEXUAL_CONTENT')).toBe(false);
    // Every declared trigger names the model, the route or the allowance.
    for (const code of DEGRADATION_TRIGGER_CODES) {
      expect(code.startsWith('LLM_') || code.startsWith('SCENE_')).toBe(true);
    }
  });
});

// --- AC#1: recovery ----------------------------------------------------------

describe('an authored slot recovers exactly one rung', () => {
  // The same hand-written pairs, read upwards, for the same reason: `previousLevel(level)` as the
  // expectation would move with the function it is checking.
  it.each(ADJACENT_RUNGS.map(([up, down]) => [down, up]))(
    'recovers %s to %s and resets the count',
    (level, expected) => {
      const decision = advanceDegradation(stateAt(level, { consecutiveFailures: 1 }), authored());
      expect(decision.state.level).toBe(expected);
      expect(decision.state.consecutiveFailures).toBe(0);
      expect(decision.transition?.fromLevel).toBe(level);
      expect(decision.transition?.toLevel).toBe(expected);
      expect(decision.transition?.reason).toBe('authoring_succeeded');
      expect(decision.transition?.triggerCode).toBeNull();
    },
  );

  it('is a no-op at normal: there is no rung above it', () => {
    const decision = advanceDegradation(stateAt('normal', { consecutiveFailures: 1 }), authored());
    expect(decision.transition).toBeNull();
    expect(decision.state.level).toBe('normal');
    // The count still resets. It means "consecutive failures at THIS level", and the slot succeeded.
    expect(decision.state.consecutiveFailures).toBe(0);
  });

  /**
   * What the code ACTUALLY does at `paused`, asserted rather than assumed.
   *
   * `advanceDegradation` treats `paused` like any other degraded rung: an authored slot recovers it
   * to `deferred_summaries`. It does NOT refuse the recovery.
   *
   * That is not a contradiction of "nothing recovers automatically from paused", because the branch
   * is unreachable in the running system: `prepareQueuedWorldDaySlot` reads `policyFor(level)` and
   * throws `WORLD_DEGRADATION_PAUSED` BEFORE the slot is claimed, so a paused world never runs a
   * slot and therefore never produces an authored outcome to feed back in. The guarantee lives at
   * the admission gate, and this function stays uniform. Pinning the real behaviour here means a
   * future change to either side has to face the other one.
   */
  it('recovers a paused world when handed an authored slot — a signal the admission gate prevents', () => {
    const decision = advanceDegradation(stateAt('paused'), authored());
    expect(decision.state.level).toBe('deferred_summaries');
    expect(decision.transition?.reason).toBe('authoring_succeeded');
    // The gate that makes the above unreachable:
    expect(policyFor('paused').admitsSimulation).toBe(false);
  });

  it('climbs back one rung per authored slot, at the speed it fell', () => {
    let state = stateAt('paused');
    const levels: DegradationLevel[] = [];
    for (let attempt = 0; attempt < DEGRADATION_LEVELS.length - 1; attempt += 1) {
      state = advanceDegradation(state, authored({ worldDay: attempt })).state;
      levels.push(state.level);
    }
    expect(levels).toEqual(['deferred_summaries', 'rules_only', 'fewer_scenes', 'compatible_model', 'normal']);
  });
});

// --- ART-165: only a slot that called a model says anything about the model ---

describe('a slot that called no model is not evidence about the model', () => {
  /**
   * The defect ART-165 fixes, pinned as its inverse.
   *
   * `driveOneWorld` reported every completed slot as `authored: true`, including a rules-only one —
   * which completes precisely because it calls nothing. A world at `rules_only` therefore climbed
   * straight back to `fewer_scenes` on its own deterministic output, and the two rungs below it
   * could never be reached by any outage.
   */
  it.each(['rules_only', 'deferred_summaries'] as const)(
    'does not recover %s when a rules-only slot completes',
    (level) => {
      const decision = advanceDegradation(stateAt(level), rulesOnlySlot());
      expect(decision.transition).toBeNull();
      expect(decision.state.level).toBe(level);
      // It counts towards the next probe instead, which is how the world does eventually find out.
      expect(decision.state.slotsSinceProviderProbe).toBe(1);
    },
  );

  it('does not count a rules-only slot towards the probe while the rung is already calling a model', () => {
    // `normal` and `compatible_model` author every slot. A slot that reached neither the provider
    // nor a failure — nothing planned, everything already persisted — must not start a probe
    // countdown for a provider the world is using anyway.
    for (const level of ['normal', 'compatible_model', 'fewer_scenes'] as const) {
      const decision = advanceDegradation(stateAt(level), rulesOnlySlot());
      expect(decision.state.slotsSinceProviderProbe).toBe(0);
      expect(decision.transition).toBeNull();
    }
  });

  it('does not escalate when a rules-only slot fails: that is the derivation, not the model', () => {
    const decision = advanceDegradation(
      stateAt('rules_only', { consecutiveFailures: 1 }),
      failure('RULES_ONLY_COMMIT_FAILED', { usedProvider: false }),
    );
    expect(decision.transition).toBeNull();
    expect(decision.state.level).toBe('rules_only');
    expect(decision.state.consecutiveFailures).toBe(1);
  });
});

describe('the provider probe is what makes the lowest rungs reachable (ART-165)', () => {
  it('probes after a world day of slots that called nothing, and not before', () => {
    expect(SLOTS_BETWEEN_PROVIDER_PROBES).toBe(5);
    let state = stateAt('rules_only');
    const probes: boolean[] = [];
    for (let slot = 0; slot < SLOTS_BETWEEN_PROVIDER_PROBES + 1; slot += 1) {
      probes.push(shouldProbeProvider(state));
      state = advanceDegradation(state, rulesOnlySlot({ worldDay: slot })).state;
    }
    // False for the first five, true on the sixth: one probe per world day.
    expect(probes).toEqual([false, false, false, false, false, true]);
  });

  it('never probes from paused, because that is the whole content of paused', () => {
    const state = stateAt('paused', { slotsSinceProviderProbe: 99 });
    expect(shouldProbeProvider(state)).toBe(false);
    expect(effectivePolicy(state)).toEqual(policyFor('paused'));
    expect(effectivePolicy(state).admitsSimulation).toBe(false);
  });

  it('never probes from a rung that is already calling the provider', () => {
    for (const level of ['normal', 'compatible_model', 'fewer_scenes'] as const) {
      expect(shouldProbeProvider(stateAt(level, { slotsSinceProviderProbe: 99 }))).toBe(false);
      expect(effectivePolicy(stateAt(level, { slotsSinceProviderProbe: 99 }))).toEqual(policyFor(level));
    }
  });

  it('runs the probe at the cheapest real authoring, and un-defers nothing else', () => {
    const due = stateAt('deferred_summaries', { slotsSinceProviderProbe: SLOTS_BETWEEN_PROVIDER_PROBES });
    const policy = effectivePolicy(due);
    expect(policy.usesProvider).toBe(true);
    expect(policy.rulesOnly).toBe(false);
    expect(policy.usesFallbackModel).toBe(true);
    expect(policy.maxMajorScenes).toBe(REDUCED_SCENES_PER_SLOT);
    // A probe is a question about the model, not a return to service: the rung's other reductions
    // stay, and the rung itself has not moved.
    expect(policy.defersSummaries).toBe(true);
    expect(due.level).toBe('deferred_summaries');
  });

  it('reaches paused on a sustained outage, one rung at a time, and could not before', () => {
    /**
     * The runtime loop, written out — including the part ART-167 found missing.
     *
     * The driver stops on the first slot that did not complete and `claimLiveSlot` hands the same
     * row back with the next attempt, so world time does NOT advance while the provider is down: it
     * is one slot, retried. A version of this loop that walked to the next slot on every tick was
     * how the ladder's inability to escalate stayed invisible.
     */
    let state = initialDegradationState(WORLD_ID);
    const transitions: Array<[string, string]> = [];
    let worldDay = 0;
    let slotIndex = 0;
    let attempt = 0;
    for (let tick = 0; tick < 60 && state.level !== 'paused'; tick += 1) {
      const policy = effectivePolicy(state);
      const usedProvider = policy.usesProvider;
      // A rules-only slot completes; a slot that calls the downed provider does not.
      const authored = !usedProvider;
      attempt += 1;
      const decision = advanceDegradation(state, {
        worldId: WORLD_ID, worldDay, timeSlot: `slot-${slotIndex}`, attempt,
        authored, usedProvider, errorCode: usedProvider ? OUTAGE : null,
        at: tick,
      });
      state = decision.state;
      if (decision.transition) transitions.push([decision.transition.fromLevel, decision.transition.toLevel]);
      if (authored) {
        attempt = 0;
        slotIndex += 1;
        if (slotIndex === 5) {
          slotIndex = 0;
          worldDay += 1;
        }
      }
    }
    expect(state.level).toBe('paused');
    expect(transitions).toEqual([
      ['normal', 'compatible_model'],
      ['compatible_model', 'fewer_scenes'],
      ['fewer_scenes', 'rules_only'],
      ['rules_only', 'deferred_summaries'],
      ['deferred_summaries', 'paused'],
    ]);
  });

  it('climbs back out when a probe finally authors', () => {
    let state = stateAt('rules_only', { slotsSinceProviderProbe: SLOTS_BETWEEN_PROVIDER_PROBES });
    expect(shouldProbeProvider(state)).toBe(true);
    const decision = advanceDegradation(state, authored({ worldDay: 9 }));
    expect(decision.state.level).toBe('fewer_scenes');
    expect(decision.state.slotsSinceProviderProbe).toBe(0);
    state = decision.state;
    // From `fewer_scenes` the world authors every slot again, so it climbs without probing.
    for (const worldDay of [10, 11]) state = advanceDegradation(state, authored({ worldDay })).state;
    expect(state.level).toBe('normal');
  });

  it('resets the probe countdown when an operator resumes, so a resumed world does not ask at once', () => {
    const resumed = resumeFromPause(stateAt('paused', { slotsSinceProviderProbe: 99 }), 5_000, OPERATOR);
    expect(resumed.state.level).toBe('rules_only');
    expect(resumed.state.slotsSinceProviderProbe).toBe(0);
    expect(shouldProbeProvider(resumed.state)).toBe(false);
  });
});

describe('one ATTEMPT moves the world once, however often its outcome arrives (ART-165/ART-167)', () => {
  /**
   * ART-167, and the reason this describe block is about attempts rather than slots.
   *
   * ART-165 keyed the guard on `worldDay:timeSlot`, and on the deployed path that is the only key a
   * persistent outage ever produces: `driveOneWorld` stops on the first slot that did not complete,
   * an authoring failure leaves the row `running` rather than `failed`, and `claimLiveSlot` hands
   * the same row back with `attemptCount + 1`. So the ladder saw one key forever, froze at one
   * failure, and could not leave `normal` — every rung below it unreachable, which is a strictly
   * larger version of the bug ART-165 set out to fix.
   */
  it('escalates when the SAME slot fails on two separate attempts', () => {
    const first = advanceDegradation(
      initialDegradationState(WORLD_ID), failure(OUTAGE, { worldDay: 3, timeSlot: 'morning', attempt: 1 }));
    expect(first.state.consecutiveFailures).toBe(1);
    expect(first.state.level).toBe('normal');
    const second = advanceDegradation(
      first.state, failure(OUTAGE, { worldDay: 3, timeSlot: 'morning', attempt: 2 }));
    expect(second.state.level).toBe('compatible_model');
    expect(second.transition?.fromLevel).toBe('normal');
  });

  it('walks the whole ladder on retries of ONE slot, which is what an outage produces', () => {
    // World time does not advance while a slot keeps failing, so this is the real shape of an
    // outage: one slot, twelve attempts, six rungs.
    let state = initialDegradationState(WORLD_ID);
    const levels: DegradationLevel[] = [];
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const decision = advanceDegradation(state, failure(OUTAGE, { worldDay: 40, timeSlot: 'morning', attempt }));
      state = decision.state;
      if (decision.transition) levels.push(decision.transition.toLevel);
    }
    expect(levels).toEqual([
      'compatible_model', 'fewer_scenes', 'rules_only', 'deferred_summaries', 'paused',
    ]);
  });

  /**
   * `applyDecision` deduplicates the transition ROW on its derived id, and the schema note used to
   * claim that meant a replayed slot could not walk the ladder. It did not: the state row is patched
   * either way, so two deliveries of one failure counted two failures and escalated a world that had
   * failed once.
   */
  it('ignores a repeated delivery of one attempt', () => {
    const signal = failure(OUTAGE, { worldDay: 4, timeSlot: 'evening' });
    const once = advanceDegradation(initialDegradationState(WORLD_ID), signal);
    expect(once.state.consecutiveFailures).toBe(1);
    const twice = advanceDegradation(once.state, signal);
    expect(twice.state).toEqual(once.state);
    expect(twice.transition).toBeNull();
    expect(twice.state.level).toBe('normal');
  });

  it('ignores a repeated delivery of one recovering attempt', () => {
    const signal = authored({ worldDay: 4, timeSlot: 'evening' });
    const once = advanceDegradation(stateAt('rules_only'), signal);
    expect(once.state.level).toBe('fewer_scenes');
    const twice = advanceDegradation(once.state, signal);
    expect(twice.state.level).toBe('fewer_scenes');
    expect(twice.transition).toBeNull();
  });

  it('still moves on the NEXT attempt, so the guard is exactly-once and not once-ever', () => {
    const first = advanceDegradation(initialDegradationState(WORLD_ID), failure(OUTAGE, { attempt: 1 }));
    const repeat = advanceDegradation(first.state, failure(OUTAGE, { attempt: 1 }));
    const second = advanceDegradation(repeat.state, failure(OUTAGE, { attempt: 2 }));
    expect(second.state.level).toBe('compatible_model');
  });
});

// --- rungs 2 and 3, whose entire effect is one function ----------------------

describe('degradedPlan is what rungs 2 and 3 actually do (ART-165)', () => {
  const plan = {
    scenes: ['scene-a', 'scene-b', 'scene-c'] as const,
    // The options the request is actually built from. `requestedModel` is only the reservation key,
    // and ART-91 swapped that one alone — which is how the rung changed no call.
    options: { model: 'primary-model', temperature: 0.7 },
    requestedModel: 'primary-model',
    fallbackModel: 'compatible-model',
  };

  it('changes nothing at normal', () => {
    expect(degradedPlan(plan, policyFor('normal'))).toEqual(plan);
  });

  it('swaps the fallback into BOTH the reservation key and the request', () => {
    const degraded = degradedPlan(plan, policyFor('compatible_model'));
    expect(degraded.requestedModel).toBe('compatible-model');
    // The one that reaches the wire. Asserting only `requestedModel` is what let the rung meter a
    // bucket nothing spent from while the primary model served every call.
    expect(degraded.options.model).toBe('compatible-model');
    expect(degraded.options.temperature).toBe(0.7);
    expect(degraded.scenes).toHaveLength(3);
  });

  it('truncates to REDUCED_SCENES_PER_SLOT at fewer_scenes, keeping the Director’s own order', () => {
    const degraded = degradedPlan(plan, policyFor('fewer_scenes'));
    expect(degraded.scenes).toEqual(['scene-a']);
    expect(degraded.requestedModel).toBe('compatible-model');
    expect(degraded.options.model).toBe('compatible-model');
  });

  it('stays on the requested model when no fallback is configured, and still applies the rung', () => {
    // An absent fallback is not a reason to skip a rung: the scene reduction still binds.
    const degraded = degradedPlan({ ...plan, fallbackModel: null }, policyFor('fewer_scenes'));
    expect(degraded.requestedModel).toBe('primary-model');
    expect(degraded.options.model).toBe('primary-model');
    expect(degraded.scenes).toEqual(['scene-a']);
  });

  it('keeps the reservation key and the request naming the same model at every rung', () => {
    // The invariant the two defects broke in opposite directions. A rung that changes one without
    // the other either meters a model it does not call or calls a model it did not reserve.
    for (const level of DEGRADATION_LEVELS) {
      const degraded = degradedPlan(plan, policyFor(level));
      expect(degraded.options.model).toBe(degraded.requestedModel);
    }
  });

  it('plans nothing at paused', () => {
    expect(degradedPlan(plan, policyFor('paused')).scenes).toEqual([]);
  });
});

describe('resumeFromPause is the operator path off the bottom rung', () => {
  it('returns a paused world to rules_only, not to normal', () => {
    const decision = resumeFromPause(stateAt('paused', { consecutiveFailures: 7 }), 1_700_000_000_500, OPERATOR);
    expect(decision.state.level).toBe('rules_only');
    expect(decision.state.consecutiveFailures).toBe(0);
    expect(decision.transition).not.toBeNull();
    expect(decision.transition?.fromLevel).toBe('paused');
    expect(decision.transition?.toLevel).toBe('rules_only');
    expect(decision.transition?.reason).toBe('operator_resume');
    expect(decision.transition?.createdAt).toBe(1_700_000_000_500);
  });

  it.each(DEGRADATION_LEVELS.filter((level) => level !== 'paused'))(
    'is a no-op at %s, which is not paused',
    (level) => {
      const before = stateAt(level, { consecutiveFailures: 1 });
      const decision = resumeFromPause(before, 1_700_000_000_500, OPERATOR);
      expect(decision.transition).toBeNull();
      expect(decision.state).toEqual(before);
    },
  );
});

// --- AC#2: transition identity ----------------------------------------------

describe('transition ids are derived from the signal, so the store can dedupe them', () => {
  it('re-derives the same id for the same escalating slot', () => {
    const at = stateAt('normal', { consecutiveFailures: 1 });
    const signal = failure(OUTAGE, { timeSlot: 'evening' });
    const first = advanceDegradation(at, signal);
    const second = advanceDegradation(at, signal);
    expect(first.transition?.transitionId).toBe(second.transition?.transitionId);
    // Insert-if-absent on this id is what stops a retried slot from walking the ladder twice.
    expect(first.transition?.transitionId).toContain(WORLD_ID);
  });

  it('re-derives the same id for the same recovering slot', () => {
    const at = stateAt('rules_only');
    const signal = authored({ timeSlot: 'night' });
    expect(advanceDegradation(at, signal).transition?.transitionId)
      .toBe(advanceDegradation(at, signal).transition?.transitionId);
  });

  it('derives a different id for a different slot', () => {
    const at = stateAt('normal', { consecutiveFailures: 1 });
    const morning = advanceDegradation(at, failure(OUTAGE, { timeSlot: 'morning' }));
    const noon = advanceDegradation(at, failure(OUTAGE, { timeSlot: 'noon' }));
    expect(morning.transition?.transitionId).not.toBe(noon.transition?.transitionId);
  });

  it('separates an escalation from a recovery on the same slot', () => {
    // Same world, same day, same slot: only the direction differs. Sharing an id would let a
    // recovery be swallowed by the escalation that preceded it.
    const escalation = advanceDegradation(stateAt('normal', { consecutiveFailures: 1 }), failure(OUTAGE));
    const recovery = advanceDegradation(stateAt('compatible_model'), authored());
    expect(escalation.transition?.transitionId).not.toBe(recovery.transition?.transitionId);
  });
});

// --- what each level permits -------------------------------------------------

describe('policyFor is the whole table (AC#1)', () => {
  it('states all six flags for all six levels', () => {
    expect(Object.fromEntries(DEGRADATION_LEVELS.map((level) => [level, policyFor(level)]))).toEqual({
      normal: {
        usesProvider: true, usesFallbackModel: false, maxMajorScenes: null,
        rulesOnly: false, defersSummaries: false, admitsSimulation: true,
      },
      compatible_model: {
        usesProvider: true, usesFallbackModel: true, maxMajorScenes: null,
        rulesOnly: false, defersSummaries: false, admitsSimulation: true,
      },
      fewer_scenes: {
        usesProvider: true, usesFallbackModel: true, maxMajorScenes: REDUCED_SCENES_PER_SLOT,
        rulesOnly: false, defersSummaries: false, admitsSimulation: true,
      },
      rules_only: {
        usesProvider: false, usesFallbackModel: false, maxMajorScenes: REDUCED_SCENES_PER_SLOT,
        rulesOnly: true, defersSummaries: false, admitsSimulation: true,
      },
      deferred_summaries: {
        usesProvider: false, usesFallbackModel: false, maxMajorScenes: REDUCED_SCENES_PER_SLOT,
        rulesOnly: true, defersSummaries: true, admitsSimulation: true,
      },
      paused: {
        usesProvider: false, usesFallbackModel: false, maxMajorScenes: 0,
        rulesOnly: false, defersSummaries: true, admitsSimulation: false,
      },
    });
  });

  it('admits simulation at every level except paused', () => {
    const refusing = DEGRADATION_LEVELS.filter((level) => !policyFor(level).admitsSimulation);
    expect(refusing).toEqual(['paused']);
  });

  it('calls no provider at rules_only and below', () => {
    const providerless = DEGRADATION_LEVELS.filter((level) => !policyFor(level).usesProvider);
    expect(providerless).toEqual(['rules_only', 'deferred_summaries', 'paused']);
  });

  it('caps scenes at REDUCED_SCENES_PER_SLOT from fewer_scenes down, and lower still at paused', () => {
    expect(REDUCED_SCENES_PER_SLOT).toBe(1);
    expect(policyFor('normal').maxMajorScenes).toBeNull();
    expect(policyFor('compatible_model').maxMajorScenes).toBeNull();
    for (const level of ['fewer_scenes', 'rules_only', 'deferred_summaries'] as const) {
      expect(policyFor(level).maxMajorScenes).toBe(REDUCED_SCENES_PER_SLOT);
    }
    expect(policyFor('paused').maxMajorScenes).toBe(0);
  });

  it('never un-reduces a rung it already reduced', () => {
    // The reductions are cumulative: a world on rules_only is also on fewer scenes and on the
    // fallback-model path's budget, because climbing back through a rung it never exercised would
    // tell an operator nothing about whether that rung works.
    let sawProviderless = false;
    for (const level of DEGRADATION_LEVELS) {
      const policy = policyFor(level);
      if (!policy.usesProvider) sawProviderless = true;
      if (sawProviderless) expect(policy.usesProvider).toBe(false);
    }
    let sawCap = false;
    for (const level of DEGRADATION_LEVELS) {
      const cap = policyFor(level).maxMajorScenes;
      if (cap !== null) sawCap = true;
      if (sawCap) expect(cap).not.toBeNull();
    }
  });
});

describe('nextLevel and previousLevel are total on the ordered list', () => {
  it('are inverses everywhere they are both defined', () => {
    for (const level of DEGRADATION_LEVELS) {
      const down = nextLevel(level);
      if (down !== null) expect(previousLevel(down)).toBe(level);
      const up = previousLevel(level);
      if (up !== null) expect(nextLevel(up)).toBe(level);
    }
  });

  it('bottoms out at paused and tops out at normal', () => {
    expect(nextLevel('paused')).toBeNull();
    expect(previousLevel('normal')).toBeNull();
    expect(DEGRADATION_LEVELS[0]).toBe('normal');
    expect(DEGRADATION_LEVELS[DEGRADATION_LEVELS.length - 1]).toBe('paused');
  });
});
