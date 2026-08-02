import { readFileSync } from 'node:fs';
import { parseAndValidateDirectorPlan, parseDirectorPlanContext } from './director';

const context = () => ({
  schemaVersion: 1, directorRunId: 'director:w:7:morning', worldId: 'w', worldDay: 7, timeSlot: 'morning',
  activeArcs: [{ arcId: 'arc-1', currentQuestion: 'Who hid the ledger?', status: 'active' }],
  unresolvedQuestions: ['Who hid the ledger?'], recentMajorEventIds: ['w#event#5'],
  characters: [
    { characterId: 'a', currentGoal: 'Find the ledger', currentLocationId: 'station', slotsSinceMajorAppearance: 2 },
    { characterId: 'b', currentGoal: 'Protect the mayor', currentLocationId: 'station', slotsSinceMajorAppearance: 8 },
    { characterId: 'c', currentGoal: 'Open the clinic', currentLocationId: 'clinic', slotsSinceMajorAppearance: 12 },
  ],
  viewerInterventionEventIds: ['w#event#6'], environmentFactIds: ['fact-rain'],
  repetitionScore: 0.2, pacingStage: 'escalation',
});

const scene = (id: string, participants: string[], locationId: string) => ({
  sceneId: id, directorRunId: 'director:w:7:morning', worldDay: 7, timeSlot: 'morning', locationId,
  participantIds: participants, trigger: 'The station loses power', dramaticPressure: 'Evidence may disappear',
  arcIds: ['arc-1'], protectedFactIds: ['fact-secret'], expectedStateChangeTypes: ['knowledge_learned'],
});

const plan = (scenes: unknown[]) => ({
  schemaVersion: 1, directorRunId: 'director:w:7:morning', worldId: 'w', worldDay: 7,
  timeSlot: 'morning', scenes,
});

describe('FR-C002 constrained Director Plan', () => {
  it('accepts zero through three major scenes and retains Director Run traceability', () => {
    for (let count = 0; count <= 3; count += 1) {
      const available = [scene('s1', ['a'], 'station'), scene('s2', ['b'], 'station'), scene('s3', ['c'], 'clinic')];
      const parsed = parseAndValidateDirectorPlan(plan(available.slice(0, count)), context());
      expect(parsed.scenes).toHaveLength(count);
      expect(parsed.scenes.every(({ directorRunId }) => directorRunId === parsed.directorRunId)).toBe(true);
    }
  });

  it('rejects a fourth major scene for the same world time slot', () => {
    expect(() => parseAndValidateDirectorPlan(plan([
      scene('s1', ['a'], 'station'), scene('s2', ['b'], 'station'), scene('s3', ['c'], 'clinic'),
      { ...scene('s4', ['c'], 'clinic'), participantIds: [] },
    ]), context())).toThrow(/at most 3 major scenes/);
  });

  it('rejects time, location, run, and active-arc conflicts', () => {
    expect(() => parseAndValidateDirectorPlan(plan([scene('s1', ['a'], 'station'), scene('s2', ['a'], 'station')]), context())).toThrow(/two major scenes/);
    expect(() => parseAndValidateDirectorPlan(plan([scene('s1', ['a'], 'clinic')]), context())).toThrow(/not available at scene location/);
    expect(() => parseAndValidateDirectorPlan(plan([{ ...scene('s1', ['a'], 'station'), timeSlot: 'night' }]), context())).toThrow(/same Director Run and slot/);
    expect(() => parseAndValidateDirectorPlan(plan([{ ...scene('s1', ['a'], 'station'), arcIds: ['arc-unknown'] }]), context())).toThrow(/non-active arc/);
  });

  it('structurally excludes prescribed outcomes and arbitrary provider fields', () => {
    expect(() => parseAndValidateDirectorPlan(plan([{ ...scene('s1', ['a'], 'station'), finalOutcome: 'A confesses' }]), context())).toThrow(/unknown field/);
    const parsed = parseAndValidateDirectorPlan(plan([scene('s1', ['a'], 'station')]), context());
    expect(parsed.scenes[0].trigger).toBe('The station loses power');
    expect(parsed.scenes[0].dramaticPressure).toBe('Evidence may disappear');
    expect(parsed.scenes[0]).not.toHaveProperty('outcome');
    expect(parsed.scenes[0]).not.toHaveProperty('dialogue');
  });

  it('requires the complete planning context and validates repetition and duplicate references', () => {
    const parsed = parseDirectorPlanContext(context());
    expect(parsed.activeArcs).toHaveLength(1);
    expect(parsed.unresolvedQuestions).toEqual(['Who hid the ledger?']);
    expect(parsed.recentMajorEventIds).toEqual(['w#event#5']);
    expect(parsed.characters).toHaveLength(3);
    expect(parsed.viewerInterventionEventIds).toEqual(['w#event#6']);
    expect(parsed.environmentFactIds).toEqual(['fact-rain']);
    expect(parsed).toMatchObject({ pacingStage: 'escalation', repetitionScore: 0.2 });
    const missing = { ...context() } as Record<string, unknown>;
    delete missing.viewerInterventionEventIds;
    expect(() => parseDirectorPlanContext(missing)).toThrow(/array of strings/);
    expect(() => parseDirectorPlanContext({ ...context(), repetitionScore: 1.1 })).toThrow(/from 0 to 1/);
    expect(() => parseDirectorPlanContext({ ...context(), recentMajorEventIds: ['e', 'e'] })).toThrow(/duplicates/);
  });

  it('keeps persistence/query APIs internal and idempotent by Director Run ID', () => {
    const source = readFileSync('convex/simulation/directorFunctions.ts', 'utf8');
    expect(source).toContain(".eq('directorRunId', context.directorRunId)");
    expect(source).toContain('deduplicated: true');
    expect(source).toContain('internalMutation({');
    expect(source).toContain('internalQuery({');
    expect(source).not.toMatch(/\bmutation\(\{/);
    expect(source).not.toMatch(/\bquery\(\{/);
  });
});
