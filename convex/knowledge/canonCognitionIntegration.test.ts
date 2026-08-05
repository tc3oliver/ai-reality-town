/**
 * ART-61 — P0 Canon and cognition cross-domain integration suite.
 *
 * Covers PRD 19.2 cases 1, 3 and 4 plus Public Test acceptance criteria 3–6 by driving the
 * REAL domain surface end to end: the commit pipeline (`commitProposedEvent` over
 * `InMemoryCanonStore`), structural + Canon validation, the deterministic reducer, replay,
 * snapshots, and the cognition read gates (`authorizeKnowledgeRead`, `authorizeMemoryRead`,
 * `retrieveAuthorizedMemories`).
 *
 * No production domain logic is added here. The suite is deterministic: `Date.now` is
 * pinned, event ids are derived from world + sequence, and the reducer never reads a clock,
 * so repeated runs produce byte-identical accepted history and projections.
 *
 * Lives under `convex/knowledge/` because this is the only module that
 * `architecture/module-boundaries.json` allows to depend on both `canon` and `shared`.
 */

import { jest } from '@jest/globals';
import { commitProposedEvent, type CommitResult } from '../canon/commit';
import { InMemoryCanonStore } from '../canon/inMemoryStore';
import { createMistwoodFixture } from '../canon/mistwoodFixture';
import {
  emptyProjection,
  type AcceptedEvent,
  type CanonRuleContext,
  type ProposedEvent,
  type StateChange,
  type WorldProjection,
} from '../canon/model';
import { reduceWorldEvent } from '../canon/reducer';
import { replayWorldEvents } from '../canon/replay';
import { assertSnapshotMatchesHistory } from '../canon/snapshotManager';
import {
  buildSnapshot,
  projectionIntegrityHash,
  replayFromSnapshot,
  serializeProjectionDeterministically,
} from '../canon/snapshots';
import { validateCanon } from '../canon/validators';
import { isCanonError, type CanonErrorCode } from '../shared/errors';
import { authorizeKnowledgeRead } from './authorization';
import { authorizeMemoryRead } from './memoryAuthorization';
import { retrieveAuthorizedMemories } from './memoryRetrieval';

const WORLD_ID = 'mistwood-p0';
const FIXED_ACCEPTED_AT = 1_700_000_500_000;
const CHARACTERS = ['cassia', 'rowan', 'bram', 'delia'] as const;
const GATE = 'mistwood-gate';
const MARKET = 'mistwood-market';
const GROVE = 'mistwood-grove';
const MILL = 'mistwood-mill';
const LOCATIONS = [GATE, MARKET, GROVE, MILL] as const;
const LEDGER = 'mistwood-ledger';
const SECRET_PREDICATE = 'hiddenDebt';
const SECRET_VALUE = 'owes the mill three seasons of grain';

/** Every location is reachable from every other, so movement never trips teleport rules. */
function connections(): Record<string, string[]> {
  return Object.fromEntries(LOCATIONS.map((id) => [id, LOCATIONS.filter((other) => other !== id)]));
}

function ruleContext(): CanonRuleContext {
  return {
    worldId: WORLD_ID,
    rules: [],
    characterIds: [...CHARACTERS],
    locationIds: [...LOCATIONS],
    itemIds: [LEDGER],
    locationConnections: connections(),
    initialCharacterAlive: { cassia: true, rowan: true, bram: true, delia: true },
    initialItemOwners: { [LEDGER]: 'cassia' },
  };
}

function proposal(input: Omit<ProposedEvent, 'schemaVersion' | 'worldId'>): ProposedEvent {
  return { schemaVersion: 1, worldId: WORLD_ID, ...input };
}

function move(characterId: string, fromLocationId: string, toLocationId: string): StateChange {
  return { type: 'character_location_changed', characterId, fromLocationId, toLocationId };
}

function transfer(fromOwnerId: string | null, toOwnerId: string, reason: string): StateChange {
  return { type: 'item_transferred', itemId: LEDGER, fromOwnerId, toOwnerId, reason };
}

