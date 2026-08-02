/**
 * Trace id helpers (pure). A trace id is carried through the workflow → commit path so
 * every observability record for one logical action shares an id.
 */

import { EMPTY_TRACE_ID, type TraceId } from '../shared/ids';

/** Coerce an arbitrary trace id to a non-empty {@link TraceId}, using a sentinel if absent. */
export function normalizeTraceId(traceId: string | undefined | null): TraceId {
  return traceId && traceId.trim().length > 0 ? traceId : EMPTY_TRACE_ID;
}
