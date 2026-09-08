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
 *
 * ## Why this author composes rather than fills a template (ART-88)
 *
 * The previous version drew a scene's public sentence from 6 outcomes × 4 stakes and gave every
 * character in every scene the same dialogue line. Over the fixed 30-day seed that produced 449
 * scenes on 171 distinct texts — 61.9% exact repeats against PRD §16.2's 15% ceiling — and a cast
 * with one voice (human review F-01). Those were properties of the FIXTURE, and every downstream
 * quality number measured over the fixture inherited them. The fix is here, not in the metric:
 *
 *  - the public sentence is COMPOSED from four clauses (time-of-day opening, outcome,
 *    complication, stake), each chosen independently by a seeded pick, plus the scene's place and
 *    subject — an output space in the thousands rather than 24 — and the scene summary adds a
 *    consequence and a pressure clause on top;
 *  - every participant speaks in a VOICE: a per-character register (twelve registers, assigned by
 *    a stable hash of the character id) with its own cores, and a line is opener + core + closer,
 *    so two characters rarely say one sentence and one character does not repeat herself for a
 *    month. The scene's subject is named once, in the public sentence, and NOT quoted in every
 *    line: the Director's goal text is a long English string the cast shares for days, and echoing
 *    it in each line made every line at a location a near-duplicate of every other;
 *  - a participant's stance is drawn from a register-specific pool, not one shared table of four.
 *
 * It is still a template author — a template with more slots is a larger output space and still a
 * template — and `convex/quality/narrative.ts` reports template reuse separately so that stays
 * visible. What it is not any longer is an author whose ceiling made the §16.2 ratio unmeasurable.
 *
 * ## Why this fixture narrates in zh-Hant (ART-164)
 *
 * FR-G003 states the Episode recap contract in 中文字: Quick 80–150, Standard 400–800. An English
 * author measured zero on every day and the live recap path refused every episode. The public
 * sentence is written to land at about 50 中文字: two of them make a Quick Recap and a day of
 * them makes a Standard one, and the sentence is independent of cast size so the
 * `MAX_PUBLIC_SUMMARY_LENGTH` clamp never fires (see `fakeSceneNarratorLanguage.test.ts`).
 *
 * Entity IDs stay verbatim inside the prose: they are the scene's actual references, and
 * substituting display names here would put a second naming scheme in the fixture that no other
 * layer shares. Nothing about EVENT semantics changed in ART-88: the same state changes, the same
 * participants, the same visibilities, the same idempotency keys. Only the narrative strings differ.
 */

import { CANON_SCHEMA_VERSION, MAX_PUBLIC_SUMMARY_LENGTH } from '../shared/constants';
import type { ProposedEvent, StateChange } from '../canon/model';
import type { TimeSlot } from '../canon/eventTypes';
import type {
  EmbeddingResult,
  LanguageModelProvider,
  ProviderTraceMetadata,
  StructuredChatRequest,
  StructuredChatResult,
} from './provider';
import { SimulationProviderError } from './provider';
import type { GroupedScene } from './sceneGrouping';

export const FAKE_SCENE_MODEL = 'fake-whole-scene-v2';

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
 * Finalise a fingerprint before it is reduced modulo a small table (murmur3's fmix32).
 *
 * FNV-1a multiplies by an odd constant, so the low k bits of the hash depend only on the low k
 * bits of every input character and of the offset basis. Two keys that share a long prefix and
 * differ only in a short salt (`…:opener`, `…:core`, `…:closer`) therefore produce `% n` values
 * that are functions of the SAME few bits, and the "independent" picks move together: measured
 * over the 7-day seed, three salted picks over 8×8×6 options produced 71 distinct triples out of
 * 315 lines. The avalanche below spreads every input bit across the word before the modulo.
 */
function mix(hash: number): number {
  let value = hash >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35) >>> 0;
  value ^= value >>> 16;
  return value >>> 0;
}

const pick = <T>(options: readonly T[], seed: number): T => options[mix(seed) % options.length];

/** One independent pick per slot: the same scene seed salted by the slot's name. */
const pickFor = <T>(options: readonly T[], sceneId: string, slot: string): T =>
  pick(options, fingerprint(`${sceneId}:${slot}`));

// --- the public sentence ------------------------------------------------------

const OPENINGS: Readonly<Record<TimeSlot, readonly string[]>> = {
  morning: ['清晨水氣未散', '天剛亮', '早市剛開', '晨霧籠著河面'],
  noon: ['正午影子很短', '午間人來人往', '日頭當空', '午鐘剛過'],
  afternoon: ['午後光線斜落', '下午節奏放慢', '午後悶熱', '日影漸長'],
  evening: ['傍晚收工時分', '夕陽染紅河面', '暮色初降', '晚飯前的空檔'],
  night: ['夜深燈稀', '夜巷安靜', '入夜之後', '夜色掩住表情'],
};

