import type { CharacterSeedBundleV1, SeedCharacter, SeedKnowledge } from './characterSeed';
import type { InitialTensionProfileV1, TensionEvidence } from './tensionReadiness';
import type { WorldConfigurationV1 } from './worldConfig';

export const MISTWOOD_PUBLIC_WORLD_ID = 'mistwood';
export const MISTWOOD_SEED_VERSION = 1 as const;

const locations = [
  ['station', 'Mistwood Station', 'A disused rail station whose sealed lockers outlasted passenger service.', 'station', 24, ['square', 'paper']],
  ['square', 'Lantern Square', 'The civic square, market ground, and usual site of public announcements.', 'civic', 80, ['station', 'hall', 'clinic', 'inn']],
  ['hall', 'Town Hall', 'Council chambers, records office, and the mayoral suite.', 'government', 30, ['square', 'paper']],
  ['paper', 'Mistwood Chronicle', 'A small newsroom and print shop beside the old rail line.', 'business', 16, ['station', 'hall', 'mill']],
  ['clinic', 'Juniper Clinic', 'The town clinic with a rear dispensary and private records room.', 'health', 18, ['square', 'mill']],
  ['mill', 'Northwater Mill', 'The town’s largest employer, powered by the river channel.', 'industrial', 45, ['paper', 'clinic', 'orchard']],
  ['orchard', 'Bellweather Orchard', 'An old orchard, packing shed, and disputed access road.', 'agricultural', 35, ['mill', 'inn']],
  ['inn', 'Foxglove Inn', 'A boarding house, dining room, and informal center of town gossip.', 'hospitality', 28, ['orchard', 'square']],
] as const;

export const mistwoodWorldConfiguration: WorldConfigurationV1 = {
  schemaVersion: 1,
  contentDeclaration: { fictionalWorld: true, containsRealPersonData: false },
  world: {
    id: MISTWOOD_PUBLIC_WORLD_ID,
    name: 'Mistwood',
    description: 'A fictional river town living in the shadow of a closed railway and a disputed civic past.',
    background: 'Mistwood rebuilt around its mill after passenger rail service ended. The official account says a flood made the station unsafe, but missing records and old debts still shape the town.',
    era: 'Contemporary fictional small town',
    technologyLevel: 'Modern consumer technology with limited municipal infrastructure',
    geographyRules: ['Travel occurs only along declared location connections.', 'The Northwater river separates the mill channel from the civic center.'],
    socialRules: ['Long-standing favors carry as much weight as formal contracts.', 'Public accusations require evidence or carry lasting social cost.'],
    laws: ['Trespass, theft, assault, and evidence tampering are prohibited.', 'Council records are public unless lawfully sealed.'],
    taboos: ['Do not exploit private medical information.', 'Do not invoke real people or real-world private data.'],
    startDate: '2026-01-01',
  },
  locations: locations.map(([id, name, description, type, capacity, connectedLocationIds]) => ({
    id: `mistwood-${id}`, name, description, type, capacity, connectedLocationIds: connectedLocationIds.map((target) => `mistwood-${target}`), active: true,
  })),
  organizations: [
    { id: 'mistwood-council', name: 'Mistwood Council', description: 'The elected fictional town government.', type: 'government', headquartersLocationId: 'mistwood-hall' },
    { id: 'mistwood-chronicle', name: 'Mistwood Chronicle', description: 'An independent fictional local newspaper.', type: 'media', headquartersLocationId: 'mistwood-paper' },
    { id: 'northwater-cooperative', name: 'Northwater Cooperative', description: 'The employee and supplier association surrounding the mill.', type: 'business', headquartersLocationId: 'mistwood-mill' },
  ],
  immutableRules: [
    { id: 'mistwood-fiction-only', description: 'Mistwood contains fictional people and events only.', enforcement: { type: 'narrative_only' } },
    { id: 'mistwood-scene-cap', description: 'A major event may directly involve at most six residents.', enforcement: { type: 'max_event_participants', maximum: 6 } },
  ],
  history: [
    { id: 'station-flood-account', title: 'The Station Flood', summary: 'The official history says a sudden flood forced the station to close; the town accepted the account without seeing the complete inspection ledger.', occurredOn: '2014-10-18', locationIds: ['mistwood-station'], organizationIds: ['mistwood-council'] },
    { id: 'mill-rescue', title: 'Northwater Rescue', summary: 'Residents formed a cooperative guarantee that kept the mill open after its former owner disappeared.', occurredOn: '2019-04-12', locationIds: ['mistwood-mill'], organizationIds: ['northwater-cooperative'] },
    { id: 'archive-fire', title: 'Archive Room Fire', summary: 'A small records-room fire destroyed several indexed boxes while leaving adjacent files untouched.', occurredOn: '2023-07-09', locationIds: ['mistwood-hall'], organizationIds: ['mistwood-council'] },
  ],
};

