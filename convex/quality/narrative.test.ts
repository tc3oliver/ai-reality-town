/**
 * The Narrative evaluator (FR-M002 Character Consistency / Event Novelty / Dialogue Repetition;
 * PRD §16.2 重複場景比例 < 15%). ART-88.
 *
 * ## What each case has to prove, and why one assertion is never enough
 *
 * A repetition ratio can be wrong in three independent ways: the evaluator can miss a repeat, it
 * can report the repeat but roll it into the wrong metric, or it can report both and count the
 * wrong population underneath. So every case below asserts the finding CODE, the metric
 * NUMERATOR and the metric DENOMINATOR. The denominator is the one most easily wrong and the one
 * a reader of the ratio cannot recover, which is why the withheld-scene case exists at all.
 *
 * ## The fixtures are zh-Hant prose, deliberately
 *
 * The measure is character 3-gram Jaccard, and its behaviour on hanzi is not the behaviour it has
 * on English words — a one-character edit in a 56-character sentence moves three trigrams, not
 * one token. Fixtures written in ASCII would pass while telling us nothing about the text this
 * evaluator is pointed at. The similarity arithmetic itself is pinned separately in
 * `textSimilarity.test.ts`; here the numbers are only ever asserted through the report.
 *
 * ## Persona anchors come from the seed, not from a literal
 *
 * `personaAnchorFromSeed` over `mistwoodCharacterSeed.characters` is what the commit pipeline
 * does, so a reworded seed changes this fixture the same way it changes production. A hand-written
 * anchor would keep passing after the seed stopped matching it.
 */

import type { AcceptedEvent, StateChange } from '../canon/model';
import { MISTWOOD_PUBLIC_WORLD_ID, mistwoodCharacterSeed, mistwoodWorldConfiguration } from '../canon/mistwoodSeed';
import { personaAnchorFromSeed, type PersonaAnchor } from '../canon/personaDeviation';
import { buildWorldImportPlan } from '../canon/worldConfig';
import { CANON_VALIDATION_VERSION } from '../shared/constants';
import { deriveEventId } from '../shared/ids';
import type { EvaluationReport, QualityFinding } from './evaluator';
import {
  NARRATIVE_FINDING_CODES,
  evaluateNarrative,
  type NarrativeEvidence,
  type NarrativeSceneEvidence,
} from './narrative';

const WORLD_ID = MISTWOOD_PUBLIC_WORLD_ID;

const YINGXUE = 'lin-yingxue';
const WENRUI = 'gao-wenrui';
const PEILAN = 'pei-lan';

const PAPER = 'mistwood-paper';
const HALL = 'mistwood-hall';
const COUNCIL = 'mistwood-council';

/** Every id the evaluator masks before comparing prose, as the operator query assembles it. */
const IDENTIFIERS = [
  ...mistwoodCharacterSeed.characters.map(({ id }) => id),
  ...mistwoodWorldConfiguration.locations.map(({ id }) => id),
  ...mistwoodWorldConfiguration.organizations.map(({ id }) => id),
];

/** The seeded `initial` snapshot the world import writes; see CLAUDE.md §9 on `resolveWorldBaseline`. */
const seededProjection = () => buildWorldImportPlan(mistwoodWorldConfiguration, 0).initialSnapshot.projection;

const seedAnchors = (): Record<string, PersonaAnchor> => Object.fromEntries(
  mistwoodCharacterSeed.characters
    .map((character) => [character.id, personaAnchorFromSeed(character.id, character)] as const)
    .filter((entry): entry is readonly [string, PersonaAnchor] => entry[1] !== null),
);

// --- prose ------------------------------------------------------------------

const COUNCIL_SCENE = '裴嵐在議事廳把附件清單念過一遍，聲音不高，卻讓在場的人都停下手邊的事。';
const HARBOUR_SCENE = '高文瑞走到窗邊，看著碼頭方向的燈一盞一盞熄掉，沒有再說任何話。';

/** Two renderings of ONE template: identical except for the words inside 「…」. */
const SLOT_SCENE = (slot: string): string =>
  `高文瑞在議事廳裡把修繕案的時程表攤開，對眾人說「這一次一定要把${slot}修好」，語氣平穩。`;
const SLOT_ACTION = '裴嵐在旁邊逐條核對舊會議紀錄的附件編號。';

const NOVEL_SCENES = [
  '林映雪在報社的長桌上攤開泛黃的剪報，一頁一頁比對日期。',
  '何俊蹲在水車旁量水位，記下今天比昨天低了一截。',
  '邱安把索引卡放回抽屜，鎖上，然後把鑰匙收進口袋。',
  '盧珊在客棧門口掛上新的燈籠，順手把台階掃乾淨。',
];

