/**
 * A Canon refusal reaches the author while another attempt is still possible (ART-205).
 *
 * ## What this replaces
 *
 * The whole-scene retry loop only ever saw PARSER rejections. Canon validation runs at stage 8,
 * inside the finishing mutation, after the authoring action has returned — so a scene whose
 * proposals parsed but violated Canon was persisted, and ART-149 reuse replayed the identical
 * stored scene into the identical refusal on every retry. The slot could not recover however many
 * attempts it was given, and no provider call was ever made to try anything different.
 *
 * Day 5 morning on the acceptance world sat `failed` at four attempts with
 * `PRIVATE_RELATIONSHIP_DISCLOSURE` and nothing changing between them. Day 6 kept producing
 * `DUPLICATE_CHARACTER_MOVEMENT` even after ART-204 stated that rule in the prompt — because a rule
 * a model breaks is not a rule the prompt can fix.
 *
 * Six prompt-contract fixes each raised the chance a scene is born valid. This is the first thing
 * that can rescue one that is not.
 */

import { validateEventStructure } from '../canon/validators';
import { canonRejectionFeedback, renderCanonRejection, GENERIC_INSTRUCTION } from './canonFeedback';
import { FakeWholeSceneProvider } from './fakeSceneNarrator';
import type {
  EmbeddingResult, LanguageModelProvider, StructuredChatRequest, StructuredChatResult,
} from './provider';
import type { GroupedScene } from './sceneGrouping';
import {
  SCENE_CANON_REJECTED, SceneSimulationError, simulateWholeScene,
  type WholeSceneSimulationOptions,
} from './sceneSimulation';

const scene: GroupedScene = {
  schemaVersion: 1, sceneId: 'grouping:mistwood:5:morning:scene:1',
  groupingRunId: 'grouping:mistwood:5:morning', directorRunId: 'director-1',
  worldId: 'mistwood', worldDay: 5, timeSlot: 'morning', locationId: 'mistwood-hall',
  participantIds: ['gao-wenrui', 'lin-yingxue'], sourceIntentIds: ['intent-1'],
  arcIds: ['arc-ledger'], trigger: '帳冊的缺頁', dramaticPressure: '鎮長在午前抵達',
};

type RecordedAttempt = Parameters<NonNullable<WholeSceneSimulationOptions['onAttempt']>>[0];

const collector = () => {
  const recorded: RecordedAttempt[] = [];
  return { recorded, onAttempt: (attempt: RecordedAttempt) => { recorded.push(attempt); } };
};

/** A provider that records every system prompt it is given, and answers with the fake author. */
class PromptRecordingProvider implements LanguageModelProvider {
  readonly prompts: string[] = [];
  private readonly inner = new FakeWholeSceneProvider();

  structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
    this.prompts.push(request.messages.find(({ role }) => role === 'system')?.content ?? '');
    return this.inner.structuredChat(request);
  }

  embed(text: string): Promise<EmbeddingResult> { return this.inner.embed(text); }
}

/** Refuses the first `refuseFirstN` parsed scenes, then accepts. */
const refusingValidator = (refuseFirstN: number, code = 'DUPLICATE_CHARACTER_MOVEMENT') => {
  let calls = 0;
  return {
    get calls() { return calls; },
    validate: () => {
      calls += 1;
      return Promise.resolve(calls <= refuseFirstN
        ? canonRejectionFeedback({
          code, message: 'a character may move at most once per event', path: 'stateChanges[0]',
        }, 0)
        : null);
    },
  };
};

// =============================================================================
// 1 & 3. A Canon refusal is retried, and a corrected second answer commits
// =============================================================================

describe('a scene that parses and Canon refuses', () => {
  it('really calls the provider a SECOND time', async () => {
    // The behaviour that did not exist: a canon refusal used to be discovered two stages later by
    // a pass that had no way to ask for anything different.
    const provider = new PromptRecordingProvider();
    const validator = refusingValidator(1);

    const result = await simulateWholeScene(provider, 'sim:canon-retry', scene, {
      maxAttempts: 2, validateProposals: validator.validate,
    });

    expect(provider.prompts).toHaveLength(2);
    expect(validator.calls).toBe(2);
    expect(result.attemptCount).toBe(2);
  });

  it('records the refusal as its own outcome, not as a schema failure', async () => {
    /**
     * `canon_rejected`, deliberately not `output_rejected`. §16.2's 「JSON 結構成功率」 is about
     * whether a model can follow a schema; this answer followed it perfectly and proposed something
     * the world forbids. Folding the two together would make the metric fall for a reason it does
     * not measure — the conflation this codebase has already had to fix twice.
     */
    const { recorded, onAttempt } = collector();
    await simulateWholeScene(new PromptRecordingProvider(), 'sim:outcome', scene, {
      maxAttempts: 2, onAttempt, validateProposals: refusingValidator(1).validate,
    });

    expect(recorded.map(({ outcome }) => outcome)).toEqual(['canon_rejected', 'parsed']);
    expect(recorded[0].errorCode).toBe(SCENE_CANON_REJECTED);
    expect(recorded[0].failure).toMatchObject({
      code: SCENE_CANON_REJECTED, stage: 'output_validation', retryable: true,
    });
  });
});

