import type { AcceptedEvent } from '../canon/model';
import {
  hasArrivedAtLocation,
  resolvePublishableLocationZone,
  type LocationVisualBinding,
} from '../visual/locationVisualBinding';
import { mistwoodLocationVisualBindings } from '../visual/mistwoodLocationBindings';
import {
  createMultiHopFixture,
  createSingleMoveFixture,
  createZeroEventFixture,
  FIXTURE_ACCEPTED_AT_MS,
  MISTWOOD_SEED_PLACEMENTS,
} from './fixtures';
import { mistwoodRuntimeContext } from './mistwoodRuntime';
import type { MovementTrajectory } from './motion';
import { createCollisionGrid } from './walkableGrid';
import {
  planCharacterTrajectories,
  trajectoryEndsInsideItsZone,
  type AcceptedEventLike,
  type VisualRuntimeInput,
} from './visualSyncPlanner';

function unitFor(
  trajectories: readonly MovementTrajectory[],
  characterId: string,
): MovementTrajectory {
  const found = trajectories.filter((trajectory) => trajectory.characterId === characterId);
  expect(found).toHaveLength(1);
  return found[0];
}

function bindingFor(locationId: string): LocationVisualBinding {
  const binding = resolvePublishableLocationZone(mistwoodLocationVisualBindings, locationId);
  if (!binding) throw new Error(`missing test binding for ${locationId}`);
  return binding;
}

function moveEvent(args: {
  readonly sequenceNumber: number;
  readonly characterId: string;
  readonly fromLocationId: string;
  readonly toLocationId: string;
  readonly worldDay?: number;
  readonly timeSlot?: string;
  readonly acceptedAt?: number;
}): AcceptedEventLike {
  return {
    eventId: `mistwood#event#${args.sequenceNumber}`,
    sequenceNumber: args.sequenceNumber,
    worldDay: args.worldDay ?? 1,
    timeSlot: args.timeSlot ?? 'morning',
    acceptedAt: args.acceptedAt ?? FIXTURE_ACCEPTED_AT_MS,
    stateChanges: [
      {
        type: 'character_location_changed',
        characterId: args.characterId,
        fromLocationId: args.fromLocationId,
        toLocationId: args.toLocationId,
      },
    ],
  };
}

function inputWith(overrides: Partial<VisualRuntimeInput>): VisualRuntimeInput {
  return { ...createZeroEventFixture(), ...overrides };
}

describe('FR-N010 AC#8 bootstrap from the seed payload', () => {
  it('gives every seeded character a static position before any event exists', () => {
    const snapshot = planCharacterTrajectories(createZeroEventFixture());
    expect(snapshot.problems).toEqual([]);
    expect(snapshot.trajectories).toHaveLength(MISTWOOD_SEED_PLACEMENTS.length);
    for (const placement of MISTWOOD_SEED_PLACEMENTS) {
      const unit = unitFor(snapshot.trajectories, placement.characterId);
      expect(unit).toMatchObject({
        motionType: 'bootstrap',
        movementPhase: 'bootstrap',
        animationState: 'idle',
        motionSequence: 0,
        semanticLocationId: placement.initialLocationId,
        sourceEventIds: [],
      });
      expect(unit.from).toEqual(unit.to);
      expect(hasArrivedAtLocation(bindingFor(placement.initialLocationId), unit.to)).toBe(true);
    }
  });

  it('leaves the other eleven residents bootstrapped when one of them moves', () => {
    const snapshot = planCharacterTrajectories(createSingleMoveFixture());
    expect(snapshot.trajectories).toHaveLength(MISTWOOD_SEED_PLACEMENTS.length);
    const moved = snapshot.trajectories.filter((unit) => unit.motionType === 'canon');
    expect(moved.map((unit) => unit.characterId)).toEqual(['wu-zhen']);
  });

  it('reports an unbound seed location instead of guessing a position', () => {
    const snapshot = planCharacterTrajectories(
      inputWith({ seedPlacements: [{ characterId: 'ghost', initialLocationId: 'atlantis' }] }),
    );
    expect(snapshot.trajectories).toEqual([]);
    expect(snapshot.problems).toEqual([
      expect.objectContaining({
        code: 'VISUAL_RUNTIME_UNBOUND_LOCATION',
        characterId: 'ghost',
        locationId: 'atlantis',
      }),
    ]);
  });
});

