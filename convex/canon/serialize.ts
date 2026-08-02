/**
 * (De)serialization between stored canonEvents rows and the domain {@link AcceptedEvent}.
 *
 * The stored row keeps the *proposed* event as `payload` (no envelope) and carries the
 * envelope (sequenceNumber, acceptedAt, validationVersion) as top-level columns. Convex
 * infers the payload's union fields (timeSlot, eventType, …) as `string`, so we cast to
 * the stricter domain types on read. This cast is sound: every row is inserted through
 * the commit pipeline, which runs {@link validateEventStructure} enforcing the literal
 * unions at runtime.
 */

import { deriveEventId } from '../shared/ids';
import type { AcceptedEvent } from './model';

/** Shape of a canonEvents row relevant to reconstruction. */
export type CanonEventRow = {
  payload: unknown;
  worldId: string;
  sequenceNumber: number;
  acceptedAt: number;
  validationVersion: string;
};

/** Reconstruct an {@link AcceptedEvent} from a stored canonEvents row. */
export function rowToAcceptedEvent(row: CanonEventRow): AcceptedEvent {
  const proposed = row.payload as AcceptedEvent;
  return {
    ...proposed,
    eventId: deriveEventId(row.worldId, row.sequenceNumber),
    acceptedAt: row.acceptedAt,
    sequenceNumber: row.sequenceNumber,
    validationVersion: row.validationVersion,
  };
}
