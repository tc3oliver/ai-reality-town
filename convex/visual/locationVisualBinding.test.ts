import {
  LocationVisualBindingError,
  MAX_ZONE_OVERLAP_RATIO,
  convexPolygonOverlapArea,
  findLocationZoneAtPoint,
  hasArrivedAtLocation,
  isConvexPolygon,
  isPointInZonePolygon,
  polygonArea,
  resolvePublishableLocationZone,
  validateLocationVisualBindings,
  type LocationVisualBinding,
  type ZonePoint,
} from './locationVisualBinding';

const KNOWN_LOCATION_IDS = ['test-square', 'test-mill', 'test-unbound'];

function square(x: number, y: number, size: number): ZonePoint[] {
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
}

function binding(overrides: Partial<LocationVisualBinding> = {}): LocationVisualBinding {
  return {
    id: 'location-binding-test-square',
    worldId: 'test-world',
    mapId: 'test-map',
    locationId: 'test-square',
    zoneType: 'canon-location',
    zonePolygon: square(0, 0, 10),
    entryAnchors: [{ x: 0.5, y: 5.5 }],
    ambientAnchors: [
      { x: 2.5, y: 2.5 },
      { x: 7.5, y: 2.5 },
      { x: 5.5, y: 7.5 },
    ],
    sceneFocusPoint: { x: 5, y: 5 },
    publicLabel: 'Test Square',
    status: 'active',
    version: 1,
    ...overrides,
  };
}

function expectRejection(bindings: readonly LocationVisualBinding[], code: string): void {
  expect(() =>
    validateLocationVisualBindings(bindings, { knownLocationIds: KNOWN_LOCATION_IDS }),
  ).toThrow(LocationVisualBindingError);
  try {
    validateLocationVisualBindings(bindings, { knownLocationIds: KNOWN_LOCATION_IDS });
  } catch (error) {
    expect((error as LocationVisualBindingError).code).toBe(code);
  }
}

