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
import { CONTINUITY_EVALUATOR_ID, CONTINUITY_EVALUATOR_VERSION } from '../quality/continuity';
import { NARRATIVE_EVALUATOR_ID, NARRATIVE_EVALUATOR_VERSION } from '../quality/narrative';
import { STORY_QUALITY_EVALUATOR_ID, STORY_QUALITY_EVALUATOR_VERSION } from '../quality/storyQuality';
import { OPERATIONAL_QUALITY_EVALUATOR_ID, OPERATIONAL_QUALITY_EVALUATOR_VERSION } from '../quality/operationalQuality';
import { mistwoodWorldConfiguration } from '../canon/mistwoodSeed';
import {
  contentDigest,
  runLongRunSimulation,
  seededCanonStore,
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
 * The §16.2 repeated-scene ceiling, and the ABSOLUTE scene counts the ratio is measured over.
 *
 * `DISTINCT_SCENE_TEXTS` — a per-run-length pin of how many distinct texts the fake author produced
 * (91 of 104 at seven days, 171 of 449 at thirty) — lived here until ART-88. It was an honest
 * record of FINDING 2 and never a ratio; the ratio itself, `repetition.duplicateRate`, was computed
 * and asserted by nothing, and every assertion around it compared the report with itself. ART-88
 * replaced the template author and measures the ratio with `convex/quality/narrative.ts`: exact OR
 * near-duplicate (Jaccard ≥ 0.8 over identifier-masked 3-grams) against an earlier accepted scene,
 * over the ACCEPTED scenes. The denominator is pinned as a number so authoring fewer scenes cannot
 * improve the ratio.
 */
const REPEATED_SCENE_CEILING = 0.15;
const ACCEPTED_SCENES: Record<number, number> = { 7: 104, 30: 449 };

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

  // Replay consistency (ART-17). `liveDigest` is the projection the run carried, folded slot by
  // slot; `replayedDigest` is one full replay of the log. Until ART-58 both were full replays.
  expect(findings.replay.acceptedEvents).toBe(findings.acceptedEvents);
  expect(findings.replay.equal).toBe(true);
  expect(findings.replay.deterministic).toBe(true);
  expect(findings.replay.replayedDigest).toBe(findings.replay.liveDigest);

  /**
   * FR-M002 Continuity (ART-58) — the SAME evaluator the operator query runs, over this run.
   *
   * Every denominator is stated before its target, so none of these can pass on an empty world:
   * the accepted-event count is the run's, the replay denominator is the number of REAL daily
   * snapshots stage 20 persisted (one per world day now that the ART-99 stub is gone), and the
   * publication denominator is the episodes plus recap formats the editorial stages produced.
   */
  const continuity = findings.continuity;
  expect(continuity.evaluatorId).toBe(CONTINUITY_EVALUATOR_ID);
  expect(continuity.evaluatorVersion).toBe(CONTINUITY_EVALUATOR_VERSION);
  expect(continuity.window).toEqual({ fromWorldDay: 0, toWorldDay: worldDays - 1 });
  expect(continuity.coverage.worldDaysEvaluated).toEqual(Array.from({ length: worldDays }, (_, index) => index));
  expect(continuity.coverage.worldDaysWithoutEvidence).toEqual([]);
  expect(continuity.coverage.scanLimitReached).toBe(false);
  const metric = (key: string) => {
    const found = continuity.metrics.find((candidate) => candidate.key === key);
    if (!found) throw new Error(`continuity metric ${key} missing`);
    return found;
  };
  expect(metric('severe_canon_conflicts').denominator).toBe(findings.acceptedEvents);
  expect(metric('severe_canon_conflicts')).toMatchObject({ numerator: 0, rate: 0, status: 'measured', meetsTarget: true });
  expect(metric('replay_consistency').denominator).toBe(worldDays);
  expect(metric('replay_consistency')).toMatchObject({ numerator: worldDays, rate: 1, status: 'measured', meetsTarget: true, excluded: 0 });
  // Episodes plus recap formats, one of each per COMPLETED world day — the newest day's Episode
  // is due on the next day's first commit (ART-89).
  expect(metric('unsourced_secret_leaks').denominator).toBe(2 * (worldDays - 1));
  expect(metric('unsourced_secret_leaks')).toMatchObject({ numerator: 0, rate: 0, status: 'measured', meetsTarget: true });
  expect(metric('deceased_character_appearances')).toMatchObject({ numerator: 0, denominator: findings.acceptedEvents, meetsTarget: true });
  expect(metric('character_location_conflicts')).toMatchObject({ numerator: 0, denominator: findings.acceptedEvents, meetsTarget: true });
  expect(continuity.findings).toEqual([]);
  expect(continuity.score).toMatchObject({ value: 1, status: 'measured', weightMeasured: 1, weightTotal: 1 });
  // The harness's own checks and the evaluator are two computations; they must agree.
  expect(continuity.findings.filter(({ severity }) => severity === 'severe')).toHaveLength(findings.canonConflicts.length);

  /**
   * FR-M002 narrative (ART-88) — PRD §16.2 重複場景比例 < 15%, measured by the evaluator over the
   * run's ACCEPTED scenes, whose count is pinned as an absolute so the ratio cannot be improved by
   * authoring less. Every companion metric states a non-empty denominator before its value.
   */
  const narrative = findings.narrative;
  expect(narrative.evaluatorId).toBe(NARRATIVE_EVALUATOR_ID);
  expect(narrative.evaluatorVersion).toBe(NARRATIVE_EVALUATOR_VERSION);
  const narrativeMetric = (key: string) => {
    const found = narrative.metrics.find((candidate) => candidate.key === key);
    if (!found) throw new Error(`narrative metric ${key} missing`);
    return found;
  };
  const repeated = narrativeMetric('repeated_scene_ratio');
  expect(repeated.denominator).toBe(ACCEPTED_SCENES[worldDays]);
  expect(repeated.excluded).toBe(0);
  expect(repeated.status).toBe('measured');
  expect(repeated.target).toBe(REPEATED_SCENE_CEILING);
  expect(repeated.rate).not.toBeNull();
  expect(repeated.rate!).toBeLessThan(REPEATED_SCENE_CEILING);
  expect(repeated.meetsTarget).toBe(true);
  expect(narrativeMetric('exact_duplicate_scene_ratio').denominator).toBe(ACCEPTED_SCENES[worldDays]);
  expect(narrativeMetric('template_reuse_ratio').denominator).toBe(ACCEPTED_SCENES[worldDays]);
  // Dialogue: hundreds of lines, and the cast has more than one voice. The author's registers
  // are hash-bound, so a small share of collisions is expected and is reported, not hidden.
  const dialogue = narrativeMetric('dialogue_repetition_ratio');
  expect(dialogue.denominator).toBeGreaterThan(ACCEPTED_SCENES[worldDays]);
  expect(dialogue.rate!).toBeLessThan(0.1);
  const voice = narrativeMetric('voice_distinctiveness');
  expect(voice.denominator).toBe(dialogue.denominator);
  // Measured 1.0 at both run lengths: no two characters say one line. Asserted as a floor rather
  // than an equality because a register collision is a property of the hash, not a defect.
  expect(voice.rate!).toBeGreaterThanOrEqual(0.95);
  // Persona: anchors are present, so the denominator is the accepted events, and Canon's gate
  // admitted no deviation on this seed.
  expect(narrativeMetric('persona_deviation_rate')).toMatchObject({ denominator: findings.acceptedEvents, numerator: 0, status: 'measured' });
  const novelty = narrativeMetric('event_novelty_ratio');
  expect(novelty.denominator).toBe(findings.acceptedEvents - 1);
  expect(novelty.rate!).toBeGreaterThan(0.5);
  expect(narrative.score).toMatchObject({ status: 'measured', weightMeasured: 1 });
  expect(narrative.coverage.worldDaysEvaluated).toEqual(Array.from({ length: worldDays }, (_, index) => index));
  // FR-G003: the composing author must still fit the recap bands on every day. Invisible before
  // ART-88 — a refusal was recorded in the harness's own map and reported nowhere.
  expect(findings.recapCoverage.recapFormatFailures).toEqual([]);

  /**
   * FR-M002 arc / recap / spoiler (ART-89) — PRD §16.2 高重要度摘要覆蓋率 ≥ 95%.
   *
   * The denominator is read from CANON, never from the episodes: `buildDailyEpisode` refuses to
   * store an episode that omits a high-importance event, so a coverage ratio over stored episodes
   * reads 100% by construction and could not fail. It is asserted non-empty before the rate.
   */
  const story = findings.storyQuality;
  expect(story.evaluatorId).toBe(STORY_QUALITY_EVALUATOR_ID);
  expect(story.evaluatorVersion).toBe(STORY_QUALITY_EVALUATOR_VERSION);
  const storyMetric = (key: string) => {
    const found = story.metrics.find((candidate) => candidate.key === key);
    if (!found) throw new Error(`story metric ${key} missing`);
    return found;
  };
  const coverageMetric = storyMetric('recap_coverage');
  expect(coverageMetric.denominator).toBeGreaterThan(0);
  expect(coverageMetric.status).toBe('measured');
  expect(coverageMetric.target).toBe(0.95);
  expect(coverageMetric.rate!).toBeGreaterThanOrEqual(0.95);
  expect(coverageMetric.meetsTarget).toBe(true);
  // The newest day is excluded with a reason, not counted as uncovered.
  expect(coverageMetric.excluded).toBeGreaterThan(0);
  expect(coverageMetric.excludedReason).toContain('not due yet');
  // Spoilers: every released episode's persisted FR-G004 verdict, and zero spoiler findings.
  expect(storyMetric('spoiler_violation_rate')).toMatchObject({ numerator: 0, denominator: worldDays - 1, meetsTarget: true });
  expect(storyMetric('arc_progress_rate').denominator).toBeGreaterThan(0);
  expect(storyMetric('arc_stagnation_rate')).toMatchObject({ numerator: 0, meetsTarget: true });
  expect(storyMetric('arc_resolution_evidence')).toMatchObject({ meetsTarget: true });
  expect(story.findings).toEqual([]);
  expect(story.score).toMatchObject({ value: 1, status: 'measured' });

  /**
   * FR-M002 operational quality (ART-90) — PRD §16.2 JSON 結構成功率 ≥ 98%.
   *
   * Honest about what this run can and cannot say. The deterministic author returns a valid
   * whole-scene output every time, so its structured-output rate is 1.0 BY CONSTRUCTION and the
   * assertion below is about the wiring, not about a model. That the metric can FALL is proven on
   * fixtures in `convex/quality/operationalQuality.test.ts` and against the live path in
   * `convex/simulation/authoringAttemptEvidence.test.ts`; that this deployment's gateway holds the
   * contract is measured, when someone runs it, by `npm run test:live-structure`.
   *
   * What this run does prove is that the evidence exists at all: before ART-90 a scene that
   * exhausted its attempts wrote no row anywhere, so a rate over the deployment's own tables had
   * successes and nothing to divide by.
   */
  const operational = findings.operationalQuality;
  expect(operational.evaluatorId).toBe(OPERATIONAL_QUALITY_EVALUATOR_ID);
  expect(operational.evaluatorVersion).toBe(OPERATIONAL_QUALITY_EVALUATOR_VERSION);
  const operationalMetric = (key: string) => {
    const found = operational.metrics.find((candidate) => candidate.key === key);
    if (!found) throw new Error(`operational metric ${key} missing`);
    return found;
  };
  // Two validation stages judged every proposal, so the denominator is twice the accepted events.
  expect(operationalMetric('canon_rejection_rate')).toMatchObject({
    numerator: 0, denominator: 2 * findings.acceptedEvents, rate: 0, status: 'measured',
  });
  expect(operationalMetric('safety_withhold_rate')).toMatchObject({
    numerator: 0, denominator: findings.repetition.scenes, status: 'measured', excluded: 0,
  });
  const structured = operationalMetric('structured_output_success_rate');
  expect(structured.denominator).toBe(findings.repetition.scenes);
  expect(structured).toMatchObject({ numerator: findings.repetition.scenes, rate: 1, target: 0.98, meetsTarget: true, excluded: 0 });
  expect(operationalMetric('scene_classification_coverage')).toMatchObject({
    numerator: findings.repetition.scenes, denominator: findings.repetition.scenes, meetsTarget: true,
  });
  expect(operational.findings).toEqual([]);
  expect(operational.score).toMatchObject({ value: 1, status: 'measured', weightMeasured: 1 });
  // The reason dimensions are empty because nothing was refused, and the model dimension is not:
  // an all-empty breakdown would also be what a recorder that never ran produces.
  expect(findings.operationalBreakdown.rejectionReasons).toEqual([]);
  expect(findings.operationalBreakdown.withholdReasons).toEqual([]);
  expect(findings.operationalBreakdown.structuredOutputReasons).toEqual([]);
  expect(findings.operationalBreakdown.providerFailureReasons).toEqual([]);
  expect(findings.operationalBreakdown.models).toEqual([{ code: FAKE_SCENE_MODEL, count: findings.repetition.scenes }]);

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

  /**
   * Section 5.1 / AC#7 — every COMPLETED world day produced canon and exactly one non-empty
   * episode.
   *
   * `worldDays - 1`, and the missing one is the newest day. This asserted `worldDays` until ART-89,
   * which found what that was hiding: a day was treated as complete the moment its night slot
   * BEGAN, so its Episode was assembled from a partial slot and the rest of that slot reached no
   * Episode, recap or publication — 14 of 96 high-importance events permanently uncovered over
   * seven days, and §16.2's coverage clause at 85.4%. A day is now over when the world has moved
   * past it, so the newest day's Episode is due on the next day's first commit. In production the
   * next cron tick composes it; a run that stops mid-world leaves exactly one day pending, and the
   * coverage metric excludes it with a reason instead of counting it as a failure.
   */
  expect(findings.recapCoverage.worldDaysWithoutAcceptedEvent).toEqual([]);
  expect(findings.recapCoverage.completedWorldDays).toBe(worldDays - 1);
  expect(findings.recapCoverage.episodes).toBe(worldDays - 1);
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
  expect(findings.safety.episodes).toBe(worldDays - 1);
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

  // FINDING 2 — content repetition — is RESOLVED by ART-88 and asserted as a property in
  // `expectCleanRun` (`repeated_scene_ratio`). The exact-digest check ART-60 introduced stays as a
  // second, independent measure: with the composing author no two accepted scenes share a digest.
  expect(findings.repetition.scenes).toBe(ACCEPTED_SCENES[worldDays]);
  expect(findings.repetition.distinctContentDigests).toBe(findings.repetition.scenes);
  expect(findings.repetition.duplicateScenes).toBe(0);
  expect(findings.repetition.duplicateGroups).toEqual([]);
  expect(findings.repetition.duplicateRate).toBe(0);
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

  /**
   * ART-58. The seeded Canon store carries the `initial` snapshot `importWorld` writes, so every
   * commit in the run is validated against the seeded locations the way production validates it.
   * Without this the run validated against `emptyProjection`, where the unknown-destination,
   * inactive-destination and capacity rules skip themselves — the 30-day evidence measured a
   * weaker Canon than the deployment enforces, and nothing here could tell.
   */
  it('validates the run against the seeded baseline, not an empty projection (ART-58)', async () => {
    const initial = await seededCanonStore().loadInitialSnapshot(LONG_RUN_WORLD_ID);
    expect(initial).not.toBeNull();
    expect(Object.keys(initial!.projection.locations)).toHaveLength(mistwoodWorldConfiguration.locations.length);
    expect(initial!.lastSequenceNumber).toBe(-1);
    // And the evaluator folded from it: the origin is the seed, and the fold agreed with every
    // daily snapshot the real snapshot stage persisted from that same seed.
    expect(findings.continuity.coverage.worldDaysEvaluated).toHaveLength(7);
    expect(findings.continuity.metrics.find(({ key }) => key === 'replay_consistency')?.denominator).toBe(7);
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
      'acceptedEvents', 'appearance', 'arcs', 'canonConflicts', 'completionRate',
      // FR-M002 (ART-58): the continuity evaluator's report over the run's own evidence.
      'continuity',
      'digest',
      // FR-M002 (ART-88): the narrative evaluator's report over the run's accepted scenes.
      'narrative',
      // FR-M002 (ART-90): rejection, withhold and structured-output rates, and their reasons.
      'operationalBreakdown', 'operationalQuality',
      'recapCoverage', 'repetition', 'replay',
      // FR-M003 §16.3 (ART-59): the resource report the run's own budget accountant produced.
      'resources',
      'safety', 'schemaVersion', 'seed', 'slots',
      'slotsCompleted', 'slotsExecuted',
      // FR-M002 (ART-89): arc / recap / spoiler quality over the accepted log and the verdicts.
      'storyQuality',
      'tokens',
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

  it('produces canon and exactly one episode for every completed world day (AC#7)', () => {
    expect(findings.recapCoverage.worldDaysWithoutAcceptedEvent).toEqual([]);
    // 29, not 30: the newest day's Episode is due on the next day's first commit (ART-89). See
    // `expectCleanRun` for what asserting 30 was hiding.
    expect(findings.recapCoverage.episodes).toBe(29);
    expect(findings.recapCoverage.worldDaysWithoutEpisode).toEqual([]);
    expect(findings.recapCoverage.emptyEpisodes).toEqual([]);
  });
});
