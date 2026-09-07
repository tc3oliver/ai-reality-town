/**
 * FR-E005 at the public boundary: a rumor chain is internal, and stays internal (ART-28).
 *
 * A rumor chain is close to the worst thing this codebase could publish. It names who started
 * something, who repeated it to whom, what each holder privately believes, and — through
 * `objectiveTruthStatus` — Canon's verdict on a claim the town has not settled. Publishing the
 * last one alone would hand a viewer the answer to the secret the story is about.
 *
 * So the guarantee is not "the rumor payload is filtered correctly". It is that there IS no rumor
 * payload: nothing public reads `projection.rumors` at all, and the names a future one would use
 * are forbidden before anything can emit them.
 *
 * The projection-sourced builders are exercised for real rather than reasoned about. They take
 * the whole `WorldProjection` — the same object the rumor chain now lives on — so they are the
 * surface where "we added a field to the projection" turns into a leak without anyone editing a
 * public module.
 */

import { commitProposedEvent } from '../canon/commit';
import { InMemoryCanonStore } from '../canon/inMemoryStore';
import { emptyProjection, type ProposedEvent, type StateChange, type WorldProjection } from '../canon/model';
import { replayWorldEvents } from '../canon/replay';
import { assertDynamicViewIncident, DynamicViewMetricsError } from './dynamicViewMetrics';
import { PUBLIC_DYNAMIC_FORBIDDEN_FIELDS } from './publicDynamicProjection';
import { REPLAY_FORBIDDEN_FIELDS } from './visualReplay';
import { buildCharacterProjection } from './worldCharacterProjection';
import { characterSourceFromProjection } from './worldCharacterProjectionFunctions';

const WORLD = 'mistwood';
const RUMOR = 'rumor:the-ledger';
const CHARACTERS = ['lin', 'wu', 'hao'] as const;

/** Distinctive enough that a substring search over a payload is a real test and not a guess. */
const SECRET_CONTENT = 'SECRET-RUMOR-吳真在深夜燒了帳本';
const SECRET_PREDICATE = 'burnedTheLedgerAtNight';

const propose = (key: string, participants: readonly string[], changes: StateChange[]): ProposedEvent => ({
  schemaVersion: 1,
  worldId: WORLD,
  idempotencyKey: key,
  proposedBy: { type: 'system' },
  worldDay: 0,
  timeSlot: 'morning',
  eventType: 'rumor',
  participantIds: [...participants],
  causedByEventIds: [],
  stateChanges: changes,
});

/**
 * A world carrying a private rumor with a settled truth status — the maximum-leak case.
 *
 * The claim is established as canonical fact in its own later event, so the chain's
 * `objectiveTruthStatus` is a real `false` rather than the `unknown` most rumors sit at. A
 * boundary test against a rumor the world has said nothing about would pass without ever
 * exercising the field that matters most.
 */
async function worldWithASecretRumor(): Promise<WorldProjection> {
  const store = new InMemoryCanonStore();
  store.setCanonRuleContext({ worldId: WORLD, rules: [], characterIds: [...CHARACTERS] });
  const commit = async (proposal: ProposedEvent): Promise<void> => {
    await commitProposedEvent(store, { proposed: proposal, traceId: `trace:${proposal.idempotencyKey}` });
  };

  await commit(propose('k:origin', ['lin'], [{
    type: 'rumor_originated', rumorId: RUMOR, originCharacterId: 'lin', content: SECRET_CONTENT,
    claimSubjectType: 'character', claimSubjectId: 'wu', claimPredicate: SECRET_PREDICATE,
    claimedValue: true, confidence: 0.9, shareability: 'private',
  }]));
  await commit(propose('k:hop', ['lin', 'hao'], [{
    type: 'rumor_propagated', rumorId: RUMOR, fromCharacterId: 'lin', toCharacterId: 'hao',
    content: SECRET_CONTENT, claimedValue: true, confidence: 0.8,
  }]));
  await commit({
    ...propose('k:truth', [], [{
      type: 'fact_created', subjectType: 'character', subjectId: 'wu',
      predicate: SECRET_PREDICATE, value: false, visibility: 'canon',
    }]),
    eventType: 'discovery',
  });

  return replayWorldEvents(emptyProjection(WORLD), await store.loadAcceptedEvents(WORLD));
}

