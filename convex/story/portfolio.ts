import type { ArcEventClassification, StoryArcProjectionData, StoryArcStatus } from './model';

export const MAX_MAJOR_ACTIVE_ARCS = 3;
export const MAX_MINOR_ACTIVE_ARCS = 6;
export const MAX_MAJOR_CORE_CHARACTERS = 6;
export const MAX_MAJOR_ARCS_PER_EVENT = 2;

export type ArcTier = 'major' | 'minor';
export type ArcPortfolioEntry = {
  projection: StoryArcProjectionData;
  tier: ArcTier;
  priority: number;
  published: boolean;
  sourceEventIds: string[];
};
export type ArcOverflowRemediation =
  | { type: 'reject' }
  | { type: 'downgrade' }
  | { type: 'merge'; targetArcId: string };
export type ArcPortfolioDecision = {
  action: 'accepted' | 'rejected' | 'downgraded' | 'merged';
  arcId: string;
  targetArcId?: string;
  retainedEventIds: string[];
};

export class ArcPortfolioError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'ArcPortfolioError';
  }
}

const ACTIVE_FAMILY = new Set<StoryArcStatus>(['active', 'escalating', 'climax', 'resolving']);
const unique = (values: readonly string[]): string[] => [...new Set(values)].sort();

function validateEntry(entry: ArcPortfolioEntry): void {
  if (!Number.isSafeInteger(entry.priority) || entry.priority < 0 || entry.priority > 100) {
    throw new ArcPortfolioError('ARC_PORTFOLIO_INVALID', 'priority must be an integer from 0 to 100');
  }
  if (entry.tier === 'major' && entry.projection.coreCharacterIds.length > MAX_MAJOR_CORE_CHARACTERS) {
    throw new ArcPortfolioError('ARC_CORE_CHARACTER_LIMIT', `major arcs may contain at most ${MAX_MAJOR_CORE_CHARACTERS} core characters`);
  }
  if (new Set(entry.sourceEventIds).size !== entry.sourceEventIds.length || entry.sourceEventIds.some((id) => id.trim().length === 0)) {
    throw new ArcPortfolioError('ARC_PORTFOLIO_INVALID', 'source Event IDs must be unique and non-empty');
  }
}

function activeCount(entries: readonly ArcPortfolioEntry[], tier: ArcTier): number {
  return entries.filter((entry) => entry.tier === tier && ACTIVE_FAMILY.has(entry.projection.status)).length;
}

export function validateMajorArcMemberships(
  classification: ArcEventClassification,
  tiers: Readonly<Record<string, ArcTier>>,
): void {
  const majorCount = classification.memberships.filter(({ arcId }) => tiers[arcId] === 'major').length;
  if (majorCount > MAX_MAJOR_ARCS_PER_EVENT) {
    throw new ArcPortfolioError('ARC_EVENT_MAJOR_LIMIT', `one event may directly advance at most ${MAX_MAJOR_ARCS_PER_EVENT} major arcs`);
  }
}

export function applyArcPortfolioControl(
  current: readonly ArcPortfolioEntry[],
  candidate: ArcPortfolioEntry,
  remediation: ArcOverflowRemediation,
): { entries: ArcPortfolioEntry[]; decision: ArcPortfolioDecision } {
  current.forEach(validateEntry);
  validateEntry(candidate);
  if (current.some(({ projection }) => projection.arcId === candidate.projection.arcId)) {
    throw new ArcPortfolioError('ARC_PORTFOLIO_INVALID', 'candidate arc already exists');
  }
  const retainedEventIds = unique(candidate.sourceEventIds);
  const limit = candidate.tier === 'major' ? MAX_MAJOR_ACTIVE_ARCS : MAX_MINOR_ACTIVE_ARCS;
  const overflows = ACTIVE_FAMILY.has(candidate.projection.status)
    && activeCount(current, candidate.tier) >= limit;
  if (!overflows) {
    return {
      entries: [...current, structuredClone(candidate)],
      decision: { action: 'accepted', arcId: candidate.projection.arcId, retainedEventIds },
    };
  }
  if (remediation.type === 'reject') {
    return {
      entries: structuredClone([...current]),
      decision: { action: 'rejected', arcId: candidate.projection.arcId, retainedEventIds },
    };
  }
  if (remediation.type === 'downgrade') {
    if (candidate.tier !== 'major' || activeCount(current, 'minor') >= MAX_MINOR_ACTIVE_ARCS) {
      throw new ArcPortfolioError('ARC_PORTFOLIO_LIMIT', 'candidate cannot be downgraded within minor limit');
    }
    const downgraded = structuredClone(candidate);
    downgraded.tier = 'minor';
    return {
      entries: [...current, downgraded],
      decision: { action: 'downgraded', arcId: candidate.projection.arcId, retainedEventIds },
    };
  }
  const targetIndex = current.findIndex(({ projection }) => projection.arcId === remediation.targetArcId);
  if (targetIndex < 0 || !ACTIVE_FAMILY.has(current[targetIndex].projection.status)) {
    throw new ArcPortfolioError('ARC_MERGE_TARGET_INVALID', 'merge target must be an active-family existing arc');
  }
  const entries = structuredClone([...current]);
  entries[targetIndex].sourceEventIds = unique([...entries[targetIndex].sourceEventIds, ...retainedEventIds]);
  return {
    entries,
    decision: {
      action: 'merged', arcId: candidate.projection.arcId,
      targetArcId: remediation.targetArcId, retainedEventIds,
    },
  };
}

export type HomepageArc = Pick<StoryArcProjectionData, 'arcId' | 'title' | 'currentQuestion' | 'status'> & {
  tier: ArcTier;
};

export function selectHomepageArc(entries: readonly ArcPortfolioEntry[]): HomepageArc | null {
  const eligible = entries.filter((entry) => entry.published && ACTIVE_FAMILY.has(entry.projection.status));
  eligible.sort((left, right) =>
    Number(right.tier === 'major') - Number(left.tier === 'major')
    || right.priority - left.priority
    || right.projection.heatScore - left.projection.heatScore
    || right.projection.lastProgressTime.worldDay - left.projection.lastProgressTime.worldDay
    || left.projection.arcId.localeCompare(right.projection.arcId));
  const selected = eligible[0];
  return selected ? {
    arcId: selected.projection.arcId, title: selected.projection.title,
    currentQuestion: selected.projection.currentQuestion, status: selected.projection.status,
    tier: selected.tier,
  } : null;
}
