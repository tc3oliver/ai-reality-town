/**
 * Unit tests for the Live Story Overlay's display model (ART-125 / FR-O007).
 *
 * Three headline claims.
 *
 * **The primary-arc ranking (AC#1).** The backend publishes active arcs unranked, so "which arc
 * is the story right now" is this module's one real judgement. It is tested against every status
 * in `ACTIVE_ARC_STATUSES`, against a tie, and against an unknown status — the last because the
 * published `status` is a plain `string`, not a union, so a status this build has never heard of
 * is a real payload and must still leave a primary arc rather than none.
 *
 * **Loading versus unavailable.** `undefined` (a read in flight) and `null` (a read that
 * completed and found nothing published) must not be collapsed, or a world whose onboarding
 * summary has never been built shows "loading…" forever. Same distinction
 * `characterCardModel.test.ts` makes for the card.
 *
 * **Sync with the map (AC#4).** The day, the slot and the scenes are asserted to be the ones
 * handed in from the projection the canvas is drawing — the overlay derives none of them a second
 * way, which is the only way two surfaces can be guaranteed not to disagree.
 *
 * Pure jest (no jsdom).
 */

import { ACTIVE_ARC_STATUSES } from '../../../convex/publicRead/liveState';
import { composeHomepageViewModel } from '../public/homeRoute';
import {
  STORY_ARC_STATUS_PRIORITY,
  STORY_OVERLAY_SCENE_BRIEF_LIMIT,
  composeStoryOverlayViewModel,
  primaryStoryArc,
  type StoryOverlayArcInput,
  type StoryOverlaySummaryInput,
} from './storyOverlayModel';

const WORLD_ID = 'mistwood';

function arc(overrides: Partial<StoryOverlayArcInput> = {}): StoryOverlayArcInput {
  return {
    arcId: 'arc-truce',
    title: '休戰協議',
    currentQuestion: '休戰能撐過這個冬天嗎?',
    status: 'active',
    ...overrides,
  };
}

function summary(overrides: Partial<StoryOverlaySummaryInput['structured']> = {}): StoryOverlaySummaryInput {
  return {
    summaryText: '近期大事:兩派在鎮公所簽下休戰。',
    structured: {
      majorEvent: { eventId: 'e-42', publicSummary: '兩派在鎮公所簽下休戰。' },
      recommendedEpisode: { episodeNumber: 3, worldDay: 7 },
      ...overrides,
    },
  };
}

function compose(
  overrides: Partial<Parameters<typeof composeStoryOverlayViewModel>[0]> = {},
) {
  return composeStoryOverlayViewModel({
    worldId: WORLD_ID,
    summary: summary(),
    activeArcs: [arc()],
    worldDay: 7,
    timeSlot: 'evening',
    scenes: [{ title: '簽約', status: 'active' }],
    ...overrides,
  });
}

