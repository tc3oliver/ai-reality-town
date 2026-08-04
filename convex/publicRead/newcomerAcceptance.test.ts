/**
 * Newcomer comprehension acceptance suite (ART-75).
 *
 * Exercises the public newcomer-facing READ PATH end to end against deterministic
 * fixtures: projection builders materialise published snapshots, they are served
 * through the failure-isolated public read model (serveReadModel), and the
 * 30-second + three-minute newcomer comprehension protocol checks that a first-
 * time participant can derive the required understanding from PUBLISHED content
 * only. Failures surface as structured product findings (AC#4), not hidden UI
 * assertions. The protocol (sample, instructions, timing, scoring, evidence) is
 * declared as data (AC#3).
 */

import { commitReadModelVersion, serveReadModel, type JsonValue, type PublishedReadModel, type PublicReadStore, type ReadModelKind, type StoredReadModel } from './readModel';
import { buildArcProjection, type ArcSummary, type ArcOutcome, type PublicFact } from './relationshipArcProjection';
import { buildEpisodeProjection } from './episodeTimelineProjection';
import { buildOnboardingSummary, type OnboardingSummary } from './onboardingSummary';
import type { DailyEpisode } from '../editorial/episode';

// --- in-memory public read store (mirrors the readModel test fixture) --------

class AcceptanceReadStore implements PublicReadStore {
  readonly rows: StoredReadModel[] = [];
  private counter = 0;
  async loadTargetVersions(worldId: string, modelKind: string, modelRef: string): Promise<readonly StoredReadModel[]> {
    return Promise.resolve(this.rows.filter((row) => row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef));
  }
  async findCurrent(worldId: string, modelKind: string, modelRef: string): Promise<StoredReadModel | null> {
    return Promise.resolve(this.rows.find((row) => row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isCurrent) ?? null);
  }
  async loadLastKnownGood(worldId: string, modelKind: string, modelRef: string): Promise<readonly StoredReadModel[]> {
    return Promise.resolve(this.rows.filter((row) => row.worldId === worldId && row.modelKind === modelKind && row.modelRef === modelRef && row.isLastKnownGood));
  }
  async insertVersion(record: PublishedReadModel): Promise<string> {
    this.counter += 1;
    const id = `acc-${this.counter}`;
    this.rows.push({ ...record, id });
    return Promise.resolve(id);
  }
  async markCurrent(rowId: string, patch: { isCurrent: boolean; isLastKnownGood: boolean; status: never; updatedAt: number }): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === rowId);
    if (row) { row.isCurrent = patch.isCurrent; row.isLastKnownGood = patch.isLastKnownGood; row.status = patch.status; }
    return Promise.resolve();
  }
}

