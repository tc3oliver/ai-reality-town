/**
 * Visual Replay construction (FR-O013 / ART-121), organised by acceptance criterion.
 *
 * The fixture is a small Mistwood history with four completed scenes and one still under way,
 * planned against the REAL Mistwood location bindings — so "a participant with no binding is
 * dropped" and "a position is an anchor on the actual map" are claims about the map this
 * world ships, not about a stub.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { mistwoodRuntimeContext } from '../visualRuntime/mistwoodRuntime';
import { FIXTURE_ACCEPTED_AT_MS } from '../visualRuntime/fixtures';
import type { SceneArcMembership } from './activeScenePresentation';
import {
  CANON_EVENT_SUMMARY_VERSION,
  REPLAY_EVENT_CARD_MS,
  REPLAY_FORBIDDEN_FIELDS,
  REPLAY_MAX_SCENES,
  REPLAY_SCENE_MAX_MS,
  REPLAY_SCENE_MIN_MS,
  assertVisualReplay,
  buildVisualReplay,
  canonEventSummaryId,
  episodeSceneSummaryId,
  fitSceneDuration,
  parseEpisodeSceneSummaryId,
  replayTextReferences,
  selectVisualReplay,
  type BuildVisualReplayInput,
  type ReplayEpisodeInput,
  type ReplayEventLike,
  type ReplayPublicationRecord,
  type ReplayStep,
  type VisualReplay,
} from './visualReplay';

type MutableReplay = {
  scenes: Array<{
    durationMs: number;
    steps: Array<Record<string, unknown>>;
    participants: Array<Record<string, unknown>>;
  }>;
};

const WORLD_ID = MISTWOOD_PUBLIC_WORLD_ID;
const SQUARE = 'mistwood-square';
const HALL = 'mistwood-hall';
const MILL = 'mistwood-mill';
const INN = 'mistwood-inn';
const ORCHARD = 'mistwood-orchard';

/** Every sentence the fixture contains, so AC#10 can prove none of them is stored. */
const SOURCE_TEXTS = {
  hallSummary: '會議在鎮公所開始。',
  millSummary: '磨坊的水車修好了。',
  innSummary: '兩人在客棧夜談。',
  orchardSummary: '清晨的果園。',
  episodeTitle: '休戰之日',
  episodeSummary: '眾人在鎮公所見證了休戰協議。',
} as const;

function event(over: {
  sequenceNumber: number;
  worldDay: number;
  timeSlot: string;
  locationId: string;
  participantIds: readonly string[];
  publicSummary?: string;
  move?: { characterId: string; toLocationId: string };
}): ReplayEventLike {
  return {
    eventId: `mistwood#event#${over.sequenceNumber}`,
    sequenceNumber: over.sequenceNumber,
    worldDay: over.worldDay,
    timeSlot: over.timeSlot,
    acceptedAt: FIXTURE_ACCEPTED_AT_MS + over.sequenceNumber,
    locationId: over.locationId,
    participantIds: over.participantIds,
    ...(over.publicSummary === undefined ? {} : { publicSummary: over.publicSummary }),
    stateChanges: over.move
      ? [{ type: 'character_location_changed', characterId: over.move.characterId, toLocationId: over.move.toLocationId }]
      : [],
  };
}

/**
 * Two setup arrivals, three completed scenes, one still under way.
 *
 * The setup slot exists because a participant's START position is where they were *before*
 * the scene: a world whose very first event is the scene has nobody with a resolvable prior
 * position, which the builder correctly refuses to guess at.
 */
