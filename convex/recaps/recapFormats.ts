/**
 * Three-level episode recap formats (FR-G003).
 *
 * Defines the four required public-recap formats — Quick, Standard, Deep, and a
 * runtime-validated Machine Summary — plus deterministic derivation of the
 * Machine Summary from Accepted Events, and validation enforcing the PRD length
 * and field requirements.
 *
 * Pure module — no Convex imports, no canon mutation. Every format traces its
 * content to accepted source events; nothing here can edit or delete Canon.
 */

import type { AcceptedEvent } from '../canon/model';

export const QUICK_RECAP_MIN = 80;
export const QUICK_RECAP_MAX = 150;
export const STANDARD_RECAP_MIN = 400;
export const STANDARD_RECAP_MAX = 800;

/** The seven required FR-G003 Machine Summary fields. */
export type StoryArcProgress = { arcId: string; progress: string };

export type MachineSummary = {
  schemaVersion: 1;
  whatChanged: string[];
  whyItHappened: string[];
  whoIsAffected: string[];
  newQuestions: string[];
  resolvedQuestions: string[];
  requiredPriorFacts: string[];
  storyArcProgress: StoryArcProgress[];
};

export type RecapFormats = {
  schemaVersion: 1;
  quickRecap: string;
  standardRecap: string;
  deepRecap: string;
  machineSummary: MachineSummary;
  /** Every accepted event the recaps were derived from. */
  sourceEventIds: string[];
};

export class RecapFormatError extends Error {
  constructor(readonly code: string, message: string, readonly path?: string) {
    super(`[${code}] ${message}`);
    this.name = 'RecapFormatError';
  }
}

/** Count CJK Unified Ideograph characters (the FR-G003 length unit is 中文字). */
export function countChineseCharacters(text: string): number {
  if (typeof text !== 'string') return 0;
  const matches = text.match(/[一-鿿]/g);
  return matches ? matches.length : 0;
}

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const stringArray = (value: unknown, path: string): string[] => {
  if (!Array.isArray(value)) throw new RecapFormatError('RECAP_FORMAT_INVALID', 'must be an array', path);
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new RecapFormatError('RECAP_FORMAT_INVALID', 'must be a non-empty string', `${path}[${index}]`);
    }
    return entry;
  });
};

/** Optional arc context feeding the question/arc-progress Machine Summary fields. */
export type RecapArcContext = {
  newQuestions?: string[];
  resolvedQuestions?: string[];
  storyArcProgress?: StoryArcProgress[];
};

/** Derive the canonical factId for a `fact_created` change at index `index`. */
export function deriveFactId(eventId: string, index: number): string {
  return `${eventId}:fact:${index}`;
}

/**
 * Deterministically derive the Machine Summary from a set of Accepted Events.
 * `whatChanged` follows each event's public summary; `whyItHappened` its causal
 * sources; `whoIsAffected` the union of participants; `requiredPriorFacts` the
 * public facts the events create. Arc-driven fields come from {@link context}
 * (later pipeline stages supply them).
 */
export function buildMachineSummary(
  events: readonly AcceptedEvent[],
  context: RecapArcContext = {},
): MachineSummary {
  const whatChanged = events
    .map((event) => event.publicSummary)
    .filter(nonempty);
  const whyItHappened = unique(events.flatMap((event) => event.causedByEventIds)).filter(nonempty);
  const whoIsAffected = unique(events.flatMap((event) => event.participantIds));
  const requiredPriorFacts = unique(
    events.flatMap((event) =>
      event.stateChanges.map((change, index) =>
        change.type === 'fact_created' && change.visibility === 'public'
          ? deriveFactId(event.eventId, index)
          : null,
      ),
    ),
  ).filter(nonempty);
  return {
    schemaVersion: 1,
    whatChanged,
    whyItHappened,
    whoIsAffected,
    newQuestions: context.newQuestions ?? [],
    resolvedQuestions: context.resolvedQuestions ?? [],
    requiredPriorFacts,
    storyArcProgress: context.storyArcProgress ?? [],
  };
}

/** Deterministically compose the Deep Recap: a causal event list over accepted events. */
export function buildDeepRecap(events: readonly AcceptedEvent[]): string {
  if (events.length === 0) return '';
  return events
    .map((event) => {
      const cause = event.causedByEventIds.length > 0 ? `（起因：${event.causedByEventIds.join('、')}）` : '';
      const participants = event.participantIds.length > 0 ? ` 參與者：${event.participantIds.join('、')}` : '';
      return `- ${event.publicSummary ?? event.eventType}${participants}${cause}`;
    })
    .join('\n');
}

