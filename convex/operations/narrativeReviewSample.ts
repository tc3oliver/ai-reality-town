/**
 * ART-92 / PRD Section 19.5 — repeatable sampling for the manual narrative review.
 *
 * Section 19.5 is a *human* review ("定期抽樣"), not another automated assertion. What a
 * human reviewer cannot do is trust `LongRunFindings`: that record is deliberately
 * machine-only, so its answer to "is the dialogue repetitive?" is a count of digests. This
 * module turns a real fixed-seed run into something a person can actually read — a sampled
 * packet of authored scenes and assembled episodes, with the automated signals printed
 * alongside as context rather than as the verdict.
 *
 * It deliberately does NOT re-check what is already machine-checked elsewhere:
 *   - ART-35 validates FR-G004 recap coverage and spoiler leakage,
 *   - ART-54/55 classify content before and after generation,
 *   - ART-60 machine-checks canon conflicts, replay, arcs, appearance and repetition.
 * Those results are carried into the packet as {@link ReviewSignals} so the reviewer knows
 * what the machine already claims, and the rubric asks the reviewer only the questions a
 * classifier and a digest cannot answer.
 *
 * Sampling is deterministic: the same seed and the same options select the same scenes, so
 * two evaluators — or the same evaluator two months apart — score the same text.
 *
 * The scoring scale, thresholds and evaluator instructions live in
 * `docs/narrative-quality-rubric.md`; {@link RUBRIC_DIMENSIONS} is the machine-readable
 * copy the packet renders from, so the packet and the rubric cannot drift apart.
 */

import type { TimeSlot } from '../canon/eventTypes';
import type { SceneSimulationResult } from '../simulation/sceneSimulation';
import {
  runLongRunSimulation,
  sceneContentDigest,
  type LongRunContentSample,
  type LongRunFindings,
  type LongRunSeed,
} from './longRunHarness';

/** Version of `docs/narrative-quality-rubric.md` this module renders. Bump both together. */
export const RUBRIC_VERSION = '1.0';

/** Highest score on the rubric scale; the scale is 0–4 (see the rubric document). */
export const RUBRIC_MAX_SCORE = 4;

/** One scored dimension of the rubric. */
export type RubricDimension = {
  /** Stable identifier used in scoring sheets and recorded findings. */
  id: string;
  name: string;
  /** The PRD Section 19.5 sampling question this dimension answers, verbatim. */
  prdQuestion: string;
  /** What the reviewer is asked to do, in one instruction. */
  reviewerPrompt: string;
  /** Minimum score for this dimension to pass. */
  passThreshold: number;
  /**
   * A hard gate scores the whole run, not the average: any hard-gate dimension below its
   * threshold fails the run outright, because unreviewed unsafe or spoiling content is not
   * something a high mean elsewhere can compensate for.
   */
  hardGate: boolean;
  /** The automated check this dimension complements — never duplicates. */
  complements: string;
};

/**
 * The nine scored dimensions: the eight PRD Section 19.5 sampling questions, plus spoiler
 * discipline, which Section 19.5 does not list but Section 20 (#5, #17) gates public
 * testing on and which only a human can judge for implication rather than substring.
 */
