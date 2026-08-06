/**
 * Location Visual Binding contract (FR-N005 / ART-110).
 *
 * Canon owns semantic locations; it must never hold map geometry (PRD 2.0 §10.6).
 * This module owns the other half of that split: the stable, versioned mapping from
 * a Canon `locationId` to the zone polygon, anchors and public label the Visual
 * Runtime draws it with.
 *
 * Coordinates are **map tile coordinates**, the same space as the tile rectangles in
 * `data/mistwood.ts`: tile `(tx, ty)` covers the unit square from `(tx, ty)` to
 * `(tx + 1, ty + 1)`, so a character standing on that tile sits at its centre
 * `(tx + 0.5, ty + 0.5)`. Pixel conversion belongs to the renderer, not to a binding.
 *
 * Zone polygons must be convex. Arrival, overlap and containment then reduce to exact
 * arithmetic with no sampling, and every zone authored so far is a map rectangle. An
 * L-shaped zone would have to be expressed as two bindings or the constraint revisited.
 */

export type ZonePoint = {
  readonly x: number;
  readonly y: number;
};

/**
 * The kind of zone a binding describes. Only Canon locations are bound today; roads and
 * unnamed landmarks are map geometry with no Canon identity, so they get no binding.
 */
export type LocationZoneType = 'canon-location';

/** `retired` keeps a superseded binding auditable without publishing it as a position. */
export type LocationVisualBindingStatus = 'active' | 'retired';

export type LocationVisualBinding = {
  readonly id: string;
  readonly worldId: string;
  /** Which map the geometry belongs to; geometry is meaningless across map versions. */
  readonly mapId: string;
  /** The Canon location this geometry is bound to. */
  readonly locationId: string;
  readonly zoneType: LocationZoneType;
  /** Convex ring of the zone, in tile coordinates. Not closed: the last vertex joins the first. */
  readonly zonePolygon: readonly ZonePoint[];
  /** Where a character crosses into the zone from outside. */
  readonly entryAnchors: readonly ZonePoint[];
  /** Standing positions for in-zone ambient activity (PRD 2.0 §9.1.2). */
  readonly ambientAnchors: readonly ZonePoint[];
  /** Camera target for a scene at this location; a viewpoint, not a standing position. */
  readonly sceneFocusPoint: ZonePoint;
  /** Public text. Never derive this from private Canon detail. */
  readonly publicLabel: string;
  readonly status: LocationVisualBindingStatus;
  readonly version: number;
};

/** A zone smaller than a single tile cannot hold a character and is treated as degenerate. */
export const MIN_ZONE_AREA = 1;

/** Ambient movement needs somewhere to move between, not a single fixed spot. */
export const MIN_AMBIENT_ANCHORS = 3;

/**
 * Zones may abut and may nest slightly, but a zone that shares more than this fraction of
 * the smaller of two areas makes arrival ambiguous and is rejected.
 */
export const MAX_ZONE_OVERLAP_RATIO = 0.1;

export type LocationVisualBindingErrorCode =
  | 'LOCATION_BINDING_INVALID_SHAPE'
  | 'LOCATION_BINDING_UNKNOWN_LOCATION'
  | 'LOCATION_BINDING_DUPLICATE_ID'
  | 'LOCATION_BINDING_DUPLICATE_LOCATION'
  | 'LOCATION_BINDING_DEGENERATE_POLYGON'
  | 'LOCATION_BINDING_INSUFFICIENT_ANCHORS'
  | 'LOCATION_BINDING_ANCHOR_OUTSIDE_ZONE'
  | 'LOCATION_BINDING_UNREASONABLE_OVERLAP'
  | 'LOCATION_BINDING_MISSING_LOCATION';

export class LocationVisualBindingError extends Error {
  readonly code: LocationVisualBindingErrorCode;
  readonly path?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: LocationVisualBindingErrorCode,
    message: string,
    path?: string,
    details?: Record<string, unknown>,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'LocationVisualBindingError';
    this.code = code;
    this.path = path;
    this.details = details;
  }
}

/** Deliberately not a type predicate: narrowing a typed array to `any[]` loses the point type. */
function isArray(value: unknown): boolean {
  return Array.isArray(value);
}

