/**
 * FR-E005 × FR-E001: rumors live IN the knowledge ledger, and are read under its gate (ART-28).
 *
 * Two guarantees, and they pull in opposite directions, which is why they are tested together:
 *
 *  - there is exactly ONE record of what a character knows. A rumor a character holds is a ledger
 *    record with rumor provenance attached, not a row in a parallel table that would eventually
 *    disagree with the ledger about a character who was told something and then died.
 *  - a character may see only what reached them. The chain knows who started the rumor, who
 *    repeated it and what the world privately makes of it; a listener knows what they were told.
 *
 * Committed rather than hand-folded for the reason `rumorChain.test.ts` gives: a ledger record
 * that Canon would have refused to create is not evidence of anything.
 */

import { commitProposedEvent } from '../canon/commit';
import { InMemoryCanonStore } from '../canon/inMemoryStore';
import { emptyProjection, type ProposedEvent, type StateChange, type WorldProjection } from '../canon/model';
import { replayWorldEvents } from '../canon/replay';
import { rumorHolders } from '../canon/rumorChain';
import { isCanonError } from '../shared/errors';
import { authorizeKnowledgeRead } from './authorization';
import {
  authorizeCharacterRumorList,
  authorizeRumorRead,
  type CharacterRumorView,
  type OperationsRumorView,
} from './rumorAuthorization';

const WORLD = 'mistwood';
const RUMOR = 'rumor:the-ledger';
const CHARACTERS = ['lin', 'wu', 'hao', 'mei'] as const;

const propose = (
  key: string,
  participants: readonly string[],
  changes: StateChange[],
  overrides: Partial<ProposedEvent> = {},
): ProposedEvent => ({
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
  ...overrides,
});

const originate = (overrides: Partial<Extract<StateChange, { type: 'rumor_originated' }>> = {}): StateChange => ({
  type: 'rumor_originated',
  rumorId: RUMOR,
  originCharacterId: 'lin',
  content: '有人說吳真拿走了帳本。',
  claimSubjectType: 'character',
  claimSubjectId: 'wu',
  claimPredicate: 'tookTheLedger',
  claimedValue: true,
  confidence: 0.6,
  shareability: 'trusted',
  ...overrides,
});

const propagate = (from: string, to: string, overrides: Partial<Extract<StateChange, { type: 'rumor_propagated' }>> = {}): StateChange => ({
  type: 'rumor_propagated',
  rumorId: RUMOR,
  fromCharacterId: from,
  toCharacterId: to,
  content: '有人說吳真拿走了帳本。',
  claimedValue: true,
  confidence: 0.5,
  ...overrides,
});

async function world(...proposals: ProposedEvent[]): Promise<WorldProjection> {
  const store = new InMemoryCanonStore();
  store.setCanonRuleContext({ worldId: WORLD, rules: [], characterIds: [...CHARACTERS] });
  for (const proposal of proposals) {
    await commitProposedEvent(store, { proposed: proposal, traceId: `trace:${proposal.idempotencyKey}` });
  }
  return replayWorldEvents(emptyProjection(WORLD), await store.loadAcceptedEvents(WORLD));
}

/** lin starts it, tells wu; wu tells hao a distorted version. mei never hears it. */
const spreadWorld = (): Promise<WorldProjection> => world(
  propose('k:origin', ['lin'], [originate()]),
  propose('k:hop1', ['lin', 'wu'], [propagate('lin', 'wu')]),
  propose('k:hop2', ['wu', 'hao'], [propagate('wu', 'hao', { content: '吳真燒了帳本。', confidence: 0.9 })]),
);

const codeOf = (run: () => unknown): unknown => {
  try {
    run();
    return 'ALLOWED';
  } catch (error) {
    return isCanonError(error) ? error.error.code : error;
  }
};

describe('one system: a rumor a character holds is a ledger record', () => {
  it('writes rumor holdings into characterKnowledge, with the chain link on the record', async () => {
    const projection = await spreadWorld();
    const [record] = projection.characterKnowledge.hao;

    expect(record).toMatchObject({
      characterId: 'hao',
      rumorId: RUMOR,
      rumorStance: 'believes',
      confidence: 0.9,
      // Names the claim without conceding it. A real fact id here would assert the fact exists.
      factId: `rumor:${RUMOR}`,
      beliefValue: true,
    });
    expect(record.rumorVersionId).toBe(projection.rumors[RUMOR].currentVersionId);
  });

  it('derives the holder set from the ledger, so there is nothing to disagree with', async () => {
    const projection = await spreadWorld();

    // `rumorHolders` reads `characterKnowledge` and nothing else. If a second store existed, this
    // assertion could pass while that store said something different.
    expect(rumorHolders(projection.characterKnowledge, RUMOR).map((h) => h.characterId))
      .toEqual(['hao', 'lin', 'wu']);
    expect(projection.characterKnowledge.mei).toBeUndefined();
  });

  it('keeps source provenance: an origin is inferred, a telling is told', async () => {
    const projection = await world(
      propose('k:origin', ['lin'], [originate({ sourceType: 'observed' })]),
      propose('k:hop1', ['lin', 'wu'], [propagate('lin', 'wu')]),
    );

    expect(projection.characterKnowledge.lin[0].sourceType).toBe('observed');
    // Pinned by the reducer, not taken from the proposal: hearsay cannot claim to be first-hand.
    expect(projection.characterKnowledge.wu[0].sourceType).toBe('told');
  });

  it('supersedes a holder\'s previous record through the ledger\'s own correction link', async () => {
    const projection = await world(
      propose('k:origin', ['lin'], [originate()]),
      propose('k:hop1', ['lin', 'wu'], [propagate('lin', 'wu')]),
      propose('k:doubt', ['wu'], [{
        type: 'rumor_belief_changed', rumorId: RUMOR, characterId: 'wu', stance: 'doubts', confidence: 0.2,
      }]),
    );
    const records = projection.characterKnowledge.wu;

    expect(records).toHaveLength(2);
    // The first record still says what wu believed before, and points forward at what replaced
    // it. "Believed it until slot 3" survives.
    expect(records[0]).toMatchObject({ rumorStance: 'believes', confidence: 0.5 });
    expect(records[0].correctedByKnowledgeId).toBe(records[1].knowledgeId);
    expect(records[1]).toMatchObject({ rumorStance: 'doubts', correctsKnowledgeId: records[0].knowledgeId });
  });

  it('records the truth status the world could have given AT THE TIME, not later', async () => {
    const projection = await world(
      propose('k:origin', ['lin'], [originate()]),
      // Canon settles the claim only after lin already believed it.
      propose('k:truth', [], [{
        type: 'fact_created', subjectType: 'character', subjectId: 'wu',
        predicate: 'tookTheLedger', value: false, visibility: 'canon',
      }], { eventType: 'discovery' }),
      propose('k:hop1', ['lin', 'wu'], [propagate('lin', 'wu')]),
    );

    // lin learned it while the town knew nothing; wu learned it after the record settled. A
    // misconception is exactly this shape, and flattening both to the current answer would erase it.
    expect(projection.characterKnowledge.lin[0].truthStatus).toBe('unknown');
    expect(projection.characterKnowledge.wu[0].truthStatus).toBe('false');
  });

  it('leaves the existing ledger gate in force over rumor records', async () => {
    const projection = await spreadWorld();

    expect(codeOf(() => authorizeKnowledgeRead(projection.characterKnowledge, 'hao', {
      type: 'character', characterId: 'lin',
    }))).toBe('KNOWLEDGE_ACCESS_DENIED');
  });
});

