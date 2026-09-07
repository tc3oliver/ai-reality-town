/**
 * FR-E005 versioned rumor propagation chains (ART-28).
 *
 * Everything here goes through {@link commitProposedEvent} rather than calling the reducer
 * directly, and that is the point of the file rather than an incidental style. AC#3 says rumor
 * propagation must be represented by an Event; a suite that folded hand-built `AcceptedEvent`s
 * into a projection would pass just as happily if Canon validation rejected every one of them in
 * production. Committing means the structural validator, the canon rules, idempotency and the
 * append-only store are all in the loop, and a rumor that reaches the projection here is one the
 * real pipeline would have accepted.
 */

import { commitProposedEvent } from './commit';
import { InMemoryCanonStore } from './inMemoryStore';
import { emptyProjection, type AcceptedEvent, type ProposedEvent, type StateChange, type WorldProjection } from './model';
import { reduceWorldEvent } from './reducer';
import { replayWorldEvents } from './replay';
import { validateCanon } from './validators';
import { buildSnapshot, replayFromSnapshot } from './snapshots';
import { deriveCredibility, holdsRumor, rumorHolders } from './rumorChain';
import { isCanonError } from '../shared/errors';

const WORLD = 'mistwood';
const RUMOR = 'rumor:the-ledger';

/** Everyone who appears below, so `knownCharacters` is real rather than absent-and-inert. */
const CHARACTERS = ['lin', 'wu', 'hao', 'mei'] as const;

type Proposal = {
  key: string;
  participants: readonly string[];
  changes: StateChange[];
  eventType?: ProposedEvent['eventType'];
  proposedBy?: ProposedEvent['proposedBy'];
  worldDay?: number;
};

