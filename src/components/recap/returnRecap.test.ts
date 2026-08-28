/**
 * The return-recap render model (FR-H004 / ART-39).
 *
 * Every acceptance criterion FR-H004 states about OUTPUT is settled here, because the output is
 * where each of them is a property: AC#1 bounds it, AC#2 orders it, AC#3 is what it does with a
 * device progress row and without one.
 */

import {
  composeReturnRecapViewModel,
  composeVoteRecapLine,
  MAX_RECAP_HIGHLIGHTS,
  parseRecapRoute,
  RECAP_LINE_MAX_CHARACTERS,
  FOLLOW_SETTINGS_NOTE,
  LOADING_STATUS,
  MAX_RECAP_ARC_PROGRESS,
  NO_PROGRESS_NOTE,
  NO_STORAGE_NOTE,
  VOTE_NO_CAUSAL_EDGE_NOTE,
  voteNoTriggerNote,
  VOTE_UNAVAILABLE_NOTE,
  WATCHED_ONLY_NOTE,
  type RecapEpisodeIndex,
  type RecapProgress,
  type RecapTimeline,
  type RecapVoteConsequence,
} from './returnRecap';
import { viewerProgressEpisodeId } from '../../../convex/viewer/viewerProgress';
import { countChineseCharacters } from '../../../convex/shared/publicText';

const WORLD_ID = 'mistwood';
const ARC_MILL = 'arc-mill';
const ARC_TRUCE = 'arc-truce';
const CHAR_ANNA = 'char-anna';
const CHAR_BEN = 'char-ben';

/** `days` published episodes, one per day, alternating arcs and characters. */
function episodeIndex(days: number): RecapEpisodeIndex {
  return {
    episodes: Array.from({ length: days }, (_, index) => ({
      worldDay: index + 1,
      episodeNumber: index + 1,
      title: `第 ${index + 1} 集`,
      headline: '磨坊之爭持續。',
      arcIds: [index % 2 === 0 ? ARC_MILL : ARC_TRUCE],
      characterIds: [index % 2 === 0 ? CHAR_ANNA : CHAR_BEN],
      isRecommendedEntry: index === 1,
      isTurningPoint: false,
    })),
    arcIds: [ARC_MILL, ARC_TRUCE],
    characterIds: [CHAR_ANNA, CHAR_BEN],
  };
}

/** One major event per day, so a long absence has a long candidate list. */
function timeline(days: number): RecapTimeline {
  return {
    entries: Array.from({ length: days }, (_, index) => ({
      eventId: `mistwood#event#${100 + index}`,
      worldDay: index + 1,
      timeSlot: 'evening',
      eventType: 'world_event',
      publicSummary: `第 ${index + 1} 天發生了一件事。`,
      arcIds: [index % 2 === 0 ? ARC_MILL : ARC_TRUCE],
      characterIds: [index % 2 === 0 ? CHAR_ANNA : CHAR_BEN],
      episodeNumber: index + 1,
    })),
  };
}

const progress = (overrides: Partial<RecapProgress> = {}): RecapProgress => ({
  lastViewedEpisodeId: viewerProgressEpisodeId(WORLD_ID, 2),
  followedCharacterIds: [],
  followedArcIds: [],
  spoilerMode: 'publicOnly',
  updatedAt: 1_000,
  ...overrides,
});

const compose = (input: Partial<Parameters<typeof composeReturnRecapViewModel>[0]> = {}) =>
  composeReturnRecapViewModel({
    worldId: WORLD_ID,
    progress: progress(),
    episodes: episodeIndex(10),
    timeline: timeline(10),
    voteConsequence: null,
    ...input,
  });

describe('the route is its own, and it is not the homepage', () => {
  test('`#recap/<worldId>` resolves', () => {
    expect(parseRecapRoute('#recap/mistwood')).toEqual({ worldId: 'mistwood' });
    expect(parseRecapRoute('recap/mistwood')).toEqual({ worldId: 'mistwood' });
    expect(parseRecapRoute('#recap/a%20b')).toEqual({ worldId: 'a b' });
  });

  test('anything else does not', () => {
    for (const hash of ['', '#recap', '#recap/', '#recap/a/b', '#home/mistwood', '#recapx/m']) {
      expect(parseRecapRoute(hash)).toBeNull();
    }
  });
});