const NOVEL_SUMMARIES = [
  '議事廳上午討論了修繕案的時程。',
  '水車旁的水位比前一天下降。',
  '檔案室的索引卡重新歸位。',
  '客棧門口換上了新的燈籠。',
];

const LINE_DECLINE = '這件事我會親自跟議會說明，你不必再問了。';
/** The same line as {@link LINE_DECLINE} once punctuation is dropped — a normalisation, not a copy. */
const LINE_DECLINE_REPUNCTUATED = '這件事我會親自跟議會說明；你不必再問了';
const LINE_LEDGER = '帳冊上的數字對不起來，我得從頭再查一次。';
const LINE_RAIN = '今晚的雨會下到天亮，你先把窗關好。';

/** A phrase that exists nowhere but the fixtures, so its absence from a report is checkable. */
const MARKER = '紫霧鐘樓的鑰匙';

// --- fixtures ---------------------------------------------------------------

const scene = (
  input: Partial<NarrativeSceneEvidence> & { sceneId: string; acceptedSequenceNumber: number | null },
): NarrativeSceneEvidence => ({
  worldDay: 0,
  timeSlot: 'morning',
  locationId: HALL,
  participantIds: [WENRUI, PEILAN],
  arcIds: [],
  sceneSummary: '',
  keyActions: [],
  dialogue: [],
  publicSummaries: [],
  withheld: false,
  ...input,
});

/**
 * One accepted event, with its id DERIVED from `(worldId, sequenceNumber)` exactly as the commit
 * step derives it — a fixture must not be able to invent an identity the running system could not
 * produce. Sequence numbers are dense from 0 because `buildCharacterSummaries` folds them through
 * the reducer, which refuses a gap.
 */
const acceptedEvent = (input: Partial<AcceptedEvent> & { sequenceNumber: number }): AcceptedEvent => ({
  schemaVersion: 1,
  worldId: WORLD_ID,
  idempotencyKey: `mistwood-scene-${input.sequenceNumber}`,
  proposedBy: { type: 'director' },
  worldDay: 0,
  timeSlot: 'morning',
  eventType: 'conversation',
  locationId: HALL,
  participantIds: [WENRUI, PEILAN],
  causedByEventIds: [],
  stateChanges: [],
  eventId: deriveEventId(WORLD_ID, input.sequenceNumber),
  acceptedAt: 1_700_000_000_000 + input.sequenceNumber,
  validationVersion: CANON_VALIDATION_VERSION,
  traceId: `trace-${input.sequenceNumber}`,
  ...input,
});

const evidence = (overrides: Partial<NarrativeEvidence> = {}): NarrativeEvidence => ({
  worldId: WORLD_ID,
  fromWorldDay: 0,
  toWorldDay: 0,
  scenes: [],
  events: [],
  identifiers: IDENTIFIERS,
  personaAnchors: {},
  originProjection: seededProjection(),
  scanLimitReached: false,
  ...overrides,
});

const codes = (findings: readonly QualityFinding[]): string[] => findings.map(({ code }) => code);

const metricOf = (report: EvaluationReport, key: string) => {
  const observation = report.metrics.find((entry) => entry.key === key);
  if (!observation) throw new Error(`report carries no metric '${key}'`);
  return observation;
};

const componentOf = (report: EvaluationReport, key: string) => {
  const component = report.score?.components.find((entry) => entry.key === key);
  if (!component) throw new Error(`report carries no score component '${key}'`);
  return component;
};

const findingOf = (findings: readonly QualityFinding[], code: string): QualityFinding => {
  const found = findings.find((entry) => entry.code === code);
  if (!found) throw new Error(`findings carry no '${code}': ${JSON.stringify(codes(findings))}`);
  return found;
};

/** `numerator/denominator` as one value, so a case cannot assert half of a ratio. */
const ratio = (report: EvaluationReport, key: string): [number, number] => {
  const observation = metricOf(report, key);
  return [observation.numerator, observation.denominator];
};

describe('the fixture matches the seed it claims to come from', () => {
  it('reads the mayor’s anchor out of the seed rather than a literal', () => {
    const anchors = seedAnchors();

    expect(anchors[WENRUI]).toEqual({
      characterId: WENRUI,
      occupation: 'Mayor',
      organizationIds: [COUNCIL],
      personalityTraits: ['controlled', 'persuasive', 'risk-averse'],
      values: ['order', 'legacy'],
    });
    expect(Object.keys(anchors)).toHaveLength(mistwoodCharacterSeed.characters.length);
  });

  it('fixes the severity of every finding code it can emit', () => {
    expect(NARRATIVE_FINDING_CODES).toEqual({
      SCENE_EXACT_DUPLICATE: 'severe',
      SCENE_NEAR_DUPLICATE: 'severe',
      SCENE_TEMPLATE_REUSED: 'minor',
      DIALOGUE_REPEATED: 'minor',
      VOICE_COLLAPSED: 'severe',
      EVENT_NOT_NOVEL: 'minor',
      PERSONA_DEVIATION_FLAGGED: 'minor',
    });
  });
});

