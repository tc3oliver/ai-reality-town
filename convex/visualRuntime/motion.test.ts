import {
  IDLE_DIRECTION,
  MOVEMENT_SPEED_TILES_PER_SECOND,
  deriveDirection,
  travelDurationMs,
  type Direction,
  type TilePoint,
} from './motion';

const origin: TilePoint = { x: 10, y: 10 };

describe('FR-N010 motion contract', () => {
  it.each<[string, TilePoint, Direction]>([
    ['due east', { x: 14, y: 10 }, 'east'],
    ['due west', { x: 6, y: 10 }, 'west'],
    ['due south', { x: 10, y: 14 }, 'south'],
    ['due north', { x: 10, y: 6 }, 'north'],
    ['exact 45 degrees south-east', { x: 14, y: 14 }, 'south-east'],
    ['exact 45 degrees north-east', { x: 14, y: 6 }, 'north-east'],
    ['exact 45 degrees south-west', { x: 6, y: 14 }, 'south-west'],
    ['exact 45 degrees north-west', { x: 6, y: 6 }, 'north-west'],
    ['shallow eastward drift stays east', { x: 20, y: 11 }, 'east'],
    ['shallow southward drift stays south', { x: 11, y: 20 }, 'south'],
    ['just past the octant boundary becomes diagonal', { x: 20, y: 15 }, 'south-east'],
  ])('faces %s', (_label, to, expected) => {
    expect(deriveDirection(origin, to)).toBe(expected);
  });

  it('faces the camera when there is nowhere to go', () => {
    expect(deriveDirection(origin, { x: 10, y: 10 })).toBe(IDLE_DIRECTION);
    expect(IDLE_DIRECTION).toBe('south');
  });

  it('derives every direction purely from the delta, not the absolute position', () => {
    for (const shift of [-100, 0, 37]) {
      expect(deriveDirection({ x: shift, y: shift }, { x: shift + 3, y: shift + 1 })).toBe(
        deriveDirection({ x: 0, y: 0 }, { x: 3, y: 1 }),
      );
    }
  });

  it('converts tile distance to whole milliseconds at the declared speed', () => {
    expect(MOVEMENT_SPEED_TILES_PER_SECOND).toBe(0.75);
    expect(travelDurationMs(0.75)).toBe(1000);
    expect(travelDurationMs(3)).toBe(4000);
    expect(travelDurationMs(1)).toBe(1333);
    expect(Number.isInteger(travelDurationMs(7))).toBe(true);
  });

  it('treats a zero or negative distance as no travel time at all', () => {
    expect(travelDurationMs(0)).toBe(0);
    expect(travelDurationMs(-5)).toBe(0);
    expect(travelDurationMs(Number.NaN)).toBe(0);
  });
});
