/**
 * Deterministic Fake Simulation Provider (Phase 0).
 *
 *  - No network, no real LLM, no API key.
 *  - Same {@link SimulationInput} always produces the same {@link ProposedEvent} (or the
 *    same thrown error), so tests are fully repeatable.
 *  - The {@link SimulationInput.scenario} selects which behavior to simulate: a valid
 *    event, a structurally invalid event, a transient/permanent provider failure, a
 *    duplicate-key proposal, or a canon-invalid event.
 *
 * The real LLM provider (future) implements the same {@link SimulationProvider}
 * interface; see ADR-0001 and `docs/architecture/target-state.md`.
 */

import { CANON_SCHEMA_VERSION } from '../shared/constants';
import type { ProposedEvent } from '../canon/model';
import type { SimulationProvider } from './provider';
import { SimulationProviderError } from './provider';
import type { SimulationInput } from './model';

/** Build a canon-valid movement proposal from the input fixture context. */
function successProposal(input: SimulationInput): ProposedEvent {
  const summaries = [
    `${input.characterId} travels from ${input.fromLocationId} to ${input.toLocationId}`,
    `${input.characterId} makes their way from ${input.fromLocationId} to ${input.toLocationId}`,
    `${input.characterId} leaves ${input.fromLocationId} for ${input.toLocationId}`,
  ] as const;
  const summary = summaries[Math.abs(input.seed) % summaries.length];
  return {
    schemaVersion: CANON_SCHEMA_VERSION,
    worldId: input.worldId,
    idempotencyKey: input.idempotencyKey,
    proposedBy: input.proposedBy,
    worldDay: input.worldDay,
    timeSlot: input.timeSlot,
    eventType: 'movement',
    participantIds: [input.characterId],
    causedByEventIds: [],
    publicSummary: summary,
    stateChanges: [
      {
        type: 'character_location_changed',
        characterId: input.characterId,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
      },
    ],
  };
}

/** Build a proposal that passes structural validation but fails canon validation
 *  (a self-relationship), regardless of projection state. */
function canonFailingProposal(input: SimulationInput): ProposedEvent {
  return {
    schemaVersion: CANON_SCHEMA_VERSION,
    worldId: input.worldId,
    idempotencyKey: input.idempotencyKey,
    proposedBy: input.proposedBy,
    worldDay: input.worldDay,
    timeSlot: input.timeSlot,
    eventType: 'relationship_change',
    participantIds: [input.characterId],
    causedByEventIds: [],
    publicSummary: `${input.characterId} reflects on themselves`,
    stateChanges: [
      {
        type: 'relationship_changed',
        // source === target is a deliberate canon violation (INVALID_RELATIONSHIP_TARGET).
        sourceCharacterId: input.characterId,
        targetCharacterId: input.characterId,
        trustDelta: 1,
        affectionDelta: 0,
        resentmentDelta: 0,
        reason: 'self-relationship is not allowed',
      },
    ],
  };
}

/** Build a structurally invalid proposal (empty stateChanges). */
function invalidProposal(input: SimulationInput): ProposedEvent {
  return {
    schemaVersion: CANON_SCHEMA_VERSION,
    worldId: input.worldId,
    idempotencyKey: input.idempotencyKey,
    proposedBy: input.proposedBy,
    worldDay: input.worldDay,
    timeSlot: input.timeSlot,
    eventType: 'movement',
    participantIds: [input.characterId],
    causedByEventIds: [],
    stateChanges: [],
  } as unknown as ProposedEvent;
}

export class FakeSimulationProvider implements SimulationProvider {
  readonly name = 'fake' as const;

  proposeEvent(input: SimulationInput): Promise<ProposedEvent> {
    if (!Number.isSafeInteger(input.seed)) {
      return Promise.reject(
        new SimulationProviderError('permanent', 'FAKE_INVALID_SEED', 'fake seed must be a safe integer'),
      );
    }
    switch (input.scenario) {
      case 'transient_failure':
        return Promise.reject(
          new SimulationProviderError('transient', 'FAKE_TRANSIENT', 'fake transient provider failure'),
        );
      case 'permanent_failure':
        return Promise.reject(
          new SimulationProviderError('permanent', 'FAKE_PERMANENT', 'fake permanent provider failure'),
        );
      case 'invalid_event':
        return Promise.resolve(invalidProposal(input));
      case 'canon_failure':
        return Promise.resolve(canonFailingProposal(input));
      case 'duplicate_key':
      // Same as success from the provider's view; the dedup happens at the canon commit
      // when the idempotency key is already present.
      case 'success':
      default:
        return Promise.resolve(successProposal(input));
    }
  }
}
