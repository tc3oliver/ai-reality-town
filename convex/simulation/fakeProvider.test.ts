import { FakeSimulationProvider } from './fakeProvider';
import { SimulationProviderError, isTransientProviderError } from './provider';
import type { SimulationInput } from './model';

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

describe('FakeSimulationProvider', () => {
  it('produces the same proposal for the same input (determinism)', async () => {
    const provider = new FakeSimulationProvider();
    const input = baseInput({});
    const a = await provider.proposeEvent(input);
    const b = await provider.proposeEvent(input);
    expect(a).toEqual(b);
    expect(a.stateChanges).toHaveLength(1);
    expect(a.eventType).toBe('movement');
  });

  it('throws a transient failure for the transient_failure scenario', async () => {
    const provider = new FakeSimulationProvider();
    await expect(provider.proposeEvent(baseInput({ scenario: 'transient_failure' }))).rejects.toThrow(
      SimulationProviderError,
    );
    try {
      await provider.proposeEvent(baseInput({ scenario: 'transient_failure' }));
    } catch (e) {
      expect(e instanceof SimulationProviderError && e.kind).toBe('transient');
      expect(isTransientProviderError(e)).toBe(true);
    }
  });

  it('throws a permanent failure for the permanent_failure scenario', async () => {
    const provider = new FakeSimulationProvider();
    await expect(provider.proposeEvent(baseInput({ scenario: 'permanent_failure' }))).rejects.toThrow(
      SimulationProviderError,
    );
    try {
      await provider.proposeEvent(baseInput({ scenario: 'permanent_failure' }));
    } catch (e) {
      expect(e instanceof SimulationProviderError && e.kind).toBe('permanent');
      expect(isTransientProviderError(e)).toBe(false);
    }
  });

  it('produces a structurally invalid event for the invalid_event scenario', async () => {
    const provider = new FakeSimulationProvider();
    const proposed = await provider.proposeEvent(baseInput({ scenario: 'invalid_event' }));
    // Empty stateChanges — the commit pipeline must reject this.
    expect((proposed as { stateChanges: unknown[] }).stateChanges).toHaveLength(0);
  });

  it('produces a canon-invalid event for the canon_failure scenario', async () => {
    const provider = new FakeSimulationProvider();
    const proposed = await provider.proposeEvent(baseInput({ scenario: 'canon_failure' }));
    const change = (proposed.stateChanges[0] as { type: string; sourceCharacterId?: string; targetCharacterId?: string });
    expect(change.type).toBe('relationship_changed');
    // Self-relationship is the deliberate canon violation.
    expect(change.sourceCharacterId).toBe(change.targetCharacterId);
  });
});
