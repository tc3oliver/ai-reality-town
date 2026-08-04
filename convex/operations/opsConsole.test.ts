import {
  decideSlotCancellation,
  OpsConsoleError,
  summarizeQueue,
  summarizeWorldState,
  type CancellableRun,
  type CancellableSlot,
} from './opsConsole';

function slot(over: Partial<CancellableSlot> = {}): CancellableSlot {
  return { slotKey: 'mistwood:1:morning', worldId: 'mistwood', status: 'queued', ...over };
}

describe('decideSlotCancellation — cancellable pre-commit state', () => {
  it.each(['queued', 'failed'] as const)('cancels a %s slot that committed nothing', (status) => {
    expect(decideSlotCancellation(slot({ status }))).toEqual({ action: 'cancel', resultCode: 'OPS_SLOT_CANCELLED' });
  });

  it('cancels a failed slot even when a failed world-day run exists (no Canon was written)', () => {
    const runs: CancellableRun[] = [{ runId: 'r1', status: 'failed' }];
    expect(decideSlotCancellation(slot({ status: 'failed' }), runs).action).toBe('cancel');
  });

  it('is idempotent: re-cancelling is a recorded no-op, not an error', () => {
    expect(decideSlotCancellation(slot({ status: 'cancelled' })))
      .toEqual({ action: 'none', resultCode: 'OPS_SLOT_ALREADY_CANCELLED' });
  });
});

describe('decideSlotCancellation — never touches accepted Canon', () => {
  it('refuses a slot that already committed an event', () => {
    expect(() => decideSlotCancellation(slot({ status: 'failed', committedEventId: 'evt-9' })))
      .toThrow(/OPS_SLOT_COMMITTED/);
  });

  it('refuses a completed slot', () => {
    expect(() => decideSlotCancellation(slot({ status: 'completed' }))).toThrow(/OPS_SLOT_COMMITTED/);
  });

  it('refuses when a world-day run for the slot completed, even if the queue row looks uncommitted', () => {
    // The queue row is not the authority on what Canon accepted.
    const runs: CancellableRun[] = [{ runId: 'r1', status: 'completed' }];
    expect(() => decideSlotCancellation(slot({ status: 'queued' }), runs)).toThrow(/OPS_SLOT_COMMITTED/);
  });

  it('refuses when a run recorded committed event ids while still marked running', () => {
    const runs: CancellableRun[] = [{ runId: 'r1', status: 'running', committedEventIds: ['evt-1'] }];
    expect(() => decideSlotCancellation(slot({ status: 'queued' }), runs)).toThrow(/OPS_SLOT_COMMITTED/);
  });

  it('checks the Canon guard before the status guard, so a committed running slot reports commitment', () => {
    expect(() => decideSlotCancellation(slot({ status: 'running', committedEventId: 'evt-3' })))
      .toThrow(/OPS_SLOT_COMMITTED/);
  });
});

describe('decideSlotCancellation — running slots', () => {
  it('refuses to interrupt a running slot', () => {
    let thrown: unknown;
    try {
      decideSlotCancellation(slot({ status: 'running' }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OpsConsoleError);
    expect((thrown as OpsConsoleError).code).toBe('OPS_SLOT_RUNNING');
  });
});

describe('summarizeQueue', () => {
  it('counts every status including the ones with no rows', () => {
    expect(summarizeQueue([
      { status: 'queued' }, { status: 'queued' }, { status: 'running' },
      { status: 'completed' }, { status: 'cancelled' },
    ])).toEqual({ queued: 2, running: 1, completed: 1, failed: 0, cancelled: 1 });
  });

  it('returns an all-zero summary for an empty queue', () => {
    expect(summarizeQueue([])).toEqual({ queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 });
  });
});

describe('summarizeWorldState', () => {
  const projection = {
    worldId: 'mistwood',
    lastSequenceNumber: 42,
    characterAlive: { ava: true, ben: true, cara: false },
    itemOwners: { camera: 'ava' },
    facts: [{}, {}, {}],
    worldEnvironment: { weather: {}, season: {} },
    locations: { station: {}, clinic: {} },
    organizations: { guild: {} },
    // Private content deliberately present in the input so the test proves it is dropped.
    characterKnowledge: { ava: [{ belief: 'a hidden secret' }] },
    characterMemories: { ava: [{ text: 'a private memory' }] },
  };

  it('reports operational counts and the sequence cursor', () => {
    expect(summarizeWorldState(projection)).toEqual({
      worldId: 'mistwood', lastSequenceNumber: 42,
      characterCount: 3, aliveCharacterCount: 2,
      locationCount: 2, organizationCount: 1, trackedItemCount: 1,
      factCount: 3, environmentPredicateCount: 2,
    });
  });

  it('never surfaces private knowledge, memories, or prompts (NFR-005)', () => {
    const serialized = JSON.stringify(summarizeWorldState(projection));
    expect(serialized).not.toContain('hidden secret');
    expect(serialized).not.toContain('private memory');
    expect(serialized).not.toContain('characterKnowledge');
    expect(serialized).not.toContain('characterMemories');
  });
});