describe('AC#1 — 不逐日完整列出所有事件', () => {
  test('a thirty-day absence produces the same size recap as a two-day one', () => {
    const short = compose({
      progress: progress({ lastViewedEpisodeId: viewerProgressEpisodeId(WORLD_ID, 28) }),
      episodes: episodeIndex(30),
      timeline: timeline(30),
    });
    const long = compose({
      progress: progress({ lastViewedEpisodeId: viewerProgressEpisodeId(WORLD_ID, 1) }),
      episodes: episodeIndex(30),
      timeline: timeline(30),
    });
    expect(long.highlights.length).toBeLessThanOrEqual(MAX_RECAP_HIGHLIGHTS);
    expect(long.highlights.length).toBe(MAX_RECAP_HIGHLIGHTS);
    expect(short.highlights.length).toBeLessThanOrEqual(MAX_RECAP_HIGHLIGHTS);
    // The recap does not grow with the absence. That is the whole of AC#1.
    expect(long.highlights.length).toBeGreaterThanOrEqual(short.highlights.length);
  });

  test('the gap is reported as counts, and the omission is stated rather than hidden', () => {
    const vm = compose({
      progress: progress({ lastViewedEpisodeId: viewerProgressEpisodeId(WORLD_ID, 1) }),
      episodes: episodeIndex(30),
      timeline: timeline(30),
    });
    expect(vm.missedEpisodeCount).toBe(29);
    expect(vm.awayNote).toContain('29');
    // 29 candidate events, 5 shown: the other 24 are named as a number and pointed at the
    // timeline, not silently dropped.
    expect(vm.omittedHighlightCount).toBe(24);
  });

  test('each line is capped by 中文字 count, not by code units', () => {
    const long = '一'.repeat(RECAP_LINE_MAX_CHARACTERS + 40);
    const vm = compose({
      progress: progress({ lastViewedEpisodeId: viewerProgressEpisodeId(WORLD_ID, 1) }),
      timeline: {
        entries: [{
          eventId: 'e1', worldDay: 5, timeSlot: 'noon', publicSummary: long,
          arcIds: [], characterIds: [], episodeNumber: 5,
        }],
      },
    });
    expect(countChineseCharacters(vm.highlights[0].summary)).toBeLessThanOrEqual(RECAP_LINE_MAX_CHARACTERS);
    expect(vm.highlights[0].summary.endsWith('…')).toBe(true);
  });

  test('a viewer who is up to date is told so, not shown an empty list with no explanation', () => {
    const vm = compose({
      progress: progress({ lastViewedEpisodeId: viewerProgressEpisodeId(WORLD_ID, 10) }),
    });
    expect(vm.missedEpisodeCount).toBe(0);
    expect(vm.awayNote).toBe('你已經看到目前最新的一集。');
    expect(vm.highlights).toEqual([]);
  });
});

