import {
  assertWarmupReady,
  evaluateAndStoreTensionReadiness,
  evaluateTensionReadiness,
  InMemoryTensionReadinessStore,
  parseInitialTensionProfile,
  type InitialTensionProfileV1,
  type ReadinessCheckKey,
  type TensionEvidence,
} from './tensionReadiness';

function evidence(): TensionEvidence {
  return {
    worldId: 'mistwood',
    characterIds: Array.from({ length: 12 }, (_, index) => `resident-${index + 1}`),
    privateSecretIds: ['secret-1', 'secret-2', 'secret-3'],
    misconceptionKnowledgeIds: ['knowledge-false-1', 'knowledge-false-2'],
    historyIds: ['founding-misunderstanding'],
  };
}

function readyProfile(): InitialTensionProfileV1 {
  const characters = evidence().characterIds;
  return {
    schemaVersion: 1,
    worldId: 'mistwood',
    interestConflicts: Array.from({ length: 3 }, (_, index) => ({
      id: `conflict-${index + 1}`,
      participantCharacterIds: [characters[index], characters[index + 3]],
      description: `Fictional interest conflict ${index + 1}.`,
      stakes: `Fictional stakes ${index + 1}.`,
    })),
    resourceDependencies: Array.from({ length: 2 }, (_, index) => ({
      id: `dependency-${index + 1}`,
      dependentCharacterId: characters[index],
      providerCharacterId: characters[index + 2],
      resourceOrDebt: `Fictional debt ${index + 1}`,
      description: `Fictional resource dependency ${index + 1}.`,
    })),
    emotionalTensions: Array.from({ length: 2 }, (_, index) => ({
      id: `emotion-${index + 1}`,
      participantCharacterIds: [characters[index + 4], characters[index + 6]],
      description: `Fictional emotional tension ${index + 1}.`,
    })),
    sharedMisunderstanding: {
      historyId: 'founding-misunderstanding',
      believingCharacterIds: [...characters],
      mistakenBelief: 'Everyone believes the old station closed for safety reasons.',
    },
    launchableArcs: [{
      id: 'arc-station-ledger',
      title: 'The Station Ledger',
      premise: 'A fictional ledger challenges the town history.',
      currentQuestion: 'Who hid the ledger?',
      coreCharacterIds: [characters[0], characters[1], characters[2]],
      launchTrigger: 'The sealed locker is opened.',
    }],
  };
}

function expectTensionError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('expected tension readiness validation to fail');
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

function deficit(reportKey: ReadinessCheckKey, mutate: (profile: InitialTensionProfileV1, source: TensionEvidence) => void): void {
  const profile = readyProfile();
  const source = evidence();
  mutate(profile, source);
  const report = evaluateTensionReadiness(parseInitialTensionProfile(profile, source), source, 100);
  expect(report.readyForWarmup).toBe(false);
  expect(report.deficits).toEqual([
    expect.objectContaining({ key: reportKey, missingBy: 1 }),
  ]);
  expect(report.checks.find((item) => item.key === reportKey)).toMatchObject({ passed: false });
  expectTensionError(() => assertWarmupReady(report), 'WORLD_NOT_READY_FOR_WARMUP');
}

describe('initial tension readiness', () => {
  it('passes only when all seven quantitative requirements are met', () => {
    const source = evidence();
    const report = evaluateTensionReadiness(parseInitialTensionProfile(readyProfile(), source), source, 100);
    expect(report.readyForWarmup).toBe(true);
    expect(report.checks).toHaveLength(7);
    expect(report.checks.every((item) => item.passed)).toBe(true);
    expect(report.deficits).toEqual([]);
    expect(assertWarmupReady(report)).toBe(report);
  });

  it('reports a concrete interest conflict deficit', () => deficit('interestConflicts', (profile) => { profile.interestConflicts.pop(); }));
  it('reports a concrete private secret deficit', () => deficit('privateSecrets', (_profile, source) => { source.privateSecretIds.pop(); }));
  it('reports a concrete resource dependency deficit', () => deficit('resourceDependencies', (profile) => { profile.resourceDependencies.pop(); }));
  it('reports a concrete misconception deficit', () => deficit('misconceptions', (_profile, source) => { source.misconceptionKnowledgeIds.pop(); }));
  it('reports a concrete emotional tension deficit', () => deficit('emotionalTensions', (profile) => { profile.emotionalTensions.pop(); }));
  it('reports a concrete town-wide misunderstanding deficit', () => deficit('sharedMisunderstanding', (profile) => { profile.sharedMisunderstanding?.believingCharacterIds.pop(); }));
  it('reports a concrete launchable main arc deficit', () => deficit('launchableMainArcs', (profile) => { profile.launchableArcs.pop(); }));

  it('stores the detailed report for administrator retrieval even when not ready', async () => {
    const source = evidence();
    const profile = readyProfile();
    profile.interestConflicts = [];
    const store = new InMemoryTensionReadinessStore(source);
    const saved = await evaluateAndStoreTensionReadiness(store, profile, 200);
    expect(saved.readyForWarmup).toBe(false);
    expect(saved.deficits[0]).toEqual({
      key: 'interestConflicts', required: 3, actual: 0, missingBy: 3,
      message: 'interestConflicts requires 3; found 0; add 3',
    });
    expect(await store.latestReport('mistwood')).toEqual(saved);
  });

  it('blocks warmup when no readiness report exists', () => {
    expectTensionError(() => assertWarmupReady(null), 'WORLD_NOT_READY_FOR_WARMUP');
  });

  it.each([
    ['interest conflict', (profile: InitialTensionProfileV1) => { profile.interestConflicts[0].participantCharacterIds[0] = 'missing'; }],
    ['resource dependency', (profile: InitialTensionProfileV1) => { profile.resourceDependencies[0].providerCharacterId = 'missing'; }],
    ['emotional tension', (profile: InitialTensionProfileV1) => { profile.emotionalTensions[0].participantCharacterIds[0] = 'missing'; }],
    ['shared misunderstanding history', (profile: InitialTensionProfileV1) => { if (profile.sharedMisunderstanding) profile.sharedMisunderstanding.historyId = 'missing'; }],
    ['launchable arc', (profile: InitialTensionProfileV1) => { profile.launchableArcs[0].coreCharacterIds[0] = 'missing'; }],
  ])('rejects an invalid %s reference before report persistence', async (_name, mutate) => {
    const source = evidence();
    const profile = readyProfile();
    mutate(profile);
    const store = new InMemoryTensionReadinessStore(source);
    await expect(evaluateAndStoreTensionReadiness(store, profile, 1)).rejects.toMatchObject({ code: 'TENSION_PROFILE_INVALID_REFERENCE' });
    expect(await store.latestReport('mistwood')).toBeNull();
  });

  it('rejects duplicate tension identifiers and missing seed evidence', async () => {
    const source = evidence();
    const duplicate = readyProfile();
    duplicate.interestConflicts.push({ ...duplicate.interestConflicts[0] });
    expectTensionError(() => parseInitialTensionProfile(duplicate, source), 'TENSION_PROFILE_DUPLICATE_ID');
    await expect(evaluateAndStoreTensionReadiness(new InMemoryTensionReadinessStore(null), readyProfile(), 1)).rejects.toMatchObject({ code: 'TENSION_EVIDENCE_NOT_FOUND' });
  });
});
