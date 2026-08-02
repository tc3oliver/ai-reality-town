import {
  InMemoryCharacterSeedStore,
  parseCharacterSeedBundle,
  seedCharacters,
  type CharacterSeedBundleV1,
  type CharacterSeedReferences,
} from './characterSeed';

const references: CharacterSeedReferences = {
  worldExists: true,
  locationIds: ['square', 'station'],
  organizationIds: ['gazette'],
};

function validBundle(count = 12): CharacterSeedBundleV1 {
  const ids = Array.from({ length: count }, (_, index) => `resident-${index + 1}`);
  return {
    schemaVersion: 1,
    worldId: 'mistwood',
    contentDeclaration: { fictionalCharacters: true, containsRealPersonData: false },
    characters: ids.map((id, index) => ({
      id,
      name: `Fictional Resident ${index + 1}`,
      fictional: true,
      age: 25 + index,
      occupation: `Fictional occupation ${index + 1}`,
      publicProfile: `Public profile for ${id}.`,
      privateProfile: `Private fictional background for ${id}.`,
      personalityTraits: ['observant', `trait-${index + 1}`],
      values: ['community', `value-${index + 1}`],
      publicGoal: `Complete public goal ${index + 1}.`,
      privateGoal: `Complete private goal ${index + 1}.`,
      fear: `Fictional fear ${index + 1}.`,
      behaviorRules: ['Act only on known information.'],
      initialLocationId: index % 2 === 0 ? 'square' : 'station',
      organizationIds: index === 0 ? ['gazette'] : [],
      secretIds: [`secret-${index + 1}`],
    })),
    secrets: ids.map((id, index) => ({
      id: `secret-${index + 1}`,
      content: `Fictional secret ${index + 1}.`,
      initialKnowerCharacterIds: [id],
    })),
    knowledge: ids.map((id, index) => ({
      id: `knowledge-${index + 1}`,
      characterId: id,
      content: `${id} knows a fictional local fact.`,
      truthStatus: 'true',
      confidence: 0.9,
      shareability: 'trusted',
    })),
    assets: ids.map((id, index) => ({
      id: `asset-${index + 1}`,
      name: `Fictional asset ${index + 1}`,
      description: `Initial asset owned by ${id}.`,
      type: 'personal_item',
      ownerCharacterId: id,
    })),
    relationships: ids.map((id, index) => ({
      sourceCharacterId: id,
      targetCharacterId: ids[(index + 1) % ids.length],
      trust: 10 + index,
      affection: 5,
      resentment: 0,
      fear: 0,
      dependency: 2,
      familiarity: 30,
      visibility: 'private',
    })),
  };
}

