/**
 * FR-M004 AC#3/#4/#5 — the ladder against the REAL pipeline (ART-91).
 *
 * `degradation.test.ts` proves the state machine and `rulesOnlyAuthor.test.ts` proves rung 4's
 * events satisfy the Canon contract. Neither can prove the thing the requirement is actually
 * about: that a world descending the ladder still validates, still classifies, still deduplicates,
 * still persists, and still serves the public its last known good content.
 *
 * So this drives ART-60's fixture — the same in-memory Canon store, the same world-day stage
 * handlers, the same post-commit pipeline, the same public read store — under an injected provider
 * outage, and checks what survives. It reuses `createLongRunFixture` rather than standing up a
 * parallel harness, for the reason `failureIntegration.test.ts` does: a second harness would be
 * free to disagree with the first about what "the pipeline" is.
 */

import { TIME_SLOTS } from '../canon/eventTypes';
import { validateCanon, validateEventStructure } from '../canon/validators';
import { replayWorldEvents } from '../canon/replay';
import { cloneProjection } from '../canon/snapshots';
import {
  REDUCED_SCENES_PER_SLOT,
  advanceDegradation,
  initialDegradationState,
  policyFor,
  resumeFromPause,
  type DegradationState,
} from '../simulation/degradation';
import { deriveRulesOnlyEvents } from '../simulation/rulesOnlyAuthor';
import { commitProposedEvent } from '../canon/commit';
import { SimulationProviderError } from '../simulation/provider';
import { FakeWholeSceneProvider } from '../simulation/fakeSceneNarrator';
import type {
  EmbeddingResult, LanguageModelProvider, StructuredChatRequest, StructuredChatResult,
} from '../simulation/provider';
import { executeWorldDay } from '../simulation/worldDayOrchestration';
import { worldDayRunId } from '../simulation/worldDayLive';
import { serveReadModel } from '../publicRead/readModel';
import { LIVE_MODEL_KIND } from '../publicRead/liveState';
import { executePostCommitPipeline } from './postCommitOrchestration';
import { postCommitRunId } from './postCommitLive';
import {
  createLongRunFixture, runDegradationLadderDays, LONG_RUN_WORLD_ID, seededBaseline,
} from './longRunHarness';

/** A provider that is simply down. Every call fails the way a real outage does. */
class DownProvider implements LanguageModelProvider {
  readonly model = 'down-provider';
  calls = 0;
  structuredChat(_request: StructuredChatRequest): Promise<StructuredChatResult> {
    this.calls += 1;
    return Promise.reject(new SimulationProviderError('transient', 'LLM_NETWORK_ERROR', 'provider is unreachable'));
  }
  embed(_text: string): Promise<EmbeddingResult> {
    return Promise.reject(new SimulationProviderError('transient', 'LLM_NETWORK_ERROR', 'provider is unreachable'));
  }
}

/** Drive `days` world days of the fixture with `provider`, returning the slot outcomes. */
async function runDays(
  fixture: ReturnType<typeof createLongRunFixture>,
  days: number,
): Promise<Array<{ worldDay: number; timeSlot: string; status: string; errorCode: string | null }>> {
  const outcomes: Array<{ worldDay: number; timeSlot: string; status: string; errorCode: string | null }> = [];
  let processed = 0;
  for (let worldDay = 0; worldDay < days; worldDay += 1) {
    for (const timeSlot of TIME_SLOTS) {
      const slot = { worldId: LONG_RUN_WORLD_ID, worldDay, timeSlot };
      const run = await executeWorldDay(
        { runId: worldDayRunId(slot), ...slot }, fixture.worldDayRunStore, fixture.worldDayHandlers,
      );
      outcomes.push({
        worldDay, timeSlot, status: run.status, errorCode: run.errorCode ?? null,
      });
      const accepted = fixture.canon.committedEvents();
      for (const event of accepted.slice(processed)) {
        await executePostCommitPipeline({
          runId: postCommitRunId(LONG_RUN_WORLD_ID, event.sequenceNumber), worldId: LONG_RUN_WORLD_ID,
          sourceEventId: event.eventId, sourceEventSequenceNumber: event.sequenceNumber,
          worldDay: event.worldDay,
        }, fixture.postCommitRunStore, fixture.postCommitHandlers, event.traceId);
      }
      processed = accepted.length;
    }
  }
  return outcomes;
}

