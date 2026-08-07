import { publicFunctionRef } from '../../../convex/shared/internalFunctionRef';
import type { getPublicVisualReplay as getPublicVisualReplayExport } from '../../../convex/publicRead/visualReplayFunctions';

/**
 * The Visual Replay read (FR-O013 / ART-121). A `query`, never a mutation or action:
 * auto-playing a replay, skipping it or asking for another cannot ask the backend for
 * anything but the already-published payload.
 *
 * Referenced through {@link publicFunctionRef} rather than the generated `api` union, for the
 * TS2589 reason recorded in `convex/shared/internalFunctionRef.ts`.
 */
export const getPublicVisualReplayRef = publicFunctionRef<
  typeof getPublicVisualReplayExport
>('publicRead/visualReplayFunctions:getPublicVisualReplay');