describe('Location Visual Binding geometry (FR-N005)', () => {
  it('measures polygon area and convexity', () => {
    expect(polygonArea(square(0, 0, 10))).toBe(100);
    expect(isConvexPolygon(square(0, 0, 10))).toBe(true);
    expect(isConvexPolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe(false);
    // A chevron: the third vertex turns back into the shape.
    expect(
      isConvexPolygon([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    ).toBe(false);
  });

  it('measures overlap between zones exactly, in either winding', () => {
    expect(convexPolygonOverlapArea(square(0, 0, 10), square(20, 20, 10))).toBe(0);
    // Sharing an edge is not overlap.
    expect(convexPolygonOverlapArea(square(0, 0, 10), square(10, 0, 10))).toBe(0);
    expect(convexPolygonOverlapArea(square(0, 0, 10), square(8, 0, 10))).toBe(20);
    expect(convexPolygonOverlapArea(square(0, 0, 10), [...square(8, 0, 10)].reverse())).toBe(20);
  });

  it('treats containment as an area test, not coordinate equality', () => {
    const zone = square(0, 0, 10);
    expect(isPointInZonePolygon({ x: 0.5, y: 0.5 }, zone)).toBe(true);
    expect(isPointInZonePolygon({ x: 9.5, y: 9.5 }, zone)).toBe(true);
    expect(isPointInZonePolygon({ x: 4.317, y: 6.902 }, zone)).toBe(true);
    // Boundary is inside, so a character on the zone edge has arrived.
    expect(isPointInZonePolygon({ x: 0, y: 5 }, zone)).toBe(true);
    expect(isPointInZonePolygon({ x: 10.0001, y: 5 }, zone)).toBe(false);
    expect(isPointInZonePolygon({ x: -1, y: 5 }, zone)).toBe(false);
    expect(isPointInZonePolygon({ x: Number.NaN, y: 5 }, zone)).toBe(false);
  });
});

describe('Location Visual Binding validation (FR-N005 AC #2)', () => {
  it('accepts a well-formed binding set', () => {
    const bindings = [binding()];
    expect(
      validateLocationVisualBindings(bindings, {
        knownLocationIds: KNOWN_LOCATION_IDS,
        requiredLocationIds: ['test-square'],
      }),
    ).toBe(bindings);
  });

  it('rejects a locationId Canon does not define', () => {
    expectRejection([binding({ locationId: 'mistwood-atlantis' })], 'LOCATION_BINDING_UNKNOWN_LOCATION');
  });

  it('rejects the same location or id bound twice', () => {
    expectRejection(
      [binding(), binding({ id: 'location-binding-duplicate' })],
      'LOCATION_BINDING_DUPLICATE_LOCATION',
    );
    expectRejection(
      [
        binding(),
        binding({
          locationId: 'test-mill',
          zonePolygon: square(40, 40, 10),
          entryAnchors: [{ x: 40.5, y: 45.5 }],
          ambientAnchors: [
            { x: 42.5, y: 42.5 },
            { x: 47.5, y: 42.5 },
            { x: 45.5, y: 47.5 },
          ],
          sceneFocusPoint: { x: 45, y: 45 },
        }),
      ],
      'LOCATION_BINDING_DUPLICATE_ID',
    );
  });

  it('rejects degenerate zone geometry', () => {
    expectRejection(
      [binding({ zonePolygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }] })],
      'LOCATION_BINDING_DEGENERATE_POLYGON',
    );
    expectRejection(
      [
        binding({
          zonePolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 0 },
          ],
        }),
      ],
      'LOCATION_BINDING_DEGENERATE_POLYGON',
    );
    expectRejection(
      [
        binding({
          zonePolygon: square(0, 0, 0.5),
          entryAnchors: [{ x: 0.25, y: 0.25 }],
          ambientAnchors: [
            { x: 0.1, y: 0.1 },
            { x: 0.2, y: 0.2 },
            { x: 0.3, y: 0.3 },
          ],
          sceneFocusPoint: { x: 0.25, y: 0.25 },
        }),
      ],
      'LOCATION_BINDING_DEGENERATE_POLYGON',
    );
    expectRejection(
      [
        binding({
          zonePolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 5, y: 5 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        }),
      ],
      'LOCATION_BINDING_DEGENERATE_POLYGON',
    );
  });

  it('rejects zones that overlap unreasonably but tolerates zones that merely touch', () => {
    const neighbour = binding({
      id: 'location-binding-test-mill',
      locationId: 'test-mill',
      publicLabel: 'Test Mill',
      zonePolygon: square(10, 0, 10),
      entryAnchors: [{ x: 10.5, y: 5.5 }],
      ambientAnchors: [
        { x: 12.5, y: 2.5 },
        { x: 17.5, y: 2.5 },
        { x: 15.5, y: 7.5 },
      ],
      sceneFocusPoint: { x: 15, y: 5 },
    });
    expect(
      validateLocationVisualBindings([binding(), neighbour], {
        knownLocationIds: KNOWN_LOCATION_IDS,
      }),
    ).toHaveLength(2);

    expectRejection(
      [
        binding(),
        {
          ...neighbour,
          zonePolygon: square(5, 0, 10),
          entryAnchors: [{ x: 5.5, y: 5.5 }],
          ambientAnchors: [
            { x: 7.5, y: 2.5 },
            { x: 12.5, y: 2.5 },
            { x: 10.5, y: 7.5 },
          ],
          sceneFocusPoint: { x: 10, y: 5 },
        },
      ],
      'LOCATION_BINDING_UNREASONABLE_OVERLAP',
    );
  });

  it('ignores retired zones when checking overlap', () => {
    const retired = binding({
      id: 'location-binding-test-mill',
      locationId: 'test-mill',
      publicLabel: 'Test Mill',
      status: 'retired',
    });
    expect(
      validateLocationVisualBindings([binding(), retired], {
        knownLocationIds: KNOWN_LOCATION_IDS,
      }),
    ).toHaveLength(2);
  });

  it('rejects anchors that fall outside their own zone', () => {
    expectRejection(
      [binding({ entryAnchors: [{ x: 50, y: 50 }] })],
      'LOCATION_BINDING_ANCHOR_OUTSIDE_ZONE',
    );
    expectRejection(
      [
        binding({
          ambientAnchors: [
            { x: 2.5, y: 2.5 },
            { x: 7.5, y: 2.5 },
            { x: 50, y: 50 },
          ],
        }),
      ],
      'LOCATION_BINDING_ANCHOR_OUTSIDE_ZONE',
    );
    expectRejection(
      [binding({ sceneFocusPoint: { x: 50, y: 50 } })],
      'LOCATION_BINDING_ANCHOR_OUTSIDE_ZONE',
    );
  });

  it('rejects anchor sets too thin to support ambient activity (AC #5)', () => {
    expectRejection([binding({ entryAnchors: [] })], 'LOCATION_BINDING_INSUFFICIENT_ANCHORS');
    expectRejection(
      [binding({ ambientAnchors: [{ x: 2.5, y: 2.5 }, { x: 7.5, y: 2.5 }] })],
      'LOCATION_BINDING_INSUFFICIENT_ANCHORS',
    );
    expectRejection(
      [
        binding({
          ambientAnchors: [
            { x: 2.5, y: 2.5 },
            { x: 2.5, y: 2.5 },
            { x: 7.5, y: 2.5 },
          ],
        }),
      ],
      'LOCATION_BINDING_INSUFFICIENT_ANCHORS',
    );
  });

  it('rejects malformed identity, status and version fields', () => {
    expectRejection([binding({ publicLabel: '  ' })], 'LOCATION_BINDING_INVALID_SHAPE');
    expectRejection(
      [binding({ status: 'draft' as LocationVisualBinding['status'] })],
      'LOCATION_BINDING_INVALID_SHAPE',
    );
    expectRejection([binding({ version: 0 })], 'LOCATION_BINDING_INVALID_SHAPE');
  });

  it('rejects a required Canon location that no active binding covers', () => {
    expect(() =>
      validateLocationVisualBindings([binding({ status: 'retired' })], {
        knownLocationIds: KNOWN_LOCATION_IDS,
        requiredLocationIds: ['test-square'],
      }),
    ).toThrow(/LOCATION_BINDING_MISSING_LOCATION/);
  });

  it('exposes the overlap limit it enforces so the bound is auditable', () => {
    expect(MAX_ZONE_OVERLAP_RATIO).toBeGreaterThan(0);
    expect(MAX_ZONE_OVERLAP_RATIO).toBeLessThan(1);
  });
});

