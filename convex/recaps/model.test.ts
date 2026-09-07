import { readFileSync } from 'node:fs';
import type { AcceptedEvent } from '../canon/model';
import { CANON_VALIDATION_VERSION } from '../shared/constants';
import { deriveEventId } from '../shared/ids';
import { buildRecapSnapshot, RecapError, validateRecapSnapshot, type RecapSnapshot, type RecapType } from './model';

const accepted = (sequenceNumber: number): AcceptedEvent => ({
  schemaVersion: 1, eventId: deriveEventId('mistwood', sequenceNumber), worldId: 'mistwood', sequenceNumber,
  idempotencyKey: `event-${sequenceNumber}`, proposedBy: { type: 'system' }, worldDay: Math.floor(sequenceNumber / 2) + 1,
  timeSlot: sequenceNumber % 2 === 0 ? 'morning' : 'evening', eventType: 'discovery', participantIds: ['lin-yingxue'],
  causedByEventIds: [], publicSummary: `Accepted development ${sequenceNumber}.`, stateChanges: [{ type: 'fact_created',
    subjectType: 'world', subjectId: 'mistwood', predicate: `development${sequenceNumber}`, value: true, visibility: 'public' }],
  validationVersion: CANON_VALIDATION_VERSION, traceId: `trace-${sequenceNumber}`, acceptedAt: 1_700_000_000_000 + sequenceNumber,
});

const build = (recapType: RecapType, targetId: string, events: AcceptedEvent[], prior: RecapSnapshot | null = null,
  mode: 'incremental' | 'regeneration' = 'incremental'): RecapSnapshot => buildRecapSnapshot({
  id: `${recapType}-${targetId}-v${(prior?.version ?? 0) + 1}`, worldId: 'mistwood', recapType, targetId,
  prior, acceptedEvents: events, mode, generatedAt: 100 + (prior?.version ?? 0),
});

