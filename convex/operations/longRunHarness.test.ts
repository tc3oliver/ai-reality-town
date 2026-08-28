/**
 * NFR-007 / PRD Section 19.3 — fixed-seed long-run verification.
 *
 * Every assertion below reads a field of {@link LongRunFindings}; nothing is judged by eye.
 *
 * The 7-day scenario runs in the normal suite (~6 s). The 30-day scenario takes ~5 minutes
 * because each of the 450 accepted events drives a full post-commit pipeline whose public
 * read-model rebuilds replay the whole log (the O(n²) cost documented in
 * `docs/post-commit-pipeline.md`), so it is gated behind `ART60_LONG_RUN=1` and exposed as
 * `npm run test:longrun`. Both scenarios share one harness and one seed.
 */

import { TIME_SLOTS } from '../canon/eventTypes';
import { MAX_MAJOR_ACTIVE_ARCS } from '../story/portfolio';
import { ARC_STAGNATION_WORLD_DAYS } from '../story/resolution';
import { FAKE_SCENE_MODEL } from '../simulation/fakeSceneNarrator';
import {
  contentDigest,
  runLongRunSimulation,
  LONG_RUN_FIXTURE_ID,
  LONG_RUN_WORLD_ID,
  MAX_SLOTS_WITHOUT_APPEARANCE,
  type LongRunFindings,
} from './longRunHarness';

const SEVEN_DAY_SLOTS = 7 * TIME_SLOTS.length;
const THIRTY_DAY_SLOTS = 30 * TIME_SLOTS.length;

/**
 * Characters the fixed seed places alone at a location.
 *
 * ART-60 found that the live Director only planned scenes at locations holding two or more
 * characters and that no committed scene ever moved anyone, so these five were never cast in
 * 30 world days. ART-101 fixed the live candidate generator; they are kept named here
 * because they are the exact population the regression would reappear in.
 */
const FORMERLY_STARVED_CHARACTER_IDS = ['lin-yingxue', 'su-meizhen', 'luo-shan', 'tang-ruoxi', 'wu-zhen'];

/**
 * Distinct scene texts the fake author can produce over this seed's cast and locations.
 * Measured, not chosen: both the 7-day and the 30-day run land on exactly this many.
 */
const DISTINCT_SCENE_TEXTS = 32;

