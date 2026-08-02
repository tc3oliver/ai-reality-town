import { readFileSync } from 'node:fs';
import type { ArcEventClassification, StoryArcProjectionData, StoryArcStatus } from './model';
import {
  MAX_MAJOR_ACTIVE_ARCS, MAX_MAJOR_CORE_CHARACTERS, MAX_MINOR_ACTIVE_ARCS,
  applyArcPortfolioControl, selectHomepageArc, validateMajorArcMemberships,
  type ArcPortfolioEntry,
} from './portfolio';

function projection(arcId: string, status: StoryArcStatus = 'active', core = 2): StoryArcProjectionData {
  return {
    schemaVersion: 1, worldId: 'w', arcId, title: `Title ${arcId}`, premise: 'Premise',
    currentQuestion: `Question ${arcId}?`, status,
    coreCharacterIds: Array.from({ length: core }, (_, index) => `c-${index}`),
    incitingEventId: `${arcId}-event`, latestTurningPointEventId: null, essentialFactIds: [],
    unresolvedQuestions: [], resolvedQuestions: [], recommendedEntryEventId: null,
    heatScore: 50, lastProgressTime: { worldDay: 2, timeSlot: 'noon', sourceEventId: `${arcId}-event` }, revision: 0,
  };
}

function entry(arcId: string, tier: 'major' | 'minor' = 'major', status: StoryArcStatus = 'active'): ArcPortfolioEntry {
  return { projection: projection(arcId, status), tier, priority: 50, published: true, sourceEventIds: [`${arcId}-event`] };
}

describe('FR-F004 active Story Arc controls', () => {
  it('accepts exactly three major and six minor active arcs', () => {
    const major = Array.from({ length: MAX_MAJOR_ACTIVE_ARCS - 1 }, (_, i) => entry(`major-${i}`));
    expect(applyArcPortfolioControl(major, entry('major-last'), { type: 'reject' }).decision.action).toBe('accepted');
    const minor = Array.from({ length: MAX_MINOR_ACTIVE_ARCS - 1 }, (_, i) => entry(`minor-${i}`, 'minor'));
    expect(applyArcPortfolioControl(minor, entry('minor-last', 'minor'), { type: 'reject' }).decision.action).toBe('accepted');
  });

  it('handles major overflow by explicit reject, downgrade, or merge without losing source events', () => {
    const current = Array.from({ length: MAX_MAJOR_ACTIVE_ARCS }, (_, i) => entry(`major-${i}`));
    const candidate = entry('overflow');
    const rejected = applyArcPortfolioControl(current, candidate, { type: 'reject' });
    expect(rejected.decision).toMatchObject({ action: 'rejected', retainedEventIds: ['overflow-event'] });
    expect(rejected.entries).toHaveLength(MAX_MAJOR_ACTIVE_ARCS);
    const downgraded = applyArcPortfolioControl(current, candidate, { type: 'downgrade' });
    expect(downgraded.decision.action).toBe('downgraded');
    expect(downgraded.entries.at(-1)?.tier).toBe('minor');
    const merged = applyArcPortfolioControl(current, candidate, { type: 'merge', targetArcId: 'major-0' });
    expect(merged.decision).toMatchObject({ action: 'merged', targetArcId: 'major-0', retainedEventIds: ['overflow-event'] });
    expect(merged.entries[0].sourceEventIds).toContain('overflow-event');
  });

  it('rejects impossible remediation and more than six core characters', () => {
    const minor = Array.from({ length: MAX_MINOR_ACTIVE_ARCS }, (_, i) => entry(`minor-${i}`, 'minor'));
    const major = Array.from({ length: MAX_MAJOR_ACTIVE_ARCS }, (_, i) => entry(`major-${i}`));
    expect(() => applyArcPortfolioControl([...major, ...minor], entry('overflow'), { type: 'downgrade' }))
      .toThrow('[ARC_PORTFOLIO_LIMIT]');
    expect(() => applyArcPortfolioControl(major, entry('overflow'), { type: 'merge', targetArcId: 'missing' }))
      .toThrow('[ARC_MERGE_TARGET_INVALID]');
    const tooMany = entry('crowded'); tooMany.projection.coreCharacterIds = Array.from({ length: MAX_MAJOR_CORE_CHARACTERS + 1 }, (_, i) => `c-${i}`);
    expect(() => applyArcPortfolioControl([], tooMany, { type: 'reject' })).toThrow('[ARC_CORE_CHARACTER_LIMIT]');
  });

  it('enforces at most two major arc memberships for one Accepted Event classification', () => {
    const classification = {
      schemaVersion: 1, worldId: 'w', sourceEventId: 'event', sourceEventSequenceNumber: 1, newArc: null,
      memberships: ['a', 'b', 'c'].map((arcId) => ({ arcId, primary: true, importance: 1, role: 'development' as const, coreCharacterIdsAdded: [], coreCharacterIdsRemoved: [] })),
    } satisfies ArcEventClassification;
    expect(() => validateMajorArcMemberships(classification, { a: 'major', b: 'major', c: 'major' }))
      .toThrow('[ARC_EVENT_MAJOR_LIMIT]');
    expect(() => validateMajorArcMemberships(classification, { a: 'major', b: 'minor', c: 'major' })).not.toThrow();
  });

  it('excludes unpublished and inactive-family arcs and returns only the deterministic highest-priority homepage arc', () => {
    const lowMajor = entry('major-low'); lowMajor.priority = 10;
    const highMinor = entry('minor-high', 'minor'); highMinor.priority = 100;
    const highMajor = entry('major-high'); highMajor.priority = 90; highMajor.projection.heatScore = 80;
    const unpublished = entry('secret'); unpublished.priority = 100; unpublished.published = false;
    const resolved = entry('resolved', 'major', 'resolved'); resolved.priority = 100;
    expect(selectHomepageArc([lowMajor, highMinor, highMajor, unpublished, resolved])).toEqual({
      arcId: 'major-high', title: 'Title major-high', currentQuestion: 'Question major-high?', status: 'active', tier: 'major',
    });
  });

  it('exposes only an internal persistence boundary that verifies Accepted Event provenance', () => {
    const source = readFileSync('convex/story/portfolioFunctions.ts', 'utf8');
    expect(source).toContain('internalMutation');
    expect(source).toContain("query('canonEvents')");
    expect(source).toContain('ARC_PORTFOLIO_EVENT_NOT_ACCEPTED');
    expect(source).not.toMatch(/import\s*\{[^}]*\bmutation\b/);
  });
});