const EVENTS: readonly ReplayEventLike[] = [
  event({ sequenceNumber: 0, worldDay: 0, timeSlot: 'morning', locationId: SQUARE, participantIds: ['wu-zhen'], move: { characterId: 'wu-zhen', toLocationId: SQUARE } }),
  event({ sequenceNumber: 1, worldDay: 0, timeSlot: 'morning', locationId: SQUARE, participantIds: ['he-jun'], move: { characterId: 'he-jun', toLocationId: SQUARE } }),
  event({ sequenceNumber: 2, worldDay: 1, timeSlot: 'morning', locationId: HALL, participantIds: ['wu-zhen', 'he-jun'], publicSummary: SOURCE_TEXTS.hallSummary, move: { characterId: 'wu-zhen', toLocationId: HALL } }),
  event({ sequenceNumber: 3, worldDay: 1, timeSlot: 'noon', locationId: MILL, participantIds: ['he-jun'], publicSummary: SOURCE_TEXTS.millSummary, move: { characterId: 'he-jun', toLocationId: MILL } }),
  event({ sequenceNumber: 4, worldDay: 1, timeSlot: 'evening', locationId: INN, participantIds: ['wu-zhen'], publicSummary: SOURCE_TEXTS.innSummary, move: { characterId: 'wu-zhen', toLocationId: INN } }),
  event({ sequenceNumber: 5, worldDay: 2, timeSlot: 'morning', locationId: ORCHARD, participantIds: ['he-jun'], publicSummary: SOURCE_TEXTS.orchardSummary, move: { characterId: 'he-jun', toLocationId: ORCHARD } }),
];

/** Scene importance: the hall leads, then the inn, then the mill. The setup slot has none. */
const MEMBERSHIPS: readonly SceneArcMembership[] = [
  { sourceEventSequenceNumber: 2, arcIds: ['arc-truce'], importance: 0.9 },
  { sourceEventSequenceNumber: 3, arcIds: ['arc-mill'], importance: 0.5 },
  { sourceEventSequenceNumber: 4, arcIds: ['arc-truce'], importance: 0.7 },
  { sourceEventSequenceNumber: 5, arcIds: ['arc-harvest'], importance: 1 },
];

const READY_EPISODE: ReplayEpisodeInput = {
  worldDay: 1,
  status: 'ready',
  keyScenes: [
    { title: SOURCE_TEXTS.episodeTitle, summary: SOURCE_TEXTS.episodeSummary, sourceEventIds: ['mistwood#event#2'] },
  ],
};

const PUBLISHED_RECORD: ReadonlyMap<string, ReplayPublicationRecord> = new Map([
  [`episode:${WORLD_ID}:1`, { version: 2, status: 'published' }],
]);

function input(over: Partial<BuildVisualReplayInput> = {}): BuildVisualReplayInput {
  return {
    worldId: WORLD_ID,
    acceptedEvents: EVENTS,
    arcMemberships: MEMBERSHIPS,
    excludedCharacterIds: new Set<string>(),
    runtime: mistwoodRuntimeContext(),
    episodes: [READY_EPISODE],
    publicationRecords: PUBLISHED_RECORD,
    ...over,
  };
}

function built(over: Partial<BuildVisualReplayInput> = {}): VisualReplay {
  const replay = buildVisualReplay(input(over));
  if (!replay) throw new Error('fixture produced no replay');
  return replay;
}

/** Every string anywhere in a payload, at any depth, keys included. */
function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => [key, ...allStrings(entry)]);
  }
  return [];
}

function stepsOfType<T extends ReplayStep['type']>(replay: VisualReplay, type: T): Extract<ReplayStep, { type: T }>[] {
  return replay.scenes.flatMap((scene) =>
    scene.steps.filter((step): step is Extract<ReplayStep, { type: T }> => step.type === type));
}

// ---------------------------------------------------------------------------