describe('FR-M002 narrative: a repetitive window', () => {
  /** Scenes 2 and 4 are verbatim copies of scene 1; scene 3 is its own scene. */
  const repetitive = (): EvaluationReport => evaluateNarrative(evidence({
    scenes: [
      scene({ sceneId: 'scene-1', acceptedSequenceNumber: 0, sceneSummary: COUNCIL_SCENE }),
      scene({ sceneId: 'scene-2', acceptedSequenceNumber: 1, sceneSummary: COUNCIL_SCENE }),
      scene({ sceneId: 'scene-3', acceptedSequenceNumber: 2, sceneSummary: HARBOUR_SCENE }),
      scene({ sceneId: 'scene-4', acceptedSequenceNumber: 3, sceneSummary: COUNCIL_SCENE }),
    ],
  }));

  it('charges the copies and never the original', () => {
    const report = repetitive();
    const duplicates = report.findings.filter(({ code }) => code === 'SCENE_EXACT_DUPLICATE');

    expect(duplicates.map(({ subjectId }) => subjectId)).toEqual(['scene-2', 'scene-4']);
    expect(duplicates[0].severity).toBe('severe');
    // Both copies point back at the ORIGINAL, not at each other: the first occurrence stays in
    // `exactSeen`, so re-running over a longer window cannot change what a repeat points at.
    for (const duplicate of duplicates) {
      expect(duplicate.evidence).toContainEqual({ kind: 'scene', id: 'scene-1', worldDay: 0 });
      expect(duplicate.detail).toContain('scene-1');
    }
  });

  it('reports 2/4 exact and 2/4 repeated, and misses the §16.2 target', () => {
    const report = repetitive();

    expect(ratio(report, 'exact_duplicate_scene_ratio')).toEqual([2, 4]);
    expect(ratio(report, 'repeated_scene_ratio')).toEqual([2, 4]);
    expect(metricOf(report, 'repeated_scene_ratio').rate).toBe(0.5);
    expect(metricOf(report, 'repeated_scene_ratio').target).toBe(0.15);
    expect(metricOf(report, 'repeated_scene_ratio').meetsTarget).toBe(false);
    // A verbatim copy is an exact duplicate, never ALSO a near duplicate: the ratio counts each
    // repeated scene once.
    expect(codes(report.findings)).not.toContain('SCENE_NEAR_DUPLICATE');
    expect(ratio(report, 'template_reuse_ratio')).toEqual([2, 4]);
  });
});

describe('FR-M002 narrative: a near duplicate a digest cannot see', () => {
  /** One template, one slot changed: 「水道」 becomes 「橋面」 and nothing else moves. */
  const nearDuplicate = (): EvaluationReport => evaluateNarrative(evidence({
    scenes: [
      scene({
        sceneId: 'scene-a', acceptedSequenceNumber: 0,
        sceneSummary: SLOT_SCENE('水道'),
        keyActions: [{ characterId: PEILAN, action: SLOT_ACTION }],
      }),
      scene({
        sceneId: 'scene-b', acceptedSequenceNumber: 1,
        sceneSummary: SLOT_SCENE('橋面'),
        keyActions: [{ characterId: PEILAN, action: SLOT_ACTION }],
      }),
    ],
  }));

  it('flags the later scene as NEAR, not exact, and counts it once', () => {
    const report = nearDuplicate();
    const finding = findingOf(report.findings, 'SCENE_NEAR_DUPLICATE');

    expect(finding.severity).toBe('severe');
    expect(finding.subjectId).toBe('scene-b');
    expect(finding.evidence).toContainEqual({ kind: 'scene', id: 'scene-a', worldDay: 0 });
    // The measured similarity, published in the detail so an operator can see how close it was.
    expect(finding.detail).toContain('0.86');

    expect(codes(report.findings)).not.toContain('SCENE_EXACT_DUPLICATE');
    expect(ratio(report, 'exact_duplicate_scene_ratio')).toEqual([0, 2]);
    // This is the ART-60 gap: a content digest reports 0/2 here, and a reader reports one scene.
    expect(ratio(report, 'repeated_scene_ratio')).toEqual([1, 2]);
    expect(metricOf(report, 'repeated_scene_ratio').rate).toBe(0.5);
  });

  it('reports the shared template beside the ratio', () => {
    const report = nearDuplicate();
    const finding = findingOf(report.findings, 'SCENE_TEMPLATE_REUSED');

    expect(finding.severity).toBe('minor');
    expect(finding.subjectId).toBe('scene-b');
    expect(finding.evidence).toContainEqual({ kind: 'scene', id: 'scene-a', worldDay: 0 });
    expect(ratio(report, 'template_reuse_ratio')).toEqual([1, 2]);
    // No PRD target, so template reuse can be read but cannot be gamed into the headline number.
    expect(metricOf(report, 'template_reuse_ratio').target).toBeNull();
    expect(metricOf(report, 'template_reuse_ratio').meetsTarget).toBeNull();
  });
});

