import {
  assertRecapCoverage,
  deriveRelationshipChangeId,
  isMajorRelationshipChange,
  relationshipChangeMagnitude,
  validateRecapCoverage,
  HIGH_IMPORTANCE_THRESHOLD,
  MAJOR_RELATIONSHIP_DELTA,
  RecapCoverageError,
  type CoverageCandidate,
  type CoverageFindingCode,
  type CoverageRelationshipChange,
  type CoverageSourceEvent,
} from './coverageValidation';

const WORLD_ID = 'w1';

function change(over: Partial<CoverageRelationshipChange> = {}): CoverageRelationshipChange {
  return {
    changeId: deriveRelationshipChangeId('e1', 0),
    sourceCharacterId: 'ada',
    targetCharacterId: 'bo',
    magnitude: MAJOR_RELATIONSHIP_DELTA,
    visibility: 'public',
    ...over,
  };
}

function source(over: Partial<CoverageSourceEvent> = {}): CoverageSourceEvent {
  return {
    eventId: 'e1',
    worldDay: 3,
    importance: 0.2,
    turningPointArcIds: [],
    relationshipChanges: [],
    publicFactIds: [],
    privateFactIds: [],
    ...over,
  };
}

function candidate(over: Partial<CoverageCandidate> = {}): CoverageCandidate {
  return {
    worldId: WORLD_ID,
    contentRef: 'episode:w1:3',
    worldDay: 3,
    coverageFromWorldDay: 3,
    citedEventIds: [],
    mentionedRelationshipChangeIds: [],
    mentionedFactIds: [],
    declaredExclusions: [],
    text: '鎮上度過平靜的一天。',
    ...over,
  };
}

const codes = (findings: readonly { code: CoverageFindingCode }[]): CoverageFindingCode[] =>
  findings.map(({ code }) => code);

describe('relationship change helpers', () => {
  it('derives a stable change ID per state change index', () => {
    expect(deriveRelationshipChangeId('w1#event#7', 2)).toBe('w1#event#7:relationship:2');
  });

  it('measures magnitude as the largest absolute single-dimension delta', () => {
    expect(relationshipChangeMagnitude({
      trustDelta: -30, affectionDelta: 5, resentmentDelta: 0,
      fearDelta: 12, dependencyDelta: 1, familiarityDelta: 2,
    })).toBe(30);
  });

  it('treats omitted additive dimensions as zero', () => {
    expect(relationshipChangeMagnitude({ trustDelta: 4, affectionDelta: -6, resentmentDelta: 1 })).toBe(6);
  });

  it('classifies a change at the threshold as major', () => {
    expect(isMajorRelationshipChange(change({ magnitude: MAJOR_RELATIONSHIP_DELTA }))).toBe(true);
    expect(isMajorRelationshipChange(change({ magnitude: MAJOR_RELATIONSHIP_DELTA - 1 }))).toBe(false);
  });
});

describe('AC#1 high-importance event coverage', () => {
  const important = source({ eventId: 'e-high', importance: HIGH_IMPORTANCE_THRESHOLD });

  it('accepts a candidate that cites every high-importance event', () => {
    const report = validateRecapCoverage(candidate({ citedEventIds: ['e-high'] }), [important]);
    expect(report.findings).toEqual([]);
    expect(report.releasable).toBe(true);
    expect(report.coveredEventIds).toEqual(['e-high']);
    expect(report.excludedEventIds).toEqual([]);
  });

  it('flags a high-importance event that is neither covered nor excluded', () => {
    const report = validateRecapCoverage(candidate(), [important]);
    expect(codes(report.findings)).toEqual(['COVERAGE_HIGH_IMPORTANCE_OMITTED']);
    expect(report.findings[0].subjectId).toBe('e-high');
    expect(report.findings[0].category).toBe('coverage');
    expect(report.releasable).toBe(false);
  });

  it('accepts an omission that is explicitly excluded with a reason', () => {
    const report = validateRecapCoverage(
      candidate({ declaredExclusions: [{ eventId: 'e-high', reason: '安全審查暫緩' }] }),
      [important],
    );
    expect(report.findings).toEqual([]);
    expect(report.excludedEventIds).toEqual(['e-high']);
    expect(report.releasable).toBe(true);
  });

  it('rejects an exclusion that carries no reason', () => {
    const report = validateRecapCoverage(
      candidate({ declaredExclusions: [{ eventId: 'e-high', reason: '   ' }] }),
      [important],
    );
    expect(codes(report.findings)).toEqual(['COVERAGE_EXCLUSION_UNJUSTIFIED']);
    expect(report.excludedEventIds).toEqual([]);
  });

  it('does not require coverage of a low-importance event', () => {
    const report = validateRecapCoverage(candidate(), [source({ importance: HIGH_IMPORTANCE_THRESHOLD - 0.01 })]);
    expect(report.findings).toEqual([]);
  });

  it('does not require coverage of days before the coverage window', () => {
    const prior = source({ eventId: 'e-prior', worldDay: 1, importance: 1 });
    const report = validateRecapCoverage(candidate({ coverageFromWorldDay: 3 }), [prior]);
    expect(report.findings).toEqual([]);
  });
});