type ResidentInput = Omit<SeedCharacter, 'fictional' | 'behaviorRules' | 'organizationIds' | 'secretIds'> & {
  organizationIds?: string[];
  secretId: string;
};

const resident = (input: ResidentInput): SeedCharacter => {
  const { secretId, organizationIds = [], ...profile } = input;
  return {
    ...profile,
    fictional: true,
    behaviorRules: ['Act only on known or reasonably inferred information.', 'Protect the private goal unless pressure makes disclosure credible.'],
    organizationIds,
    secretIds: [secretId],
  };
};

const characters: SeedCharacter[] = [
  resident({ id: 'lin-yingxue', name: 'Lin Yingxue', age: 34, occupation: 'Chronicle reporter', publicProfile: 'A persistent local reporter who returned after years away.', privateProfile: 'She suspects her late mentor hid evidence about the station closure.', personalityTraits: ['observant', 'patient', 'stubborn'], values: ['truth', 'independence'], publicGoal: 'Restore the Chronicle’s relevance.', privateGoal: 'Find the missing station inspection ledger.', fear: 'Publishing an accusation she cannot prove.', initialLocationId: 'mistwood-paper', organizationIds: ['mistwood-chronicle'], secretId: 'secret-yingxue-source' }),
  resident({ id: 'gao-wenrui', name: 'Gao Wenrui', age: 48, occupation: 'Mayor', publicProfile: 'A pragmatic mayor promising stability and repaired infrastructure.', privateProfile: 'He inherited unresolved obligations from the prior council.', personalityTraits: ['controlled', 'persuasive', 'risk-averse'], values: ['order', 'legacy'], publicGoal: 'Secure the mill-channel repair vote.', privateGoal: 'Keep an old council guarantee from collapsing public trust.', fear: 'Losing control of the town’s official account.', initialLocationId: 'mistwood-hall', organizationIds: ['mistwood-council'], secretId: 'secret-wenrui-guarantee' }),
  resident({ id: 'su-meizhen', name: 'Su Meizhen', age: 42, occupation: 'Physician', publicProfile: 'The clinic’s trusted physician and emergency coordinator.', privateProfile: 'She treated an unidentified injured visitor on the station’s final night.', personalityTraits: ['compassionate', 'precise', 'guarded'], values: ['care', 'confidentiality'], publicGoal: 'Expand emergency coverage.', privateGoal: 'Learn why the old patient record was removed.', fear: 'Hurting a patient by breaking confidence.', initialLocationId: 'mistwood-clinic', secretId: 'secret-meizhen-patient' }),
  resident({ id: 'he-jun', name: 'He Jun', age: 39, occupation: 'Mill operations manager', publicProfile: 'The practical manager keeping Northwater Mill running.', privateProfile: 'He knows the cooperative’s water-right document has a disputed signature.', personalityTraits: ['direct', 'loyal', 'impatient'], values: ['work', 'solidarity'], publicGoal: 'Prevent another mill shutdown.', privateGoal: 'Verify the cooperative water rights before refinancing.', fear: 'Being blamed for the loss of the town’s largest employer.', initialLocationId: 'mistwood-mill', organizationIds: ['northwater-cooperative'], secretId: 'secret-hejun-water-rights' }),
  resident({ id: 'qiu-an', name: 'Qiu An', age: 31, occupation: 'Archivist', publicProfile: 'The meticulous keeper of council records.', privateProfile: 'She secretly preserved an index card from the archive fire.', personalityTraits: ['methodical', 'anxious', 'principled'], values: ['evidence', 'duty'], publicGoal: 'Digitize the surviving archives.', privateGoal: 'Trace the missing box named on the preserved index.', fear: 'Being accused of stealing public records.', initialLocationId: 'mistwood-hall', organizationIds: ['mistwood-council'], secretId: 'secret-qiu-index' }),
  resident({ id: 'luo-shan', name: 'Luo Shan', age: 45, occupation: 'Innkeeper', publicProfile: 'The sociable owner of the Foxglove Inn.', privateProfile: 'He has quietly carried a former guest’s unpaid debt for twelve years.', personalityTraits: ['warm', 'shrewd', 'avoidant'], values: ['hospitality', 'reciprocity'], publicGoal: 'Keep the inn solvent through winter.', privateGoal: 'Recover the debt without exposing the debtor’s identity.', fear: 'A public feud emptying his dining room.', initialLocationId: 'mistwood-inn', secretId: 'secret-luoshan-debt' }),
  resident({ id: 'tang-ruoxi', name: 'Tang Ruoxi', age: 28, occupation: 'Orchard manager', publicProfile: 'A young grower modernizing Bellweather Orchard.', privateProfile: 'Her deed copy shows an access boundary different from the council map.', personalityTraits: ['inventive', 'competitive', 'restless'], values: ['stewardship', 'fairness'], publicGoal: 'Open a farm-to-town market route.', privateGoal: 'Prove the disputed access road belongs to the orchard.', fear: 'Losing land through a procedural mistake.', initialLocationId: 'mistwood-orchard', secretId: 'secret-ruoxi-deed' }),
  resident({ id: 'shen-kai', name: 'Shen Kai', age: 36, occupation: 'Electrician', publicProfile: 'An independent electrician who maintains half the town’s old wiring.', privateProfile: 'He found a concealed power spur leading toward the closed station.', personalityTraits: ['curious', 'skeptical', 'helpful'], values: ['competence', 'candor'], publicGoal: 'Win the municipal rewiring contract.', privateGoal: 'Determine who still powers the station spur.', fear: 'Causing a town-wide outage.', initialLocationId: 'mistwood-square', secretId: 'secret-shenkai-spur' }),
  resident({ id: 'pei-lan', name: 'Pei Lan', age: 52, occupation: 'Council chair', publicProfile: 'A veteran council chair known for careful procedure.', privateProfile: 'She signed a closed-session minute she now believes was incomplete.', personalityTraits: ['formal', 'strategic', 'proud'], values: ['procedure', 'continuity'], publicGoal: 'Pass the infrastructure budget.', privateGoal: 'Locate the attachments missing from the old minute.', fear: 'A procedural scandal undoing years of service.', initialLocationId: 'mistwood-hall', organizationIds: ['mistwood-council'], secretId: 'secret-peilan-minute' }),
  resident({ id: 'wu-zhen', name: 'Wu Zhen', age: 26, occupation: 'Courier', publicProfile: 'A fast, well-connected bicycle courier.', privateProfile: 'He delivered an unmarked envelope to the station locker before dawn.', personalityTraits: ['energetic', 'loyal', 'impulsive'], values: ['freedom', 'friendship'], publicGoal: 'Build a reliable regional delivery route.', privateGoal: 'Identify the anonymous sender without betraying a promise.', fear: 'Being used as someone else’s alibi.', initialLocationId: 'mistwood-station', secretId: 'secret-wuzhen-envelope' }),
  resident({ id: 'fang-yue', name: 'Fang Yue', age: 33, occupation: 'Teacher and historian', publicProfile: 'A schoolteacher who runs the local history circle.', privateProfile: 'Her oral-history recording contradicts the official flood timeline.', personalityTraits: ['empathetic', 'idealistic', 'careful'], values: ['learning', 'community'], publicGoal: 'Create a public town-history exhibit.', privateGoal: 'Authenticate the contradictory recording.', fear: 'Turning students’ families against one another.', initialLocationId: 'mistwood-square', secretId: 'secret-fang-recording' }),
  resident({ id: 'zhao-ming', name: 'Zhao Ming', age: 41, occupation: 'Cooperative accountant', publicProfile: 'The quiet accountant trusted with the mill cooperative’s books.', privateProfile: 'He found recurring payments to a dormant station-maintenance account.', personalityTraits: ['reserved', 'analytical', 'dutiful'], values: ['accuracy', 'security'], publicGoal: 'Complete the cooperative audit.', privateGoal: 'Trace the dormant account without alerting its beneficiary.', fear: 'A financial panic before the evidence is complete.', initialLocationId: 'mistwood-mill', organizationIds: ['northwater-cooperative'], secretId: 'secret-zhaoming-payments' }),
];