describe('FR-G002 incremental recap pyramid', () => {
  it.each<[RecapType, string]>([
    ['scene', 'scene-1'], ['episode', 'episode-1'], ['arc', 'arc-1'], ['season', 'season-1'], ['viewer_context', 'viewer-default'],
  ])('creates a traceable %s snapshot with every Section 13.11 field', (recapType, targetId) => {
    const events = [accepted(0), accepted(1)];
    const snapshot = build(recapType, targetId, events);
    expect(snapshot).toMatchObject({ id: `${recapType}-${targetId}-v1`, schemaVersion: 1, worldId: 'mistwood',
      recapType, targetId, sourceFromEventId: events[0].eventId, sourceToEventId: events[1].eventId,
      sourceFromSequenceNumber: 0, sourceToSequenceNumber: 1, version: 1, generatedAt: 100 });
    expect(snapshot.content).toContain('Accepted development 0.');
    expect(snapshot.structuredPayload).toEqual({ sourceEventIds: events.map(({ eventId }) => eventId),
      newEventIds: events.map(({ eventId }) => eventId), priorSnapshotId: null, generationMode: 'incremental' });
    expect(validateRecapSnapshot(snapshot, events)).toEqual(snapshot);
  });

  it('updates strictly from the prior snapshot plus only new contiguous Accepted Events', () => {
    const priorEvents = [accepted(0), accepted(1)];
    const prior = build('arc', 'arc-1', priorEvents);
    const newEvents = [accepted(2), accepted(3)];
    const next = build('arc', 'arc-1', newEvents, prior);
    expect(next.version).toBe(2);
    expect(next.sourceFromEventId).toBe(priorEvents[0].eventId);
    expect(next.sourceToEventId).toBe(newEvents[1].eventId);
    expect(next.structuredPayload.newEventIds).toEqual(newEvents.map(({ eventId }) => eventId));
    expect(next.structuredPayload.sourceEventIds).toEqual([...priorEvents, ...newEvents].map(({ eventId }) => eventId));
    expect(next.content).toBe(`${prior.content} Accepted development 2. Accepted development 3.`);
    expect(() => build('arc', 'arc-1', [accepted(3)], prior)).toThrow(/immediately after prior source range/);
    expect(() => validateRecapSnapshot(next, [accepted(0), accepted(1), { ...accepted(2), eventId: 'forged-event' }, accepted(3)]))
      .toThrow(/source range must resolve/);
  });

  it('rejects foreign, proposed-shaped, duplicate, and gapped source ranges', () => {
    expect(() => build('episode', 'e1', [accepted(0), accepted(2)])).toThrow(/contiguous/);
    expect(() => build('episode', 'e1', [accepted(0), accepted(0)])).toThrow(RecapError);
    expect(() => build('episode', 'e1', [{ ...accepted(0), worldId: 'other' }])).toThrow(/Accepted Event/);
    const proposedShape = { ...accepted(0), eventId: '', sequenceNumber: Number.NaN } as AcceptedEvent;
    expect(() => build('episode', 'e1', [proposedShape])).toThrow(/Accepted Event/);
  });

  it('regenerates the complete accepted range as a new version while preserving prior evidence', () => {
    const events = [accepted(0), accepted(1), accepted(2)];
    const prior = build('season', 'season-1', events);
    const regenerated = build('season', 'season-1', events, prior, 'regeneration');
    expect(regenerated).toMatchObject({ version: 2, sourceFromEventId: prior.sourceFromEventId,
      sourceToEventId: prior.sourceToEventId, structuredPayload: { priorSnapshotId: prior.id, generationMode: 'regeneration' } });
    expect(prior.version).toBe(1);
    expect(prior.structuredPayload.priorSnapshotId).toBeNull();
    expect(() => build('season', 'season-1', events.slice(1), prior, 'regeneration')).toThrow(/complete prior Accepted Event range/);
  });

  /**
   * ART-164. The selective contract the arc tier runs on. `docs/post-commit-pipeline.md` recorded
   * arc and season as unreachable precisely because the contiguous rule below rejects a sparse
   * source set, so these are the tests that make the third of the pyramid that was dead legal.
   */
  describe('selective source scope (FR-G002 arc tier)', () => {
    const selective = (
      events: AcceptedEvent[],
      scope: { fromSequenceNumber: number; toSequenceNumber: number },
      prior: RecapSnapshot | null = null,
      mode: 'incremental' | 'regeneration' = 'incremental',
    ): RecapSnapshot => buildRecapSnapshot({
      id: `arc-1-v${(prior?.version ?? 0) + 1}`, worldId: 'mistwood', recapType: 'arc', targetId: 'arc-1',
      prior, acceptedEvents: events, mode, generatedAt: 100 + (prior?.version ?? 0), sourceScope: scope,
    });

    it('accepts a gapped selection and records the range it examined, not just what it found', () => {
      const snapshot = selective([accepted(1), accepted(4)], { fromSequenceNumber: 0, toSequenceNumber: 5 });
      expect(snapshot.sourceScope).toEqual({ fromSequenceNumber: 0, toSequenceNumber: 5 });
      // What was FOUND stays distinguishable from what was LOOKED AT — the whole point of a scope.
      expect(snapshot.structuredPayload.newEventIds).toEqual([accepted(1).eventId, accepted(4).eventId]);
      expect(snapshot.sourceToSequenceNumber).toBe(4);
    });

    it('refuses an event outside the declared scope', () => {
      expect(() => selective([accepted(1), accepted(9)], { fromSequenceNumber: 0, toSequenceNumber: 5 }))
        .toThrow(/outside the declared source scope/);
    });

    it('refuses a selection that repeats or reorders, which no honest selection does', () => {
      expect(() => selective([accepted(4), accepted(1)], { fromSequenceNumber: 0, toSequenceNumber: 5 }))
        .toThrow(/ascend by sequence number/);
      expect(() => selective([accepted(1), accepted(1)], { fromSequenceNumber: 0, toSequenceNumber: 5 }))
        .toThrow(RecapError);
    });

    it('refuses a scope that cannot anchor a cursor', () => {
      expect(() => selective([accepted(1)], { fromSequenceNumber: 5, toSequenceNumber: 1 })).toThrow(/source scope/);
      expect(() => selective([accepted(1)], { fromSequenceNumber: -1, toSequenceNumber: 5 })).toThrow(/source scope/);
    });

    it('checks continuity on the SCOPE, so an arc that was quiet for a stretch still updates', () => {
      const prior = selective([accepted(1)], { fromSequenceNumber: 0, toSequenceNumber: 3 });
      // Nothing of this arc happened at 4..7 except at 7; the events are far from adjacent.
      const next = selective([accepted(7)], { fromSequenceNumber: 4, toSequenceNumber: 8 }, prior);
      expect(next.version).toBe(2);
      // The scope spans everything examined so far: no stretch of canon went unexamined.
      expect(next.sourceScope).toEqual({ fromSequenceNumber: 0, toSequenceNumber: 8 });
      expect(next.structuredPayload.sourceEventIds).toEqual([accepted(1).eventId, accepted(7).eventId]);
    });

    it('refuses a scope gap: an unexamined stretch fails closed rather than passing silently', () => {
      const prior = selective([accepted(1)], { fromSequenceNumber: 0, toSequenceNumber: 3 });
      // Starts at 5, so sequence 4 was never examined by any version of this target.
      expect(() => selective([accepted(7)], { fromSequenceNumber: 5, toSequenceNumber: 8 }, prior))
        .toThrow(/immediately after prior source range/);
    });

    it('refuses a target that changes between contiguous and selective sources', () => {
      const contiguous = build('arc', 'arc-1', [accepted(0), accepted(1)]);
      expect(() => selective([accepted(3)], { fromSequenceNumber: 2, toSequenceNumber: 4 }, contiguous))
        .toThrow(/between contiguous and selective/);
      const sparse = selective([accepted(1)], { fromSequenceNumber: 0, toSequenceNumber: 3 });
      expect(() => build('arc', 'arc-1', [accepted(4)], sparse)).toThrow(/between contiguous and selective/);
    });

    it('regenerates over the complete prior scope, not the events that happened to match', () => {
      const prior = selective([accepted(1), accepted(4)], { fromSequenceNumber: 0, toSequenceNumber: 5 });
      const regenerated = selective([accepted(1), accepted(4)], { fromSequenceNumber: 0, toSequenceNumber: 5 }, prior, 'regeneration');
      expect(regenerated.version).toBe(2);
      expect(regenerated.sourceScope).toEqual({ fromSequenceNumber: 0, toSequenceNumber: 5 });
      // The prior's own event range (1..4) is NOT the range to regenerate over.
      expect(() => selective([accepted(1), accepted(4)], { fromSequenceNumber: 1, toSequenceNumber: 4 }, prior, 'regeneration'))
        .toThrow(/complete prior Accepted Event range/);
    });

    it('leaves the contiguous rule untouched', () => {
      expect(() => build('episode', 'day-1', [accepted(0), accepted(2)])).toThrow(/contiguous/);
      expect(build('episode', 'day-1', [accepted(0), accepted(1)]).sourceScope).toBeNull();
    });
  });

  it('uses bounded Canon range queries, append-only versions, internal APIs, and no Canon mutation', () => {
    const source = readFileSync('convex/recaps/functions.ts', 'utf8');
    expect(source).toContain(".gte('sequenceNumber'");
    expect(source).toContain(".lte('sequenceNumber'");
    expect(source).toContain("query('canonEvents')");
    expect(source).toContain("insert('recapSnapshots'");
    expect(source).toContain('RECAP_IDEMPOTENCY_CONFLICT');
    expect(source).toContain('internalMutation({');
    expect(source).toContain('internalQuery({');
    expect(source).not.toMatch(/insert\('canonEvents'|patch\([^\n]*canonEvents|replace\([^\n]*canonEvents|commitProposedEvent|reduceWorldEvent/);
    expect(source).not.toMatch(/\bmutation\(\{|\bquery\(\{/);
  });
});