/** How the exchange resolved. */
const OUTCOMES = [
  '談話停在誰都不讓的位置',
  '各退一步卻沒把話說死',
  '對話被一個問題打斷',
  '結論推到下次見面',
  '口頭成了協議細節未定',
  '分歧攤開場面更緊繃',
  '一方開口另一方只點頭',
  '交換了條件卻沒簽字',
] as const;

/** What went sideways along the way. */
const COMPLICATIONS = [
  '一份舊文件被翻了出來',
  '有人在關鍵處改口',
  '第三個名字被牽進來',
  '時間對不上說法鬆動',
  '一句無心話揭開另件事',
  '一筆數字讓對話轉向',
  '最要緊的問題被避開',
  '一個承諾被重新計算',
] as const;

/** What the scene cost or exposed. */
const STAKES = [
  '在場的人都知道瞞不住了',
  '彼此的位置更難退回',
  '有人重新計算能承擔多少',
  '原本的默契被動搖',
  '信任的帳從此重新記',
  '傳出去代價不止一人承受',
] as const;

/** What follows from it. */
const CONSEQUENCES = [
  '接下來幾天沒有人敢輕易表態',
  '有人當晚就開始整理自己手上的證據',
  '這件事勢必會傳到河對岸',
  '下一次見面已經不可能不談這件事',
  '有人決定先把東西收好再說',
  '至少有一個人改變了原先的打算',
] as const;

/** The scene's subject, drawn from the Director's trigger without the identifier noise. */
function subjectOf(scene: GroupedScene): string {
  const quoted = scene.trigger.match(/"([^"]+)"|「([^」]+)」/);
  const subject = quoted?.[1] ?? quoted?.[2] ?? scene.trigger;
  return subject.replace(/[。.]$/, '');
}

/**
 * The day's public sentence: place and subject, then four independently picked clauses.
 *
 * Independent of the cast on purpose (see the module note): a sentence that grew with the cast
 * put its differentiating half at risk of the clamp.
 *
 * ## Why about 50 中文字, and not more
 *
 * The recap bands pull in opposite directions and this sentence has to satisfy both from one
 * pool. The Episode's `headline` IS the day's first public sentence and its `oneLineSummary` is the
 * first two joined, so the Quick Recap's 150 ceiling means headline + one-line ≤ 150, i.e. S ≤ 50;
 * a five-clause sentence of ~68 中文字 made the one-line 136 and every key-scene unit ~200, so
 * `composeRecaps` refused six days in seven with `RECAP_QUICK_UNSATISFIABLE`. A thinner sentence
 * fails the other way: a five-event day composes to roughly 8S for the Standard Recap's 400 floor.
 * The consequence clause therefore lives in `sceneSummary`, which the recap pool never draws on.
 */
function publicSentence(scene: GroupedScene): string {
  const { sceneId } = scene;
  return summaryText(
    `${pickFor(OPENINGS[scene.timeSlot], sceneId, 'opening')}，${scene.locationId} 的話題是「${subjectOf(scene)}」。`
    + `${pickFor(OUTCOMES, sceneId, 'outcome')}，${pickFor(COMPLICATIONS, sceneId, 'complication')}，`
    + `${pickFor(STAKES, sceneId, 'stake')}。`,
  );
}

/** What the scene was under, in the narrator's own words rather than the Director's English. */
const PRESSURES = [
  '沒有人願意第一個把底牌放到桌上',
  '每個人都在等別人先失言',
  '時間不站在任何一方',
  '有人手上握著別人不知道的東西',
  '一句話說錯，就會被記很久',
  '大家都知道這不會是最後一次談',
] as const;

// --- voices ---------------------------------------------------------------------

/**
 * Twelve registers. A character is bound to one by a stable hash of their id, so the binding is
 * the same in every scene and every run, and the fixture stays world-agnostic — it needs no table
 * of Mistwood names. Two characters may share a register; their lines still differ in opener,
 * closer and subject, so a verbatim collision needs every pick to coincide.
 */
type Voice = { stances: readonly string[]; cores: readonly string[] };

