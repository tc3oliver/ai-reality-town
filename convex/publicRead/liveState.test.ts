import type { AcceptedEvent } from '../canon/model';
import {
  ACTIVE_ARC_STATUSES,
  LIVE_PROJECTION_SCHEMA_VERSION,
  LIVE_RECENT_EVENT_DEFAULT,
  buildLiveProjection,
  liveSourceEventIds,
  type LiveArcInput,
  type LivePublishedEpisodeInput,
} from './liveState';

type Change = AcceptedEvent['stateChanges'][number];

function loc(locationId: string, over: Partial<{ name: string; description: string; locationType: string; active: boolean }> = {}): Change {
  return {
    type: 'location_state_changed', locationId,
    name: over.name ?? `name-${locationId}`, description: over.description ?? '',
    locationType: over.locationType ?? 'town', capacity: 10, connectedLocationIds: [], active: over.active ?? true, reason: 'r',
  } as Change;
}
function move(characterId: string, toLocationId: string, fromLocationId = 'loc-0'): Change {
  return { type: 'character_location_changed', characterId, fromLocationId, toLocationId } as Change;
}
function life(characterId: string, alive: boolean): Change {
  return { type: 'character_life_changed', characterId, alive, reason: 'r' } as Change;
}

function liveEvent(over: {
  sequenceNumber: number;
  worldDay?: number;
  timeSlot?: AcceptedEvent['timeSlot'];
  eventId?: string;
  publicSummary?: string | null;
  stateChanges?: Change[];
}): AcceptedEvent {
  return {
    schemaVersion: 1, worldId: 'w1', idempotencyKey: `k${over.sequenceNumber}`,
    proposedBy: { type: 'system' }, worldDay: over.worldDay ?? 1, timeSlot: over.timeSlot ?? 'morning',
    eventType: 'environment', participantIds: [], causedByEventIds: [], publicSummary: over.publicSummary ?? null,
    stateChanges: over.stateChanges ?? [],
    eventId: over.eventId ?? `evt-${over.sequenceNumber}`, acceptedAt: 0, sequenceNumber: over.sequenceNumber,
    validationVersion: 1, traceId: 't',
  } as unknown as AcceptedEvent;
}

