/**
 * ART-92 / PRD Section 19.5 — the sampler that makes the manual review repeatable.
 *
 * Section 19.5 is a human process, so what is asserted here is the property that makes the
 * process trustworthy rather than the reviewer's judgement: two evaluators drawing a sample
 * from the same seed must read exactly the same text, the sample must span the whole run
 * rather than its opening days, the packet must ask every PRD dimension, and the committed
 * evidence must not itself leak a seeded secret.
 *
 * The default suite runs a short 3-world-day sample (~3 s). The 30-day packet generation is
 * gated behind `ART92_REVIEW_PACKET=1` and exposed as `npm run narrative:review-packet`,
 * for the same runtime reason ART-60 gates its 30-day scenario.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { mistwoodCharacterSeed } from '../canon/mistwoodSeed';
import {
  buildNarrativeReviewSample,
  evenlySpaced,
  renderNarrativeReviewPacket,
  RUBRIC_DIMENSIONS,
  RUBRIC_VERSION,
  type NarrativeReviewSample,
} from './narrativeReviewSample';

const RUBRIC_DOC = 'docs/narrative-quality-rubric.md';
const PACKET_PATH = 'docs/narrative-quality-reviews/2026-08-04-mistwood-30-day-packet.md';

describe('ART-92 sampling protocol', () => {
  it('always keeps the first and the last member, evenly spaced in between', () => {
    expect(evenlySpaced([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4)).toEqual([0, 3, 6, 9]);
    expect(evenlySpaced([0, 1, 2], 3)).toEqual([0, 1, 2]);
    // Asking for more than exists returns everything rather than padding.
    expect(evenlySpaced([0, 1], 5)).toEqual([0, 1]);
    expect(evenlySpaced([0, 1, 2], 1)).toEqual([0]);
    expect(evenlySpaced([], 3)).toEqual([]);
  });
});

describe('ART-92 review sample over a real fixed-seed run (AC#1/#2)', () => {
  let sample: NarrativeReviewSample;
  let packet: string;

  beforeAll(async () => {
    ({ sample } = await buildNarrativeReviewSample({ worldDays: 3, worldDaySampleSize: 3 }));
    packet = renderNarrativeReviewPacket(sample);
  }, 300_000);

  it('defines sampling that two evaluators can reproduce (AC#1)', async () => {
    const repeat = await buildNarrativeReviewSample({ worldDays: 3, worldDaySampleSize: 3 });
    expect(repeat.sample).toEqual(sample);
    expect(renderNarrativeReviewPacket(repeat.sample)).toBe(packet);
    // Provenance: the sample records which run it came from, so a score can be re-derived.
    expect(sample.runDigest).toBe(repeat.findings.digest);
    expect(sample.seed.providerModel).toBe('fake-whole-scene-v1');
  }, 300_000);

  it('spans the whole run rather than its opening days (AC#2)', () => {
    expect(sample.protocol.worldDaysSampled[0]).toBe(sample.protocol.worldDaysInRun[0]);
    expect(sample.protocol.worldDaysSampled.at(-1))
      .toBe(sample.protocol.worldDaysInRun.at(-1));
    expect(sample.protocol.scenesSampled).toBeGreaterThan(0);
    expect(sample.protocol.episodesSampled).toBe(sample.protocol.worldDaysSampled.length);
  });

  it('carries the authored prose a reviewer has to read, not a digest', () => {
    for (const scene of sample.scenes) {
      expect(scene.sceneSummary.trim().length).toBeGreaterThan(0);
      expect(scene.keyActions.length).toBeGreaterThan(0);
      expect(scene.dialogue.length).toBeGreaterThan(0);
      expect(scene.safetyLabel.length).toBeGreaterThan(0);
      expect(scene.identicalScenesInRun).toBeGreaterThanOrEqual(1);
    }
    for (const episode of sample.episodes.filter(({ withheld }) => !withheld)) {
      expect(episode.title.trim().length).toBeGreaterThan(0);
      expect(episode.keyScenes.length).toBeGreaterThan(0);
    }
  });

  it('reports the already-automated signals as reviewer context (AC#1)', () => {
    expect(sample.signals.scenesInRun).toBeGreaterThan(0);
    expect(sample.signals.distinctSceneTexts).toBeGreaterThan(0);
    expect(sample.signals.exactDuplicateRate).toBeGreaterThanOrEqual(0);
    expect(sample.signals.safetyLabels.length).toBeGreaterThan(0);
    expect(sample.signals.eventsBypassingSafety).toBe(0);
  });

  it('asks every PRD Section 19.5 dimension plus spoiler discipline (AC#2)', () => {
    expect(RUBRIC_DIMENSIONS.map(({ id }) => id))
      .toEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9']);
    for (const dimension of RUBRIC_DIMENSIONS) {
      expect(packet).toContain(dimension.name);
      expect(packet).toContain(dimension.reviewerPrompt);
      expect(packet).toContain(dimension.complements);
    }
    // Safety interception and spoiler discipline are hard gates, not averaged away.
    expect(RUBRIC_DIMENSIONS.filter(({ hardGate }) => hardGate).map(({ id }) => id))
      .toEqual(['D8', 'D9']);
  });

  it('never puts a seeded secret into the committed evidence (AC#3)', () => {
    for (const { content } of mistwoodCharacterSeed.secrets) {
      expect(packet).not.toContain(content);
    }
  });

  it('stays in step with the rubric document it scores against', () => {
    const rubric = readFileSync(join(process.cwd(), RUBRIC_DOC), 'utf8');
    expect(rubric).toContain(`Version ${RUBRIC_VERSION}`);
    for (const dimension of RUBRIC_DIMENSIONS) {
      expect(rubric).toContain(`${dimension.id} ${dimension.name}`);
      expect(rubric).toContain(dimension.prdQuestion);
    }
  });
});

/**
 * Regenerates the committed 30-day review packet. Gated because the 30-day run takes about
 * five minutes (see `docs/long-run-simulation-harness.md`).
 *
 *     npm run narrative:review-packet
 */
const describePacket = process.env.ART92_REVIEW_PACKET === '1' ? describe : describe.skip;

describePacket('ART-92 30-day review packet generation', () => {
  it('writes the packet the recorded review was scored against', async () => {
    const { sample } = await buildNarrativeReviewSample({ worldDays: 30 });
    const packet = renderNarrativeReviewPacket(sample);
    const target = join(process.cwd(), PACKET_PATH);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, packet, 'utf8');
    // eslint-disable-next-line no-console
    console.log(`ART-92 packet written to ${PACKET_PATH} (run digest ${sample.runDigest})`);
    console.log(JSON.stringify(sample.signals, null, 2));
    expect(sample.protocol.worldDaysSampled).toHaveLength(6);
  }, 1_800_000);
});
