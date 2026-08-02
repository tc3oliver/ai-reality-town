import { executeFoundationRun, MAX_PROVIDER_ATTEMPTS } from './workflow';
import { commitProposedEvent } from '../canon/commit';
import { InMemoryCanonStore } from '../canon/inMemoryStore';
import { isValidTransition, isTerminalRunStatus } from './runState';
import { SimulationProviderError, type SimulationProvider } from './provider';
import { FakeSimulationProvider } from './fakeProvider';
import type { SimulationInput } from './model';
import type { ProposedEvent } from '../canon/model';

function baseInput(over: Partial<SimulationInput>): SimulationInput {
  return {
    seed: 20260803,
    worldId: 'w1',
    worldDay: 1,
    timeSlot: 'morning',
    idempotencyKey: 'k1',
    traceId: 't1',
    scenario: 'success',
    proposedBy: { type: 'character', id: 'a' },
    characterId: 'a',
    fromLocationId: 'loc-1',
    toLocationId: 'loc-2',
    partnerCharacterId: 'b',
    ...over,
  };
}

/** A provider that throws a transient error on the first N calls, then succeeds. */
class FlakyThenSuccessProvider implements SimulationProvider {
  readonly name = 'fake' as const;
  private remainingFailures: number;
  private readonly inner: SimulationProvider;
  constructor(failTimes: number, inner: SimulationProvider) {
    this.remainingFailures = failTimes;
    this.inner = inner;
  }
  async proposeEvent(input: SimulationInput): Promise<unknown> {
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw new SimulationProviderError('transient', 'FAKE_TRANSIENT_ONCE', 'transient then succeed');
    }
    return this.inner.proposeEvent(input);
  }
}

describe('executeFoundationRun', () => {
  it('normalizes unknown structured provider output before commit', async () => {
    const input = baseInput({});
    const raw = await new FakeSimulationProvider().proposeEvent(input);
    const wireOutput = JSON.parse(JSON.stringify(raw)) as unknown;
    let committed: ProposedEvent | null = null;
    const outcome = await executeFoundationRun(input, {
      propose: () => Promise.resolve(wireOutput),
      commit: (proposed) => {
        committed = proposed;
        return Promise.resolve({ eventId: 'event-1', sequenceNumber: 0, deduplicated: false });
      },
    });
    expect(outcome.status).toBe('completed');
    expect(committed).toEqual(raw);
    expect(committed).not.toBe(wireOutput);
  });

  it('does not call commit when provider output fails normalization', async () => {
    const raw = await new FakeSimulationProvider().proposeEvent(baseInput({}));
    let commitCalls = 0;
    const outcome = await executeFoundationRun(baseInput({}), {
      propose: () => Promise.resolve({ ...raw, vendorPayload: true }),
      commit: () => { commitCalls += 1; return Promise.resolve({ eventId: 'never', sequenceNumber: 0, deduplicated: false }); },
    });
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'INVALID_EVENT_SHAPE' });
    expect(commitCalls).toBe(0);
  });

  it('moves a successful run to completed and references the committed event', async () => {
    const store = new InMemoryCanonStore();
    const provider = new FakeSimulationProvider();
    const outcome = await executeFoundationRun(baseInput({}), {
      propose: (i) => provider.proposeEvent(i),
      commit: (proposed, traceId) => commitProposedEvent(store, { proposed, traceId }),
    });
    expect(outcome.status).toBe('completed');
    expect(outcome.eventId).toBeDefined();
    // The committed event in the store matches the run's referenced event.
    expect(store.committedEvents()).toHaveLength(1);
    expect(store.committedEvents()[0].eventId).toBe(outcome.eventId);
  });

  it('marks a failed provider run as failed without committing', async () => {
    const store = new InMemoryCanonStore();
    const provider = new FakeSimulationProvider();
    const outcome = await executeFoundationRun(baseInput({ scenario: 'permanent_failure' }), {
      propose: (i) => provider.proposeEvent(i),
      commit: (proposed, traceId) => commitProposedEvent(store, { proposed, traceId }),
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.errorCode).toBe('FAKE_PERMANENT');
    expect(store.committedEvents()).toHaveLength(0);
  });

  it('retries a transient failure then succeeds without duplicating the canon event', async () => {
    const store = new InMemoryCanonStore();
    const flaky = new FlakyThenSuccessProvider(1, new FakeSimulationProvider());
    const outcome = await executeFoundationRun(baseInput({}), {
      propose: (i) => flaky.proposeEvent(i),
      commit: (proposed, traceId) => commitProposedEvent(store, { proposed, traceId }),
    });
    expect(outcome.status).toBe('completed');
    expect(outcome.attempts).toBe(2); // 1 failed + 1 success
    // Exactly one event committed despite the retry.
    expect(store.committedEvents()).toHaveLength(1);
  });

  it('gives up after the max attempts on a persistent transient failure', async () => {
    const store = new InMemoryCanonStore();
    const provider = new FakeSimulationProvider();
    const outcome = await executeFoundationRun(baseInput({ scenario: 'transient_failure' }), {
      propose: (i) => provider.proposeEvent(i),
      commit: (proposed, traceId) => commitProposedEvent(store, { proposed, traceId }),
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.errorCode).toBe('FAKE_TRANSIENT');
    expect(outcome.attempts).toBe(MAX_PROVIDER_ATTEMPTS);
  });

  it('surfaces canon validation failures with a stable error code', async () => {
    const store = new InMemoryCanonStore();
    const provider = new FakeSimulationProvider();
    const outcome = await executeFoundationRun(baseInput({ scenario: 'canon_failure' }), {
      propose: (i) => provider.proposeEvent(i),
      commit: (proposed, traceId) => commitProposedEvent(store, { proposed, traceId }),
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.errorCode).toBe('INVALID_RELATIONSHIP_TARGET');
    expect(outcome.errorPath).toBe('stateChanges[0]');
    expect(outcome.errorDetails).toBeUndefined();
  });
});

describe('run-state machine', () => {
  it('allows pending → running → completed', () => {
    expect(isValidTransition('pending', 'running')).toBe(true);
    expect(isValidTransition('running', 'completed')).toBe(true);
  });

  it('forbids transitions out of terminal states', () => {
    expect(isTerminalRunStatus('completed')).toBe(true);
    expect(isTerminalRunStatus('failed')).toBe(true);
    expect(isValidTransition('completed', 'running')).toBe(false);
    expect(isValidTransition('failed', 'running')).toBe(false);
  });
});
