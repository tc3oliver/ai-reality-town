/**
 * Integration test for the FR-K003 audited Canon correction workflows.
 *
 * Drives the SAME code the Convex mutations drive — {@link submitRemediation} over the
 * real {@link commitProposedEvent} pipeline (structural validation, idempotency, canon
 * validation, sequence allocation, append), the real ART-48 authorization gate and audit
 * builder, the real reducer/replay, and the real public Live read-model builder — against
 * an in-memory canon store and recording ports. Every FR-K003 acceptance criterion is
 * therefore proven by execution rather than by reading the wiring.
 *
 * AC#1 accepted events are never deleted, AC#2/#5 operator + reason are recorded twice,
 * AC#3 replay stays consistent after a correction, AC#4 public content follows it.
 */

import { commitProposedEvent } from '../canon/commit';
import { InMemoryCanonStore } from '../canon/inMemoryStore';
import { REMEDIATION_EVENT_TYPES, type RemediationEventType } from '../canon/eventTypes';
import { emptyProjection, type ProposedEvent, type StateChange } from '../canon/model';
import { replayWorldEvents } from '../canon/replay';
import { deriveEventId } from '../shared/ids';
import { buildLiveProjection } from '../publicRead/liveState';
import {
  authorizeOperator,
  isUnauthorizedError,
  OPS_CAPABILITY_MINIMUM_ROLE,
  type OperatorAuditEntry,
  type OperatorPrincipal,
} from './operatorAuthorization';
import { postCommitRunId } from './postCommitLive';
import {
  buildRemediationEvent,
  REMEDIATION_POLICY,
  RemediationError,
  submitRemediation,
  type RemediationPorts,
  type RemediationRequest,
} from './canonCorrection';

const WORLD_ID = 'mistwood';
const AT = 1_700_000_000_000;
const VICTIM = 'he-jun';
const DEATH_EVENT_ID = deriveEventId(WORLD_ID, 0);

const ADMIN: OperatorPrincipal = {
  operatorId: 'ops-admin', role: 'admin', source: 'identity', subject: 'auth|admin',
};

/** Ports that record what the Convex wiring would have written. */
function createPorts(store: InMemoryCanonStore): {
  ports: RemediationPorts;
  audits: OperatorAuditEntry[];
  refreshes: { worldId: string; sequenceNumber: number }[];
} {
  const audits: OperatorAuditEntry[] = [];
  const refreshes: { worldId: string; sequenceNumber: number }[] = [];
  return {
    audits,
    refreshes,
    ports: {
      canonStore: store,
      appendAudit: (entry) => {
        audits.push(entry);
        return Promise.resolve();
      },
      // Mirrors the wiring: ART-98's post-commit pipeline, keyed by the run id it
      // derives for the sequence number the commit just allocated.
      refreshPublicContent: (worldId, sequenceNumber) => {
        refreshes.push({ worldId, sequenceNumber });
        return Promise.resolve({ runId: postCommitRunId(worldId, sequenceNumber), status: 'completed' });
      },
    },
  };
}

/** The event the record got wrong: a death that never happened. */
const deathEvent: ProposedEvent = {
  schemaVersion: 1,
  worldId: WORLD_ID,
  idempotencyKey: 'seed-death',
  proposedBy: { type: 'director', id: 'director-1' },
  worldDay: 3,
  timeSlot: 'evening',
  eventType: 'world_event',
  participantIds: [VICTIM],
  causedByEventIds: [],
  publicSummary: 'he-jun died in the mill collapse.',
  stateChanges: [{ type: 'character_life_changed', characterId: VICTIM, alive: false, reason: 'mill collapse' }],
};

async function seedStore(): Promise<InMemoryCanonStore> {
  const store = new InMemoryCanonStore();
  await commitProposedEvent(store, { proposed: deathEvent, traceId: 'trace-seed' });
  return store;
}

/**
 * A remediation every type accepts, so the shared contract can be asserted once per
 * type: restate one public world fact about what happened.
 */
