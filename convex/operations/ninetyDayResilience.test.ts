/**
 * NFR-007 / PRD §19.3 — ninety world days through a provider outage (ART-73).
 *
 * `longRunHarness.test.ts` runs the fixed seed at `normal` for its whole length and asks whether the
 * world is any good. That is the P0 gate and this file does not touch it. This one asks the other
 * half of ART-73's question: what survives ninety days when the model goes away in the middle of
 * them, and does the world come back.
 *
 * ## One world, three phases, one continuous Canon
 *
 * Deliberately not three fixtures. A resilience claim about an outage is a claim about the SAME
 * world before, during and after it — a fresh fixture per phase would prove only that a healthy
 * world is healthy and that a dead one is dead, which is what the ART-91 tests already showed.
 *
 *   days  0–39  provider up      the world builds forty days of Canon, arcs, episodes and recaps
 *   days 40–47  provider down    the FR-M004 ladder descends every rung and reaches `paused`
 *   days 48–89  provider up      an operator resumes; the world climbs back and runs out the run
 *
 * The ladder is IN the loop — `runDegradationLadderDays` consults the rung before each slot and
 * feeds it the outcome, which is the shape of `driveOneWorld`. So the phases above are what the
 * ladder decided, not a script: the assertions state the boundaries and the test measures where they
 * actually fell.
 *
 * ## What this gate is for
 *
 * Every assertion is about something that could be quietly untrue after an outage and that no
 * shorter run reaches: that Canon is still valid and still replays, that the public never saw an
 * empty world, that the deterministic rung committed through the same validators rather than around
 * them, that the world stopped when it said it stopped, and that it recovered on evidence.
 *
 * Gated: `ART73_NINETY_DAY=1 npm run test:ninetyday`. Roughly an hour, for the O(n²) post-commit
 * reason documented in `docs/post-commit-pipeline.md`.
 */

import { TIME_SLOTS } from '../canon/eventTypes';
import { replayWorldEvents } from '../canon/replay';
import { cloneProjection } from '../canon/snapshots';
import { DEGRADATION_LEVELS, SLOTS_BETWEEN_PROVIDER_PROBES } from '../simulation/degradation';
import { FAKE_SCENE_MODEL, FakeWholeSceneProvider } from '../simulation/fakeSceneNarrator';
import { SimulationProviderError } from '../simulation/provider';
import type {
  EmbeddingResult, LanguageModelProvider, StructuredChatRequest, StructuredChatResult,
} from '../simulation/provider';
import { serveReadModel } from '../publicRead/readModel';
import { LIVE_MODEL_KIND } from '../publicRead/liveState';
import {
  contentDigest,
  createLongRunFixture,
  mistwoodRuleContext,
  revalidateAcceptedLog,
  runDegradationLadderDays,
  seededBaseline,
  LONG_RUN_WORLD_ID,
  type LadderRunResult,
  type LongRunFixture,
} from './longRunHarness';

/** Gated for the same reason the thirty-day scenario is, and behind its OWN flag — see AC#4. */
const describeNinetyDay = process.env.ART73_NINETY_DAY === '1' ? describe : describe.skip;

const TOTAL_WORLD_DAYS = 90;
const HEALTHY_DAYS_BEFORE = 40;
const OUTAGE_FROM = HEALTHY_DAYS_BEFORE;
/**
 * Driver ticks the outage phase may spend, not world days.
 *
 * World time does NOT advance while a slot keeps failing — the driver retries one slot and
 * `claimLiveSlot` hands the same row back (ART-167) — so an outage is measured in claims, not in
 * days. Sixty is comfortably past the thirty a total outage needs to descend all five rungs, and the
 * remainder is spent being refused, which is what a paused world does.
 */
const OUTAGE_TICKS = 60;

/**
 * A provider that can be taken away and given back.
 *
 * It wraps the deterministic author rather than replacing it, so the world either gets exactly the
 * output the P0 gate measures or gets nothing at all. There is no third behaviour — an outage must
 * not produce degraded PROSE, only fewer events.
 */
class SwitchableProvider implements LanguageModelProvider {
  readonly model = FAKE_SCENE_MODEL;
  down = false;
  refusals = 0;
  private readonly inner = new FakeWholeSceneProvider();

  structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
    if (this.down) {
      this.refusals += 1;
      return Promise.reject(
        new SimulationProviderError('transient', 'LLM_NETWORK_ERROR', 'provider is unreachable'));
    }
    return this.inner.structuredChat(request);
  }

  embed(text: string): Promise<EmbeddingResult> {
    if (this.down) {
      return Promise.reject(
        new SimulationProviderError('transient', 'LLM_NETWORK_ERROR', 'provider is unreachable'));
    }
    return this.inner.embed(text);
  }
}

type Phases = {
  fixture: LongRunFixture;
  provider: SwitchableProvider;
  before: LadderRunResult;
  outage: LadderRunResult;
  after: LadderRunResult;
  /** Every slot the run executed, in world order. */
  slots: LadderRunResult['outcomes'];
  transitions: LadderRunResult['transitions'];
  /** The public live payload as it stood at the end of each phase. */
  publicBefore: unknown;
  publicDuring: unknown;
  publicAfter: unknown;
  publicVersionBefore: number;
  publicVersionDuring: number;
  /** Accepted events at the moment the ladder first refused a slot, and at the end of the outage. */
  committedAtPause: number;
  committedAfterOutage: number;
};

const livePayload = async (fixture: LongRunFixture): Promise<{ payload: unknown; version: number }> => {
  const served = await serveReadModel(
    fixture.readStore, LONG_RUN_WORLD_ID, LIVE_MODEL_KIND, `live:${LONG_RUN_WORLD_ID}`);
  if (served === null) throw new Error('NINETY_DAY_PUBLIC_READ_EMPTY');
  return { payload: served.payload, version: served.version };
};

async function runNinetyDaysThroughAnOutage(): Promise<Phases> {
  const provider = new SwitchableProvider();
  const fixture = createLongRunFixture(provider);

  const before = await runDegradationLadderDays(fixture, {
    worldDays: HEALTHY_DAYS_BEFORE, startWorldDay: 0,
  });
  const publicBeforeRead = await livePayload(fixture);

  provider.down = true;
  let committedAtPause = -1;
  const outage = await runDegradationLadderDays(fixture, {
    // Bounded in TICKS. The world advances only on the deterministic slots the ladder's lower rungs
    // complete, so how many days this phase covers is an OUTPUT, not an input.
    worldDays: TOTAL_WORLD_DAYS - OUTAGE_FROM,
    maxTicks: OUTAGE_TICKS,
    startWorldDay: before.worldDay,
    startTimeSlot: before.timeSlot,
    state: before.state,
    // The operator does NOT resume while the cause is still there. Resuming into an outage is what
    // `resumeFromPause` returning to `rules_only` rather than `normal` exists to survive, and a
    // world that resumed itself would never demonstrate rung 6 at all.
    onPaused: () => {
      if (committedAtPause < 0) committedAtPause = fixture.canon.committedEvents().length;
      return false;
    },
  });
  const publicDuringRead = await livePayload(fixture);
  const committedAfterOutage = fixture.canon.committedEvents().length;

  provider.down = false;
  const after = await runDegradationLadderDays(fixture, {
    worldDays: TOTAL_WORLD_DAYS - outage.worldDay,
    startWorldDay: outage.worldDay,
    startTimeSlot: outage.timeSlot,
    // Generous, because the climb back spends its first slots on deterministic events and one in
    // every SLOTS_BETWEEN_PROVIDER_PROBES on a probe before the world is authoring again.
    maxTicks: (TOTAL_WORLD_DAYS - outage.worldDay) * TIME_SLOTS.length + 40,
    state: outage.state,
    onPaused: () => true,
  });
  const publicAfterRead = await livePayload(fixture);

  return {
    fixture, provider, before, outage, after,
    slots: [...before.outcomes, ...outage.outcomes, ...after.outcomes],
    transitions: [...before.transitions, ...outage.transitions, ...after.transitions],
    publicBefore: publicBeforeRead.payload,
    publicDuring: publicDuringRead.payload,
    publicAfter: publicAfterRead.payload,
    publicVersionBefore: publicBeforeRead.version,
    publicVersionDuring: publicDuringRead.version,
    committedAtPause, committedAfterOutage,
  };
}

