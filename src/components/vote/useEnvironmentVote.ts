/**
 * The ONLY file in the shipped client that may name a Convex write API (FR-J001 / ART-45).
 *
 * `architecture/module-boundaries.json` forbids `useMutation` everywhere under `src` and grants
 * exactly one exemption — this path, this symbol. `viewerWriteBoundary.clientRoots` additionally
 * requires that such an exemption can only ever be granted inside `src/components/vote`, so the
 * homepage, `/live`, the world surface and every public page stay provably unable to write by
 * the same check that always covered them. Nothing else changed about that guarantee; it is
 * enforced here at file granularity instead of at repository granularity.
 *
 * The file is this short on purpose. It holds no decision, no view model and no copy — those are
 * in {@link ./environmentVoteModel.ts}, which is pure and unit-tested. Anything added here is
 * code living inside the one exemption in the product, and should be somewhere else.
 */

import { useMutation } from 'convex/react';

import { publicFunctionRef } from '../../../convex/shared/internalFunctionRef';
import type { submitEnvironmentVote as submitEnvironmentVoteExport } from '../../../convex/viewer/environmentVoteFunctions';

/**
 * Referenced through {@link publicFunctionRef} rather than `api.viewer.…` for the ART-142
 * reason every other call site uses it: the generated union is large enough that a deep
 * property access can tip TypeScript's instantiation checker into TS2589 or into silently
 * resolving to `any`.
 */
export const submitEnvironmentVoteRef = publicFunctionRef<typeof submitEnvironmentVoteExport>(
  'viewer/environmentVoteFunctions:submitEnvironmentVote',
);

export type SubmitEnvironmentVote = (args: {
  worldId: string;
  deviceKey: string;
  candidateId: string;
}) => Promise<{ accepted: boolean; code: string | null }>;

/** The bound mutation. Callers own every decision about when — and whether — to invoke it. */
export function useEnvironmentVote(): SubmitEnvironmentVote {
  return useMutation(submitEnvironmentVoteRef);
}
