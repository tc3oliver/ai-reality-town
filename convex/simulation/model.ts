/**
 * Simulation domain types (pure — no Convex imports).
 *
 * A simulation provider only ever PROPOSES events; it never writes to canon tables.
 * Phase 0 ships a single deterministic fake provider; the real LLM provider is a later,
 * pluggable implementation of the same {@link SimulationProvider} interface.
 */

import type { ProposedBy } from '../canon/model';
import type { TimeSlot } from '../canon/eventTypes';

export type SimulationRunType = 'foundation' | 'tick' | 'episode';
export const SIMULATION_RUN_TYPES: readonly SimulationRunType[] = ['foundation', 'tick', 'episode'];

export type SimulationRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';
export const SIMULATION_RUN_STATUSES: readonly SimulationRunStatus[] = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
];

export type SimulationProviderName = 'fake' | 'llm';

/** Scenarios the FakeSimulationProvider can simulate, for deterministic testing. */
export type FakeScenario =
  | 'success'
  | 'invalid_event'
  | 'transient_failure'
  | 'permanent_failure'
  | 'duplicate_key'
  | 'canon_failure';
export const FAKE_SCENARIOS: readonly FakeScenario[] = [
  'success',
  'invalid_event',
  'transient_failure',
  'permanent_failure',
  'duplicate_key',
  'canon_failure',
];

/**
 * Input to a simulation run. Carries enough fixture context for the fake provider to
 * produce a canon-valid (or deliberately invalid) proposal. The provider never reads
 * the projection — the caller supplies the movement context.
 */
export type SimulationInput = {
  /** Fixed integer controlling deterministic fake/model sampling in tests and replay. */
  seed: number;
  worldId: string;
  worldDay: number;
  timeSlot: TimeSlot;
  idempotencyKey: string;
  traceId: string;
  scenario: FakeScenario;

  proposedBy: ProposedBy;

  characterId: string;
  /** Character's current location; must match the projection for a canon-valid movement. */
  fromLocationId: string;
  toLocationId: string;
  /** Second character referenced by relationship scenarios. */
  partnerCharacterId: string;
};

/** Outcome of executing one foundation run (pure orchestration result). */
export type FoundationRunOutcome = {
  status: 'completed' | 'failed';
  eventId?: string;
  sequenceNumber?: number;
  deduplicated?: boolean;
  errorCode?: string;
  errorMessage?: string;
  errorPath?: string;
  errorDetails?: Record<string, unknown>;
  attempts?: number;
};
