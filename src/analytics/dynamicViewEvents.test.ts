/**
 * The analytics event contract and its privacy guarantee (FR-Q007 / ART-140).
 *
 * AC#2 is the reason this suite exists and is where most of it goes. The events are emitted
 * from components whose props carry a character projection, a story overlay view model and a
 * replay frame — private-adjacent data is one property access away at every call site — so
 * "no forbidden field appears in any payload" has to be a property of the pipeline rather than
 * a claim about the care taken at each site.
 *
 * The adversarial tests below hand the sanitiser whole objects of exactly the kind that are in
 * scope where the events fire, including a character seed with every private field the Canon
 * model defines, and require the output to be clean.
 */

import { MISTWOOD_CHARACTER_VISUALS } from '../../data/mistwoodCharacters';
import {
  ALLOWED_PAYLOAD_KEYS,
  DYNAMIC_VIEW_EVENTS,
  MAX_PAYLOAD_VALUE_LENGTH,
  isDynamicViewEvent,
  sanitizeAnalyticsPayload,
  summariseDynamicViewEvents,
  type DynamicViewEvent,
} from './dynamicViewEvents';

describe('the seventeen events (AC#1)', () => {
  test('PRD 2.0 §17 names seventeen live events, and seventeen are declared', () => {
    expect(DYNAMIC_VIEW_EVENTS).toHaveLength(17);
    expect(new Set(DYNAMIC_VIEW_EVENTS).size).toBe(17);
  });

  test('every name is namespaced, so an event from this surface is identifiable at a sink', () => {
    for (const name of DYNAMIC_VIEW_EVENTS) expect(name).toMatch(/^live_[a-z_]+$/);
  });

  test('an unknown name is refused rather than passed through', () => {
    expect(isDynamicViewEvent('live_view_opened')).toBe(true);
    expect(isDynamicViewEvent('live_view_open')).toBe(false);
    expect(isDynamicViewEvent('')).toBe(false);
    // A sink that received arbitrary names would let a future call site invent a schema nobody
    // reviewed, which is exactly how an analytics contract stops meaning anything.
    expect(isDynamicViewEvent('__proto__')).toBe(false);
  });
});

describe('no payload can carry private data (AC#2)', () => {
  /**
   * The private fields the Canon character model defines, named here so this suite fails if
   * one of them ever reaches a payload. The same list `publicDynamicProjection` forbids.
   */
  const FORBIDDEN = [
    'privateProfile', 'privateGoal', 'fear', 'secretContents', 'knowledge', 'memory',
    'prompt', 'rawModelOutput', 'adminNotes', 'dialogue', 'summaryText', 'publicSummary',
  ];

  test('an object carrying every private field yields a payload with none of them', () => {
    const hostile = {
      worldId: 'mistwood',
      characterId: 'he-jun',
      ...Object.fromEntries(FORBIDDEN.map((field) => [field, `secret ${field}`])),
    };
    const clean = sanitizeAnalyticsPayload(hostile);
    for (const field of FORBIDDEN) {
      expect(Object.prototype.hasOwnProperty.call(clean, field)).toBe(false);
    }
    // ...and it did produce something, so this is not passing on an empty object.
    expect(clean).toEqual({ worldId: 'mistwood', characterId: 'he-jun' });
  });

  test('the allowlist is the mechanism: an unlisted key is dropped whatever it is called', () => {
    // The point of an allowlist over a denylist. A field nobody has thought of yet — because it
    // does not exist yet — is dropped rather than published.
    const clean = sanitizeAnalyticsPayload({
      worldId: 'mistwood',
      somethingInventedNextYear: 'whatever this turns out to be',
    });
    expect(Object.keys(clean)).toEqual(['worldId']);
  });

  test('no viewer identifier of any kind is allowlisted', () => {
    // AC#3: personal tracking must not widen. The strongest form of that is that there is no
    // key a viewer identifier could legally travel in.
    for (const forbidden of ['viewerId', 'sessionId', 'userId', 'ip', 'userAgent', 'email']) {
      expect(ALLOWED_PAYLOAD_KEYS as readonly string[]).not.toContain(forbidden);
    }
    expect(sanitizeAnalyticsPayload({ viewerId: 'v-1', sessionId: 's-1' })).toEqual({});
  });

  test('a nested object is refused rather than walked', () => {
    // This is how a whole view model gets attached to an event by accident. Walking it would
    // mean deciding what is private INSIDE it at every level, which is the judgement this
    // design exists to avoid making.
    const clean = sanitizeAnalyticsPayload({
      worldId: 'mistwood',
      characterId: { id: 'he-jun', privateGoal: 'repair the wheel before anyone notices' },
    });
    expect(clean).toEqual({ worldId: 'mistwood' });
  });

  test('an array is refused for the same reason', () => {
    expect(sanitizeAnalyticsPayload({ worldId: 'mistwood', arcId: ['a', 'b'] })).toEqual({
      worldId: 'mistwood',
    });
    expect(sanitizeAnalyticsPayload(['worldId', 'mistwood'])).toEqual({});
  });

  test('a long string is DROPPED, not truncated', () => {
    // Every allowed key holds an identifier or an enum member. A value past the limit is, by
    // elimination, prose — and truncating would still publish most of it.
    const sentence = 'x'.repeat(MAX_PAYLOAD_VALUE_LENGTH + 1);
    expect(sanitizeAnalyticsPayload({ worldId: 'mistwood', sceneId: sentence })).toEqual({
      worldId: 'mistwood',
    });
    const atLimit = 'x'.repeat(MAX_PAYLOAD_VALUE_LENGTH);
    expect(sanitizeAnalyticsPayload({ sceneId: atLimit }).sceneId).toBe(atLimit);
  });

  test('real production identifiers all fit, so the limit costs nothing real', () => {
    // A limit that dropped legitimate ids would be a silent data loss rather than a guard.
    for (const visual of MISTWOOD_CHARACTER_VISUALS) {
      expect(visual.characterId.length).toBeLessThanOrEqual(MAX_PAYLOAD_VALUE_LENGTH);
      expect(sanitizeAnalyticsPayload({ characterId: visual.characterId }).characterId)
        .toBe(visual.characterId);
    }
    // The longest shape a scene id takes: `<day>:<slot>:<locationId>`.
    const sceneId = '7:evening:mistwood-mill';
    expect(sanitizeAnalyticsPayload({ sceneId }).sceneId).toBe(sceneId);
  });

  test('non-finite numbers and empty strings are dropped rather than emitted as nulls', () => {
    // `NaN` and `Infinity` serialise as `null`, which at a sink reads as a field that was
    // present and empty rather than one that was never measured.
    expect(sanitizeAnalyticsPayload({ zoomStep: Number.NaN })).toEqual({});
    expect(sanitizeAnalyticsPayload({ zoomStep: Number.POSITIVE_INFINITY })).toEqual({});
    expect(sanitizeAnalyticsPayload({ worldId: '' })).toEqual({});
    // Zero and false are real values and survive.
    expect(sanitizeAnalyticsPayload({ zoomStep: 0 })).toEqual({ zoomStep: 0 });
  });

  test('a non-object input yields an empty payload rather than throwing mid-render', () => {
    for (const input of [null, undefined, 'string', 42, true]) {
      expect(sanitizeAnalyticsPayload(input)).toEqual({});
    }
  });
});

