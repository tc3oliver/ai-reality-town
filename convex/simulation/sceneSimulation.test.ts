import { readFileSync } from 'node:fs';
import type { ProposedEvent } from '../canon/model';
import { OpenAICompatibleProvider } from './providers/openAICompatible';
import type { OpenAICompatibleConfig } from './providers/config';
import type { LanguageModelProvider, StructuredChatRequest, StructuredChatResult } from './provider';
import { SimulationProviderError } from './provider';
import type { GroupedScene } from './sceneGrouping';
import { STATE_CHANGE_TYPES } from '../canon/eventTypes';
import { parseWholeSceneOutput, SceneSimulationError, simulateWholeScene, WHOLE_SCENE_JSON_SCHEMA, wholeSceneSystemPrompt } from './sceneSimulation';

const scene: GroupedScene = {
  schemaVersion: 1, sceneId: 'group-1:scene:1', groupingRunId: 'group-1', directorRunId: 'director-1',
  worldId: 'mistwood', worldDay: 2, timeSlot: 'evening', locationId: 'mistwood-station',
  participantIds: ['lin-yingxue', 'wu-zhen'], sourceIntentIds: ['intent-1', 'intent-2'],
  arcIds: ['arc-station-ledger'], trigger: 'Open the sealed locker', dramaticPressure: 'The mayor arrives at dusk',
};

const proposal = (): ProposedEvent => ({
  schemaVersion: 1, worldId: 'mistwood', idempotencyKey: 'scene:group-1:1', proposedBy: { type: 'system' },
  worldDay: 2, timeSlot: 'evening', eventType: 'discovery', participantIds: ['lin-yingxue', 'wu-zhen'],
  causedByEventIds: [], publicSummary: 'Yingxue and Wu Zhen open the station locker.',
  stateChanges: [{ type: 'fact_created', subjectType: 'location', subjectId: 'mistwood-station',
    predicate: 'lockerOpened', value: true, visibility: 'public' }],
});

const output = (summary = 'Yingxue opens the locker while Wu Zhen watches.'): unknown => ({
  schemaVersion: 1, sceneId: scene.sceneId, sceneSummary: summary,
  keyActions: [{ characterId: 'lin-yingxue', action: 'Turns the locker key.' }],
  dialogueHighlights: [{ characterId: 'wu-zhen', text: 'That is the envelope I delivered.' }],
  proposedEvents: [proposal()],
  relationshipChanges: [{ sourceCharacterId: 'lin-yingxue', targetCharacterId: 'wu-zhen', summary: 'Yingxue trusts his admission.', proposedEventIndex: 0 }],
  knowledgeChanges: [{ characterId: 'lin-yingxue', content: 'Wu Zhen delivered the envelope.', proposedEventIndex: 0 }],
  memories: [{ characterId: 'wu-zhen', content: 'Yingxue opened the locker.', proposedEventIndex: 0 }],
  rumors: [{ sourceCharacterId: 'wu-zhen', content: 'The old locker was opened.', proposedEventIndex: 0 }],
  continuityWarnings: [],
});

class SequenceProvider implements LanguageModelProvider {
  calls: StructuredChatRequest[] = [];
  constructor(private readonly results: unknown[]) {}
  structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
    this.calls.push(request);
    const next = this.results.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({ output: next, trace: { provider: 'fake', model: 'scene-fake-v1', inputTokens: 10,
      outputTokens: 20, latencyMs: 1, retryCount: 0 } });
  }
  embed(): Promise<never> { return Promise.reject(new Error('not used')); }
}