describe('AC#2 — 優先顯示使用者追蹤內容', () => {
  test('followed content fills the budget before anything else is considered', () => {
    // Ten days of events, five slots. `arc-truce` is on the even days (4, 6, 8, 10 after the
    // recorded position); without prioritisation the earliest days would win outright.
    const vm = compose({
      progress: progress({
        lastViewedEpisodeId: viewerProgressEpisodeId(WORLD_ID, 2),
        followedArcIds: [ARC_TRUCE],
      }),
    });
    const followed = vm.highlights.filter((highlight) => highlight.followed);
    expect(followed.length).toBeGreaterThan(0);
    // Every followed highlight precedes every unfollowed one.
    const firstUnfollowed = vm.highlights.findIndex((highlight) => !highlight.followed);
    const lastFollowed = vm.highlights.map((h) => h.followed).lastIndexOf(true);
    expect(lastFollowed).toBeLessThan(firstUnfollowed === -1 ? Number.MAX_SAFE_INTEGER : firstUnfollowed);
    // Day 3 is chronologically first and is NOT followed, so a purely chronological recap would
    // have led with it.
    expect(vm.highlights[0].when).not.toContain('第 3 天');
  });

  test('a followed character orders content just as a followed arc does', () => {
    const vm = compose({
      progress: progress({
        lastViewedEpisodeId: viewerProgressEpisodeId(WORLD_ID, 2),
        followedCharacterIds: [CHAR_BEN],
      }),
    });
    expect(vm.highlights[0].followed).toBe(true);
  });

  test('following nothing still produces a recap, in the world own chronology', () => {
    const vm = compose();
    expect(vm.highlights.every((highlight) => !highlight.followed)).toBe(true);
    expect(vm.highlights[0].when).toContain('第 3 天');
  });

  test('followed arcs get their own bounded progress list', () => {
    const vm = compose({
      progress: progress({
        lastViewedEpisodeId: viewerProgressEpisodeId(WORLD_ID, 2),
        followedArcIds: [ARC_TRUCE, ARC_MILL],
      }),
    });
    expect(vm.followedArcProgress.map((arc) => arc.arcId).sort()).toEqual([ARC_MILL, ARC_TRUCE]);
    expect(vm.followedArcProgress.every((arc) => arc.episodeCount > 0)).toBe(true);
    // Ordered by how much happened, ties broken by arc id — so the list is deterministic and the
    // same world always renders the same order rather than whichever the set happened to yield.
    expect(vm.followedArcProgress.map((arc) => arc.href))
      .toEqual([`#arc/${WORLD_ID}/${ARC_MILL}`, `#arc/${WORLD_ID}/${ARC_TRUCE}`]);
  });

  test('the arc-progress list is capped, and keeps the arcs with the most movement', () => {
    // `MAX_RECAP_ARC_PROGRESS` was enforced by code that no test exercised: the fixture only ever
    // had two arcs, so the cap never bit. A viewer may follow up to `MAX_FOLLOWED_ARC_IDS` (6),
    // which is twice the cap, so the case is reachable in production.
    const arcIds = Array.from({ length: 6 }, (_, index) => `arc-${index}`);
    const vm = compose({
      progress: progress({
        lastViewedEpisodeId: viewerProgressEpisodeId(WORLD_ID, 0),
        followedArcIds: arcIds,
      }),
      episodes: {
        // `arc-0` appears in three episodes, `arc-1` in two, `arc-2` in one, the rest in none.
        episodes: [
          { worldDay: 1, episodeNumber: 1, title: 't1', headline: 'h', arcIds: ['arc-0'] },
          { worldDay: 2, episodeNumber: 2, title: 't2', headline: 'h', arcIds: ['arc-0', 'arc-1'] },
          { worldDay: 3, episodeNumber: 3, title: 't3', headline: 'h', arcIds: ['arc-0', 'arc-1', 'arc-2'] },
        ],
        arcIds,
        characterIds: [],
      },
      timeline: { entries: [] },
    });
    expect(vm.followedArcProgress).toHaveLength(MAX_RECAP_ARC_PROGRESS);
    // Ordered by movement, so the cap drops the quiet arcs rather than an arbitrary three.
    expect(vm.followedArcProgress.map((arc) => arc.arcId)).toEqual(['arc-0', 'arc-1', 'arc-2']);
    expect(vm.followedArcProgress.map((arc) => arc.episodeCount)).toEqual([3, 2, 1]);
  });
});

describe('AC#3 — 無登入使用者可使用裝置層級進度', () => {
  test('with no recorded progress the page says so and recommends an entry point', () => {
    const vm = compose({ progress: null });
    expect(vm.hasProgress).toBe(false);
    expect(vm.progressNote).toBe(NO_PROGRESS_NOTE);
    // No position means no gap to describe. Inventing one would be a claim about a viewer the
    // deployment has never seen.
    expect(vm.awayNote).toBeNull();
    // FR-H003: a newcomer is sent to the recommended entry, never to episode 1 by default.
    expect(vm.continueFrom).toEqual(expect.objectContaining({ worldDay: 2, isRecommendedEntry: true }));
  });

  test('with a recorded position the page names it and continues from the next episode', () => {
    const vm = compose();
    expect(vm.hasProgress).toBe(true);
    expect(vm.progressNote).toBe('你上次看到第 2 集(第 2 天)。');
    expect(vm.continueFrom).toEqual(expect.objectContaining({ worldDay: 3, episodeNumber: 3 }));
    expect(vm.markableEpisodeId).toBe(viewerProgressEpisodeId(WORLD_ID, 3));
  });

  test('a browser that refuses localStorage degrades instead of failing', () => {
    const vm = compose({ progress: null, storageAvailable: false });
    expect(vm.progressNote).toBe(NO_STORAGE_NOTE);
    // The recap still renders from the published models: an unusable storage costs the viewer
    // their remembered position, not the page.
    expect(vm.highlights.length).toBeGreaterThan(0);
  });

  test('a position recorded against another world is ignored, not trusted', () => {
    const vm = compose({
      progress: progress({ lastViewedEpisodeId: viewerProgressEpisodeId('other-world', 9) }),
    });
    expect(vm.missedEpisodeCount).toBe(10);
    expect(vm.awayNote).toBeNull();
  });

  test('a world with nothing published produces a page rather than a crash', () => {
    const vm = composeReturnRecapViewModel({
      worldId: WORLD_ID,
      progress: null,
      episodes: null,
      timeline: null,
      voteConsequence: null,
    });
    expect(vm.highlights).toEqual([]);
    expect(vm.continueFrom).toBeNull();
    expect(vm.followableCharacters).toEqual([]);
  });
});