describe('FR-N010 AC#1 trajectories derived from accepted Canon facts', () => {
  it('walks a moving character between the two zones the fact names', () => {
    const snapshot = planCharacterTrajectories(createSingleMoveFixture());
    const unit = unitFor(snapshot.trajectories, 'wu-zhen');
    expect(unit).toMatchObject({
      motionType: 'canon',
      movementPhase: 'in-transit',
      animationState: 'walking',
      semanticLocationId: 'mistwood-square',
      originLocationId: 'mistwood-station',
      sourceEventIds: ['mistwood#event#1'],
    });
    expect(hasArrivedAtLocation(bindingFor('mistwood-station'), unit.from)).toBe(true);
    expect(hasArrivedAtLocation(bindingFor('mistwood-square'), unit.to)).toBe(true);
  });

  it('starts the walk at the accepted event and never arrives before it started', () => {
    const snapshot = planCharacterTrajectories(createSingleMoveFixture());
    const unit = unitFor(snapshot.trajectories, 'wu-zhen');
    expect(unit.startedAt).toBe(FIXTURE_ACCEPTED_AT_MS + 1);
    expect(unit.arriveAt).toBeGreaterThan(unit.startedAt);
    for (const trajectory of snapshot.trajectories) {
      expect(trajectory.arriveAt).toBeGreaterThanOrEqual(trajectory.startedAt);
    }
  });

  it('publishes waypoints that stay walkable and reach the destination on time', () => {
    const snapshot = planCharacterTrajectories(createSingleMoveFixture());
    const unit = unitFor(snapshot.trajectories, 'wu-zhen');
    expect(unit.waypoints.length).toBeGreaterThan(1);
    expect(unit.waypoints[0].point).toEqual(unit.from);
    expect(unit.waypoints[unit.waypoints.length - 1]).toEqual({
      point: unit.to,
      arriveAt: unit.arriveAt,
    });
    for (let index = 1; index < unit.waypoints.length; index++) {
      expect(unit.waypoints[index].arriveAt).toBeGreaterThanOrEqual(
        unit.waypoints[index - 1].arriveAt,
      );
    }
  });

  it('accepts a real Canon AcceptedEvent structurally, without importing its type', () => {
    const canonEvent: AcceptedEvent = {
      schemaVersion: 1,
      worldId: 'mistwood',
      idempotencyKey: 'move-1',
      proposedBy: { type: 'system' },
      worldDay: 4,
      timeSlot: 'evening',
      eventType: 'world_event',
      participantIds: ['wu-zhen'],
      causedByEventIds: [],
      stateChanges: [
        {
          type: 'character_location_changed',
          characterId: 'wu-zhen',
          fromLocationId: 'mistwood-station',
          toLocationId: 'mistwood-inn',
        },
      ],
      eventId: 'mistwood#event#9',
      sequenceNumber: 9,
      acceptedAt: FIXTURE_ACCEPTED_AT_MS,
      validationVersion: 'canon-v1',
      traceId: 'trace-9',
    };
    const snapshot = planCharacterTrajectories(inputWith({ acceptedEvents: [canonEvent] }));
    expect(unitFor(snapshot.trajectories, 'wu-zhen').semanticLocationId).toBe('mistwood-inn');
  });

  it('ignores state changes that are not location changes', () => {
    const snapshot = planCharacterTrajectories(
      inputWith({
        acceptedEvents: [
          {
            eventId: 'mistwood#event#1',
            sequenceNumber: 1,
            worldDay: 1,
            timeSlot: 'noon',
            acceptedAt: FIXTURE_ACCEPTED_AT_MS,
            stateChanges: [
              { type: 'character_life_changed', characterId: 'wu-zhen' },
              { type: 'fact_created' },
            ],
          },
        ],
      }),
    );
    expect(unitFor(snapshot.trajectories, 'wu-zhen').motionType).toBe('bootstrap');
  });
});