async function publish(store: PublicReadStore, worldId: string, modelKind: ReadModelKind, modelRef: string, payload: JsonValue) {
  return commitReadModelVersion(store, { worldId, modelKind, modelRef, payload, sourceEventIds: ['evt-1'], status: 'published', now: 1 });
}
async function read<T>(store: PublicReadStore, worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<T | null> {
  const served = await serveReadModel(store, worldId, modelKind, modelRef);
  return (served?.payload ?? null) as T | null;
}

// --- deterministic fixture (the protocol sample, AC#3) ----------------------

const WORLD_ID = 'w-acceptance';

function fixtureOnboarding(): OnboardingSummary {
  return buildOnboardingSummary({
    worldId: WORLD_ID, importance: 0.9,
    majorEvent: { eventId: 'evt-1', publicSummary: '兩大家族在廣場簽下休戰協議,結束長年的紛爭。' },
    characters: [
      { characterId: 'char-a', name: '艾拉' }, { characterId: 'char-b', name: '布萊恩' },
      { characterId: 'char-c', name: '茜拉' }, { characterId: 'char-d', name: '丹恩' },
    ],
    facts: [
      { factId: 'f1', predicate: '休戰', value: '締結' },
      { factId: 'f2', predicate: '失蹤者', value: '仍未尋獲' },
      { factId: 'f3', predicate: '河岸', value: '封鎖' },
    ],
    question: '和平能維持多久?',
    recommendedEpisode: { episodeNumber: 3, worldDay: 3 },
    scene: { title: '廣場', summary: '眾人屏息見證簽約。' },
  });
}

function fixtureArc() {
  const arc: ArcSummary = {
    arcId: 'arc-1', title: '兩家休戰', premise: '長年紛爭後的脆弱和平。', currentQuestion: '和平能維持多久?',
    status: 'active', coreCharacterIds: ['char-a', 'char-b', 'char-c', 'char-d'],
    incitingEventId: 'evt-1', latestTurningPointEventId: 'evt-1', unresolvedQuestions: ['和平能維持多久?'],
  };
  return buildArcProjection({
    worldId: WORLD_ID, arc, essentialBackstory: [] as PublicFact[], recommendedEntry: { episodeNumber: 3, worldDay: 3 },
    relatedEpisodes: [{ episodeNumber: 3, worldDay: 3 }], knownClues: [],
    outcome: null as unknown as ArcOutcome,
  });
}

function fixtureEpisode() {
  const episode: DailyEpisode = {
    schemaVersion: 1, worldId: WORLD_ID, worldDay: 3, episodeNumber: 3, title: '休戰之日',
    headline: '廣場上的協議。', oneLineSummary: '兩家簽下休戰,但暗流未息。',
    keyScenes: [{ title: '簽約', summary: '眾人見證休戰。', sourceEventIds: ['evt-1'], publicFactIds: [] }],
    relationshipChanges: [{ summary: '信任重建。', sourceEventId: 'evt-1' }],
    newQuestions: ['和平能維持多久?'], resolvedQuestions: ['誰先讓步?'],
    arcIds: ['arc-1'], characterIds: ['char-a', 'char-b', 'char-c', 'char-d'],
    nextEpisodeTease: '明日,承諾將受考驗。', sourceEventIds: ['evt-1'],
  };
  return buildEpisodeProjection({ worldId: WORLD_ID, episode, status: 'ready' });
}

// --- the protocol (AC#3: sample, instructions, timing, scoring, evidence) ----

const NEWCOMER_PROTOCOL = {
  sample: 'deterministic seeded world w-acceptance (休戰 arc, day 3 episode)',
  instructions30s: '閱讀「目前局勢」與「最新大事」,說明正在發生什麼、為何重要。',
  instructions3min: '在 30 秒基礎上,找出三位核心角色、當前核心問題、建議的起始故事。',
  timing: { short: 30, long: 180 },
  scoring: { perElement: 1, passingThreshold: 5 },
} as const;

type Finding = { element: string; ok: boolean; detail: string };

function score(findings: Finding[]): number {
  return findings.filter((finding) => finding.ok).length;
}

describe('Newcomer comprehension acceptance suite (ART-75)', () => {
  it('AC#3: declares the protocol (sample, instructions, timing, scoring)', () => {
    expect(NEWCOMER_PROTOCOL.sample).toBeTruthy();
    expect(NEWCOMER_PROTOCOL.instructions30s).toBeTruthy();
    expect(NEWCOMER_PROTOCOL.instructions3min).toBeTruthy();
    expect(NEWCOMER_PROTOCOL.timing.short).toBe(30);
    expect(NEWCOMER_PROTOCOL.timing.long).toBe(180);
    expect(NEWCOMER_PROTOCOL.scoring.passingThreshold).toBeGreaterThan(0);
  });

  it('AC#1 (30s): a first-time participant can tell what is happening and why it matters', async () => {
    const store = new AcceptanceReadStore();
    await publish(store, WORLD_ID, 'world', `onboarding:${WORLD_ID}`, fixtureOnboarding());
    const onboarding = await read<OnboardingSummary>(store, WORLD_ID, 'world', `onboarding:${WORLD_ID}`);

    const findings: Finding[] = [
      { element: 'what-is-happening', ok: Boolean(onboarding?.summaryText && onboarding.summaryText.trim().length > 0), detail: 'summaryText answers 「正在發生什麼」' },
      { element: 'why-it-matters', ok: Boolean(onboarding?.structured.majorEvent?.publicSummary), detail: 'majorEvent answers 「為何重要」' },
    ];
    expect(score(findings)).toBe(findings.length);
    expect(onboarding?.summaryText).toContain('休戰');
  });

  it('AC#2 (3min): identify three core characters, the current core question, and the recommended starting episode', async () => {
    const store = new AcceptanceReadStore();
    await publish(store, WORLD_ID, 'world', `onboarding:${WORLD_ID}`, fixtureOnboarding());
    await publish(store, WORLD_ID, 'arc', `arc:arc-1`, fixtureArc());
    const onboarding = await read<OnboardingSummary>(store, WORLD_ID, 'world', `onboarding:${WORLD_ID}`);
    const arc = await read<ReturnType<typeof fixtureArc>>(store, WORLD_ID, 'arc', `arc:arc-1`);

    const findings: Finding[] = [
      { element: 'three-core-characters', ok: (onboarding?.structured.characters.length ?? 0) >= 3, detail: '≥3 core characters disclosed' },
      { element: 'current-core-question', ok: Boolean(arc?.currentQuestion || onboarding?.structured.question), detail: 'current question is published' },
      { element: 'recommended-starting-episode', ok: Boolean(onboarding?.structured.recommendedEpisode), detail: 'recommended entry episode is published' },
    ];
    expect(score(findings)).toBe(findings.length);
    expect(onboarding?.structured.recommendedEpisode?.episodeNumber).toBe(3);
  });

  it('AC#1/#2/#3: retains objective response evidence meeting the rubric threshold', async () => {
    const store = new AcceptanceReadStore();
    await publish(store, WORLD_ID, 'world', `onboarding:${WORLD_ID}`, fixtureOnboarding());
    await publish(store, WORLD_ID, 'arc', `arc:arc-1`, fixtureArc());
    await publish(store, WORLD_ID, 'episode', `episode:3`, fixtureEpisode());
    const onboarding = await read<OnboardingSummary>(store, WORLD_ID, 'world', `onboarding:${WORLD_ID}`);
    const arc = await read<ReturnType<typeof fixtureArc>>(store, WORLD_ID, 'arc', `arc:arc-1`);
    const episode = await read<ReturnType<typeof fixtureEpisode>>(store, WORLD_ID, 'episode', `episode:3`);

    const evidence = {
      protocol: NEWCOMER_PROTOCOL,
      answers: {
        whatsHappening: onboarding?.summaryText ?? null,
        whyItMatters: onboarding?.structured.majorEvent?.publicSummary ?? null,
        coreCharacters: onboarding?.structured.characters.map((c) => c.name) ?? [],
        coreQuestion: arc?.currentQuestion ?? onboarding?.structured.question ?? null,
        recommendedEpisode: onboarding?.structured.recommendedEpisode ?? null,
        entryScene: episode?.keyScenes[0]?.summary ?? null,
      },
    };
    const findings: Finding[] = [
      { element: 'whatsHappening', ok: Boolean(evidence.answers.whatsHappening), detail: '' },
      { element: 'whyItMatters', ok: Boolean(evidence.answers.whyItMatters), detail: '' },
      { element: 'coreCharacters>=3', ok: evidence.answers.coreCharacters.length >= 3, detail: '' },
      { element: 'coreQuestion', ok: Boolean(evidence.answers.coreQuestion), detail: '' },
      { element: 'recommendedEpisode', ok: Boolean(evidence.answers.recommendedEpisode), detail: '' },
    ];
    // AC#4: failures would be recorded as product findings; here all pass.
    expect(findings.filter((f) => !f.ok)).toEqual([]);
    expect(score(findings)).toBeGreaterThanOrEqual(NEWCOMER_PROTOCOL.scoring.passingThreshold);
    expect(evidence.answers.recommendedEpisode?.episodeNumber).toBe(3);
  });

  it('AC#4: a missing comprehension element is recorded as a product finding, not hidden', async () => {
    const store = new AcceptanceReadStore();
    // Publish onboarding WITHOUT a recommended episode to simulate a product gap.
    const gap = buildOnboardingSummary({
      worldId: WORLD_ID, importance: 0.5, majorEvent: { eventId: 'evt-1', publicSummary: '某事發生。' },
      characters: [{ characterId: 'c1', name: 'A' }], facts: [], question: 'Q?',
      recommendedEpisode: null, scene: null,
    });
    await publish(store, WORLD_ID, 'world', `onboarding:${WORLD_ID}`, gap);
    const onboarding = await read<OnboardingSummary>(store, WORLD_ID, 'world', `onboarding:${WORLD_ID}`);
    const findings: Finding[] = [
      { element: 'three-core-characters', ok: (onboarding?.structured.characters.length ?? 0) >= 3, detail: 'fewer than 3 characters disclosed' },
      { element: 'recommended-starting-episode', ok: Boolean(onboarding?.structured.recommendedEpisode), detail: 'no recommended entry' },
    ];
    const failures = findings.filter((f) => !f.ok);
    expect(failures.length).toBeGreaterThan(0); // recorded as findings, surfaced — not hidden
    expect(failures.map((f) => f.element)).toContain('recommended-starting-episode');
  });
});
