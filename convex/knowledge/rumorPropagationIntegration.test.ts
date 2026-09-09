/**
 * ART-76 — PRD §19.2 case 2: 謠言經多人傳播.
 *
 * ## What this adds over the suites that already exist
 *
 * `canon/rumorChain.test.ts` (ART-28) settles the RULES, one at a time, and settles them well: a
 * hop from someone the chain never reached is refused, a distortion becomes a new version, a
 * doubter is not dragged onto the current version. `knowledge/rumorLedger.test.ts` settles the
 * ledger. `publicRead/rumorPublicBoundary.test.ts` settles the public boundary.
 *
 * What none of them does — and what §19.2 asks for — is drive ONE rumor through FOUR people in a
 * single continuous world and then ask the four questions the case is actually about, of the same
 * accepted log:
 *
 *   1. **Provenance.** Can every hop be traced to the accepted event that produced it?
 *   2. **Versions.** Do two holders who were told different things hold different versions?
 *   3. **Belief divergence.** Do two holders of the SAME version hold different stances?
 *   4. **Containment.** Is each of those answers readable only by the character it belongs to?
 *
 * Asked separately, each can be true of a different world. Asked of one log, they are a statement
 * about the system. This suite is that statement.
 *
 * Everything below goes through `commitProposedEvent`, so structural validation, Canon validation,
 * idempotency and the append-only store are all in the loop; nothing here folds a hand-built
 * `AcceptedEvent` into a projection. Only the store is swapped for its in-memory reference
 * implementation.
 *
 * It lives under `convex/knowledge/` because that is the one module
 * `architecture/module-boundaries.json` lets depend on both `canon` and `shared`, which is the same
 * reason `canonCognitionIntegration.test.ts` (§19.2 cases 1, 3 and 4) lives here.
 */

import { commitProposedEvent } from '../canon/commit';
import { InMemoryCanonStore } from '../canon/inMemoryStore';
import {
  emptyProjection,
  type ProposedEvent,
  type StateChange,
  type WorldProjection,
} from '../canon/model';
import { replayWorldEvents } from '../canon/replay';
import { buildSnapshot, replayFromSnapshot } from '../canon/snapshots';
import { isCanonError } from '../shared/errors';
import { authorizeCharacterRumorList, authorizeRumorRead } from './rumorAuthorization';

const WORLD = 'mistwood';
const RUMOR = 'rumor:the-ledger';
/** Four people, so「多人」 is more than the two a single hop needs. */
const CHARACTERS = ['lin', 'wu', 'hao', 'mei'] as const;

const ORIGINAL = '有人說吳真拿走了帳本。';
const DISTORTED = '有人說吳真拿走了帳本,而且燒了它。';

type Proposal = {
  key: string;
  participants: readonly string[];
  changes: StateChange[];
  worldDay?: number;
};

const propose = ({ key, participants, changes, worldDay }: Proposal): ProposedEvent => ({
  schemaVersion: 1,
  worldId: WORLD,
  idempotencyKey: key,
  proposedBy: { type: 'system' },
  worldDay: worldDay ?? 0,
  timeSlot: 'morning',
  eventType: 'rumor',
  participantIds: [...participants],
  causedByEventIds: [],
  stateChanges: changes,
});

function newStore(): InMemoryCanonStore {
  const store = new InMemoryCanonStore();
  store.setCanonRuleContext({ worldId: WORLD, rules: [], characterIds: [...CHARACTERS] });
  return store;
}

async function commit(store: InMemoryCanonStore, proposal: ProposedEvent): Promise<WorldProjection> {
  await commitProposedEvent(store, { proposed: proposal, traceId: `trace:${proposal.idempotencyKey}` });
  return replayWorldEvents(emptyProjection(WORLD), await store.loadAcceptedEvents(WORLD));
}

/**
 * One rumor, four people, five events — the world every case below asks its question of.
 *
 * lin starts it and tells wu; wu passes the original on to hao; hao DISTORTS it and tells mei,
 * which is what makes two versions exist at once; mei then doubts what she was told, which is what
 * makes two beliefs exist of one version. That shape is deliberate: version divergence and belief
 * divergence are different things, and a world that only ever produced one of them could not tell
 * a test that conflated them apart.
 */
