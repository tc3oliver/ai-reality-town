import { evaluatePreGenerationSafety } from '../safety/preGeneration';
import { InMemoryCharacterSeedStore, parseCharacterSeedBundle, seedCharacters } from './characterSeed';
import {
  MISTWOOD_PUBLIC_WORLD_ID,
  mistwoodCharacterSeed,
  mistwoodInitialTensionProfile,
  mistwoodSeedTextForSafetyReview,
  mistwoodTensionEvidence,
  mistwoodWorldConfiguration,
} from './mistwoodSeed';
import { listPublicWorlds, resolvePublicWorld } from './publicWorldRegistry';
import {
  assertWarmupReady,
  evaluateAndStoreTensionReadiness,
  InMemoryTensionReadinessStore,
  parseInitialTensionProfile,
} from './tensionReadiness';
import { importWorldConfiguration, InMemoryWorldImportStore, parseWorldConfiguration } from './worldConfig';

describe('ART-77 production-intended Mistwood seed', () => {
  it('imports through the validated world and character paths with production counts', async () => {
    const configuration = parseWorldConfiguration(mistwoodWorldConfiguration);
    expect(configuration.locations).toHaveLength(8);
    expect(configuration.locations.every(({ connectedLocationIds }) => connectedLocationIds.length >= 2)).toBe(true);

    const worldStore = new InMemoryWorldImportStore();
    await expect(importWorldConfiguration(worldStore, mistwoodWorldConfiguration, 1_700_000_000_000))
      .resolves.toMatchObject({ worldId: MISTWOOD_PUBLIC_WORLD_ID, locationCount: 8, organizationCount: 3 });

    const characterStore = new InMemoryCharacterSeedStore({
      worldExists: true,
      locationIds: configuration.locations.map(({ id }) => id),
      organizationIds: configuration.organizations.map(({ id }) => id),
    });
    expect(parseCharacterSeedBundle(mistwoodCharacterSeed, await characterStore.loadReferences()).characters)
      .toHaveLength(12);
    await expect(seedCharacters(characterStore, mistwoodCharacterSeed)).resolves.toMatchObject({
      worldId: MISTWOOD_PUBLIC_WORLD_ID,
      characterCount: 12,
      secretCount: 12,
      assetCount: 12,
    });
    expect(characterStore.plan()?.bundle.characters.every(({ fictional }) => fictional)).toBe(true);
  });

  it('passes every quantitative readiness threshold with a town-wide misconception and launchable Arc', async () => {
    expect(parseInitialTensionProfile(mistwoodInitialTensionProfile, mistwoodTensionEvidence))
      .toEqual(mistwoodInitialTensionProfile);
    const store = new InMemoryTensionReadinessStore(mistwoodTensionEvidence);
    const report = await evaluateAndStoreTensionReadiness(store, mistwoodInitialTensionProfile, 1_700_000_000_100);
    expect(report.readyForWarmup).toBe(true);
    expect(report.checks).toHaveLength(7);
    expect(report.checks.every(({ passed }) => passed)).toBe(true);
    expect(report.deficits).toEqual([]);
    expect(assertWarmupReady(report)).toBe(report);
  });

  it('passes the deterministic pre-generation content-safety policy and declares no real-person data', () => {
    expect(mistwoodWorldConfiguration.contentDeclaration).toEqual({ fictionalWorld: true, containsRealPersonData: false });
    expect(mistwoodCharacterSeed.contentDeclaration).toEqual({ fictionalCharacters: true, containsRealPersonData: false });
    expect(evaluatePreGenerationSafety({ worldText: mistwoodSeedTextForSafetyReview(), promptText: 'Validate this fictional seed.' }))
      .toEqual({ policyVersion: 1, decision: 'allow' });
  });

  it('publishes only Mistwood and fails closed for warmup, fixture, test, and unknown routes', () => {
    expect(listPublicWorlds()).toEqual([{ worldId: MISTWOOD_PUBLIC_WORLD_ID, slug: 'mistwood', name: 'Mistwood' }]);
    expect(resolvePublicWorld('mistwood')).toEqual({ worldId: MISTWOOD_PUBLIC_WORLD_ID, slug: 'mistwood', name: 'Mistwood' });
    for (const id of ['mistwood-warmup', 'mistwood-fixture', 'test-world', 'unknown']) {
      expect(resolvePublicWorld(id)).toBeNull();
    }
    const mutated = listPublicWorlds();
    mutated[0].name = 'Changed';
    expect(listPublicWorlds()[0].name).toBe('Mistwood');
  });

  it('rejects duplicate imports and failed seed writes without replacing valid state', async () => {
    const worldStore = new InMemoryWorldImportStore();
    await importWorldConfiguration(worldStore, mistwoodWorldConfiguration, 1);
    await expect(importWorldConfiguration(worldStore, mistwoodWorldConfiguration, 2))
      .rejects.toMatchObject({ code: 'WORLD_ALREADY_EXISTS' });
    expect(worldStore.importedWorldIds()).toEqual([MISTWOOD_PUBLIC_WORLD_ID]);

    const characterStore = new InMemoryCharacterSeedStore({
      worldExists: true,
      locationIds: mistwoodWorldConfiguration.locations.map(({ id }) => id),
      organizationIds: mistwoodWorldConfiguration.organizations.map(({ id }) => id),
    });
    characterStore.injectFailureAfter(10);
    await expect(seedCharacters(characterStore, mistwoodCharacterSeed)).rejects.toThrow('INJECTED_CHARACTER_SEED_FAILURE');
    expect(characterStore.plan()).toBeNull();
    characterStore.injectFailureAfter(null);
    await expect(seedCharacters(characterStore, mistwoodCharacterSeed)).resolves.toMatchObject({ characterCount: 12 });
  });
});