export const RUBRIC_DIMENSIONS: readonly RubricDimension[] = [
  {
    id: 'D1',
    name: 'Character consistency',
    prdQuestion: '角色是否保持一致 (do characters stay consistent?)',
    reviewerPrompt:
      'Read every sampled line attributed to one character across the whole sample. Would you believe they are the same person — same voice, same concerns, same relationships — or is the name interchangeable with any other?',
    passThreshold: 3,
    hardGate: false,
    complements: 'No automated check exists; the projection tracks state, not voice.',
  },
  {
    id: 'D2',
    name: 'Action plausibility against known information',
    prdQuestion: '行動是否符合已知資訊 (are actions consistent with what is known?)',
    reviewerPrompt:
      'For each key action, ask whether that character could know what the action implies they know, given the episodes published before it. Flag any action that requires information the character was never given.',
    passThreshold: 3,
    hardGate: false,
    complements:
      'ART-14/ART-24 authorize knowledge reads structurally; they cannot tell whether the prose used what it read.',
  },
  {
    id: 'D3',
    name: 'Event causality',
    prdQuestion: '事件是否具備因果 (do events have cause and effect?)',
    reviewerPrompt:
      'Across consecutive sampled world days, can you state why each scene happened in terms of an earlier one? Score down when scenes are a sequence of unrelated tableaux.',
    passThreshold: 3,
    hardGate: false,
    complements: 'ART-60 proves the accepted log replays; replay says nothing about narrative causality.',
  },
  {
    id: 'D4',
    name: 'Arc progression',
    prdQuestion: 'Arc 是否有推進 (are arcs moving forward?)',
    reviewerPrompt:
      'Compare the earliest and latest sampled episodes. Has the central question changed state — new stakes, new information, a decision taken — or only been restated?',
    passThreshold: 3,
    hardGate: false,
    complements:
      'ART-60 counts projection revisions per arc; a revision is not the same as a reader perceiving progress.',
  },
  {
    id: 'D5',
    name: 'Arc pacing (absence of stalling)',
    prdQuestion: 'Arc 是否拖延 (are arcs dragging?)',
    reviewerPrompt:
      'Score the run as a reader would: how many sampled days could be removed without the reader losing anything? Many removable days means stalling, even when the arc technically advances.',
    passThreshold: 3,
    hardGate: false,
    complements:
      'ART-31 detectArcStagnation fires on a fixed world-day threshold; it cannot see an arc that advances on paper but bores a reader.',
  },
  {
    id: 'D6',
    name: 'Dialogue and scene variety',
    prdQuestion: '對話是否重複 (is dialogue repetitive?)',
    reviewerPrompt:
      'Read the sampled dialogue in order. Would a reader notice they have read this before? Judge near-duplication and formula, not only exact repeats.',
    passThreshold: 3,
    hardGate: false,
    complements:
      'ART-60 measures EXACT duplicate content digests; a human catches paraphrase and template reuse that a digest treats as distinct.',
  },
  {
    id: 'D7',
    name: 'Summary fidelity',
    prdQuestion: '摘要是否誤導 (are summaries misleading?)',
    reviewerPrompt:
      'Read each sampled episode WITHOUT its scenes, then with them. Did the episode create an impression the scenes do not support — overstated stakes, invented consequences, wrong attribution?',
    passThreshold: 3,
    hardGate: false,
    complements:
      'ART-35 validateRecapCoverage proves an episode CITES the right events; it cannot tell whether the prose about them is true.',
  },
  {
    id: 'D8',
    name: 'Safety interception',
    prdQuestion: '不適當內容是否被攔截 (is inappropriate content intercepted?)',
    reviewerPrompt:
      'Read every sampled scene as a publication reviewer. Is there anything you would have withheld that the classifier labelled `allow`? Each such item is a false negative and must be recorded with its scene ID.',
    passThreshold: 4,
    hardGate: true,
    complements:
      'ART-54/55 test the classifier against known-unsafe fixtures. Only a human can find the unsafe content nobody thought to write a fixture for.',
  },
  {
    id: 'D9',
    name: 'Spoiler discipline',
    prdQuestion:
      'PRD Section 20 #5/#17 (no source secret leaks; high-risk content is not published directly)',
    reviewerPrompt:
      'Read the sampled episodes as a first-time viewer. Does any public text reveal, or let you confidently infer, a secret or a private fact the viewer has not earned?',
    passThreshold: 4,
    hardGate: true,
    complements:
      'ART-35 detects secret values appearing verbatim in recap text; a human detects the same secret conveyed by implication.',
  },
];

// --- sample shape -------------------------------------------------------------

