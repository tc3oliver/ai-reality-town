/**
 * ART-100 AC#3 — the Live rebuild's incremental path must publish the SAME BYTES as the full
 * replay it replaced.
 *
 * `rebuildLiveProjection` no longer reads the world's accepted-event log. It resumes four folds
 * from a checkpoint, ranks scenes off a maintained index, and hands the pure builders a scoped
 * subset of events. Every one of those is a claim that something smaller is sufficient, and every
 * one of them is wrong in a way that would show up as a quietly different published payload rather
 * than as an error. So each is held against the whole-log answer here.
 *
 * Two habits this file keeps deliberately, both of which this task has already been caught by:
 *
 *  - **Every split point, not one.** A checkpoint property asserted at a single convenient
 *    boundary survives an off-by-one in the cursor. These loop over all of them.
 *  - **Non-empty before equal.** An earlier ART-100 test asserted `{}` equalled `{}` because its
 *    fixture never produced the field the commit was about. Each comparison below first asserts
 *    the thing being compared is actually there.
 */

import { MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import type { AcceptedEvent } from '../canon/model';
import { mistwoodRuntimeContext } from '../visualRuntime/mistwoodRuntime';
import { resolvePublishableLocationZone } from '../visual/locationVisualBinding';
import { selectAmbientAnchor } from '../visualRuntime/ambientAnchor';
import { timeBucketForSlot } from '../visualRuntime/seededRandom';
import {
  bindingsFingerprint,
  collectLocationFacts,
  emptyCharacterMotionFold,
  foldCharacterMotion,
  planCharacterTrajectories,
} from '../visualRuntime/visualSyncPlanner';
import { buildActiveScenePresentations, groupSceneEvents } from './activeScenePresentation';
import {
  deserializeLiveFold,
  emptyLiveFold,
  foldLiveEvents,
  serializeLiveFold,
} from './liveFold';
import { buildLiveProjection } from './liveState';
import {
  candidateLocationFold,
  candidateToGroup,
  foldSceneCandidates,
  sceneIdsOfEvents,
  type SceneCandidate,
} from './liveSceneIndex';
import {
  REPLAY_MAX_SCENES,
  buildVisualReplay,
  foldReplayPositions,
  type ReplayEventLike,
  sceneIdOf,
  selectReplayGroups,
} from './visualReplay';

const WORLD_ID = MISTWOOD_PUBLIC_WORLD_ID;

/** Real bound zones, so the anchor chain resolves rather than reporting unbound problems. */
const RUNTIME = mistwoodRuntimeContext();
const ZONES = RUNTIME.bindings.map((binding) => binding.locationId);

type Change = Record<string, unknown> & { type: string };

function event(args: {
  sequenceNumber: number;
  worldDay: number;
  timeSlot: string;
  locationId?: string;
  participantIds?: string[];
  publicSummary?: string;
  changes?: Change[];
}): AcceptedEvent {
  return {
    schemaVersion: 1,
    worldId: WORLD_ID,
    idempotencyKey: `event-${args.sequenceNumber}`,
    proposedBy: { type: 'system' },
    worldDay: args.worldDay,
    timeSlot: args.timeSlot,
    eventType: 'conversation',
    participantIds: args.participantIds ?? [],
    causedByEventIds: [],
    stateChanges: args.changes ?? [],
    eventId: `${WORLD_ID}#event#${args.sequenceNumber}`,
    sequenceNumber: args.sequenceNumber,
    acceptedAt: 1_000 + args.sequenceNumber,
    validationVersion: 'canon-v1',
    traceId: `trace-${args.sequenceNumber}`,
    ...(args.locationId === undefined ? {} : { locationId: args.locationId }),
    ...(args.publicSummary === undefined ? {} : { publicSummary: args.publicSummary }),
  } as unknown as AcceptedEvent;
}

const move = (characterId: string, from: string, to: string): Change => ({
  type: 'character_location_changed', characterId, fromLocationId: from, toLocationId: to,
});

/**
 * A world that exercises every structure the rebuild folds: several days and slots, several
 * locations, characters that move more than once (so the anchor chain has intermediate hops), a
 * location description, a life change, an `active` flag, and an event with no resolvable
 * location at all (which the scene index must drop while still folding its arrival).
 */
function fixtureEvents(): AcceptedEvent[] {
  const [a, b, c] = ZONES;
  return [
    event({ sequenceNumber: 0, worldDay: 0, timeSlot: 'morning', locationId: a, participantIds: ['wu-zhen'],
      publicSummary: 'day 0 morning', changes: [move('wu-zhen', b, a), { type: 'location_state_changed', locationId: a, name: 'A', description: 'a', locationType: 'square', active: true }] }),
    event({ sequenceNumber: 1, worldDay: 0, timeSlot: 'afternoon', locationId: b, participantIds: ['wu-zhen', 'lin-yue'],
      publicSummary: 'day 0 afternoon', changes: [move('wu-zhen', a, b), move('lin-yue', c, b)] }),
    event({ sequenceNumber: 2, worldDay: 1, timeSlot: 'morning', locationId: c, participantIds: ['lin-yue'],
      publicSummary: 'day 1 morning', changes: [move('lin-yue', b, c), { type: 'character_life_changed', characterId: 'ghost', alive: false }] }),
    // No `locationId` and no arrival: unplaceable, so it belongs to no scene at all.
    event({ sequenceNumber: 3, worldDay: 1, timeSlot: 'afternoon', participantIds: ['wu-zhen'],
      publicSummary: 'unplaceable', changes: [{ type: 'character_state_changed', characterId: 'shen', field: 'active', toValue: false }] }),
    event({ sequenceNumber: 4, worldDay: 1, timeSlot: 'evening', locationId: a, participantIds: ['wu-zhen'],
      publicSummary: 'day 1 evening', changes: [move('wu-zhen', b, a)] }),
    event({ sequenceNumber: 5, worldDay: 2, timeSlot: 'morning', locationId: b, participantIds: ['wu-zhen', 'lin-yue'],
      publicSummary: 'day 2 morning', changes: [move('wu-zhen', a, b)] }),
  ];
}

const MEMBERSHIPS = [
  { sourceEventSequenceNumber: 1, arcIds: ['arc-1'], importance: 0.9 },
  { sourceEventSequenceNumber: 2, arcIds: ['arc-1'], importance: 0.4 },
  { sourceEventSequenceNumber: 4, arcIds: ['arc-2'], importance: 0.7 },
];
const importanceOf = (sequenceNumber: number): number =>
  MEMBERSHIPS.find((m) => m.sourceEventSequenceNumber === sequenceNumber)?.importance ?? 0;

/** Fold the whole log in one call — the answer every incremental path must reproduce. */
function fullSceneIndex(events: readonly AcceptedEvent[]): Map<string, SceneCandidate> {
  return foldSceneCandidates({
    prior: new Map(), events, priorPositions: new Map(), importanceOf,
  }).touched;
}

describe('ART-100 — the scene index reproduces a whole-log fold', () => {
  it('folding a prefix then the rest equals folding the whole log, at EVERY split point', () => {
    const events = fixtureEvents();
    const expected = fullSceneIndex(events);
    // Non-vacuity first: there really are scenes, and the unplaceable event really was dropped.
    expect(expected.size).toBeGreaterThan(1);
    expect([...expected.values()].flatMap((c) => c.eventSequenceNumbers)).not.toContain(3);

    for (let split = 0; split <= events.length; split += 1) {
      const head = foldSceneCandidates({
        prior: new Map(), events: events.slice(0, split), priorPositions: new Map(), importanceOf,
      });
      const tail = foldSceneCandidates({
        // Only the scenes the tail touches are supplied, exactly as the handler supplies them.
        prior: new Map([...head.touched].filter(([id]) =>
          sceneIdsOfEvents(events.slice(split)).includes(id))),
        events: events.slice(split),
        priorPositions: head.positions,
        importanceOf,
      });
      const merged = new Map([...head.touched, ...tail.touched]);
      expect([...merged.entries()].sort()).toEqual([...expected.entries()].sort());
    }
  });

  it('re-folding a tail it has already seen does not list an event twice', () => {
    // An operator re-running the rebuild replays events the index already holds. A candidate that
    // listed one twice would hand the replay builder a duplicated event, and `assertUniqueIds`
    // would reject the whole payload.
    const events = fixtureEvents();
    const once = fullSceneIndex(events);
    const twice = foldSceneCandidates({
      prior: once, events, priorPositions: new Map(), importanceOf,
    }).touched;
    for (const [sceneId, candidate] of twice) {
      expect(candidate.eventSequenceNumbers)
        .toEqual(once.get(sceneId)?.eventSequenceNumbers);
    }
  });

  /**
   * The rank index is `[worldId, score, maxSequenceNumber]`, and it stands in for a comparator
   * whose third key is `sceneId`. That substitution is only exact because no two scenes can share
   * a `maxSequenceNumber` — each is the sequence number of one of the scene's own events, and an
   * event belongs to exactly one scene. Pinned, because if it ever stopped holding the index would
   * order two scenes arbitrarily and the published replay would change without warning.
   */
  it('no two scenes share a maxSequenceNumber, which is what makes the rank index exact', () => {
    const candidates = [...fullSceneIndex(fixtureEvents()).values()];
    const maxima = candidates.map((candidate) => candidate.maxSequenceNumber);
    expect(new Set(maxima).size).toBe(maxima.length);
    expect(maxima.length).toBeGreaterThan(1);
  });

  it('ranks scenes the way selectReplayGroups does', () => {
    const events = fixtureEvents();
    const candidates = [...fullSceneIndex(events).values()];
    const latest = events[events.length - 1];
    const groups = groupSceneEvents(events);

    // The index order: score desc, then maxSequenceNumber desc — what `.order('desc')` yields.
    const indexOrder = [...candidates]
      .sort((left, right) => right.score - left.score || right.maxSequenceNumber - left.maxSequenceNumber)
      .filter((candidate) => !(candidate.worldDay === latest.worldDay && candidate.timeSlot === latest.timeSlot))
      .slice(0, REPLAY_MAX_SCENES)
      .map((candidate) => candidate.sceneId);

    const builderOrder = selectReplayGroups(groups, latest, new Map(
      MEMBERSHIPS.map((m) => [m.sourceEventSequenceNumber, m.importance]),
    )).map(sceneIdOf);

    expect(indexOrder.length).toBeGreaterThan(0);
    // Compared as sets: `selectReplayGroups` re-sorts its winners chronologically afterwards, so
    // the two lists agree on WHICH scenes, which is the property the index is responsible for.
    expect([...indexOrder].sort()).toEqual([...builderOrder].sort());
  });
});

describe('ART-100 — the replay builds identically from a selection', () => {
  const replayInput = (events: readonly ReplayEventLike[]) => ({
    worldId: WORLD_ID,
    acceptedEvents: events,
    arcMemberships: MEMBERSHIPS,
    excludedCharacterIds: new Set<string>(),
    runtime: RUNTIME,
    episodes: [],
    publicationRecords: new Map(),
  });

  it('publishes byte-identical payloads whether it ranks the log itself or is handed the winners', () => {
    const events = fixtureEvents();
    const fromWholeLog = buildVisualReplay(replayInput(events));
    expect(fromWholeLog).not.toBeNull();
    expect(fromWholeLog?.scenes.length).toBeGreaterThan(0);

    const candidates = [...fullSceneIndex(events).values()];
    const latest = events[events.length - 1];
    const selected = [...candidates]
      .sort((left, right) => right.score - left.score || right.maxSequenceNumber - left.maxSequenceNumber)
      .filter((candidate) => !(candidate.worldDay === latest.worldDay && candidate.timeSlot === latest.timeSlot))
      .slice(0, REPLAY_MAX_SCENES)
      .sort((left, right) => left.minSequenceNumber - right.minSequenceNumber);

    const bySequence = new Map(events.map((candidate) => [candidate.sequenceNumber, candidate]));
    const groups = selected.map((candidate) => candidateToGroup(candidate, bySequence))
      .filter((group): group is NonNullable<typeof group> => group !== null);

    const fromSelection = buildVisualReplay({
      ...replayInput(groups.flatMap((group) => group.events)),
      selection: {
        groups,
        locationFolds: new Map(selected.map((candidate) => [candidate.sceneId, candidateLocationFold(candidate)])),
      },
    });

    expect(JSON.stringify(fromSelection)).toBe(JSON.stringify(fromWholeLog));
  });

  it('refuses a selection with no fold for a scene rather than folding the subset it was given', () => {
    // The dangerous failure is the quiet one: falling back to `foldLocations` over the selection's
    // own events would lose every arrival that happened outside them and place participants where
    // they were not.
    const events = fixtureEvents();
    const candidates = [...fullSceneIndex(events).values()];
    const bySequence = new Map(events.map((candidate) => [candidate.sequenceNumber, candidate]));
    const groups = candidates.slice(0, 1)
      .map((candidate) => candidateToGroup(candidate, bySequence))
      .filter((group): group is NonNullable<typeof group> => group !== null);

    expect(() => buildVisualReplay({
      ...replayInput(groups.flatMap((group) => group.events)),
      selection: { groups, locationFolds: new Map() },
    })).toThrow(/location fold/);
  });

  it('splits the location fold at the scene boundary without changing it', () => {
    // `foldLocations` is now two applications of `foldReplayPositions`. That is an identity over a
    // last-write-wins fold, and this is where it is pinned rather than argued.
    const events = fixtureEvents();
    const whole = foldReplayPositions(new Map(), events);
    expect(whole.size).toBeGreaterThan(1);
    for (let split = 0; split <= events.length; split += 1) {
      const head = foldReplayPositions(new Map(), events.slice(0, split));
      expect(foldReplayPositions(head, events.slice(split))).toEqual(whole);
    }
  });
});

describe('ART-100 — the anchor chain reproduces a whole-log plan', () => {
  const planWith = (events: readonly AcceptedEvent[], motionFold?: ReturnType<typeof foldCharacterMotion>) =>
    planCharacterTrajectories({
      mapId: RUNTIME.mapId, nowMs: 5_000, grid: RUNTIME.grid, bindings: RUNTIME.bindings,
      seedPlacements: [], acceptedEvents: events, ...(motionFold ? { motionFold } : {}),
    });

  /**
   * What the anchor chain is SUPPOSED to hold, walked from the raw facts.
   *
   * Written out here because the obvious test — plan from events, plan from a fold, compare — is a
   * TAUTOLOGY now that `planCharacterTrajectories` folds internally: both sides would run the same
   * code and agree however wrong it was. Two fault injections (an anchor that never advances, and
   * unbound hops that are never reported) stayed green against exactly that shape. This is the
   * independent statement they now fail against, in the same spirit as `postCommitWorldState.test.ts`
   * keeping the full-replay `completedWorldDays` as its specification.
   */
  function referenceChain(events: readonly AcceptedEvent[], bindings = RUNTIME.bindings) {
    const byCharacter = new Map<string, { anchor: { x: number; y: number } | null; unbound: string[] }>();
    const facts = collectLocationFacts(events);
    for (const characterId of new Set(facts.map((fact) => fact.characterId))) {
      const own = facts.filter((fact) => fact.characterId === characterId);
      let anchor: { x: number; y: number } | null = null;
      const unbound: string[] = [];
      // Every hop but the last: the pre-ART-100 loop, verbatim.
      for (const fact of own.slice(0, -1)) {
        const binding = resolvePublishableLocationZone(bindings, fact.toLocationId);
        if (!binding) { unbound.push(fact.toLocationId); continue; }
        anchor = selectAmbientAnchor(binding, {
          characterId, locationId: binding.locationId,
          worldDay: fact.worldDay, timeBucket: timeBucketForSlot(fact.timeSlot),
        });
      }
      byCharacter.set(characterId, { anchor, unbound });
    }
    return byCharacter;
  }

  it('carries the same anchor and unbound-hop list the raw fact walk produces', () => {
    const events = fixtureEvents();
    const fold = foldCharacterMotion(emptyCharacterMotionFold(), events, RUNTIME.bindings);
    const expected = referenceChain(events);

    // Non-vacuity: somebody really does have an intermediate hop, so `lastBoundHopAnchor` is a
    // value rather than the null it starts as.
    expect([...expected.values()].some((entry) => entry.anchor !== null)).toBe(true);
    expect(fold.byCharacter.size).toBe(expected.size);
    for (const [characterId, entry] of expected) {
      expect(fold.byCharacter.get(characterId)?.lastBoundHopAnchor).toEqual(entry.anchor);
      expect(fold.byCharacter.get(characterId)?.unboundHopLocationIds).toEqual(entry.unbound);
    }
  });

  it('remembers a hop through a zone the map does not bind, in hop order', () => {
    /**
     * The fixture above walks bound zones only, so `unboundHopLocationIds` is empty throughout and
     * an implementation that dropped it entirely would pass. A character routed through an
     * unmapped location makes the list load-bearing — and the planner is expected to keep
     * REPORTING that hop on every rebuild, which is the behaviour the fold has to reproduce
     * without the history.
     */
    const [a, b] = ZONES;
    const events = [
      event({ sequenceNumber: 0, worldDay: 0, timeSlot: 'morning', locationId: a, participantIds: ['drifter'],
        changes: [move('drifter', b, a)] }),
      event({ sequenceNumber: 1, worldDay: 0, timeSlot: 'afternoon', participantIds: ['drifter'],
        changes: [move('drifter', a, 'nowhere-at-all')] }),
      event({ sequenceNumber: 2, worldDay: 1, timeSlot: 'morning', locationId: b, participantIds: ['drifter'],
        changes: [move('drifter', 'nowhere-at-all', b)] }),
    ];
    const fold = foldCharacterMotion(emptyCharacterMotionFold(), events, RUNTIME.bindings);
    expect(fold.byCharacter.get('drifter')?.unboundHopLocationIds).toEqual(['nowhere-at-all']);
    expect(fold.byCharacter.get('drifter')?.unboundHopLocationIds)
      .toEqual(referenceChain(events).get('drifter')?.unbound);

    // ...and the planner turns that memory back into the problem the whole-log walk reported.
    const problems = planWith([], fold).problems;
    expect(problems.map((problem) => problem.locationId)).toContain('nowhere-at-all');
  });

  it('plans identically from a fold built one event at a time, at EVERY split point', () => {
    const events = fixtureEvents();
    const expected = planWith(events);
    // Non-vacuity: characters really were placed, so "identical" is not "empty both times".
    expect(expected.trajectories.length).toBeGreaterThan(0);

    for (let split = 0; split <= events.length; split += 1) {
      const head = foldCharacterMotion(emptyCharacterMotionFold(), events.slice(0, split), RUNTIME.bindings);
      const fold = foldCharacterMotion(head, events.slice(split), RUNTIME.bindings);
      expect(JSON.stringify(planWith([], fold))).toBe(JSON.stringify(expected));
    }
  });

  it('fingerprints the bindings the fold was resolved against', () => {
    // The negative path that matters: a stored fold's anchors describe the map that was compiled in
    // when it was written. If the fingerprint did not move with the bindings, a map edit would
    // publish positions from a world that no longer exists, silently.
    const fingerprint = bindingsFingerprint(RUNTIME.bindings);
    expect(fingerprint).toBe(bindingsFingerprint([...RUNTIME.bindings].reverse()));
    const edited = RUNTIME.bindings.map((binding, index) => (index === 0
      ? { ...binding, entryAnchors: [{ x: 999, y: 999 }] }
      : binding));
    expect(bindingsFingerprint(edited)).not.toBe(fingerprint);
    expect(foldCharacterMotion(emptyCharacterMotionFold(), fixtureEvents(), edited).bindingsFingerprint)
      .toBe(bindingsFingerprint(edited));
  });
});

describe('ART-100 — the Live payload and the active scenes survive being scoped', () => {
  it('builds the same payload from the recent tail plus a full fold as from the whole log', () => {
    /**
     * The handler's exact shape: `priorFold` covers the world, and `acceptedEvents` is the
     * `recentEventCount` newest events — the ones `recentEvents` is made of. The tail and the fold
     * OVERLAP, and that is the property under test: last-write-wins over a suffix that nothing
     * later overwrote is the identity, so folding those events a second time changes nothing.
     *
     * The window is swept from 1 up rather than fixed, because the tail's length is exactly what a
     * cursor bug would get wrong. Note it is `recentEventCount` that sets it — a tail SHORTER than
     * that would publish fewer recent events than the world has, which is why the handler reads
     * `.take(recentLimit)` and not "the events since the checkpoint".
     */
    const events = fixtureEvents();
    const fold = foldLiveEvents(emptyLiveFold(), events);
    for (let window = 1; window <= events.length; window += 1) {
      const fromWholeLog = buildLiveProjection({
        worldId: WORLD_ID, acceptedEvents: events, arcs: [], publishedEpisode: null,
        recentEventCount: window,
      });
      // Non-vacuity, inside the loop so it covers every window: there is a world to compare.
      expect(fromWholeLog.locations.length).toBeGreaterThan(0);
      expect(fromWholeLog.characters.length).toBeGreaterThan(0);
      expect(fromWholeLog.recentEvents).toHaveLength(window);

      const scoped = buildLiveProjection({
        worldId: WORLD_ID, acceptedEvents: events.slice(-window), arcs: [], publishedEpisode: null,
        recentEventCount: window, priorFold: fold,
      });
      expect(JSON.stringify(scoped)).toBe(JSON.stringify(fromWholeLog));
    }
  });

  it('loses recent events if the tail is shorter than the window, which is why the handler reads the window', () => {
    // The failure the test above would hide if it only ever passed a full-length tail. Stated as a
    // test rather than a comment so the read in `rebuildLiveProjection` cannot be "simplified"
    // back to "the events since the checkpoint" without something turning red.
    const events = fixtureEvents();
    const fold = foldLiveEvents(emptyLiveFold(), events);
    const starved = buildLiveProjection({
      worldId: WORLD_ID, acceptedEvents: events.slice(-1), arcs: [], publishedEpisode: null,
      recentEventCount: 4, priorFold: fold,
    });
    expect(starved.recentEvents).toHaveLength(1);
    // ...while the locations and characters, which come from the fold, are unaffected.
    expect(starved.locations.length).toBeGreaterThan(0);
    expect(starved.characters.length).toBeGreaterThan(0);
  });

  it('presents the same active scenes from the current day plus the newest scene', () => {
    const events = fixtureEvents();
    const shared = {
      arcMemberships: MEMBERSHIPS,
      publishedEpisodeScenes: [],
      excludedCharacterIds: new Set<string>(),
    };
    const fromWholeLog = buildActiveScenePresentations({ acceptedEvents: events, ...shared });
    expect(fromWholeLog.scenes.length).toBeGreaterThan(0);

    const latest = events[events.length - 1];
    const dayEvents = events.filter((candidate) => candidate.worldDay === latest.worldDay);
    const newest = [...fullSceneIndex(events).values()]
      .sort((left, right) => right.maxSequenceNumber - left.maxSequenceNumber)[0];
    const bySequence = new Map(events.map((candidate) => [candidate.sequenceNumber, candidate]));
    const scoped = [...new Map([
      ...dayEvents,
      ...newest.eventSequenceNumbers.map((sequenceNumber) => bySequence.get(sequenceNumber)!),
    ].map((candidate) => [candidate.sequenceNumber, candidate])).values()];

    expect(scoped.length).toBeLessThan(events.length);
    expect(JSON.stringify(buildActiveScenePresentations({ acceptedEvents: scoped, ...shared })))
      .toBe(JSON.stringify(fromWholeLog));
  });

  it('degrades to the newest completed scene when the current slot placed nothing', () => {
    // The AC#8 branch, and the reason the newest scene is read at all. Without it the scoped
    // subset would hold no group and the map would show nothing rather than the last thing to
    // happen.
    const events = [
      ...fixtureEvents().slice(0, 5),
      event({ sequenceNumber: 6, worldDay: 3, timeSlot: 'morning', participantIds: ['wu-zhen'] }),
    ];
    const result = buildActiveScenePresentations({
      acceptedEvents: events, arcMemberships: MEMBERSHIPS,
      publishedEpisodeScenes: [], excludedCharacterIds: new Set(),
    });
    expect(result.mode).toBe('degraded');
    expect(result.scenes).toHaveLength(1);
  });
});

describe('ART-100 — the checkpoint survives a round trip', () => {
  it('serialises and reloads the Live fold without losing or reordering anything', () => {
    const fold = foldLiveEvents(emptyLiveFold(), fixtureEvents());
    expect(fold.locations.size).toBeGreaterThan(0);
    expect(fold.excludedCharacterIds.size).toBeGreaterThan(0);
    expect(deserializeLiveFold(serializeLiveFold(fold))).toEqual(fold);
  });

  it('serialises to a stable order, so an unchanged fold is an unchanged row', () => {
    // The row is compared by content like every other stored artifact. An insertion-ordered array
    // would make two identical folds look different and rewrite the row on every rebuild.
    const events = fixtureEvents();
    const forward = serializeLiveFold(foldLiveEvents(emptyLiveFold(), events));
    const shuffled = serializeLiveFold(foldLiveEvents(emptyLiveFold(), [...events].reverse()));
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(forward));
  });
});
