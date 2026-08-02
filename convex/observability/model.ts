/**
 * Observability domain types (foundation). A trace id threads through a simulation run
 * and the canon commit it produces, so a completed event can be correlated back to the
 * run (and provider) that proposed it. Phase 0 keeps this lightweight; richer tracing
 * (e.g. Langfuse) is integrated later without changing these boundaries.
 */

import type { TraceId } from '../shared/ids';

export type ObservabilityKind =
  | 'commit'
  | 'simulation_run'
  | 'validation_failure';

export type ObservabilityRecord = {
  traceId: TraceId;
  worldId: string;
  kind: ObservabilityKind;
  eventId?: string;
  runId?: string;
  occurredAt: number;
  details?: Record<string, unknown>;
};