/** One scene as a reviewer reads it: all authored prose, plus its safety verdict. */
export type ReviewScene = {
  worldDay: number;
  timeSlot: TimeSlot;
  sceneId: string;
  locationId: string;
  participantIds: string[];
  arcIds: string[];
  trigger: string;
  dramaticPressure: string;
  sceneSummary: string;
  keyActions: Array<{ characterId: string; action: string }>;
  dialogue: Array<{ characterId: string; text: string }>;
  /** Public summaries of the Proposed Events this scene emitted — the audience-facing text. */
  publicSummaries: string[];
  safetyLabel: string;
  safetyReasonCodes: string[];
  safetyWarningCodes: string[];
  reviewStatus: string;
  contentDigest: string;
  /** How many scenes in the WHOLE run share this exact authored text, this one included. */
  identicalScenesInRun: number;
};

/** One episode as a reviewer reads it. `withheld` episodes carry no text by design. */
export type ReviewEpisode = {
  worldDay: number;
  episodeNumber: number;
  status: string;
  withheld: boolean;
  title: string;
  headline: string;
  oneLineSummary: string;
  keyScenes: Array<{ title: string; summary: string }>;
  relationshipChanges: string[];
  newQuestions: string[];
  resolvedQuestions: string[];
  nextEpisodeTease: string;
  arcIds: string[];
  characterIds: string[];
  sourceEventCount: number;
  safetyClassificationId: string | null;
};

/** What the automated checks already claim about this run. Context, never the verdict. */
export type ReviewSignals = {
  acceptedEvents: number;
  scenesInRun: number;
  distinctSceneTexts: number;
  exactDuplicateRate: number;
  episodesInRun: number;
  charactersNeverAppeared: string[];
  maxSlotsSinceMajorAppearance: number;
  appearanceThresholdSlots: number;
  totalArcs: number;
  resolvedArcs: number;
  worldDaysWithoutActiveMajorArc: number[];
  safetyLabels: string[];
  scenesWithoutSafetyClassification: number;
  scenesWithheldForReview: number;
  eventsBypassingSafety: number;
  episodesWithoutSafetyClassification: number;
  worldDaysWithCoverageFindings: number[];
};

/** The deterministic rule that produced this sample, recorded so it can be reproduced. */
export type SampleProtocol = {
  rule: string;
  worldDaysInRun: number[];
  worldDaysSampled: number[];
  scenesPerWorldDay: number;
  scenesSampled: number;
  episodesSampled: number;
};

export type NarrativeReviewSample = {
  schemaVersion: 1;
  rubricVersion: string;
  seed: LongRunSeed;
  /** Digest of the run the sample was drawn from: the sample's provenance. */
  runDigest: string;
  protocol: SampleProtocol;
  scenes: ReviewScene[];
  episodes: ReviewEpisode[];
  /** The largest exact-duplicate groups, so repetition is shown rather than asserted. */
  repetitionExhibit: Array<{ digest: string; sceneCount: number; sceneSummary: string }>;
  signals: ReviewSignals;
};

export type SampleOptions = {
  /** World days to draw from the run. First and last are always included. */
  worldDaySampleSize?: number;
  scenesPerWorldDay?: number;
  /** Duplicate groups shown in the repetition exhibit. */
  repetitionExhibitSize?: number;
};

export const DEFAULT_WORLD_DAY_SAMPLE_SIZE = 6;
export const DEFAULT_SCENES_PER_WORLD_DAY = 2;
export const DEFAULT_REPETITION_EXHIBIT_SIZE = 3;

// --- deterministic selection ---------------------------------------------------

/**
 * `count` evenly spaced members of `values`, always including the first and the last.
 *
 * Even spacing rather than "the first N" on purpose: a narrative defect that only appears
 * once a run has accumulated state is invisible in a prefix sample.
 */
export function evenlySpaced<T>(values: readonly T[], count: number): T[] {
  if (count <= 0 || values.length === 0) return [];
  if (count === 1) return [values[0]];
  if (count >= values.length) return [...values];
  const indices = new Set<number>();
  for (let step = 0; step < count; step += 1) {
    indices.add(Math.round((step * (values.length - 1)) / (count - 1)));
  }
  return [...indices].sort((left, right) => left - right).map((index) => values[index]);
}