describe('AC#2 major relationship changes', () => {
  it('flags a major public relationship change that is not mentioned', () => {
    const report = validateRecapCoverage(candidate(), [source({ relationshipChanges: [change({ magnitude: 42 })] })]);
    expect(codes(report.findings)).toEqual(['COVERAGE_RELATIONSHIP_CHANGE_OMITTED']);
    expect(report.findings[0].subjectId).toBe('e1:relationship:0');
  });

  it('accepts a major public relationship change that is mentioned', () => {
    const report = validateRecapCoverage(
      candidate({ mentionedRelationshipChangeIds: ['e1:relationship:0'] }),
      [source({ relationshipChanges: [change({ magnitude: 42 })] })],
    );
    expect(report.findings).toEqual([]);
  });

  it('does not require a minor relationship change to be mentioned', () => {
    const report = validateRecapCoverage(candidate(), [
      source({ relationshipChanges: [change({ magnitude: MAJOR_RELATIONSHIP_DELTA - 1 })] }),
    ]);
    expect(report.findings).toEqual([]);
  });

  it('never requires a private relationship change to be mentioned', () => {
    const report = validateRecapCoverage(candidate(), [
      source({ relationshipChanges: [change({ magnitude: 99, visibility: 'private' })] }),
    ]);
    expect(report.findings).toEqual([]);
  });
});

describe('AC#3 arc turning points', () => {
  it('flags a turning point that is not mentioned', () => {
    const report = validateRecapCoverage(candidate(), [source({ eventId: 'e-turn', turningPointArcIds: ['arc-2', 'arc-1'] })]);
    expect(codes(report.findings)).toEqual(['COVERAGE_TURNING_POINT_OMITTED']);
    expect(report.findings[0].detail).toContain('arc-1, arc-2');
  });

  it('accepts a turning point that is cited', () => {
    const report = validateRecapCoverage(
      candidate({ citedEventIds: ['e-turn'] }),
      [source({ eventId: 'e-turn', turningPointArcIds: ['arc-1'] })],
    );
    expect(report.findings).toEqual([]);
  });
});

describe('AC#4 spoiler violations', () => {
  it('flags a citation of an event from a later world day', () => {
    const report = validateRecapCoverage(
      candidate({ citedEventIds: ['e-future'] }),
      [source({ eventId: 'e-future', worldDay: 4 })],
    );
    expect(codes(report.findings)).toEqual(['SPOILER_FUTURE_EVENT']);
    expect(report.findings[0].detail).toContain('world day 4');
  });

  it('flags a revealed private relationship change', () => {
    const report = validateRecapCoverage(
      candidate({ mentionedRelationshipChangeIds: ['e1:relationship:0'] }),
      [source({ relationshipChanges: [change({ visibility: 'private' })] })],
    );
    expect(codes(report.findings)).toEqual(['SPOILER_PRIVATE_RELATIONSHIP']);
  });

  it('flags a revealed private fact', () => {
    const report = validateRecapCoverage(
      candidate({ mentionedFactIds: ['e1:fact:0'] }),
      [source({ privateFactIds: ['e1:fact:0'] })],
    );
    expect(codes(report.findings)).toEqual(['SPOILER_PRIVATE_FACT']);
    expect(report.findings[0].detail).toContain('not public');
  });

  it('flags a fact that only becomes public on a later world day', () => {
    const report = validateRecapCoverage(candidate({ mentionedFactIds: ['e-future:fact:0'] }), [
      source({ eventId: 'e-future', worldDay: 9, publicFactIds: ['e-future:fact:0'] }),
    ]);
    expect(codes(report.findings)).toEqual(['SPOILER_FUTURE_EVENT']);
  });

  it('accepts a released public fact', () => {
    const report = validateRecapCoverage(
      candidate({ mentionedFactIds: ['e1:fact:0'] }),
      [source({ publicFactIds: ['e1:fact:0'] })],
    );
    expect(report.findings).toEqual([]);
  });

  it('flags a relationship change revealed from a later world day', () => {
    const report = validateRecapCoverage(
      candidate({ mentionedRelationshipChangeIds: ['e-future:relationship:0'] }),
      [source({
        eventId: 'e-future', worldDay: 5,
        relationshipChanges: [change({ changeId: 'e-future:relationship:0' })],
      })],
    );
    expect(codes(report.findings)).toEqual(['SPOILER_FUTURE_EVENT']);
  });

  it('flags unreleased Canon secret text in the candidate', () => {
    const report = validateRecapCoverage(
      candidate({ text: '沒有人知道 Ada 其實是 the hidden heir 的繼承人。' }),
      [],
      ['The Hidden Heir'],
    );
    expect(codes(report.findings)).toEqual(['SPOILER_UNRELEASED_SECRET']);
    expect(report.findings[0].category).toBe('spoiler');
  });

  it('ignores a secret value that is too short to match meaningfully', () => {
    const report = validateRecapCoverage(candidate({ text: 'abc def' }), [], ['abc']);
    expect(report.findings).toEqual([]);
  });
});

