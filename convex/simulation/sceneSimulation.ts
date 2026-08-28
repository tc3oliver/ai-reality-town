import { normalizeProposedEventOutput } from '../canon/proposedEvent';
import {
  CHARACTER_STATE_FIELDS, EVENT_TYPES, FACT_SUBJECT_TYPES, FACT_VISIBILITIES, KNOWLEDGE_SHAREABILITIES,
  KNOWLEDGE_SOURCE_TYPES, KNOWLEDGE_TRUTH_STATUSES, PROPOSED_BY_TYPES,
  PUBLIC_TEXT_CHARACTER_STATE_FIELDS, TIME_SLOTS,
} from '../canon/eventTypes';
import type { ProposedEvent } from '../canon/model';
import { classifyPostGeneration, type PostGenerationClassification } from '../safety/postGeneration';
import { SimulationProviderError, type LanguageModelProvider, type ProviderTraceMetadata } from './provider';
import { runBudgetedAttempt, SceneBudgetError, type SceneBudgetGate } from './sceneBudget';
import type { BudgetReservationRequest } from '../shared/tokenBudget';
import type { GroupedScene } from './sceneGrouping';

export type SceneAction = { characterId: string; action: string };
export type DialogueHighlight = { characterId: string; text: string };
export type SceneRelationshipChange = { sourceCharacterId: string; targetCharacterId: string; summary: string; proposedEventIndex: number };
export type SceneKnowledgeChange = { characterId: string; content: string; proposedEventIndex: number };
export type SceneMemory = { characterId: string; content: string; proposedEventIndex: number };
export type SceneRumor = { sourceCharacterId: string; content: string; proposedEventIndex: number };

export type WholeSceneOutput = {
  schemaVersion: 1;
  sceneId: string;
  sceneSummary: string;
  keyActions: SceneAction[];
  dialogueHighlights: DialogueHighlight[];
  proposedEvents: ProposedEvent[];
  relationshipChanges: SceneRelationshipChange[];
  knowledgeChanges: SceneKnowledgeChange[];
  memories: SceneMemory[];
  rumors: SceneRumor[];
  continuityWarnings: string[];
};

export type SceneSimulationResult = {
  schemaVersion: 1;
  simulationRunId: string;
  scene: GroupedScene;
  output: WholeSceneOutput;
  safety: PostGenerationClassification;
  reviewStatus: 'not_required' | 'required';
  attemptCount: number;
  trace: ProviderTraceMetadata;
};

export class SceneSimulationError extends Error {
  constructor(readonly code: string, message: string, readonly path?: string) {
    super(`[${code}] ${message}`);
    this.name = 'SceneSimulationError';
  }
}

const record = (value: unknown, path: string, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'must be an object', path);
  const result = value as Record<string, unknown>;
  const unknown = Object.keys(result).filter((key) => !keys.includes(key));
  if (unknown.length > 0) throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'contains unknown fields', path);
  return result;
};
const string = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'must be a non-empty string', path);
  return value;
};
const array = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value)) throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'must be an array', path);
  return value;
};
const strings = (value: unknown, path: string): string[] => {
  const parsed = array(value, path).map((item, index) => string(item, `${path}[${index}]`));
  if (new Set(parsed).size !== parsed.length) throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'must not contain duplicates', path);
  return parsed;
};
const index = (value: unknown, eventCount: number, path: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= eventCount) {
    throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'must reference a Proposed Event index', path);
  }
  return value as number;
};
const participant = (value: unknown, scene: GroupedScene, path: string): string => {
  const id = string(value, path);
  if (!scene.participantIds.includes(id)) throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'character is not a Scene participant', path);
  return id;
};

function parseActions(value: unknown, scene: GroupedScene): SceneAction[] {
  const actions = array(value, 'keyActions').map((item, itemIndex) => {
    const path = `keyActions[${itemIndex}]`; const row = record(item, path, ['characterId', 'action']);
    return { characterId: participant(row.characterId, scene, `${path}.characterId`), action: string(row.action, `${path}.action`) };
  });
  if (actions.length === 0) throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'at least one key action is required', 'keyActions');
  return actions;
}

