/**
 * The Narrative evaluator (FR-M002 Character Consistency, Event Novelty, Dialogue Repetition;
 * PRD §16.2 重複場景比例 < 15%). ART-88.
 *
 * Pure: no Convex, no clock, no randomness, no I/O. Handed the accepted narrative evidence of a
 * window of world days, it returns the §16.2 repeated-scene ratio and its companions. The Convex
 * operator query and the long-run harness call the same function, so the number the 30- and 90-day
 * gates assert is the number an operator reads.
 *
 * ## The denominator, stated first
 *
 * `repeated_scene_ratio` is measured over ACCEPTED scenes: scenes whose Proposed Events reached
 * Canon (joined through `metadata.sceneId`), in accepted order. A scene the safety gate withheld
 * never reached an audience and is excluded — counted and reported, not folded into either side.
 * ART-60's `repetition.duplicateRate` measured every authored scene and was never asserted; a
 * ratio over a different population would be a different number, so this one names its own.
 *
 * ## Exact, near, and structural — three different things
 *
 *  - **Exact duplicate**: the normalised scene text (summary, key actions, dialogue, public
 *    summaries; identifiers masked) is identical to an earlier accepted scene's.
 *  - **Near duplicate**: character 3-gram Jaccard against some earlier accepted scene is at least
 *    {@link NEAR_DUPLICATE_SIMILARITY}. This is what a digest cannot see and a reader can.
 *  - **Template reuse**: the structural signature (quoted spans and slots collapsed) matches an
 *    earlier scene's. A template with more slots is a larger output space and is still a template;
 *    this ratio is what says so when the other two are clean.
 *
 * The §16.2 ratio counts exact OR near duplicates. Template reuse is reported beside it with no
 * PRD target, so it can be read but cannot be gamed into the headline number.
 *
 * ## Why no threshold is tuned to the fixture
 *
 * `NEAR_DUPLICATE_SIMILARITY` is a property of the measure — the point at which two zh-Hant
 * sentences of this length share most of their grams — not of what the fixed seed happens to
 * produce. It is versioned with the evaluator, and the harness test pins the ratio against an
 * absolute denominator so the ratio cannot be improved by authoring fewer scenes.
 *
 * ## Character consistency is two components, honestly
 *
 * Canon's persona gate (`assessPersonaDeviations`, FR-B003) is structural: it sees occupation,
 * membership and relationship reversals, never voice, and it REFUSES unjustified ones, so accepted
 * history carries only flagged, justified deviations. That rate is one component. The other is
 * what the gate cannot see: `voice_distinctiveness`, the share of dialogue lines that no OTHER
 * character also says verbatim. A cast that all speak one sentence scores zero here whatever the
 * projection says.
 */

import type { AcceptedEvent, WorldProjection } from '../canon/model';
import { buildCharacterSummaries, type PersonaAnchor } from '../canon/personaDeviation';
import {
  composeScore,
  dedupeFindings,
  finishReport,
  observeMetric,
  uniqueDays,
  type EvaluationReport,
  type EvaluatorDefinition,
  type EvidenceRef,
  type FindingSeverity,
  type MetricDefinition,
  type QualityFinding,
} from './evaluator';
import { fnv1a64, nearestEarlier, normalizeNarrative, structuralSignature } from './textSimilarity';

export const NARRATIVE_EVALUATOR_ID = 'narrative';
export const NARRATIVE_EVALUATOR_VERSION = 1;

/** Jaccard over character 3-grams at or above which two texts are one text to a reader. */
export const NEAR_DUPLICATE_SIMILARITY = 0.8;
/** How many earlier accepted events an event is compared against for novelty. */
export const NOVELTY_LOOKBACK_EVENTS = 30;
/** Below this similarity to every event in the lookback, an event says something new. */
export const NOVEL_EVENT_MAX_SIMILARITY = 0.6;