describe('FR-N010 anchor chain across multiple hops', () => {
  it('paths only the final hop and cites only its event', () => {
    const snapshot = planCharacterTrajectories(createMultiHopFixture());
    const unit = unitFor(snapshot.trajectories, 'lin-yingxue');
    expect(unit.sourceEventIds).toEqual(['mistwood#event#3']);
    expect(unit.originLocationId).toBe('mistwood-square');
    expect(unit.semanticLocationId).toBe('mistwood-inn');
    expect(hasArrivedAtLocation(bindingFor('mistwood-square'), unit.from)).toBe(true);
    expect(hasArrivedAtLocation(bindingFor('mistwood-inn'), unit.to)).toBe(true);
  });

  it('keys each arrival anchor off that fact own day and slot, not the planning clock', () => {
    const at = (nowMs: number): MovementTrajectory =>
      unitFor(planCharacterTrajectories(createMultiHopFixture(nowMs)).trajectories, 'lin-yingxue');
    const early = at(FIXTURE_ACCEPTED_AT_MS + 5);
    expect(early.movementPhase).toBe('in-transit');
    // The chain head is the second hop's arrival anchor, and the destination is the third's.
    // Neither may shift as the planning instant advances within the walk.
    expect(at(early.arriveAt - 1).from).toEqual(early.from);
    expect(at(early.arriveAt - 1).to).toEqual(early.to);
    // Nor after it finishes: an arrived character stands exactly where the walk ended.
    expect(at(early.arriveAt + 5_000_000).to).toEqual(early.to);
  });

  it('reads facts in sequence order however the caller ordered the events', () => {
    const events = createMultiHopFixture().acceptedEvents;
    const shuffled = [events[2], events[0], events[1]];
    expect(
      JSON.stringify(planCharacterTrajectories(inputWith({ acceptedEvents: shuffled }))),
    ).toBe(JSON.stringify(planCharacterTrajectories(inputWith({ acceptedEvents: events }))));
  });

  it('skips an unbound intermediate hop but still finishes the chain', () => {
    const snapshot = planCharacterTrajectories(
      inputWith({
        acceptedEvents: [
          moveEvent({
            sequenceNumber: 1,
            characterId: 'wu-zhen',
            fromLocationId: 'mistwood-station',
            toLocationId: 'atlantis',
          }),
          moveEvent({
            sequenceNumber: 2,
            characterId: 'wu-zhen',
            fromLocationId: 'atlantis',
            toLocationId: 'mistwood-square',
          }),
        ],
      }),
    );
    expect(unitFor(snapshot.trajectories, 'wu-zhen').semanticLocationId).toBe('mistwood-square');
    expect(snapshot.problems).toContainEqual(
      expect.objectContaining({ code: 'VISUAL_RUNTIME_UNBOUND_LOCATION', locationId: 'atlantis' }),
    );
  });

  it('starts an unseeded character at the destination entry anchor when its origin is unbound', () => {
    const snapshot = planCharacterTrajectories(
      inputWith({
        seedPlacements: [],
        acceptedEvents: [
          moveEvent({
            sequenceNumber: 1,
            characterId: 'newcomer',
            fromLocationId: 'atlantis',
            toLocationId: 'mistwood-square',
          }),
        ],
      }),
    );
    const unit = unitFor(snapshot.trajectories, 'newcomer');
    expect(bindingFor('mistwood-square').entryAnchors).toContainEqual(unit.from);
    expect(hasArrivedAtLocation(bindingFor('mistwood-square'), unit.to)).toBe(true);
  });
});

describe('FR-N010 planning-instant phases', () => {
  const arriveAtOf = (nowMs: number): MovementTrajectory =>
    unitFor(planCharacterTrajectories(createSingleMoveFixture(nowMs)).trajectories, 'wu-zhen');

  it('reports a walk in progress before the arrival instant', () => {
    const unit = arriveAtOf(FIXTURE_ACCEPTED_AT_MS + 1);
    expect(unit.movementPhase).toBe('in-transit');
    expect(unit.animationState).toBe('walking');
    expect(unit.from).not.toEqual(unit.to);
  });

  it('settles the character at the destination once the arrival instant has passed', () => {
    const walking = arriveAtOf(FIXTURE_ACCEPTED_AT_MS + 1);
    const settled = arriveAtOf(walking.arriveAt);
    expect(settled.movementPhase).toBe('arrived');
    expect(settled.animationState).toBe('idle');
    expect(settled.from).toEqual(settled.to);
    expect(settled.to).toEqual(walking.to);
    expect(settled.arriveAt).toBe(walking.arriveAt);
  });

  it('crosses the boundary exactly once, never oscillating between phases', () => {
    const walking = arriveAtOf(FIXTURE_ACCEPTED_AT_MS + 1);
    const phases = [
      walking.arriveAt - 1,
      walking.arriveAt,
      walking.arriveAt + 1,
      walking.arriveAt + 10_000_000,
    ].map((nowMs) => arriveAtOf(nowMs).movementPhase);
    expect(phases).toEqual(['in-transit', 'arrived', 'arrived', 'arrived']);
  });

  it('advances the planning instant without changing the destination', () => {
    const walking = arriveAtOf(FIXTURE_ACCEPTED_AT_MS + 1);
    const settled = arriveAtOf(walking.arriveAt + 5_000_000);
    expect(settled.to).toEqual(walking.to);
    expect(settled.motionSequence).toBe(walking.motionSequence);
  });
});

