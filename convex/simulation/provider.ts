/**
 * Simulation provider interface and shared error type.
 *
 * A provider's ONLY job is to turn a {@link SimulationInput} into a {@link ProposedEvent}.
 * Providers must never write to canon tables directly — every accepted change goes
 * through the commit pipeline.
 */

import type { ProposedEvent } from '../canon/model';
import type { SimulationInput, SimulationProviderName } from './model';

/** A provider error, tagged transient vs permanent so callers can decide to retry. */
export class SimulationProviderError extends Error {
  readonly kind: 'transient' | 'permanent';
  readonly code: string;

  constructor(kind: 'transient' | 'permanent', code: string, message: string) {
    super(message);
    this.name = 'SimulationProviderError';
    this.kind = kind;
    this.code = code;
  }
}

export const isTransientProviderError = (e: unknown): boolean =>
  e instanceof SimulationProviderError && e.kind === 'transient';

/** Anything that can propose events. The fake provider (Phase 0) and future LLM provider
 *  both implement this. */
export interface SimulationProvider {
  readonly name: SimulationProviderName;
  proposeEvent(input: SimulationInput): Promise<ProposedEvent>;
}
