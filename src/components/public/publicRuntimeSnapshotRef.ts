import { publicFunctionRef } from '../../../convex/shared/internalFunctionRef';
import type { getPublicRuntimeSnapshot as getPublicRuntimeSnapshotExport } from '../../../convex/publicRead/runtimeSnapshotFunctions';

/**
 * The runtime snapshot read (FR-N007 / ART-116), used by ART-131 to render a freshness badge.
 *
 * A `query`, and one already on the `publicFunctionSurface` allowlist as `anonymous` — reading it
 * cannot ask the world for anything, and it takes no `nowMs`: ART-128 removed that argument
 * precisely so a caller could not name the instant and make a five-hour-old snapshot report
 * `live`. The server clock decides, which is what makes the badge worth showing at all.
 *
 * Referenced through {@link publicFunctionRef} rather than the generated `api` union, for the
 * TS2589 reason recorded in `convex/shared/internalFunctionRef.ts`.
 */
export const getPublicRuntimeSnapshotRef = publicFunctionRef<
  typeof getPublicRuntimeSnapshotExport
>('publicRead/runtimeSnapshotFunctions:getPublicRuntimeSnapshot');