function parseMachineSummary(value: unknown): MachineSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RecapFormatError('RECAP_FORMAT_INVALID', 'machineSummary must be an object', 'machineSummary');
  }
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1) {
    throw new RecapFormatError('RECAP_FORMAT_INVALID', 'unsupported machineSummary schema version', 'machineSummary.schemaVersion');
  }
  const allowed = [
    'schemaVersion', 'whatChanged', 'whyItHappened', 'whoIsAffected', 'newQuestions',
    'resolvedQuestions', 'requiredPriorFacts', 'storyArcProgress',
  ];
  const unknownKey = Object.keys(row).find((key) => !allowed.includes(key));
  if (unknownKey) throw new RecapFormatError('RECAP_FORMAT_INVALID', `unknown field ${unknownKey}`, `machineSummary.${unknownKey}`);
  const storyArcProgress = (() => {
    if (!Array.isArray(row.storyArcProgress)) {
      throw new RecapFormatError('RECAP_FORMAT_INVALID', 'must be an array', 'machineSummary.storyArcProgress');
    }
    return row.storyArcProgress.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new RecapFormatError('RECAP_FORMAT_INVALID', 'must be an object', `machineSummary.storyArcProgress[${index}]`);
      }
      const item = entry as Record<string, unknown>;
      const itemAllowed = ['arcId', 'progress'];
      if (Object.keys(item).some((key) => !itemAllowed.includes(key))) {
        throw new RecapFormatError('RECAP_FORMAT_INVALID', 'unknown field', `machineSummary.storyArcProgress[${index}]`);
      }
      if (!nonempty(item.arcId) || !nonempty(item.progress)) {
        throw new RecapFormatError('RECAP_FORMAT_INVALID', 'arcId and progress must be non-empty strings', `machineSummary.storyArcProgress[${index}]`);
      }
      return { arcId: item.arcId, progress: item.progress };
    });
  })();
  return {
    schemaVersion: 1,
    whatChanged: stringArray(row.whatChanged, 'machineSummary.whatChanged'),
    whyItHappened: stringArray(row.whyItHappened, 'machineSummary.whyItHappened'),
    whoIsAffected: stringArray(row.whoIsAffected, 'machineSummary.whoIsAffected'),
    newQuestions: stringArray(row.newQuestions, 'machineSummary.newQuestions'),
    resolvedQuestions: stringArray(row.resolvedQuestions, 'machineSummary.resolvedQuestions'),
    requiredPriorFacts: stringArray(row.requiredPriorFacts, 'machineSummary.requiredPriorFacts'),
    storyArcProgress,
  };
}

/**
 * Validate the four recap formats against FR-G003. Returns a deep clone on
 * success; throws {@link RecapFormatError} on the first violation.
 *
 * - AC#1 Quick Recap: {@link QUICK_RECAP_MIN}–{@link QUICK_RECAP_MAX} 中文字.
 * - AC#2 Standard Recap: {@link STANDARD_RECAP_MIN}–{@link STANDARD_RECAP_MAX} 中文字.
 * - AC#3 Deep Recap: non-empty causal event list.
 * - AC#4 Machine Summary: seven runtime-validated structured fields.
 * - AC#5 Traceability: every sourceEventId resolves to an accepted event.
 */
export function validateRecapFormats(
  formats: unknown,
  acceptedEvents: readonly AcceptedEvent[],
): RecapFormats {
  if (!formats || typeof formats !== 'object' || Array.isArray(formats)) {
    throw new RecapFormatError('RECAP_FORMAT_INVALID', 'recap formats must be an object');
  }
  const row = formats as Record<string, unknown>;
  if (row.schemaVersion !== 1) {
    throw new RecapFormatError('RECAP_FORMAT_INVALID', 'unsupported schema version', 'schemaVersion');
  }
  const allowed = ['schemaVersion', 'quickRecap', 'standardRecap', 'deepRecap', 'machineSummary', 'sourceEventIds'];
  const unknownKey = Object.keys(row).find((key) => !allowed.includes(key));
  if (unknownKey) throw new RecapFormatError('RECAP_FORMAT_INVALID', `unknown field ${unknownKey}`, unknownKey);

  const quickRecap = typeof row.quickRecap === 'string' ? row.quickRecap : '';
  const quickCount = countChineseCharacters(quickRecap);
  if (quickCount < QUICK_RECAP_MIN || quickCount > QUICK_RECAP_MAX) {
    throw new RecapFormatError(
      'RECAP_QUICK_LENGTH',
      `Quick Recap must be ${QUICK_RECAP_MIN}–${QUICK_RECAP_MAX} 中文字 (got ${quickCount})`,
      'quickRecap',
    );
  }

  const standardRecap = typeof row.standardRecap === 'string' ? row.standardRecap : '';
  const standardCount = countChineseCharacters(standardRecap);
  if (standardCount < STANDARD_RECAP_MIN || standardCount > STANDARD_RECAP_MAX) {
    throw new RecapFormatError(
      'RECAP_STANDARD_LENGTH',
      `Standard Recap must be ${STANDARD_RECAP_MIN}–${STANDARD_RECAP_MAX} 中文字 (got ${standardCount})`,
      'standardRecap',
    );
  }

  const deepRecap = typeof row.deepRecap === 'string' ? row.deepRecap : '';
  if (deepRecap.trim().length === 0) {
    throw new RecapFormatError('RECAP_DEEP_EMPTY', 'Deep Recap must contain a causal event list', 'deepRecap');
  }

  const machineSummary = parseMachineSummary(row.machineSummary);

  const sourceEventIds = stringArray(row.sourceEventIds, 'sourceEventIds');
  const accepted = new Set(acceptedEvents.map((event) => event.eventId));
  const untraced = sourceEventIds.filter((id) => !accepted.has(id));
  if (untraced.length > 0) {
    throw new RecapFormatError(
      'RECAP_SOURCE_NOT_ACCEPTED',
      'sourceEventIds must resolve only to accepted events',
      'sourceEventIds',
    );
  }

  return structuredClone({
    schemaVersion: 1,
    quickRecap,
    standardRecap,
    deepRecap,
    machineSummary,
    sourceEventIds,
  }) as RecapFormats;
}