function parseDialogue(value: unknown, scene: GroupedScene): DialogueHighlight[] {
  return array(value, 'dialogueHighlights').map((item, itemIndex) => {
    const path = `dialogueHighlights[${itemIndex}]`; const row = record(item, path, ['characterId', 'text']);
    return { characterId: participant(row.characterId, scene, `${path}.characterId`), text: string(row.text, `${path}.text`) };
  });
}

function parseEventLinked<T>(value: unknown, path: string, scene: GroupedScene, eventCount: number,
  parser: (row: Record<string, unknown>, itemPath: string, eventIndex: number) => T): T[] {
  return array(value, path).map((item, itemIndex) => {
    const itemPath = `${path}[${itemIndex}]`;
    const allowed = path === 'relationshipChanges'
      ? ['sourceCharacterId', 'targetCharacterId', 'summary', 'proposedEventIndex']
      : path === 'rumors' ? ['sourceCharacterId', 'content', 'proposedEventIndex']
        : ['characterId', 'content', 'proposedEventIndex'];
    const row = record(item, itemPath, allowed);
    return parser(row, itemPath, index(row.proposedEventIndex, eventCount, `${itemPath}.proposedEventIndex`));
  });
}

export function parseWholeSceneOutput(value: unknown, scene: GroupedScene): WholeSceneOutput {
  const root = record(value, '$', ['schemaVersion', 'sceneId', 'sceneSummary', 'keyActions', 'dialogueHighlights',
    'proposedEvents', 'relationshipChanges', 'knowledgeChanges', 'memories', 'rumors', 'continuityWarnings']);
  // ART-139 (confirmed against the real provider, not just hypothesized): a strict-mode
  // OpenAI-compatible gateway omits fields whose correct value is a fixed constant or an echo
  // of caller-supplied input rather than model-generated content -- `schemaVersion` (always the
  // literal 1) and `sceneId` (already known from the request, not something the model invents)
  // are both dropped from the real provider's response entirely. Fill in exactly those two
  // fields when omitted, since the caller already knows their only valid value; also tolerate
  // the numeric-string "1" defensively. Anything present-but-wrong still fails loudly.
  if (root.schemaVersion === undefined) root.schemaVersion = 1;
  if (root.schemaVersion === '1') root.schemaVersion = 1;
  if (root.schemaVersion !== 1) {
    const received = typeof root.schemaVersion === 'string' || typeof root.schemaVersion === 'number' || typeof root.schemaVersion === 'boolean'
      ? String(root.schemaVersion) : typeof root.schemaVersion;
    throw new SceneSimulationError('SCENE_OUTPUT_INVALID', `unsupported schema version: expected 1, received ${received}`, 'schemaVersion');
  }
  if (root.sceneId === undefined) root.sceneId = scene.sceneId;
  if (root.sceneId !== scene.sceneId) throw new SceneSimulationError('SCENE_OUTPUT_PROVENANCE_MISMATCH', 'output Scene ID does not match', 'sceneId');
  const proposedEvents = array(root.proposedEvents, 'proposedEvents').map((event, eventIndex) => {
    const parsed = normalizeProposedEventOutput(event);
    if (parsed.worldId !== scene.worldId || parsed.worldDay !== scene.worldDay || parsed.timeSlot !== scene.timeSlot
        || parsed.participantIds.some((id) => !scene.participantIds.includes(id))) {
      throw new SceneSimulationError('SCENE_OUTPUT_PROVENANCE_MISMATCH', 'Proposed Event must remain within the Scene world, slot, and participants', `proposedEvents[${eventIndex}]`);
    }
    return parsed;
  });
  if (new Set(proposedEvents.map(({ idempotencyKey }) => idempotencyKey)).size !== proposedEvents.length) {
    throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'Proposed Event idempotency keys must be unique', 'proposedEvents');
  }
  const relationshipChanges = parseEventLinked(root.relationshipChanges, 'relationshipChanges', scene, proposedEvents.length,
    (row, path, proposedEventIndex) => ({ sourceCharacterId: participant(row.sourceCharacterId, scene, `${path}.sourceCharacterId`),
      targetCharacterId: participant(row.targetCharacterId, scene, `${path}.targetCharacterId`), summary: string(row.summary, `${path}.summary`), proposedEventIndex }));
  if (relationshipChanges.some(({ sourceCharacterId, targetCharacterId }) => sourceCharacterId === targetCharacterId)) {
    throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'relationship endpoints must differ', 'relationshipChanges');
  }
  const characterLinked = (row: Record<string, unknown>, path: string, proposedEventIndex: number): SceneKnowledgeChange => ({
    characterId: participant(row.characterId, scene, `${path}.characterId`), content: string(row.content, `${path}.content`), proposedEventIndex,
  });
  return {
    schemaVersion: 1, sceneId: scene.sceneId, sceneSummary: string(root.sceneSummary, 'sceneSummary'),
    keyActions: parseActions(root.keyActions, scene), dialogueHighlights: parseDialogue(root.dialogueHighlights, scene), proposedEvents,
    relationshipChanges,
    knowledgeChanges: parseEventLinked(root.knowledgeChanges, 'knowledgeChanges', scene, proposedEvents.length, characterLinked),
    memories: parseEventLinked(root.memories, 'memories', scene, proposedEvents.length, characterLinked),
    rumors: parseEventLinked(root.rumors, 'rumors', scene, proposedEvents.length,
      (row, path, proposedEventIndex) => ({ sourceCharacterId: participant(row.sourceCharacterId, scene, `${path}.sourceCharacterId`),
        content: string(row.content, `${path}.content`), proposedEventIndex })),
    continuityWarnings: strings(root.continuityWarnings, 'continuityWarnings'),
  };
}