async function fourPersonChain(): Promise<{ store: InMemoryCanonStore; projection: WorldProjection }> {
  const store = newStore();
  await commit(store, propose({
    key: 'k:origin', participants: ['lin'],
    changes: [{
      type: 'rumor_originated', rumorId: RUMOR, originCharacterId: 'lin', content: ORIGINAL,
      claimSubjectType: 'character', claimSubjectId: 'wu', claimPredicate: 'tookTheLedger',
      claimedValue: true, confidence: 0.6, shareability: 'trusted',
    }],
  }));
  await commit(store, propose({
    key: 'k:hop:lin-wu', participants: ['lin', 'wu'], worldDay: 1,
    changes: [{
      type: 'rumor_propagated', rumorId: RUMOR,
      fromCharacterId: 'lin', toCharacterId: 'wu', content: ORIGINAL, claimedValue: true, confidence: 0.5,
    }],
  }));
  await commit(store, propose({
    key: 'k:hop:wu-hao', participants: ['wu', 'hao'], worldDay: 1,
    changes: [{
      type: 'rumor_propagated', rumorId: RUMOR,
      fromCharacterId: 'wu', toCharacterId: 'hao', content: ORIGINAL, claimedValue: true, confidence: 0.5,
    }],
  }));
  await commit(store, propose({
    key: 'k:hop:hao-mei', participants: ['hao', 'mei'], worldDay: 2,
    changes: [{
      type: 'rumor_propagated', rumorId: RUMOR,
      fromCharacterId: 'hao', toCharacterId: 'mei', content: DISTORTED, claimedValue: true, confidence: 0.7,
    }],
  }));
  const projection = await commit(store, propose({
    key: 'k:belief:mei-doubts', participants: ['mei'], worldDay: 2,
    changes: [{
      type: 'rumor_belief_changed', rumorId: RUMOR, characterId: 'mei',
      stance: 'doubts', confidence: 0.2,
    }],
  }));
  return { store, projection };
}