function isFinitePoint(point: ZonePoint | undefined): point is ZonePoint {
  return (
    typeof point === 'object' &&
    point !== null &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

/** Twice the signed area; positive and negative windings both occur in authored data. */
function doubleSignedArea(polygon: readonly ZonePoint[]): number {
  let total = 0;
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    total += current.x * next.y - next.x * current.y;
  }
  return total;
}

export function polygonArea(polygon: readonly ZonePoint[]): number {
  return Math.abs(doubleSignedArea(polygon)) / 2;
}

/** Winding-independent input for the clipper below. */
function withPositiveWinding(polygon: readonly ZonePoint[]): readonly ZonePoint[] {
  return doubleSignedArea(polygon) < 0 ? [...polygon].reverse() : polygon;
}

function cross(origin: ZonePoint, to: ZonePoint, point: ZonePoint): number {
  return (to.x - origin.x) * (point.y - origin.y) - (to.y - origin.y) * (point.x - origin.x);
}

export function isConvexPolygon(polygon: readonly ZonePoint[]): boolean {
  if (polygon.length < 3) return false;
  let sign = 0;
  for (let index = 0; index < polygon.length; index++) {
    const previous = polygon[index];
    const current = polygon[(index + 1) % polygon.length];
    const next = polygon[(index + 2) % polygon.length];
    const turn = cross(previous, current, next);
    if (turn === 0) continue;
    const turnSign = turn > 0 ? 1 : -1;
    if (sign === 0) sign = turnSign;
    else if (sign !== turnSign) return false;
  }
  return sign !== 0;
}

function isPointOnSegment(point: ZonePoint, start: ZonePoint, end: ZonePoint): boolean {
  if (cross(start, end, point) !== 0) return false;
  return (
    point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y)
  );
}

/**
 * Ray-cast containment, boundary inclusive. This is the whole point of FR-N005 AC #3:
 * arrival is "the character is somewhere in this area", never "the character's coordinates
 * equal a stored coordinate".
 */
export function isPointInZonePolygon(point: ZonePoint, polygon: readonly ZonePoint[]): boolean {
  if (!isFinitePoint(point) || polygon.length < 3) return false;
  for (let index = 0; index < polygon.length; index++) {
    if (isPointOnSegment(point, polygon[index], polygon[(index + 1) % polygon.length])) return true;
  }
  let inside = false;
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const straddles = current.y > point.y !== previous.y > point.y;
    if (!straddles) continue;
    const crossingX =
      current.x + ((point.y - current.y) * (previous.x - current.x)) / (previous.y - current.y);
    if (point.x < crossingX) inside = !inside;
  }
  return inside;
}

function segmentIntersection(
  from: ZonePoint,
  to: ZonePoint,
  edgeStart: ZonePoint,
  edgeEnd: ZonePoint,
): ZonePoint {
  const direction = { x: to.x - from.x, y: to.y - from.y };
  const edge = { x: edgeEnd.x - edgeStart.x, y: edgeEnd.y - edgeStart.y };
  const denominator = direction.x * edge.y - direction.y * edge.x;
  if (denominator === 0) return to;
  const distance =
    ((edgeStart.x - from.x) * edge.y - (edgeStart.y - from.y) * edge.x) / denominator;
  return { x: from.x + direction.x * distance, y: from.y + direction.y * distance };
}

/**
 * Sutherland–Hodgman clipping. Exact for the convex zones this module accepts; it would
 * silently mis-clip a concave polygon, which is why `isConvexPolygon` is enforced.
 */
export function convexPolygonOverlapArea(
  first: readonly ZonePoint[],
  second: readonly ZonePoint[],
): number {
  if (first.length < 3 || second.length < 3) return 0;
  const clipper = withPositiveWinding(second);
  let output: ZonePoint[] = [...withPositiveWinding(first)];
  for (let index = 0; index < clipper.length && output.length > 0; index++) {
    const edgeStart = clipper[index];
    const edgeEnd = clipper[(index + 1) % clipper.length];
    const input = output;
    output = [];
    for (let vertex = 0; vertex < input.length; vertex++) {
      const current = input[vertex];
      const previous = input[(vertex + input.length - 1) % input.length];
      const currentInside = cross(edgeStart, edgeEnd, current) >= 0;
      const previousInside = cross(edgeStart, edgeEnd, previous) >= 0;
      if (currentInside) {
        if (!previousInside) output.push(segmentIntersection(previous, current, edgeStart, edgeEnd));
        output.push(current);
      } else if (previousInside) {
        output.push(segmentIntersection(previous, current, edgeStart, edgeEnd));
      }
    }
  }
  return output.length < 3 ? 0 : polygonArea(output);
}

export type LocationVisualBindingValidationOptions = {
  /** Canon location ids a binding is allowed to reference. */
  readonly knownLocationIds: readonly string[];
  /** Canon location ids that must each end up with an active binding. */
  readonly requiredLocationIds?: readonly string[];
  readonly maxZoneOverlapRatio?: number;
};