// ART-141 (confirmed live, not hypothesized): under OpenAI-compatible strict structured output
// every object node must list ALL of its `properties` in `required` and set
// `additionalProperties: false`, and no node may be a bare `{ type: 'object' }`. Only
// `proposedEventItem` broke those rules -- optional `locationId`/`publicSummary`/`metadata`,
// an optional `proposedBy.id`, and unconstrained `stateChanges` items -- and it was the only
// branch the real provider freelanced, returning `{ eventId, publicSummary, trigger }` while
// every fully specified sibling collection came back correctly shaped. `strictObject` derives
// `required` from `properties` so that invariant is structural and cannot drift again.
const strictObject = (properties: Record<string, unknown>): Record<string, unknown> => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties,
});
const enumOf = (values: readonly string[]): Record<string, unknown> => ({ type: 'string', enum: [...values] });
const text = { type: 'string' };
const integer = { type: 'integer' };
const number = { type: 'number' };
const boolean = { type: 'boolean' };
const textArray = { type: 'array', items: text };
const nullableText = { type: ['string', 'null'] };
const primitive = { type: ['string', 'number', 'boolean'] };
const stateFieldValue = { anyOf: [text, boolean, textArray] };

// `metadata` and `correctsKnowledgeId` are deliberately absent: an open-ended object cannot be
// expressed under strict mode at all, and both fields are optional in the canon contract, so
// omitting them from the request keeps every remaining node strictly satisfiable.
const stateChangeVariants = [
  strictObject({ type: { const: 'character_location_changed' }, characterId: text, fromLocationId: text, toLocationId: text }),
  strictObject({ type: { const: 'relationship_changed' }, sourceCharacterId: text, targetCharacterId: text,
    trustDelta: number, affectionDelta: number, resentmentDelta: number, fearDelta: number, dependencyDelta: number,
    familiarityDelta: number, reason: text, visibility: enumOf(['private', 'public']) }),
  strictObject({ type: { const: 'fact_created' }, subjectType: enumOf(FACT_SUBJECT_TYPES), subjectId: text,
    predicate: text, value: primitive, visibility: enumOf(FACT_VISIBILITIES) }),
  strictObject({ type: { const: 'character_life_changed' }, characterId: text, alive: boolean, reason: text }),
  strictObject({ type: { const: 'character_knowledge_learned' }, characterId: text, factId: text,
    sourceType: enumOf(KNOWLEDGE_SOURCE_TYPES), sourceEventId: text, beliefValue: primitive,
    truthStatus: enumOf(KNOWLEDGE_TRUTH_STATUSES), confidence: number, shareability: enumOf(KNOWLEDGE_SHAREABILITIES) }),
  strictObject({ type: { const: 'character_memory_formed' }, characterId: text, content: text, interpretation: text,
    importance: number, emotionalWeight: number, confidence: number, visibility: enumOf(KNOWLEDGE_SHAREABILITIES) }),
  strictObject({ type: { const: 'item_transferred' }, itemId: text, fromOwnerId: nullableText, toOwnerId: text, reason: text }),
  strictObject({ type: { const: 'character_state_changed' }, characterId: text, field: enumOf(CHARACTER_STATE_FIELDS),
    fromValue: stateFieldValue, toValue: stateFieldValue, reason: text }),
  strictObject({ type: { const: 'location_state_changed' }, locationId: text, name: text, description: text,
    locationType: text, capacity: integer, connectedLocationIds: textArray, active: boolean, reason: text }),
  strictObject({ type: { const: 'organization_state_changed' }, organizationId: text, name: text, description: text,
    organizationType: text, headquartersLocationId: nullableText, active: boolean, reason: text }),
];

