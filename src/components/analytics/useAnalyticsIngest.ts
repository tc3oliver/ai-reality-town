/**
 * The third — and only other — file in the shipped client that may name a Convex write API
 * (§15 / ART-47).
 *
 * `architecture/module-boundaries.json` forbids `useMutation` everywhere under `src` and grants
 * exactly three exemptions: `src/components/vote/useEnvironmentVote.ts` (ART-45's ballot),
 * `src/components/recap/useViewerProgress.ts` (ART-39's progress record) and this path.
 *
 * The first two sit under `viewerWriteBoundary.clientRoots` and are WORLD-facing: a ballot
 * changes what the world does next, a progress record changes what the product shows this
 * viewer. This one sits under `analyticsWriteBoundary.clientRoots`, which the policy requires to
 * be DISJOINT from those — so no single file can hold both exemptions, and 「viewer telemetry 與
 * world mutation 架構上分離」 is a check rather than a convention.
 *
 * The file is this short on purpose, and `readOnlyWorldSurface.test.ts` enforces that it stays
 * short. It holds no decision, no queue, no identity and not even the function reference — those
 * are in {@link ../../analytics/analyticsQueue.ts}, {@link ./analyticsIdentity.ts} and
 * {@link ./analyticsRefs.ts}, none of which carries an exemption.
 *
 * ## Nothing here fires on page load
 *
 * It returns the bound mutation and invokes nothing. {@link ./AnalyticsTransport.tsx} calls it
 * only when there is a queued batch to send, and a page that is merely opened queues at most the
 * events its own view emitted — so an idle public page still performs zero writes, which is the
 * property ART-127 / ART-137's browser evidence rests on.
 */

import { useMutation } from 'convex/react';

import { recordAnalyticsEventsRef } from './analyticsRefs';

export function useRecordAnalyticsEvents() {
  return useMutation(recordAnalyticsEventsRef);
}
