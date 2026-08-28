/**
 * The second — and only other — file in the shipped client that may name a Convex write API
 * (FR-H004 / ART-39).
 *
 * `architecture/module-boundaries.json` forbids `useMutation` everywhere under `src` and grants
 * exactly two exemptions: `src/components/vote/useEnvironmentVote.ts` (ART-45's ballot) and this
 * path. `viewerWriteBoundary.clientRoots` additionally requires that such an exemption can only
 * be granted inside a declared client root, so the homepage, `/live`, the world surface and every
 * public page stay provably unable to write by the same check that always covered them.
 *
 * The file is this short on purpose, and `readOnlyWorldSurface.test.ts` enforces that it stays
 * short. It holds no decision, no view model, no copy and not even the function references —
 * those are in {@link ./returnRecap.ts} and {@link ./viewerProgressRefs.ts}, which carry no
 * exemption. Anything added here is code living inside one of the two write exemptions in the
 * product, and should be somewhere else.
 *
 * ## Nothing here fires on page load
 *
 * `useRecordViewerProgress` returns the bound mutation and invokes nothing. The recap route calls
 * it only from an explicit control — following a character, changing spoiler mode, marking a
 * position. That is what keeps `#recap/<worldId>` a page that performs zero writes when it is
 * merely opened, which is the property ART-127 / ART-137's browser evidence rests on for every
 * other public surface.
 */

import { useMutation, useQuery } from 'convex/react';

import { getViewerProgressRef, recordViewerProgressRef } from './viewerProgressRefs';
import type { RecapProgress } from './returnRecap';

/**
 * This device's stored progress, or `undefined` while the read is in flight.
 *
 * `deviceKey` may be `null` — a private-mode window where `localStorage` throws — and the read is
 * skipped rather than sent with a placeholder. A recap with no key renders its no-progress state,
 * which is a true statement about that browser.
 */
export function useStoredViewerProgress(
  worldId: string | null,
  deviceKey: string | null,
): RecapProgress | null | undefined {
  const args = worldId !== null && deviceKey !== null ? { worldId, deviceKey } : 'skip';
  return useQuery(getViewerProgressRef, args);
}

/** The bound mutation. Callers own every decision about when — and whether — to invoke it. */
export function useRecordViewerProgress() {
  return useMutation(recordViewerProgressRef);
}