describe('primaryStoryArc (FR-O007 AC#1)', () => {
  test('ranks exactly the statuses the backend calls active, and no others', () => {
    // Pinned against the producer's own constant rather than a hand-copied list. The overlay
    // ranks these client-side because the backend deliberately publishes `activeArcs` unranked,
    // so the two lists are related only by this assertion — without it, a fifth lifecycle stage
    // added server-side would silently rank last here with nothing to notice.
    expect([...STORY_ARC_STATUS_PRIORITY].sort()).toEqual([...ACTIVE_ARC_STATUSES].sort());
  });

  test('the four published statuses rank climax > escalating > active > resolving', () => {
    // Fed in reverse priority order, so a function that simply took the first arc would fail.
    const arcs = [...STORY_ARC_STATUS_PRIORITY]
      .reverse()
      .map((status) => arc({ arcId: `arc-${status}`, status }));
    expect(primaryStoryArc(arcs)?.status).toBe('climax');

    // ...and the ranking is a total order over the four, not just a "climax wins" special case.
    for (let index = 1; index < STORY_ARC_STATUS_PRIORITY.length; index += 1) {
      const tail = STORY_ARC_STATUS_PRIORITY.slice(index).map((status) =>
        arc({ arcId: `arc-${status}`, status }),
      );
      expect(primaryStoryArc(tail)?.status).toBe(STORY_ARC_STATUS_PRIORITY[index]);
    }
  });

  test('a tie is broken by arcId, so the same payload always names the same arc', () => {
    const ascending = [
      arc({ arcId: 'arc-b', status: 'climax' }),
      arc({ arcId: 'arc-a', status: 'climax' }),
      arc({ arcId: 'arc-c', status: 'climax' }),
    ];
    expect(primaryStoryArc(ascending)?.arcId).toBe('arc-a');
    // Order-independent: the backend does not promise a publication order, so neither may this.
    expect(primaryStoryArc([...ascending].reverse())?.arcId).toBe('arc-a');
  });

  test('an unknown status ranks last but is still eligible', () => {
    // `status` is published as a plain string. A future lifecycle stage must not disappear from
    // the overlay just because this build has not heard of it.
    expect(primaryStoryArc([arc({ arcId: 'arc-x', status: 'simmering' })])?.arcId).toBe('arc-x');
    const mixed = [
      arc({ arcId: 'arc-x', status: 'simmering' }),
      arc({ arcId: 'arc-r', status: 'resolving' }),
    ];
    expect(primaryStoryArc(mixed)?.arcId).toBe('arc-r');
  });

  test('no arcs at all is null, not a fabricated one', () => {
    expect(primaryStoryArc([])).toBeNull();
  });
});

describe('composeStoryOverlayViewModel (FR-O007 AC#1/#2)', () => {
  test('answers all five of AC#1 from the published payloads', () => {
    const model = compose();
    expect(model.summaryStatus).toBe('ready');
    expect(model.arcStatus).toBe('ready');
    expect(model.worldDayLabel).toBe('第 7 天');
    expect(model.timeSlotLabel).toBe('evening');
    expect(model.currentSituationText).toBe('近期大事:兩派在鎮公所簽下休戰。');
    expect(model.primaryArc).toEqual({
      arcId: 'arc-truce',
      title: '休戰協議',
      status: 'active',
      statusLabel: '進行中',
      currentQuestion: '休戰能撐過這個冬天嗎?',
    });
    expect(model.activeSceneSummary).toEqual({ count: 1, brief: '簽約' });
    expect(model.latestMajorEvent).toBe('兩派在鎮公所簽下休戰。');
  });

  test('the latest major event is the summary’s importance-ranked one, not a scene title', () => {
    // The onboarding summary picks by importance; `activeScenes` is merely what is on screen.
    const model = compose({
      summary: summary({ majorEvent: { eventId: 'e-9', publicSummary: '水車被洪水沖垮。' } }),
      scenes: [{ title: '閒聊', status: 'active' }],
    });
    expect(model.latestMajorEvent).toBe('水車被洪水沖垮。');
  });

  test('an unknown arc status falls back to showing the raw status rather than a blank', () => {
    const model = compose({ activeArcs: [arc({ status: 'simmering' })] });
    expect(model.primaryArc?.statusLabel).toBe('simmering');
  });

  test('ended scenes are excluded: the overlay claims the present tense', () => {
    const model = compose({
      scenes: [
        { title: '簽約', status: 'active' },
        { title: '昨日的爭執', status: 'ended' },
      ],
    });
    expect(model.activeSceneSummary).toEqual({ count: 1, brief: '簽約' });
  });

  test('the scene brief is bounded and says so when it elides', () => {
    const scenes = ['一', '二', '三', '四'].map((title) => ({ title, status: 'active' as const }));
    const model = compose({ scenes });
    expect(model.activeSceneSummary.count).toBe(4);
    expect(model.activeSceneSummary.brief).toBe(
      `${scenes.slice(0, STORY_OVERLAY_SCENE_BRIEF_LIMIT).map((scene) => scene.title).join('、')}…`,
    );
  });

  test('a scene payload predating ART-122 (no status, no title) degrades rather than breaking', () => {
    const model = compose({ scenes: [{}, { title: '簽約' }] });
    // Both count as active — an absent status is not "ended" — but only the named one is briefed.
    expect(model.activeSceneSummary).toEqual({ count: 2, brief: '簽約' });
  });
});

