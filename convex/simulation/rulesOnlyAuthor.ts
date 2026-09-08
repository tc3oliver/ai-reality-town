/**
 * Rung 4 of the FR-M004 ladder: 「僅執行規則型背景事件」 (ART-91).
 *
 * Pure: no Convex, no clock, no randomness, no provider. Given the same stage-1 world snapshot the
 * Director planned against, it derives Proposed Events from world state alone.
 *
 * ## What this is NOT
 *
 * It is not the deterministic fake author. That one narrates a scene — it invents what people said
 * and what it meant, and it exists so the pipeline can be exercised without a model. Serving its
 * output during a real outage would put invented narration into Canon and into the public record
 * with nothing marking it as such, which is the failure FR-M004's own wording avoids by saying
 * 「規則型背景事件」 rather than 「用便宜的模型寫」.
 *
 * So a rules-only event asserts only things the world already implies: someone is where they are,
 * and time passed. It carries a factual public summary naming the location and the world day, and
 * it proposes no relationship change, no memory, no knowledge and no rumor — every one of those
 * would be an interpretation, and there is nothing here qualified to make one.
 *
 * ## Why it is still a PROPOSAL
 *
 * FR-M004 forbids skipping Canon Validation, Safety Validation, Idempotency and Event Persistence,
 * and the cheapest way to break that would be to write "rules-derived" events straight into Canon
 * on the grounds that the rules already guarantee them. These are proposals, they carry
 * `idempotencyKey`s derived from the slot exactly as authored proposals do, and they travel the
 * same `validate_structured_output` → `validate_canon` → `commit_accepted_events` path. The
 * precedent is FR-J001's viewer-vote environment events, which have always been proposals.
 *
 * ## Idempotency
 *
 * `rules:<worldId>:<worldDay>:<timeSlot>:event:<n>` — derived, like every other id on this path,
 * so a retried slot re-derives the same keys and `commitProposedEvent` deduplicates them. A slot
 * that ran rules-only and is later retried at a recovered level proposes DIFFERENT keys, and both
 * sets are legitimate: the rules-only events were what the world could say at the time.
 */

import { CANON_SCHEMA_VERSION, MAX_PUBLIC_SUMMARY_LENGTH } from '../shared/constants';
import type { ProposedEvent } from '../canon/model';
import type { TimeSlot } from '../canon/eventTypes';

/** What a rules-only slot needs to know about the world. A subset of the stage-1 snapshot. */
export type RulesOnlyContext = {
  worldId: string;
  worldDay: number;
  timeSlot: TimeSlot;
  /** The run that produced this slot, recorded as the proposer. */
  directorRunId: string;
  /** Characters and where the projection says they are, ascending by character id. */
  placements: ReadonlyArray<{ characterId: string; locationId: string }>;
  /**
   * The rung that produced this slot (ART-165). Two rungs are rules-only — `rules_only` and
   * `deferred_summaries` — and stamping the constant `'rules_only'` on both would make an event
   * authored at the deeper rung indistinguishable from one authored at the shallower.
   */
  degradationLevel?: 'rules_only' | 'deferred_summaries';
};

/**
 * How many rules-only events a slot proposes.
 *
 * One per occupied location, capped. A rules-only slot exists to keep world time moving and to
 * leave a factual record that it did; proposing one per CHARACTER would fill Canon with a dozen
 * near-identical events a day for as long as the outage lasts, which is a different kind of damage
 * from stopping.
 */
export const MAX_RULES_ONLY_EVENTS_PER_SLOT = 2;

const summaryText = (value: string): string =>
  (value.length <= MAX_PUBLIC_SUMMARY_LENGTH ? value : `${value.slice(0, MAX_PUBLIC_SUMMARY_LENGTH - 1).trimEnd()}…`);

/** zh-Hant, matching every other public string; factual, and it says what it is. */
const SLOT_LABEL: Readonly<Record<TimeSlot, string>> = {
  morning: '上午', noon: '中午', afternoon: '下午', evening: '傍晚', night: '夜間',
};

/**
 * Derive one slot's rules-only Proposed Events.
 *
 * Deterministic in the strict sense: the same context always yields the same events, in the same
 * order, with the same keys. Locations are taken in sorted order rather than in snapshot order so
 * the output does not depend on how the caller happened to build the list.
 */
export function deriveRulesOnlyEvents(context: RulesOnlyContext): ProposedEvent[] {
  const byLocation = new Map<string, string[]>();
  for (const { characterId, locationId } of context.placements) {
    byLocation.set(locationId, [...(byLocation.get(locationId) ?? []), characterId]);
  }
  const occupied = [...byLocation.entries()]
    .map(([locationId, characterIds]) => ({ locationId, characterIds: [...characterIds].sort() }))
    .filter(({ characterIds }) => characterIds.length > 0)
    .sort((left, right) => right.characterIds.length - left.characterIds.length
      || left.locationId.localeCompare(right.locationId))
    .slice(0, MAX_RULES_ONLY_EVENTS_PER_SLOT);

  return occupied.map(({ locationId, characterIds }, index) => ({
    schemaVersion: CANON_SCHEMA_VERSION,
    worldId: context.worldId,
    idempotencyKey: `rules:${context.worldId}:${context.worldDay}:${context.timeSlot}:event:${index + 1}`,
    proposedBy: { type: 'system' as const, id: context.directorRunId },
    worldDay: context.worldDay,
    timeSlot: context.timeSlot,
    // `world_event`, not `conversation`: nothing here observed anyone talking, and claiming a
    // conversation happened would be exactly the invention this rung exists to avoid.
    eventType: 'world_event' as const,
    locationId,
    participantIds: [...characterIds],
    causedByEventIds: [],
    publicSummary: summaryText(
      `${SLOT_LABEL[context.timeSlot]}的 ${locationId} 一如往常，`
      + `在場的 ${characterIds.length} 人各自照著原本的安排行事，沒有新的進展被記錄下來。`,
    ),
    // Exactly one state change, and it asserts only that the slot passed at this place. No
    // relationship, memory, knowledge or rumor: every one of those would be an interpretation.
    stateChanges: [{
      type: 'fact_created' as const,
      subjectType: 'location' as const,
      subjectId: locationId,
      predicate: 'lastRoutineSlot',
      value: `${context.worldDay}:${context.timeSlot}`,
      visibility: 'public' as const,
    }],
    // Marked as what it is, so anything downstream can tell a rules-only event from an authored
    // one without guessing from its shape.
    metadata: { authoring: 'rules_only', degradationLevel: context.degradationLevel ?? 'rules_only' },
  }));
}
