import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MISTWOOD_SEED_PLACEMENTS } from '../visualRuntime/fixtures';
import { mistwoodRuntimeContext } from '../visualRuntime/mistwoodRuntime';
import {
  buildActiveScenePresentations,
  eventLocationId,
  resolveSceneSpatials,
  WITHHELD_SCENE_TITLE,
  type PublishedKeyScene,
  type SceneArcMembership,
  type SceneEventLike,
  type SceneSafetyLabel,
} from './activeScenePresentation';
import {
  assertPublicDynamicProjection,
  buildPublicDynamicProjection,
  toPublicActiveScene,
} from './publicDynamicProjection';

const HALL = 'mistwood-hall';
const MARKET = 'mistwood-market';
const STATION = 'mistwood-station';

function event(over: Partial<SceneEventLike> & { sequenceNumber: number }): SceneEventLike {
  return {
    eventId: `evt-${over.sequenceNumber}`,
    worldDay: 3,
    timeSlot: 'evening',
    acceptedAt: 1_000 + over.sequenceNumber,
    participantIds: [],
    stateChanges: [],
    ...over,
  };
}

function moved(characterId: string, toLocationId: string) {
  return { type: 'character_location_changed', toLocationId, characterId };
}

const NO_EXCLUSIONS: ReadonlySet<string> = new Set<string>();

function build(input: {
  acceptedEvents: readonly SceneEventLike[];
  arcMemberships?: readonly SceneArcMembership[];
  publishedEpisodeScenes?: readonly PublishedKeyScene[];
  excludedCharacterIds?: ReadonlySet<string>;
  sceneSafetyLabels?: ReadonlyMap<string, SceneSafetyLabel>;
}) {
  return buildActiveScenePresentations({
    acceptedEvents: input.acceptedEvents,
    arcMemberships: input.arcMemberships ?? [],
    publishedEpisodeScenes: input.publishedEpisodeScenes ?? [],
    excludedCharacterIds: input.excludedCharacterIds ?? NO_EXCLUSIONS,
    ...(input.sceneSafetyLabels === undefined ? {} : { sceneSafetyLabels: input.sceneSafetyLabels }),
  });
}

describe('AC#6 — spatial facts are traced back to accepted events', () => {
  it('resolves location, participants, arcs and Canon timestamps from the traced set', () => {
    const spatials = resolveSceneSpatials(
      [
        event({ sequenceNumber: 5, locationId: HALL, participantIds: ['rowan', 'cassia'], acceptedAt: 500 }),
        event({ sequenceNumber: 7, locationId: HALL, participantIds: ['cassia'], acceptedAt: 700 }),
        // No locationId of its own: the arrival named by its state change places it instead.
        event({ sequenceNumber: 6, participantIds: ['bram'], stateChanges: [moved('bram', MARKET)], acceptedAt: 600 }),
      ],
      {
        arcIdsBySequence: new Map([[5, ['arc-truce']], [7, ['arc-truce', 'arc-debt']]]),
        excludedCharacterIds: NO_EXCLUSIONS,
      },
    );

    // HALL wins on frequency (2 events name it directly) over the single fallback arrival.
    expect(spatials.locationId).toBe(HALL);
    expect(spatials.participantCharacterIds).toEqual(['bram', 'cassia', 'rowan']);
    expect(spatials.arcIds).toEqual(['arc-debt', 'arc-truce']);
    // Min and max *sequence number*, not min and max timestamp.
    expect(spatials.startedAt).toBe(500);
    expect(spatials.endedAt).toBe(700);
    expect(spatials.sourceEventIds).toEqual(['evt-5', 'evt-6', 'evt-7']);
  });

  it('excludes a character the map itself refuses to draw', () => {
    const spatials = resolveSceneSpatials(
      [event({ sequenceNumber: 1, locationId: HALL, participantIds: ['rowan', 'ghost'] })],
      { arcIdsBySequence: new Map(), excludedCharacterIds: new Set(['ghost']) },
    );
    // A scene must never list a participant the map has already removed as dead or
    // deactivated, or the panel and the canvas would disagree about who is present.
    expect(spatials.participantCharacterIds).toEqual(['rowan']);
  });

  it('omits the location entirely rather than inventing one', () => {
    const spatials = resolveSceneSpatials(
      [event({ sequenceNumber: 1, participantIds: ['rowan'] })],
      { arcIdsBySequence: new Map(), excludedCharacterIds: NO_EXCLUSIONS },
    );
    expect(spatials.locationId).toBeUndefined();
    expect('locationId' in spatials).toBe(false);
  });

  it('breaks a location tie by ascending id, so an unchanged world re-derives identically', () => {
    const events = [
      event({ sequenceNumber: 1, locationId: MARKET }),
      event({ sequenceNumber: 2, locationId: HALL }),
    ];
    const options = { arcIdsBySequence: new Map(), excludedCharacterIds: NO_EXCLUSIONS };
    expect(resolveSceneSpatials(events, options).locationId).toBe(HALL);
    expect(resolveSceneSpatials([...events].reverse(), options).locationId).toBe(HALL);
  });

  it('places an unplaced event where the character arrived, never where they left', () => {
    // `fromLocationId` is not merely unread — it is absent from `SceneStateChangeLike`, so
    // this fixture needs a cast to carry it at all. Placing a scene where someone *left*
    // would put it in the wrong room; the type makes that unreachable rather than unlikely.
    const change = { type: 'character_location_changed', fromLocationId: STATION, toLocationId: HALL };
    expect(eventLocationId(event({ sequenceNumber: 1, stateChanges: [change] }))).toBe(HALL);
  });
});