type ScriptedWorld = {
  store: InMemoryCanonStore;
  events: AcceptedEvent[];
  projection: WorldProjection;
  secretFactId: string;
  factEventId: string;
  cassiaLearnedEventId: string;
  sharedEventId: string;
  deathEventId: string;
};

/**
 * Commit the full P0 scenario script through the real pipeline and return the resulting
 * canon. The script is fixed, so the accepted log is identical on every run.
 */
async function buildScriptedWorld(): Promise<ScriptedWorld> {
  const store = new InMemoryCanonStore();
  store.setCanonRuleContext(ruleContext());
  const commit = (proposed: ProposedEvent, traceId: string): Promise<CommitResult> =>
    commitProposedEvent(store, { proposed, traceId });

  // seq 0 — the three neighbours arrive and are placed.
  await commit(proposal({
    idempotencyKey: 'p0:arrivals', proposedBy: { type: 'system' },
    worldDay: 1, timeSlot: 'morning', eventType: 'world_event',
    participantIds: [...CHARACTERS], causedByEventIds: [],
    publicSummary: 'Cassia, Rowan, Bram and Delia settle into Mistwood.',
    stateChanges: [
      move('cassia', GATE, GROVE), move('rowan', GATE, MARKET),
      move('bram', GATE, MILL), move('delia', GATE, MARKET),
    ],
  }), 'trace-arrivals');

  // seq 1 — Rowan walks to the grove so the later conversation is location-consistent.
  await commit(proposal({
    idempotencyKey: 'p0:rowan-to-grove', proposedBy: { type: 'character', id: 'rowan' },
    worldDay: 1, timeSlot: 'noon', eventType: 'movement',
    participantIds: ['rowan'], causedByEventIds: [],
    publicSummary: 'Rowan walks from the market to the grove.',
    stateChanges: [move('rowan', MARKET, GROVE)],
  }), 'trace-rowan-to-grove');

  // seq 2 — the secret enters Canon as a private fact. This is the only legal source.
  const factEvent = await commit(proposal({
    idempotencyKey: 'p0:secret-fact', proposedBy: { type: 'system' },
    worldDay: 1, timeSlot: 'noon', eventType: 'discovery', locationId: GROVE,
    participantIds: ['cassia'], causedByEventIds: [],
    stateChanges: [{
      type: 'fact_created', subjectType: 'character', subjectId: 'rowan',
      predicate: SECRET_PREDICATE, value: SECRET_VALUE, visibility: 'private',
    }],
  }), 'trace-secret-fact');
  const secretFactId = `${factEvent.eventId}:fact:0`;

  // seq 3 — Cassia acquires the secret by observation, citing the accepted source event.
  const learnedEvent = await commit(proposal({
    idempotencyKey: 'p0:cassia-learns', proposedBy: { type: 'system' },
    worldDay: 1, timeSlot: 'afternoon', eventType: 'discovery', locationId: GROVE,
    participantIds: ['cassia'], causedByEventIds: [factEvent.eventId],
    stateChanges: [
      {
        type: 'character_knowledge_learned', characterId: 'cassia', factId: secretFactId,
        sourceType: 'observed', sourceEventId: factEvent.eventId, beliefValue: SECRET_VALUE,
        truthStatus: 'true', confidence: 0.9, shareability: 'trusted',
      },
      {
        type: 'character_memory_formed', characterId: 'cassia',
        content: 'Cassia read the mill ledger left open in the grove.',
        interpretation: 'Rowan is deeper in debt than the village believes.',
        importance: 0.8, emotionalWeight: -0.4, confidence: 0.9, visibility: 'private',
      },
    ],
  }), 'trace-cassia-learns');

  // seq 4 — Cassia shares the secret with Rowan; Rowan's belief cites Cassia's learning event.
  const sharedEvent = await commit(proposal({
    idempotencyKey: 'p0:cassia-tells-rowan', proposedBy: { type: 'character', id: 'cassia' },
    worldDay: 1, timeSlot: 'evening', eventType: 'conversation', locationId: GROVE,
    participantIds: ['cassia', 'rowan'], causedByEventIds: [learnedEvent.eventId],
    publicSummary: 'Cassia and Rowan speak quietly at the grove.',
    stateChanges: [
      {
        type: 'character_knowledge_learned', characterId: 'rowan', factId: secretFactId,
        sourceType: 'told', sourceEventId: learnedEvent.eventId, beliefValue: SECRET_VALUE,
        truthStatus: 'true', confidence: 0.6, shareability: 'private',
      },
      {
        type: 'character_memory_formed', characterId: 'rowan',
        content: 'Cassia told Rowan she had seen the mill ledger.',
        interpretation: 'Rowan now knows his debt is no longer hidden.',
        importance: 0.9, emotionalWeight: -0.6, confidence: 0.7, visibility: 'private',
      },
      {
        type: 'relationship_changed', sourceCharacterId: 'cassia', targetCharacterId: 'rowan',
        trustDelta: 8, affectionDelta: 2, resentmentDelta: 0, fearDelta: 0,
        dependencyDelta: 1, familiarityDelta: 5, reason: 'shared a confidence at the grove',
        visibility: 'public',
      },
    ],
  }), 'trace-cassia-tells-rowan');

  // seq 5..9 — the ledger changes hands three times, interleaved with movement.
  await commit(proposal({
    idempotencyKey: 'p0:ledger-cassia-to-rowan', proposedBy: { type: 'system' },
    worldDay: 2, timeSlot: 'morning', eventType: 'world_event', locationId: GROVE,
    participantIds: ['cassia', 'rowan'], causedByEventIds: [sharedEvent.eventId],
    publicSummary: 'Cassia hands the mill ledger to Rowan.',
    stateChanges: [transfer('cassia', 'rowan', 'Cassia returns the ledger to its debtor')],
  }), 'trace-ledger-1');

  await commit(proposal({
    idempotencyKey: 'p0:rowan-to-mill', proposedBy: { type: 'character', id: 'rowan' },
    worldDay: 2, timeSlot: 'noon', eventType: 'movement',
    participantIds: ['rowan'], causedByEventIds: [],
    publicSummary: 'Rowan carries the ledger to the mill.',
    stateChanges: [move('rowan', GROVE, MILL)],
  }), 'trace-rowan-to-mill');

  await commit(proposal({
    idempotencyKey: 'p0:ledger-rowan-to-bram', proposedBy: { type: 'system' },
    worldDay: 2, timeSlot: 'noon', eventType: 'world_event', locationId: MILL,
    participantIds: ['rowan', 'bram'], causedByEventIds: [],
    publicSummary: 'Rowan surrenders the ledger to Bram at the mill.',
    stateChanges: [transfer('rowan', 'bram', 'Rowan settles the account with the miller')],
  }), 'trace-ledger-2');

  await commit(proposal({
    idempotencyKey: 'p0:bram-to-grove', proposedBy: { type: 'character', id: 'bram' },
    worldDay: 2, timeSlot: 'afternoon', eventType: 'movement',
    participantIds: ['bram'], causedByEventIds: [],
    publicSummary: 'Bram walks to the grove.',
    stateChanges: [move('bram', MILL, GROVE)],
  }), 'trace-bram-to-grove');

  await commit(proposal({
    idempotencyKey: 'p0:ledger-bram-to-cassia', proposedBy: { type: 'system' },
    worldDay: 2, timeSlot: 'afternoon', eventType: 'world_event', locationId: GROVE,
    participantIds: ['bram', 'cassia'], causedByEventIds: [],
    publicSummary: 'Bram leaves the ledger with Cassia.',
    stateChanges: [transfer('bram', 'cassia', 'Bram asks Cassia to keep the record safe')],
  }), 'trace-ledger-3');

  // seq 10 — Bram dies. Every later normal scene must exclude him.
  const deathEvent = await commit(deathProposal(), 'trace-bram-dies');

  const events = store.committedEvents();
  return {
    store,
    events,
    projection: replayWorldEvents(emptyProjection(WORLD_ID), events),
    secretFactId,
    factEventId: factEvent.eventId,
    cassiaLearnedEventId: learnedEvent.eventId,
    sharedEventId: sharedEvent.eventId,
    deathEventId: deathEvent.eventId,
  };
}

