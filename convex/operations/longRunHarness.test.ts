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
import { MAX_MAJOR_ACTIVE_ARCS, MAX_MINOR_ACTIVE_ARCS } from '../story/portfolio';
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
 * Distinct scene texts the fake author produces over this seed's cast and locations, per run
 * length. Measured, not chosen.
 *
 * It was ONE number until ART-164, because the author's output space was small enough that both
 * run lengths saturated it: 12 texts before ART-101 un-stranded the cast, 32 after. ART-164's
 * zh-Hant narrator gives a scene a deterministic outcome, stake and per-participant stances as
 * well as a place and a subject, and the space is no longer saturated at seven days — so the two
 * lengths legitimately differ and a single constant would have to be wrong for one of them.
 *
 * The widening is a SIDE EFFECT of making the fixture carry a normal scene's worth of information,
 * which FR-G003's 400 中文字 Standard Recap requires. It is not a fix for FINDING 2: the author is
 * still a template, and the duplication below is still its ceiling.
 *
 * Writing the fixture also exposed a real defect in it. Spelling out every participant's stance
 * pushed a large-cast summary past `MAX_PUBLIC_SUMMARY_LENGTH`, and the clamp cut the tail where
 * the scene's outcome lived, so two different scenes at one location truncated to the same text.
 * The measured distinct count FELL from 46 to 41. Ordering the sentence outcome-first and dropping
 * the participant roll-call — which the stances already name — took it to 91.
 */