/** Asserts every NFR-007 property that the fixed seed satisfies cleanly. */
function expectCleanRun(findings: LongRunFindings, worldDays: number): void {
  const slots = worldDays * TIME_SLOTS.length;

  // Section 16.2 — completion rate.
  expect(findings.slotsExecuted).toBe(slots);
  expect(findings.slotsCompleted).toBe(slots);
  expect(findings.completionRate).toBe(1);
  expect(findings.slots.every(({ status }) => status === 'completed')).toBe(true);

  // Canon conflicts — including an independent re-validation of every accepted event, so a
  // validation error swallowed inside the pipeline would still surface here.
  expect(findings.canonConflicts).toEqual([]);

  // Replay consistency (ART-17).
  expect(findings.replay.acceptedEvents).toBe(findings.acceptedEvents);
  expect(findings.replay.equal).toBe(true);
  expect(findings.replay.deterministic).toBe(true);
  expect(findings.replay.replayedDigest).toBe(findings.replay.liveDigest);

  // Arc limits, progress and resolution (FR-F003/FR-F004, ART-31).
  expect(findings.arcs.maxActiveMajorArcs).toBeLessThanOrEqual(MAX_MAJOR_ACTIVE_ARCS);
  expect(findings.arcs.overLimitWorldDays).toEqual([]);
  expect(findings.arcs.arcsWithoutProgress).toEqual([]);
  expect(findings.arcs.stagnantArcs).toEqual([]);
  expect(findings.arcs.stagnationThresholdWorldDays).toBe(ARC_STAGNATION_WORLD_DAYS);
  expect(findings.arcs.totalArcs).toBeGreaterThan(0);

  // Section 5.1 / AC#7 — every world day produced canon and exactly one non-empty episode.
  expect(findings.recapCoverage.worldDaysWithoutAcceptedEvent).toEqual([]);
  expect(findings.recapCoverage.completedWorldDays).toBe(worldDays);
  expect(findings.recapCoverage.episodes).toBe(worldDays);
  expect(findings.recapCoverage.worldDaysWithoutEpisode).toEqual([]);
  expect(findings.recapCoverage.emptyEpisodes).toEqual([]);
  // FR-G004 (ART-35) found no coverage gap and no spoiler in any released episode.
  expect(findings.recapCoverage.coverageFindings).toEqual([]);
  expect(findings.recapCoverage.recapTypes).toEqual(['episode', 'viewer_context']);

  // Token accounting: wired, internally sane, and honestly scoped to the fake provider.
  expect(findings.tokens.providers).toEqual(['fake']);
  expect(findings.tokens.models).toEqual([FAKE_SCENE_MODEL]);
  expect(findings.tokens.traces).toBe(findings.repetition.scenes);
  expect(findings.tokens.anomalies).toEqual([]);
  expect(findings.tokens.retries).toBe(0);
  expect(findings.tokens.realProviderSpendChecked).toBe(false);

  // FR-C002 character appearance (ART-101). Nobody is missing from the whole run and nobody
  // crosses the neglect ceiling, and the reason is visible: the run actually relocates the
  // characters the seed strands, so an isolated resident becomes castable with others.
  expect(findings.appearance.characterIds).toHaveLength(12);
  expect(findings.appearance.neverAppeared).toEqual([]);
  expect(findings.appearance.threshold).toBe(MAX_SLOTS_WITHOUT_APPEARANCE);
  expect(findings.appearance.maxSlotsSinceMajorAppearance).toBeLessThanOrEqual(MAX_SLOTS_WITHOUT_APPEARANCE);
  expect(findings.appearance.violations).toEqual([]);
  expect(findings.appearance.relocations).toBeGreaterThan(0);
  expect(findings.appearance.relocatedCharacterIds)
    .toEqual([...FORMERLY_STARVED_CHARACTER_IDS].sort((left, right) => left.localeCompare(right)));

  // Safety (ART-54/55): classification ran for every scene and every episode, and no
  // committed event came from an unclassified or withheld scene.
  expect(findings.safety.scenesSimulated).toBe(findings.repetition.scenes);
  expect(findings.safety.scenesWithoutClassification).toEqual([]);
  expect(findings.safety.policyVersions).toEqual([1]);
  expect(findings.safety.eventsBypassingSafety).toEqual([]);
  expect(findings.safety.episodes).toBe(worldDays);
  expect(findings.safety.episodesWithoutClassification).toEqual([]);
}

/**
 * Asserts the gaps the fixed seed still exposes. These are findings the harness must keep
 * reporting: if one of them changes, the live pipeline's behaviour changed and the finding
 * has to be re-triaged rather than silently absorbed.
 *
 * ART-60's third finding — character starvation — was fixed by ART-101 and moved into
 * {@link expectCleanRun}, where it is now asserted as a property instead of a defect.
 */
function expectKnownFindings(findings: LongRunFindings, worldDays: number): void {
  // FINDING 1 — arc lockstep. Every event carries the same importance under the fake
  // author, so all three major arcs are opened and advanced together and the active-family
  // count dips to zero on the changeover day, one world day in five. The portfolio itself
  // never leaves the FR-F003 1–3 band.
  expect(findings.arcs.unresolvedMajorByWorldDay.every((count) => count >= 1 && count <= MAX_MAJOR_ACTIVE_ARCS)).toBe(true);
  expect(findings.arcs.worldDaysWithoutActiveMajorArc)
    .toEqual(Array.from({ length: Math.ceil(worldDays / 5) }, (_, index) => index * 5));
  expect(findings.arcs.activeMajorByWorldDay.filter((count) => count > 0).every((count) => count === MAX_MAJOR_ACTIVE_ARCS)).toBe(true);

  // FINDING 2 — content repetition. The fake author's template output space still collapses
  // the run onto a small set of distinct scene texts. ART-101's un-stranded cast widened it
  // from twelve to thirty-two (30-day duplicate rate 97.3% → 92.9%), which is an improvement
  // but not a fix: the remaining duplication is the no-cost author, not the Director, and is
  // deferred to the ART-72 provider.
  expect(findings.repetition.distinctContentDigests).toBe(DISTINCT_SCENE_TEXTS);
  expect(findings.repetition.duplicateScenes).toBe(findings.repetition.scenes - DISTINCT_SCENE_TEXTS);
  expect(findings.repetition.duplicateGroups.length).toBeGreaterThan(0);
  // Every duplicate group is a repeat of one of those texts; nothing is unaccounted for.
  expect(findings.repetition.duplicateGroups.reduce((total, { sceneIds }) => total + sceneIds.length, 0))
    .toBe(findings.repetition.scenes - (DISTINCT_SCENE_TEXTS - findings.repetition.duplicateGroups.length));
}