/** The exact death proposal used by the script, so a retry can replay it byte for byte. */
function deathProposal(): ProposedEvent {
  return proposal({
    idempotencyKey: 'p0:bram-dies', proposedBy: { type: 'system' },
    worldDay: 3, timeSlot: 'morning', eventType: 'world_event', locationId: GROVE,
    participantIds: ['bram'], causedByEventIds: [],
    publicSummary: 'Bram is found dead beneath the grove oak.',
    stateChanges: [{
      type: 'character_life_changed', characterId: 'bram', alive: false,
      reason: 'found dead beneath the grove oak',
    }],
  });
}

async function expectRejection(pending: Promise<CommitResult>, code: CanonErrorCode): Promise<void> {
  await expect(pending).rejects.toMatchObject({ error: { code } });
}

/** Stable Canon error code raised by a synchronous read gate, or `null` when it allowed. */
function deniedCode(read: () => unknown): CanonErrorCode | null {
  try {
    read();
    return null;
  } catch (error) {
    return isCanonError(error) ? error.error.code : null;
  }
}

/** Projection after each accepted event, used to check per-event invariants. */
function prefixProjections(events: AcceptedEvent[]): WorldProjection[] {
  const projections: WorldProjection[] = [];
  let projection = emptyProjection(WORLD_ID);
  for (const event of events) {
    projection = reduceWorldEvent(projection, event);
    projections.push(projection);
  }
  return projections;
}