function assertPointInZone(
  point: ZonePoint | undefined,
  binding: LocationVisualBinding,
  path: string,
): void {
  if (!isFinitePoint(point)) {
    throw new LocationVisualBindingError(
      'LOCATION_BINDING_INVALID_SHAPE',
      'must be a point with finite x and y',
      path,
    );
  }
  if (!isPointInZonePolygon(point, binding.zonePolygon)) {
    throw new LocationVisualBindingError(
      'LOCATION_BINDING_ANCHOR_OUTSIDE_ZONE',
      'must lie inside the zone polygon it belongs to',
      path,
      { locationId: binding.locationId, point },
    );
  }
}

function validateBinding(
  binding: LocationVisualBinding,
  path: string,
  knownLocationIds: ReadonlySet<string>,
): void {
  for (const [field, value] of [
    ['id', binding.id],
    ['worldId', binding.worldId],
    ['mapId', binding.mapId],
    ['locationId', binding.locationId],
    ['publicLabel', binding.publicLabel],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new LocationVisualBindingError(
        'LOCATION_BINDING_INVALID_SHAPE',
        'must be a non-empty string',
        `${path}.${field}`,
      );
    }
  }
  if (binding.zoneType !== 'canon-location') {
    throw new LocationVisualBindingError(
      'LOCATION_BINDING_INVALID_SHAPE',
      'must be a supported zone type',
      `${path}.zoneType`,
    );
  }
  if (binding.status !== 'active' && binding.status !== 'retired') {
    throw new LocationVisualBindingError(
      'LOCATION_BINDING_INVALID_SHAPE',
      'must be active or retired',
      `${path}.status`,
    );
  }
  if (!Number.isInteger(binding.version) || binding.version < 1) {
    throw new LocationVisualBindingError(
      'LOCATION_BINDING_INVALID_SHAPE',
      'must be a positive integer',
      `${path}.version`,
    );
  }
  if (!knownLocationIds.has(binding.locationId)) {
    throw new LocationVisualBindingError(
      'LOCATION_BINDING_UNKNOWN_LOCATION',
      'does not name a Canon location',
      `${path}.locationId`,
      { locationId: binding.locationId },
    );
  }

  const polygon = binding.zonePolygon;
  if (!Array.isArray(polygon) || polygon.length < 3 || !polygon.every(isFinitePoint)) {
    throw new LocationVisualBindingError(
      'LOCATION_BINDING_DEGENERATE_POLYGON',
      'must have at least three vertices with finite coordinates',
      `${path}.zonePolygon`,
      { locationId: binding.locationId },
    );
  }
  if (!isConvexPolygon(polygon)) {
    throw new LocationVisualBindingError(
      'LOCATION_BINDING_DEGENERATE_POLYGON',
      'must be convex so arrival and overlap stay exact',
      `${path}.zonePolygon`,
      { locationId: binding.locationId },
    );
  }
  if (polygonArea(polygon) < MIN_ZONE_AREA) {
    throw new LocationVisualBindingError(
      'LOCATION_BINDING_DEGENERATE_POLYGON',
      `must enclose at least ${MIN_ZONE_AREA} tile of area`,
      `${path}.zonePolygon`,
      { locationId: binding.locationId, area: polygonArea(polygon) },
    );
  }

  if (!isArray(binding.entryAnchors) || !isArray(binding.ambientAnchors)) {
    throw new LocationVisualBindingError(
      'LOCATION_BINDING_INVALID_SHAPE',
      'must be arrays of points',
      `${path}.entryAnchors/ambientAnchors`,
    );
  }
  if (binding.entryAnchors.length < 1) {
    throw new LocationVisualBindingError(
      'LOCATION_BINDING_INSUFFICIENT_ANCHORS',
      'must declare at least one entry anchor',
      `${path}.entryAnchors`,
      { locationId: binding.locationId },
    );
  }
  if (binding.ambientAnchors.length < MIN_AMBIENT_ANCHORS) {
    throw new LocationVisualBindingError(
      'LOCATION_BINDING_INSUFFICIENT_ANCHORS',
      `must declare at least ${MIN_AMBIENT_ANCHORS} ambient anchors to support in-zone activity`,
      `${path}.ambientAnchors`,
      { locationId: binding.locationId, count: binding.ambientAnchors.length },
    );
  }
  const ambientKeys = new Set(binding.ambientAnchors.map((anchor) => `${anchor.x},${anchor.y}`));
  if (ambientKeys.size !== binding.ambientAnchors.length) {
    throw new LocationVisualBindingError(
      'LOCATION_BINDING_INSUFFICIENT_ANCHORS',
      'must declare distinct ambient anchors',
      `${path}.ambientAnchors`,
      { locationId: binding.locationId },
    );
  }

  binding.entryAnchors.forEach((anchor, index) =>
    assertPointInZone(anchor, binding, `${path}.entryAnchors[${index}]`),
  );
  binding.ambientAnchors.forEach((anchor, index) =>
    assertPointInZone(anchor, binding, `${path}.ambientAnchors[${index}]`),
  );
  assertPointInZone(binding.sceneFocusPoint, binding, `${path}.sceneFocusPoint`);
}

