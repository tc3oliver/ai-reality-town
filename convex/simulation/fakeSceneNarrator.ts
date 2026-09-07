/**
 * Deterministic Fake Whole-Scene Provider (FR-C005, no-cost tier).
 *
 *  - No network, no real LLM, no API key — same {@link GroupedScene} always yields the
 *    same {@link WholeSceneOutput}, so the live world-day loop is fully repeatable.
 *  - Same idiom as {@link ./fakeProvider.ts}: a deterministic stand-in that implements the
 *    vendor-neutral capability port, so the real adapter (ART-72) drops in unchanged.
 *  - It only PROPOSES events; nothing here writes Canon (ADR-0001).
 *
 * Unlike the Phase-0 {@link FakeSimulationProvider} (a single movement event), this
 * narrator produces a full multi-character scene: key actions, dialogue, one Proposed
 * Event carrying relationship, memory and fact state changes, plus the derived
 * relationship / knowledge / memory / rumor links FR-C005 requires.
 */

import { CANON_SCHEMA_VERSION, MAX_PUBLIC_SUMMARY_LENGTH } from '../shared/constants';
import type { ProposedEvent, StateChange } from '../canon/model';
import type {
  EmbeddingResult,
  LanguageModelProvider,
  ProviderTraceMetadata,
  StructuredChatRequest,
  StructuredChatResult,
} from './provider';
import { SimulationProviderError } from './provider';
import type { GroupedScene } from './sceneGrouping';

export const FAKE_SCENE_MODEL = 'fake-whole-scene-v1';

