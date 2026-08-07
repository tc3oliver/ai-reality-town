import { PixiComponent } from '@pixi/react';
import * as PIXI from 'pixi.js';

import type { MistwoodLocationFootprint } from '../../../data/mistwood';

export interface MapZoneLayerProps {
  /** The eight canonical Mistwood locations, in tile coordinates. */
  footprints: readonly MistwoodLocationFootprint[];
  /** `collision[x][y]`, `1` blocking. Same grid the Visual Runtime plans against. */
  collision: readonly (readonly number[])[];
  tileDim: number;
  /** Off by default: the collision tint is a diagnostic overlay, not the default frame. */
  showCollision?: boolean;
}

const ZONE_OUTLINE = 0xffffff;
const ZONE_FILL = 0xffffff;
const COLLISION_TINT = 0x1b2a4a;
const LABEL_STYLE = {
  fontFamily: 'VCR OSD Mono, monospace',
  fontSize: 14,
  fill: 0xffffff,
  stroke: 0x1b2a4a,
  strokeThickness: 3,
} as const;

function drawZones(container: PIXI.Container, props: MapZoneLayerProps): void {
  const { footprints, collision, tileDim, showCollision = false } = props;

  if (showCollision) {
    const blocked = new PIXI.Graphics();
    blocked.beginFill(COLLISION_TINT, 0.28);
    for (let x = 0; x < collision.length; x += 1) {
      const column = collision[x];
      for (let y = 0; y < column.length; y += 1) {
        if (column[y] === 1) blocked.drawRect(x * tileDim, y * tileDim, tileDim, tileDim);
      }
    }
    blocked.endFill();
    container.addChild(blocked);
  }

  for (const footprint of footprints) {
    const { x, y, width, height } = footprint.rect;
    const outline = new PIXI.Graphics();
    outline.beginFill(ZONE_FILL, 0.06);
    outline.lineStyle({ width: 1, color: ZONE_OUTLINE, alpha: 0.55, alignment: 0 });
    outline.drawRect(x * tileDim, y * tileDim, width * tileDim, height * tileDim);
    outline.endFill();
    container.addChild(outline);

    const label = new PIXI.Text(footprint.name, LABEL_STYLE);
    label.anchor.set(0.5, 1);
    label.x = (x + width / 2) * tileDim;
    label.y = y * tileDim - 2;
    container.addChild(label);
  }
}

/**
 * The location and collision overlay (ART-118 / FR-O001 AC#2).
 *
 * Draws the eight Mistwood footprints as labelled outlines so a viewer can tell
 * where the canonical locations are, plus an optional tint of the collision
 * grid the Visual Runtime plans movement against.
 *
 * Like every other display object in this module it is `eventMode: 'none'` with
 * `interactiveChildren: false`: a click on a zone reaches nothing. Focusing a
 * location is a DOM button in `components/live/CameraControls.tsx`, which is
 * also what makes it keyboard-reachable.
 */
export const MapZoneLayer = PixiComponent('MapZoneLayer', {
  create: (props: MapZoneLayerProps) => {
    const container = new PIXI.Container();
    container.eventMode = 'none';
    container.interactiveChildren = false;
    drawZones(container, props);
    return container;
  },
  applyProps: (container: PIXI.Container, oldProps: MapZoneLayerProps, newProps: MapZoneLayerProps) => {
    const unchanged =
      oldProps.footprints === newProps.footprints &&
      oldProps.collision === newProps.collision &&
      oldProps.tileDim === newProps.tileDim &&
      oldProps.showCollision === newProps.showCollision;
    if (unchanged) return;
    container.removeChildren().forEach((child) => child.destroy());
    drawZones(container, newProps);
  },
});