describe('the recommended entry point (FR-O007 AC#2)', () => {
  test('links the same Episode, the same way, as the homepage does from the same field', () => {
    // Both surfaces read `structured.recommendedEpisode` off the SAME published summary, so a
    // viewer who arrives from either must land on the same page. Asserted against the homepage's
    // real output rather than against a hand-written string, which would keep passing if the two
    // drifted apart.
    const home = composeHomepageViewModel({
      worldId: WORLD_ID,
      summary: {
        summaryText: summary().summaryText,
        structured: {
          majorEvent: summary().structured.majorEvent,
          importance: 0.9,
          characters: [],
          facts: [],
          question: null,
          recommendedEpisode: summary().structured.recommendedEpisode,
        },
      },
      world: null,
      live: null,
      base: '/ai-town/',
    });
    const overlay = compose();
    expect(overlay.recommendedEntry).not.toBeNull();
    expect(overlay.recommendedEntry?.href).toBe(home.recommendedEpisode?.href);
    expect(overlay.recommendedEntry?.episodeNumber).toBe(home.recommendedEpisode?.episodeNumber);
  });

  test('a world with no recommended Episode offers no link rather than a broken one', () => {
    expect(compose({ summary: summary({ recommendedEpisode: null }) }).recommendedEntry).toBeNull();
  });
});

describe('each source reports its own state, never the panel’s', () => {
  test('both reads in flight is `loading` on both', () => {
    const model = compose({ summary: undefined, activeArcs: undefined });
    expect(model.summaryStatus).toBe('loading');
    expect(model.arcStatus).toBe('loading');
    expect(model.currentSituationText).toBeNull();
    expect(model.primaryArc).toBeNull();
    expect(model.latestMajorEvent).toBeNull();
    expect(model.recommendedEntry).toBeNull();
  });

  test('a read that completed with nothing published is `unavailable`, never a permanent spinner', () => {
    // `serveReadModel` returns `null` for a model that has never been built. Rendering "loading"
    // there waits forever for something that is not coming.
    const model = compose({ summary: null, activeArcs: null });
    expect(model.summaryStatus).toBe('unavailable');
    expect(model.arcStatus).toBe('unavailable');
  });

  test('the two are tracked independently, so one source cannot speak for the other', () => {
    // The defect a single combined status produced: with a `null` summary beside a populated arc
    // list the panel read `ready`, suppressed the "summary unavailable" notice, and then stated
    // 「there is no major event」 as a confirmed fact about a source that never loaded.
    const summaryMissing = compose({ summary: null });
    expect(summaryMissing.summaryStatus).toBe('unavailable');
    expect(summaryMissing.arcStatus).toBe('ready');
    expect(summaryMissing.primaryArc?.arcId).toBe('arc-truce');

    const arcsPending = compose({ activeArcs: undefined });
    expect(arcsPending.arcStatus).toBe('loading');
    expect(arcsPending.summaryStatus).toBe('ready');
    // AC#2's way out survives an arc read that has not landed.
    expect(arcsPending.recommendedEntry).not.toBeNull();
  });

  test('an EMPTY arc list is `ready`: "no arc is running" is a fact about the world', () => {
    const model = compose({ activeArcs: [] });
    expect(model.arcStatus).toBe('ready');
    expect(model.primaryArc).toBeNull();
  });

  test('the map half survives both reads failing to produce anything (AC#4)', () => {
    // The day, the slot and the scenes come from the projection the canvas is drawing, so they
    // are unaffected by either published model being absent.
    const model = compose({ summary: null, activeArcs: null });
    expect(model.worldDayLabel).toBe('第 7 天');
    expect(model.timeSlotLabel).toBe('evening');
    expect(model.activeSceneSummary.count).toBe(1);
  });

  test('a projection with no day or slot yet renders a dash rather than "undefined"', () => {
    const model = compose({ worldDay: undefined, timeSlot: undefined });
    expect(model.worldDayLabel).toBe('—');
    expect(model.timeSlotLabel).toBe('—');
  });
});