describe('Zone arrival and publishable positions (FR-N005 AC #3, #4)', () => {
  const zone = binding();

  it('counts arrival anywhere inside the zone, not at a stored coordinate', () => {
    expect(hasArrivedAtLocation(zone, { x: 5, y: 5 })).toBe(true);
    expect(hasArrivedAtLocation(zone, { x: 0.31, y: 9.87 })).toBe(true);
    expect(hasArrivedAtLocation(zone, zone.ambientAnchors[0])).toBe(true);
    expect(hasArrivedAtLocation(zone, { x: 10.5, y: 5 })).toBe(false);
  });

  it('never reports arrival at a retired zone', () => {
    expect(hasArrivedAtLocation({ ...zone, status: 'retired' }, { x: 5, y: 5 })).toBe(false);
  });

  it('finds the active zone a point stands in', () => {
    expect(findLocationZoneAtPoint([zone], { x: 5, y: 5 })?.locationId).toBe('test-square');
    expect(findLocationZoneAtPoint([zone], { x: 500, y: 500 })).toBeUndefined();
  });

  it('refuses to publish a position for an unbound or retired Canon location', () => {
    expect(resolvePublishableLocationZone([zone], 'test-square')?.publicLabel).toBe('Test Square');
    expect(resolvePublishableLocationZone([zone], 'test-unbound')).toBeUndefined();
    expect(
      resolvePublishableLocationZone([{ ...zone, status: 'retired' }], 'test-square'),
    ).toBeUndefined();
  });
});