describe('NFR-007 fixed-seed 7-day simulation (AC#1/#3)', () => {
  let findings: LongRunFindings;

  beforeAll(async () => {
    findings = await runLongRunSimulation({ worldDays: 7 });
  }, 300_000);

  it('runs the fixed seed with no credentials and no network provider (AC#3)', () => {
    expect(findings.seed).toEqual({
      worldId: LONG_RUN_WORLD_ID,
      fixtureId: LONG_RUN_FIXTURE_ID,
      providerModel: FAKE_SCENE_MODEL,
      startWorldDay: 0,
      worldDays: 7,
      timeSlotsPerWorldDay: TIME_SLOTS.length,
    });
    expect(findings.tokens.providers).toEqual(['fake']);
  });

  it('completes reproducibly: the same seed yields a byte-identical report (AC#1)', async () => {
    const repeat = await runLongRunSimulation({ worldDays: 7 });
    expect(repeat.digest).toBe(findings.digest);
    expect(repeat).toEqual(findings);
    // The digest really is a function of the findings, not a constant.
    expect(findings.digest).toBe(contentDigest({ ...findings, digest: undefined }));
  }, 300_000);

  it('emits machine-readable findings for every Section 19.3 question (AC#1)', () => {
    expect(findings.schemaVersion).toBe(1);
    expect(Object.keys(findings).sort()).toEqual([
      'acceptedEvents', 'appearance', 'arcs', 'canonConflicts', 'completionRate', 'digest',
      'recapCoverage', 'repetition', 'replay',
      // FR-M003 §16.3 (ART-59): the resource report the run's own budget accountant produced.
      'resources',
      'safety', 'schemaVersion', 'seed', 'slots',
      'slotsCompleted', 'slotsExecuted', 'tokens',
    ]);
    expect(findings.slots).toHaveLength(SEVEN_DAY_SLOTS);
  });

  it('passes every clean Section 19.3 check', () => {
    expectCleanRun(findings, 7);
    // 104, not 3 × 35: in one slot a relocated character's Intent merges into the residents'
    // Scene at their destination, so that slot commits two events instead of three.
    expect(findings.acceptedEvents).toBe(104);
  });

  it('reports the gaps the fixed seed exposes instead of hiding them', () => {
    expectKnownFindings(findings, 7);
  });

  /**
   * FR-M003 / PRD §16.3 (ART-59 AC#3/#4/#5).
   *
   * This is the repository's only measured-over-a-real-run evidence for the two §16.3 ratios, and
   * both are ratios, so both can be made vacuous by an empty sample. Every assertion below states
   * its denominator before it states its threshold.
   *
   * The run is enforced by the SAME accountant production uses, under the unlimited default
   * policy — so these numbers describe the pipeline, not the budget. `tokenBudgetEnforcement.test.ts`
   * drives the same fixture against real limits.
   */
  describe('FR-M003 §16.3 resource measurement (ART-59)', () => {
    it('AC#3 — measures the run: settled tokens, granted calls, no refusals', () => {
      // The denominator, asserted first. Everything below is a statement about a non-empty sample.
      expect(findings.resources.totalTokens).toBeGreaterThan(0);
      expect(findings.resources.grantedCalls).toBe(findings.repetition.scenes);
      expect(findings.resources.refusedCalls).toBe(0);
      expect(findings.resources.worldDays).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(findings.resources.tokensByWorldDay).toHaveLength(7);
      expect(findings.resources.tokensByWorldDay.every(({ tokens }) => tokens > 0)).toBe(true);
    });

    it('AC#3 — the accountant and the provider traces agree on what was spent', () => {
      // Two independent records of the same run: `tokens` is derived from the scene results the
      // simulation stage observed, `resources` from the counters the ENFORCEMENT path settled.
      // A gate that saw a different set of calls from the one that ran would show up here.
      expect(findings.resources.totalTokens)
        .toBe(findings.tokens.totalInputTokens + findings.tokens.totalOutputTokens);
    });

    it('AC#4 — retry tokens stay under 10% of a NON-EMPTY total', () => {
      expect(findings.resources.totalTokens).toBeGreaterThan(0);
      expect(findings.resources.retryTokenShare).not.toBeNull();
      expect(findings.resources.retryTokenShareThreshold).toBe(0.1);
      expect(findings.resources.retryTokenShare!)
        .toBeLessThanOrEqual(findings.resources.retryTokenShareThreshold);
      expect(findings.resources.retryTokenShareCompliant).toBe(true);
      // Honest about WHY it passes: the deterministic author never fails, so this run's numerator
      // is zero. A run whose numerator is positive is measured in
      // `tokenBudgetEnforcement.test.ts` under an injected transient provider failure, and the
      // enforceable ceiling is proven there and in `tokenBudget.test.ts`.
      expect(findings.resources.retryTokens).toBe(0);
      expect(findings.resources.retryTokenShareEnforced).toBe(false);
    });

    it('AC#5 — the fast-model routing share is UNMEASURABLE here, and says so', () => {
      // The honest answer, not a fabricated one. Every LLM call on this path is a Director MAJOR
      // scene, so the low-importance denominator is empty by construction. Reporting 0 or 1 would
      // be a measurement this deployment cannot make; `routeModelForWork` enforces the routing
      // whenever low-importance work does appear, and that is proven in `tokenBudget.test.ts`.
      expect(findings.resources.lowImportanceCalls).toBe(0);
      expect(findings.resources.fastModelRoutingShare).toBeNull();
      expect(findings.resources.fastModelRoutingShareCompliant).toBeNull();
      expect(findings.resources.fastModelRoutingShareReason).toContain('MAX_MAJOR_SCENES_PER_SLOT');
      expect(findings.resources.fastModelRoutingShareThreshold).toBe(0.8);
    });

    it('AC#3 — public-read LLM calls are zero, and the report says why it is structural', () => {
      expect(findings.resources.publicReadLlmCalls).toBe(0);
      expect(findings.resources.publicReadLlmCallsReason).toContain('publicReadOnlyGuarantee.test.ts');
    });

    it('AC#3 — daily cap compliance is null on an unconfigured world, not a green tick', () => {
      // "Complied with no limit" and "complied with a limit" are different statements, and a
      // dashboard cannot tell a green tick apart from a missing one.
      expect(findings.resources.worldDailyTokenBudget).toBeNull();
      expect(findings.resources.dailyCapCompliant).toBeNull();
      expect(findings.resources.dailyCapReason).not.toBeNull();
      expect(findings.resources.maxObservedDailyTokens).toBeGreaterThan(0);
    });
  });
});

