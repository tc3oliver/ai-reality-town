/**
 * The analytics ingest function reference (§15 / ART-47).
 *
 * Separate from {@link ./useAnalyticsIngest.ts} for the reason {@link ../recap/viewerProgressRefs.ts}
 * is separate from `useViewerProgress.ts`: that file carries the write-API exemption from the
 * read-only client boundary, and the exemption is only defensible while the file it covers stays
 * trivial. Naming a function is not writing through it, so the reference lives here and the
 * exempted file is left with one three-line hook.
 */

import { publicFunctionRef } from '../../../convex/shared/internalFunctionRef';
import type { recordAnalyticsEvents as recordAnalyticsEventsExport } from '../../../convex/analytics/ingestFunctions';

/**
 * Referenced through {@link publicFunctionRef} rather than `api.analytics.…` for the ART-142
 * reason every other call site uses it: the generated union is large enough that a deep property
 * access can tip TypeScript's instantiation checker into TS2589 or into silently resolving to
 * `any`.
 */
export const recordAnalyticsEventsRef = publicFunctionRef<typeof recordAnalyticsEventsExport>(
  'analytics/ingestFunctions:recordAnalyticsEvents',
);
