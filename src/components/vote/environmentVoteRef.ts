/**
 * The anonymous ballot READ (FR-J001 / ART-45).
 *
 * Separate from {@link ./useEnvironmentVote.ts} on purpose. That file is the one exemption from
 * the read-only client boundary and holds a write; this one is an ordinary public query like
 * the four the homepage already makes, and nothing about it needs an exemption. Keeping them in
 * different files is what lets the homepage read the ballot without importing the module that
 * can write — and lets the boundary check say so at file granularity.
 *
 * It lives under `src/components/vote` rather than beside the other refs because `clientPublic`
 * may not depend on `viewer`; `clientViewerWrite` may, so the type-only import that keeps the
 * reference in sync with the real signature is legal exactly here.
 */

import { publicFunctionRef } from '../../../convex/shared/internalFunctionRef';
import type { getEnvironmentVoteBallot as getEnvironmentVoteBallotExport } from '../../../convex/viewer/environmentVoteFunctions';

export const getEnvironmentVoteBallotRef = publicFunctionRef<typeof getEnvironmentVoteBallotExport>(
  'viewer/environmentVoteFunctions:getEnvironmentVoteBallot',
);
