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
  async proposeEvent(input: SimulationInput): Promise<ProposedEvent> {
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw new SimulationProviderError('transient', 'FAKE_TRANSIENT_ONCE', 'transient then succeed');
    }
    return this.inner.proposeEvent(input);
  }
}

describe('executeFoundationRun', () => {
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