const sceneText = (result: SceneSimulationResult): string => result.output.sceneSummary;

/**
 * Draw the review sample from a completed run.
 *
 * Pure and deterministic: the same `findings` and `content` always yield the same sample.
 */
export function selectNarrativeReviewSample(
  findings: LongRunFindings,
  content: LongRunContentSample,
  options: SampleOptions = {},
): NarrativeReviewSample {
  const worldDaySampleSize = options.worldDaySampleSize ?? DEFAULT_WORLD_DAY_SAMPLE_SIZE;
  const scenesPerWorldDay = options.scenesPerWorldDay ?? DEFAULT_SCENES_PER_WORLD_DAY;
  const exhibitSize = options.repetitionExhibitSize ?? DEFAULT_REPETITION_EXHIBIT_SIZE;

  // Scenes in authoring order — canon order, so "first/last of the day" is well defined.
  const scenesByWorldDay = new Map<number, SceneSimulationResult[]>();
  for (const result of content.scenes) {
    const day = result.scene.worldDay;
    scenesByWorldDay.set(day, [...(scenesByWorldDay.get(day) ?? []), result]);
  }
  const worldDaysInRun = [...scenesByWorldDay.keys()].sort((left, right) => left - right);
  const worldDaysSampled = evenlySpaced(worldDaysInRun, worldDaySampleSize);

  const identicalCounts = new Map<string, number>();
  for (const result of content.scenes) {
    const digest = sceneContentDigest(result);
    identicalCounts.set(digest, (identicalCounts.get(digest) ?? 0) + 1);
  }

  const scenes: ReviewScene[] = worldDaysSampled.flatMap((worldDay) =>
    evenlySpaced(scenesByWorldDay.get(worldDay) ?? [], scenesPerWorldDay).map((result) => {
      const digest = sceneContentDigest(result);
      return {
        worldDay,
        timeSlot: result.scene.timeSlot,
        sceneId: result.scene.sceneId,
        locationId: result.scene.locationId,
        participantIds: [...result.scene.participantIds],
        arcIds: [...result.scene.arcIds],
        trigger: result.scene.trigger,
        dramaticPressure: result.scene.dramaticPressure,
        sceneSummary: result.output.sceneSummary,
        keyActions: result.output.keyActions.map(({ characterId, action }) => ({ characterId, action })),
        dialogue: result.output.dialogueHighlights.map(({ characterId, text }) => ({ characterId, text })),
        publicSummaries: result.output.proposedEvents.map(({ publicSummary }) => publicSummary ?? ''),
        safetyLabel: result.safety.label,
        safetyReasonCodes: [...result.safety.reasonCodes],
        safetyWarningCodes: [...result.safety.warningCodes],
        reviewStatus: result.reviewStatus,
        contentDigest: digest,
        identicalScenesInRun: identicalCounts.get(digest) ?? 1,
      };
    }),
  );

  const sampledDays = new Set(worldDaysSampled);
  const episodes: ReviewEpisode[] = content.episodes
    .filter(({ worldDay }) => sampledDays.has(worldDay))
    .map((row) => ({
      worldDay: row.worldDay,
      episodeNumber: row.episodeNumber,
      status: row.status,
      withheld: !row.episode,
      title: row.episode?.title ?? '',
      headline: row.episode?.headline ?? '',
      oneLineSummary: row.episode?.oneLineSummary ?? '',
      keyScenes: (row.episode?.keyScenes ?? []).map(({ title, summary }) => ({ title, summary })),
      relationshipChanges: (row.episode?.relationshipChanges ?? []).map(({ summary }) => summary),
      newQuestions: [...(row.episode?.newQuestions ?? [])],
      resolvedQuestions: [...(row.episode?.resolvedQuestions ?? [])],
      nextEpisodeTease: row.episode?.nextEpisodeTease ?? '',
      arcIds: [...(row.episode?.arcIds ?? [])],
      characterIds: [...(row.episode?.characterIds ?? [])],
      sourceEventCount: row.episode?.sourceEventIds.length ?? 0,
      safetyClassificationId: row.safetyClassificationId,
    }));

  const firstSceneByDigest = new Map<string, SceneSimulationResult>();
  for (const result of content.scenes) {
    const digest = sceneContentDigest(result);
    if (!firstSceneByDigest.has(digest)) firstSceneByDigest.set(digest, result);
  }
  const repetitionExhibit = [...identicalCounts.entries()]
    .filter(([, count]) => count > 1)
    // Largest group first; digest breaks ties so the exhibit is stable across runs.
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, exhibitSize)
    .map(([digest, sceneCount]) => ({
      digest,
      sceneCount,
      sceneSummary: sceneText(firstSceneByDigest.get(digest)!),
    }));

  const signals: ReviewSignals = {
    acceptedEvents: findings.acceptedEvents,
    scenesInRun: findings.repetition.scenes,
    distinctSceneTexts: findings.repetition.distinctContentDigests,
    exactDuplicateRate: findings.repetition.duplicateRate,
    episodesInRun: findings.recapCoverage.episodes,
    charactersNeverAppeared: [...findings.appearance.neverAppeared],
    maxSlotsSinceMajorAppearance: findings.appearance.maxSlotsSinceMajorAppearance,
    appearanceThresholdSlots: findings.appearance.threshold,
    totalArcs: findings.arcs.totalArcs,
    resolvedArcs: findings.arcs.resolvedArcs.length,
    worldDaysWithoutActiveMajorArc: [...findings.arcs.worldDaysWithoutActiveMajorArc],
    safetyLabels: [...findings.safety.labels],
    scenesWithoutSafetyClassification: findings.safety.scenesWithoutClassification.length,
    scenesWithheldForReview: findings.safety.withheldSceneIds.length,
    eventsBypassingSafety: findings.safety.eventsBypassingSafety.length,
    episodesWithoutSafetyClassification: findings.safety.episodesWithoutClassification.length,
    worldDaysWithCoverageFindings: findings.recapCoverage.coverageFindings.map(({ worldDay }) => worldDay),
  };

  return {
    schemaVersion: 1,
    rubricVersion: RUBRIC_VERSION,
    seed: findings.seed,
    runDigest: findings.digest,
    protocol: {
      rule: `world days: ${worldDaySampleSize} evenly spaced across the run, first and last always included; scenes: ${scenesPerWorldDay} evenly spaced within each sampled world day, in canon order; episodes: every sampled world day's episode`,
      worldDaysInRun,
      worldDaysSampled,
      scenesPerWorldDay,
      scenesSampled: scenes.length,
      episodesSampled: episodes.length,
    },
    scenes,
    episodes,
    repetitionExhibit,
    signals,
  };
}

