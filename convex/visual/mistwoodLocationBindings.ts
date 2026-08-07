/**
 * Location Visual Bindings for the eight canonical Mistwood locations (FR-N005 / ART-110).
 *
 * Nothing here invents geometry. `data/mistwood.ts` (FR-N009 / ART-109) already decided where
 * every location sits and which tiles are walkable, so this module derives each zone from that
 * map and each label from the Canon world configuration:
 *
 * - `zonePolygon` is the location's footprint rectangle from `mistwoodLocationFootprints`.
 * - `entryAnchors` are the in-zone walkable tiles that touch a walkable tile outside the zone.
 *   Everything outside a location or a road is blocked woodland, so those tiles are exactly the
 *   mouths of the roads ART-109 built from the seed's `connectedLocationIds` graph.
 * - `ambientAnchors` are walkable in-zone tiles spread across the part of the zone a character can
 *   actually reach from an entry anchor, so ambient movement never targets a walkable island cut
 *   off by props, the Northwater channel or the mill wheel.
 * - `publicLabel` is the Canon location name, which is already public text.
 *
 * Because everything is derived, an edit to the map or the seed that would strand a location
 * fails this module's import-time validation instead of silently publishing a broken zone.
 *
 * ART-120 (FR-O011) moved the two anchor derivations into `data/mistwoodAmbientAnchors.ts` so
 * the browser can read the same standing positions without importing this file — which, via
 * `mistwoodSeed`, would put every resident's private profile in the client bundle. Only
 * `publicLabel` still comes from Canon, which is why this module remains the composer.
 */

import { mistwoodLocationFootprints, type MistwoodRect } from '../../data/mistwood';
import {
  mistwoodAmbientAnchorsByLocationId,
  mistwoodEntryAnchorsByLocationId,
} from '../../data/mistwoodAmbientAnchors';
import { MISTWOOD_PUBLIC_WORLD_ID, mistwoodWorldConfiguration } from '../canon/mistwoodSeed';
import {
  LocationVisualBindingError,
  validateLocationVisualBindings,
  type LocationVisualBinding,
  type ZonePoint,
} from './locationVisualBinding';

/** Identifies the map these zones are measured against; geometry does not survive a new map. */
export const MISTWOOD_MAP_ID = 'mistwood-v1';

/** Bumped whenever an authored binding changes, so a published position stays auditable. */
export const MISTWOOD_LOCATION_BINDING_VERSION = 1;

/** Tile `(x, y)` covers the unit square `(x, y)`–`(x + 1, y + 1)`, so its ring is the corners. */
function zonePolygonForRect(rect: MistwoodRect): readonly ZonePoint[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

const footprintsByLocationId = new Map(
  mistwoodLocationFootprints.map((footprint) => [footprint.id, footprint]),
);

const canonLocations = mistwoodWorldConfiguration.locations.filter((location) => location.active);

function buildBinding(locationId: string, publicLabel: string): LocationVisualBinding {
  const footprint = footprintsByLocationId.get(locationId);
  if (!footprint) {
    throw new LocationVisualBindingError(
      'LOCATION_BINDING_MISSING_LOCATION',
      'has no footprint on the Mistwood map',
      'mistwoodLocationFootprints',
      { locationId },
    );
  }
  const rect = footprint.rect;
  return {
    id: `location-binding-${locationId}`,
    worldId: MISTWOOD_PUBLIC_WORLD_ID,
    mapId: MISTWOOD_MAP_ID,
    locationId,
    zoneType: 'canon-location',
    zonePolygon: zonePolygonForRect(rect),
    entryAnchors: mistwoodEntryAnchorsByLocationId[locationId] ?? [],
    ambientAnchors: mistwoodAmbientAnchorsByLocationId[locationId] ?? [],
    sceneFocusPoint: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    publicLabel,
    status: 'active',
    version: MISTWOOD_LOCATION_BINDING_VERSION,
  };
}

/**
 * Validated at import time: an unknown or unbound Canon location, a degenerate zone, anchors
 * outside their own zone or unreasonably overlapping zones all throw here rather than reaching
 * the Visual Runtime.
 */
export const mistwoodLocationVisualBindings: readonly LocationVisualBinding[] =
  validateLocationVisualBindings(
    canonLocations.map((location) => buildBinding(location.id, location.name)),
    {
      knownLocationIds: mistwoodWorldConfiguration.locations.map((location) => location.id),
      requiredLocationIds: canonLocations.map((location) => location.id),
    },
  );
