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
 * Characters the fixed seed places alone at a location. The live Director only plans scenes
 * at locations holding two or more characters and no committed scene ever moves anyone, so
 * these five are never cast. Recorded here as the harness's finding, not as desired
 * behaviour — see the implementation notes on ART-60.
 */
const STARVED_CHARACTER_IDS = ['lin-yingxue', 'su-meizhen', 'luo-shan', 'tang-ruoxi', 'wu-zhen'];

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
 * Asserts the gaps the fixed seed exposes. These are findings the harness must keep
 * reporting: if one of them changes, the live pipeline's behaviour changed and the finding
 * has to be re-triaged rather than silently absorbed.
 */
function expectKnownFindings(findings: LongRunFindings, worldDays: number): void {
  // FINDING 1 — character starvation. Five seeded characters never take part in a scene,
  // so `slotsSinceMajorAppearance` grows for the whole run instead of being bounded.
  expect(findings.appearance.neverAppeared.sort()).toEqual([...STARVED_CHARACTER_IDS].sort());
  expect(findings.appearance.threshold).toBe(MAX_SLOTS_WITHOUT_APPEARANCE);
  expect(findings.appearance.maxSlotsSinceMajorAppearance).toBe(worldDays * TIME_SLOTS.length);
  expect(findings.appearance.violations.length).toBeGreaterThan(0);
  // Every violation belongs to a starved character; no cast character is ever starved.
  expect([...new Set(findings.appearance.violations.map(({ characterId }) => characterId))].sort())
    .toEqual([...STARVED_CHARACTER_IDS].sort());

  // FINDING 2 — arc lockstep. Every event carries the same importance under the fake
  // author, so all three major arcs are opened and advanced together and the active-family
  // count dips to zero on the changeover day, one world day in five. The portfolio itself
  // never leaves the FR-F003 1–3 band.
  expect(findings.arcs.unresolvedMajorByWorldDay.every((count) => count >= 1 && count <= MAX_MAJOR_ACTIVE_ARCS)).toBe(true);
  expect(findings.arcs.worldDaysWithoutActiveMajorArc)
    .toEqual(Array.from({ length: Math.ceil(worldDays / 5) }, (_, index) => index * 5));
  expect(findings.arcs.activeMajorByWorldDay.filter((count) => count > 0).every((count) => count === MAX_MAJOR_ACTIVE_ARCS)).toBe(true);

  // FINDING 3 — content repetition. The frozen cast/location set plus the fake author's
  // template collapse the run onto twelve distinct scene texts.
  expect(findings.repetition.distinctContentDigests).toBe(12);
  expect(findings.repetition.duplicateScenes).toBe(findings.repetition.scenes - 12);
  expect(findings.repetition.duplicateGroups.length).toBeGreaterThan(0);
  // Every duplicate group is a repeat of one of the twelve texts; nothing is unaccounted for.
  expect(findings.repetition.duplicateGroups.reduce((total, { sceneIds }) => total + sceneIds.length, 0))
    .toBe(findings.repetition.scenes - (12 - findings.repetition.duplicateGroups.length));
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
      'recapCoverage', 'repetition', 'replay', 'safety', 'schemaVersion', 'seed', 'slots',
      'slotsCompleted', 'slotsExecuted', 'tokens',
    ]);
    expect(findings.slots).toHaveLength(SEVEN_DAY_SLOTS);
  });

  it('passes every clean Section 19.3 check', () => {
    expectCleanRun(findings, 7);
    expect(findings.acceptedEvents).toBe(105);
  });

  it('reports the gaps the fixed seed exposes instead of hiding them', () => {
    expectKnownFindings(findings, 7);
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
    expect(findings.acceptedEvents).toBe(450);
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