const characterActionItem = strictObject({ characterId: text, action: text });
const dialogueItem = strictObject({ characterId: text, text });
const relationshipChangeItem = strictObject({ sourceCharacterId: text, targetCharacterId: text,
  summary: text, proposedEventIndex: integer });
const characterLinkedItem = strictObject({ characterId: text, content: text, proposedEventIndex: integer });
const rumorItem = strictObject({ sourceCharacterId: text, content: text, proposedEventIndex: integer });
const proposedEventItem = strictObject({
  schemaVersion: { type: 'integer', const: 1 }, worldId: text, idempotencyKey: text,
  proposedBy: strictObject({ type: enumOf(PROPOSED_BY_TYPES) }),
  worldDay: integer, timeSlot: enumOf(TIME_SLOTS), eventType: enumOf(EVENT_TYPES),
  locationId: text, participantIds: textArray, causedByEventIds: textArray, publicSummary: text,
  stateChanges: { type: 'array', items: { anyOf: stateChangeVariants } },
});

export const WHOLE_SCENE_JSON_SCHEMA: Record<string, unknown> = strictObject({
  schemaVersion: { type: 'integer', const: 1 }, sceneId: text, sceneSummary: text,
  keyActions: { type: 'array', items: characterActionItem }, dialogueHighlights: { type: 'array', items: dialogueItem },
  proposedEvents: { type: 'array', items: proposedEventItem }, relationshipChanges: { type: 'array', items: relationshipChangeItem },
  knowledgeChanges: { type: 'array', items: characterLinkedItem }, memories: { type: 'array', items: characterLinkedItem },
  rumors: { type: 'array', items: rumorItem }, continuityWarnings: { type: 'array', items: text },
});