describe('FR-M002 narrative: a novel window', () => {
  const novel = (): EvaluationReport => evaluateNarrative(evidence({
    scenes: NOVEL_SCENES.map((sceneSummary, index) => scene({
      sceneId: `scene-${index}`, acceptedSequenceNumber: index, sceneSummary,
    })),
    events: NOVEL_SUMMARIES.map((publicSummary, index) => acceptedEvent({
      sequenceNumber: index, publicSummary,
    })),
  }));

  it('reports a measured zero on every repetition metric, and no findings', () => {
    const report = novel();

    expect(report.findings).toEqual([]);
    for (const key of ['repeated_scene_ratio', 'exact_duplicate_scene_ratio', 'template_reuse_ratio']) {
      expect(ratio(report, key)).toEqual([0, 4]);
      // A measured zero, not an absent one: the difference §16.2 turns on.
      expect(metricOf(report, key).status).toBe('measured');
      expect(metricOf(report, key).rate).toBe(0);
    }
    expect(metricOf(report, 'repeated_scene_ratio').meetsTarget).toBe(true);
  });

  it('measures novelty over the events after the first, not over all of them', () => {
    const report = novel();

    // Four summaries, three comparisons: the first event has nothing to restate.
    expect(ratio(report, 'event_novelty_ratio')).toEqual([3, 3]);
    expect(metricOf(report, 'event_novelty_ratio').rate).toBe(1);
    expect(metricOf(report, 'event_novelty_ratio').direction).toBe('atLeast');
  });

  it('flags an event whose public summary restates a recent one', () => {
    const report = evaluateNarrative(evidence({
      events: [
        acceptedEvent({ sequenceNumber: 0, publicSummary: NOVEL_SUMMARIES[0] }),
        acceptedEvent({ sequenceNumber: 1, publicSummary: NOVEL_SUMMARIES[1] }),
        acceptedEvent({ sequenceNumber: 2, publicSummary: NOVEL_SUMMARIES[0] }),
      ],
    }));
    const finding = findingOf(report.findings, 'EVENT_NOT_NOVEL');

    expect(finding.subjectId).toBe(deriveEventId(WORLD_ID, 2));
    expect(finding.evidence).toContainEqual({
      kind: 'accepted_event', id: deriveEventId(WORLD_ID, 0), worldDay: 0,
    });
    expect(ratio(report, 'event_novelty_ratio')).toEqual([1, 2]);
  });
});

