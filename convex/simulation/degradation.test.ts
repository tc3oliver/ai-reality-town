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
  advanceDegradation,
  initialDegradationState,
  isDegradationTrigger,
  nextLevel,
  policyFor,
  previousLevel,
  resumeFromPause,
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

/** One slot outcome. `at` is passed in so no case depends on the wall clock. */
const failure = (
  errorCode: string | null,
  overrides: Partial<SlotOutcomeSignal> = {},
): SlotOutcomeSignal => ({
  worldId: WORLD_ID,
  worldDay: 3,
  timeSlot: 'morning',
  authored: false,
  errorCode,
  at: 1_700_000_000_000,
  ...overrides,
});

const authored = (overrides: Partial<SlotOutcomeSignal> = {}): SlotOutcomeSignal =>
  failure(null, { authored: true, ...overrides });

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