describe('AC#1 — one to three recent important scenes, 20–60 seconds each', () => {
  it('selects the most important completed scenes and clamps the count at three', () => {
    const replay = built();
    expect(replay.scenes).toHaveLength(REPLAY_MAX_SCENES);
    // The four completed groups are the setup slot plus hall/mill/inn; the setup slot has no
    // importance at all and is the one dropped.
    expect(replay.scenes.map((scene) => scene.locationId)).toEqual([HALL, MILL, INN]);
  });

  it('gives every scene a duration inside the PRD window', () => {
    for (const scene of built().scenes) {
      expect(scene.durationMs).toBeGreaterThanOrEqual(REPLAY_SCENE_MIN_MS);
      expect(scene.durationMs).toBeLessThanOrEqual(REPLAY_SCENE_MAX_MS);
      // The parts always sum to the whole, so the client never has two answers to reconcile.
      expect(scene.steps.reduce((sum, step) => sum + step.durationMs, 0)).toBe(scene.durationMs);
    }
  });

  it('replays forwards, whatever order importance ranked the scenes in', () => {
    // Importance put the inn (0.7) above the mill (0.5), but the mill happened first.
    const replay = built();
    expect(replay.scenes.map((scene) => scene.timeSlot)).toEqual(['morning', 'noon', 'evening']);
    expect(replay.totalDurationMs).toBe(
      replay.scenes.reduce((sum, scene) => sum + scene.durationMs, 0),
    );
  });

  it('yields null when the only activity is the slot currently under way', () => {
    const currentSlotOnly = EVENTS.filter((entry) => entry.worldDay === 2);
    expect(buildVisualReplay(input({ acceptedEvents: currentSlotOnly }))).toBeNull();
    expect(buildVisualReplay(input({ acceptedEvents: [] }))).toBeNull();
  });

  it('never replays the slot that is still happening (RISK2-009 at the data layer)', () => {
    const replay = built();
    const replayed = replay.scenes.map((scene) => `${scene.worldDay}:${scene.timeSlot}`);
    expect(replayed).not.toContain('2:morning');
    expect(replay.sourceEventIds).not.toContain('mistwood#event#5');
  });

  it('pads a thin scene rather than flashing it past, and compresses a dense one', () => {
    const thin = fitSceneDuration([{ type: 'eventCard', refKind: 'canonEventSummary', publicSummaryId: 'canonEvent:x', publicationVersion: 1, durationMs: REPLAY_EVENT_CARD_MS }]);
    expect(thin.reduce((sum, step) => sum + step.durationMs, 0)).toBe(REPLAY_SCENE_MIN_MS);
    expect(thin.at(-1)?.type).toBe('wait');

    const dense: ReplayStep[] = Array.from({ length: 30 }, (_unused, index) => ({
      type: 'eventCard',
      refKind: 'canonEventSummary',
      publicSummaryId: `canonEvent:e${index}`,
      publicationVersion: 1,
      durationMs: REPLAY_EVENT_CARD_MS,
    }));
    const fitted = fitSceneDuration(dense);
    expect(fitted.reduce((sum, step) => sum + step.durationMs, 0)).toBe(REPLAY_SCENE_MAX_MS);
    // Compressed, never dropped: silently losing a scene's only published sentence would be
    // a worse failure than reading it a little quickly.
    expect(fitted.filter((step) => step.type === 'eventCard')).toHaveLength(30);
  });
});