describe('§19.2 case 2 — a rumor travels through four people (ART-76)', () => {
  it('reaches everyone it was told to, and nobody it was not', async () => {
    const { projection } = await fourPersonChain();
    const holders = (['lin', 'wu', 'hao', 'mei'] as const).filter((characterId) =>
      (projection.characterKnowledge?.[characterId] ?? []).some((record) => record.rumorId === RUMOR));
    expect(holders).toEqual(['lin', 'wu', 'hao', 'mei']);

    // Four entries for three tellings: the ORIGIN is hop 0, with a null `fromCharacterId`. That
    // is the chain modelling "lin came to hold it" as a step rather than as a precondition, which
    // is what lets the origin carry the same provenance every later hop does.
    const chain = projection.rumors?.[RUMOR];
    expect(chain).toBeDefined();
    expect(chain?.propagationChain).toHaveLength(4);
    expect(chain?.propagationChain[0]).toMatchObject({ hopIndex: 0, fromCharacterId: null, toCharacterId: 'lin' });
  });

  it('traces every hop to the accepted event that produced it (provenance)', async () => {
    const { store, projection } = await fourPersonChain();
    const accepted = await store.loadAcceptedEvents(WORLD);
    const acceptedIds = new Set(accepted.map((event) => event.eventId));

    const hops = projection.rumors?.[RUMOR].propagationChain ?? [];
    expect(hops).toHaveLength(4);
    for (const hop of hops) {
      // Not merely present — the id has to be one Canon actually accepted. A hop citing an event
      // that is not in the log would be provenance in name only.
      expect(acceptedIds.has(hop.sourceEventId)).toBe(true);
    }
    expect(hops.map((hop) => `${hop.fromCharacterId}->${hop.toCharacterId}`))
      .toEqual(['null->lin', 'lin->wu', 'wu->hao', 'hao->mei']);
    // Sequence numbers are strictly increasing, so the chain records the order it happened in
    // rather than the order the projection happened to fold it.
    expect(hops.map((hop) => hop.sequenceNumber)).toEqual([...hops.map((hop) => hop.sequenceNumber)].sort((a, b) => a - b));
  });

  it('keeps two versions alive at once, each with the wording its holders were told', async () => {
    const { projection } = await fourPersonChain();
    const chain = projection.rumors?.[RUMOR];
    const contents = (chain?.versions ?? []).map((version) => version.content);
    expect(contents).toContain(ORIGINAL);
    expect(contents).toContain(DISTORTED);

    const operations = authorizeRumorRead(projection, RUMOR, { type: 'operations', operatorId: 'ops-test' });
    const versionOf = (characterId: string) => ('holdings' in operations
      ? operations.holdings.find((holding) => holding.characterId === characterId)?.versionId
      : undefined);
    // wu was told the original and hao distorted it, so the two are not on the same version —
    // and mei, who heard hao, is on hao's.
    expect(versionOf('wu')).not.toBe(versionOf('mei'));
    expect(versionOf('hao')).toBe(versionOf('wu'));
  });

  it('lets two holders of the same rumor believe different things (belief divergence)', async () => {
    const { projection } = await fourPersonChain();
    const wu = authorizeRumorRead(projection, RUMOR, { type: 'character', characterId: 'wu' });
    const mei = authorizeRumorRead(projection, RUMOR, { type: 'character', characterId: 'mei' });
    if ('holdings' in wu || 'holdings' in mei) throw new Error('expected character views');

    expect(wu.stance).not.toBe(mei.stance);
    expect(mei.stance).toBe('doubts');
    expect(mei.confidence).toBeLessThan(wu.confidence);
    // Doubting does not remove the rumor from her: she still holds the version she was told.
    expect(mei.version.content).toBe(DISTORTED);
  });

  it('shows each character only their own half of the chain', async () => {
    const { projection } = await fourPersonChain();
    const wu = authorizeRumorRead(projection, RUMOR, { type: 'character', characterId: 'wu' });
    if ('holdings' in wu) throw new Error('expected a character view');
    // wu was told by lin and told hao; the hop between hao and mei is not wu's to see.
    expect(wu.personalChain.map((hop) => `${hop.fromCharacterId}->${hop.toCharacterId}`))
      .toEqual(['lin->wu', 'wu->hao']);
  });

  it('refuses the rumor to a character it never reached, without confirming it exists', async () => {
    const store = newStore();
    await commit(store, propose({
      key: 'k:origin', participants: ['lin'],
      changes: [{
        type: 'rumor_originated', rumorId: RUMOR, originCharacterId: 'lin', content: ORIGINAL,
        claimSubjectType: 'character', claimSubjectId: 'wu', claimPredicate: 'tookTheLedger',
        claimedValue: true, confidence: 0.6, shareability: 'trusted',
      }],
    }));
    const projection = replayWorldEvents(emptyProjection(WORLD), await store.loadAcceptedEvents(WORLD));

    const refusal = (() => {
      try {
        authorizeRumorRead(projection, RUMOR, { type: 'character', characterId: 'mei' });
        return 'ALLOWED';
      } catch (error) {
        return isCanonError(error) ? error.error.code : error;
      }
    })();
    // The SAME code as "not yours", so a character cannot enumerate the world's rumors by
    // guessing ids and reading which refusal comes back.
    expect(refusal).toBe('KNOWLEDGE_ACCESS_DENIED');
  });

  it('refuses one character listing another\'s rumors', async () => {
    const { projection } = await fourPersonChain();
    const refusal = (() => {
      try {
        authorizeCharacterRumorList(projection, 'mei', { type: 'character', characterId: 'wu' });
        return 'ALLOWED';
      } catch (error) {
        return isCanonError(error) ? error.error.code : error;
      }
    })();
    expect(refusal).toBe('KNOWLEDGE_ACCESS_DENIED');
    // Operations may, which is what makes the refusal above a rule about the requester rather
    // than an absence of data.
    expect(authorizeCharacterRumorList(projection, 'mei', { type: 'operations', operatorId: 'ops-test' })).toHaveLength(1);
  });

  it('never turns any of it into a Canon fact, however many people believe it', async () => {
    const { projection } = await fourPersonChain();
    const facts = Object.values(projection.facts ?? {});
    expect(facts.some((fact) => fact.predicate === 'tookTheLedger')).toBe(false);
  });

  it('rebuilds identically from the log and from a snapshot, so the chain is replayable', async () => {
    const { store, projection } = await fourPersonChain();
    const accepted = await store.loadAcceptedEvents(WORLD);

    const fromLog = replayWorldEvents(emptyProjection(WORLD), accepted);
    expect(fromLog).toEqual(projection);

    const snapshot = buildSnapshot(
      replayWorldEvents(emptyProjection(WORLD), accepted.slice(0, 3)), 1_000, 1);
    const fromSnapshot = replayFromSnapshot(snapshot, accepted.slice(3));
    // Same world, two routes to it. A chain that only reconstructs by replaying from zero is not
    // replayable in the sense §19.2 means.
    expect(fromSnapshot.rumors).toEqual(projection.rumors);
    expect(fromSnapshot.characterKnowledge).toEqual(projection.characterKnowledge);
  });

  it('is unchanged when the same hop is delivered twice', async () => {
    const { store, projection } = await fourPersonChain();
    const before = (await store.loadAcceptedEvents(WORLD)).length;

    const again = await commit(store, propose({
      key: 'k:hop:hao-mei', participants: ['hao', 'mei'], worldDay: 2,
      changes: [{
        type: 'rumor_propagated', rumorId: RUMOR,
        fromCharacterId: 'hao', toCharacterId: 'mei', content: DISTORTED, claimedValue: true, confidence: 0.7,
      }],
    }));

    expect((await store.loadAcceptedEvents(WORLD)).length).toBe(before);
    // Not merely "no new event": the chain a viewer or a character would read is byte-identical,
    // which is the property a retried slot depends on.
    expect(again.rumors).toEqual(projection.rumors);
  });
});