describe('a character sees only what reached them', () => {
  it('gives a holder their own version, stance and personal hops', async () => {
    const projection = await spreadWorld();
    const view = authorizeRumorRead(projection, RUMOR, { type: 'character', characterId: 'wu' }) as CharacterRumorView;

    expect(view.version.content).toBe('有人說吳真拿走了帳本。');
    expect(view.stance).toBe('believes');
    expect(view.sourceType).toBe('told');
    expect(view.personalChain.map((hop) => [hop.fromCharacterId, hop.toCharacterId]))
      .toEqual([['lin', 'wu'], ['wu', 'hao']]);
  });

  it('withholds the origin, the whole chain, the credibility and the world\'s verdict', async () => {
    const projection = await spreadWorld();
    const view = authorizeRumorRead(projection, RUMOR, { type: 'character', characterId: 'hao' });

    // Hearing a rumor tells you who told YOU. Everything else on the chain is the world's.
    expect(Object.keys(view).sort()).toEqual([
      'confidence', 'personalChain', 'rumorId', 'sourceType', 'stance', 'version',
    ]);
    expect(JSON.stringify(view)).not.toContain('lin');
  });

  it('refuses a character who was never told, with the same refusal as an unauthorized read', async () => {
    const projection = await spreadWorld();

    // Deliberately indistinguishable from "not yours": a separate "exists but not yours" would
    // let a character enumerate the world's rumors by guessing ids.
    expect(codeOf(() => authorizeRumorRead(projection, RUMOR, { type: 'character', characterId: 'mei' })))
      .toBe('KNOWLEDGE_ACCESS_DENIED');
  });

  it('refuses a character listing somebody else\'s rumors', async () => {
    const projection = await spreadWorld();

    expect(codeOf(() => authorizeCharacterRumorList(projection, 'wu', { type: 'character', characterId: 'hao' })))
      .toBe('KNOWLEDGE_ACCESS_DENIED');
  });

  it('lists a character\'s own rumors through the same gate, in a stable order', async () => {
    const projection = await spreadWorld();
    const views = authorizeCharacterRumorList(projection, 'hao', { type: 'character', characterId: 'hao' });

    expect(views.map((view) => view.rumorId)).toEqual([RUMOR]);
    expect(views[0].version.content).toBe('吳真燒了帳本。');
  });
});

describe('operations sees what the world knows', () => {
  it('returns the whole chain and every current holding', async () => {
    const projection = await spreadWorld();
    const view = authorizeRumorRead(projection, RUMOR, { type: 'operations', operatorId: 'op' }) as OperationsRumorView;

    expect(view.chain.originCharacterId).toBe('lin');
    expect(view.chain.propagationChain).toHaveLength(3);
    expect(view.chain.versions).toHaveLength(2);
    expect(view.holdings.map((holding) => holding.characterId)).toEqual(['hao', 'lin', 'wu']);
  });

  it('hands back a copy, so a caller cannot edit accepted history through the read', async () => {
    const projection = await spreadWorld();
    const view = authorizeRumorRead(projection, RUMOR, { type: 'operations', operatorId: 'op' }) as OperationsRumorView;

    view.chain.versions[0].content = 'tampered';
    view.chain.propagationChain.push({ ...view.chain.propagationChain[0], hopIndex: 99 });

    expect(projection.rumors[RUMOR].versions[0].content).toBe('有人說吳真拿走了帳本。');
    expect(projection.rumors[RUMOR].propagationChain).toHaveLength(3);
  });

  it('reports a rumor that does not exist as missing rather than denied', async () => {
    const projection = await spreadWorld();

    expect(codeOf(() => authorizeRumorRead(projection, 'rumor:nothing', { type: 'operations', operatorId: 'op' })))
      .toBe('RUMOR_NOT_FOUND');
  });
});