// =============================================================================
// 2. The refusal is in the next request
// =============================================================================

describe('the refusal reaches the next attempt', () => {
  it('puts the rule, the location and the correction into the retry prompt', async () => {
    const provider = new PromptRecordingProvider();
    await simulateWholeScene(provider, 'sim:feedback', scene, {
      maxAttempts: 2, validateProposals: refusingValidator(1).validate,
    });

    const [first, second] = provider.prompts;
    // The first attempt knows nothing of a refusal that has not happened.
    expect(first).not.toContain('REJECTED by Canon');
    expect(second).toContain('REJECTED by Canon');
    expect(second).toContain('DUPLICATE_CHARACTER_MOVEMENT');
    expect(second).toContain('a character may move at most once per event');
    expect(second).toContain('proposedEvents[0] stateChanges[0]');
    expect(second).toContain('at most ONE character_location_changed');
  });

  it('puts the correction FIRST, ahead of the rules that were already broken', async () => {
    /**
     * On a retry the general rules are the ones that were present and were broken. Burying a
     * specific correction under them is how a model reads past it.
     */
    const provider = new PromptRecordingProvider();
    await simulateWholeScene(provider, 'sim:order', scene, {
      maxAttempts: 2, validateProposals: refusingValidator(1).validate,
    });
    expect(provider.prompts[1].indexOf('REJECTED by Canon')).toBeLessThan(
      provider.prompts[1].indexOf('Simulate the entire grouped scene once'));
  });

  it('does not carry a stale refusal once one attempt is accepted', async () => {
    // Three attempts, refusal only on the first. The third must not still be apologising for it.
    const provider = new PromptRecordingProvider();
    const validator = refusingValidator(1);
    await simulateWholeScene(provider, 'sim:stale', scene, {
      maxAttempts: 3, validateProposals: validator.validate,
    });
    expect(provider.prompts).toHaveLength(2);
  });
});

// =============================================================================
// 4. A refused scene is never returned, so it can never be stored or reused
// =============================================================================