describe('AC#7 — a scene is presentable before the day’s episode is ready', () => {
  // The regression test that proves the task: this is exactly the state the map was in for
  // most of every world day before ART-122, and it produced nothing at all.
  it('presents the current slot from accepted Canon with ZERO published episodes', () => {
    const result = build({
      acceptedEvents: [
        event({ sequenceNumber: 1, worldDay: 3, timeSlot: 'morning', locationId: STATION }),
        event({ sequenceNumber: 2, worldDay: 3, timeSlot: 'evening', locationId: HALL, participantIds: ['rowan'], publicSummary: '眾人聚集。' }),
      ],
      publishedEpisodeScenes: [],
    });

    expect(result.mode).toBe('canon');
    expect(result.scenes).toHaveLength(1);
    const [scene] = result.scenes;
    expect(scene.status).toBe('active');
    expect(scene.sceneId).toBe(`3:evening:${HALL}`);
    expect(scene.locationId).toBe(HALL);
    expect(scene.title).toBe(`${HALL} · evening`);
    expect(scene.summary).toBe('眾人聚集。');
    expect(scene.publicationStatus).toBe('published');
    // An active scene has no end: publishing one would assert a conclusion Canon has not
    // reached, and the map would render a live scene as finished.
    expect(scene.endedAt).toBeUndefined();
    expect(scene.startedAt).toBe(1_002);
  });

  it('emits one scene per co-located group in the current slot, newest activity first', () => {
    const result = build({
      acceptedEvents: [
        event({ sequenceNumber: 1, locationId: HALL }),
        event({ sequenceNumber: 4, locationId: MARKET }),
        event({ sequenceNumber: 2, locationId: HALL }),
      ],
    });
    expect(result.scenes.map((scene) => scene.locationId)).toEqual([MARKET, HALL]);
  });

  it('adopts a published key scene’s narration once the episode lands', () => {
    const result = build({
      acceptedEvents: [event({ sequenceNumber: 1, locationId: HALL, publicSummary: '原始摘要。' })],
      publishedEpisodeScenes: [{ title: '簽約', summary: '眾人見證休戰。', sourceEventIds: ['evt-1'] }],
    });
    expect(result.mode).toBe('episode');
    expect(result.scenes[0].title).toBe('簽約');
    expect(result.scenes[0].summary).toBe('眾人見證休戰。');
  });

  it('joins the traced events’ public summaries in Canon order when nothing narrated them', () => {
    const result = build({
      acceptedEvents: [
        event({ sequenceNumber: 2, locationId: HALL, publicSummary: '第二。' }),
        event({ sequenceNumber: 1, locationId: HALL, publicSummary: '第一。' }),
      ],
    });
    expect(result.scenes[0].summary).toBe('第一。 第二。');
  });
});

describe('AC#8 — degrading to the most recent completed scene', () => {
  it('falls back to one ended scene when the current slot has nothing placeable', () => {
    const result = build({
      acceptedEvents: [
        event({ sequenceNumber: 1, worldDay: 3, timeSlot: 'morning', locationId: STATION, acceptedAt: 100 }),
        event({ sequenceNumber: 2, worldDay: 3, timeSlot: 'noon', locationId: HALL, acceptedAt: 200 }),
        // The newest event names no location at all, so the current slot yields no group.
        event({ sequenceNumber: 3, worldDay: 3, timeSlot: 'evening' }),
      ],
    });

    expect(result.mode).toBe('degraded');
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0].status).toBe('ended');
    expect(result.scenes[0].locationId).toBe(HALL);
    expect(result.scenes[0].endedAt).toBe(200);
  });

  it('yields nothing at all for a world with no placeable history', () => {
    expect(build({ acceptedEvents: [] })).toEqual({ scenes: [], mode: 'none' });
    expect(build({ acceptedEvents: [event({ sequenceNumber: 1 })] })).toEqual({ scenes: [], mode: 'none' });
  });
});