describe('a malformed published payload degrades, and never blanks the map', () => {
  // Both payloads reach this module through an `as` cast on an untyped published model, so a
  // shape TypeScript was promised but the database does not hold is a real runtime case. It
  // matters more here than on a public page: this render sits inside `LiveMapErrorBoundary`,
  // which wraps the WHOLE live map — a throw composing the overlay would blank the canvas too.
  const malformed = <T,>(value: unknown) => value as T;

  test('a summary with no `structured` object costs the summary fields and nothing else', () => {
    const model = compose({
      summary: malformed<Parameters<typeof composeStoryOverlayViewModel>[0]['summary']>({
        summaryText: '只有一句話。',
      }),
    });
    expect(model.currentSituationText).toBe('只有一句話。');
    expect(model.latestMajorEvent).toBeNull();
    expect(model.recommendedEntry).toBeNull();
    // The map half is untouched.
    expect(model.worldDayLabel).toBe('第 7 天');
    expect(model.primaryArc?.arcId).toBe('arc-truce');
  });

  test('an entirely foreign summary payload composes rather than throwing', () => {
    const model = compose({
      summary: malformed<Parameters<typeof composeStoryOverlayViewModel>[0]['summary']>(
        { unexpected: true },
      ),
    });
    expect(model.summaryStatus).toBe('ready');
    expect(model.currentSituationText).toBeNull();
    expect(model.latestMajorEvent).toBeNull();
  });

  test('a non-array `activeArcs` yields no arc rather than a thrown iteration', () => {
    const model = compose({
      activeArcs: malformed<Parameters<typeof composeStoryOverlayViewModel>[0]['activeArcs']>(
        { arcId: 'not-an-array' },
      ),
    });
    expect(model.primaryArc).toBeNull();
    expect(model.currentSituationText).not.toBeNull();
  });
});

describe('overlay content tracks map state (FR-O007 AC#4)', () => {
  test('a new projection changes the overlay, with no cache of its own in between', () => {
    // The overlay holds no state: it is a pure function of the payloads the page hands it, so
    // "stays in sync within a reasonable interval" reduces to "the page re-renders", which the
    // Convex subscription does on every rebuild.
    const before = compose({ worldDay: 7, timeSlot: 'evening', scenes: [{ title: '簽約', status: 'active' }] });
    const after = compose({
      worldDay: 8,
      timeSlot: 'morning',
      scenes: [{ title: '清晨的爭執', status: 'active' }],
      activeArcs: [arc({ arcId: 'arc-flood', title: '洪水', status: 'climax' })],
      summary: summary({ majorEvent: { eventId: 'e-9', publicSummary: '水車被洪水沖垮。' } }),
    });
    expect(after.worldDayLabel).toBe('第 8 天');
    expect(after.timeSlotLabel).toBe('morning');
    expect(after.activeSceneSummary.brief).toBe('清晨的爭執');
    expect(after.primaryArc?.arcId).toBe('arc-flood');
    expect(after.latestMajorEvent).toBe('水車被洪水沖垮。');
    expect(after).not.toEqual(before);
  });

  test('composing twice from one payload is identical, so a re-render cannot drift', () => {
    expect(compose()).toEqual(compose());
  });
});