describeNinetyDay('NFR-007 ninety world days through a provider outage (ART-73)', () => {
  let run: Phases;

  beforeAll(async () => {
    run = await runNinetyDaysThroughAnOutage();
  }, 14_400_000);

  it('advances world time through all ninety world days, and accounts for every tick', () => {
    // World time is the OUTPUT. A tick that fails does not advance it — the driver retries the same
    // slot — so the run is over ticks and the ninety days are what those ticks reached.
    expect(run.after.worldDay).toBe(TOTAL_WORLD_DAYS);
    expect(run.before.worldDaysAdvanced).toBe(HEALTHY_DAYS_BEFORE);
    // Three statuses and nothing else, so a tick cannot be quietly unaccounted for.
    expect([...new Set(run.slots.map(({ status }) => status))].sort())
      .toEqual(['completed', 'failed', 'refused']);
    // Every completed tick is one slot, and together they are exactly the ninety days' slots — no
    // slot authored twice, none skipped.
    const completed = run.slots.filter(({ status }) => status === 'completed');
    expect(completed).toHaveLength(TOTAL_WORLD_DAYS * TIME_SLOTS.length);
    expect(new Set(completed.map(({ worldDay, timeSlot }) => `${worldDay}:${timeSlot}`)).size)
      .toBe(completed.length);
    // A failing slot is RETRIED, not skipped: the outage produced repeat claims of one slot, and a
    // driver that walked past a failure would show none.
    expect(run.slots.some(({ attempt }) => attempt > 1)).toBe(true);
    // The forty healthy days before the outage completed every tick: the outage is the only thing
    // this run injects, and a failure before day 40 would mean it is measuring something else.
    expect(run.before.outcomes.every(({ status, attempt }) => status === 'completed' && attempt === 1)).toBe(true);
    expect(run.before.state.level).toBe('normal');
    expect(run.before.transitions).toEqual([]);
  });

  /**
   * FR-M004 AC#1 — the ladder walked down every rung and back up every rung, in order.
   *
   * Both directions matter and each is a different guarantee: descending in order is the promise
   * that no rung is skipped, and climbing in order is the promise that a world does not get its
   * full model budget back on one success.
   */
  it('descends every rung to paused and climbs every rung back to normal', () => {
    const moves = run.transitions.map(({ fromLevel, toLevel }) => `${fromLevel}->${toLevel}`);
    expect(moves).toEqual([
      'normal->compatible_model',
      'compatible_model->fewer_scenes',
      'fewer_scenes->rules_only',
      'rules_only->deferred_summaries',
      'deferred_summaries->paused',
      'paused->rules_only',
      'rules_only->fewer_scenes',
      'fewer_scenes->compatible_model',
      'compatible_model->normal',
    ]);
    expect(run.outage.state.level).toBe('paused');
    expect(run.after.state.level).toBe('normal');
    // Every declared rung was actually occupied by a slot. A rung nothing ever ran at is a rung
    // this gate cannot speak for, and two of them were exactly that before ART-165.
    expect([...new Set(run.slots.map(({ level }) => level))].sort())
      .toEqual([...DEGRADATION_LEVELS].sort());
  });

  it('makes every transition individually traceable, and each one exactly once', () => {
    const ids = run.transitions.map(({ transitionId }) => transitionId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const transition of run.transitions) {
      expect(transition.worldId).toBe(LONG_RUN_WORLD_ID);
      expect(transition.transitionId).toContain(LONG_RUN_WORLD_ID);
      expect(['provider_failures_at_level', 'authoring_succeeded', 'operator_resume'])
        .toContain(transition.reason);
      // A descent names the code that caused it; a recovery and a resume name none.
      if (transition.reason === 'provider_failures_at_level') {
        expect(transition.triggerCode).toBe('LLM_NETWORK_ERROR');
      } else {
        expect(transition.triggerCode).toBeNull();
      }
    }
    // Exactly one operator action, at the boundary the test set: the world did not resume itself.
    const resumes = run.transitions.filter(({ reason }) => reason === 'operator_resume');
    expect(resumes).toHaveLength(1);
    expect(resumes[0].fromLevel).toBe('paused');
    expect(resumes[0].toLevel).toBe('rules_only');
  });

  /**
   * §16.3 — the public is never left without a world.
   *
   * The first draft of this asserted the payload was UNCHANGED for the whole outage, and the run
   * disagreed: a degraded world commits rules-only events, those events go through post-commit, and
   * the public read model is rebuilt from them. That is the ladder working. 「不破壞 last-known-good」
   * is not "the public freezes" — it is that the public is never handed an empty or missing world,
   * and never handed invented narration in place of the outage.
   *
   * So the three statements this makes are: the read is always servable, what it gained during the
   * outage is factual rules-only content rather than authored prose (proven by the narration test
   * below), and once the world PAUSES it stops changing — because a paused world commits nothing,
   * and the read model is rebuilt per accepted event.
   */
  it('never leaves the public without a world, and stops changing once the world pauses', () => {
    expect(run.publicBefore).toBeTruthy();
    expect(run.publicDuring).toBeTruthy();
    expect(run.publicAfter).toBeTruthy();
    // The degraded world kept the public informed rather than going silent.
    expect(run.publicVersionDuring).toBeGreaterThan(0);
    expect(run.publicDuring).not.toEqual(run.publicBefore);
    // Paused means paused: not one further event was accepted after the ladder refused a slot, so
    // not one further version could be published.
    expect(run.committedAtPause).toBeGreaterThan(0);
    expect(run.committedAfterOutage).toBe(run.committedAtPause);
    // …and the world publishes again once it authors again, so the equality above is a statement
    // about the pause rather than about a read model that stopped working.
    expect(run.publicAfter).not.toEqual(run.publicDuring);
  });

  /**
   * The world kept moving on deterministic events while it could not author, and stopped when it
   * said it had stopped.
   *
   * The exact set of eventless world days is asserted rather than a count, because "some days are
   * empty" is true of a world that broke and of a world that paused, and only one of those is this
   * run's subject.
   */
  it('commits rules-only events while degraded, and nothing at all while paused', () => {
    const accepted = run.fixture.canon.committedEvents();
    const daysWithEvents = new Set(accepted.map(({ worldDay }) => worldDay));
    const pausedDays = [...new Set(
      run.slots.filter(({ status }) => status === 'refused').map(({ worldDay }) => worldDay))].sort((a, b) => a - b);
    const emptyDays = Array.from({ length: TOTAL_WORLD_DAYS }, (_, day) => day)
      .filter((day) => !daysWithEvents.has(day));

    expect(pausedDays.length).toBeGreaterThan(0);
    /**
     * A world day is empty exactly when no slot in it completed.
     *
     * The first draft asserted the empty days were the REFUSED days, and the run disagreed: the
     * first day of the outage is also empty, because the ladder still had three provider-using
     * rungs to try and every slot at them failed. That is the ladder working as declared —
     * `FAILURES_BEFORE_ESCALATION` is deliberately not one — so the invariant is the weaker and
     * true one, and it still fails if a completed slot ever produced no Canon.
     */
    const daysWithoutCompletedSlot = Array.from({ length: TOTAL_WORLD_DAYS }, (_, day) => day)
      .filter((day) => !run.slots.some((slot) => slot.worldDay === day && slot.status === 'completed'));
    expect(emptyDays).toEqual(daysWithoutCompletedSlot);
    // Every refused day is one of them, and the refusal is why.
    for (const day of pausedDays) {
      if (run.slots.filter((slot) => slot.worldDay === day).every(({ status }) => status === 'refused')) {
        expect(emptyDays).toContain(day);
      }
    }

    // Rung 4/5 really did commit: a degraded world that silently produced nothing would leave the
    // metric below with an empty denominator and every assertion about it vacuous.
    const rulesOnly = accepted.filter((event) =>
      (event.metadata as { authoring?: string } | undefined)?.authoring === 'rules_only');
    expect(rulesOnly.length).toBeGreaterThan(0);
    expect(new Set(rulesOnly.map((event) =>
      (event.metadata as { degradationLevel?: string }).degradationLevel)))
      .toEqual(new Set(['rules_only', 'deferred_summaries']));
  });

  /**
   * FR-M004's central prohibition: no rung skips Canon Validation, Safety Validation, Idempotency or
   * Event Persistence.
   *
   * Re-validated INDEPENDENTLY here — the events are replayed from the seeded baseline and each is
   * checked against the projection as it stood before it, which is a different computation from the
   * one that admitted them. A commit path that had waved a rules-only event through would fail.
   */
  it('admitted no event at any rung that Canon would refuse', async () => {
    const accepted = run.fixture.canon.committedEvents();
    const baseline = await seededBaseline(run.fixture.canon, LONG_RUN_WORLD_ID);
    // The SAME independent re-validation `runLongRunSimulation` performs, not a second copy of it:
    // it replays from the seeded baseline, re-runs both validators against the projection as it
    // stood before each event, and separately checks sequence density and idempotency-key reuse.
    const conflicts = revalidateAcceptedLog(accepted, mistwoodRuleContext(), baseline.projection);
    // Stated with its denominator: an empty log would satisfy an emptiness check silently.
    expect(accepted.length).toBeGreaterThan(0);
    expect(conflicts).toEqual([]);
  });

  it('replays to the same world after ninety days and an outage', async () => {
    const accepted = run.fixture.canon.committedEvents();
    const baseline = await seededBaseline(run.fixture.canon, LONG_RUN_WORLD_ID);
    const replayFrom = (events: typeof accepted) => replayWorldEvents(
      cloneProjection(baseline.projection),
      events.filter((event) => event.sequenceNumber > baseline.lastSequenceNumber));

    const once = contentDigest(replayFrom(accepted));
    const twice = contentDigest(replayFrom(structuredClone(accepted)));
    expect(once).toBe(twice);
    // Sequence numbers are dense and ascending across the pause: a world that stopped and started
    // must not have left a hole, and a hole is what a resumed slot re-committing would leave.
    const sequences = accepted.map(({ sequenceNumber }) => sequenceNumber);
    expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  /**
   * An outage must not fall back to invented narration.
   *
   * The fixture's author IS the deterministic fake, so "did it fall back to the fake" cannot be
   * asked here directly — `sceneAuthorFor`'s closed two-value mode is what answers it, in
   * `worldDayLiveFunctions`. What CAN be asked, and is the same guarantee from the other side, is
   * whether any scene was narrated during the outage at all. None should be: a world that cannot
   * reach a model produces fewer events, never invented ones.
   */
  it('narrates no scene while the provider is away', () => {
    const scenesBefore = run.before.outcomes.length;
    expect(scenesBefore).toBeGreaterThan(0);
    const outageSlots = run.outage.outcomes;
    // Every slot in the outage window either failed reaching the provider, ran rules-only, or was
    // refused. None completed while using the provider.
    expect(outageSlots.filter(({ status, usedProvider }) => status === 'completed' && usedProvider))
      .toEqual([]);
    // The provider WAS asked — by the failing slots and by each probe — so the outage is a
    // measurement of refusal rather than of a world that simply stopped calling.
    expect(run.provider.refusals).toBeGreaterThan(0);
    const probes = outageSlots.filter(({ probe }) => probe);
    expect(probes.length).toBeGreaterThanOrEqual(2);
    expect(probes.every(({ status }) => status === 'failed')).toBe(true);
  });

  it('probes at the declared cadence rather than on every slot', () => {
    // A no-provider rung spends SLOTS_BETWEEN_PROVIDER_PROBES slots on deterministic events for
    // each slot it spends asking. Probing every slot would be an outage that costs full price.
    const noProvider = run.slots.filter(({ level }) => level === 'rules_only' || level === 'deferred_summaries');
    const probes = noProvider.filter(({ probe }) => probe);
    expect(noProvider.length).toBeGreaterThan(SLOTS_BETWEEN_PROVIDER_PROBES);
    expect(probes.length).toBeGreaterThan(0);
    expect(noProvider.length / probes.length).toBeGreaterThanOrEqual(SLOTS_BETWEEN_PROVIDER_PROBES);
  });

  it('recovers into a world that authors again for the rest of the run', () => {
    // The tail of the run — after the climb — is as healthy as the head. An outage that left the
    // world permanently reduced would show here and nowhere else.
    const tail = run.after.outcomes.filter(({ worldDay }) => worldDay >= run.outage.worldDay + 3);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.every(({ status, level, attempt }) =>
      status === 'completed' && level === 'normal' && attempt === 1)).toBe(true);
  });
});