// --- packet rendering ----------------------------------------------------------

const bullet = (values: readonly string[], empty = '_none_'): string =>
  values.length === 0 ? empty : values.map((value) => `- ${value}`).join('\n');

function renderScene(scene: ReviewScene, index: number): string {
  const duplicate = scene.identicalScenesInRun > 1
    ? `**${scene.identicalScenesInRun} scenes in this run share this exact text.**`
    : 'Unique text in this run.';
  return [
    `### S${index + 1} — world day ${scene.worldDay}, ${scene.timeSlot} — \`${scene.sceneId}\``,
    '',
    `- Location: \`${scene.locationId}\``,
    `- Participants: ${scene.participantIds.join(', ') || '_none_'}`,
    `- Arcs: ${scene.arcIds.join(', ') || '_none_'}`,
    `- Trigger / pressure: ${scene.trigger} / ${scene.dramaticPressure}`,
    `- Safety: \`${scene.safetyLabel}\` (review status \`${scene.reviewStatus}\`), reasons: ${scene.safetyReasonCodes.join(', ') || 'none'}, warnings: ${scene.safetyWarningCodes.join(', ') || 'none'}`,
    `- Content digest \`${scene.contentDigest}\` — ${duplicate}`,
    '',
    '**Scene summary**',
    '',
    `> ${scene.sceneSummary}`,
    '',
    '**Key actions**',
    '',
    bullet(scene.keyActions.map(({ characterId, action }) => `\`${characterId}\`: ${action}`)),
    '',
    '**Dialogue**',
    '',
    bullet(scene.dialogue.map(({ characterId, text }) => `\`${characterId}\`: "${text}"`)),
    '',
    '**Public event summaries**',
    '',
    bullet(scene.publicSummaries),
  ].join('\n');
}