function factRemediation(
  remediationType: RemediationEventType,
  overrides: Partial<RemediationRequest> = {},
): RemediationRequest {
  return {
    worldId: WORLD_ID,
    remediationType,
    targetEventIds: [DEATH_EVENT_ID],
    reason: `the mill report named the wrong villager (${remediationType})`,
    idempotencyKey: `remediation-${remediationType}`,
    worldDay: 4,
    timeSlot: 'morning',
    participantIds: [],
    publicSummary: 'The mill collapse record has been restated.',
    stateChanges: [{
      type: 'fact_created', subjectType: 'world', subjectId: WORLD_ID,
      predicate: 'millCollapseAccount', value: `restated by ${remediationType}`, visibility: 'public',
    }],
    ...overrides,
  };
}

/** The change only a superseding remediation may make: undo a wrongly recorded death. */
const resurrection: StateChange[] = [
  { type: 'character_life_changed', characterId: VICTIM, alive: true, reason: 'the death was recorded in error' },
];

describe('FR-K003 audited canon correction workflows', () => {
  it.each(REMEDIATION_EVENT_TYPES)(
    'appends a %s as a NEW accepted event and leaves the cited event byte-identical',
    async (remediationType) => {
      const store = await seedStore();
      const before = JSON.stringify(store.committedEvents()[0]);
      const { ports, refreshes } = createPorts(store);

      const result = await submitRemediation(ports, {
        principal: ADMIN, request: factRemediation(remediationType), traceId: 'trace-remediation', at: AT,
      });

      const events = store.committedEvents();
      expect(events).toHaveLength(2);
      expect(JSON.stringify(events[0])).toBe(before);
      expect(events[1]).toMatchObject({
        eventId: result.eventId,
        sequenceNumber: 1,
        eventType: remediationType,
        proposedBy: { type: 'admin', id: ADMIN.operatorId },
        causedByEventIds: [DEATH_EVENT_ID],
      });
      expect(result.deduplicated).toBe(false);
      expect(refreshes).toEqual([{ worldId: WORLD_ID, sequenceNumber: 1 }]);
    },
  );

  it.each(REMEDIATION_EVENT_TYPES)(
    'records the operator and the reason for a %s on the event itself AND in the audit trail',
    async (remediationType) => {
      const store = await seedStore();
      const { ports, audits } = createPorts(store);
      const request = factRemediation(remediationType);

      await submitRemediation(ports, { principal: ADMIN, request, traceId: 'trace-remediation', at: AT });

      // AC#2/#5: the durable record on the accepted event, which is immutable forever.
      expect(store.committedEvents()[1].metadata).toEqual({
        remediation: {
          schemaVersion: 1,
          type: remediationType,
          operatorId: ADMIN.operatorId,
          reason: request.reason,
          targetEventIds: [DEATH_EVENT_ID],
          supersedes: remediationType === 'compensation' ? [] : [DEATH_EVENT_ID],
          offsets: remediationType === 'compensation' ? [DEATH_EVENT_ID] : [],
        },
      });
      // ...and the ART-48 operator audit row, written in the same transaction.
      expect(audits).toEqual([{
        schemaVersion: 1,
        worldId: WORLD_ID,
        operatorId: ADMIN.operatorId,
        subject: ADMIN.subject,
        role: 'admin',
        source: 'identity',
        capability: REMEDIATION_POLICY[remediationType].capability,
        target: DEATH_EVENT_ID,
        reason: request.reason,
        outcome: 'applied',
        resultCode: 'OPS_OK',
        at: AT,
      }]);
    },
  );

  it.each(REMEDIATION_EVENT_TYPES)('reserves the %s capability for an administrator', (remediationType) => {
    const capability = REMEDIATION_POLICY[remediationType].capability;
    expect(OPS_CAPABILITY_MINIMUM_ROLE[capability]).toBe('admin');

    const registry = [
      { operatorId: 'ops-operator', role: 'operator' as const, subjects: ['auth|operator'] },
      { operatorId: 'ops-admin', role: 'admin' as const, subjects: ['auth|admin'] },
    ];
    // A merely privileged operator is refused with the uniform denial...
    let denial: unknown;
    try {
      authorizeOperator({
        credentials: { identity: { subject: 'auth|operator' } }, registry, capability, worldId: WORLD_ID,
      });
    } catch (error) {
      denial = error;
    }
    expect(isUnauthorizedError(denial)).toBe(true);
    // ...and an anonymous caller cannot even learn the capability exists.
    expect(() => authorizeOperator({
      credentials: {}, registry, capability, worldId: WORLD_ID,
    })).toThrow('operator is not authorized for this operation');
    expect(authorizeOperator({
      credentials: { identity: { subject: 'auth|admin' } }, registry, capability, worldId: WORLD_ID,
    }).operatorId).toBe('ops-admin');
  });

  it('refuses a remediation with no reason, no cited event, or a duplicated citation', async () => {
    const store = await seedStore();
    const { ports, audits, refreshes } = createPorts(store);
    const attempt = (overrides: Partial<RemediationRequest>): Promise<unknown> => submitRemediation(ports, {
      principal: ADMIN, request: factRemediation('correction', overrides), traceId: 'trace', at: AT,
    });

    await expect(attempt({ reason: '   ' })).rejects
      .toMatchObject({ code: 'REMEDIATION_REASON_REQUIRED' });
    await expect(attempt({ targetEventIds: [] })).rejects
      .toMatchObject({ code: 'REMEDIATION_TARGET_REQUIRED' });
    await expect(attempt({ targetEventIds: [DEATH_EVENT_ID, DEATH_EVENT_ID] })).rejects
      .toMatchObject({ code: 'REMEDIATION_TARGET_DUPLICATED' });
    expect(() => buildRemediationEvent({ operatorId: '' }, factRemediation('retcon')))
      .toThrow(RemediationError);

    // A refused remediation writes nothing: no event, no audit row, no publication.
    expect(store.committedEvents()).toHaveLength(1);
    expect(audits).toHaveLength(0);
    expect(refreshes).toHaveLength(0);
  });

  it('refuses a retcon that does not restate the public account', async () => {
    const store = await seedStore();
    const { ports } = createPorts(store);
    const request = factRemediation('retcon', { publicSummary: undefined });

    await expect(submitRemediation(ports, { principal: ADMIN, request, traceId: 'trace', at: AT }))
      .rejects.toMatchObject({ code: 'REMEDIATION_PUBLIC_SUMMARY_REQUIRED' });
    // The same request is acceptable as a correction, which does not rewrite the story.
    await expect(submitRemediation(ports, {
      principal: ADMIN, request: { ...request, remediationType: 'correction' }, traceId: 'trace', at: AT,
    })).resolves.toMatchObject({ sequenceNumber: 1 });
  });

  it('refuses a remediation that cites an event the world never accepted', async () => {
    const store = await seedStore();
    const { ports, audits } = createPorts(store);

    await expect(submitRemediation(ports, {
      principal: ADMIN,
      request: factRemediation('correction', { targetEventIds: [deriveEventId(WORLD_ID, 99)] }),
      traceId: 'trace', at: AT,
    })).rejects.toMatchObject({ error: { code: 'UNKNOWN_EVENT_REFERENCE' } });
    expect(store.committedEvents()).toHaveLength(1);
    expect(audits).toHaveLength(0);
  });

  it('lets a correction and a retcon overrule a wrongly recorded death, but not a compensation', async () => {
    const compensationStore = await seedStore();
    await expect(submitRemediation(createPorts(compensationStore).ports, {
      principal: ADMIN,
      request: factRemediation('compensation', { participantIds: [VICTIM], stateChanges: resurrection }),
      traceId: 'trace', at: AT,
    })).rejects.toMatchObject({ error: { code: 'DEAD_CHARACTER_ACTION' } });
    expect(compensationStore.committedEvents()).toHaveLength(1);

    for (const remediationType of ['correction', 'retcon'] as const) {
      const store = await seedStore();
      await submitRemediation(createPorts(store).ports, {
        principal: ADMIN,
        request: factRemediation(remediationType, { participantIds: [VICTIM], stateChanges: resurrection }),
        traceId: 'trace', at: AT,
      });
      const projection = replayWorldEvents(emptyProjection(WORLD_ID), store.committedEvents());
      expect(projection.characterAlive[VICTIM]).toBe(true);
    }
  });

  it('keeps replay consistent after a correction (AC#3)', async () => {
    const store = await seedStore();
    const beforeCorrection = replayWorldEvents(emptyProjection(WORLD_ID), store.committedEvents());
    expect(beforeCorrection.characterAlive[VICTIM]).toBe(false);

    await submitRemediation(createPorts(store).ports, {
      principal: ADMIN,
      request: factRemediation('correction', { participantIds: [VICTIM], stateChanges: resurrection }),
      traceId: 'trace-correction', at: AT,
    });

    const events = store.committedEvents();
    const first = replayWorldEvents(emptyProjection(WORLD_ID), events);
    const second = replayWorldEvents(emptyProjection(WORLD_ID), store.committedEvents());
    // Same accepted log, same projection — the correction is part of history, not an edit.
    expect(second).toEqual(first);
    expect(first.lastSequenceNumber).toBe(1);
    expect(first.characterAlive[VICTIM]).toBe(true);
    // The superseded event is still in the log and still says what it always said.
    expect(events[0].stateChanges).toEqual(deathEvent.stateChanges);
  });

  it('updates the public read model from the corrected history (AC#4)', async () => {
    const store = await seedStore();
    const liveOf = (): ReturnType<typeof buildLiveProjection> => buildLiveProjection({
      worldId: WORLD_ID, acceptedEvents: store.committedEvents(), arcs: [], publishedEpisode: null,
    });
    expect(liveOf().characters).toEqual([{ characterId: VICTIM, locationId: null, alive: false }]);

    const { ports, refreshes } = createPorts(store);
    const result = await submitRemediation(ports, {
      principal: ADMIN,
      request: factRemediation('retcon', {
        participantIds: [VICTIM],
        stateChanges: resurrection,
        publicSummary: 'he-jun survived the mill collapse after all.',
      }),
      traceId: 'trace-retcon', at: AT,
    });

    const live = liveOf();
    expect(live.characters).toEqual([{ characterId: VICTIM, locationId: null, alive: true }]);
    expect(live.recentEvents[0]).toMatchObject({
      eventId: result.eventId, summary: 'he-jun survived the mill collapse after all.',
    });
    expect(live.worldTime).toEqual({ worldDay: 4, timeSlot: 'morning' });
    // The refresh ran through the ordinary post-commit pipeline for this very event.
    expect(refreshes).toEqual([{ worldId: WORLD_ID, sequenceNumber: result.sequenceNumber }]);
    expect(result.refresh.runId).toBe(postCommitRunId(WORLD_ID, result.sequenceNumber));
  });

  it('is safe to retry: a repeated submission returns the original event and audits a no-op', async () => {
    const store = await seedStore();
    const { ports, audits, refreshes } = createPorts(store);
    const request = factRemediation('correction');

    const first = await submitRemediation(ports, { principal: ADMIN, request, traceId: 'trace-1', at: AT });
    const second = await submitRemediation(ports, { principal: ADMIN, request, traceId: 'trace-2', at: AT + 1 });

    expect(second.eventId).toBe(first.eventId);
    expect(second.deduplicated).toBe(true);
    expect(store.committedEvents()).toHaveLength(2);
    expect(audits.map((entry) => entry.outcome)).toEqual(['applied', 'no_op']);
    expect(audits[1].resultCode).toBe('OPS_NO_OP');
    // The retry still re-drives the refresh, which short-circuits on a completed run.
    expect(refreshes).toHaveLength(2);
  });

  it('describes each remediation type with a distinct contract', () => {
    expect(REMEDIATION_POLICY).toEqual({
      correction: { capability: 'canon.correct', supersedesTargets: true, requiresPublicSummary: false },
      compensation: { capability: 'canon.compensate', supersedesTargets: false, requiresPublicSummary: false },
      retcon: { capability: 'canon.retcon', supersedesTargets: true, requiresPublicSummary: true },
    });
  });
});