describe('§18.1 becomes measurable from the stream (AC#4)', () => {
  const event = (name: string, payload = {}): DynamicViewEvent =>
    ({ name, payload } as DynamicViewEvent);

  test('click-through is interactions over live views opened', () => {
    const summary = summariseDynamicViewEvents([
      event('live_view_opened'),
      event('live_view_opened'),
      event('live_view_opened'),
      event('live_view_opened'),
      event('live_character_selected'),
      event('live_episode_opened'),
    ]);
    expect(summary.liveViewsOpened).toBe(4);
    expect(summary.interactions).toBe(2);
    expect(summary.clickThroughRate).toBe(0.5);
  });

  test('all four interaction kinds count toward it', () => {
    const summary = summariseDynamicViewEvents([
      event('live_view_opened'),
      event('live_character_selected'),
      event('live_scene_selected'),
      event('live_arc_opened'),
      event('live_episode_opened'),
    ]);
    expect(summary.interactions).toBe(4);
  });

  test('camera use is not an interaction, because it opens nothing', () => {
    const summary = summariseDynamicViewEvents([
      event('live_view_opened'),
      event('live_zoom_used'),
      event('live_camera_follow_enabled'),
      event('live_return_to_town'),
    ]);
    expect(summary.interactions).toBe(0);
    expect(summary.clickThroughRate).toBe(0);
  });

  test('a zero denominator is null, not zero', () => {
    // "Nobody clicked" and "nobody arrived" are different findings, and reporting the second as
    // the first is how a launch gets diagnosed as a UX problem.
    const summary = summariseDynamicViewEvents([]);
    expect(summary.clickThroughRate).toBeNull();
    expect(summary.replayCompletionRate).toBeNull();
  });

  test('replay completion counts completions over starts, with skips kept separate', () => {
    const summary = summariseDynamicViewEvents([
      event('live_replay_started'), event('live_replay_completed'),
      event('live_replay_started'), event('live_replay_skipped'),
      event('live_replay_started'), event('live_replay_completed'),
      event('live_replay_started'), event('live_replay_skipped'),
    ]);
    expect(summary.replaysStarted).toBe(4);
    expect(summary.replaysCompleted).toBe(2);
    expect(summary.replaysSkipped).toBe(2);
    expect(summary.replayCompletionRate).toBe(0.5);
    // A skip is a viewer decision, not a failure. Folding it into the completion rate would
    // answer neither question.
    expect(summary.replaysSkipped + summary.replaysCompleted).toBe(summary.replaysStarted);
  });

  test('a manual replay counts as a start, because it is one', () => {
    const summary = summariseDynamicViewEvents([
      event('live_replay_manual_triggered'),
      event('live_replay_started'),
      event('live_replay_completed'),
    ]);
    expect(summary.replaysStarted).toBe(1);
    expect(summary.replayCompletionRate).toBe(1);
  });
});