const propose = ({ key, participants, changes, eventType, proposedBy, worldDay }: Proposal): ProposedEvent => ({
  schemaVersion: 1,
  worldId: WORLD,
  idempotencyKey: key,
  proposedBy: proposedBy ?? { type: 'system' },
  worldDay: worldDay ?? 0,
  timeSlot: 'morning',
  eventType: eventType ?? 'rumor',
  participantIds: [...participants],
  causedByEventIds: [],
  stateChanges: changes,
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

const propagate = (
  fromCharacterId: string,
  toCharacterId: string,
  overrides: Partial<Extract<StateChange, { type: 'rumor_propagated' }>> = {},
): StateChange => ({
  type: 'rumor_propagated',
  rumorId: RUMOR,
  fromCharacterId,
  toCharacterId,
  content: '有人說吳真拿走了帳本。',
  claimedValue: true,
  confidence: 0.5,
  ...overrides,
});

function newStore(): InMemoryCanonStore {
  const store = new InMemoryCanonStore();
  store.setCanonRuleContext({ worldId: WORLD, rules: [], characterIds: [...CHARACTERS] });
  return store;
}

/** Commit and return the projection replayed from everything accepted so far. */
async function commit(store: InMemoryCanonStore, proposal: ProposedEvent): Promise<WorldProjection> {
  await commitProposedEvent(store, { proposed: proposal, traceId: `trace:${proposal.idempotencyKey}` });
  return replayWorldEvents(emptyProjection(WORLD), await store.loadAcceptedEvents(WORLD));
}

/** The canon error code a refused proposal carries, or the thrown value if it was not one. */
async function refusal(store: InMemoryCanonStore, proposal: ProposedEvent): Promise<unknown> {
  try {
    await commitProposedEvent(store, { proposed: proposal, traceId: `trace:${proposal.idempotencyKey}` });
    return 'ACCEPTED';
  } catch (error) {
    return isCanonError(error) ? error.error.code : error;
  }
}

/** A world where lin has started the rumor and told wu, who told hao. Three holders, one version. */
async function threeHopWorld(): Promise<{ store: InMemoryCanonStore; projection: WorldProjection }> {
  const store = newStore();
  await commit(store, propose({ key: 'k:origin', participants: ['lin'], changes: [originate()] }));
  await commit(store, propose({ key: 'k:hop1', participants: ['lin', 'wu'], changes: [propagate('lin', 'wu')] }));
  const projection = await commit(store, propose({
    key: 'k:hop2', participants: ['wu', 'hao'], changes: [propagate('wu', 'hao')],
  }));
  return { store, projection };
}

describe('AC#3 — rumor propagation is represented by an Event', () => {
  it('records origin, chain, current version, credibility, truth and correction from committed events alone', async () => {
    const { projection } = await threeHopWorld();
    const chain = projection.rumors[RUMOR];

    expect(chain.originCharacterId).toBe('lin');
    expect(chain.propagationChain.map((hop) => [hop.fromCharacterId, hop.toCharacterId])).toEqual([
      [null, 'lin'], ['lin', 'wu'], ['wu', 'hao'],
    ]);
    expect(chain.versions).toHaveLength(1);
    expect(chain.currentVersionId).toBe(chain.versions[0].versionId);
    expect(chain.objectiveTruthStatus).toBe('unknown');
    expect(chain.knownCorrectionId).toBeNull();
    // Three holders at 0.6/0.5/0.5, all believing: (0.6 + 0.5 + 0.5) / 3.
    expect(chain.credibility).toBeCloseTo(0.533333, 5);
  });

  it('every hop cites the accepted event and sequence number that produced it', async () => {
    const { store, projection } = await threeHopWorld();
    const events = await store.loadAcceptedEvents(WORLD);
    const eventIds = new Set(events.map((event) => event.eventId));

    for (const hop of projection.rumors[RUMOR].propagationChain) {
      expect(eventIds.has(hop.sourceEventId)).toBe(true);
      expect(events[hop.sequenceNumber].eventId).toBe(hop.sourceEventId);
    }
  });

  it('a narrative rumors[] note is not a rumor: nothing but a rumor_* change creates a chain', async () => {
    const store = newStore();
    // The scene author's `rumors` collection carries {sourceCharacterId, content,
    // proposedEventIndex} and is attached to an event that changes something else. Committing
    // that event must leave the rumor projection empty, or the note and the record are the same
    // thing and AC#3 means nothing.
    const projection = await commit(store, propose({
      key: 'k:narrative', participants: ['lin'], eventType: 'conversation',
      changes: [{
        type: 'character_memory_formed', characterId: 'lin', content: '鎮上在傳帳本的事。',
        interpretation: '她覺得有人在放話。', importance: 0.4, emotionalWeight: -0.2,
        confidence: 0.5, visibility: 'private',
      }],
    }));

    expect(projection.rumors).toEqual({});
    expect(holdsRumor(projection.characterKnowledge, 'lin', RUMOR)).toBe(false);
  });
});

describe('AC#3 — a character may only pass on a rumor that reached them', () => {
  it('refuses a hop from someone the chain never reached', async () => {
    const { store } = await threeHopWorld();
    // `mei` has never been told. Accepting this would record a hop whose provenance never
    // happened, and every later reader would see a chain that says otherwise.
    expect(await refusal(store, propose({
      key: 'k:forged', participants: ['mei', 'lin'], changes: [propagate('mei', 'lin')],
    }))).toBe('RUMOR_SOURCE_NOT_HELD');
  });

  /**
   * Found by fault injection: removing the VALIDATOR's holders check alone left every test above
   * green, because the reducer refuses the same hop with the same code. Two enforcement points is
   * the right design — a projection built by replay must not depend on validation having run —
   * but it also meant a single suite could not tell which of them was doing the work, and either
   * could have been deleted unnoticed. These two pin them separately.
   */
  it('is refused by canon validation on its own, before any reduction', async () => {
    const { store } = await threeHopWorld();
    const projection = replayWorldEvents(emptyProjection(WORLD), await store.loadAcceptedEvents(WORLD));

    expect(validateCanon(
      propose({ key: 'k:forged', participants: ['mei', 'lin'], changes: [propagate('mei', 'lin')] }),
      projection,
      { worldId: WORLD, rules: [], characterIds: [...CHARACTERS] },
    )?.code).toBe('RUMOR_SOURCE_NOT_HELD');
  });

  it('is refused by the reducer on its own, so replay cannot manufacture a holder', async () => {
    const { store } = await threeHopWorld();
    const events = await store.loadAcceptedEvents(WORLD);
    const projection = replayWorldEvents(emptyProjection(WORLD), events);
    // Bypasses validation entirely, which is what a replay of a log written by an older, laxer
    // ruleset would do.
    const forged: AcceptedEvent = {
      ...events[events.length - 1],
      eventId: `${WORLD}#forged`,
      idempotencyKey: 'k:forged',
      sequenceNumber: events.length,
      participantIds: ['mei', 'lin'],
      stateChanges: [propagate('mei', 'lin')],
    };

    expect(() => reduceWorldEvent(projection, forged)).toThrow(/RUMOR_SOURCE_NOT_HELD/u);
  });

  it('refuses a belief change from someone who holds no version', async () => {
    const { store } = await threeHopWorld();
    expect(await refusal(store, propose({
      key: 'k:opinion', participants: ['mei'],
      changes: [{ type: 'rumor_belief_changed', rumorId: RUMOR, characterId: 'mei', stance: 'rejects', confidence: 0.9 }],
    }))).toBe('RUMOR_SOURCE_NOT_HELD');
  });

  it('refuses a correction from someone who never heard the rumor', async () => {
    const { store } = await threeHopWorld();
    expect(await refusal(store, propose({
      key: 'k:uninformed-correction', participants: ['mei'],
      changes: [{
        type: 'rumor_corrected', rumorId: RUMOR, correctingCharacterId: 'mei',
        correctedContent: '帳本一直在櫃子裡。', correctedValue: false, reason: '她自己看過。',
      }],
    }))).toBe('RUMOR_SOURCE_NOT_HELD');
  });

  it('refuses a hop, belief or correction naming a rumor that does not exist', async () => {
    const store = newStore();
    expect(await refusal(store, propose({
      key: 'k:ghost', participants: ['lin', 'wu'],
      changes: [propagate('lin', 'wu', { rumorId: 'rumor:never-started' })],
    }))).toBe('RUMOR_NOT_FOUND');
  });

  it('allows a rumor to start and travel two hops inside one scene', async () => {
    const store = newStore();
    // The prospective rule: hop two is judged against the world the earlier changes in this same
    // event produce. Judging it against the pre-event projection would reject the second hop of
    // every chain that starts and spreads in one conversation, which is most of them.
    const projection = await commit(store, propose({
      key: 'k:one-scene', participants: ['lin', 'wu', 'hao'],
      changes: [originate(), propagate('lin', 'wu'), propagate('wu', 'hao')],
    }));

    expect(projection.rumors[RUMOR].propagationChain).toHaveLength(3);
    expect(rumorHolders(projection.characterKnowledge, RUMOR).map((h) => h.characterId))
      .toEqual(['hao', 'lin', 'wu']);
  });

  it('refuses a character telling themselves', async () => {
    const store = newStore();
    await commit(store, propose({ key: 'k:origin', participants: ['lin'], changes: [originate()] }));
    expect(await refusal(store, propose({
      key: 'k:self', participants: ['lin', 'wu'], changes: [propagate('lin', 'lin')],
    }))).toBe('INVALID_RUMOR_CHANGE');
  });

  it('refuses a second origin for the same rumor id', async () => {
    const store = newStore();
    await commit(store, propose({ key: 'k:origin', participants: ['lin'], changes: [originate()] }));
    // Re-originating would replace the chain and take its whole history with it.
    expect(await refusal(store, propose({
      key: 'k:reorigin', participants: ['mei'], changes: [originate({ originCharacterId: 'mei' })],
    }))).toBe('RUMOR_ALREADY_EXISTS');
  });

  it('refuses an origin claiming it was told to its own originator', async () => {
    const store = newStore();
    expect(await refusal(store, propose({
      key: 'k:told-origin', participants: ['lin'], changes: [originate({ sourceType: 'told' as never })],
    }))).toBe('INVALID_EVENT_SHAPE');
  });
});

describe('AC#2 — different characters may hold different versions and different beliefs', () => {
  it('records a distortion as a new version whose parent keeps its original wording', async () => {
    const { store } = await threeHopWorld();
    const projection = await commit(store, propose({
      key: 'k:distort', participants: ['hao', 'mei'],
      changes: [propagate('hao', 'mei', { content: '吳真拿走帳本還燒了它。', confidence: 0.8 })],
    }));
    const chain = projection.rumors[RUMOR];

    expect(chain.versions).toHaveLength(2);
    expect(chain.versions[0].content).toBe('有人說吳真拿走了帳本。');
    expect(chain.versions[1]).toMatchObject({
      content: '吳真拿走帳本還燒了它。',
      authoredByCharacterId: 'hao',
      derivedFromVersionId: chain.versions[0].versionId,
    });
    expect(chain.currentVersionId).toBe(chain.versions[1].versionId);
  });

  it('leaves earlier holders on the version they were actually told', async () => {
    const { store } = await threeHopWorld();
    const projection = await commit(store, propose({
      key: 'k:distort', participants: ['hao', 'mei'],
      changes: [propagate('hao', 'mei', { content: '吳真拿走帳本還燒了它。', confidence: 0.8 })],
    }));
    const chain = projection.rumors[RUMOR];
    const byCharacter = Object.fromEntries(
      rumorHolders(projection.characterKnowledge, RUMOR).map((holding) => [holding.characterId, holding.versionId]),
    );

    // The whole of AC#2 in four lines: mei heard the distorted wording, and nothing propagated
    // it back up the chain to the three people who heard the original.
    expect(byCharacter.mei).toBe(chain.versions[1].versionId);
    expect(byCharacter.lin).toBe(chain.versions[0].versionId);
    expect(byCharacter.wu).toBe(chain.versions[0].versionId);
    expect(byCharacter.hao).toBe(chain.versions[0].versionId);
  });

  it('keeps stance and confidence per character', async () => {
    const { store } = await threeHopWorld();
    const projection = await commit(store, propose({
      key: 'k:doubt', participants: ['wu', 'hao'],
      changes: [
        { type: 'rumor_belief_changed', rumorId: RUMOR, characterId: 'wu', stance: 'rejects', confidence: 0.95 },
        { type: 'rumor_belief_changed', rumorId: RUMOR, characterId: 'hao', stance: 'doubts', confidence: 0.3 },
      ],
    }));
    const byCharacter = Object.fromEntries(
      rumorHolders(projection.characterKnowledge, RUMOR).map((h) => [h.characterId, { stance: h.stance, confidence: h.confidence }]),
    );

    expect(byCharacter).toEqual({
      lin: { stance: 'believes', confidence: 0.6 },
      wu: { stance: 'rejects', confidence: 0.95 },
      hao: { stance: 'doubts', confidence: 0.3 },
    });
  });

  it('does not move a doubter onto the current version when they change their mind', async () => {
    const { store } = await threeHopWorld();
    await commit(store, propose({
      key: 'k:distort', participants: ['hao', 'mei'],
      changes: [propagate('hao', 'mei', { content: '吳真拿走帳本還燒了它。', confidence: 0.8 })],
    }));
    const projection = await commit(store, propose({
      key: 'k:wu-doubts', participants: ['wu'],
      changes: [{ type: 'rumor_belief_changed', rumorId: RUMOR, characterId: 'wu', stance: 'doubts', confidence: 0.2 }],
    }));
    const chain = projection.rumors[RUMOR];

    // Changing your mind does not change what you were told. Re-pointing wu at
    // `currentVersionId` here is exactly the merge AC#2 forbids.
    const wu = rumorHolders(projection.characterKnowledge, RUMOR).find((h) => h.characterId === 'wu');
    expect(wu?.versionId).toBe(chain.versions[0].versionId);
    expect(chain.currentVersionId).toBe(chain.versions[1].versionId);
  });

  it('re-telling someone who already doubts does not restore their belief', async () => {
    const { store } = await threeHopWorld();
    await commit(store, propose({
      key: 'k:hao-doubts', participants: ['hao'],
      changes: [{ type: 'rumor_belief_changed', rumorId: RUMOR, characterId: 'hao', stance: 'doubts', confidence: 0.2 }],
    }));
    const projection = await commit(store, propose({
      key: 'k:retell', participants: ['lin', 'hao'], changes: [propagate('lin', 'hao', { confidence: 0.9 })],
    }));

    const hao = rumorHolders(projection.characterKnowledge, RUMOR).find((h) => h.characterId === 'hao');
    expect(hao).toMatchObject({ stance: 'doubts', confidence: 0.9 });
  });
});

describe('AC#1 — a rumor never becomes a Canon fact', () => {
  it('produces no projected fact, however many characters believe it', async () => {
    const { projection } = await threeHopWorld();

    expect(projection.facts).toEqual([]);
    expect(projection.worldEnvironment).toEqual({});
  });

  it('refuses an event that both spreads a rumor and establishes its claim as fact', async () => {
    const store = newStore();
    // The laundering shape: propose the rumor and, in the same breath, a fact_created for the
    // very subject and predicate it claims.
    expect(await refusal(store, propose({
      key: 'k:launder', participants: ['lin'], eventType: 'discovery',
      changes: [originate(), {
        type: 'fact_created', subjectType: 'character', subjectId: 'wu',
        predicate: 'tookTheLedger', value: true, visibility: 'canon',
      }],
    }))).toBe('RUMOR_CANNOT_BECOME_FACT');
  });

  it('refuses it in either order, so the rule cannot be evaded by reordering the array', async () => {
    const store = newStore();
    expect(await refusal(store, propose({
      key: 'k:launder-reversed', participants: ['lin'], eventType: 'discovery',
      changes: [{
        type: 'fact_created', subjectType: 'character', subjectId: 'wu',
        predicate: 'tookTheLedger', value: true, visibility: 'canon',
      }, originate()],
    }))).toBe('RUMOR_CANNOT_BECOME_FACT');
  });

  it('refuses any fact at all on an event typed as a rumor', async () => {
    const store = newStore();
    expect(await refusal(store, propose({
      key: 'k:rumor-with-fact', participants: ['lin'], eventType: 'rumor',
      changes: [originate(), {
        type: 'fact_created', subjectType: 'world', subjectId: WORLD,
        predicate: 'unrelated', value: 'x', visibility: 'canon',
      }],
    }))).toBe('RUMOR_CANNOT_BECOME_FACT');
  });

  it('still lets a LATER event settle the claim, and reports the rumor as false without promoting it', async () => {
    const { store } = await threeHopWorld();
    // The world resolving a rumor honestly, in its own event, is exactly what should happen.
    const projection = await commit(store, propose({
      key: 'k:truth', participants: [], eventType: 'discovery',
      changes: [{
        type: 'fact_created', subjectType: 'character', subjectId: 'wu',
        predicate: 'tookTheLedger', value: false, visibility: 'canon',
      }],
    }));

    expect(projection.rumors[RUMOR].objectiveTruthStatus).toBe('false');
    // Still a rumor: the chain did not acquire the fact, and the fact did not acquire the chain.
    expect(projection.facts.map((fact) => fact.factId)).toHaveLength(1);
    expect(projection.rumors[RUMOR].versions).toHaveLength(1);
  });

  it('reports a rumor Canon happens to agree with as true, and still does not turn it into one', async () => {
    const { store } = await threeHopWorld();
    const projection = await commit(store, propose({
      key: 'k:confirmed', participants: [], eventType: 'discovery',
      changes: [{
        type: 'fact_created', subjectType: 'character', subjectId: 'wu',
        predicate: 'tookTheLedger', value: true, visibility: 'canon',
      }],
    }));

    expect(projection.rumors[RUMOR].objectiveTruthStatus).toBe('true');
    // A true rumor is still a rumor: nothing about the chain changed except the world's verdict.
    expect(projection.rumors[RUMOR].propagationChain).toHaveLength(3);
  });
});

describe('corrections append and never rewrite', () => {
  it('records the correction against the version it corrected, leaving that version intact', async () => {
    const { store } = await threeHopWorld();
    const before = (await commit(store, propose({
      key: 'k:distort', participants: ['hao', 'mei'],
      changes: [propagate('hao', 'mei', { content: '吳真拿走帳本還燒了它。', confidence: 0.8 })],
    }))).rumors[RUMOR];
    const projection = await commit(store, propose({
      key: 'k:correct', participants: ['wu', 'mei'],
      changes: [{
        type: 'rumor_corrected', rumorId: RUMOR, correctingCharacterId: 'wu',
        correctedContent: '帳本一直在鎮公所的櫃子裡。', correctedValue: false, reason: '吳真出示了收據。',
      }],
    }));
    const chain = projection.rumors[RUMOR];

    expect(chain.corrections).toHaveLength(1);
    expect(chain.corrections[0]).toMatchObject({
      correctsVersionId: before.currentVersionId, issuedByCharacterId: 'wu', correctedValue: false,
    });
    expect(chain.knownCorrectionId).toBe(chain.corrections[0].correctionId);
    // Nothing about the versions moved. A correction that edited them would delete the answer to
    // "who believed the wrong version, and for how long".
    expect(chain.versions.map((version) => version.content)).toEqual(before.versions.map((v) => v.content));
    expect(chain.currentVersionId).toBe(before.currentVersionId);
  });

  it('does not change anybody\'s belief', async () => {
    const { store } = await threeHopWorld();
    const beforeHolders = rumorHolders(
      (await commit(store, propose({
        key: 'k:noop', participants: ['lin'],
        changes: [{ type: 'rumor_belief_changed', rumorId: RUMOR, characterId: 'lin', stance: 'believes', confidence: 0.7 }],
      }))).characterKnowledge, RUMOR);
    const projection = await commit(store, propose({
      key: 'k:correct', participants: ['wu'],
      changes: [{
        type: 'rumor_corrected', rumorId: RUMOR, correctingCharacterId: 'wu',
        correctedContent: '帳本一直在櫃子裡。', correctedValue: false, reason: '收據。',
      }],
    }));

    // Being on the record is not the same as having been heard and accepted.
    expect(rumorHolders(projection.characterKnowledge, RUMOR)).toEqual(beforeHolders);
  });

  it('lets only an administrator or the system issue an unattributed correction', async () => {
    const { store } = await threeHopWorld();
    const worldCorrection: StateChange = {
      type: 'rumor_corrected', rumorId: RUMOR, correctingCharacterId: null,
      correctedContent: '記錄顯示帳本從未離開。', correctedValue: false, reason: '鎮誌。',
    };

    expect(await refusal(store, propose({
      key: 'k:character-speaks-for-world', participants: ['lin'],
      proposedBy: { type: 'character', id: 'lin' }, changes: [worldCorrection],
    }))).toBe('INVALID_RUMOR_CHANGE');

    const projection = await commit(store, propose({
      key: 'k:world-speaks', participants: [], proposedBy: { type: 'admin', id: 'op' },
      eventType: 'rumor', changes: [worldCorrection],
    }));
    expect(projection.rumors[RUMOR].corrections[0].issuedByCharacterId).toBeNull();
  });

  it('refuses two corrections of the same rumor in one event', async () => {
    const { store } = await threeHopWorld();
    const correction: StateChange = {
      type: 'rumor_corrected', rumorId: RUMOR, correctingCharacterId: 'wu',
      correctedContent: '帳本在櫃子裡。', correctedValue: false, reason: '收據。',
    };
    expect(await refusal(store, propose({
      key: 'k:twice', participants: ['wu'], changes: [correction, correction],
    }))).toBe('INVALID_RUMOR_CHANGE');
  });
});

describe('credibility is derived from holders, never authored', () => {
  it('weights a doubter at half and a rejecter at nothing', () => {
    expect(deriveCredibility([
      { characterId: 'a', knowledgeId: 'k1', versionId: 'v', stance: 'believes', confidence: 1 },
      { characterId: 'b', knowledgeId: 'k2', versionId: 'v', stance: 'doubts', confidence: 1 },
      { characterId: 'c', knowledgeId: 'k3', versionId: 'v', stance: 'rejects', confidence: 1 },
    ])).toBeCloseTo(0.5, 6);
  });

  it('is zero for a rumor nobody holds, rather than negative or undefined', () => {
    expect(deriveCredibility([])).toBe(0);
  });

  it('falls when the town turns against a rumor, without any event saying so', async () => {
    const { store, projection: before } = await threeHopWorld();
    const after = await commit(store, propose({
      key: 'k:turn', participants: ['wu', 'hao'],
      changes: [
        { type: 'rumor_belief_changed', rumorId: RUMOR, characterId: 'wu', stance: 'rejects', confidence: 0.9 },
        { type: 'rumor_belief_changed', rumorId: RUMOR, characterId: 'hao', stance: 'rejects', confidence: 0.9 },
      ],
    }));

    expect(before.rumors[RUMOR].credibility).toBeCloseTo(0.533333, 5);
    // Only lin still believes it, at 0.6, out of three holders.
    expect(after.rumors[RUMOR].credibility).toBeCloseTo(0.2, 6);
  });
});

describe('replay and snapshot resume agree exactly', () => {
  it('replays to an identical chain, hop for hop and version for version', async () => {
    const { store } = await threeHopWorld();
    await commit(store, propose({
      key: 'k:distort', participants: ['hao', 'mei'],
      changes: [propagate('hao', 'mei', { content: '吳真拿走帳本還燒了它。', confidence: 0.8 })],
    }));
    await commit(store, propose({
      key: 'k:correct', participants: ['wu'],
      changes: [{
        type: 'rumor_corrected', rumorId: RUMOR, correctingCharacterId: 'wu',
        correctedContent: '帳本在櫃子裡。', correctedValue: false, reason: '收據。',
      }],
    }));
    const events = await store.loadAcceptedEvents(WORLD);

    const once = replayWorldEvents(emptyProjection(WORLD), events);
    const twice = replayWorldEvents(emptyProjection(WORLD), events);
    expect(twice.rumors).toEqual(once.rumors);
    expect(once.rumors[RUMOR].versions).toHaveLength(2);
    expect(once.rumors[RUMOR].corrections).toHaveLength(1);
  });

  it('resuming from a mid-chain snapshot yields the same rumors as a full replay', async () => {
    const { store } = await threeHopWorld();
    const prefix = await store.loadAcceptedEvents(WORLD);
    const snapshot = buildSnapshot(replayWorldEvents(emptyProjection(WORLD), prefix), 1_700_000_000_000, 0);

    await commit(store, propose({
      key: 'k:distort', participants: ['hao', 'mei'],
      changes: [propagate('hao', 'mei', { content: '吳真拿走帳本還燒了它。', confidence: 0.8 })],
    }));
    const all = await store.loadAcceptedEvents(WORLD);
    const tail = all.filter((event) => event.sequenceNumber > snapshot.lastSequenceNumber);

    expect(replayFromSnapshot(snapshot, tail).rumors)
      .toEqual(replayWorldEvents(emptyProjection(WORLD), all).rumors);
  });

  it('a snapshot taken mid-chain is not mutated by the replay that resumes from it', async () => {
    const { store } = await threeHopWorld();
    const prefix = await store.loadAcceptedEvents(WORLD);
    const snapshot = buildSnapshot(replayWorldEvents(emptyProjection(WORLD), prefix), 1_700_000_000_000, 0);
    const hopsBefore = snapshot.projection.rumors[RUMOR].propagationChain.length;

    await commit(store, propose({
      key: 'k:hop3', participants: ['hao', 'mei'], changes: [propagate('hao', 'mei')],
    }));
    const tail = (await store.loadAcceptedEvents(WORLD))
      .filter((event) => event.sequenceNumber > snapshot.lastSequenceNumber);
    replayFromSnapshot(snapshot, tail);

    // A shared array reference would have appended the new hop into the STORED chain, rewriting
    // the history the snapshot exists to preserve.
    expect(snapshot.projection.rumors[RUMOR].propagationChain).toHaveLength(hopsBefore);
  });

  it('credibility does not depend on how the projection was loaded', async () => {
    const { store } = await threeHopWorld();
    const events = await store.loadAcceptedEvents(WORLD);
    const replayed = replayWorldEvents(emptyProjection(WORLD), events);
    // A projection that has been through a store loses object key ordering; the fold must not.
    const reordered: WorldProjection = {
      ...replayed,
      characterKnowledge: Object.fromEntries(
        Object.entries(replayed.characterKnowledge).reverse(),
      ),
    };

    expect(deriveCredibility(rumorHolders(reordered.characterKnowledge, RUMOR)))
      .toBe(replayed.rumors[RUMOR].credibility);
  });
});