describe('the projection-sourced public builders never carry a rumor', () => {
  it('the fixture really is the leaky case — a private, held, settled-false rumor', async () => {
    const projection = await worldWithASecretRumor();

    // Without this the whole file could be asserting the absence of something that was never
    // there, which is the shape a boundary test most often rots into.
    expect(projection.rumors[RUMOR].objectiveTruthStatus).toBe('false');
    expect(projection.rumors[RUMOR].shareability).toBe('private');
    expect(projection.rumors[RUMOR].propagationChain).toHaveLength(2);
    expect(JSON.stringify(projection)).toContain(SECRET_CONTENT);
  });

  it('publishes no rumor content, origin, chain, credibility or truth status for any character', async () => {
    const projection = await worldWithASecretRumor();

    for (const characterId of CHARACTERS) {
      const source = characterSourceFromProjection(projection, characterId);
      const payload = JSON.stringify(buildCharacterProjection({ worldId: WORLD, source }));

      expect(payload).not.toContain(SECRET_CONTENT);
      expect(payload).not.toContain(RUMOR);
      expect(payload).not.toContain('rumor');
      expect(payload).not.toContain('credibility');
      expect(payload).not.toContain('objectiveTruthStatus');
    }
  });

  it('builds the character payload from a fixed allowlist, so a new projection field cannot join it', async () => {
    const projection = await worldWithASecretRumor();
    const payload = buildCharacterProjection({
      worldId: WORLD, source: characterSourceFromProjection(projection, 'wu'),
    });

    /**
     * The structural half of the guarantee, and the reason the substring checks above are not
     * the whole story. `buildCharacterProjection` emits exactly these keys whatever it is handed,
     * so the rumor chain's absence is not a filter someone can forget to apply — there is no
     * branch that could ever have included it.
     *
     * This does mean the claim's predicate is absent too: an arbitrary `fact_created` predicate
     * is not published by this builder at all, canon-visible or not.
     */
    expect(Object.keys(payload).sort()).toEqual([
      'active', 'age', 'alive', 'behaviorRules', 'currentLocationId', 'emotionalState', 'fear',
      'financialState', 'healthState', 'id', 'name', 'occupation', 'personality', 'publicGoal',
      'publicProfile', 'schemaVersion', 'values', 'worldId',
    ]);
    expect(JSON.stringify(payload)).not.toContain(SECRET_PREDICATE);
  });
});

describe('the field names are forbidden before anything can emit them', () => {
  const RUMOR_FIELDS = [
    'rumors', 'rumorId', 'rumorChains', 'rumorStance', 'rumorVersionId',
    'propagationChain', 'objectiveTruthStatus', 'credibility', 'knownCorrectionId',
    'originCharacterId',
  ] as const;

  it('names every rumor field on the public dynamic contract', () => {
    for (const field of RUMOR_FIELDS) {
      expect(PUBLIC_DYNAMIC_FORBIDDEN_FIELDS as readonly string[]).toContain(field);
    }
  });

  it('carries them into the visual replay contract, which derives its list from the same one', () => {
    for (const field of RUMOR_FIELDS) {
      expect(REPLAY_FORBIDDEN_FIELDS).toContain(field);
    }
  });

  it('refuses a diagnostic that carries one, at any nesting depth', () => {
    // The list is only worth something where something reads it. `assertDynamicViewIncident` is
    // the AC#5 gate every persisted incident passes through, and it walks nested objects.
    const attempt = (): void => assertDynamicViewIncident({
      worldId: WORLD, code: 'rebuild_failed', occurredAt: 1, detail: { rumorId: RUMOR },
    });

    expect(attempt).toThrow(DynamicViewMetricsError);
    expect(attempt).toThrow(/rumorId/u);
  });

  it('refuses a leaked credibility score the same way', () => {
    expect(() => assertDynamicViewIncident({
      worldId: WORLD, code: 'rebuild_failed', occurredAt: 1, credibility: 0.9,
    })).toThrow(/credibility/u);
  });
});