describe('a refused scene is not reusable, because it never exists', () => {
  it('returns nothing at all when every attempt is refused', async () => {
    /**
     * The structural half of ART-205. `authorSlotScenes` persists what `simulateWholeScene`
     * RETURNS, so a scene refused on every attempt is never persisted and ART-149 reuse has nothing
     * to replay. That is what made a refused slot unrecoverable: the stored scene was handed back
     * to every subsequent attempt unchanged.
     */
    const provider = new PromptRecordingProvider();
    await expect(simulateWholeScene(provider, 'sim:exhausted', scene, {
      maxAttempts: 2, validateProposals: refusingValidator(99).validate,
    })).rejects.toMatchObject({ code: SCENE_CANON_REJECTED });

    // Both attempts were real provider calls, not a replay of the first answer.
    expect(provider.prompts).toHaveLength(2);
  });

  it('returns the accepted scene, and only the accepted one', async () => {
    const result = await simulateWholeScene(new PromptRecordingProvider(), 'sim:accepted', scene, {
      maxAttempts: 2, validateProposals: refusingValidator(1).validate,
    });
    expect(result.scene.sceneId).toBe(scene.sceneId);
    expect(result.output.proposedEvents.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// 5. Exhaustion commits nothing and keeps the reason
// =============================================================================

describe('when every attempt is refused', () => {
  it('throws the Canon code rather than a generic failure, and proposes nothing', async () => {
    const { recorded, onAttempt } = collector();
    const error = await simulateWholeScene(new PromptRecordingProvider(), 'sim:exhaust', scene, {
      maxAttempts: 2, onAttempt, validateProposals: refusingValidator(99, 'PRIVATE_RELATIONSHIP_DISCLOSURE').validate,
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(SceneSimulationError);
    expect((error as SceneSimulationError).code).toBe(SCENE_CANON_REJECTED);
    // The specific rule survives exhaustion — a failed slot still says which rule it could not meet.
    expect((error as SceneSimulationError).message).toContain('PRIVATE_RELATIONSHIP_DISCLOSURE');
    expect(recorded).toHaveLength(2);
    expect(recorded.every(({ outcome }) => outcome === 'canon_rejected')).toBe(true);
  });

  it('does not lower the threshold to get past it', async () => {
    // The validator is asked on EVERY attempt, including the last. Nothing accepts a scene because
    // the retries ran out.
    const validator = refusingValidator(99);
    await simulateWholeScene(new PromptRecordingProvider(), 'sim:threshold', scene, {
      maxAttempts: 3, validateProposals: validator.validate,
    }).catch(() => undefined);
    expect(validator.calls).toBe(3);
  });
});

// =============================================================================
// 6. The real regression: duplicate movement
// =============================================================================

describe('the duplicate-movement refusal that ART-204 could not fix', () => {
  /** The scene the live world actually produced: two hops for one character in one event. */
  const twoHops = {
    schemaVersion: 1, worldId: scene.worldId, idempotencyKey: `${scene.sceneId}:1`,
    proposedBy: { type: 'system' }, worldDay: scene.worldDay, timeSlot: scene.timeSlot,
    eventType: 'movement', locationId: scene.locationId,
    participantIds: ['gao-wenrui'], causedByEventIds: [], publicSummary: '他離開了大廳。',
    stateChanges: [
      {
        type: 'character_location_changed', characterId: 'gao-wenrui',
        fromLocationId: 'mistwood-hall', toLocationId: 'mistwood-mill',
      },
      {
        type: 'character_location_changed', characterId: 'gao-wenrui',
        fromLocationId: 'mistwood-mill', toLocationId: 'mistwood-paper',
      },
    ],
  };

  it('is structurally valid, which is why the parser let it through', () => {
    // The whole reason this defect class exists: the schema had no complaint.
    expect(validateEventStructure(twoHops)).toBeNull();
  });

  it('turns into a correction the author can act on', () => {
    const feedback = canonRejectionFeedback({
      code: 'DUPLICATE_CHARACTER_MOVEMENT',
      message: 'a character may move at most once per event',
      path: 'stateChanges[1]',
    }, 0);
    const rendered = renderCanonRejection(feedback);

    expect(rendered).toContain('at most ONE character_location_changed for that character');
    expect(rendered).toContain('Produce the whole scene again, corrected');
    // Not a restatement of the rule it already broke: it names what to change.
    expect(feedback.instruction).not.toBe(GENERIC_INSTRUCTION);
  });

  it('says so honestly when it has no specific correction', () => {
    // Inventing a correction for a rule this table does not know would be worse than admitting it.
    expect(canonRejectionFeedback({ code: 'SOME_FUTURE_RULE', message: 'x' }).instruction)
      .toBe(GENERIC_INSTRUCTION);
  });
});

// =============================================================================
// 7. Secret safety
// =============================================================================

describe('feedback carries no world state and no secret', () => {
  it('drops the validator payload whole rather than filtering it', () => {
    /**
     * `details` is the one field on a `CanonValidationError` that can carry world state —
     * capacities, occupancies, ids the author was never given. Dropping it entirely is a stronger
     * guarantee than deciding field by field which parts are safe.
     */
    const feedback = canonRejectionFeedback({
      code: 'UNKNOWN_LOCATION_REFERENCE',
      message: 'destination capacity would be exceeded',
      path: 'stateChanges[0]',
      // @ts-expect-error — the real error carries this; the contract deliberately has no home for it.
      details: { locationId: 'mistwood-vault', capacity: 2, occupancy: 2, secretHolder: 'he-jun' },
    }, 0);

    const serialized = JSON.stringify(feedback);
    expect(serialized).not.toContain('mistwood-vault');
    expect(serialized).not.toContain('secretHolder');
    expect(serialized).not.toContain('he-jun');
    expect(Object.keys(feedback).sort())
      .toEqual(['code', 'instruction', 'path', 'proposedEventIndex', 'rule']);
  });

  it('sanitizes and bounds the rule text it does carry', () => {
    // The messages are repository constants, so this is insurance rather than a live risk — but a
    // validator message is the one place a future author could interpolate something.
    const feedback = canonRejectionFeedback({
      code: 'INVALID_EVENT_SHAPE',
      message: `rejected with Bearer sk-live-9f2b7c11aa04 ${'x'.repeat(400)}`,
    });
    expect(feedback.rule).not.toContain('sk-live-9f2b7c11aa04');
    expect(feedback.rule.length).toBeLessThanOrEqual(200);
  });

  it('keeps the rendered block free of anything the author was not given', () => {
    const rendered = renderCanonRejection(canonRejectionFeedback({
      code: 'PARTICIPANT_MISMATCH', message: 'relationship characters must be event participants',
      path: 'stateChanges[0]',
      // @ts-expect-error — as above.
      details: { characterId: 'someone-else-entirely' },
    }, 2));
    expect(rendered).not.toContain('someone-else-entirely');
    expect(rendered).toContain('proposedEvents[2]');
  });
});