describe('FR-M002 narrative: identifiers must not decide similarity', () => {
  /** One scene written twice, with a different cast and place. Masked, they are one scene. */
  const recast = (identifiers: readonly string[]): EvaluationReport => evaluateNarrative(evidence({
    identifiers,
    scenes: [
      scene({ sceneId: 'scene-a', acceptedSequenceNumber: 0, sceneSummary: `${YINGXUE} 在 ${PAPER} 翻閱舊卷宗。` }),
      scene({ sceneId: 'scene-b', acceptedSequenceNumber: 1, sceneSummary: `${WENRUI} 在 ${HALL} 翻閱舊卷宗。` }),
    ],
  }));

  it('calls two identically-written scenes with a different cast an exact duplicate', () => {
    const report = recast(IDENTIFIERS);

    expect(findingOf(report.findings, 'SCENE_EXACT_DUPLICATE').subjectId).toBe('scene-b');
    expect(ratio(report, 'exact_duplicate_scene_ratio')).toEqual([1, 2]);
    expect(ratio(report, 'repeated_scene_ratio')).toEqual([1, 2]);
  });

  it('misses the same repeat entirely when the identifiers are not masked', () => {
    // Unique-by-construction ids make every scene at a different place trivially distinct: the
    // pair above scores 0.24 unmasked, nowhere near the 0.8 threshold. Masking is not a tidy-up,
    // it is the only reason this repeat is visible at all.
    const report = recast([]);

    expect(report.findings).toEqual([]);
    expect(ratio(report, 'repeated_scene_ratio')).toEqual([0, 2]);
    expect(ratio(report, 'template_reuse_ratio')).toEqual([0, 2]);
  });

  /** Two genuinely different scenes whose text is MOSTLY the ids they share. */
  const sharedCast = (identifiers: readonly string[]): EvaluationReport => evaluateNarrative(evidence({
    identifiers,
    scenes: [
      scene({
        sceneId: 'scene-c', acceptedSequenceNumber: 0,
        sceneSummary: `${YINGXUE} 與 ${WENRUI} 在 ${HALL} 為 ${COUNCIL} 爭執不下。`,
      }),
      scene({
        sceneId: 'scene-d', acceptedSequenceNumber: 1,
        sceneSummary: `${YINGXUE} 與 ${WENRUI} 在 ${HALL} 為 ${COUNCIL} 握手言和。`,
      }),
    ],
  }));

  it('does not call two different scenes similar merely for sharing a long cast list', () => {
    const report = sharedCast(IDENTIFIERS);

    expect(report.findings).toEqual([]);
    expect(ratio(report, 'repeated_scene_ratio')).toEqual([0, 2]);
  });

  it('would report that same pair as a near duplicate with the identifiers left in', () => {
    // The false positive masking prevents: unmasked the shared ids are 33 of the 37 characters,
    // so a quarrel and a reconciliation score 0.84 and one of them is charged as a repeat.
    const report = sharedCast([]);

    expect(findingOf(report.findings, 'SCENE_NEAR_DUPLICATE').subjectId).toBe('scene-d');
    expect(ratio(report, 'repeated_scene_ratio')).toEqual([1, 2]);
  });
});

describe('FR-M002 narrative: the denominator', () => {
  const withWithheld = (): EvaluationReport => evaluateNarrative(evidence({
    scenes: [
      scene({ sceneId: 'scene-1', acceptedSequenceNumber: 0, sceneSummary: COUNCIL_SCENE }),
      scene({ sceneId: 'scene-2', acceptedSequenceNumber: 1, sceneSummary: COUNCIL_SCENE }),
      scene({ sceneId: 'scene-withheld', acceptedSequenceNumber: 2, sceneSummary: COUNCIL_SCENE, withheld: true }),
      scene({ sceneId: 'scene-unaccepted', acceptedSequenceNumber: null, sceneSummary: COUNCIL_SCENE }),
    ],
  }));

  it('counts only accepted scenes, and publishes what it left out', () => {
    const report = withWithheld();

    // Four scenes authored, two of them accepted. Two more copies of the same text exist and
    // move neither side of the ratio: a scene the safety gate withheld never reached an audience,
    // and a scene whose proposals never reached Canon is not part of the world's output.
    expect(ratio(report, 'repeated_scene_ratio')).toEqual([1, 2]);
    expect(ratio(report, 'exact_duplicate_scene_ratio')).toEqual([1, 2]);
    expect(metricOf(report, 'repeated_scene_ratio').excluded).toBe(2);
    expect(metricOf(report, 'repeated_scene_ratio').excludedReason).not.toBeNull();
  });

  it('reports nothing at all about a scene it excluded', () => {
    const report = withWithheld();

    expect(report.findings.map(({ subjectId }) => subjectId)).toEqual(['scene-2', 'scene-2']);
    expect(JSON.stringify(report)).not.toContain('scene-withheld');
    expect(JSON.stringify(report)).not.toContain('scene-unaccepted');
  });

  it('measures nothing, rather than reporting zero, when every scene was withheld', () => {
    const report = evaluateNarrative(evidence({
      scenes: [
        scene({ sceneId: 'scene-1', acceptedSequenceNumber: 0, sceneSummary: COUNCIL_SCENE, withheld: true }),
        scene({ sceneId: 'scene-2', acceptedSequenceNumber: 1, sceneSummary: COUNCIL_SCENE, withheld: true }),
      ],
    }));

    expect(report.metrics).toHaveLength(7);
    for (const observation of report.metrics) {
      expect(observation.status).toBe('no_observations');
      expect(observation.denominator).toBe(0);
      expect(observation.rate).toBeNull();
      // The specific lie this rule exists to prevent: a withheld world reporting
      // 「重複場景比例 0%」 and passing the §16.2 gate having measured nothing.
      expect(observation.rate).not.toBe(0);
      expect(observation.meetsTarget).toBeNull();
    }
    expect(report.score?.value).toBeNull();
    expect(report.score?.status).toBe('no_observations');
    expect(report.score?.weightMeasured).toBe(0);
    expect(report.findings).toEqual([]);
  });
});