export const NARRATIVE_FINDING_CODES = {
  /** An accepted scene's normalised text is identical to an earlier accepted scene's. */
  SCENE_EXACT_DUPLICATE: 'severe',
  /** An accepted scene is a near-duplicate of an earlier accepted scene. */
  SCENE_NEAR_DUPLICATE: 'severe',
  /** An accepted scene was written from the same template as an earlier one. */
  SCENE_TEMPLATE_REUSED: 'minor',
  /** A dialogue line repeats (exactly or nearly) an earlier line in the window. */
  DIALOGUE_REPEATED: 'minor',
  /** One normalised line is spoken by two or more different characters: the cast has one voice. */
  VOICE_COLLAPSED: 'severe',
  /** An accepted event's public summary is a near-duplicate of one in the recent lookback. */
  EVENT_NOT_NOVEL: 'minor',
  /** Canon flagged a justified persona deviation on this accepted event. Reported, not judged. */
  PERSONA_DEVIATION_FLAGGED: 'minor',
} as const satisfies Record<string, FindingSeverity>;

export type NarrativeFindingCode = keyof typeof NARRATIVE_FINDING_CODES;

const METRIC_REPEATED: MetricDefinition = {
  key: 'repeated_scene_ratio',
  prdName: '重複場景比例',
  numerator: 'accepted scenes whose normalised text is an exact or near duplicate (Jaccard ≥ 0.8 over character 3-grams, identifiers masked) of an earlier accepted scene in the window',
  denominator: 'accepted scenes in the window (scenes whose proposals reached Canon; withheld scenes excluded)',
  target: 0.15,
  direction: 'atMost',
};
const METRIC_EXACT: MetricDefinition = {
  key: 'exact_duplicate_scene_ratio',
  prdName: '重複場景比例（完全相同）',
  numerator: 'accepted scenes whose normalised text is identical to an earlier accepted scene',
  denominator: 'accepted scenes in the window',
  target: null,
  direction: 'atMost',
};
const METRIC_TEMPLATE: MetricDefinition = {
  key: 'template_reuse_ratio',
  prdName: '重複場景結構',
  numerator: 'accepted scenes whose structural signature (quoted spans and identifiers collapsed) matches an earlier accepted scene',
  denominator: 'accepted scenes in the window',
  target: null,
  direction: 'atMost',
};
const METRIC_DIALOGUE: MetricDefinition = {
  key: 'dialogue_repetition_ratio',
  prdName: 'Dialogue Repetition',
  numerator: 'dialogue lines in accepted scenes that exactly or nearly repeat an earlier line in the window',
  denominator: 'dialogue lines in accepted scenes',
  target: null,
  direction: 'atMost',
};
const METRIC_VOICE: MetricDefinition = {
  key: 'voice_distinctiveness',
  prdName: 'Character Consistency（聲音）',
  numerator: 'dialogue lines whose normalised text is spoken by exactly one character in the window',
  denominator: 'dialogue lines in accepted scenes',
  target: null,
  direction: 'atLeast',
};
const METRIC_PERSONA: MetricDefinition = {
  key: 'persona_deviation_rate',
  prdName: 'Character Consistency（人設）',
  numerator: 'accepted events carrying at least one FR-B003 persona deviation flag',
  denominator: 'accepted events with at least one participant who has a persona anchor',
  target: null,
  direction: 'atMost',
};
const METRIC_NOVELTY: MetricDefinition = {
  key: 'event_novelty_ratio',
  prdName: 'Event Novelty',
  numerator: `accepted events whose public summary is below ${NOVEL_EVENT_MAX_SIMILARITY} Jaccard to every one of the previous ${NOVELTY_LOOKBACK_EVENTS} accepted events' summaries`,
  denominator: 'accepted events with a public summary, after the first',
  target: null,
  direction: 'atLeast',
};

export const NARRATIVE_EVALUATOR: EvaluatorDefinition = {
  evaluatorId: NARRATIVE_EVALUATOR_ID,
  version: NARRATIVE_EVALUATOR_VERSION,
  metrics: [METRIC_REPEATED, METRIC_EXACT, METRIC_TEMPLATE, METRIC_DIALOGUE, METRIC_VOICE, METRIC_PERSONA, METRIC_NOVELTY],
  score: {
    key: 'character_consistency',
    prdName: 'Character Consistency',
    components: [
      { key: 'voice', metricKey: METRIC_VOICE.key, weight: 0.5, transform: 'rate' },
      { key: 'persona', metricKey: METRIC_PERSONA.key, weight: 0.5, transform: 'complement' },
    ],
  },
  findingCodes: NARRATIVE_FINDING_CODES,
};

