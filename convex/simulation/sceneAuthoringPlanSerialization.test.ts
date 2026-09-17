/**
 * Everything on a `SceneAuthoringPlan` is a Convex value (ART-194).
 *
 * `prepareQueuedWorldDaySlot` returns `{ kind: 'awaiting_authoring', plan }` from a MUTATION into
 * an ACTION, so Convex serializes the whole plan. `wholeSceneOptionsFor` put
 * `buildSystemPrompt: selectWholeScenePrompt(...)` — a function — on `plan.options`, and functions
 * are not Convex values. Every live slot that needed a provider died inside `convexToJson` with
 * `Cannot read properties of undefined (reading 'length')`, a message naming neither the field nor
 * the plan.
 *
 * `awaiting_authoring` is what the mutation returns whenever a slot actually has scenes to author,
 * so this was not an edge case: no live slot could be authored on any world. It is why the
 * acceptance world stopped advancing on 2026-08-04.
 *
 * ## Why every existing test passed
 *
 * The deterministic path runs a whole slot inside ONE mutation. The plan is built and consumed
 * in-process and never serialized, so a function on it is harmless — and a `toEqual` comparison
 * between two in-process objects cannot see the problem at all. The live path is the only one that
 * crosses the boundary, and nothing exercised it.
 *
 * So these assert the property Convex actually enforces, using the serializer Convex actually
 * uses. The first block pins the premise, because if `convexToJson` ever stopped rejecting
 * functions the rest would go quiet.
 */

import { convexToJson } from 'convex/values';

import { wholeSceneOptionsFor } from './moduleConfig';
import { selectWholeScenePrompt } from './promptVersions';

/** An effective module config, as `loadModuleConfig` resolves one. */
const CONFIG = {
  module: 'scene_simulation',
  model: null,
  fallbackModel: null,
  promptVersion: 'scene_simulation.v1',
  semanticMaxAttempts: 2,
  temperature: 0.4,
  maxTokens: 4000,
  timeoutMs: null,
  transportMaxAttempts: null,
} as never;

describe('the premise: Convex rejects a function, and that is the error we saw', () => {
  it('rejects a function with the exact production message', () => {
    /**
     * Pinned verbatim because it is what sent the first diagnosis of this defect in the wrong
     * direction. `undefined` object properties do NOT produce it — `convexToJson` drops those
     * silently — so an explanation blaming an absent optional field could not have been right.
     */
    expect(() => convexToJson({ fn: () => 'x' } as never))
      .toThrow(/Cannot read properties of undefined \(reading 'length'\)/u);
  });

  it('accepts an object property holding undefined, which is why that was NOT the cause', () => {
    expect(() => convexToJson({ a: undefined } as never)).not.toThrow();
  });
});

describe('the authoring options carry no behaviour', () => {
  const options = wholeSceneOptionsFor(CONFIG);

  it('does not put a prompt builder on the options', () => {
    // `Object.keys`, not `toEqual`: a property holding a function and an absent property compare
    // equal often enough that only key presence states this.
    expect(Object.keys(options)).not.toContain('buildSystemPrompt');
    expect(Object.keys(options)).not.toContain('onAttempt');
  });

  it('holds no function-valued property at all', () => {
    for (const [key, value] of Object.entries(options)) {
      expect(typeof value).not.toBe('function');
      expect(typeof value).not.toBe('symbol');
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it('still carries every tuning value the module configured', () => {
    // The fix removed behaviour, not configuration.
    expect(options.maxAttempts).toBe(2);
    expect(options.temperature).toBe(0.4);
    expect(options.maxTokens).toBe(4000);
  });

  it('is accepted by the serializer Convex actually uses', () => {
    expect(() => convexToJson(options as never)).not.toThrow();
  });
});

describe('the whole awaiting_authoring payload survives the boundary', () => {
  /** The shape `prepareQueuedWorldDaySlot` returns, at the nesting the stack trace showed. */
  const prepared = {
    kind: 'awaiting_authoring',
    slotId: 'slot-1',
    plan: {
      slot: { worldId: 'mistwood', worldDay: 5, timeSlot: 'morning' },
      groupingRunId: 'grouping-1',
      scenes: [{ sceneId: 's1', locationId: 'mistwood-mill', participantIds: ['he-jun'] }],
      options: wholeSceneOptionsFor(CONFIG),
      promptVersion: 'scene_simulation.v1',
      requestedModel: 'auto',
      fallbackModel: null,
      legalDestinationIds: { s1: ['mistwood-paper'] },
      maxConcurrentScenes: 1,
    },
    degradationLevel: 'normal',
    probe: false,
    attempt: 1,
  };

  it('serializes, which it could not before ART-194', () => {
    expect(() => convexToJson(prepared as never)).not.toThrow();
  });

  it('fails again the moment a builder is put back on the plan', () => {
    /**
     * The regression stated as a value rather than as a rule. This is exactly the object the
     * mutation used to return.
     */
    const withBuilder = {
      ...prepared,
      plan: {
        ...prepared.plan,
        options: { ...prepared.plan.options, buildSystemPrompt: selectWholeScenePrompt('scene_simulation.v1') },
      },
    };
    expect(() => convexToJson(withBuilder as never)).toThrow();
  });

  it('carries the prompt version as a string, so the authoring side can still resolve it', () => {
    expect(typeof prepared.plan.promptVersion).toBe('string');
  });
});

describe('the prompt is still resolved, just later', () => {
  it('resolves the configured version to a builder', () => {
    // The authoring side does exactly this with `plan.promptVersion`.
    expect(typeof selectWholeScenePrompt('scene_simulation.v1')).toBe('function');
  });

  it('still refuses an unregistered version, so the check moved rather than weakened', () => {
    expect(() => selectWholeScenePrompt('no_such_version'))
      .toThrow(/PROMPT_VERSION_UNKNOWN|no prompt is registered/u);
  });

  it('leaves a null version to simulateWholeScene’s own default rather than throwing', () => {
    /**
     * `selectWholeScenePrompt(null)` throws, so the authoring side spreads the option only when a
     * version is configured — preserving `options.buildSystemPrompt ?? wholeSceneSystemPrompt`,
     * which is what an unconfigured module has always got.
     */
    expect(() => selectWholeScenePrompt(null)).toThrow();
  });
});
