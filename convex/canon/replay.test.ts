import { replayWorldEvents } from './replay';
import { buildSnapshot, cloneProjection, replayFromSnapshot } from './snapshots';
import { isCanonError } from '../shared/errors';
import { emptyProjection, type AcceptedEvent, type WorldProjection } from './model';
import {
  mistwoodEvents,
  mistwoodEventsAfterSnapshot,
  mistwoodFullProjection,
  mistwoodInitialProjection,
  mistwoodSnapshot,
} from './mistwoodFixture';

describe('replayWorldEvents', () => {
  it('produces identical output for identical input (determinism)', () => {
    const a = replayWorldEvents(mistwoodInitialProjection, mistwoodEvents);
    const b = replayWorldEvents(mistwoodInitialProjection, mistwoodEvents);
    expect(a).toEqual(b);
    expect(a).toEqual(mistwoodFullProjection);
  });

  it('enforces event ordering (out-of-order fails)', () => {
    const [e0, e1] = mistwoodEvents;
    expect(() => replayWorldEvents(mistwoodInitialProjection, [e1, e0])).toThrow();
  });

  it('rejects a duplicate sequence', () => {
    const [e0] = mistwoodEvents;
    try {
      replayWorldEvents(mistwoodInitialProjection, [e0, e0]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(isCanonError(e) && e.error.code).toBe('DUPLICATE_SEQUENCE');
    }
  });

  it('rejects a sequence gap', () => {
    // Skip sequence 1 by dropping the second event.
    const events = [mistwoodEvents[0], mistwoodEvents[2]];
    try {
      replayWorldEvents(mistwoodInitialProjection, events);
      throw new Error('should have thrown');
    } catch (e) {
      expect(isCanonError(e) && e.error.code).toBe('SEQUENCE_GAP');
    }
  });

  it('preserves the projection for an empty event list', () => {
    const result = replayWorldEvents(mistwoodInitialProjection, []);
    expect(result).toEqual(mistwoodInitialProjection);
  });

  it('does not mutate the input events', () => {
    const snapshot = JSON.parse(JSON.stringify(mistwoodEvents)) as AcceptedEvent[];
    replayWorldEvents(mistwoodInitialProjection, mistwoodEvents);
    expect(mistwoodEvents).toEqual(snapshot);
  });
});

describe('snapshots', () => {
  it('replays from a snapshot to the same result as a full replay', () => {
    const fromSnapshot = replayFromSnapshot(mistwoodSnapshot, mistwoodEventsAfterSnapshot);
    expect(fromSnapshot).toEqual(mistwoodFullProjection);
  });

  it('buildSnapshot stores a clone, not a reference to the projection', () => {
    const projection: WorldProjection = {
      ...emptyProjection('w'),
      characterLocations: { a: 'l' },
      facts: [{ subjectType: 'character', subjectId: 'a', predicate: 'p', value: 1, visibility: 'canon', sourceEventId: 'e' }],
    };
    const snap = buildSnapshot(projection, 123);
    // Mutate the original after snapshotting.
    projection.characterLocations.a = 'changed';
    projection.facts.push({ subjectType: 'world', subjectId: 'w', predicate: 'x', value: true, visibility: 'canon', sourceEventId: 'e2' });
    expect(snap.projection.characterLocations.a).toBe('l');
    expect(snap.projection.facts).toHaveLength(1);
    expect(snap.lastSequenceNumber).toBe(projection.lastSequenceNumber - 0); // unchanged by mutation
  });

  it('cloneProjection produces an equal but independent copy', () => {
    const original = mistwoodFullProjection;
    const clone = cloneProjection(original);
    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
    expect(clone.facts).not.toBe(original.facts);
  });

  it('rejects an inconsistent snapshot (mismatched projection worldId)', () => {
    const bad = { ...mistwoodSnapshot, worldId: 'other-world' } as typeof mistwoodSnapshot;
    try {
      replayFromSnapshot(bad, [] as AcceptedEvent[]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(isCanonError(e)).toBe(true);
    }
  });
});