// --- evidence ---------------------------------------------------------------

export type NarrativeSceneEvidence = {
  sceneId: string;
  worldDay: number;
  timeSlot: string;
  /** Position in accepted order: the lowest accepted sequence number among the scene's events. */
  acceptedSequenceNumber: number | null;
  locationId: string;
  participantIds: readonly string[];
  arcIds: readonly string[];
  sceneSummary: string;
  keyActions: ReadonlyArray<{ characterId: string; action: string }>;
  dialogue: ReadonlyArray<{ characterId: string; text: string }>;
  publicSummaries: readonly string[];
  /** The scene was withheld by safety review and never reached an audience. */
  withheld: boolean;
};

export type NarrativeEvidence = {
  worldId: string;
  fromWorldDay: number;
  toWorldDay: number;
  scenes: readonly NarrativeSceneEvidence[];
  /** The window's accepted events, ascending by sequence number. */
  events: readonly AcceptedEvent[];
  /** Every identifier to mask before comparing prose: character, location, arc, world ids. */
  identifiers: readonly string[];
  /** FR-B003 anchors by character id; empty when the world carries no personas. */
  personaAnchors: Readonly<Record<string, PersonaAnchor>>;
  /** The projection at the window's start, for the persona fold. */
  originProjection: WorldProjection;
  scanLimitReached: boolean;
};

const sceneRef = (scene: NarrativeSceneEvidence, code?: string): EvidenceRef => ({
  kind: 'scene', id: scene.sceneId, worldDay: scene.worldDay, ...(code ? { code } : {}),
});

/** The prose of a scene as one normalised string, identifiers masked. */
export function normalizedSceneText(scene: NarrativeSceneEvidence, identifiers: readonly string[]): string {
  return normalizeNarrative([
    scene.sceneSummary,
    ...scene.keyActions.map(({ action }) => action),
    ...scene.dialogue.map(({ text }) => text),
    ...scene.publicSummaries,
  ].join(' '), identifiers);
}

/** The template a scene was written from, as a grouping key. */
export function sceneTemplateSignature(scene: NarrativeSceneEvidence, identifiers: readonly string[]): string {
  return structuralSignature([
    scene.sceneSummary,
    ...scene.keyActions.map(({ action }) => action),
    ...scene.dialogue.map(({ text }) => text),
    ...scene.publicSummaries,
  ].join('|'), identifiers);
}

const byAcceptedOrder = (left: NarrativeSceneEvidence, right: NarrativeSceneEvidence): number =>
  (left.acceptedSequenceNumber ?? Number.MAX_SAFE_INTEGER) - (right.acceptedSequenceNumber ?? Number.MAX_SAFE_INTEGER)
  || left.sceneId.localeCompare(right.sceneId);

