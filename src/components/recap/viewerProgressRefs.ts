/**
 * The two viewer-progress function references (FR-H004 / ART-39).
 *
 * Separate from {@link ./useViewerProgress.ts} for the same reason
 * {@link ../vote/environmentVoteRef.ts} is separate from `useEnvironmentVote.ts`: that file
 * carries the write-API exemption from the read-only client boundary, and the exemption is only
 * defensible while the file it covers stays trivial. Naming a function is not writing through it,
 * so the references live here and the exempted file is left with two three-line hooks.
 *
 * They live under `src/components/recap` rather than beside the public page refs because
 * `clientPublic` may not depend on `viewer`; `clientViewerProgress` may, so the type-only imports
 * that keep these references in sync with the real signatures are legal exactly here.
 */

import { publicFunctionRef } from '../../../convex/shared/internalFunctionRef';
import type {
  getViewerProgress as getViewerProgressExport,
  recordViewerProgress as recordViewerProgressExport,
} from '../../../convex/viewer/viewerProgressFunctions';

/**
 * Referenced through {@link publicFunctionRef} rather than `api.viewer.…` for the ART-142 reason
 * every other call site uses it: the generated union is large enough that a deep property access
 * can tip TypeScript's instantiation checker into TS2589 or into silently resolving to `any`.
 */
export const getViewerProgressRef = publicFunctionRef<typeof getViewerProgressExport>(
  'viewer/viewerProgressFunctions:getViewerProgress',
);

export const recordViewerProgressRef = publicFunctionRef<typeof recordViewerProgressExport>(
  'viewer/viewerProgressFunctions:recordViewerProgress',
);
