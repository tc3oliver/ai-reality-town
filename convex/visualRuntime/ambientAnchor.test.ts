import {
  hasArrivedAtLocation,
  type LocationVisualBinding,
  type ZonePoint,
} from '../visual/locationVisualBinding';
import { mistwoodLocationVisualBindings } from '../visual/mistwoodLocationBindings';
import { selectAmbientAnchor, selectAmbientAnchorSequence } from './ambientAnchor';
import { TIME_SLOT_ORDER, timeBucketForSlot, type AmbientSeed } from './seededRandom';

function bindingFor(locationId: string): LocationVisualBinding {
  const binding = mistwoodLocationVisualBindings.find((entry) => entry.locationId === locationId);
  if (!binding) throw new Error(`missing test binding for ${locationId}`);
  return binding;
}

function seedFor(overrides: Partial<AmbientSeed> = {}): AmbientSeed {
  return {
    characterId: 'wu-zhen',
    locationId: 'mistwood-square',
    worldDay: 3,
    timeBucket: timeBucketForSlot('evening'),
    ...overrides,
  };
}

function withAnchors(anchors: readonly ZonePoint[]): LocationVisualBinding {
  return { ...bindingFor('mistwood-square'), ambientAnchors: anchors };
}

describe('FR-N010 AC#5 ambient anchor selection', () => {
  it('returns the same anchor for the same seed every time', () => {
    const binding = bindingFor('mistwood-square');
    const expected = selectAmbientAnchor(binding, seedFor());
    for (let index = 0; index < 1000; index++) {
      expect(selectAmbientAnchor(binding, seedFor())).toEqual(expected);
    }
  });

  it('only ever returns an authored ambient anchor of that zone', () => {
    for (const binding of mistwoodLocationVisualBindings) {
      for (const timeSlot of TIME_SLOT_ORDER) {
        for (let worldDay = 0; worldDay < 12; worldDay++) {
          const anchor = selectAmbientAnchor(
            binding,
            seedFor({
              locationId: binding.locationId,
              worldDay,
              timeBucket: timeBucketForSlot(timeSlot),
            }),
          );
          expect(binding.ambientAnchors).toContainEqual(anchor);
          expect(hasArrivedAtLocation(binding, anchor)).toBe(true);
        }
      }
    }
  });

  it('varies the anchor as the world day and time slot advance', () => {
    const binding = bindingFor('mistwood-square');
    const chosen = new Set<string>();
    for (let worldDay = 0; worldDay < 40; worldDay++) {
      for (const timeSlot of TIME_SLOT_ORDER) {
        const anchor = selectAmbientAnchor(
          binding,
          seedFor({ worldDay, timeBucket: timeBucketForSlot(timeSlot) }),
        );
        chosen.add(`${anchor.x},${anchor.y}`);
      }
    }
    expect(chosen.size).toBeGreaterThan(1);
  });

  it('places two characters in one zone independently', () => {
    const binding = bindingFor('mistwood-hall');
    const chosen = new Set(
      ['gao-wenrui', 'qiu-an', 'pei-lan'].map((characterId) => {
        const anchor = selectAmbientAnchor(binding, seedFor({ characterId }));
        return `${anchor.x},${anchor.y}`;
      }),
    );
    expect(chosen.size).toBeGreaterThan(1);
  });

  it('indexes the authored anchor order by the seed hash', () => {
    const anchors: ZonePoint[] = [
      { x: 20, y: 18 },
      { x: 21, y: 18 },
      { x: 22, y: 18 },
    ];
    const binding = withAnchors(anchors);
    const anchor = selectAmbientAnchor(binding, seedFor());
    expect(anchors).toContainEqual(anchor);
  });

  it('refuses a binding with no ambient anchors instead of using the camera point', () => {
    expect(() => selectAmbientAnchor(withAnchors([]), seedFor())).toThrow(
      /VISUAL_RUNTIME_NO_AMBIENT_ANCHORS/,
    );
  });
});

describe('FR-N010 ambient anchor sequence', () => {
  it('is deterministic and starts at the single-anchor selection', () => {
    const binding = bindingFor('mistwood-inn');
    const seed = seedFor({ locationId: 'mistwood-inn' });
    const sequence = selectAmbientAnchorSequence(binding, seed, 8);
    expect(sequence).toEqual(selectAmbientAnchorSequence(binding, seed, 8));
    expect(sequence[0]).toEqual(selectAmbientAnchor(binding, seed));
    expect(sequence).toHaveLength(8);
  });

  it('never repeats an anchor twice in a row', () => {
    const binding = bindingFor('mistwood-mill');
    const sequence = selectAmbientAnchorSequence(binding, seedFor({ locationId: 'mistwood-mill' }), 200);
    for (let index = 1; index < sequence.length; index++) {
      expect(sequence[index]).not.toEqual(sequence[index - 1]);
    }
    for (const anchor of sequence) expect(binding.ambientAnchors).toContainEqual(anchor);
  });

  it('returns nothing for a non-positive count', () => {
    const binding = bindingFor('mistwood-inn');
    expect(selectAmbientAnchorSequence(binding, seedFor(), 0)).toEqual([]);
    expect(selectAmbientAnchorSequence(binding, seedFor(), -3)).toEqual([]);
  });

  it('repeats the only anchor when a zone declares just one', () => {
    const only: ZonePoint = { x: 20, y: 18 };
    const sequence = selectAmbientAnchorSequence(withAnchors([only]), seedFor(), 4);
    expect(sequence).toEqual([only, only, only, only]);
  });
});