const VOICES: readonly Voice[] = [
  { // the one who asks questions
    stances: ['追問細節，把含糊的部分逐一釘死', '把每個人的說法記下來再對照', '先聽完，再問最不想被問的那一句'],
    cores: ['你們手上的紀錄和我看到的不一樣', '誰第一個知道的，什麼時候知道的', '我只想弄清楚時間順序', '別跟我說這是巧合', '背後一定還有沒攤開的東西', '昨天和今天的說法不一樣', '我會把這段對話寫下來', '沉默本身就是一個答案'],
  },
  { // the one who manages
    stances: ['把場面維持在可以收尾的分寸內', '用程序把最尖銳的問題擋在門外', '先確認誰在場，再決定說多少'],
    cores: ['這不是今天能決定的事', '我們按程序來', '我會處理，但不是用你們想的方式', '放上檯面之前，先想清楚後果', '牽涉的人比你們以為的多', '我不會在這裡表態', '穩定比真相先到一步', '先把門關上再談'],
  },
  { // the one who guards a confidence
    stances: ['保留了一項關鍵事實，只透露到必要為止', '確認沒有外人之後才開口', '把話題從人身上移回事情本身'],
    cores: ['我能說的只有這麼多', '有些事不是我能替別人說的', '牽涉到私事，我會停在這裡', '我可以確認發生過，其餘不行', '這些細節不該在這種場合談', '先想想會傷到誰', '我守的不是秘密，是人', '問我之前，先問問自己'],
  },
  { // the one who wants it done
    stances: ['直接把問題攤在桌上', '不等別人繞完圈子就切入正題', '把可行的下一步逐條講出來'],
    cores: ['拖一天，鎮上就多損失一天', '別繞了，到底要不要做', '我明天就能開始，只差一句話', '我不管以前怎麼談的，現在要有結果', '再拖，出事的是做事的人', '交給我，一週內見真章', '會議開不出麵粉', '要嘛動手，要嘛讓開'],
  },
  { // the one who keeps records
    stances: ['把日期和編號一一核對', '要求每句話都對得上文件', '注意到說法之間對不上的地方'],
    cores: ['檔案編號我記得，不是那一份', '紀錄裡有一頁不見了', '照文件走，順序不對', '我需要原件，不是影本', '簽名日期比會議還早', '有人動過索引', '沒有登錄的東西就不存在', '我只相信寫下來的'],
  },
  { // the one who hosts
    stances: ['先把氣氛緩下來再談正事', '用一頓飯的時間換一句實話', '記住誰付了帳，誰沒付'],
    cores: ['坐下來慢慢說', '這裡誰都談過，只是沒人講完', '我聽過另一個版本', '欠的帳總得有人還', '別在門口談，進來吧', '我不站邊，但我知道得不少', '客人走了，話還留在桌上', '先吃飯，吃完再吵'],
  },
  { // the one who pushes the boundary
    stances: ['提出一個有條件的交換，並說明底線', '拿出自己那份證據逼對方回應', '把對方的退路先堵起來'],
    cores: ['界線畫錯了，我有圖', '你們談的時候沒問過真正的所有人', '我願意讓一步，換一個答案', '我不接受口頭保證', '再不解決，我就自己動手', '規則是誰定的，誰受益', '公平不是給的，是爭的', '我等得夠久了'],
  },
  { // the one who tests things
    stances: ['先確認電路和證據都通了才發言', '用一個技術細節戳破一個說法', '對每個結論都要求一次驗證'],
    cores: ['線路還通著，這不合理', '我測過了，這說法站不住', '誰在付電費', '真的關了，為什麼還有訊號', '我不信這是自然發生的', '把圖拿來，我當場檢查', '會亮的東西不會說謊', '先量再說'],
  },
  { // the one who presides
    stances: ['引用議事規則把討論拉回正軌', '把個人恩怨改寫成程序問題', '權衡對方的要求，沒有立刻答覆'],
    cores: ['要進議程，先有提案', '會議紀錄才是依據', '附件本來就該在案', '我的立場寫在紀錄裡', '這不是私下能了結的', '程序沒有錯，人可能有', '請按順序發言', '這句話會進紀錄'],
  },
  { // the one who runs errands and hears everything
    stances: ['把路上聽到的碎片拼在一起', '答應了的事就不多問', '一邊聽一邊盤算下一趟要去哪'],
    cores: ['我送過一趟，沒看內容', '河兩岸的說法不一樣', '那天早上我在那裡', '我不問是誰的，我只管送到', '別把我扯進去', '我聽到另一個名字', '路上的事路上了', '我只是經過'],
  },
  { // the one who teaches and remembers
    stances: ['把眼前的事放回二十年的脈絡裡', '用一段口述歷史回應一個數字', '先問這件事會怎麼影響孩子們'],
    cores: ['官方版本跟錄音對不上', '老人們記得的不是這樣', '要教給下一代，說哪個版本', '我手上有另一段記憶', '不能只讓一方來寫', '鎮上分成兩種記憶', '孩子們會問為什麼', '歷史不是投票決定的'],
  },
  { // the one who counts
    stances: ['把每筆數字算到對得上才開口', '拒絕在帳目不清時表態', '重新估算了這件事的風險'],
    cores: ['帳有一筆對不上', '有錢一直流向一個不存在的地方', '我可以算給你看，但不是現在', '先讓我把數字核完', '如果是真的，帳本會先說話', '我不猜，我只看流水', '數字不會緊張', '差額本身就是線索'],
  },
];