describe('FR-M002 narrative: dialogue repetition and voice', () => {
  it('flags a character who says the same line twice, without collapsing their voice', () => {
    const report = evaluateNarrative(evidence({
      scenes: [scene({
        sceneId: 'scene-1', acceptedSequenceNumber: 0, sceneSummary: COUNCIL_SCENE,
        dialogue: [
          { characterId: WENRUI, text: LINE_DECLINE },
          { characterId: WENRUI, text: LINE_DECLINE },
        ],
      })],
    }));
    const finding = findingOf(report.findings, 'DIALOGUE_REPEATED');

    expect(finding.severity).toBe('minor');
    expect(finding.subjectId).toBe(`scene-1:${WENRUI}`);
    expect(ratio(report, 'dialogue_repetition_ratio')).toEqual([1, 2]);
    // One character repeating themselves is repetition, not a cast with one voice.
    expect(codes(report.findings)).not.toContain('VOICE_COLLAPSED');
    expect(ratio(report, 'voice_distinctiveness')).toEqual([2, 2]);
    expect(metricOf(report, 'voice_distinctiveness').rate).toBe(1);
  });

  it('flags one line spoken by two characters, and excludes both from the voice numerator', () => {
    const report = evaluateNarrative(evidence({
      scenes: [scene({
        sceneId: 'scene-1', acceptedSequenceNumber: 0, sceneSummary: COUNCIL_SCENE,
        dialogue: [
          { characterId: WENRUI, text: LINE_DECLINE },
          // Different punctuation, same line: the collapse is detected after normalisation, so a
          // provider cannot hide a shared voice behind a semicolon.
          { characterId: PEILAN, text: LINE_DECLINE_REPUNCTUATED },
          { characterId: YINGXUE, text: LINE_LEDGER },
        ],
      })],
    }));
    const finding = findingOf(report.findings, 'VOICE_COLLAPSED');

    expect(finding.severity).toBe('severe');
    expect(finding.evidence).toContainEqual({ kind: 'accepted_event', id: WENRUI });
    expect(finding.evidence).toContainEqual({ kind: 'accepted_event', id: PEILAN });
    // Reported once for the line, not once per speaker.
    expect(report.findings.filter(({ code }) => code === 'VOICE_COLLAPSED')).toHaveLength(1);

    // Only 林映雪's line is hers alone; the shared line is excluded from the numerator on BOTH
    // of its occurrences, which is why the numerator is 1 and not 2.
    expect(ratio(report, 'voice_distinctiveness')).toEqual([1, 3]);
    expect(ratio(report, 'dialogue_repetition_ratio')).toEqual([1, 3]);
  });

  it('scores a fully distinct cast at 1', () => {
    const report = evaluateNarrative(evidence({
      scenes: [scene({
        sceneId: 'scene-1', acceptedSequenceNumber: 0, sceneSummary: COUNCIL_SCENE,
        dialogue: [
          { characterId: WENRUI, text: LINE_DECLINE },
          { characterId: PEILAN, text: LINE_LEDGER },
          { characterId: YINGXUE, text: LINE_RAIN },
        ],
      })],
    }));

    expect(report.findings).toEqual([]);
    expect(ratio(report, 'voice_distinctiveness')).toEqual([3, 3]);
    expect(metricOf(report, 'voice_distinctiveness').rate).toBe(1);
    expect(ratio(report, 'dialogue_repetition_ratio')).toEqual([0, 3]);
  });
});

describe('FR-M002 narrative: the character-consistency score', () => {
  const distinctVoices = (dialogueText: string) => evidence({
    scenes: [scene({
      sceneId: 'scene-1', acceptedSequenceNumber: 0, sceneSummary: COUNCIL_SCENE,
      dialogue: [
        { characterId: WENRUI, text: LINE_DECLINE },
        { characterId: PEILAN, text: dialogueText },
      ],
    })],
  });

  it('scores over voice alone, at half the weight, when the world carries no persona anchors', () => {
    const report = evaluateNarrative(distinctVoices(LINE_LEDGER));
    const persona = metricOf(report, 'persona_deviation_rate');

    expect(persona.status).toBe('no_observations');
    expect(persona.rate).toBeNull();
    expect(persona.excludedReason).toBe('the world carries no persona anchors');

    expect(componentOf(report, 'voice').value).toBe(1);
    expect(componentOf(report, 'persona').value).toBeNull();
    expect(componentOf(report, 'persona').status).toBe('no_observations');
    // Half the definition's weight measured nothing, and the score says so rather than
    // silently becoming a voice-only score that looks like a full one.
    expect(report.score?.value).toBe(1);
    expect(report.score?.weightMeasured).toBe(0.5);
    expect(report.score?.weightTotal).toBe(1);
  });

  it('carries a collapsed voice straight into the score', () => {
    const report = evaluateNarrative(distinctVoices(LINE_DECLINE));

    expect(ratio(report, 'voice_distinctiveness')).toEqual([0, 2]);
    expect(componentOf(report, 'voice').value).toBe(0);
    expect(report.score?.value).toBe(0);
    expect(report.score?.weightMeasured).toBe(0.5);
  });
});