/**
 * Import-time validation. Throws on the first problem so an invalid binding set can never
 * be observed half-loaded; returns the bindings so callers can validate at module scope.
 */
export function validateLocationVisualBindings(
  bindings: readonly LocationVisualBinding[],
  options: LocationVisualBindingValidationOptions,
): readonly LocationVisualBinding[] {
  const knownLocationIds = new Set(options.knownLocationIds);
  const maxOverlapRatio = options.maxZoneOverlapRatio ?? MAX_ZONE_OVERLAP_RATIO;
  const seenIds = new Set<string>();
  const seenLocationIds = new Set<string>();

  bindings.forEach((binding, index) => {
    const path = `bindings[${index}]`;
    validateBinding(binding, path, knownLocationIds);
    if (seenIds.has(binding.id)) {
      throw new LocationVisualBindingError(
        'LOCATION_BINDING_DUPLICATE_ID',
        'is used by more than one binding',
        `${path}.id`,
        { id: binding.id },
      );
    }
    if (seenLocationIds.has(binding.locationId)) {
      throw new LocationVisualBindingError(
        'LOCATION_BINDING_DUPLICATE_LOCATION',
        'is bound more than once',
        `${path}.locationId`,
        { locationId: binding.locationId },
      );
    }
    seenIds.add(binding.id);
    seenLocationIds.add(binding.locationId);
  });

  const activeBindings = bindings.filter((binding) => binding.status === 'active');
  for (let first = 0; first < activeBindings.length; first++) {
    for (let second = first + 1; second < activeBindings.length; second++) {
      const left = activeBindings[first];
      const right = activeBindings[second];
      const overlap = convexPolygonOverlapArea(left.zonePolygon, right.zonePolygon);
      if (overlap === 0) continue;
      const smaller = Math.min(polygonArea(left.zonePolygon), polygonArea(right.zonePolygon));
      const ratio = overlap / smaller;
      if (ratio > maxOverlapRatio) {
        throw new LocationVisualBindingError(
          'LOCATION_BINDING_UNREASONABLE_OVERLAP',
          `zones overlap by ${(ratio * 100).toFixed(1)}% of the smaller zone, above the ${(
            maxOverlapRatio * 100
          ).toFixed(1)}% limit`,
          'bindings',
          { locationIds: [left.locationId, right.locationId], overlap, ratio },
        );
      }
    }
  }

  for (const locationId of options.requiredLocationIds ?? []) {
    if (!activeBindings.some((binding) => binding.locationId === locationId)) {
      throw new LocationVisualBindingError(
        'LOCATION_BINDING_MISSING_LOCATION',
        'has no active Location Visual Binding',
        'bindings',
        { locationId },
      );
    }
  }

  return bindings;
}

/**
 * The only sanctioned way to turn a Canon `locationId` into map geometry. An unbound or
 * retired location resolves to `undefined`, so it can never be published as a visible
 * position (FR-N005 AC #4).
 */
export function resolvePublishableLocationZone(
  bindings: readonly LocationVisualBinding[],
  locationId: string,
): LocationVisualBinding | undefined {
  return bindings.find(
    (binding) => binding.locationId === locationId && binding.status === 'active',
  );
}

/**
 * Zone arrival: containment in the bound polygon, not equality with any stored coordinate.
 * A retired binding never counts as arrived, because it is not a publishable position.
 */
export function hasArrivedAtLocation(binding: LocationVisualBinding, point: ZonePoint): boolean {
  return binding.status === 'active' && isPointInZonePolygon(point, binding.zonePolygon);
}

/** The active zone a point currently stands in, if any. */
export function findLocationZoneAtPoint(
  bindings: readonly LocationVisualBinding[],
  point: ZonePoint,
): LocationVisualBinding | undefined {
  return bindings.find((binding) => hasArrivedAtLocation(binding, point));
}