describe('AC#4 — private and unpublished content can never surface', () => {
  it('publishes no summary at all when the only text lives in a private field', () => {
    const result = build({
      acceptedEvents: [event({
        sequenceNumber: 1,
        locationId: HALL,
        // A state change's `reason` carries private causal detail. It must not become the
        // public summary; an empty summary is the correct, smaller failure.
        stateChanges: [{ type: 'character_life_changed', reason: 'poisoned by Cassia' } as never],
      })],
    });
    expect(result.scenes[0].summary).toBe('');
    expect(JSON.stringify(result.scenes)).not.toContain('poisoned');
  });

  it('ignores an unpublished episode’s scenes entirely', () => {
    // The caller only ever passes key scenes from a `ready` episode; a withheld or failed
    // one contributes an empty list, and the scene falls back to Canon-derived text.
    const result = build({
      acceptedEvents: [event({ sequenceNumber: 1, locationId: HALL, publicSummary: '公開摘要。' })],
      publishedEpisodeScenes: [],
    });
    expect(result.mode).toBe('canon');
    expect(result.scenes[0].summary).toBe('公開摘要。');
  });

  it('reads no private field name anywhere in the resolver’s code', () => {
    const source = readFileSync(join(process.cwd(), 'convex/publicRead/activeScenePresentation.ts'), 'utf8');
    // Comments are stripped first: the module header names the rejected sources on purpose,
    // to explain why they are rejected. What must stay clean is the code.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // The event type this module declares names `publicSummary` and nothing else textual, so
    // these are unreachable by construction. Asserted anyway, because the cheapest moment to
    // catch a widened input type is before it is widened.
    for (const field of ['metadata', 'reason', 'interpretation', 'beliefValue', 'content', 'sceneSimulationRuns', 'GroupedScene']) {
      expect(`${field}:${code.includes(field)}`).toBe(`${field}:false`);
    }
  });

  it('cannot reach Canon or a Convex context', () => {
    const source = readFileSync(join(process.cwd(), 'convex/publicRead/activeScenePresentation.ts'), 'utf8');
    expect(source).not.toContain('_generated');
    expect(source).not.toContain("from 'convex/");
    expect(source).not.toContain('ctx.db');
  });
});