const DISTINCT_SCENE_TEXTS: Record<number, number> = { 7: 91, 30: 171 };

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

  // ART-163 — the invariants that hold at EVERY run length.
  expect(findings.arcs.maxActiveMinorArcs).toBeLessThanOrEqual(MAX_MINOR_ACTIVE_ARCS);
  expect(findings.arcs.minorOverLimitWorldDays).toEqual([]);
  // Structurally impossible while every resolution is routed through a decision. Asserted anyway:
  // this exact defect shipped once, with arcs reaching `resolved` carrying nothing at all.
  expect(findings.arcs.terminalResolutionsWithoutEvidence).toEqual([]);
  for (const resolution of findings.arcs.resolutions) {
    expect(resolution.consequenceCount).toBe(resolution.terminal ? resolution.consequenceCount : 0);
    if (resolution.terminal) expect(resolution.consequenceCount).toBeGreaterThan(0);
  }
  // A stagnant arc may hold a slot briefly; the ladder must take it back.
  expect(findings.arcs.arcsHoldingActiveSlotWhileStagnant).toEqual([]);
  // Arc state is replayable: the snapshot the run carried equals a fresh replay of the stream.
  expect(findings.arcs.arcsWhereLiveAndReplayDisagree).toEqual([]);

  // ART-163 — the run must show a story ENGINE, not a schema. Measured over the fixed seed:
  // seven world days open six arcs, three of which reach `resolved` carrying an outcome and
  // between three and four consequences each.
  expect(findings.arcs.arcsWithTurningPoint.length).toBeGreaterThan(0);
  expect(findings.arcs.arcsReachingResolution.length).toBeGreaterThan(0);
  expect(findings.arcs.resolutions.some((resolution) => resolution.terminal)).toBe(true);
  // FR-F005: closing an arc updates BOTH the character and the world summary input. The world
  // subject is the one a per-character loop would silently omit.
  expect(findings.arcs.consequenceSummarySubjects.some((subject) => subject.startsWith('world:'))).toBe(true);
  expect(findings.arcs.consequenceSummarySubjects.some((subject) => subject.startsWith('character:'))).toBe(true);
  expect(findings.arcs.consequenceSummaryCount).toBeGreaterThan(0);

  // Section 5.1 / AC#7 — every world day produced canon and exactly one non-empty episode.
  expect(findings.recapCoverage.worldDaysWithoutAcceptedEvent).toEqual([]);
  expect(findings.recapCoverage.completedWorldDays).toBe(worldDays);
  expect(findings.recapCoverage.episodes).toBe(worldDays);
  expect(findings.recapCoverage.worldDaysWithoutEpisode).toEqual([]);
  expect(findings.recapCoverage.emptyEpisodes).toEqual([]);
  // FR-G004 (ART-35) found no coverage gap and no spoiler in any released episode.
  expect(findings.recapCoverage.coverageFindings).toEqual([]);
  /**
   * FR-G002 (ART-34/ART-164) — all five declared pyramid levels ran, not two.
   *
   * This asserted `['episode', 'viewer_context']` until ART-164, which was an accurate record of a
   * defect: `scene`, `arc` and `season` were declared in `RECAP_TYPES`, implemented in the model,
   * and emitted by nothing, so they existed for no world. The old expectation is what a live run
   * actually produced, so it passed for years while three levels of the pyramid were dead.
   */
  expect(findings.recapCoverage.recapTypes).toEqual(['arc', 'episode', 'scene', 'season', 'viewer_context']);

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
  // the run onto a small set of distinct scene texts. ART-101's un-stranded cast widened it from
  // twelve to thirty-two, and ART-164's zh-Hant narrator from thirty-two to forty-six. Both are
  // improvements and neither is a fix: the remaining duplication is the no-cost author, not the
  // Director, and is deferred to the ART-72 provider. A template with more slots has a larger
  // output space and is still a template.
  const distinct = DISTINCT_SCENE_TEXTS[worldDays];
  expect(distinct).toBeDefined();
  expect(findings.repetition.distinctContentDigests).toBe(distinct);
  expect(findings.repetition.duplicateScenes).toBe(findings.repetition.scenes - distinct);
  expect(findings.repetition.duplicateGroups.length).toBeGreaterThan(0);
  // Every duplicate group is a repeat of one of those texts; nothing is unaccounted for.
  expect(findings.repetition.duplicateGroups.reduce((total, { sceneIds }) => total + sceneIds.length, 0))
    .toBe(findings.repetition.scenes - (distinct - findings.repetition.duplicateGroups.length));
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

  /**
   * ART-163. Thirty days is where a story engine can be told from a data model: an arc that
   * advances and closes over a week could be a coincidence of the seed, but a world that keeps
   * opening arcs, carrying them through turning points and closing them with recorded outcomes
   * for thirty days is doing the thing FR-F002–F005 describe.
   */
  it('keeps arcs advancing and closing for thirty world days (FR-F002/F004/F005)', () => {
    expect(findings.arcs.activeMinorByWorldDay).toHaveLength(30);
    expect(findings.arcs.minorOverLimitWorldDays).toEqual([]);
    expect(findings.arcs.arcsWithTurningPoint.length).toBeGreaterThan(0);
    expect(findings.arcs.resolvedArcs.length).toBeGreaterThan(0);
    expect(findings.arcs.resolutions.filter(({ terminal }) => terminal).length).toBeGreaterThan(0);
    // Every terminal resolution carries its evidence, over the whole run and not just the first.
    expect(findings.arcs.terminalResolutionsWithoutEvidence).toEqual([]);
    // No arc sat in an active slot past the stagnation threshold: the ladder took the slot back.
    expect(findings.arcs.arcsHoldingActiveSlotWhileStagnant).toEqual([]);
    expect(findings.arcs.stagnantArcs).toEqual([]);
    /**
     * The world never runs dry of live questions for LONGER THAN A CHANGEOVER.
     *
     * Not "never runs dry": FINDING 1 records that the fake author gives every event identical
     * importance, so the three major arcs move in lockstep and all resolve on the same day,
     * dipping the active count to zero one day in five. That is an artifact of the fixed seed's
     * author, not of the arc engine, and asserting it away would be asserting a property this
     * fixture has never had. What WOULD be a defect is the dip persisting — a world with no live
     * question for a stretch — so that is what is pinned.
     */
    const dry = findings.arcs.worldDaysWithoutActiveMajorArc;
    expect(dry.filter((day, index) => index > 0 && day === dry[index - 1] + 1)).toEqual([]);
  });

  it('produces canon and exactly one episode for every world day (AC#7)', () => {
    expect(findings.recapCoverage.worldDaysWithoutAcceptedEvent).toEqual([]);
    expect(findings.recapCoverage.episodes).toBe(30);
    expect(findings.recapCoverage.worldDaysWithoutEpisode).toEqual([]);
    expect(findings.recapCoverage.emptyEpisodes).toEqual([]);
  });
});