const secretContents: Record<string, string> = {
  'secret-yingxue-source': 'Yingxue possesses her mentor’s cipher key for station notes.',
  'secret-wenrui-guarantee': 'Wenrui found an unsigned annex to the old council guarantee.',
  'secret-meizhen-patient': 'Meizhen treated an unidentified visitor on the station’s final night.',
  'secret-hejun-water-rights': 'He Jun knows the water-right signature may be invalid.',
  'secret-qiu-index': 'Qiu An preserved an index card naming a missing archive box.',
  'secret-luoshan-debt': 'Luo Shan carries a former station guest’s unpaid debt.',
  'secret-ruoxi-deed': 'Ruoxi’s deed copy contradicts the public access-road map.',
  'secret-shenkai-spur': 'Shen Kai found a powered cable leading toward the closed station.',
  'secret-peilan-minute': 'Pei Lan signed an old minute whose attachments are now missing.',
  'secret-wuzhen-envelope': 'Wu Zhen delivered an anonymous envelope to a station locker.',
  'secret-fang-recording': 'Fang Yue has a recording that contradicts the official flood time.',
  'secret-zhaoming-payments': 'Zhao Ming found payments to a dormant station account.',
};

const knowledge: SeedKnowledge[] = characters.flatMap((character, index) => [
  { id: `knowledge-${character.id}-public-role`, characterId: character.id, content: `${character.name} knows their own public role and current workplace.`, truthStatus: 'true', confidence: 1, shareability: 'public', sourceType: 'observed', sourceReference: 'initial-self-observation', learnedAtWorldDay: 0 },
  ...(index < 2 ? [{ id: `knowledge-${character.id}-false-flood`, characterId: character.id, content: 'The station closed only because floodwater irreparably damaged it.', truthStatus: 'false' as const, confidence: 0.8, shareability: 'trusted' as const, sourceType: 'public' as const, sourceReference: 'history:station-flood-account', learnedAtWorldDay: 0 }] : []),
]);