let world: ScriptedWorld;

beforeAll(() => {
  jest.spyOn(Date, 'now').mockReturnValue(FIXED_ACCEPTED_AT);
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(async () => {
  world = await buildScriptedWorld();
});

describe('ART-61 AC #1 — sourced secret acquisition and sharing (PRD 19.2 case 1, Public Test AC 5)', () => {
  it('grants the secret only through accepted-event sources and keeps provenance intact', () => {
    const acceptedIds = new Set(world.events.map((event) => event.eventId));

    expect(world.projection.characterKnowledge.cassia).toEqual([expect.objectContaining({
      factId: world.secretFactId, sourceType: 'observed', sourceEventId: world.factEventId,
      beliefValue: SECRET_VALUE, truthStatus: 'true', confidence: 0.9, shareability: 'trusted',
      learnedAt: { worldDay: 1, timeSlot: 'afternoon', eventId: world.cassiaLearnedEventId },
    })]);
    expect(world.projection.characterKnowledge.rowan).toEqual([expect.objectContaining({
      factId: world.secretFactId, sourceType: 'told', sourceEventId: world.cassiaLearnedEventId,
      beliefValue: SECRET_VALUE, truthStatus: 'true', confidence: 0.6, shareability: 'private',
      learnedAt: { worldDay: 1, timeSlot: 'evening', eventId: world.sharedEventId },
    })]);
    // Bram was never party to an accepted event carrying the secret.
    expect(world.projection.characterKnowledge.bram).toBeUndefined();

    // Every belief cites a real accepted event, and the citing event declares that cause.
    for (const records of Object.values(world.projection.characterKnowledge)) {
      for (const record of records) {
        expect(acceptedIds.has(record.sourceEventId)).toBe(true);
        const citing = world.events.find((event) => event.eventId === record.learnedAt.eventId);
        expect(citing?.causedByEventIds).toContain(record.sourceEventId);
      }
    }

    // The secret itself is a private canonical fact rooted in the source event.
    expect(world.projection.facts).toEqual([expect.objectContaining({
      factId: world.secretFactId, subjectType: 'character', subjectId: 'rowan',
      predicate: SECRET_PREDICATE, value: SECRET_VALUE, visibility: 'private',
      validFromEventId: world.factEventId, validUntilEventId: null,
    })]);
  });

  it('rejects unsourced, unknown-sourced and non-participant knowledge without writing', async () => {
    const before = world.events.length;
    const learn = (overrides: Partial<ProposedEvent>, characterId: string, sourceEventId: string): ProposedEvent => ({
      ...proposal({
        idempotencyKey: `p0:leak-${characterId}`, proposedBy: { type: 'system' },
        worldDay: 3, timeSlot: 'noon', eventType: 'conversation', locationId: GROVE,
        participantIds: ['cassia'], causedByEventIds: [sourceEventId],
        stateChanges: [{
          type: 'character_knowledge_learned', characterId, factId: world.secretFactId,
          sourceType: 'told', sourceEventId, beliefValue: SECRET_VALUE,
          truthStatus: 'true', confidence: 0.5, shareability: 'private',
        }],
      }),
      ...overrides,
    });

    // No causal source at all.
    await expectRejection(commitProposedEvent(world.store, {
      proposed: learn({ causedByEventIds: [], idempotencyKey: 'p0:leak-unsourced' }, 'cassia', world.factEventId),
      traceId: 'trace-unsourced',
    }), 'KNOWLEDGE_SOURCE_MISSING');

    // Cites an event that is not in accepted history.
    await expectRejection(commitProposedEvent(world.store, {
      proposed: learn({ idempotencyKey: 'p0:leak-unknown' }, 'cassia', `${WORLD_ID}#event#99`),
      traceId: 'trace-unknown-source',
    }), 'UNKNOWN_EVENT_REFERENCE');

    // Bram was not in the scene, so he cannot pick the belief up from it.
    await expectRejection(commitProposedEvent(world.store, {
      proposed: learn({ idempotencyKey: 'p0:leak-bystander' }, 'bram', world.cassiaLearnedEventId),
      traceId: 'trace-bystander',
    }), 'PARTICIPANT_MISMATCH');

    expect(world.store.committedEvents()).toHaveLength(before);
    expect(replayWorldEvents(emptyProjection(WORLD_ID), world.store.committedEvents())
      .characterKnowledge.bram).toBeUndefined();
  });

  it('never discloses the secret to a reader without an accepted-event grant', () => {
    const ledger = world.projection.characterKnowledge;
    const memories = world.projection.characterMemories;

    expect(authorizeKnowledgeRead(ledger, 'rowan', { type: 'character', characterId: 'rowan' })).toHaveLength(1);
    expect(authorizeKnowledgeRead(ledger, 'rowan', { type: 'operations', operatorId: 'op-1' })).toHaveLength(1);
    expect(deniedCode(() => authorizeKnowledgeRead(ledger, 'rowan', { type: 'character', characterId: 'bram' })))
      .toBe('KNOWLEDGE_ACCESS_DENIED');
    expect(authorizeKnowledgeRead(ledger, 'bram', { type: 'operations', operatorId: 'op-1' })).toEqual([]);

    expect(deniedCode(() => authorizeMemoryRead(memories, 'cassia', { type: 'character', characterId: 'rowan' })))
      .toBe('MEMORY_ACCESS_DENIED');

    const retrieved = retrieveAuthorizedMemories(memories, {
      targetCharacterId: 'cassia', requester: { type: 'character', characterId: 'cassia' },
      query: 'ledger debt', limit: 5, now: { worldDay: 3, timeSlot: 'morning' },
      arcRelevantEventIds: [world.cassiaLearnedEventId],
    });
    expect(retrieved.memories).toHaveLength(1);
    expect(retrieved.trace[0]).toMatchObject({ sourceEventId: world.cassiaLearnedEventId, arcRelevance: 1 });
  });
});

describe('ART-61 AC #2 — deceased characters leave normal scenes (PRD 19.2 case 3, Public Test AC 4)', () => {
  const newScene = (key: string): ProposedEvent => proposal({
    idempotencyKey: key, proposedBy: { type: 'director' },
    worldDay: 4, timeSlot: 'morning', eventType: 'conversation', locationId: GROVE,
    participantIds: ['cassia', 'bram'], causedByEventIds: [],
    publicSummary: 'A new morning scene at the grove.',
    stateChanges: [{
      type: 'relationship_changed', sourceCharacterId: 'cassia', targetCharacterId: 'bram',
      trustDelta: 3, affectionDelta: 1, resentmentDelta: 0, reason: 'spoke at the grove',
      visibility: 'public',
    }],
  });

  it('deduplicates a retried death and still records exactly one life change', async () => {
    const before = world.store.committedEvents().length;
    const retry = await commitProposedEvent(world.store, { proposed: deathProposal(), traceId: 'trace-retry' });

    expect(retry).toMatchObject({ deduplicated: true, eventId: world.deathEventId });
    expect(world.store.committedEvents()).toHaveLength(before);
    const replayed = replayWorldEvents(emptyProjection(WORLD_ID), world.store.committedEvents());
    // Only an accepted life change writes `characterAlive`; the rest of the roster stays
    // alive by default, so exactly one death is recorded no matter how often it is retried.
    expect(replayed.characterAlive).toEqual({ bram: false });
    expect(replayed.characterStates.bram).toMatchObject({ alive: false, active: false });
    expect(world.store.committedEvents().filter((event) => event.stateChanges
      .some((change) => change.type === 'character_life_changed'))).toHaveLength(1);
  });

  it('rejects every new scene, movement and resurrection involving the deceased character', async () => {
    const before = world.store.committedEvents().length;

    await expectRejection(commitProposedEvent(world.store, {
      proposed: newScene('p0:dead-scene'), traceId: 'trace-dead-scene',
    }), 'DEAD_CHARACTER_ACTION');

    await expectRejection(commitProposedEvent(world.store, {
      proposed: proposal({
        idempotencyKey: 'p0:dead-move', proposedBy: { type: 'character', id: 'bram' },
        worldDay: 4, timeSlot: 'noon', eventType: 'movement',
        participantIds: ['bram'], causedByEventIds: [],
        stateChanges: [move('bram', GROVE, MILL)],
      }),
      traceId: 'trace-dead-move',
    }), 'DEAD_CHARACTER_ACTION');

    await expectRejection(commitProposedEvent(world.store, {
      proposed: proposal({
        idempotencyKey: 'p0:resurrect', proposedBy: { type: 'system' },
        worldDay: 4, timeSlot: 'noon', eventType: 'world_event',
        participantIds: ['bram'], causedByEventIds: [],
        stateChanges: [{
          type: 'character_life_changed', characterId: 'bram', alive: true, reason: 'returns',
        }],
      }),
      traceId: 'trace-resurrect',
    }), 'DEAD_CHARACTER_ACTION');

    expect(world.store.committedEvents()).toHaveLength(before);

    // The rule is targeted: living characters still play new scenes.
    const living = await commitProposedEvent(world.store, {
      proposed: proposal({
        idempotencyKey: 'p0:living-scene', proposedBy: { type: 'director' },
        worldDay: 4, timeSlot: 'morning', eventType: 'conversation', locationId: GROVE,
        participantIds: ['cassia', 'rowan'], causedByEventIds: [],
        publicSummary: 'Cassia and Rowan meet again at the grove.',
        stateChanges: [{
          type: 'relationship_changed', sourceCharacterId: 'cassia', targetCharacterId: 'rowan',
          trustDelta: 2, affectionDelta: 1, resentmentDelta: 0, reason: 'met again at the grove',
          visibility: 'public',
        }],
      }),
      traceId: 'trace-living-scene',
    });
    expect(living.deduplicated).toBe(false);
  });

  it('keeps the exclusion after a full replay and after a snapshot-resumed replay', () => {
    const events = world.store.committedEvents();
    const fullReplay = replayWorldEvents(emptyProjection(WORLD_ID), events);
    const deathIndex = events.findIndex((event) => event.eventId === world.deathEventId);
    const snapshot = buildSnapshot(
      replayWorldEvents(emptyProjection(WORLD_ID), events.slice(0, deathIndex + 1)),
      FIXED_ACCEPTED_AT,
      events[deathIndex].worldDay,
    );
    const resumed = replayFromSnapshot(snapshot, events.slice(deathIndex + 1));

    for (const projection of [fullReplay, resumed]) {
      expect(projection.characterAlive.bram).toBe(false);
      expect(validateCanon(newScene('p0:dead-scene-replayed'), projection, ruleContext()))
        .toMatchObject({ code: 'DEAD_CHARACTER_ACTION', path: 'participantIds' });
    }
    expect(resumed).toEqual(fullReplay);
  });
});

describe('ART-61 AC #3 — unique item ownership across transfers (PRD 19.2 case 4, Public Test AC 6)', () => {
  it('keeps exactly one canonical owner and one history entry per accepted transfer', () => {
    const acceptedIds = new Set(world.events.map((event) => event.eventId));
    const history = world.projection.itemOwnershipHistory[LEDGER];

    expect(Object.keys(world.projection.itemOwners)).toEqual([LEDGER]);
    expect(world.projection.itemOwners[LEDGER]).toBe('cassia');
    expect(history.map((entry) => [entry.fromOwnerId, entry.toOwnerId])).toEqual([
      ['cassia', 'rowan'], ['rowan', 'bram'], ['bram', 'cassia'],
    ]);
    for (const entry of history) expect(acceptedIds.has(entry.sourceEventId)).toBe(true);
    expect(history.map((entry) => entry.sequenceNumber))
      .toEqual([...history].map((entry) => entry.sequenceNumber).sort((a, b) => a - b));

    // At no point in history does the ledger have more than one owner, and any owner it
    // does have is a known character from the world roster.
    for (const projection of prefixProjections(world.events)) {
      expect(Object.keys(projection.itemOwners).length).toBeLessThanOrEqual(1);
      const owner = projection.itemOwners[LEDGER];
      if (owner !== undefined) expect(CHARACTERS).toContain(owner);
    }
  });

  it('collapses concurrent duplicate transfer retries into one accepted event', async () => {
    const before = world.store.committedEvents().length;
    const retried = proposal({
      idempotencyKey: 'p0:ledger-retry', proposedBy: { type: 'system' },
      worldDay: 4, timeSlot: 'morning', eventType: 'world_event', locationId: GROVE,
      participantIds: ['cassia', 'rowan'], causedByEventIds: [],
      publicSummary: 'Cassia passes the ledger to Rowan again.',
      stateChanges: [transfer('cassia', 'rowan', 'a retried handover')],
    });

    const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      commitProposedEvent(world.store, { proposed: retried, traceId: `trace-retry-${index}` })));

    expect(results.filter((result) => !result.deduplicated)).toHaveLength(1);
    expect(new Set(results.map((result) => result.eventId)).size).toBe(1);
    expect(world.store.committedEvents()).toHaveLength(before + 1);
    const projection = replayWorldEvents(emptyProjection(WORLD_ID), world.store.committedEvents());
    expect(projection.itemOwners[LEDGER]).toBe('rowan');
    expect(projection.itemOwnershipHistory[LEDGER]).toHaveLength(4);
  });

  it('rejects concurrent conflicting transfers and double transfers inside one event', async () => {
    const contender = (key: string, toOwnerId: string): ProposedEvent => proposal({
      idempotencyKey: key, proposedBy: { type: 'system' },
      worldDay: 4, timeSlot: 'morning', eventType: 'world_event',
      participantIds: ['cassia', toOwnerId], causedByEventIds: [],
      publicSummary: 'The ledger changes hands.',
      stateChanges: [transfer('cassia', toOwnerId, 'a contested handover')],
    });

    const settled = await Promise.allSettled([
      commitProposedEvent(world.store, { proposed: contender('p0:contend-a', 'rowan'), traceId: 'trace-a' }),
      commitProposedEvent(world.store, { proposed: contender('p0:contend-b', 'delia'), traceId: 'trace-b' }),
    ]);

    // The store serializes per world, so the first submission wins deterministically.
    expect(settled.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    const rejected = settled[1];
    expect(rejected.status === 'rejected' && rejected.reason).toMatchObject({
      error: { code: 'ITEM_OWNERSHIP_CONFLICT' },
    });
    const projection = replayWorldEvents(emptyProjection(WORLD_ID), world.store.committedEvents());
    expect(projection.itemOwners[LEDGER]).toBe('rowan');
    expect(projection.itemOwnershipHistory[LEDGER]).toHaveLength(4);

    // Two transfers of one item in a single event can never create a second owner.
    const doubled = contender('p0:double', 'rowan');
    doubled.stateChanges.push(transfer('cassia', 'bram', 'a second claim'));
    await expectRejection(
      commitProposedEvent(world.store, { proposed: doubled, traceId: 'trace-double' }),
      'ITEM_OWNERSHIP_CONFLICT',
    );
  });
});

describe('ART-61 AC #4 — determinism and 100% replay equality', () => {
  it('produces byte-identical canon and projections on repeated runs', async () => {
    const rerun = await buildScriptedWorld();

    expect(rerun.events).toEqual(world.events);
    expect(serializeProjectionDeterministically(rerun.projection))
      .toBe(serializeProjectionDeterministically(world.projection));
    expect(projectionIntegrityHash(rerun.projection)).toBe(projectionIntegrityHash(world.projection));
  });

  it('retains 100% replay equality across every snapshot cut point', () => {
    const expected = serializeProjectionDeterministically(world.projection);
    const prefixes = prefixProjections(world.events);
    let equal = 0;

    for (let cut = 0; cut < world.events.length; cut++) {
      const snapshot = buildSnapshot(prefixes[cut], FIXED_ACCEPTED_AT, world.events[cut].worldDay);
      assertSnapshotMatchesHistory(snapshot, world.events, { projection: emptyProjection(WORLD_ID), lastSequenceNumber: -1 });
      const resumed = replayFromSnapshot(snapshot, world.events.slice(cut + 1));
      if (serializeProjectionDeterministically(resumed) === expected) equal += 1;
    }

    expect(world.events).toHaveLength(11);
    expect(equal).toBe(world.events.length);
    expect(equal / world.events.length).toBe(1);
    expect(prefixes[prefixes.length - 1]).toEqual(world.projection);
  });

  it('keeps the shared Mistwood fixture deterministic and snapshot-equal', () => {
    const first = createMistwoodFixture();
    const second = createMistwoodFixture();

    expect(second.events).toEqual(first.events);
    expect(projectionIntegrityHash(second.fullProjection)).toBe(projectionIntegrityHash(first.fullProjection));
    expect(replayWorldEvents(first.initialProjection, first.events)).toEqual(first.fullProjection);
    expect(replayFromSnapshot(first.snapshot, first.eventsAfterSnapshot)).toEqual(first.fullProjection);
  });
});

describe('ART-61 cross-cutting P0 invariants (Public Test AC 3–6)', () => {
  it('holds location, life-state, ownership and provenance invariants for every accepted event', () => {
    const prefixes = prefixProjections(world.events);
    const acceptedIds = new Set(world.events.map((event) => event.eventId));

    world.events.forEach((event, index) => {
      const before = index === 0 ? emptyProjection(WORLD_ID) : prefixes[index - 1];
      const after = prefixes[index];

      // Public Test AC 3 — no character location conflict: a located scene only involves
      // characters standing in that location.
      if (event.locationId !== undefined) {
        for (const participant of event.participantIds) {
          expect(after.characterLocations[participant]).toBe(event.locationId);
        }
      }
      // Public Test AC 4 — participants were alive when the event was accepted.
      for (const participant of event.participantIds) {
        expect(before.characterAlive[participant] ?? true).toBe(true);
      }
      // Public Test AC 6 — sequence numbers are a gapless, duplicate-free run.
      expect(event.sequenceNumber).toBe(index);
      expect(event.validationVersion).toBe('canon-v1');
    });

    // Public Test AC 5 — no belief exists without an accepted source event.
    for (const records of Object.values(world.projection.characterKnowledge)) {
      for (const record of records) expect(acceptedIds.has(record.sourceEventId)).toBe(true);
    }
    // Every projected memory is rooted in an accepted event too.
    for (const records of Object.values(world.projection.characterMemories)) {
      for (const record of records) expect(acceptedIds.has(record.sourceEventId)).toBe(true);
    }
    expect(new Set(world.events.map((event) => event.idempotencyKey)).size).toBe(world.events.length);
  });
});