// ART-141 (confirmed live): the configured OpenAI-compatible gateway accepts
// `response_format: { type: 'json_schema', strict: true }` but does not enforce it -- a request
// carrying only the proposedEvents schema came back as an entirely invented
// `{ sceneId, participants, narrativeEvents, outcome }` document. Every field that previously
// looked "honored" was really the model inferring intent from self-describing names echoed in the
// scene payload; `proposedEvents` is a canon concept it cannot infer, so it invented
// `{ eventId, publicSummary, trigger }`. The contract therefore has to travel in the prompt.
// The schema stays the single source of truth and is serialised into it, so the two cannot drift.
export const wholeSceneSystemPrompt = (scene: GroupedScene): string => {
  const example = {
    schemaVersion: 1, worldId: scene.worldId, idempotencyKey: `${scene.sceneId}:1`,
    proposedBy: { type: 'system' }, worldDay: scene.worldDay, timeSlot: scene.timeSlot,
    eventType: 'movement', locationId: scene.locationId,
    participantIds: scene.participantIds.slice(0, 1), causedByEventIds: [],
    publicSummary: '角色離開原本的地點，前往下一個場所。',
    stateChanges: [{ type: 'character_location_changed', characterId: scene.participantIds[0] ?? 'character-id',
      fromLocationId: scene.locationId, toLocationId: 'destination-location-id' }],
  };
  return [
    'Simulate the entire grouped scene once. Return structured JSON only. You may propose events but never commit or mutate Canon.',
    'Write every narrative text field (sceneSummary, keyActions, dialogueHighlights, relationshipChanges, knowledgeChanges, memories, rumors, continuityWarnings, and each proposedEvents publicSummary) in Traditional Chinese (zh-TW). Field names and JSON structure stay in English.',
    `The response must conform exactly to this JSON Schema. Use only the field names and enum values it declares, include every required field, and never invent fields: ${JSON.stringify(WHOLE_SCENE_JSON_SCHEMA)}`,
    `Each proposedEvents item is a canonical world-state event, not a narrative beat: it carries the structured stateChanges that move the world forward. Never emit fields such as eventId, trigger or probability. A well-formed item for this scene looks like: ${JSON.stringify(example)}`,
    'The memories, knowledgeChanges and rumors collections are short narrative notes about a proposed event, not state changes. Each memories or knowledgeChanges item has exactly characterId, content and proposedEventIndex; each rumors item has exactly sourceCharacterId, content and proposedEventIndex, where proposedEventIndex is the zero-based position in proposedEvents. Never give them interpretation, importance, emotionalWeight, confidence or visibility -- those belong only to a character_memory_formed entry inside proposedEvents stateChanges.',
  ].join(' ');
};

/**
 * The character text a scene proposes as FACT rather than as narration (ART-124).
 *
 * A scene's `publicSummary` fields are not the only public strings it writes. A `fact_created`
 * on a character, or a `character_state_changed`, carries model-written prose straight into the
 * public Character projection (`publicProfile`, `publicGoal`, `personality`, `occupation`, …),
 * where a viewer reads it on the character page and the character card. Until ART-124 the
 * post-generation classifier never saw those strings: {@link publicText} concatenated the
 * narrative fields and each event's `publicSummary`, and nothing else. A scene could therefore
 * be classified `allow` on a bland summary while proposing a biography the same classifier
 * would have refused.
 *
 * Widening the classifier's INPUT is the whole fix — there is still exactly one classification
 * per scene, keyed on the same `sceneId`, so an operator override keeps governing the scene as
 * a unit and the projection-side gate in `worldCharacterProjectionFunctions.ts` reads the same
 * verdict it always did.
 *
 * `fact_created` is filtered to public-facing visibilities and to character subjects: a
 * `private` fact never reaches a public surface, and a world or location fact is not this
 * gate's business.
 *
 * `character_state_changed` carries no `visibility`, so it is filtered by FIELD instead —
 * {@link PUBLIC_TEXT_CHARACTER_STATE_FIELDS}, which is `health`, `emotion`, `finance` and
 * `occupation`. Scanning the whole union would be actively harmful rather than merely
 * over-cautious: `organization_memberships` and `availability` reach no public field at all, and
 * `active` is a boolean assertion about existence, yet a `withhold` verdict drops the ENTIRE
 * scene from Canon (`reviewStatus: 'required'`). A false positive on a string nobody was ever
 * going to read would therefore destroy that scene's unrelated location changes, relationship
 * updates and memories along with it. Only text that can actually become public is worth that
 * risk.
 */
function characterFactTexts(output: WholeSceneOutput): string[] {
  const texts: string[] = [];
  for (const event of output.proposedEvents) {
    for (const change of event.stateChanges) {
      if (change.type === 'fact_created') {
        if (change.subjectType === 'character'
          && (change.visibility === 'public' || change.visibility === 'canon')
          && typeof change.value === 'string') texts.push(change.value);
      } else if (change.type === 'character_state_changed'
        && (PUBLIC_TEXT_CHARACTER_STATE_FIELDS as readonly string[]).includes(change.field)) {
        // `toValue` is `string | boolean | string[]`; only the strings carry text. Every field
        // reaching here is projected as a single string, but the union is handled whole so a
        // future array-valued public field cannot slip past unscanned.
        for (const value of Array.isArray(change.toValue) ? change.toValue : [change.toValue]) {
          if (typeof value === 'string') texts.push(value);
        }
      }
    }
  }
  return texts;
}