/** Deterministic FNV-1a fingerprint used for repeatable "sampling" and fake embeddings. */
function fingerprint(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Clamp any generated text to the Canon public-summary limit without breaking words. */
function summaryText(value: string): string {
  return value.length <= MAX_PUBLIC_SUMMARY_LENGTH
    ? value
    : `${value.slice(0, MAX_PUBLIC_SUMMARY_LENGTH - 1).trimEnd()}…`;
}

/**
 * ## Why this fixture narrates in zh-Hant (ART-164)
 *
 * FR-G003 states the Episode recap contract in 中文字: Quick 80–150, Standard 400–800. This
 * narrator wrote English, so `countChineseCharacters` measured zero on every deterministic day and
 * the live recap path refused every episode with `RECAP_POOL_BELOW_MINIMUM`.
 *
 * The mismatch was between the FIXTURE and the product's language contract, not in the validator,
 * so the fixture is what changed. The bands are unchanged, `countChineseCharacters` still counts
 * only CJK ideographs, and a refused recap is still a failure rather than a completion.
 *
 * The text is written to carry a normal product scene's worth of information — who met, over what,
 * how it went, and what it cost — because a recap composed from thin filler would satisfy the
 * character count while proving nothing about composition. Entity IDs stay verbatim inside the
 * prose: they are the scene's actual references, and substituting display names here would put a
 * second naming scheme in the fixture that no other layer shares.
 *
 * Nothing about EVENT semantics changes: the same state changes, the same participants, the same
 * visibilities, the same idempotency keys. Only the narrative strings differ.
 */

/** How a character carried themselves. Deterministically selected per scene and character. */
const STANCES = [
  '權衡對方的要求，沒有立刻答覆',
  '追問細節，把含糊的部分逐一釘死',
  '提出一個有條件的交換，並說明底線',
  '保留了一項關鍵事實，只透露到必要為止',
] as const;

/** How a character read the room, used for the memory interpretation. */
const READINGS = [
  '判讀了在場所有人的態度',
  '注意到說法之間對不上的地方',
  '把場面維持在可以收尾的分寸內',
  '重新估算了這件事的風險',
] as const;

/** How the exchange resolved. Widens the distinct-text space without inventing content. */
const OUTCOMES = [
  '談話停在一個雙方都沒有讓步的位置',
  '雙方各退一步，但沒有人把話說死',
  '對話中斷，留下一個沒有回答的問題',
  '結論被推遲到下一次見面才處理',
  '協議口頭成立，細節仍待確認',
  '分歧被攤開，場面因此更清楚也更緊繃',
] as const;

/** What the scene cost or exposed. */
const STAKES = [
  '在場的人都清楚，這件事已經瞞不下去',
  '這一次交換讓彼此的位置更難退回',
  '有人開始重新計算自己能承擔多少',
  '原本的默契被動搖，需要重新建立',
] as const;

const pick = <T>(options: readonly T[], seed: number): T => options[seed % options.length];

/** The Proposed Event a grouped scene contributes to Canon (proposal only, never a write). */
function sceneProposedEvent(scene: GroupedScene, summary: string): ProposedEvent {
  const stateChanges: StateChange[] = [{
    type: 'fact_created',
    subjectType: 'location',
    subjectId: scene.locationId,
    predicate: 'lastMajorSceneSummary',
    value: summary,
    visibility: 'public',
  }];
  for (let index = 0; index + 1 < scene.participantIds.length; index += 1) {
    const sourceCharacterId = scene.participantIds[index];
    const targetCharacterId = scene.participantIds[index + 1];
    const seed = fingerprint(`${scene.sceneId}:${sourceCharacterId}:${targetCharacterId}`);
    stateChanges.push({
      type: 'relationship_changed',
      sourceCharacterId,
      targetCharacterId,
      trustDelta: (seed % 3) - 1,
      affectionDelta: 0,
      resentmentDelta: 0,
      fearDelta: 0,
      dependencyDelta: 0,
      familiarityDelta: 1 + (seed % 2),
      reason: `兩人在 ${scene.locationId} 的這場談話中直接交手。`,
      // A public summary accompanies this event, so the change must be public too.
      visibility: 'public',
    });
  }
  for (const characterId of scene.participantIds) {
    const seed = fingerprint(`${scene.sceneId}:memory:${characterId}`);
    stateChanges.push({
      type: 'character_memory_formed',
      characterId,
      content: `${characterId} 參與了在 ${scene.locationId} 的這場交涉。`,
      interpretation: `${characterId} ${pick(READINGS, seed)}，同時沒有放下自己原本的目的。`,
      importance: ((seed % 5) + 3) / 10,
      emotionalWeight: ((seed % 7) - 3) / 10,
      confidence: ((seed % 4) + 6) / 10,
      visibility: 'trusted',
    });
  }
  return {
    schemaVersion: CANON_SCHEMA_VERSION,
    worldId: scene.worldId,
    idempotencyKey: `${scene.sceneId}:event:1`,
    proposedBy: { type: 'director', id: scene.directorRunId },
    worldDay: scene.worldDay,
    timeSlot: scene.timeSlot,
    eventType: 'conversation',
    locationId: scene.locationId,
    participantIds: [...scene.participantIds],
    causedByEventIds: [],
    publicSummary: summary,
    stateChanges,
    // FR-P004 / ART-132: the Scene whose post-generation safety classification governs this
    // event's public text. The live orchestrator stamps the same key on every real proposal;
    // it is set here too so the deterministic fixture path exercises the identical shape.
    metadata: { sceneId: scene.sceneId },
  };
}

/** Build the complete FR-C005 whole-scene output for one grouped scene. */
export function narrateGroupedScene(scene: GroupedScene): Record<string, unknown> {
  const sceneSeed = fingerprint(scene.sceneId);
  /**
   * The day's public sentence. Carries the four things a recap needs from a scene — place,
   * participants, subject, and how it ended — so composing a Standard Recap from a day's events is
   * a real composition rather than a character count met by repetition.
   *
   * `summaryText` still clamps to `MAX_PUBLIC_SUMMARY_LENGTH`, and clamping is measured in code
   * units, so the text is written to sit well inside the limit rather than to rely on the clamp.
   */
  /**
   * Each participant's stance is part of the day's public record, not only of `keyActions`.
   *
   * It was narrated only into `keyActions`, which the Episode builder does not draw on, so the
   * single richest piece of per-scene information never reached the recap pool. A day whose scenes
   * happened to repeat then composed below the 400 中文字 Standard floor — which was an accurate
   * report of a fixture too thin to represent a normal product scene, not a reason to relax the
   * band. Naming who did what is the density a real scene has.
   */
  /**
   * ## Why this sentence is the length it is
   *
   * A day's recap has to satisfy TWO bands at once from the same pool, and they pull in opposite
   * directions. The Quick Recap is 80–150 中文字 and is composed of whole sentences, so it needs a
   * unit small enough that two of them fit; the Standard Recap is 400–800 中文字 over the day, so
   * the units must not be so small that a day of them cannot reach the floor.
   *
   * Both were violated in turn while writing this. Too short, and a day whose scenes repeated
   * composed under 400 (`RECAP_STANDARD_BELOW_MINIMUM`). Spelling out every participant's stance
   * took a scene to ~98 中文字, which made the episode headline 69 and its one-line summary 109 —
   * no pair fits in 150, so every day failed with `RECAP_QUICK_UNSATISFIABLE`. Neither failure was
   * a reason to move a band; both were the fixture not carrying a normal scene's shape.
   *
   * So: one scene-level sentence of roughly 45 中文字. Two of them make a Quick Recap, and a day of
   * them makes a Standard one.
   *
   * Ordered most-distinguishing first, with no participant roll-call. The roll-call duplicated the
   * key actions and on a large cast pushed the scene-specific outcome past
   * `MAX_PUBLIC_SUMMARY_LENGTH`; the clamp then cut exactly the differentiating tail, so two scenes
   * at one location truncated to the SAME text. That is why the run's distinct-text count fell
   * when the sentence got longer. Outcome first means the half that distinguishes a scene is never
   * the half at risk.
   */
  const summary = summaryText(
    `${pick(OUTCOMES, sceneSeed)}，${pick(STAKES, sceneSeed >>> 3)}。`
    + `這場交涉發生在 ${scene.locationId}，起因是「${scene.trigger}」。`,
  );
  const proposed = sceneProposedEvent(scene, summary);
  return {
    schemaVersion: 1,
    sceneId: scene.sceneId,
    sceneSummary: summaryText(`${summary} 這場戲的壓力來自：${scene.dramaticPressure}`),
    keyActions: scene.participantIds.map((characterId) => ({
      characterId,
      action: `${characterId} ${pick(STANCES, fingerprint(`${scene.sceneId}:action:${characterId}`))}。`,
    })),
    dialogueHighlights: scene.participantIds.map((characterId) => ({
      characterId,
      text: `${characterId}：「這件事就在這裡講清楚，別讓它繼續拖下去。」`,
    })),
    proposedEvents: [proposed],
    relationshipChanges: scene.participantIds.slice(0, -1).map((sourceCharacterId, index) => ({
      sourceCharacterId,
      targetCharacterId: scene.participantIds[index + 1],
      summary: `${sourceCharacterId} 與 ${scene.participantIds[index + 1]} 在這場談話之後，`
        + '對彼此的底線多了一分了解，也多了一分戒備。',
      proposedEventIndex: 0,
    })),
    knowledgeChanges: scene.participantIds.map((characterId) => ({
      characterId,
      content: `${characterId} 弄清楚了其他人在「${scene.trigger}」這件事上現在站在哪一邊。`,
      proposedEventIndex: 0,
    })),
    memories: scene.participantIds.map((characterId) => ({
      characterId,
      content: `${characterId} 記住了在 ${scene.locationId} 的這場交涉，以及當時沒有說出口的部分。`,
      proposedEventIndex: 0,
    })),
    rumors: scene.participantIds.slice(0, 1).map((sourceCharacterId) => ({
      sourceCharacterId,
      content: `有人看見一群人在 ${scene.locationId} 談了很久，散場時臉色都不太好看。`,
      proposedEventIndex: 0,
    })),
    continuityWarnings: [],
  };
}

/**
 * Deterministic {@link LanguageModelProvider} for whole-scene simulation. The request the
 * scene simulator sends carries the serialized {@link GroupedScene} as its user message,
 * which is the only input this provider reads.
 */
export class FakeWholeSceneProvider implements LanguageModelProvider {
  readonly model = FAKE_SCENE_MODEL;

  structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
    if (request.schemaName !== 'whole_scene_output') {
      return Promise.reject(new SimulationProviderError('permanent', 'FAKE_SCENE_UNSUPPORTED_SCHEMA',
        `fake whole-scene provider does not serve schema ${request.schemaName}`));
    }
    const payload = request.messages.find(({ role }) => role === 'user')?.content ?? '';
    let scene: GroupedScene;
    try {
      scene = JSON.parse(payload) as GroupedScene;
    } catch {
      return Promise.reject(new SimulationProviderError('permanent', 'FAKE_SCENE_INVALID_REQUEST',
        'fake whole-scene provider requires a serialized Grouped Scene'));
    }
    const output = narrateGroupedScene(scene);
    return Promise.resolve({ output, trace: this.trace(payload, JSON.stringify(output)) });
  }

  embed(text: string): Promise<EmbeddingResult> {
    const seed = fingerprint(text);
    const embedding = Array.from({ length: 8 }, (_, index) => ((seed >>> index) % 1000) / 1000);
    return Promise.resolve({ embedding, trace: this.trace(text, '') });
  }

  private trace(input: string, output: string): ProviderTraceMetadata {
    // Deterministic, cost-free accounting: no tokens are actually consumed.
    return {
      provider: 'fake',
      // The fake IS the route: it asks for one model and serves that same model, so the resolution
      // is known rather than absent. `null` here would mean "could not attribute", which would be
      // a false report about a provider that never routes anywhere.
      requestedModel: FAKE_SCENE_MODEL,
      resolvedModel: FAKE_SCENE_MODEL,
      upstreamProvider: 'fake',
      // The fake has no allowance to run out of, and saying so is different from reporting one.
      rateLimit: null,
      inputTokens: Math.ceil(input.length / 4),
      outputTokens: Math.ceil(output.length / 4),
      latencyMs: 0,
      retryCount: 0,
    };
  }
}
