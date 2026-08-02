import { isActiveArcStatus } from './lifecycle';
import type { ArcTier } from './portfolio';
import type { StoryArcProjectionData, StoryArcStatus } from './model';

export const ARC_STAGNATION_WORLD_DAYS = 14;

export type ArcStagnationPrompt = {
  schemaVersion: 1;
  promptId: string;
  worldId: string;
  arcId: string;
  detectedAtWorldDay: number;
  lastProgressWorldDay: number;
  stagnantWorldDays: number;
  status: StoryArcStatus;
  tier: ArcTier;
  sourceEventId: string;
  suggestedActions: ArcResolutionAction[];
};

export const ARC_RESOLUTION_ACTIONS = [
  'suggest_outcome', 'merge', 'downgrade', 'enter_resolving', 'resolve', 'archive',
  'background_compress',
] as const;
export type ArcResolutionAction = (typeof ARC_RESOLUTION_ACTIONS)[number];

export type ArcConsequence = {
  consequenceId: string;
  summary: string;
  affectedCharacterIds: string[];
  affectsWorldSummary: boolean;
  sourceEventId: string;
};

export type ArcResolutionDecision = {
  schemaVersion: 1;
  decisionId: string;
  worldId: string;
  arcId: string;
  action: ArcResolutionAction;
  fromStatus: StoryArcStatus;
  resultingStatus: StoryArcStatus;
  fromTier: ArcTier;
  resultingTier: ArcTier;
  targetArcId: string | null;
  outcome: string | null;
  consequences: ArcConsequence[];
  sourceEventId: string;
  sourceEventSequenceNumber: number;
  reason: string;
  decidedAtWorldDay: number;
};

export class ArcResolutionError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'ArcResolutionError';
  }
}

const remediationActions: ArcResolutionAction[] = [
  'suggest_outcome', 'merge', 'downgrade', 'enter_resolving', 'background_compress',
];

export function detectArcStagnation(
  projection: StoryArcProjectionData,
  tier: ArcTier,
  currentWorldDay: number,
): ArcStagnationPrompt | null {
  if (!Number.isSafeInteger(currentWorldDay) || currentWorldDay < projection.lastProgressTime.worldDay) {
    throw new ArcResolutionError('ARC_STAGNATION_TIME_INVALID', 'current world day must not precede last progress');
  }
  if (!isActiveArcStatus(projection.status)) return null;
  const stagnantWorldDays = currentWorldDay - projection.lastProgressTime.worldDay;
  if (stagnantWorldDays < ARC_STAGNATION_WORLD_DAYS) return null;
  return {
    schemaVersion: 1,
    promptId: `${projection.worldId}:${projection.arcId}:stagnant:${projection.lastProgressTime.sourceEventId}`,
    worldId: projection.worldId,
    arcId: projection.arcId,
    detectedAtWorldDay: currentWorldDay,
    lastProgressWorldDay: projection.lastProgressTime.worldDay,
    stagnantWorldDays,
    status: projection.status,
    tier,
    sourceEventId: projection.lastProgressTime.sourceEventId,
    suggestedActions: [...remediationActions],
  };
}

export type CreateArcResolutionDecision = Omit<
  ArcResolutionDecision,
  'schemaVersion' | 'decisionId' | 'resultingStatus' | 'resultingTier'
>;

const nonempty = (value: string, field: string): void => {
  if (value.trim().length === 0) throw new ArcResolutionError('ARC_RESOLUTION_INVALID', `${field} is required`);
};

export function createArcResolutionDecision(input: CreateArcResolutionDecision): ArcResolutionDecision {
  nonempty(input.worldId, 'worldId');
  nonempty(input.arcId, 'arcId');
  nonempty(input.sourceEventId, 'sourceEventId');
  nonempty(input.reason, 'reason');
  if (!Number.isSafeInteger(input.sourceEventSequenceNumber) || input.sourceEventSequenceNumber < 0
      || !Number.isSafeInteger(input.decidedAtWorldDay) || input.decidedAtWorldDay < 0) {
    throw new ArcResolutionError('ARC_RESOLUTION_INVALID', 'event sequence and world day must be non-negative integers');
  }

  let resultingStatus = input.fromStatus;
  let resultingTier = input.fromTier;
  if (input.action === 'enter_resolving') {
    if (!['active', 'escalating', 'climax'].includes(input.fromStatus)) {
      throw new ArcResolutionError('ARC_RESOLUTION_INVALID_TRANSITION', 'only an active progressing arc may enter resolving');
    }
    resultingStatus = 'resolving';
  } else if (input.action === 'resolve') {
    if (input.fromStatus !== 'resolving') {
      throw new ArcResolutionError('ARC_RESOLUTION_INVALID_TRANSITION', 'only a resolving arc may resolve');
    }
    resultingStatus = 'resolved';
  } else if (input.action === 'archive') {
    if (input.fromStatus !== 'resolved') {
      throw new ArcResolutionError('ARC_RESOLUTION_INVALID_TRANSITION', 'only a resolved arc may archive');
    }
    resultingStatus = 'archived';
  } else if (input.action === 'background_compress') {
    if (input.fromStatus !== 'resolved' && input.fromStatus !== 'archived') {
      throw new ArcResolutionError('ARC_RESOLUTION_INVALID_TRANSITION', 'only resolved history may be background-compressed');
    }
    resultingStatus = 'archived';
  } else if (input.action === 'downgrade') {
    if (input.fromTier !== 'major') throw new ArcResolutionError('ARC_RESOLUTION_INVALID', 'only a major arc may be downgraded');
    resultingTier = 'minor';
  }

  if (input.action === 'merge') {
    if (!input.targetArcId || input.targetArcId === input.arcId) {
      throw new ArcResolutionError('ARC_RESOLUTION_INVALID', 'merge requires a different target arc');
    }
  } else if (input.targetArcId !== null) {
    throw new ArcResolutionError('ARC_RESOLUTION_INVALID', 'targetArcId is only valid for merge');
  }

  const terminal = resultingStatus === 'resolved' || resultingStatus === 'archived';
  if (terminal && (!input.outcome || input.outcome.trim().length === 0 || input.consequences.length === 0)) {
    throw new ArcResolutionError('ARC_RESOLUTION_OUTCOME_REQUIRED', 'resolved or archived arcs require outcome and consequences');
  }
  if (!terminal && (input.outcome !== null || input.consequences.length > 0)) {
    throw new ArcResolutionError('ARC_RESOLUTION_INVALID', 'outcome and consequences are recorded only by terminal resolution');
  }
  const consequenceIds = new Set<string>();
  const consequences = input.consequences.map((entry) => {
    nonempty(entry.consequenceId, 'consequenceId');
    nonempty(entry.summary, 'consequence summary');
    if (entry.sourceEventId !== input.sourceEventId) {
      throw new ArcResolutionError('ARC_RESOLUTION_PROVENANCE_INVALID', 'every consequence must reference the resolution Accepted Event');
    }
    if (consequenceIds.has(entry.consequenceId) || new Set(entry.affectedCharacterIds).size !== entry.affectedCharacterIds.length) {
      throw new ArcResolutionError('ARC_RESOLUTION_INVALID', 'consequence and character references must be unique');
    }
    consequenceIds.add(entry.consequenceId);
    return { ...entry, affectedCharacterIds: [...entry.affectedCharacterIds] };
  });
  return {
    ...input,
    schemaVersion: 1,
    decisionId: `${input.arcId}:resolution:${input.sourceEventSequenceNumber}`,
    resultingStatus,
    resultingTier,
    outcome: input.outcome?.trim() ?? null,
    consequences,
  };
}