function publicText(output: WholeSceneOutput): string {
  return [output.sceneSummary, ...output.keyActions.map(({ action }) => action), ...output.dialogueHighlights.map(({ text }) => text),
    ...output.relationshipChanges.map(({ summary }) => summary), ...output.knowledgeChanges.map(({ content }) => content),
    ...output.memories.map(({ content }) => content), ...output.rumors.map(({ content }) => content), ...output.continuityWarnings,
    ...output.proposedEvents.map(({ publicSummary }) => publicSummary ?? ''), ...characterFactTexts(output)].join(' ');
}

export function finalizeWholeSceneOutput(simulationRunId: string, scene: GroupedScene, output: WholeSceneOutput,
  attemptCount: number, trace: ProviderTraceMetadata): SceneSimulationResult {
  const safety = classifyPostGeneration({ classificationId: `${simulationRunId}:safety`, worldId: scene.worldId,
    sourceId: scene.sceneId, kind: 'scene', text: publicText(output),
    coreFactIds: output.proposedEvents.map(({ idempotencyKey }) => idempotencyKey) });
  return { schemaVersion: 1, simulationRunId, scene: structuredClone(scene), output: structuredClone(output), safety,
    reviewStatus: safety.label === 'withhold' || safety.label === 'human_review_required' ? 'required' : 'not_required',
    attemptCount, trace: { ...trace } };
}

/**
 * Per-call model settings for one whole-scene simulation (FR-K005 / ART-52).
 *
 * Every field is optional and every default is the literal this function used before the
 * configuration table existed, so `simulateWholeScene(provider, runId, scene)` behaves exactly
 * as it always did. `convex/simulation/moduleConfig.ts` builds this object from the world's
 * `moduleModelConfigs` row, and `worldDayLive.ts` passes it in.
 *
 * `buildSystemPrompt` is the resolved FR-K005 "Prompt Version": the ID is looked up in
 * `./promptVersions.ts` by the caller, because that registry imports the prompt bodies from THIS
 * file and importing it back would be a module cycle.
 */
export type WholeSceneSimulationOptions = {
  /** FR-K005 "Retry", semantic layer: whole-scene re-simulations. 1–3, default 2. */
  maxAttempts?: number;
  /** FR-K005 "Temperature". Default 0.4. */
  temperature?: number;
  /** FR-K005 "Token Limit". Default 4_000. */
  maxTokens?: number;
  /** FR-K005 "Model". Absent inherits the provider instance's configured model. */
  model?: string;
  /** FR-K005 "Timeout", per HTTP attempt. Absent inherits the provider instance's timeout. */
  timeoutMs?: number;
  /** FR-K005 "Retry", transport layer. Absent inherits the provider instance's attempt count. */
  transportMaxAttempts?: number;
  /** FR-K005 "Prompt Version", already resolved to its builder. Default: the v1 prompt below. */
  buildSystemPrompt?: (scene: GroupedScene) => string;
  /**
   * FR-M003 / ART-59 budget enforcement, applied ONCE PER ATTEMPT.
   *
   * Per attempt rather than per scene because that is the only granularity at which the Retry
   * 預算 is a limit at all: gating the whole call would offer the accountant one reservation for
   * a scene that made three provider calls, and the second and third — the retries the budget
   * exists to bound — would never be counted.
   *
   * Absent means unmetered, which is how `simulateWholeScene(provider, runId, scene)` behaved
   * before ART-59 and how the pure scene-parsing tests still call it. The LIVE path cannot make
   * that choice: `createWorldDayStageHandlers` requires a budget port and always supplies this,
   * and `sceneBudgetEnforcement.test.ts` pins that a refused reservation reaches no provider.
   */
  budget?: {
    gate: SceneBudgetGate;
    /** The per-attempt fields are filled in by the retry loop; the rest is the caller's. */
    reservation: Omit<BudgetReservationRequest, 'attempt' | 'estimatedTokens'>;
    /** Attempt `n` records its decision as `${decisionIdPrefix}:attempt:${n}`. */
    decisionIdPrefix: string;
  };
};