/** Evaluate one window of accepted narrative evidence. */
export function evaluateNarrative(evidence: NarrativeEvidence): EvaluationReport {
  const { worldId, identifiers } = evidence;
  const findings: QualityFinding[] = [];
  const push = (code: NarrativeFindingCode, subjectId: string, worldDay: number, refs: EvidenceRef[], detail: string) => {
    findings.push({ code, severity: NARRATIVE_FINDING_CODES[code], subjectId, worldDay, evidence: refs, detail });
  };

  const inWindow = evidence.scenes.filter((scene) => scene.worldDay >= evidence.fromWorldDay && scene.worldDay <= evidence.toWorldDay);
  const accepted = inWindow.filter((scene) => !scene.withheld && scene.acceptedSequenceNumber !== null).sort(byAcceptedOrder);
  const withheld = inWindow.length - accepted.length;

  // --- scene repetition -------------------------------------------------------
  const texts = accepted.map((scene) => normalizedSceneText(scene, identifiers));
  const exactSeen = new Map<string, NarrativeSceneEvidence>();
  const templateSeen = new Map<string, NarrativeSceneEvidence>();
  const nearest = nearestEarlier(texts, NEAR_DUPLICATE_SIMILARITY);
  let exactDuplicates = 0;
  let repeated = 0;
  let templateReuse = 0;
  accepted.forEach((scene, index) => {
    const text = texts[index];
    const key = fnv1a64(text);
    const earlierExact = exactSeen.get(key);
    const match = nearest[index];
    if (earlierExact) {
      exactDuplicates += 1;
      repeated += 1;
      push('SCENE_EXACT_DUPLICATE', scene.sceneId, scene.worldDay, [sceneRef(scene), sceneRef(earlierExact)],
        `scene ${scene.sceneId} repeats ${earlierExact.sceneId} verbatim once identifiers are masked`);
    } else if (match) {
      repeated += 1;
      const earlier = accepted[match.index];
      push('SCENE_NEAR_DUPLICATE', scene.sceneId, scene.worldDay, [sceneRef(scene), sceneRef(earlier)],
        `scene ${scene.sceneId} is ${match.similarity.toFixed(2)} similar to ${earlier.sceneId}`);
    } else {
      exactSeen.set(key, scene);
    }
    const signature = sceneTemplateSignature(scene, identifiers);
    const earlierTemplate = templateSeen.get(signature);
    if (earlierTemplate) {
      templateReuse += 1;
      push('SCENE_TEMPLATE_REUSED', scene.sceneId, scene.worldDay, [sceneRef(scene), sceneRef(earlierTemplate)],
        `scene ${scene.sceneId} shares its structure with ${earlierTemplate.sceneId}`);
    } else {
      templateSeen.set(signature, scene);
    }
  });

  // --- dialogue repetition and voice ------------------------------------------
  const lines = accepted.flatMap((scene) => scene.dialogue.map((line) => ({
    scene, characterId: line.characterId, normalized: normalizeNarrative(line.text, identifiers),
  })));
  const lineNearest = nearestEarlier(lines.map(({ normalized }) => normalized), NEAR_DUPLICATE_SIMILARITY);
  let repeatedLines = 0;
  lines.forEach((line, index) => {
    const match = lineNearest[index];
    if (!match) return;
    repeatedLines += 1;
    const earlier = lines[match.index];
    push('DIALOGUE_REPEATED', `${line.scene.sceneId}:${line.characterId}`, line.scene.worldDay,
      [sceneRef(line.scene), sceneRef(earlier.scene), { kind: 'accepted_event', id: line.characterId }],
      `a line by ${line.characterId} in ${line.scene.sceneId} repeats a line by ${earlier.characterId} in ${earlier.scene.sceneId} (${match.similarity.toFixed(2)})`);
  });
  const speakersByLine = new Map<string, Set<string>>();
  for (const line of lines) {
    const speakers = speakersByLine.get(line.normalized) ?? new Set<string>();
    speakers.add(line.characterId);
    speakersByLine.set(line.normalized, speakers);
  }
  let distinctVoiceLines = 0;
  const collapsedReported = new Set<string>();
  for (const line of lines) {
    const speakers = speakersByLine.get(line.normalized)!;
    if (speakers.size === 1) {
      distinctVoiceLines += 1;
    } else if (!collapsedReported.has(line.normalized)) {
      collapsedReported.add(line.normalized);
      push('VOICE_COLLAPSED', fnv1a64(line.normalized), line.scene.worldDay,
        [...speakers].sort().map((characterId) => ({ kind: 'accepted_event' as const, id: characterId })),
        `one line is spoken verbatim by ${speakers.size} different characters`);
    }
  }

  // --- event novelty ----------------------------------------------------------
  const summarised = evidence.events
    .filter((event) => event.worldDay >= evidence.fromWorldDay && event.worldDay <= evidence.toWorldDay)
    .filter((event) => typeof event.publicSummary === 'string' && event.publicSummary.trim().length > 0)
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  const summaryTexts = summarised.map((event) => normalizeNarrative(event.publicSummary ?? '', identifiers));
  let novelEvents = 0;
  let noveltyDenominator = 0;
  {
    // Bounded lookback: the same inverted-index walk, restarted so an event is compared only
    // against the previous NOVELTY_LOOKBACK_EVENTS summaries.
    for (let index = 1; index < summaryTexts.length; index += 1) {
      const start = Math.max(0, index - NOVELTY_LOOKBACK_EVENTS);
      const window = summaryTexts.slice(start, index + 1);
      const match = nearestEarlier(window, NOVEL_EVENT_MAX_SIMILARITY)[window.length - 1];
      noveltyDenominator += 1;
      if (match === null) {
        novelEvents += 1;
      } else {
        const event = summarised[index];
        const earlier = summarised[start + match.index];
        push('EVENT_NOT_NOVEL', event.eventId, event.worldDay,
          [{ kind: 'accepted_event', id: event.eventId, worldDay: event.worldDay }, { kind: 'accepted_event', id: earlier.eventId, worldDay: earlier.worldDay }],
          `event ${event.eventId} restates ${earlier.eventId} (${match.similarity.toFixed(2)})`);
      }
    }
  }

  // --- persona deviation (structural half of character consistency) ----------
  const anchors = evidence.personaAnchors;
  const anchored = evidence.events.filter((event) => event.participantIds.some((characterId) => anchors[characterId] !== undefined));
  let flaggedEvents = 0;
  if (Object.keys(anchors).length > 0 && evidence.events.length > 0) {
    const summaries = buildCharacterSummaries(evidence.originProjection, [...evidence.events], { ...anchors });
    const flaggedEventIds = new Set<string>();
    for (const summary of Object.values(summaries)) {
      for (const flag of summary.flags) {
        if (flag.worldDay < evidence.fromWorldDay || flag.worldDay > evidence.toWorldDay) continue;
        flaggedEventIds.add(flag.eventId);
        push('PERSONA_DEVIATION_FLAGGED', flag.eventId, flag.worldDay,
          [{ kind: 'accepted_event', id: flag.eventId, worldDay: flag.worldDay }, { kind: 'accepted_event', id: flag.characterId, code: flag.severity }],
          `${flag.characterId} deviated (${flag.signals.map(({ kind }) => kind).join(', ')}) with ${flag.justifications.length} justification(s)`);
      }
    }
    flaggedEvents = flaggedEventIds.size;
  }
  const anchoredInWindow = anchored.filter((event) => event.worldDay >= evidence.fromWorldDay && event.worldDay <= evidence.toWorldDay).length;

  const metrics = [
    observeMetric(METRIC_REPEATED, repeated, accepted.length, withheld, withheld === 0 ? null : 'scenes withheld by safety review never reached an audience'),
    observeMetric(METRIC_EXACT, exactDuplicates, accepted.length),
    observeMetric(METRIC_TEMPLATE, templateReuse, accepted.length),
    observeMetric(METRIC_DIALOGUE, repeatedLines, lines.length),
    observeMetric(METRIC_VOICE, distinctVoiceLines, lines.length),
    observeMetric(METRIC_PERSONA, flaggedEvents, Object.keys(anchors).length === 0 ? 0 : anchoredInWindow, 0,
      Object.keys(anchors).length === 0 ? 'the world carries no persona anchors' : null),
    observeMetric(METRIC_NOVELTY, novelEvents, noveltyDenominator),
  ];

  const evaluatedDays = uniqueDays(accepted.map(({ worldDay }) => worldDay));
  const allDays: number[] = [];
  for (let day = evidence.fromWorldDay; day <= evidence.toWorldDay; day += 1) allDays.push(day);
  const evaluatedSet = new Set(evaluatedDays);

  return finishReport({
    evaluatorId: NARRATIVE_EVALUATOR_ID,
    evaluatorVersion: NARRATIVE_EVALUATOR_VERSION,
    worldId,
    window: { fromWorldDay: evidence.fromWorldDay, toWorldDay: evidence.toWorldDay },
    metrics,
    score: composeScore(NARRATIVE_EVALUATOR.score!, metrics),
    findings: dedupeFindings(findings),
    coverage: {
      worldDaysEvaluated: evaluatedDays,
      worldDaysWithoutEvidence: allDays.filter((day) => !evaluatedSet.has(day)),
      scanLimitReached: evidence.scanLimitReached,
    },
  });
}