describe('AC#3 — only accepted events and already-published summaries', () => {
  it('references the episode key scene when the day is narrated and its record is published', () => {
    const cards = stepsOfType(built(), 'eventCard');
    const episodeCards = cards.filter((card) => card.refKind === 'episodeScene');
    expect(episodeCards).toHaveLength(1);
    expect(episodeCards[0].publicSummaryId).toBe(episodeSceneSummaryId(WORLD_ID, 1, 0));
    // The version pinned is the one the publication record carried at build time.
    expect(episodeCards[0].publicationVersion).toBe(2);
  });

  it('falls back to the event summary for a slot no episode narrates', () => {
    const canonCards = stepsOfType(built(), 'eventCard').filter((card) => card.refKind === 'canonEventSummary');
    expect(canonCards.map((card) => card.publicSummaryId)).toEqual([
      canonEventSummaryId('mistwood#event#3'),
      canonEventSummaryId('mistwood#event#4'),
    ]);
    for (const card of canonCards) expect(card.publicationVersion).toBe(CANON_EVENT_SUMMARY_VERSION);
  });

  it('emits no episode reference when the publication record is withheld or superseded', () => {
    for (const status of ['withheld', 'superseded', 'safety_review', 'generated'] as const) {
      const records = new Map([[`episode:${WORLD_ID}:1`, { version: 2, status }]]);
      const cards = stepsOfType(built({ publicationRecords: records }), 'eventCard');
      expect(cards.every((card) => card.refKind === 'canonEventSummary')).toBe(true);
      // Not silently blank: the event's own accepted summary still carries the scene.
      expect(cards.map((card) => card.publicSummaryId)).toContain(canonEventSummaryId('mistwood#event#2'));
    }
  });

  it('emits no episode reference when the episode itself is not ready', () => {
    const cards = stepsOfType(built({ episodes: [{ ...READY_EPISODE, status: 'withheld' }] }), 'eventCard');
    expect(cards.every((card) => card.refKind === 'canonEventSummary')).toBe(true);
  });

  it('emits no card at all for an event with neither narration nor a public summary', () => {
    const silent = EVENTS.map((entry) =>
      entry.sequenceNumber === 3 ? { ...entry, publicSummary: undefined } : entry);
    const replay = built({ acceptedEvents: silent, episodes: [] });
    const mill = replay.scenes.find((scene) => scene.locationId === MILL);
    expect(mill?.steps.some((step) => step.type === 'eventCard')).toBe(false);
    // The scene still exists and still runs for its minimum: a slot that produced no public
    // sentence still happened.
    expect(mill?.durationMs).toBeGreaterThanOrEqual(REPLAY_SCENE_MIN_MS);
  });

  it('places participants at real map anchors, and drops the ones it cannot place', () => {
    const replay = built();
    const hall = replay.scenes.find((scene) => scene.locationId === HALL)!;
    // Both were placed somewhere before the scene, so both are placeable.
    expect(hall.participants.map((participant) => participant.characterId)).toEqual(['he-jun', 'wu-zhen']);
    for (const participant of hall.participants) {
      for (const point of [participant.startPosition, participant.endPosition]) {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
      }
    }
    // He Jun did not move, so he gets no move step; Wu Zhen walked from the square.
    const movers = hall.steps.flatMap((step) => (step.type === 'move' ? [step.characterId] : []));
    expect(movers).toEqual(['wu-zhen']);
  });

  it('drops a participant whose location was never recorded rather than guessing one', () => {
    // Nobody has a position before the very first event, so the scene keeps its identity and
    // its card but places no one.
    const noSetup = EVENTS.filter((entry) => entry.worldDay > 0);
    const replay = built({ acceptedEvents: noSetup });
    const hall = replay.scenes.find((scene) => scene.locationId === HALL)!;
    expect(hall.participants).toEqual([]);
    expect(hall.steps.some((step) => step.type === 'move')).toBe(false);
  });

  it('drops a dead or deactivated character the map already refuses to draw', () => {
    const replay = built({ excludedCharacterIds: new Set(['wu-zhen']) });
    const named = replay.scenes.flatMap((scene) => scene.participants.map((p) => p.characterId));
    expect(named).not.toContain('wu-zhen');
  });
});

