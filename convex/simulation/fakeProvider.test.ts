import { jest } from '@jest/globals';
import { FakeSimulationProvider } from './fakeProvider';
import { SimulationProviderError, isTransientProviderError } from './provider';
import type { SimulationInput } from './model';

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

describe('FakeSimulationProvider', () => {
  it('produces the same proposal for the same input (determinism)', async () => {
    const provider = new FakeSimulationProvider();
    const input = baseInput({});
    const a = await provider.proposeEvent(input);
    const b = await provider.proposeEvent(input);
    expect(a).toEqual(b);
    expect(a.stateChanges).toHaveLength(1);
    expect(a.eventType).toBe('movement');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('uses the fixed seed deterministically without clock, randomness, network, or credentials', async () => {
    const provider = new FakeSimulationProvider();
    const now = jest.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock accessed'); });
    const random = jest.spyOn(Math, 'random').mockImplementation(() => { throw new Error('randomness accessed'); });
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('network accessed'); });
    const previousKey = process.env.LLM_API_KEY;
    delete process.env.LLM_API_KEY;
    try {
      const a = await provider.proposeEvent(baseInput({ seed: 7 }));
      const b = await provider.proposeEvent(baseInput({ seed: 7 }));
      const other = await provider.proposeEvent(baseInput({ seed: 8 }));
      expect(a).toEqual(b);
      expect(a.publicSummary).not.toBe(other.publicSummary);
    } finally {
      if (previousKey === undefined) delete process.env.LLM_API_KEY;
      else process.env.LLM_API_KEY = previousKey;
      now.mockRestore();
      random.mockRestore();
      fetch.mockRestore();
    }
  });

  it('rejects a non-integer seed with a stable permanent error', async () => {
    await expect(new FakeSimulationProvider().proposeEvent(baseInput({ seed: 1.5 }))).rejects.toMatchObject({
      code: 'FAKE_INVALID_SEED',
      kind: 'permanent',
    });
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