describe('FR-M002 narrative: persona deviation, the structural half of consistency', () => {
  const occupationAbandoned: StateChange = {
    type: 'character_state_changed',
    characterId: WENRUI,
    field: 'occupation',
    toValue: '客棧幫工',
    reason: '他在表決之後把職務交了出去。',
  };
  /** ART-25's own growth/breakdown marker, at or above the 0.7 justification bar. */
  const formativeMemory: StateChange = {
    type: 'character_memory_formed',
    characterId: WENRUI,
    content: `他在議事廳外把印信放下，口袋裡還留著${MARKER}。`,
    interpretation: '這一步之後沒有回頭路。',
    importance: 0.8,
    emotionalWeight: -0.6,
    confidence: 0.9,
    visibility: 'private',
  };

  const withPersona = (): EvaluationReport => evaluateNarrative(evidence({
    personaAnchors: seedAnchors(),
    scenes: [scene({
      sceneId: 'scene-1', acceptedSequenceNumber: 0, sceneSummary: COUNCIL_SCENE,
      dialogue: [
        { characterId: WENRUI, text: LINE_DECLINE },
        { characterId: PEILAN, text: LINE_LEDGER },
      ],
    })],
    events: [
      acceptedEvent({ sequenceNumber: 0 }),
      acceptedEvent({
        sequenceNumber: 1, timeSlot: 'afternoon',
        stateChanges: [occupationAbandoned, formativeMemory],
      }),
    ],
  }));

  it('reports the flag Canon accepted, over the events that had an anchored participant', () => {
    const report = withPersona();
    const finding = findingOf(report.findings, 'PERSONA_DEVIATION_FLAGGED');

    expect(finding.severity).toBe('minor');
    expect(finding.subjectId).toBe(deriveEventId(WORLD_ID, 1));
    expect(finding.evidence).toContainEqual({ kind: 'accepted_event', id: WENRUI, code: 'reversal' });
    expect(finding.detail).toContain('occupation_abandoned');
    // Reported, not judged: accepted history carries only justified deviations, and the
    // evaluator's job is to say how often the world reached for one.
    expect(finding.detail).toContain('1 justification(s)');

    // Both events name anchored participants; one of them carries a flag.
    expect(ratio(report, 'persona_deviation_rate')).toEqual([1, 2]);
    expect(metricOf(report, 'persona_deviation_rate').rate).toBe(0.5);
  });

  it('composes the score from voice as a rate and persona as its complement', () => {
    const report = withPersona();

    expect(componentOf(report, 'voice')).toMatchObject({ metricKey: 'voice_distinctiveness', weight: 0.5, value: 1 });
    expect(componentOf(report, 'persona')).toMatchObject({ metricKey: 'persona_deviation_rate', weight: 0.5, value: 0.5 });
    // 0.5 × 1 (voice) + 0.5 × (1 − 0.5) (persona), over a fully measured weight.
    expect(report.score?.value).toBe(0.75);
    expect(report.score?.weightMeasured).toBe(1);
    expect(report.score?.status).toBe('measured');
  });

  it('never copies the memory it read the justification out of', () => {
    // A memory is private world content. The flag names the event, the character and the signal
    // kind; the prose that produced it stays where it was.
    expect(JSON.stringify(withPersona())).not.toContain(MARKER);
  });

  it('measures a clean anchored window as a measured zero', () => {
    const report = evaluateNarrative(evidence({
      personaAnchors: seedAnchors(),
      events: [acceptedEvent({ sequenceNumber: 0 }), acceptedEvent({ sequenceNumber: 1, timeSlot: 'afternoon' })],
    }));

    expect(codes(report.findings)).not.toContain('PERSONA_DEVIATION_FLAGGED');
    expect(ratio(report, 'persona_deviation_rate')).toEqual([0, 2]);
    expect(metricOf(report, 'persona_deviation_rate').status).toBe('measured');
  });

  it('leaves the denominator empty for events with no anchored participant', () => {
    const report = evaluateNarrative(evidence({
      personaAnchors: { [YINGXUE]: seedAnchors()[YINGXUE] },
      events: [acceptedEvent({ sequenceNumber: 0, participantIds: [WENRUI, PEILAN] })],
    }));

    expect(ratio(report, 'persona_deviation_rate')).toEqual([0, 0]);
    expect(metricOf(report, 'persona_deviation_rate').status).toBe('no_observations');
  });
});