describe('the published shape survives the public contract’s own validation', () => {
  it('passes assertPublicDynamicProjection with every ART-122 field populated', () => {
    const result = build({
      acceptedEvents: [
        event({ sequenceNumber: 1, locationId: HALL, participantIds: ['rowan', 'cassia'], publicSummary: '摘要。' }),
      ],
      arcMemberships: [{ sourceEventSequenceNumber: 1, arcIds: ['arc-truce'] }],
    });

    expect(() => assertPublicDynamicProjection({
      worldId: 'mistwood', mapId: 'mistwood-v1', runtimeVersion: 3, snapshotSequence: 2,
      updatedAt: 1_001, worldStatus: 'running', characters: [],
      activeScenes: result.scenes.map(toPublicActiveScene),
    })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// FR-P004 / ART-132 — the safety gate
// ---------------------------------------------------------------------------

describe('FR-P004 AC#1/#2 — only publicly permitted text reaches the overlay', () => {
  const SCENE_A = 'mistwood:3:evening:grouping:scene:1';
  const SCENE_B = 'mistwood:3:evening:grouping:scene:2';
  const REFUSED = '這段內容不得公開。';

  const labels = (entries: readonly [string, SceneSafetyLabel][]) =>
    new Map<string, SceneSafetyLabel>(entries);

  const oneRefusedScene = (label: SceneSafetyLabel) => build({
    acceptedEvents: [
      event({ sequenceNumber: 1, locationId: HALL, participantIds: ['rowan', 'cassia'], publicSummary: REFUSED, sceneId: SCENE_A }),
    ],
    arcMemberships: [{ sourceEventSequenceNumber: 1, arcIds: ['arc-truce'] }],
    sceneSafetyLabels: labels([[SCENE_A, label]]),
  });

  it.each(['withhold', 'human_review_required'] as const)(
    'replaces a %s scene’s text with a generic placeholder and marks it withheld',
    (label) => {
      const [scene] = oneRefusedScene(label).scenes;
      expect(scene.title).toBe(WITHHELD_SCENE_TITLE);
      expect(scene.summary).toBe('');
      expect(scene.publicationStatus).toBe('withheld');
      // The refused sentence is absent from the whole payload, not merely from `summary`:
      // a partial redaction that left it in some other field would be the same leak.
      expect(JSON.stringify(scene)).not.toContain(REFUSED);
      // The placeholder says nothing about the scene either — no location name, no
      // participant, no hint of why it was refused.
      expect(WITHHELD_SCENE_TITLE).not.toContain(HALL);
    },
  );

  it.each(['allow', 'allow_with_warning'] as const)('publishes a %s scene unchanged', (label) => {
    const [scene] = oneRefusedScene(label).scenes;
    expect(scene.title).toBe(`${HALL} · evening`);
    expect(scene.summary).toBe(REFUSED);
    expect(scene.publicationStatus).toBe('published');
  });

  it('withholds a scene even when a published episode narrated it', () => {
    // The episode's own text passed the EDITORIAL classification; the scene's did not pass the
    // post-generation one. A scene under review must not be able to borrow approved words and
    // present itself as published.
    const result = build({
      acceptedEvents: [event({ sequenceNumber: 1, locationId: HALL, publicSummary: REFUSED, sceneId: SCENE_A })],
      publishedEpisodeScenes: [{ title: '簽約', summary: '眾人見證休戰。', sourceEventIds: ['evt-1'] }],
      sceneSafetyLabels: labels([[SCENE_A, 'withhold']]),
    });
    expect(result.scenes[0].title).toBe(WITHHELD_SCENE_TITLE);
    expect(result.mode).toBe('canon');
  });

  it('keeps showing a scene whose events carry no Scene id, and one with no verdict', () => {
    // Seed, system and remediation events were never seen by a post-generation classifier.
    // Reading their silence as a refusal would blank the map for content never in question.
    const unstamped = build({
      acceptedEvents: [event({ sequenceNumber: 1, locationId: HALL, publicSummary: '公開摘要。' })],
      sceneSafetyLabels: labels([[SCENE_A, 'withhold']]),
    });
    expect(unstamped.scenes[0].publicationStatus).toBe('published');
    expect(unstamped.scenes[0].summary).toBe('公開摘要。');

    const unjudged = build({
      acceptedEvents: [event({ sequenceNumber: 1, locationId: HALL, publicSummary: '公開摘要。', sceneId: SCENE_B })],
      sceneSafetyLabels: labels([[SCENE_A, 'withhold']]),
    });
    expect(unjudged.scenes[0].publicationStatus).toBe('published');
  });

  it('behaves exactly as it did before ART-132 when no labels are supplied at all', () => {
    const result = build({
      acceptedEvents: [event({ sequenceNumber: 1, locationId: HALL, publicSummary: '公開摘要。', sceneId: SCENE_A })],
    });
    expect(result.scenes[0]).toEqual(build({
      acceptedEvents: [event({ sequenceNumber: 1, locationId: HALL, publicSummary: '公開摘要。' })],
    }).scenes[0]);
  });

  it('withholds a co-located group when only ONE of its Scenes was refused', () => {
    // Two Scenes can share a (worldDay, timeSlot, locationId) and therefore one group. The
    // group publishes their summaries JOINED, so publishing it would publish the refused half.
    const result = build({
      acceptedEvents: [
        event({ sequenceNumber: 1, locationId: HALL, publicSummary: '無害的摘要。', sceneId: SCENE_B }),
        event({ sequenceNumber: 2, locationId: HALL, publicSummary: REFUSED, sceneId: SCENE_A }),
      ],
      sceneSafetyLabels: labels([[SCENE_A, 'withhold'], [SCENE_B, 'allow']]),
    });
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0].publicationStatus).toBe('withheld');
    expect(JSON.stringify(result.scenes)).not.toContain(REFUSED);
    expect(JSON.stringify(result.scenes)).not.toContain('無害的摘要。');
  });

  it('withholds a degraded (AC#8) stand-in scene too', () => {
    const result = build({
      acceptedEvents: [
        event({ sequenceNumber: 1, worldDay: 2, timeSlot: 'noon', locationId: HALL, publicSummary: REFUSED, sceneId: SCENE_A }),
        // A later, unplaceable event moves "now" past the scene without producing one.
        event({ sequenceNumber: 2, worldDay: 3, timeSlot: 'evening' }),
      ],
      sceneSafetyLabels: labels([[SCENE_A, 'withhold']]),
    });
    expect(result.mode).toBe('degraded');
    expect(result.scenes[0].status).toBe('ended');
    expect(result.scenes[0].publicationStatus).toBe('withheld');
    expect(JSON.stringify(result.scenes)).not.toContain(REFUSED);
  });
});

describe('FR-P004 AC#5 — a withheld scene stays traceable, and stays a legal payload', () => {
  const SCENE_A = 'mistwood:3:evening:grouping:scene:1';

  const withheld = build({
    acceptedEvents: [
      event({ sequenceNumber: 1, locationId: HALL, participantIds: ['cassia', 'rowan'], publicSummary: '祕密。', sceneId: SCENE_A }),
      event({ sequenceNumber: 2, locationId: HALL, participantIds: ['rowan'], publicSummary: '更多祕密。', sceneId: SCENE_A }),
    ],
    arcMemberships: [{ sourceEventSequenceNumber: 1, arcIds: ['arc-truce'] }],
    sceneSafetyLabels: new Map<string, SceneSafetyLabel>([[SCENE_A, 'withhold']]),
  });

  it('still names the accepted events it was derived from', () => {
    // AC#5 applies to the placeholder as much as to real text: a public string with no
    // provenance is exactly what the criterion forbids, whatever the string says.
    expect(withheld.scenes[0].sourceEventIds).toEqual(['evt-1', 'evt-2']);
    expect(withheld.scenes[0].sceneId).toBe(`3:evening:${HALL}`);
    expect(withheld.scenes[0].locationId).toBe(HALL);
    expect(withheld.scenes[0].participantCharacterIds).toEqual(['cassia', 'rowan']);
    expect(withheld.scenes[0].arcIds).toEqual(['arc-truce']);
    expect(withheld.scenes[0].startedAt).toBe(1_001);
  });

  it('passes the public contract’s own validation with publicationStatus "withheld"', () => {
    expect(() => assertPublicDynamicProjection({
      worldId: 'mistwood', mapId: 'mistwood-v1', runtimeVersion: 3, snapshotSequence: 3,
      updatedAt: 1_002, worldStatus: 'running', characters: [],
      activeScenes: withheld.scenes.map(toPublicActiveScene),
    })).not.toThrow();
  });
});

describe('FR-P004 AC#4 — withholding text does not move a single character', () => {
  const SCENE_A = 'mistwood:3:evening:grouping:scene:1';
  const EVENTS = [
    event({ sequenceNumber: 1, locationId: HALL, participantIds: ['rowan'], publicSummary: '祕密。', sceneId: SCENE_A }),
  ];

  /**
   * The whole public payload, built the way `rebuildLiveProjection` builds it: the scene
   * presentation is derived first and handed to the projection as `activeScenes`. Character
   * motion is planned from the accepted events and the seed placements alone — which is the
   * claim, and a claim worth a test rather than an assumption, because "the two code paths are
   * separate" is exactly the kind of property a later refactor dissolves silently.
   */
  const projectWith = (sceneSafetyLabels?: ReadonlyMap<string, SceneSafetyLabel>) => {
    const runtime = mistwoodRuntimeContext();
    return buildPublicDynamicProjection({
      worldId: 'mistwood',
      nowMs: 2_000,
      runtime: { mapId: runtime.mapId, grid: runtime.grid, bindings: runtime.bindings },
      seedPlacements: MISTWOOD_SEED_PLACEMENTS,
      acceptedEvents: EVENTS,
      worldStatus: 'running',
      activeScenes: build({ acceptedEvents: EVENTS, ...(sceneSafetyLabels === undefined ? {} : { sceneSafetyLabels }) }).scenes,
    });
  };

  it('produces byte-identical character motion whether or not the scene is withheld', () => {
    const shown = projectWith();
    const hidden = projectWith(new Map<string, SceneSafetyLabel>([[SCENE_A, 'withhold']]));

    expect(hidden.activeScenes[0].publicationStatus).toBe('withheld');
    expect(shown.activeScenes[0].publicationStatus).toBe('published');
    expect(shown.characters.length).toBeGreaterThan(0);
    expect(JSON.stringify(hidden.characters)).toBe(JSON.stringify(shown.characters));
    // And nothing else about the world moved either: the payload differs in the scene text
    // and in nothing more.
    expect({ ...hidden, activeScenes: [] }).toEqual({ ...shown, activeScenes: [] });
  });
});