describe('FR-H005 — the recap respects the recorded spoiler mode', () => {
  test('watchedOnly shows no highlights, and says why', () => {
    // Every candidate is by construction from an episode the viewer has not watched, so a
    // watchedOnly recap that listed them would be the mode failing at its only job.
    const vm = compose({ progress: progress({ spoilerMode: 'watchedOnly' }) });
    expect(vm.highlights).toEqual([]);
    expect(vm.spoilerNote).toBe(WATCHED_ONLY_NOTE);
    expect(vm.omittedHighlightCount).toBe(0);
    // The continuation point survives: it names an episode, it does not reveal its content.
    expect(vm.continueFrom).not.toBeNull();
  });

  test('an unrecognised stored mode falls back to the default rather than being obeyed', () => {
    const vm = compose({ progress: progress({ spoilerMode: 'cinematic' }) });
    expect(vm.spoilerMode).toBe('publicOnly');
    expect(vm.spoilerNote).toBeNull();
  });
});

describe('FR-J002 AC#2 — the recap never presents `uncertain` nodes as vote effects', () => {
  const trigger = {
    eventId: 'mistwood#event#100',
    worldDay: 7,
    timeSlot: 'evening',
    publicSummary: '全鎮停電。',
    publicationStatus: 'published',
  };

  test('today production shape: a trigger, no causal edge, and a note that says so', () => {
    // `explicitCausalEdgeCount` is 0 on ALL real data -- no provider emits `causedByEventIds` --
    // and the `uncertain` bucket is Director plan-context MEMBERSHIP, not causation.
    const payload = { targetWorldDay: 7, trigger, explicitCausalEdgeCount: 0 };
    const line = composeVoteRecapLine(payload);
    expect(line.trigger?.eventId).toBe(trigger.eventId);
    expect(line.note).toBe(VOTE_NO_CAUSAL_EDGE_NOTE);
    expect(line.note).not.toContain('影響');
  });

  test('an uncertain-only payload contributes nothing beyond the trigger', () => {
    // The builder does not read `uncertain` at all, so a payload carrying five of them renders
    // identically to one carrying none. A field the builder never touches cannot be promoted to
    // an effect by a later edit.
    const withUncertain = {
      targetWorldDay: 7,
      trigger,
      explicitCausalEdgeCount: 0,
      uncertain: Array.from({ length: 5 }, (_, index) => ({
        eventId: `mistwood#event#${200 + index}`,
        publicSummary: `一件在投票之後發生的事 ${index}`,
      })),
    } as unknown as RecapVoteConsequence;
    const vm = compose({ voteConsequence: withUncertain });
    expect(vm.voteNote).toBe(VOTE_NO_CAUSAL_EDGE_NOTE);
    expect(vm.voteTrigger?.eventId).toBe(trigger.eventId);
    // The decisive assertion: not one uncertain summary reaches the render model, anywhere.
    const serialized = JSON.stringify(vm);
    for (let index = 0; index < 5; index += 1) {
      expect(serialized).not.toContain(`一件在投票之後發生的事 ${index}`);
      expect(serialized).not.toContain(`mistwood#event#${200 + index}`);
    }
  });

  test('a day with no vote says exactly that, and names the day it looked at', () => {
    // The recap reads ONE `voteConsequence:<worldId>:<day>` model. The sentence used to say
    // 「你離開期間沒有由觀眾投票觸發的事件」-- a claim about the whole absence made from one day --
    // and disagreed with `VOTE_UNAVAILABLE_NOTE`, which had always correctly said 「這一天」.
    const line = composeVoteRecapLine({ targetWorldDay: 7, trigger: null, explicitCausalEdgeCount: 0 });
    expect(line).toEqual({ note: voteNoTriggerNote(7), trigger: null });
    expect(line.note).toContain('第 7 天');
    expect(line.note).not.toContain('離開期間');
  });

  test('an unpublished consequence model is reported as missing data, not as an absence of effects', () => {
    expect(composeVoteRecapLine(null)).toEqual({ note: VOTE_UNAVAILABLE_NOTE, trigger: null });
  });

  test('a read still in flight is a loading state, not an absence', () => {
    // This section names a model whose key contains a world day only the episode index can
    // supply, so on every load there is a window where the payload is legitimately missing.
    // Collapsing that into `payload === null` asserted 「尚未有這一天的投票後果資料。」-- a factual
    // claim about the world -- for a moment on every single load.
    expect(composeVoteRecapLine(null, true)).toEqual({ note: LOADING_STATUS, trigger: null });
    const vm = compose({ voteConsequence: null, voteLoading: true });
    expect(vm.voteNote).toBe(LOADING_STATUS);
    expect(vm.voteNote).not.toBe(VOTE_UNAVAILABLE_NOTE);
    // And the rest of the page is unaffected: the slowest read does not hold the body back.
    expect(vm.highlights.length).toBeGreaterThan(0);
  });

  test('a withheld trigger summary renders the refusal rather than the sentence', () => {
    const line = composeVoteRecapLine({
      targetWorldDay: 7,
      trigger: { ...trigger, publicationStatus: 'withheld' },
      explicitCausalEdgeCount: 0,
    });
    expect(line.trigger?.summary).toBe('(這段敘述目前不予公開)');
    expect(line.trigger?.summary).not.toContain('停電');
  });

  test('when Canon DOES record edges the recap defers rather than restating them', () => {
    // The recap is a bounded summary; the consequence panel is where a causal chain is shown
    // with its path. Reporting the count and pointing at that surface is what this page can
    // honestly say in one line.
    const line = composeVoteRecapLine({ targetWorldDay: 7, trigger, explicitCausalEdgeCount: 3 });
    expect(line.note).toContain('3');
    expect(line.note).not.toBe(VOTE_NO_CAUSAL_EDGE_NOTE);
  });
});

