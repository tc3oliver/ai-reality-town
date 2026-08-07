import { publicFunctionRef } from '../../../convex/shared/internalFunctionRef';
import type { getPublicDynamicProjection as getPublicDynamicProjectionExport } from '../../../convex/publicRead/liveStateFunctions';

/**
 * The one query the live map reads (FR-N003 / ART-115). A `query`, never a
 * mutation or action: opening the map, panning it or focusing a character
 * cannot ask the backend for anything but the already-published projection.
 *
 * Referenced through {@link publicFunctionRef} rather than the generated `api`
 * union, for the TS2589 reason recorded in `convex/shared/internalFunctionRef.ts`.
 */
export const getPublicDynamicProjectionRef = publicFunctionRef<
  typeof getPublicDynamicProjectionExport
>('publicRead/liveStateFunctions:getPublicDynamicProjection');