describe('FR-C005 whole-scene simulation', () => {
  it('simulates the whole scene once and runtime-validates every required output and Proposed Event', async () => {
    const provider = new SequenceProvider([output()]);
    const result = await simulateWholeScene(provider, 'simulation-1', scene, 2);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].messages[1].content).toContain(scene.sceneId);
    expect(provider.calls[0].messages[1].content).toContain('lin-yingxue');
    expect(result).toMatchObject({ schemaVersion: 1, simulationRunId: 'simulation-1', attemptCount: 1,
      reviewStatus: 'not_required', safety: { label: 'allow' }, output: { sceneId: scene.sceneId } });
    expect(result.output.proposedEvents).toHaveLength(1);
    expect(result.output.relationshipChanges).toHaveLength(1);
    expect(result.output.knowledgeChanges).toHaveLength(1);
    expect(result.output.memories).toHaveLength(1);
    expect(result.output.rumors).toHaveLength(1);
  });

  it('retries malformed structured output as one whole-scene attempt and then succeeds', async () => {
    const provider = new SequenceProvider([{ schemaVersion: 1, sceneId: scene.sceneId }, output()]);
    const result = await simulateWholeScene(provider, 'simulation-retry', scene, 2);
    expect(provider.calls).toHaveLength(2);
    expect(result.attemptCount).toBe(2);
    expect(result.trace.retryCount).toBe(1);
  });

  it('fails after the bounded invalid-output retry budget and does not accept unknown or foreign data', async () => {
    const bad = { ...(output() as Record<string, unknown>), administrativeOverride: true };
    const provider = new SequenceProvider([bad, bad]);
    await expect(simulateWholeScene(provider, 'simulation-invalid', scene, 2)).rejects
      .toMatchObject({ code: 'SCENE_OUTPUT_INVALID' });
    expect(provider.calls).toHaveLength(2);

    const foreign = output() as Record<string, unknown>;
    foreign.proposedEvents = [{ ...proposal(), worldId: 'other-world' }];
    expect(() => parseWholeSceneOutput(foreign, scene)).toThrow(/Scene world, slot, and participants/);
  });

  it('retries transient providers but immediately rejects permanent provider failures', async () => {
    const transient = new SequenceProvider([new SimulationProviderError('transient', 'TEMP', 'temporary'), output()]);
    await expect(simulateWholeScene(transient, 'simulation-transient', scene, 2)).resolves.toMatchObject({ attemptCount: 2 });
    const permanent = new SequenceProvider([new SimulationProviderError('permanent', 'NO', 'rejected'), output()]);
    await expect(simulateWholeScene(permanent, 'simulation-permanent', scene, 2)).rejects.toMatchObject({ code: 'NO' });
    expect(permanent.calls).toHaveLength(1);
  });

  it('routes high-risk output to safety review and retains no public/raw-output API', async () => {
    const provider = new SequenceProvider([output('The scene contains graphic torture.')]);
    const result = await simulateWholeScene(provider, 'simulation-risk', scene);
    expect(result).toMatchObject({ reviewStatus: 'required', safety: { label: 'withhold', reasonCodes: ['EXTREME_VIOLENCE_DETAIL'] } });
    const functions = readFileSync('convex/simulation/sceneSimulationFunctions.ts', 'utf8');
    const service = readFileSync('convex/simulation/sceneSimulation.ts', 'utf8');
    expect(functions).toContain('internalMutation({');
    expect(functions).toContain('internalQuery({');
    expect(functions).not.toMatch(/\bmutation\(\{|\bquery\(\{|rawOutput|providerOutput/);
    expect(service).not.toMatch(/commitProposedEvent|insert\(['"]canonEvents|reduceWorldEvent/);
  });

  /**
   * ART-124 (FR-O006) widened what the scene's single post-generation classification examines.
   *
   * A scene does not only narrate. Through `fact_created` on a character and through
   * `character_state_changed`, it also WRITES that character's public biography —
   * `publicProfile`, `publicGoal`, `personality`, `occupation` — straight into the public
   * Character projection, where it is read on the character page and the character card. Until
   * ART-124 the classifier never saw those strings, so a scene could be classified `allow` on a
   * bland summary while proposing a biography the same classifier would have refused.
   *
   * The fix is to widen the classifier's INPUT, not to add a second classification: there is
   * still exactly one verdict per scene, so an operator override keeps governing the scene as a
   * unit and the projection-side gate reads the same label it always did.
   */
  describe('ART-124 — character-fact text is classified too, not just narration', () => {
    function withCharacterFact(change: Record<string, unknown>): unknown {
      const payload = output() as Record<string, unknown>;
      payload.proposedEvents = [{
        ...proposal(),
        stateChanges: [change],
      }];
      return payload;
    }

    it('withholds a scene whose narration is bland but whose character fact is not', async () => {
      const provider = new SequenceProvider([withCharacterFact({
        type: 'fact_created', subjectType: 'character', subjectId: 'lin-yingxue',
        predicate: 'publicProfile', value: 'Her past is a record of graphic torture.',
        visibility: 'public',
      })]);
      const result = await simulateWholeScene(provider, 'simulation-fact-risk', scene);
      expect(result).toMatchObject({
        reviewStatus: 'required',
        safety: { label: 'withhold', reasonCodes: ['EXTREME_VIOLENCE_DETAIL'] },
      });
    });

    it('classifies a character_state_changed value the same way', async () => {
      // `character_state_changed` carries no `visibility`: every accepted one is public-facing
      // by construction, since `CHARACTER_STATE_FIELD_MAP` folds it into the public projection.
      const provider = new SequenceProvider([withCharacterFact({
        type: 'character_state_changed', characterId: 'lin-yingxue', field: 'occupation',
        toValue: 'Keeper of graphic torture records', reason: 'the scene revealed it',
      })]);
      const result = await simulateWholeScene(provider, 'simulation-state-risk', scene);
      expect(result.safety.label).toBe('withhold');
    });

    it('does NOT scan `availability`, which accepts prose but reaches no public field', async () => {
      // The over-scan this guards against is not merely over-cautious, it is destructive: a
      // `withhold` sets `reviewStatus: 'required'`, which keeps the WHOLE scene out of Canon. A
      // false positive on `availability` — which `CHARACTER_STATE_FIELD_MAP` publishes nowhere —
      // would therefore throw away that scene's unrelated location changes, relationship updates
      // and memories along with a string no viewer was ever going to see.
      //
      // `availability` is the sharp case because Canon validates it as a free non-empty string.
      // `organization_memberships` is validated as an array of REFERENCES
      // (`validators.ts` → `isReference`), so it cannot carry prose in the first place and is
      // excluded here for tidiness rather than as the live risk.
      const provider = new SequenceProvider([withCharacterFact({
        type: 'character_state_changed', characterId: 'lin-yingxue', field: 'availability',
        toValue: 'Available except during graphic torture', reason: 'the scene revealed it',
      })]);
      const result = await simulateWholeScene(provider, 'simulation-unpublished-availability', scene);
      expect(result.safety.label).toBe('allow');
      expect(result.reviewStatus).toBe('not_required');
    });

    it('does not let a boolean `active` change reach the classifier at all', async () => {
      const provider = new SequenceProvider([withCharacterFact({
        type: 'character_state_changed', characterId: 'lin-yingxue', field: 'active',
        toValue: false, reason: 'left the town',
      })]);
      expect((await simulateWholeScene(provider, 'simulation-active', scene)).safety.label).toBe('allow');
    });

    it('leaves a private fact and a non-character subject out of scope', async () => {
      // A `private` fact never reaches a public surface, and a world or location fact is not
      // this gate's business — `publicSummary` already covers what a viewer would read of it.
      const privateFact = new SequenceProvider([withCharacterFact({
        type: 'fact_created', subjectType: 'character', subjectId: 'lin-yingxue',
        predicate: 'privateGoal', value: 'A plan involving graphic torture.', visibility: 'private',
      })]);
      expect((await simulateWholeScene(privateFact, 'simulation-private', scene)).safety.label).toBe('allow');

      const locationFact = new SequenceProvider([withCharacterFact({
        type: 'fact_created', subjectType: 'location', subjectId: 'mistwood-station',
        predicate: 'condition', value: 'lockerOpened', visibility: 'public',
      })]);
      expect((await simulateWholeScene(locationFact, 'simulation-location', scene)).safety.label).toBe('allow');
    });

    it('still classifies an ordinary scene as allow, so the widening is not a blanket refusal', async () => {
      const provider = new SequenceProvider([withCharacterFact({
        type: 'fact_created', subjectType: 'character', subjectId: 'lin-yingxue',
        predicate: 'publicProfile', value: 'The station clerk, careful with other people’s letters.',
        visibility: 'public',
      })]);
      expect((await simulateWholeScene(provider, 'simulation-ok', scene)).safety.label).toBe('allow');
    });
  });

  it('rejects invalid Scene provenance and unlinked changes with stable validation errors', () => {
    expect(() => parseWholeSceneOutput({ ...(output() as Record<string, unknown>), sceneId: 'other' }, scene))
      .toThrow(SceneSimulationError);
    const unlinked = output() as Record<string, unknown>;
    unlinked.knowledgeChanges = [{ characterId: 'lin-yingxue', content: 'Impossible', proposedEventIndex: 9 }];
    expect(() => parseWholeSceneOutput(unlinked, scene)).toThrow(/Proposed Event index/);
  });

  describe('ART-139 real-provider schemaVersion contract (FR-C002)', () => {
    const providerConfig: OpenAICompatibleConfig = { apiUrl: 'https://llm.example/v1',
      chatUrl: 'https://llm.example/v1/chat/completions', embeddingUrl: 'https://llm.example/v1/embeddings',
      chatModel: 'chat-model', embeddingModel: 'embed-model', embeddingDimension: 3, apiKey: 'k',
      allowUnauthenticated: false, timeoutMs: 100, maxAttempts: 1 };
    const asChatResponse = (body: unknown) => new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }], usage: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } });

    // A strict-mode JSON Schema compiler that drops an under-typed `{ const: 1 }` (no declared `type`)
    // commonly stringifies the sentinel instead of emitting the integer -- this is the shape observed
    // against the real provider in ART-106's smoke test. This is a permanent regression test for ART-139.
    it('parses the real-provider schemaVersion shape ("1" as a string) via the tolerated normalization', async () => {
      const provider = new OpenAICompatibleProvider(providerConfig, { fetch: () =>
        Promise.resolve(asChatResponse({ ...(output() as Record<string, unknown>), schemaVersion: '1' })) });
      const chat = await provider.structuredChat({ messages: [{ role: 'user', content: 'simulate' }],
        schemaName: 'whole_scene_output', jsonSchema: WHOLE_SCENE_JSON_SCHEMA, temperature: 0.4, maxTokens: 4_000 });
      const result = parseWholeSceneOutput(chat.output, scene);
      expect(result.schemaVersion).toBe(1);
    });

    it('rejects a genuinely wrong schemaVersion with a precise, distinct field path', () => {
      expect(() => parseWholeSceneOutput({ ...(output() as Record<string, unknown>), schemaVersion: 2 }, scene))
        .toThrow(SceneSimulationError);
      try {
        parseWholeSceneOutput({ ...(output() as Record<string, unknown>), schemaVersion: 2 }, scene);
        throw new Error('expected SceneSimulationError');
      } catch (error) {
        expect(error).toBeInstanceOf(SceneSimulationError);
        expect((error as SceneSimulationError).path).toBe('schemaVersion');
      }
    });

    // Confirmed against the real provider: schemaVersion is commonly omitted entirely, not just
    // sent as the wrong type. It is a caller-known constant (always 1), so a missing value is
    // defaulted rather than rejected -- this is the actual real-provider shape, not a hypothesis.
    it('defaults a missing schemaVersion to 1 instead of rejecting it (confirmed real-provider shape)', () => {
      const missing = output() as Record<string, unknown>;
      delete missing.schemaVersion;
      expect(parseWholeSceneOutput(missing, scene).schemaVersion).toBe(1);
    });

    it('defaults a missing sceneId to the Scene ID already known from the request (confirmed real-provider shape)', () => {
      const missing = output() as Record<string, unknown>;
      delete missing.sceneId;
      expect(parseWholeSceneOutput(missing, scene).sceneId).toBe(scene.sceneId);
    });

    it('rejects an unknown field inside a nested collection with its own precise field path', () => {
      const badRelationship = output() as Record<string, unknown>;
      badRelationship.relationshipChanges = [{ sourceCharacterId: 'lin-yingxue', targetCharacterId: 'wu-zhen',
        summary: 'x', proposedEventIndex: 0, confidence: 0.9 }];
      try {
        parseWholeSceneOutput(badRelationship, scene);
        throw new Error('expected SceneSimulationError');
      } catch (error) {
        expect(error).toBeInstanceOf(SceneSimulationError);
        expect((error as SceneSimulationError).path).toBe('relationshipChanges[0]');
      }
    });

    it('declares nested item properties in the request schema matching every parser allowed-key list', () => {
      const properties = WHOLE_SCENE_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>;
      expect(properties.schemaVersion).toMatchObject({ type: 'integer', const: 1 });
      for (const key of ['keyActions', 'dialogueHighlights', 'relationshipChanges', 'knowledgeChanges', 'memories', 'rumors', 'proposedEvents']) {
        const items = properties[key].items as Record<string, unknown>;
        expect(items.additionalProperties).toBe(false);
        expect(Array.isArray(items.required)).toBe(true);
      }
    });
  });

  describe('ART-141 real-provider proposedEvents contract (FR-C002)', () => {
    // Every payload below was captured verbatim from the configured provider
    // (https://llm.shouri.app/v1, LLM_MODEL=auto) on 2026-08-06 for this scene.
    const travelScene: GroupedScene = {
      schemaVersion: 1, sceneId: 'group-live:scene:1', groupingRunId: 'group-live', directorRunId: 'director-live',
      worldId: 'mistwood', worldDay: 3, timeSlot: 'morning', locationId: 'mistwood-square',
      participantIds: ['wu-zhen', 'lin-yingxue'], sourceIntentIds: ['intent-live-1', 'intent-live-2'],
      arcIds: ['arc-station-ledger'],
      trigger: 'Wu Zhen must deliver a sealed envelope, so he leaves the town square and walks to the station where Lin Yingxue is waiting.',
      dramaticPressure: 'The envelope must reach the station before the morning train departs.',
    };

    const conformingOutput = (): Record<string, unknown> => ({
      schemaVersion: 1, sceneId: 'group-live:scene:1',
      sceneSummary: '吳真攜帶著密封信封，在早晨的時限壓力下，迅速離開迷霧鎮廣場前往車站，將信件交付給等待中的林映雪。',
      keyActions: [{ characterId: 'wu-zhen', action: '快步穿過廣場並前往車站，遞交密封信封。' },
        { characterId: 'lin-yingxue', action: '在車站等待吳真，並接過信封。' }],
      dialogueHighlights: [{ characterId: 'wu-zhen', text: '快接住！差點就趕不上早班車了。' },
        { characterId: 'lin-yingxue', text: '你來得正是時候，這封信對我們至關重要。' }],
      proposedEvents: [
        { schemaVersion: 1, worldId: 'mistwood', idempotencyKey: 'group-live:event:1:1', proposedBy: { type: 'system' },
          worldDay: 3, timeSlot: 'morning', eventType: 'movement', locationId: 'mistwood-station',
          participantIds: ['wu-zhen'], causedByEventIds: [], publicSummary: '吳真從迷霧鎮廣場趕往車站。',
          stateChanges: [{ type: 'character_location_changed', characterId: 'wu-zhen',
            fromLocationId: 'mistwood-square', toLocationId: 'mistwood-station' }] },
        { schemaVersion: 1, worldId: 'mistwood', idempotencyKey: 'group-live:event:1:2', proposedBy: { type: 'system' },
          worldDay: 3, timeSlot: 'morning', eventType: 'conversation', locationId: 'mistwood-station',
          participantIds: ['wu-zhen', 'lin-yingxue'], causedByEventIds: ['group-live:event:1:1'],
          publicSummary: '吳真將密封信封交付給林映雪。',
          stateChanges: [
            { type: 'item_transferred', itemId: 'sealed-envelope-01', fromOwnerId: 'wu-zhen', toOwnerId: 'lin-yingxue', reason: '交付重要機密信件' },
            { type: 'relationship_changed', sourceCharacterId: 'lin-yingxue', targetCharacterId: 'wu-zhen',
              trustDelta: 0.1, affectionDelta: 0, resentmentDelta: 0, fearDelta: 0, dependencyDelta: 0.1,
              familiarityDelta: 0.05, reason: '吳真在時限內準時交付信件', visibility: 'private' }] },
      ],
      relationshipChanges: [{ sourceCharacterId: 'lin-yingxue', targetCharacterId: 'wu-zhen',
        summary: '林映雪對吳真的信任度略微提升，因為他成功在期限前交付了信件。', proposedEventIndex: 1 }],
      knowledgeChanges: [{ characterId: 'lin-yingxue', content: '密封信封已安全送達。', proposedEventIndex: 1 }],
      memories: [{ characterId: 'wu-zhen', content: '在早晨的壓力下趕到車站並將信交給林映雪的緊張過程。', proposedEventIndex: 1 }],
      rumors: [], continuityWarnings: [],
    });

    it('parses the confirmed conforming real-provider response end to end', () => {
      const result = parseWholeSceneOutput(conformingOutput(), travelScene);
      expect(result.proposedEvents).toHaveLength(2);
      expect(result.proposedEvents.flatMap((event) => event.stateChanges.map((change) => change.type)))
        .toEqual(['character_location_changed', 'item_transferred', 'relationship_changed']);
    });

    it('rejects the pre-fix real-provider proposedEvents shape', () => {
      const preFix = conformingOutput();
      preFix.proposedEvents = [{ eventId: 'event-train-departure',
        publicSummary: '林盈雪帶著信件登上早班列車，離開迷霧鎮。', trigger: '列車發車信號響起。' }];
      expect(() => parseWholeSceneOutput(preFix, travelScene)).toThrow(/unknown fields/);
    });

    it('rejects the pre-fix real-provider memories shape that absorbed character_memory_formed fields', () => {
      const preFix = conformingOutput();
      preFix.memories = [{ characterId: 'wu-zhen', content: '緊張的交付過程。', interpretation: '責任感',
        importance: 0.8, emotionalWeight: 0.6, confidence: 0.9, visibility: 'private' }];
      try {
        parseWholeSceneOutput(preFix, travelScene);
        throw new Error('expected SceneSimulationError');
      } catch (error) {
        expect((error as SceneSimulationError).path).toBe('memories[0]');
      }
    });

    // The configured gateway accepts `response_format: { type: 'json_schema', strict: true }` but does
    // not enforce it, so the schema only actually binds the model by travelling in the prompt.
    it('carries the request schema and the proposedEvents contract in the system prompt', () => {
      const prompt = wholeSceneSystemPrompt(travelScene);
      expect(prompt).toContain(JSON.stringify(WHOLE_SCENE_JSON_SCHEMA));
      expect(prompt).toContain('never invent fields');
      expect(prompt).toContain('eventId');
      expect(prompt).toContain('character_memory_formed');
      expect(prompt).toContain('"type":"character_location_changed"');
    });

    it('keeps every object node of the request schema strict-mode conformant', () => {
      const visit = (node: unknown, path: string): void => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return;
        const schema = node as Record<string, unknown>;
        if (schema.type === 'object') {
          const properties = schema.properties as Record<string, unknown> | undefined;
          expect(properties && Object.keys(properties).length > 0).toBe(true);
          expect(schema.additionalProperties).toBe(false);
          expect(schema.required).toEqual(Object.keys(properties ?? {}));
        }
        for (const [key, child] of Object.entries(schema.properties ?? {})) visit(child, `${path}.${key}`);
        visit(schema.items, `${path}[]`);
        for (const [index, child] of (schema.anyOf as unknown[] ?? []).entries()) visit(child, `${path}|${index}`);
      };
      visit(WHOLE_SCENE_JSON_SCHEMA, '$');
    });

    it('describes every canon state-change variant so the model cannot invent one', () => {
      const properties = WHOLE_SCENE_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>;
      const event = properties.proposedEvents.items as Record<string, Record<string, unknown>>;
      const variants = (event.properties.stateChanges as Record<string, Record<string, unknown>>).items.anyOf as Record<string, Record<string, Record<string, string>>>[];
      expect(variants.map((variant): string => variant.properties.type.const)).toEqual([...STATE_CHANGE_TYPES]);
    });
  });
});