describe('the page claims nothing about the world while it is still loading', () => {
  test('a loading model asserts no absence, and the view renders none', () => {
    // `loading` was declared, computed and read by nobody, so first paint announced four factual
    // absences before any data existed: no episode to continue from, no major events, no vote
    // data, nothing to follow. Each is a claim, and each was false.
    const vm = compose({ progress: null, episodes: null, timeline: null, loading: true });
    expect(vm.loading).toBe(true);
    expect(vm.progressNote).toBe(LOADING_STATUS);
    expect(vm.voteNote).toBe(LOADING_STATUS);
    // The rendered half of this claim is settled in `publicPages.a11y.test.tsx`, which is the
    // only project that can compile JSX -- this one has no DOM and `jsx: preserve`.
  });

  test('once the reads settle, the same absences ARE stated', () => {
    // The other half: loading must suppress the claims, not delete them. A page that never says
    // 「沒有可以接續的集數」 leaves a viewer unable to tell empty from broken.
    const vm = compose({ progress: null, episodes: null, timeline: null, loading: false });
    expect(vm.loading).toBe(false);
    expect(vm.progressNote).not.toBe(LOADING_STATUS);
  });
});

describe('what a viewer is told about where their progress lives', () => {
  test('the follow-settings note does not claim the settings are device-local', () => {
    // The ONLY sentence a viewer reads about this. It said 「這些設定只存在這個裝置上」, which is
    // the opposite of what was built -- progress is a Convex row keyed by a digest of a token
    // this browser minted. The "deviceKey is a claim, not an identity" caveat is thorough
    // everywhere a REVIEWER meets it and was nowhere a VIEWER meets it, and the string a viewer
    // did meet overclaimed in the other direction.
    expect(FOLLOW_SETTINGS_NOTE).not.toContain('只存在這個裝置');
    expect(FOLLOW_SETTINGS_NOTE).toContain('不需要登入');
    expect(FOLLOW_SETTINGS_NOTE).toContain('伺服器');
    expect(FOLLOW_SETTINGS_NOTE).toContain('清除瀏覽器資料後就會失效');
  });
});

describe('the follow controls are built from published vocabulary only', () => {
  test('options come from the episode index, with the current selection marked', () => {
    const vm = compose({ progress: progress({ followedCharacterIds: [CHAR_ANNA] }) });
    expect(vm.followableCharacters).toEqual([
      { id: CHAR_ANNA, label: CHAR_ANNA, following: true, href: `#character/${WORLD_ID}/${CHAR_ANNA}` },
      { id: CHAR_BEN, label: CHAR_BEN, following: false, href: `#character/${WORLD_ID}/${CHAR_BEN}` },
    ]);
    expect(vm.followableArcs.map((arc) => arc.id)).toEqual([ARC_MILL, ARC_TRUCE]);
  });
});