function renderEpisode(episode: ReviewEpisode): string {
  if (episode.withheld) {
    return [
      `### Episode ${episode.episodeNumber} — world day ${episode.worldDay}`,
      '',
      `Withheld or not assembled (status \`${episode.status}\`). No public text exists to review.`,
    ].join('\n');
  }
  return [
    `### Episode ${episode.episodeNumber} — world day ${episode.worldDay}`,
    '',
    `- Status: \`${episode.status}\`, safety classification: \`${episode.safetyClassificationId ?? 'none'}\``,
    `- Arcs: ${episode.arcIds.join(', ') || '_none_'} — characters: ${episode.characterIds.join(', ') || '_none_'}`,
    `- Derived from ${episode.sourceEventCount} accepted events`,
    '',
    `**${episode.title}**`,
    '',
    `> ${episode.headline}`,
    '',
    `One line: ${episode.oneLineSummary}`,
    '',
    '**Key scenes**',
    '',
    bullet(episode.keyScenes.map(({ title, summary }) => `**${title}** — ${summary}`)),
    '',
    '**Relationship changes**',
    '',
    bullet(episode.relationshipChanges),
    '',
    '**New questions**',
    '',
    bullet(episode.newQuestions),
    '',
    '**Resolved questions**',
    '',
    bullet(episode.resolvedQuestions),
    '',
    `Next-episode tease: ${episode.nextEpisodeTease || '_none_'}`,
  ].join('\n');
}

/**
 * Render the sample as the markdown review packet an evaluator scores against
 * `docs/narrative-quality-rubric.md`.
 *
 * Deterministic: same sample in, byte-identical markdown out, so a packet can be committed
 * as evidence and re-derived later to prove it was not edited.
 */