export const mistwoodCharacterSeed: CharacterSeedBundleV1 = {
  schemaVersion: 1,
  worldId: MISTWOOD_PUBLIC_WORLD_ID,
  contentDeclaration: { fictionalCharacters: true, containsRealPersonData: false },
  characters,
  secrets: characters.map(({ id, secretIds }) => ({ id: secretIds[0], content: secretContents[secretIds[0]], initialKnowerCharacterIds: [id] })),
  knowledge,
  assets: characters.map(({ id, name }, index) => ({ id: `asset-${id}`, name: `${name} working kit`, description: 'A fictional personal work asset recorded for deterministic initialization.', type: index % 2 === 0 ? 'equipment' : 'document', ownerCharacterId: id })),
  relationships: [
    { sourceCharacterId: 'lin-yingxue', targetCharacterId: 'qiu-an', trust: 35, affection: 10, resentment: 0, fear: 0, dependency: 20, familiarity: 45, visibility: 'private' },
    { sourceCharacterId: 'qiu-an', targetCharacterId: 'lin-yingxue', trust: 20, affection: 5, resentment: 5, fear: 15, dependency: 10, familiarity: 40, visibility: 'private' },
    { sourceCharacterId: 'gao-wenrui', targetCharacterId: 'pei-lan', trust: 50, affection: 5, resentment: 15, fear: 10, dependency: 45, familiarity: 75, visibility: 'public' },
    { sourceCharacterId: 'pei-lan', targetCharacterId: 'gao-wenrui', trust: 35, affection: 0, resentment: 20, fear: 5, dependency: 30, familiarity: 80, visibility: 'public' },
    { sourceCharacterId: 'he-jun', targetCharacterId: 'zhao-ming', trust: 55, affection: 10, resentment: 5, fear: 0, dependency: 60, familiarity: 65, visibility: 'public' },
    { sourceCharacterId: 'tang-ruoxi', targetCharacterId: 'gao-wenrui', trust: 5, affection: 0, resentment: 45, fear: 10, dependency: 25, familiarity: 35, visibility: 'public' },
    { sourceCharacterId: 'luo-shan', targetCharacterId: 'wu-zhen', trust: 45, affection: 30, resentment: 5, fear: 0, dependency: 15, familiarity: 60, visibility: 'public' },
    { sourceCharacterId: 'fang-yue', targetCharacterId: 'lin-yingxue', trust: 40, affection: 20, resentment: 0, fear: 5, dependency: 10, familiarity: 50, visibility: 'public' },
    { sourceCharacterId: 'su-meizhen', targetCharacterId: 'shen-kai', trust: 50, affection: 10, resentment: 0, fear: 5, dependency: 35, familiarity: 45, visibility: 'public' },
    { sourceCharacterId: 'shen-kai', targetCharacterId: 'su-meizhen', trust: 40, affection: 15, resentment: 5, fear: 0, dependency: 20, familiarity: 45, visibility: 'public' },
  ],
};