describe('report shape and gate behaviour', () => {
  it('flags a citation that resolves to no accepted event', () => {
    const report = validateRecapCoverage(candidate({ citedEventIds: ['e-unknown'] }), [source()]);
    expect(codes(report.findings)).toEqual(['COVERAGE_SOURCE_NOT_ACCEPTED']);
  });

  it('echoes the candidate envelope and is deterministic', () => {
    const input = candidate({ citedEventIds: ['e-b', 'e-a'] });
    const sources = [source({ eventId: 'e-a', importance: 1 }), source({ eventId: 'e-b', importance: 1 })];
    const first = validateRecapCoverage(input, sources);
    expect(first).toEqual(validateRecapCoverage(input, sources));
    expect(first.schemaVersion).toBe(1);
    expect(first.worldId).toBe(WORLD_ID);
    expect(first.contentRef).toBe('episode:w1:3');
    expect(first.worldDay).toBe(3);
    expect(first.coverageFromWorldDay).toBe(3);
    expect(first.coveredEventIds).toEqual(['e-a', 'e-b']);
  });

  it('reports every independent violation at once', () => {
    const report = validateRecapCoverage(candidate({ mentionedFactIds: ['e-turn:fact:0'] }), [
      source({ eventId: 'e-high', importance: 1 }),
      source({ eventId: 'e-turn', turningPointArcIds: ['arc-1'], privateFactIds: ['e-turn:fact:0'] }),
    ]);
    expect(codes(report.findings).sort()).toEqual([
      'COVERAGE_HIGH_IMPORTANCE_OMITTED', 'COVERAGE_TURNING_POINT_OMITTED', 'SPOILER_PRIVATE_FACT',
    ]);
  });

  it('assertRecapCoverage returns the report when the candidate is releasable', () => {
    expect(assertRecapCoverage(candidate(), [source()]).releasable).toBe(true);
  });

  it('assertRecapCoverage throws with every blocking finding', () => {
    expect.assertions(3);
    try {
      assertRecapCoverage(candidate(), [source({ eventId: 'e-high', importance: 1 })]);
    } catch (error) {
      expect(error).toBeInstanceOf(RecapCoverageError);
      expect((error as RecapCoverageError).code).toBe('COVERAGE_HIGH_IMPORTANCE_OMITTED');
      expect((error as RecapCoverageError).findings).toHaveLength(1);
    }
  });

  it.each([
    ['empty world', candidate({ worldId: ' ' })],
    ['empty content reference', candidate({ contentRef: '' })],
    ['negative world day', candidate({ worldDay: -1 })],
    ['coverage window starting after the released day', candidate({ coverageFromWorldDay: 4 })],
  ])('rejects an invalid candidate envelope: %s', (_name, invalid) => {
    expect(() => validateRecapCoverage(invalid, [])).toThrow(RecapCoverageError);
  });

  it('rejects duplicate source event IDs', () => {
    expect(() => validateRecapCoverage(candidate(), [source(), source()])).toThrow(/COVERAGE_INVALID_SHAPE/);
  });

  it('rejects a malformed source event', () => {
    expect(() => validateRecapCoverage(candidate(), [source({ eventId: '' })])).toThrow(/COVERAGE_INVALID_SHAPE/);
  });
});
