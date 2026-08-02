/**
 * Simulation run record and run-state helpers (pure).
 */

import type {
  SimulationProviderName,
  SimulationRunStatus,
  SimulationRunType,
} from './model';

/** A simulationRuns row, mirrored as a pure domain type. */
export type SimulationRunRecord = {
  worldId: string;
  runType: SimulationRunType;
  status: SimulationRunStatus;
  startedAt: number;
  completedAt?: number;
  errorCode?: string;
  errorMessage?: string;
  errorPath?: string;
  errorDetails?: Record<string, unknown>;
  provider: SimulationProviderName;
  traceId: string;
  /** Event committed by this run, when it reached `completed`. */
  committedEventId?: string;
  sequenceNumber?: number;
};

export const TERMINAL_RUN_STATUSES: readonly SimulationRunStatus[] = [
  'completed',
  'failed',
  'cancelled',
];

export function isTerminalRunStatus(status: SimulationRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

/** True for a status from which a run should not transition further. */
export function isValidTransition(from: SimulationRunStatus, to: SimulationRunStatus): boolean {
  if (from === to) return false;
  if (isTerminalRunStatus(from)) return false;
  const allowed: Record<SimulationRunStatus, SimulationRunStatus[]> = {
    pending: ['running', 'cancelled', 'failed'],
    running: ['completed', 'failed', 'cancelled'],
    completed: [],
    failed: [],
    cancelled: [],
  };
  return allowed[from].includes(to);
}