describe('FR-N010 planner invariants', () => {
  it('emits exactly one unit per character', () => {
    for (const input of [createZeroEventFixture(), createSingleMoveFixture(), createMultiHopFixture()]) {
      const snapshot = planCharacterTrajectories(input);
      const ids = snapshot.trajectories.map((unit) => unit.characterId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('ends every trajectory inside the zone it claims', () => {
    for (const input of [createZeroEventFixture(), createSingleMoveFixture(), createMultiHopFixture()]) {
      const snapshot = planCharacterTrajectories(input);
      for (const unit of snapshot.trajectories) {
        expect(trajectoryEndsInsideItsZone(unit, mistwoodLocationVisualBindings)).toBe(true);
      }
    }
  });

  it('never lets the motion sequence regress as history grows', () => {
    const events = createMultiHopFixture().acceptedEvents;
    let previous = -1;
    for (let prefix = 0; prefix <= events.length; prefix++) {
      const snapshot = planCharacterTrajectories(
        inputWith({ acceptedEvents: events.slice(0, prefix) }),
      );
      const sequence = unitFor(snapshot.trajectories, 'lin-yingxue').motionSequence;
      expect(sequence).toBeGreaterThanOrEqual(previous);
      previous = sequence;
    }
  });

  it('ranks any accepted fact above a bootstrap position', () => {
    const bootstrapped = unitFor(
      planCharacterTrajectories(createZeroEventFixture()).trajectories,
      'wu-zhen',
    );
    const moved = unitFor(
      planCharacterTrajectories(
        inputWith({
          acceptedEvents: [
            moveEvent({
              sequenceNumber: 0,
              characterId: 'wu-zhen',
              fromLocationId: 'mistwood-station',
              toLocationId: 'mistwood-square',
            }),
          ],
        }),
      ).trajectories,
      'wu-zhen',
    );
    expect(moved.motionSequence).toBeGreaterThan(bootstrapped.motionSequence);
  });

  it('re-derives byte-identical output from the same input', () => {
    for (const input of [createZeroEventFixture(), createSingleMoveFixture(), createMultiHopFixture()]) {
      const expected = JSON.stringify(planCharacterTrajectories(input));
      for (let run = 0; run < 10; run++) {
        expect(JSON.stringify(planCharacterTrajectories(input))).toBe(expected);
      }
    }
  });

  it('echoes the map id and the planning instant it was given', () => {
    const snapshot = planCharacterTrajectories(createSingleMoveFixture(12345));
    expect(snapshot.mapId).toBe(mistwoodRuntimeContext().mapId);
    expect(snapshot.generatedAtMs).toBe(12345);
  });
});

describe('FR-N010 degradation instead of teleporting', () => {
  it('places the character at the destination and reports it when no route exists', () => {
    // A fully blocked map: the anchors are still authored, but nothing is walkable.
    const sealed = createCollisionGrid(
      Array.from({ length: 48 }, () => Array.from({ length: 36 }, () => 1)),
    );
    const snapshot = planCharacterTrajectories(
      inputWith({
        grid: sealed,
        acceptedEvents: [
          moveEvent({
            sequenceNumber: 1,
            characterId: 'wu-zhen',
            fromLocationId: 'mistwood-station',
            toLocationId: 'mistwood-square',
          }),
        ],
      }),
    );
    const unit = unitFor(snapshot.trajectories, 'wu-zhen');
    expect(unit).toMatchObject({
      movementPhase: 'arrived',
      animationState: 'idle',
      semanticLocationId: 'mistwood-square',
    });
    expect(unit.from).toEqual(unit.to);
    expect(unit.waypoints).toHaveLength(1);
    expect(hasArrivedAtLocation(bindingFor('mistwood-square'), unit.to)).toBe(true);
    expect(snapshot.problems).toContainEqual(
      expect.objectContaining({
        code: 'VISUAL_RUNTIME_NO_PATH',
        characterId: 'wu-zhen',
        locationId: 'mistwood-square',
      }),
    );
  });

  it('publishes no position at all for a character whose destination is unbound', () => {
    const snapshot = planCharacterTrajectories(
      inputWith({
        acceptedEvents: [
          moveEvent({
            sequenceNumber: 1,
            characterId: 'wu-zhen',
            fromLocationId: 'mistwood-station',
            toLocationId: 'atlantis',
          }),
        ],
      }),
    );
    expect(snapshot.trajectories.some((unit) => unit.characterId === 'wu-zhen')).toBe(false);
    expect(snapshot.problems).toContainEqual(
      expect.objectContaining({ code: 'VISUAL_RUNTIME_UNBOUND_LOCATION', characterId: 'wu-zhen' }),
    );
    // One bad location must not stop the rest of the town being drawn.
    expect(snapshot.trajectories).toHaveLength(MISTWOOD_SEED_PLACEMENTS.length - 1);
  });
});

describe('FR-N010 AC#4 no per-frame coordinate write path', () => {
  it('is a plain function with no Convex handle and no clock of its own', () => {
    expect(typeof planCharacterTrajectories).toBe('function');
    // `input` is the only parameter: there is no `ctx` to write a coordinate through.
    expect(planCharacterTrajectories).toHaveLength(1);
  });

  it('produces identical output when called repeatedly at the same instant', () => {
    const input = createSingleMoveFixture();
    const first = planCharacterTrajectories(input);
    for (let frame = 0; frame < 60; frame++) {
      expect(planCharacterTrajectories(input)).toEqual(first);
    }
  });
});