export function renderNarrativeReviewPacket(sample: NarrativeReviewSample): string {
  const { signals, protocol, seed } = sample;
  return [
    `# Narrative review packet — ${seed.worldId}, ${seed.worldDays} world days`,
    '',
    `Rubric version ${sample.rubricVersion} (\`docs/narrative-quality-rubric.md\`). Generated by`,
    '`convex/operations/narrativeReviewSample.ts`; regenerate with `npm run narrative:review-packet`.',
    '',
    '## Provenance',
    '',
    `- Seed: world \`${seed.worldId}\`, fixture \`${seed.fixtureId}\`, provider model \`${seed.providerModel}\``,
    `- Run: world days ${seed.startWorldDay}–${seed.startWorldDay + seed.worldDays - 1}, ${seed.timeSlotsPerWorldDay} time slots per day`,
    `- Run digest: \`${sample.runDigest}\``,
    `- Sampling rule: ${protocol.rule}`,
    `- Sampled world days: ${protocol.worldDaysSampled.join(', ')} (of ${protocol.worldDaysInRun.length} with scenes)`,
    `- Sampled ${protocol.scenesSampled} scenes and ${protocol.episodesSampled} episodes`,
    '',
    '## Automated signals (context, not the verdict)',
    '',
    'These come from the already-merged automated checks (ART-35, ART-54/55, ART-60). The',
    'reviewer is asked to judge what those checks cannot; they are printed so a reviewer',
    'knows what has already been proven.',
    '',
    `- Accepted events: ${signals.acceptedEvents} — scenes: ${signals.scenesInRun} — episodes: ${signals.episodesInRun}`,
    `- Distinct scene texts: ${signals.distinctSceneTexts} — exact duplicate rate: ${(signals.exactDuplicateRate * 100).toFixed(1)}%`,
    `- Characters that never appeared: ${signals.charactersNeverAppeared.join(', ') || 'none'}`,
    `- Max slots since a major appearance: ${signals.maxSlotsSinceMajorAppearance} (threshold ${signals.appearanceThresholdSlots})`,
    `- Arcs: ${signals.totalArcs} total, ${signals.resolvedArcs} resolved — world days with no active major arc: ${signals.worldDaysWithoutActiveMajorArc.join(', ') || 'none'}`,
    `- Safety labels seen: ${signals.safetyLabels.join(', ') || 'none'} — scenes unclassified: ${signals.scenesWithoutSafetyClassification} — scenes withheld: ${signals.scenesWithheldForReview} — events bypassing safety: ${signals.eventsBypassingSafety} — episodes unclassified: ${signals.episodesWithoutSafetyClassification}`,
    `- FR-G004 coverage findings (ART-35): ${signals.worldDaysWithCoverageFindings.join(', ') || 'none'}`,
    '',
    '## Repetition exhibit',
    '',
    signals.distinctSceneTexts === signals.scenesInRun
      ? '_No scene text repeats in this run._'
      : sample.repetitionExhibit
        .map(({ digest, sceneCount, sceneSummary }) =>
          `- \`${digest}\` — **${sceneCount} scenes** share this text: "${sceneSummary}"`)
        .join('\n'),
    '',
    '## Sampled scenes',
    '',
    sample.scenes.map(renderScene).join('\n\n'),
    '',
    '## Sampled episodes',
    '',
    sample.episodes.map(renderEpisode).join('\n\n'),
    '',
    '## Scoring sheet',
    '',
    `Score every dimension 0–${RUBRIC_MAX_SCORE} against \`docs/narrative-quality-rubric.md\`. Record evidence`,
    '(scene or episode ID) for every score below its threshold. A failed threshold produces a',
    'recorded finding; it never edits Canon.',
    '',
    '| ID | Dimension | PRD Section 19.5 question | Pass threshold | Score | Evidence |',
    '| --- | --- | --- | --- | --- | --- |',
    ...RUBRIC_DIMENSIONS.map((dimension) =>
      `| ${dimension.id} | ${dimension.name} | ${dimension.prdQuestion} | ${dimension.passThreshold}${dimension.hardGate ? ' (hard gate)' : ''} | | |`),
    '',
    '### Reviewer prompts',
    '',
    ...RUBRIC_DIMENSIONS.map((dimension) =>
      `- **${dimension.id} ${dimension.name}** — ${dimension.reviewerPrompt}\n  - Complements: ${dimension.complements}`),
    '',
  ].join('\n');
}

// --- running -------------------------------------------------------------------

export type NarrativeReviewRunInput = SampleOptions & {
  worldDays: number;
  startWorldDay?: number;
};

/**
 * Run the fixed-seed simulation and return both the machine findings and the review sample.
 *
 * No network, no credentials, no cost: it is ART-60's harness driving ART-4's deterministic
 * fake provider, so a reviewer can regenerate the exact packet they scored.
 */
export async function buildNarrativeReviewSample(
  input: NarrativeReviewRunInput,
): Promise<{ findings: LongRunFindings; sample: NarrativeReviewSample }> {
  let content: LongRunContentSample | undefined;
  const findings = await runLongRunSimulation({
    worldDays: input.worldDays,
    startWorldDay: input.startWorldDay,
    onContentSample: (value) => {
      content = value;
    },
  });
  if (!content) throw new Error('NARRATIVE_REVIEW_NO_CONTENT_SAMPLE');
  return { findings, sample: selectNarrativeReviewSample(findings, content, input) };
}