describe('buildLiveProjection (AC#1 — derived from accepted events + published scenes)', () => {
  it('derives world time from the latest accepted event', () => {
    const payload = buildLiveProjection({
      worldId: 'w1',
      acceptedEvents: [
        liveEvent({ sequenceNumber: 1, worldDay: 1, timeSlot: 'morning' }),
        liveEvent({ sequenceNumber: 2, worldDay: 1, timeSlot: 'evening' }),
      ],
      arcs: [],
      publishedEpisode: null,
    });
    expect(payload.worldTime).toEqual({ worldDay: 1, timeSlot: 'evening' });
    expect(payload.schemaVersion).toBe(LIVE_PROJECTION_SCHEMA_VERSION);
  });

  it('reduces locations and character positions to their latest state', () => {
    const payload = buildLiveProjection({
      worldId: 'w1',
      acceptedEvents: [
        liveEvent({ sequenceNumber: 1, stateChanges: [loc('loc-1', { name: 'Square' })] }),
        liveEvent({ sequenceNumber: 2, stateChanges: [move('char-a', 'loc-1'), move('char-b', 'loc-2')] }),
        liveEvent({ sequenceNumber: 3, stateChanges: [move('char-a', 'loc-2'), loc('loc-1', { name: 'Square', active: false })] }),
      ],
      arcs: [],
      publishedEpisode: null,
    });
    const square = payload.locations.find((l) => l.locationId === 'loc-1');
    expect(square?.name).toBe('Square');
    expect(square?.active).toBe(false);
    const a = payload.characters.find((c) => c.characterId === 'char-a');
    const b = payload.characters.find((c) => c.characterId === 'char-b');
    expect(a?.locationId).toBe('loc-2'); // latest move wins
    expect(b?.locationId).toBe('loc-2');
    expect(a?.alive).toBe(true); // default alive
  });

  it('tracks life state and defaults characters with no move to no location', () => {
    const payload = buildLiveProjection({
      worldId: 'w1',
      acceptedEvents: [liveEvent({ sequenceNumber: 1, stateChanges: [life('char-a', false)] })],
      arcs: [],
      publishedEpisode: null,
    });
    const a = payload.characters.find((c) => c.characterId === 'char-a');
    expect(a?.alive).toBe(false);
    expect(a?.locationId).toBeNull();
  });

  it('returns the most recent N events in reverse chronological order', () => {
    const events = Array.from({ length: LIVE_RECENT_EVENT_DEFAULT + 5 }, (_, index) =>
      liveEvent({ sequenceNumber: index + 1, publicSummary: `s${index + 1}` }));
    const payload = buildLiveProjection({ worldId: 'w1', acceptedEvents: events, arcs: [], publishedEpisode: null });
    expect(payload.recentEvents).toHaveLength(LIVE_RECENT_EVENT_DEFAULT);
    expect(payload.recentEvents[0].eventId).toBe(`evt-${events.length}`);
    expect(payload.recentEvents[0].summary).toBe(`s${events.length}`);
    expect(liveSourceEventIds(payload)).toEqual(payload.recentEvents.map((e) => e.eventId));
  });

  it('keeps only active arcs and projects their public fields', () => {
    const arcs: LiveArcInput[] = [
      { arcId: 'arc-1', title: 'Feud', currentQuestion: 'Who backs down?', status: 'active' },
      { arcId: 'arc-2', title: 'Old', currentQuestion: 'done?', status: 'resolved' },
      { arcId: 'arc-3', title: 'Storm', currentQuestion: 'When?', status: 'escalating' },
    ];
    const payload = buildLiveProjection({ worldId: 'w1', acceptedEvents: [], arcs, publishedEpisode: null });
    expect(payload.activeArcs.map((a) => a.arcId)).toEqual(['arc-1', 'arc-3']);
    expect(ACTIVE_ARC_STATUSES).not.toContain('resolved');
  });

  it('sources active scenes + status from the published episode', () => {
    const publishedEpisode: LivePublishedEpisodeInput = {
      status: 'ready',
      keyScenes: [{ title: 'Scene 1', summary: 'A tense meeting.', sourceEventIds: ['evt-1'] }],
    };
    const payload = buildLiveProjection({ worldId: 'w1', acceptedEvents: [], arcs: [], publishedEpisode });
    expect(payload.activeScenes).toEqual([{ title: 'Scene 1', summary: 'A tense meeting.', sourceEventIds: ['evt-1'] }]);
    expect(payload.publishedEpisodeStatus).toBe('ready');
  });

  it('reports no published episode when none is supplied', () => {
    const payload = buildLiveProjection({ worldId: 'w1', acceptedEvents: [], arcs: [], publishedEpisode: null });
    expect(payload.activeScenes).toEqual([]);
    expect(payload.publishedEpisodeStatus).toBe('none');
    expect(payload.worldTime).toBeNull();
  });

  it('is idempotent: identical inputs yield an identical payload (AC#2/#4 retry safety)', () => {
    const input = {
      worldId: 'w1',
      acceptedEvents: [liveEvent({ sequenceNumber: 1, stateChanges: [move('char-a', 'loc-1')], publicSummary: 's1' })],
      arcs: [{ arcId: 'arc-1', title: 'T', currentQuestion: 'Q?', status: 'active' }] as LiveArcInput[],
      publishedEpisode: null as LivePublishedEpisodeInput | null,
    };
    expect(buildLiveProjection(input)).toEqual(buildLiveProjection(input));
  });

  it('keeps every pre-existing field and defaults dynamic to null when none is supplied (ART-115)', () => {
    const payload = buildLiveProjection({
      worldId: 'w1',
      acceptedEvents: [liveEvent({ sequenceNumber: 1, stateChanges: [move('char-a', 'loc-1')] })],
      arcs: [{ arcId: 'arc-1', title: 'T', currentQuestion: 'Q?', status: 'active' }],
      publishedEpisode: { status: 'ready', keyScenes: [{ title: 't', summary: 's', sourceEventIds: ['evt-1'] }] },
    });
    expect(Object.keys(payload).sort()).toEqual([
      'activeArcs', 'activeScenes', 'characters', 'dynamic', 'locations',
      'publishedEpisodeStatus', 'recentEvents', 'schemaVersion', 'worldId', 'worldTime',
    ]);
    expect(payload.dynamic).toBeNull();
    expect(payload.schemaVersion).toBe(2);
  });

  it('nests a supplied dynamic projection without disturbing the semantic character list', () => {
    const dynamic = {
      worldId: 'w1', mapId: 'map-1', runtimeVersion: 1, snapshotSequence: 2, updatedAt: 10,
      worldStatus: 'running' as const,
      characters: [{
        characterId: 'char-a', semanticLocationId: 'loc-1', motionType: 'canon' as const,
        motionSequence: 2, from: { x: 0, y: 0 }, to: { x: 1, y: 1 },
        startedAt: 10, arriveAt: 20, animationState: 'walking' as const, direction: 'right' as const,
      }],
      activeScenes: [],
    };
    const payload = buildLiveProjection({
      worldId: 'w1',
      acceptedEvents: [liveEvent({ sequenceNumber: 1, stateChanges: [move('char-a', 'loc-1')] })],
      arcs: [],
      publishedEpisode: null,
      dynamic,
    });
    expect(payload.dynamic).toEqual(dynamic);
    expect(payload.characters).toEqual([{ characterId: 'char-a', locationId: 'loc-1', alive: true }]);
  });

  it('rejects an accepted event whose worldId does not match', () => {
    const foreign = { ...liveEvent({ sequenceNumber: 1 }), worldId: 'other' } as unknown as AcceptedEvent;
    expect(() => buildLiveProjection({ worldId: 'w1', acceptedEvents: [foreign], arcs: [], publishedEpisode: null })).toThrow();
  });
});