function expectSeedError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('expected character seed validation to fail');
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe('character seed initialization', () => {
  it('atomically loads twelve complete fictional primary characters', async () => {
    const store = new InMemoryCharacterSeedStore(references);
    const result = await seedCharacters(store, validBundle());
    expect(result).toEqual({
      worldId: 'mistwood', characterCount: 12, secretCount: 12,
      knowledgeCount: 12, assetCount: 12, relationshipCount: 12,
    });
    expect(store.plan()?.bundle.characters).toHaveLength(12);
    expect(store.plan()?.bundle.characters.every((character) => character.publicGoal && character.privateGoal)).toBe(true);
  });

  it.each([11, 21])('rejects %i primary characters', async (count) => {
    await expect(seedCharacters(new InMemoryCharacterSeedStore(references), validBundle(count))).rejects.toMatchObject({
      code: 'CHARACTER_SEED_INVALID_SHAPE', path: 'characters',
    });
  });

  it.each(['publicGoal', 'privateGoal'] as const)('requires every character %s', async (field) => {
    const bundle = validBundle();
    bundle.characters[3][field] = '';
    await expect(seedCharacters(new InMemoryCharacterSeedStore(references), bundle)).rejects.toMatchObject({
      code: 'CHARACTER_SEED_INVALID_SHAPE', path: `characters[3].${field}`,
    });
  });

  it.each([
    ['location', (bundle: CharacterSeedBundleV1) => { bundle.characters[0].initialLocationId = 'missing'; }],
    ['organization', (bundle: CharacterSeedBundleV1) => { bundle.characters[0].organizationIds = ['missing']; }],
    ['secret', (bundle: CharacterSeedBundleV1) => { bundle.characters[0].secretIds = ['missing']; }],
    ['secret knower', (bundle: CharacterSeedBundleV1) => { bundle.secrets[0].initialKnowerCharacterIds = ['missing']; }],
    ['knowledge character', (bundle: CharacterSeedBundleV1) => { bundle.knowledge[0].characterId = 'missing'; }],
    ['asset owner', (bundle: CharacterSeedBundleV1) => { bundle.assets[0].ownerCharacterId = 'missing'; }],
    ['relationship character', (bundle: CharacterSeedBundleV1) => { bundle.relationships[0].targetCharacterId = 'missing'; }],
  ])('rejects an invalid %s reference without writing', async (_name, mutate) => {
    const store = new InMemoryCharacterSeedStore(references);
    const bundle = validBundle();
    mutate(bundle);
    await expect(seedCharacters(store, bundle)).rejects.toMatchObject({ code: 'CHARACTER_SEED_INVALID_REFERENCE' });
    expect(store.plan()).toBeNull();
  });

  it('requires every secret to have an initial knower', async () => {
    const bundle = validBundle();
    bundle.secrets[0].initialKnowerCharacterIds = [];
    await expect(seedCharacters(new InMemoryCharacterSeedStore(references), bundle)).rejects.toMatchObject({
      code: 'CHARACTER_SEED_INVALID_SHAPE', path: 'secrets[0].initialKnowerCharacterIds',
    });
  });

  it.each([
    ['knowledge', (bundle: CharacterSeedBundleV1) => { bundle.knowledge = bundle.knowledge.filter((entry) => entry.characterId !== 'resident-1'); }],
    ['asset', (bundle: CharacterSeedBundleV1) => { bundle.assets = bundle.assets.filter((entry) => entry.ownerCharacterId !== 'resident-1'); }],
  ])('requires every character to have an initial %s', async (_name, mutate) => {
    const bundle = validBundle();
    mutate(bundle);
    await expect(seedCharacters(new InMemoryCharacterSeedStore(references), bundle)).rejects.toMatchObject({
      code: 'CHARACTER_SEED_INVALID_REFERENCE', path: 'characters[0]',
    });
  });

  it('requires a character to be an initial knower of each declared personal secret', async () => {
    const bundle = validBundle();
    bundle.secrets[0].initialKnowerCharacterIds = ['resident-2'];
    await expect(seedCharacters(new InMemoryCharacterSeedStore(references), bundle)).rejects.toMatchObject({
      code: 'CHARACTER_SEED_INVALID_REFERENCE', path: 'characters[0].secretIds',
    });
  });

  it('rejects self and duplicate directional relationships', () => {
    const self = validBundle();
    self.relationships[0].targetCharacterId = self.relationships[0].sourceCharacterId;
    expectSeedError(() => parseCharacterSeedBundle(self, references), 'CHARACTER_SEED_INVALID_RELATIONSHIP');
    const duplicate = validBundle();
    duplicate.relationships.push({ ...duplicate.relationships[0] });
    expectSeedError(() => parseCharacterSeedBundle(duplicate, references), 'CHARACTER_SEED_INVALID_RELATIONSHIP');
  });

  it('allows reciprocal directional relationships but not out-of-range dimensions', () => {
    const reciprocal = validBundle();
    reciprocal.relationships.push({ ...reciprocal.relationships[0], sourceCharacterId: 'resident-2', targetCharacterId: 'resident-1' });
    expect(parseCharacterSeedBundle(reciprocal, references).relationships).toHaveLength(13);
    const invalid = validBundle();
    invalid.relationships[0].trust = 101;
    expectSeedError(() => parseCharacterSeedBundle(invalid, references), 'CHARACTER_SEED_INVALID_SHAPE');
  });

  it('rejects real-person declarations and non-fictional default characters', async () => {
    const declaration: unknown = { ...validBundle(), contentDeclaration: { fictionalCharacters: false, containsRealPersonData: true } };
    await expect(seedCharacters(new InMemoryCharacterSeedStore(references), declaration)).rejects.toMatchObject({ code: 'CHARACTER_SEED_NOT_FICTIONAL' });
    const character = validBundle();
    (character.characters[0] as { fictional: boolean }).fictional = false;
    await expect(seedCharacters(new InMemoryCharacterSeedStore(references), character)).rejects.toMatchObject({ code: 'CHARACTER_SEED_NOT_FICTIONAL' });
  });

  it('rolls every staged record back after an injected failure', async () => {
    const store = new InMemoryCharacterSeedStore(references);
    store.injectFailureAfter(20);
    await expect(seedCharacters(store, validBundle())).rejects.toThrow('INJECTED_CHARACTER_SEED_FAILURE');
    expect(store.plan()).toBeNull();
  });

  it('rejects seeding a world twice without replacing the first seed', async () => {
    const store = new InMemoryCharacterSeedStore(references);
    await seedCharacters(store, validBundle());
    const original = store.plan();
    await expect(seedCharacters(store, validBundle())).rejects.toMatchObject({ code: 'CHARACTER_SEED_ALREADY_EXISTS' });
    expect(store.plan()).toBe(original);
  });

  it('rejects a seed when the referenced world does not exist', async () => {
    const store = new InMemoryCharacterSeedStore({ ...references, worldExists: false });
    await expect(seedCharacters(store, validBundle())).rejects.toMatchObject({ code: 'CHARACTER_SEED_WORLD_NOT_FOUND' });
  });
});
