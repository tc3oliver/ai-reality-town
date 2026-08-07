import { useEffect, useState } from 'react';

import {
  baseSpriteAssets,
  paletteVariantAssetKeys,
  resolveVariantSpriteAsset,
} from './spriteAssets';
import type { ReadOnlySpriteAsset } from '../world/worldViewModel';

/**
 * The `assetKey -> sheet` map the renderer draws from (ART-119 / FR-O002 AC#1).
 *
 * Base sprites are in the first returned value, so eight of the twelve residents
 * are drawable on the first render. The four palette variants need a texture
 * decoded and recoloured, so they arrive over the following frames and the map
 * fills in — rather than the whole cast waiting on the slowest asset.
 *
 * Purely local work: decoding a bundled image touches no network beyond the
 * asset request the page would have made anyway, and issues no query. That is
 * what keeps this hook inside `readOnlyClientBoundary` alongside
 * {@link ./useMotionClock}.
 */
export function useSpriteAssets(): Readonly<Record<string, ReadOnlySpriteAsset>> {
  const [assets, setAssets] = useState<Record<string, ReadOnlySpriteAsset>>(baseSpriteAssets);

  useEffect(() => {
    let mounted = true;
    for (const assetKey of paletteVariantAssetKeys()) {
      void resolveVariantSpriteAsset(assetKey).then((asset) => {
        if (!mounted || asset === undefined) return;
        setAssets((previous) => ({ ...previous, [assetKey]: asset }));
      });
    }
    return () => {
      mounted = false;
    };
  }, []);

  return assets;
}
