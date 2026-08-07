import { mistwoodCollision, MISTWOOD_MAP_HEIGHT, MISTWOOD_MAP_WIDTH } from '../../data/mistwood';
import { MISTWOOD_MAP_ID, mistwoodLocationVisualBindings } from '../visual/mistwoodLocationBindings';
import { MISTWOOD_RUNTIME_MAP_ID, mistwoodRuntimeContext, mistwoodWalkableGrid } from './mistwoodRuntime';
import { planTilePath } from './pathPlanner';
import { isWalkableTile, tileOfPoint } from './walkableGrid';

describe('FR-N010 Mistwood runtime binding', () => {
  it('exposes the Mistwood collision layer at its declared size', () => {
    expect(mistwoodWalkableGrid.width).toBe(MISTWOOD_MAP_WIDTH);
    expect(mistwoodWalkableGrid.height).toBe(MISTWOOD_MAP_HEIGHT);
    expect(mistwoodWalkableGrid.collision).toBe(mistwoodCollision);
  });

  it('publishes the same map id the location bindings were measured against', () => {
    expect(MISTWOOD_RUNTIME_MAP_ID).toBe(MISTWOOD_MAP_ID);
    for (const binding of mistwoodLocationVisualBindings) {
      expect(binding.mapId).toBe(MISTWOOD_RUNTIME_MAP_ID);
    }
  });

  it('assembles a context a planner can consume directly', () => {
    const context = mistwoodRuntimeContext();
    expect(context.mapId).toBe(MISTWOOD_RUNTIME_MAP_ID);
    expect(context.grid).toBe(mistwoodWalkableGrid);
    expect(context.bindings).toBe(mistwoodLocationVisualBindings);
    expect(context.bindings).toHaveLength(8);
  });

  it('stands every authored anchor on a walkable tile', () => {
    for (const binding of mistwoodLocationVisualBindings) {
      for (const anchor of [...binding.entryAnchors, ...binding.ambientAnchors]) {
        const tile = tileOfPoint(anchor);
        expect(isWalkableTile(mistwoodWalkableGrid, tile.x, tile.y)).toBe(true);
      }
    }
  });

  it('connects every pair of Mistwood zones by a walkable route', () => {
    const bindings = mistwoodLocationVisualBindings;
    for (const from of bindings) {
      for (const to of bindings) {
        if (from.locationId === to.locationId) continue;
        const result = planTilePath(
          mistwoodWalkableGrid,
          tileOfPoint(from.ambientAnchors[0]),
          tileOfPoint(to.ambientAnchors[0]),
        );
        expect({ from: from.locationId, to: to.locationId, found: result.found }).toEqual({
          from: from.locationId,
          to: to.locationId,
          found: true,
        });
      }
    }
  });
});