/**
 * AC#2/#5/#6/#7. Gated: `ART60_LONG_RUN=1 npm run test:longrun`.
 * See the module header for why it is not in the default suite.
 */
const describeThirtyDay = process.env.ART60_LONG_RUN === '1' ? describe : describe.skip;

describeThirtyDay('NFR-007 fixed-seed 30-day simulation (AC#2/#5/#6/#7)', () => {
  let findings: LongRunFindings;

  beforeAll(async () => {
    findings = await runLongRunSimulation({ worldDays: 30 });
  }, 1_800_000);

  it('completes 100% of its world days with 100% replay equality (AC#2/#5)', () => {
    expect(findings.slotsExecuted).toBe(THIRTY_DAY_SLOTS);
    expect(findings.completionRate).toBe(1);
    expect(findings.replay.equal).toBe(true);
    expect(findings.replay.deterministic).toBe(true);
    expect(findings.acceptedEvents).toBe(449);
  });

  it('machine-checks every Section 19.3 dimension over 30 world days (AC#2)', () => {
    expectCleanRun(findings, 30);
  });

  it('keeps the major arc portfolio inside the FR-F003 1–3 band at every checkpoint (AC#6)', () => {
    expect(findings.arcs.activeMajorByWorldDay).toHaveLength(30);
    expect(findings.arcs.overLimitWorldDays).toEqual([]);
    expectKnownFindings(findings, 30);
  });

  it('produces canon and exactly one episode for every world day (AC#7)', () => {
    expect(findings.recapCoverage.worldDaysWithoutAcceptedEvent).toEqual([]);
    expect(findings.recapCoverage.episodes).toBe(30);
    expect(findings.recapCoverage.worldDaysWithoutEpisode).toEqual([]);
    expect(findings.recapCoverage.emptyEpisodes).toEqual([]);
  });
});