export async function simulateWholeScene(provider: LanguageModelProvider, simulationRunId: string, scene: GroupedScene,
  options: WholeSceneSimulationOptions = {}): Promise<SceneSimulationResult> {
  const maxAttempts = options.maxAttempts ?? 2;
  const temperature = options.temperature ?? 0.4;
  const maxTokens = options.maxTokens ?? 4_000;
  const buildSystemPrompt = options.buildSystemPrompt ?? wholeSceneSystemPrompt;
  if (simulationRunId.trim().length === 0 || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new SceneSimulationError('SCENE_SIMULATION_INVALID', 'valid Run ID and 1-3 attempts are required');
  }
  const callProvider = (model: string | undefined) => provider.structuredChat({
    messages: [{ role: 'system', content: buildSystemPrompt(scene) },
      { role: 'user', content: JSON.stringify(scene) }],
    schemaName: 'whole_scene_output', jsonSchema: WHOLE_SCENE_JSON_SCHEMA, temperature, maxTokens,
    ...(model === undefined ? {} : { model }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.transportMaxAttempts === undefined ? {} : { maxAttempts: options.transportMaxAttempts }),
  });

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const budget = options.budget;
      let response;
      if (budget) {
        // ART-59. `maxTokens` is the reservation, and it is an UPPER BOUND on the completion
        // rather than a prediction: prompt tokens are not knowable before the call without a
        // tokenizer for the configured model, and there is none in this runtime. The settlement
        // inside `runBudgetedAttempt` books the provider's own reported usage, so the day's
        // accounting is exact even though the reservation is not.
        const budgeted = await runBudgetedAttempt(budget.gate, {
          request: { ...budget.reservation, attempt, estimatedTokens: maxTokens },
          decisionId: `${budget.decisionIdPrefix}:attempt:${attempt}`,
          run: async (model) => {
            // ART-52's invariant survives ART-59. A module that inherits the deployment's
            // `LLM_MODEL` must send NO `model` override at all — a present key always beats the
            // provider instance, which is where the environment variable lives, so emitting the
            // resolved id here would make `LLM_MODEL` dead for every unconfigured world.
            //
            // The accountant still needs a concrete id, because a per-MODEL daily cap has to
            // name a model; the caller resolved it before reserving. So the override is sent
            // only when the gate actually CHANGED the model — an AC#5 routing decision or an
            // over-budget downgrade — which is exactly when the call must not use the default.
            const changed = model !== budget.reservation.requestedModel;
            const result = await callProvider(changed ? model : options.model);
            return { value: result, trace: result.trace };
          },
        });
        response = budgeted.value;
      } else {
        response = await callProvider(options.model);
      }
      const output = parseWholeSceneOutput(response.output, scene);
      return finalizeWholeSceneOutput(simulationRunId, scene, output, attempt,
        { ...response.trace, retryCount: response.trace.retryCount + attempt - 1 });
    } catch (error) {
      lastError = error;
      // A budget refusal is NOT retryable. Retrying it would spend the retry budget arguing with
      // the limit that just refused the call, and every further attempt would be refused for the
      // same reason with one more audit row to explain it.
      if (error instanceof SceneBudgetError) throw error;
      const retryable = error instanceof SceneSimulationError
        || (error instanceof SimulationProviderError && error.kind === 'transient');
      if (!retryable || attempt === maxAttempts) break;
    }
  }
  if (lastError instanceof SceneSimulationError) throw lastError;
  if (lastError instanceof SimulationProviderError) throw lastError;
  throw new SceneSimulationError('SCENE_SIMULATION_FAILED', 'whole-scene provider failed');
}