describe('AC#4 — construction generates nothing', () => {
  const source = readFileSync(join(process.cwd(), 'convex/publicRead/visualReplay.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('names no Convex context, no Canon write symbol, and no provider', () => {
    for (const forbidden of [
      'ctx.db', '_generated', 'internalMutation', 'commitProposedEvent',
      'validateAndCommitProposedEvent', 'reduceWorldEvent', 'seedWorldCharacters', 'importWorld',
      'fetch(', 'openai', '@anthropic-ai',
    ]) {
      expect(`${forbidden}:${code.includes(forbidden)}`).toBe(`${forbidden}:false`);
    }
    expect(source).not.toContain("from 'convex/");
  });

  it('reads no clock and no randomness, so two rebuilds of an unchanged world agree', () => {
    for (const pattern of [/\bDate(?:\.now|\s*\()/, /\bMath\.random\s*\(/, /\bperformance\.now\s*\(/]) {
      expect(code).not.toMatch(pattern);
    }
    expect(JSON.stringify(built())).toBe(JSON.stringify(built()));
  });

  it('produces the same replayId until a newly completed slot changes what is replayable', () => {
    const before = built();
    // A sixth event in the current slot does not change what is COMPLETED, so the replay is
    // byte-identical and the read model deduplicates.
    const withMoreCurrent = [
      ...EVENTS,
      event({ sequenceNumber: 6, worldDay: 2, timeSlot: 'morning', locationId: ORCHARD, participantIds: ['he-jun'], publicSummary: 'x' }),
    ];
    expect(JSON.stringify(built({ acceptedEvents: withMoreCurrent }))).toBe(JSON.stringify(before));

    // Advancing the world so the orchard slot completes DOES change it.
    const nextSlot = [
      ...withMoreCurrent,
      event({ sequenceNumber: 7, worldDay: 2, timeSlot: 'noon', locationId: SQUARE, participantIds: ['he-jun'], publicSummary: 'y', move: { characterId: 'he-jun', toLocationId: SQUARE } }),
    ];
    expect(built({ acceptedEvents: nextSlot }).replayId).not.toBe(before.replayId);
  });
});

describe('AC#10 — references, never free-text copies', () => {
  it('stores no fixture sentence anywhere at any depth', () => {
    const strings = allStrings(built());
    for (const text of Object.values(SOURCE_TEXTS)) {
      for (const stored of strings) {
        expect(`${text}|${stored.includes(text)}`).toBe(`${text}|false`);
      }
    }
  });

  it('names no forbidden field at any depth', () => {
    const keys = new Set(allStrings(built()));
    for (const forbidden of REPLAY_FORBIDDEN_FIELDS) {
      // A forbidden name may not appear as a key. `assertVisualReplay` enforces this on every
      // build; this restates it against the real fixture so the enforcement is visibly wired.
      expect(`${forbidden}:${keys.has(forbidden)}`).toBe(`${forbidden}:false`);
    }
    expect(REPLAY_FORBIDDEN_FIELDS).toEqual(expect.arrayContaining([
      'text', 'summary', 'title', 'content', 'excerpt', 'dialogue', 'body', 'caption',
      // Inherited from the dynamic projection's own denylist.
      'memory', 'prompt', 'apiKey', 'privateGoal', 'dialogueHighlights',
    ]));
  });

  it('gives every card exactly its allowlisted keys and nothing else', () => {
    for (const card of stepsOfType(built(), 'eventCard')) {
      expect(Object.keys(card).sort()).toEqual(
        ['durationMs', 'publicSummaryId', 'publicationVersion', 'refKind', 'type'],
      );
    }
    for (const move of stepsOfType(built(), 'move')) {
      expect(Object.keys(move).sort()).toEqual(['characterId', 'durationMs', 'to', 'type']);
    }
  });

  it('never emits a dialogue step — ART-123 owns the store one would address', () => {
    // The type exists so FR-O004 widens this contract rather than redefining it. Producing
    // one here would be addressing a store that does not exist yet.
    const variants = [
      built(),
      built({ episodes: [] }),
      built({ publicationRecords: new Map() }),
      built({ excludedCharacterIds: new Set(['wu-zhen', 'he-jun']) }),
    ];
    for (const replay of variants) {
      expect(stepsOfType(replay, 'dialogue')).toEqual([]);
      expect(replayTextReferences(replay).every((reference) => reference.refKind !== 'publicExcerpt')).toBe(true);
    }
  });

  it('mints addresses that parse back to the publication record they govern', () => {
    const reference = replayTextReferences(built()).find((entry) => entry.refKind === 'episodeScene')!;
    expect(parseEpisodeSceneSummaryId(reference.publicSummaryId)).toEqual({
      contentRef: `episode:${WORLD_ID}:1`,
      worldDay: 1,
      sceneIndex: 0,
    });
    expect(parseEpisodeSceneSummaryId('canonEvent:whatever')).toBeNull();
  });

  it('refuses a payload that smuggled text in, wherever it hid', () => {
    const replay = built();
    const withText = JSON.parse(JSON.stringify(replay)) as MutableReplay;
    withText.scenes[0].steps[0].summary = '偷渡的句子';
    expect(() => assertVisualReplay(withText)).toThrow('VISUAL_REPLAY');
    expect(selectVisualReplay(withText)).toBeNull();

    const nested = JSON.parse(JSON.stringify(replay)) as MutableReplay;
    nested.scenes[0].participants[0].dialogue = 'x';
    expect(() => assertVisualReplay(nested)).toThrow('VISUAL_REPLAY');
  });

  it('refuses a payload whose durations no longer add up', () => {
    const replay = JSON.parse(JSON.stringify(built())) as MutableReplay;
    replay.scenes[0].durationMs += 1;
    expect(() => assertVisualReplay(replay)).toThrow('VISUAL_REPLAY_INVALID_VALUE');
    expect(selectVisualReplay(replay)).toBeNull();
    // And a payload from an older contract is null, not a thrown error: the live map must
    // survive a replay it cannot read.
    expect(selectVisualReplay({ schemaVersion: 0 })).toBeNull();
    expect(selectVisualReplay(null)).toBeNull();
  });
});