export const mistwoodTensionEvidence: TensionEvidence = {
  worldId: MISTWOOD_PUBLIC_WORLD_ID,
  characterIds: characters.map(({ id }) => id),
  privateSecretIds: mistwoodCharacterSeed.secrets.map(({ id }) => id),
  misconceptionKnowledgeIds: knowledge.filter(({ truthStatus }) => truthStatus === 'false').map(({ id }) => id),
  historyIds: mistwoodWorldConfiguration.history.map(({ id }) => id),
};

export const mistwoodInitialTensionProfile: InitialTensionProfileV1 = {
  schemaVersion: 1,
  worldId: MISTWOOD_PUBLIC_WORLD_ID,
  interestConflicts: [
    { id: 'conflict-ledger', participantCharacterIds: ['lin-yingxue', 'gao-wenrui', 'qiu-an'], description: 'Publishing the station ledger threatens the mayor’s stability campaign and the archivist’s position.', stakes: 'Public trust and control of the historical record.' },
    { id: 'conflict-road', participantCharacterIds: ['tang-ruoxi', 'pei-lan'], description: 'The orchard access claim conflicts with the council’s infrastructure map.', stakes: 'Land access and the repair budget.' },
    { id: 'conflict-water', participantCharacterIds: ['he-jun', 'zhao-ming', 'gao-wenrui'], description: 'The mill needs refinancing before its water-right signature can be verified.', stakes: 'Employment, debt, and legal control of the channel.' },
  ],
  resourceDependencies: [
    { id: 'dependency-chronicle-archive', dependentCharacterId: 'lin-yingxue', providerCharacterId: 'qiu-an', resourceOrDebt: 'Archive access', description: 'Yingxue needs Qiu An’s controlled access to verify the ledger.' },
    { id: 'dependency-mill-audit', dependentCharacterId: 'he-jun', providerCharacterId: 'zhao-ming', resourceOrDebt: 'Cooperative accounts', description: 'He Jun needs Zhao Ming’s audit to secure refinancing.' },
  ],
  emotionalTensions: [
    { id: 'emotion-yingxue-qiu', participantCharacterIds: ['lin-yingxue', 'qiu-an'], description: 'Mutual respect is strained by fear that the other will expose them first.' },
    { id: 'emotion-wenrui-peilan', participantCharacterIds: ['gao-wenrui', 'pei-lan'], description: 'Their public alliance hides resentment over responsibility for the old guarantee.' },
  ],
  sharedMisunderstanding: {
    historyId: 'station-flood-account',
    believingCharacterIds: characters.map(({ id }) => id),
    mistakenBelief: 'The station closed solely because floodwater made the structure permanently unsafe.',
  },
  launchableArcs: [{
    id: 'arc-station-ledger',
    title: 'The Station Ledger',
    premise: 'An anonymous locker key may expose why Mistwood’s station truly closed and who benefited from the official flood account.',
    currentQuestion: 'Who placed the ledger key, and what was removed from the official account?',
    coreCharacterIds: ['lin-yingxue', 'gao-wenrui', 'qiu-an', 'wu-zhen'],
    launchTrigger: 'Wu Zhen’s unmarked envelope leads Yingxue to a sealed station locker.',
  }],
};

export const mistwoodSeedTextForSafetyReview = (): string => JSON.stringify({
  world: mistwoodWorldConfiguration,
  characters: mistwoodCharacterSeed,
  tensions: mistwoodInitialTensionProfile,
});