const voiceOf = (characterId: string): Voice => VOICES[mix(fingerprint(`voice:${characterId}`)) % VOICES.length];

const LINE_OPENERS = ['說實話，', '我把話說明白：', '先別急，', '你們聽好，', '我只說一次，', '換個角度想，', '', '恕我直言，'] as const;
const LINE_CLOSERS = ['。', '，這點我不會退。', '，不然今天就談到這裡。', '，其他的等有證據再說。', '，你們自己想想。', '，我話說完了。'] as const;

function dialogueLine(scene: GroupedScene, characterId: string): string {
  const voice = voiceOf(characterId);
  const seedKey = `${scene.sceneId}:line:${characterId}`;
  const core = pickFor(voice.cores, seedKey, 'core');
  return `${characterId}：「${pickFor(LINE_OPENERS, seedKey, 'opener')}${core}${pickFor(LINE_CLOSERS, seedKey, 'closer')}」`;
}

function stanceLine(scene: GroupedScene, characterId: string): string {
  return `${characterId} ${pickFor(voiceOf(characterId).stances, `${scene.sceneId}:action:${characterId}`, 'stance')}。`;
}

/** How a character read the room, used for the memory interpretation. */
const READINGS = [
  '判讀了在場所有人的態度',
  '注意到說法之間對不上的地方',
  '把場面維持在可以收尾的分寸內',
  '重新估算了這件事的風險',
  '記下了誰在哪一句話時停頓',
  '確認了自己還沒有被點名',
] as const;

// --- the proposed event -----------------------------------------------------------

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
      reason: `兩人在 ${scene.locationId} 就「${subjectOf(scene)}」直接交手。`,
      // A public summary accompanies this event, so the change must be public too.
      visibility: 'public',
    });
  }
  for (const characterId of scene.participantIds) {
    const seed = fingerprint(`${scene.sceneId}:memory:${characterId}`);
    stateChanges.push({
      type: 'character_memory_formed',
      characterId,
      content: `${characterId} 參與了在 ${scene.locationId} 關於「${subjectOf(scene)}」的這場交涉。`,
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
  const summary = publicSentence(scene);
  const proposed = sceneProposedEvent(scene, summary);
  const subject = subjectOf(scene);
  return {
    schemaVersion: 1,
    sceneId: scene.sceneId,
    // The scene-level summary carries the consequence and the pressure; neither reaches the recap
    // pool, so they widen the scene without lengthening the public sentence.
    sceneSummary: summaryText(`${summary}${pickFor(CONSEQUENCES, scene.sceneId, 'consequence')}。這場戲的壓力在於${pickFor(PRESSURES, scene.sceneId, 'pressure')}。`),
    keyActions: scene.participantIds.map((characterId) => ({
      characterId,
      action: stanceLine(scene, characterId),
    })),
    dialogueHighlights: scene.participantIds.map((characterId) => ({
      characterId,
      text: dialogueLine(scene, characterId),
    })),
    proposedEvents: [proposed],
    relationshipChanges: scene.participantIds.slice(0, -1).map((sourceCharacterId, index) => ({
      sourceCharacterId,
      targetCharacterId: scene.participantIds[index + 1],
      summary: `${sourceCharacterId} 與 ${scene.participantIds[index + 1]} 在這場關於「${subject}」的談話之後，`
        + '對彼此的底線多了一分了解，也多了一分戒備。',
      proposedEventIndex: 0,
    })),
    knowledgeChanges: scene.participantIds.map((characterId) => ({
      characterId,
      content: `${characterId} 弄清楚了其他人在「${subject}」這件事上現在站在哪一邊。`,
      proposedEventIndex: 0,
    })),
    memories: scene.participantIds.map((characterId) => ({
      characterId,
      content: `${characterId} 記住了在 ${scene.locationId} 關於「${subject}」的這場交涉，以及當時沒有說出口的部分。`,
      proposedEventIndex: 0,
    })),
    rumors: scene.participantIds.slice(0, 1).map((sourceCharacterId) => ({
      sourceCharacterId,
      content: `有人看見一群人在 ${scene.locationId} 談了很久「${subject}」，散場時臉色都不太好看。`,
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