describe('FR-M002 narrative: a report carries references, never content', () => {
  const leaky = (): EvaluationReport => evaluateNarrative(evidence({
    scenes: [0, 1, 2].map((index) => scene({
      sceneId: `scene-${index}`, acceptedSequenceNumber: index,
      sceneSummary: `${COUNCIL_SCENE}${MARKER}又被提起一次。`,
      dialogue: [{ characterId: index === 1 ? PEILAN : WENRUI, text: `我沒有見過${MARKER}，也不想見。` }],
    })),
    events: [
      acceptedEvent({ sequenceNumber: 0, publicSummary: `議事廳再次談到${MARKER}。` }),
      acceptedEvent({ sequenceNumber: 1, publicSummary: `議事廳再次談到${MARKER}。` }),
    ],
  }));

  it('emits findings across the whole code table without quoting a word of the prose', () => {
    const report = leaky();

    // Every finding class this evaluator can build from scene and dialogue evidence is present,
    // so the assertion below is a claim about the report as a whole rather than about one code.
    expect(new Set(codes(report.findings))).toEqual(new Set([
      'SCENE_EXACT_DUPLICATE', 'SCENE_TEMPLATE_REUSED', 'DIALOGUE_REPEATED', 'VOICE_COLLAPSED', 'EVENT_NOT_NOVEL',
    ]));

    // The report is shown to an operator without a second redaction pass, so a repetition report
    // that quoted the repeated line would be a disclosure of exactly the text it is describing.
    expect(JSON.stringify(report)).not.toContain(MARKER);
    expect(JSON.stringify(report)).not.toContain('議事廳');
    // It does name the evidence, by id.
    expect(JSON.stringify(report)).toContain('scene-1');
    expect(JSON.stringify(report)).toContain(deriveEventId(WORLD_ID, 1));
  });
});

describe('FR-M002 narrative: the window and the digest', () => {
  const windowed = (outsideDay: number): NarrativeEvidence => evidence({
    fromWorldDay: 0,
    toWorldDay: 2,
    scenes: [
      scene({ sceneId: 'scene-0', acceptedSequenceNumber: 0, worldDay: 0, sceneSummary: COUNCIL_SCENE }),
      scene({ sceneId: 'scene-1', acceptedSequenceNumber: 1, worldDay: 1, sceneSummary: HARBOUR_SCENE }),
      scene({ sceneId: 'scene-outside', acceptedSequenceNumber: 2, worldDay: outsideDay, sceneSummary: COUNCIL_SCENE }),
    ],
  });

  it('neither counts nor reports a scene outside the window, and names the empty day', () => {
    const report = evaluateNarrative(windowed(5));

    expect(report.findings).toEqual([]);
    expect(ratio(report, 'repeated_scene_ratio')).toEqual([0, 2]);
    // Out of window is not the same as excluded: an excluded scene was in scope and left out,
    // this one was never in scope.
    expect(metricOf(report, 'repeated_scene_ratio').excluded).toBe(0);
    expect(metricOf(report, 'repeated_scene_ratio').excludedReason).toBeNull();
    expect(report.coverage.worldDaysEvaluated).toEqual([0, 1]);
    expect(report.coverage.worldDaysWithoutEvidence).toEqual([2]);
    expect(JSON.stringify(report)).not.toContain('scene-outside');
  });

  it('charges the very same scene once it falls inside the window', () => {
    const report = evaluateNarrative(windowed(2));

    expect(findingOf(report.findings, 'SCENE_EXACT_DUPLICATE').subjectId).toBe('scene-outside');
    expect(ratio(report, 'repeated_scene_ratio')).toEqual([1, 3]);
    expect(report.coverage.worldDaysEvaluated).toEqual([0, 1, 2]);
    expect(report.coverage.worldDaysWithoutEvidence).toEqual([]);
  });

  it('gives one digest to two evaluations of the same evidence', () => {
    expect(evaluateNarrative(windowed(5)).digest).toBe(evaluateNarrative(windowed(5)).digest);
    expect(evaluateNarrative(windowed(2)).digest).not.toBe(evaluateNarrative(windowed(5)).digest);
  });

  it('carries the truncation flag through, so a partial read is never read as a whole one', () => {
    expect(evaluateNarrative({ ...windowed(5), scanLimitReached: true }).coverage.scanLimitReached).toBe(true);
    expect(evaluateNarrative(windowed(5)).coverage.scanLimitReached).toBe(false);
  });
});