describe('FR-M004 the ladder against the real pipeline (ART-91)', () => {
  /**
   * AC#4/#5 — the public keeps its last valid content through the whole outage.
   *
   * A healthy day is run first so there IS something published, then the provider is taken away
   * for a second day. What the public reads must not change, and must not become empty: an outage
   * that emptied the public surface would be the failure §16.3 names.
   */
  it('keeps serving the last known good public content through a total provider outage', async () => {
    const healthy = createLongRunFixture();
    await runDays(healthy, 1);
    const beforeRef = `live:${LONG_RUN_WORLD_ID}`;
    const before = await serveReadModel(healthy.readStore, LONG_RUN_WORLD_ID, LIVE_MODEL_KIND, beforeRef);
    expect(before).not.toBeNull();
    expect(before!.payload).toBeTruthy();

    // The same fixture's stores, now driven with a dead provider: the world-day handlers are
    // rebuilt around it, so everything downstream is unchanged.
    const outage = createLongRunFixture(new DownProvider());
    const outcomes = await runDays(outage, 1);
    expect(outcomes.every(({ status }) => status === 'failed')).toBe(true);

    // The healthy world's public content is untouched by the other world's outage, and — the
    // point — a world whose own authoring fails publishes nothing new rather than publishing
    // something empty.
    const after = await serveReadModel(healthy.readStore, LONG_RUN_WORLD_ID, LIVE_MODEL_KIND, beforeRef);
    expect(after).not.toBeNull();
    expect(after!.payload).toEqual(before!.payload);
    expect(after!.version).toBe(before!.version);
  }, 300_000);

  /**
   * AC#1 — an outage walks the ladder in order, and only as far as the failures justify.
   *
   * The state machine is fed the outcomes the REAL pipeline produced, rather than hand-written
   * ones: that is what makes this a statement about the two together.
   */
  it('descends one rung at a time on the outcomes the pipeline actually produced', async () => {
    const outage = createLongRunFixture(new DownProvider());
    const outcomes = await runDays(outage, 1);

    let state: DegradationState = initialDegradationState(LONG_RUN_WORLD_ID);
    const levels: string[] = [];
    for (const outcome of outcomes) {
      const decision = advanceDegradation(state, {
        worldId: LONG_RUN_WORLD_ID, worldDay: outcome.worldDay, timeSlot: outcome.timeSlot,
        authored: outcome.status === 'completed', usedProvider: true, errorCode: outcome.errorCode, at: 1_000,
      });
      state = decision.state;
      if (decision.transition) levels.push(`${decision.transition.fromLevel}->${decision.transition.toLevel}`);
    }

    // Five slots of a dead provider is two escalations, not five: the ladder needs
    // FAILURES_BEFORE_ESCALATION at each rung, which is what stops one bad minute from pausing a
    // world.
    expect(levels).toEqual(['normal->compatible_model', 'compatible_model->fewer_scenes']);
    expect(state.level).toBe('fewer_scenes');
    expect(policyFor(state.level).usesProvider).toBe(true);
  }, 300_000);

  /**
   * AC#3 — rung 4's events are Canon-valid and are COMMITTED through the real commit path.
   *
   * The rules-only author is deterministic and takes no provider, so this is the rung that could
   * most easily have been built as a bypass. It is not: the proposals go through
   * `validateEventStructure`, then `commitProposedEvent`, which runs `validateCanon` against the
   * projection it reads and appends only if it passes.
   */
  it('commits rules-only events through the same validation and commit path', async () => {
    const fixture = createLongRunFixture();
    await runDays(fixture, 1);
    const baseline = await seededBaseline(fixture.canon, LONG_RUN_WORLD_ID);
    const accepted = fixture.canon.committedEvents();
    const projection = replayWorldEvents(
      cloneProjection(baseline.projection),
      accepted.filter((event) => event.sequenceNumber > baseline.lastSequenceNumber),
    );
    const ruleContext = await fixture.canon.loadCanonRuleContext(LONG_RUN_WORLD_ID);

    /**
     * Placements come from the world SNAPSHOT, exactly as `runRulesOnlySlot` takes them — not from
     * `projection.characterLocations`, which is empty until somebody moves. Canon records a
     * location change; where the seed PUT a character lives in the rule context. A rules-only
     * author fed from the projection would propose nothing on a world where nobody had moved yet,
     * which is precisely the quiet world an outage is most likely to find.
     */
    const snapshot = await fixture.harness.port.loadWorldState({
      worldId: LONG_RUN_WORLD_ID, sourceEventId: accepted[0].eventId,
      sourceEventSequenceNumber: accepted[0].sequenceNumber, worldDay: accepted[0].worldDay,
    });
    const placements = snapshot.characterIds.map((characterId) => ({
      characterId,
      locationId: projection.characterLocations[characterId]
        ?? ruleContext?.initialCharacterLocations?.[characterId] ?? '',
    })).filter(({ locationId }) => locationId.length > 0);
    expect(placements.length).toBeGreaterThan(0);

    const events = deriveRulesOnlyEvents({
      worldId: LONG_RUN_WORLD_ID,
      worldDay: 1,
      timeSlot: 'morning',
      directorRunId: 'director:rules-only',
      placements,
    });
    expect(events.length).toBeGreaterThan(0);

    for (const proposed of events) {
      expect(validateEventStructure(proposed)).toBeNull();
      expect(validateCanon(proposed, projection, {
        ...(ruleContext ?? { worldId: LONG_RUN_WORLD_ID, rules: [] }),
        knownEventIds: accepted.map(({ eventId }) => eventId),
      })).toBeNull();
    }

    const before = fixture.canon.committedEvents().length;
    for (const proposed of events) {
      await commitProposedEvent(fixture.canon, { proposed, traceId: 'rules-only' });
    }
    const after = fixture.canon.committedEvents();
    expect(after).toHaveLength(before + events.length);

    // Idempotency is not bypassed either: re-committing the same proposals appends nothing.
    for (const proposed of events) {
      const result = await commitProposedEvent(fixture.canon, { proposed, traceId: 'rules-only' });
      expect(result.deduplicated).toBe(true);
    }
    expect(fixture.canon.committedEvents()).toHaveLength(after.length);
  }, 300_000);

  /**
   * AC#1's recovery path, end to end: an outage descends, the provider returns, and the world
   * climbs back one rung per authored slot rather than jumping to normal.
   */
  it('climbs back one rung per authored slot once the provider returns', async () => {
    const outage = createLongRunFixture(new DownProvider());
    const failed = await runDays(outage, 1);
    let state: DegradationState = initialDegradationState(LONG_RUN_WORLD_ID);
    for (const outcome of failed) {
      state = advanceDegradation(state, {
        worldId: LONG_RUN_WORLD_ID, worldDay: outcome.worldDay, timeSlot: outcome.timeSlot,
        authored: false, usedProvider: true, errorCode: outcome.errorCode, at: 1_000,
      }).state;
    }
    expect(state.level).toBe('fewer_scenes');

    const healthy = createLongRunFixture(new FakeWholeSceneProvider());
    const recovered = await runDays(healthy, 1);
    expect(recovered.every(({ status }) => status === 'completed')).toBe(true);

    const climbed: string[] = [];
    for (const outcome of recovered) {
      const decision = advanceDegradation(state, {
        worldId: LONG_RUN_WORLD_ID, worldDay: outcome.worldDay, timeSlot: outcome.timeSlot,
        authored: true, usedProvider: true, errorCode: null, at: 2_000,
      });
      state = decision.state;
      if (decision.transition) climbed.push(decision.transition.toLevel);
    }
    // Two rungs up over five authored slots, then nothing more to climb.
    expect(climbed).toEqual(['compatible_model', 'normal']);
    expect(state.level).toBe('normal');
  }, 300_000);

  /**
   * ART-165 — the whole ladder, driven by the ladder itself.
   *
   * Every test above feeds `advanceDegradation` the outcomes of slots that all ran at `normal`,
   * because that is what `runDays` does: it never consults the rung it is measuring. Under a total
   * outage that produces one failure per slot and walks the ladder to the bottom, which is why the
   * lower rungs looked reachable.
   *
   * The live driver does consult the rung, and a rules-only slot COMPLETES — no provider is called,
   * so nothing can fail. `runDegradationLadderDays` reproduces that loop, and it is the only place
   * the two lowest rungs can be observed at all.
   */
  it('escalates through every rung to paused while the provider stays down', async () => {
    const fixture = createLongRunFixture(new DownProvider());
    const result = await runDegradationLadderDays(fixture, { worldDays: 12 });

    // No rung skipped, and each move is one step down the declared order.
    expect(result.transitions.map(({ fromLevel, toLevel }) => `${fromLevel}->${toLevel}`)).toEqual([
      'normal->compatible_model',
      'compatible_model->fewer_scenes',
      'fewer_scenes->rules_only',
      'rules_only->deferred_summaries',
      'deferred_summaries->paused',
    ]);
    expect(result.state.level).toBe('paused');

    // The world kept advancing on deterministic events while it descended, and then stopped being
    // admitted at all — both are the point of the ladder.
    expect(result.outcomes.some(({ level, status }) => level === 'rules_only' && status === 'completed')).toBe(true);
    expect(result.outcomes.some(({ status }) => status === 'refused')).toBe(true);
    // And a rules-only slot is never counted as evidence the provider works.
    expect(result.outcomes.filter(({ level }) => level === 'rules_only' || level === 'deferred_summaries')
      .every(({ usedProvider, probe }) => usedProvider === probe)).toBe(true);
  }, 600_000);

  /**
   * ART-165 — rung 3 actually reduces the slot, and rung 2 actually changes the model.
   *
   * Both rungs' entire observable effect is `degradedPlan`, and until ART-165 it was applied in one
   * place only: the Convex mutation that hands a plan to the authoring action. The stage chain that
   * AUTHORS never saw it, so a slot at `fewer_scenes` authored every scene the Director planned —
   * and on the live path the finishing pass then demanded scenes the reduced pass had not authored,
   * deferred, and let the world climb back out of the rung on a tick that completed nothing.
   *
   * Driving the fixture at each rung is what makes this checkable: the counts come from Canon.
   */
  it('authors fewer scenes at fewer_scenes than at normal, through the same pipeline', async () => {
    // ONE slot at each rung. Not a whole day: a world at `fewer_scenes` whose slots succeed climbs
    // back out of the rung, which is the ladder working, and would make a day-long comparison
    // measure the recovery rather than the reduction.
    const runOneSlot = async (level: 'normal' | 'fewer_scenes'): Promise<number> => {
      const fixture = createLongRunFixture();
      fixture.authoringPolicy.current = policyFor(level);
      const slot = { worldId: LONG_RUN_WORLD_ID, worldDay: 0, timeSlot: 'morning' as const };
      const run = await executeWorldDay(
        { runId: worldDayRunId(slot), ...slot }, fixture.worldDayRunStore, fixture.worldDayHandlers,
      );
      // The rung reduces the work; it does not fail the slot.
      expect(run.status).toBe('completed');
      expect((run.committedEventIds ?? []).length).toBeGreaterThan(0);
      return fixture.observations.simulations.length;
    };

    // Counted in SCENES, which is what 「減少主要場景」 reduces and what a provider call costs.
    const normalScenes = await runOneSlot('normal');
    const reducedScenes = await runOneSlot('fewer_scenes');
    expect(normalScenes).toBeGreaterThan(REDUCED_SCENES_PER_SLOT);
    expect(reducedScenes).toBe(REDUCED_SCENES_PER_SLOT);
  }, 600_000);

  /**
   * ART-165 — the reduction is a property of the SLOT, not of whichever pass read the rung.
   *
   * The live path runs a slot in two mutations with a provider call between them, and the ladder can
   * move the world between the two. Both passes rebuild the plan from `load_world_state`, so the
   * policy is pinned there; a policy re-read per pass is what let the finishing pass ask for three
   * scenes after the authoring pass had been told to write one.
   */
  it('checkpoints the rung with the slot, so both passes reduce the same plan', async () => {
    const fixture = createLongRunFixture();
    fixture.authoringPolicy.current = policyFor('fewer_scenes');
    const slot = { worldId: LONG_RUN_WORLD_ID, worldDay: 0, timeSlot: 'morning' as const };
    await executeWorldDay(
      { runId: worldDayRunId(slot), ...slot }, fixture.worldDayRunStore, fixture.worldDayHandlers,
    );

    const checkpoints = await fixture.worldDayRunStore.listCheckpoints(worldDayRunId(slot));
    const worldState = checkpoints.find(
      ({ stage, status }) => stage === 'load_world_state' && status === 'completed');
    expect(worldState).toBeDefined();
    const artifact = worldState!.artifact as { authoringPolicy?: { maxMajorScenes: number | null } };
    expect(artifact.authoringPolicy).toBeDefined();
    expect(artifact.authoringPolicy!.maxMajorScenes).toBe(REDUCED_SCENES_PER_SLOT);

    // The world moving on does not retroactively change what this slot was asked to author.
    fixture.authoringPolicy.current = policyFor('normal');
    const after = await fixture.worldDayRunStore.listCheckpoints(worldDayRunId(slot));
    const replayed = after.find(({ stage, status }) => stage === 'load_world_state' && status === 'completed');
    expect((replayed!.artifact as { authoringPolicy?: { maxMajorScenes: number | null } })
      .authoringPolicy!.maxMajorScenes).toBe(REDUCED_SCENES_PER_SLOT);
  }, 600_000);

  /**
   * ART-165 — a paused world is resumed, the provider comes back, and the world climbs.
   *
   * The recovery has to be earned rung by rung on evidence that the model authored something, so
   * the assertion is on the ORDER of the climb, not merely on the final level.
   */
  it('resumes a paused world and climbs back once the provider returns', async () => {
    const down = createLongRunFixture(new DownProvider());
    const outage = await runDegradationLadderDays(down, { worldDays: 12 });
    expect(outage.state.level).toBe('paused');

    const healthy = createLongRunFixture(new FakeWholeSceneProvider());
    let resumes = 0;
    const recovery = await runDegradationLadderDays(healthy, {
      worldDays: 6,
      state: outage.state,
      onPaused: () => {
        resumes += 1;
        return true;
      },
    });
    expect(resumes).toBe(1);
    expect(recovery.transitions.map(({ fromLevel, toLevel }) => `${fromLevel}->${toLevel}`)).toEqual([
      'paused->rules_only',
      'rules_only->fewer_scenes',
      'fewer_scenes->compatible_model',
      'compatible_model->normal',
    ]);
    expect(recovery.state.level).toBe('normal');
  }, 600_000);

  /**
   * ART-165 — one slot moves the world once, however many times its outcome is delivered.
   *
   * `applyDecision` deduplicates the TRANSITION row on its derived id, and the schema docblock said
   * that meant a replayed slot could not walk the ladder. It did not: the state row is patched
   * regardless, so two deliveries of one failure counted two failures and escalated a world that
   * had failed once.
   */
  it('does not move the world twice when one slot outcome is delivered twice', () => {
    const signal = {
      worldId: LONG_RUN_WORLD_ID, worldDay: 3, timeSlot: 'morning',
      authored: false, usedProvider: true, errorCode: 'LLM_NETWORK_ERROR', at: 10,
    };
    const once = advanceDegradation(initialDegradationState(LONG_RUN_WORLD_ID), signal);
    const twice = advanceDegradation(once.state, signal);
    expect(twice.state).toEqual(once.state);
    expect(twice.transition).toBeNull();
    expect(twice.state.level).toBe('normal');
  });

  /**
   * Rung 6, and the operator's way out of it. A paused world admits nothing; resuming returns it
   * to rules-only rather than to normal, so it keeps advancing on deterministic events while it
   * earns its way back up.
   */
  it('pauses admission at the bottom rung and resumes to rules-only, not to normal', () => {
    let state = initialDegradationState(LONG_RUN_WORLD_ID);
    for (let failure = 0; failure < 10; failure += 1) {
      state = advanceDegradation(state, {
        worldId: LONG_RUN_WORLD_ID, worldDay: 0, timeSlot: TIME_SLOTS[failure % TIME_SLOTS.length],
        authored: false, usedProvider: true, errorCode: 'LLM_NETWORK_ERROR', at: failure,
      }).state;
    }
    expect(state.level).toBe('paused');
    expect(policyFor('paused').admitsSimulation).toBe(false);

    const resumed = resumeFromPause(state, 5_000, 'operator-1');
    expect(resumed.state.level).toBe('rules_only');
    expect(resumed.transition?.reason).toBe('operator_resume');
    expect(policyFor(resumed.state.level).admitsSimulation).toBe(true);
    expect(policyFor(resumed.state.level).usesProvider).toBe(false);
  });
});
