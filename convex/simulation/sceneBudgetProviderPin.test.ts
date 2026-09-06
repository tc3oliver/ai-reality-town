/**
 * The provider and the meter cannot drift apart (FR-M003 / ART-59, rearmed by ART-159).
 *
 * ## The failure this exists to prevent
 *
 * FR-M003's per-MODEL daily cap has to name a model BEFORE the call, so `createConvexBudgetPort`
 * is handed a `deploymentModelId`. If the live path authors with one model and meters another,
 * the cap meters a bucket nothing is spending from and **every other signal keeps looking
 * healthy**: slots complete, the ledger fills with granted decisions, the daily totals move, and
 * the cap simply never binds. That is the worst shape a budget bug can have.
 *
 * ## Why this file changed shape
 *
 * It used to be a SOURCE SCAN. It counted the arguments to `createWorldDayStageHandlers` in the
 * live entry point and asserted the call had exactly one — because the fake author was reached by
 * DEFAULTING, so "which provider does production use" was expressed by the absence of an argument
 * and could only be observed by reading the text of the call.
 *
 * ART-159 removed the default. The provider and the metered model id are now one value returned
 * by one function, {@link sceneAuthorFor}, and `createWorldDayStageHandlers` requires its provider
 * argument — so a binding that does not choose an author no longer compiles. The agreement that
 * needed a text scan to observe is now a property of a value, and this file asserts the value.
 *
 * That is a strictly stronger guard, and it is worth being explicit about why rather than
 * treating the rewrite as bookkeeping: a source scan can only see the one call site it was
 * pointed at, and it passes for a file that does not compile. These tests execute the decision.
 */

import { FAKE_SCENE_MODEL, FakeWholeSceneProvider } from './fakeSceneNarrator';
import { sceneAuthorFor } from './worldDayLiveFunctions';
import { createWorldDayStageHandlers } from './worldDayLive';
import { LIVE_ROUTE_CHAIN_ENV, resolveLiveSceneAuthoringModel } from './providers/liveSceneAuthor';

const LIVE_ENV = {
  LLM_API_URL: 'https://gateway.example.com/v1',
  LLM_MODEL: 'auto',
  LLM_EMBEDDING_MODEL: 'bge-m3',
  LLM_EMBEDDING_DIMENSION: '1024',
  LLM_API_KEY: 'test-key-not-a-real-credential',
};

describe('the author and the model it is metered against are chosen together', () => {
  it('the deterministic author is metered against exactly the model it reports', async () => {
    const author = sceneAuthorFor('deterministic_fake');

    expect(author.provider).toBeInstanceOf(FakeWholeSceneProvider);
    expect(await author.deploymentModelId()).toBe(FAKE_SCENE_MODEL);
    // Against the CONSTANT, not a literal, so renaming the fake author's model id cannot leave
    // this passing against a stale string.
    expect(FAKE_SCENE_MODEL).toBe('fake-whole-scene-v1');
  });

  it('the live author is metered against the route the caller resolved, never the fake', async () => {
    const author = sceneAuthorFor('preauthored', 'auto');

    // `null` is the point: this pass may not call a provider at all. If it ever returned one, a
    // Convex mutation would attempt network I/O and the split this task exists for would be
    // silently undone.
    expect(author.provider).toBeNull();
    expect(await author.deploymentModelId()).toBe('auto');
    expect(await author.deploymentModelId()).not.toBe(FAKE_SCENE_MODEL);
  });

  /**
   * The specific defect the old pin was written to catch, now reachable as behaviour.
   *
   * A live pass that could answer with SOME model id when none was resolved would key the cap on
   * a bucket the real route never spends from. Rejecting is the only honest answer, and it fails
   * the slot with a stable code rather than metering a fiction.
   */
  it('a live pass with no resolved route refuses to name a model rather than inventing one', async () => {
    const author = sceneAuthorFor('preauthored');

    await expect(author.deploymentModelId()).rejects.toThrow('LIVE_DEPLOYMENT_MODEL_NOT_SUPPLIED');
  });

  it('the two modes never agree on a model, so one cannot stand in for the other', async () => {
    const fake = await sceneAuthorFor('deterministic_fake').deploymentModelId();
    const live = await sceneAuthorFor('preauthored', 'gemini-2.5-flash').deploymentModelId();

    expect(fake).not.toBe(live);
  });
});

describe('the live meter keys on the route that will actually be called', () => {
  it('uses the configured chat model when no chain is configured', () => {
    expect(resolveLiveSceneAuthoringModel(LIVE_ENV)).toBe('auto');
  });

  it('uses the FIRST route of the chain when one is configured, not LLM_MODEL', () => {
    // The chain overrides which route is tried first, so metering `LLM_MODEL` here would key the
    // reservation on a route the call never reaches.
    expect(resolveLiveSceneAuthoringModel({
      ...LIVE_ENV, [LIVE_ROUTE_CHAIN_ENV]: 'gemini-2.5-flash, auto',
    })).toBe('gemini-2.5-flash');
  });

  it('refuses to resolve a model at all when the deployment is not configured', () => {
    // A misconfigured deployment must fail before a slot is claimed, not after its scenes are
    // authored — hence a throw here rather than a fallback to some default id.
    expect(() => resolveLiveSceneAuthoringModel({})).toThrow();
  });
});

describe('no binding can select an author by saying nothing', () => {
  /**
   * The compiler is the guard now, and this records WHY, so a future change that restores a
   * default parameter has to argue with a stated reason rather than an absence.
   *
   * `createWorldDayStageHandlers.length` counts parameters before the first defaulted one. Two
   * means both the port and the provider are required; if a default were reintroduced for the
   * provider it would drop to one, and production would be able to pick the fake author by
   * omission exactly as it used to.
   */
  it('createWorldDayStageHandlers requires its provider argument', () => {
    expect(createWorldDayStageHandlers).toHaveLength(2);
  });
});
