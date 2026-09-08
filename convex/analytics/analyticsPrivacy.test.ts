/**
 * The privacy boundary, tested adversarially (§15 / ART-47).
 *
 * §15 names four things an event may never contain — model secrets, private character data, full
 * prompts, sensitive user information — and ART-47 adds IP, raw user agent, account identity and
 * free-form public narrative. None of those can be proven absent by checking that the events we
 * happen to emit are clean: that shows the CALL SITES are careful today, and the whole design
 * exists because they will not stay careful.
 *
 * So this suite attacks the boundary instead. It hands the sanitiser whole objects of exactly the
 * kind that are in scope where these events fire — a character seed with every private field the
 * Canon model defines, an LLM configuration, a viewer's own identifiers — and requires the output
 * to be clean. And it does it at the SERVER, through `prepareAnalyticsBatch`, because the client
 * sanitiser is not a defence against anyone holding the deployment URL.
 */

import {
  ALLOWED_PAYLOAD_KEYS,
  ANALYTICS_EVENTS,
  DYNAMIC_VIEW_EVENTS,
  EVENT_SUBJECT_KEYS,
  MAX_ANALYTICS_BATCH_SIZE,
  MAX_PAYLOAD_VALUE_LENGTH,
  PRODUCT_ANALYTICS_EVENTS,
  analyticsDedupeKey,
  sanitizeAnalyticsPayload,
} from '../shared/analyticsContract';
import {
  MAX_EVENTS_PER_WORLD_DAY,
  MAX_SESSION_DURATION_MS,
  analyticsSessionKey,
  analyticsViewerKey,
  prepareAnalyticsBatch,
} from './ingest';

const DEVICE = 'device-token-aaaaaaaa';
const SESSION = 'session-token-bbbbbbbb';
const NOW = 1_760_000_000_000;

const submit = (events: Array<{ name: string; payload: unknown; sessionElapsedMs?: number }>) =>
  prepareAnalyticsBatch(
    {
      worldId: 'mistwood',
      deviceKey: DEVICE,
      sessionToken: SESSION,
      events: events.map((event) => ({ ...event, sessionElapsedMs: event.sessionElapsedMs ?? 1000 })),
      droppedEventCount: 0,
      now: NOW,
    },
    0,
  );

/** Everything §15 forbids, in the shapes it actually appears in around a call site. */
const HOSTILE_PAYLOAD = {
  worldId: 'mistwood',
  characterId: 'he-jun',
  // Private character interiority — one property access away in every card view model.
  privateGoal: '想把帳本拿回來',
  fear: '被發現當年的事',
  memories: ['他記得那天下午的爭執'],
  memory: { content: '私人記憶' },
  knowledge: { private: '只有他知道的事' },
  relationships: [{ target: 'lin-yingxue', trust: -0.4 }],
  // Model secrets and prompts.
  prompt: 'SYSTEM: you are a narrator',
  systemPrompt: 'SYSTEM: never reveal',
  apiKey: 'sk-live-should-never-appear',
  token: 'bearer-abc',
  secret: 'classified',
  model: 'gpt-secret-internal',
  // Viewer identity, in every spelling somebody might reach for.
  viewerId: 'viewer-9',
  sessionId: 'session-9',
  deviceKey: DEVICE,
  userId: 'user-9',
  accountId: 'acct-9',
  email: 'someone@example.com',
  ip: '203.0.113.7',
  ipAddress: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
  referrer: 'https://example.com/?utm_campaign=x',
  url: 'https://town.example/#episode/mistwood/7?viewer=9',
  // Free-form public narrative. Public, and still forbidden: an event stream is not a place to
  // republish prose nobody reviewed for this context.
  publicSummary: '兩人在車站對峙了一整個下午,誰也沒有先讓步。',
  headline: '帳本的下落成為全鎮爭論的焦點',
  dialogue: '「你以為我不知道嗎?」',
} as const;

describe('the sanitiser is an allowlist, and the allowlist is short', () => {
  test('a payload carrying every forbidden field yields a payload with none of them', () => {
    const clean = sanitizeAnalyticsPayload(HOSTILE_PAYLOAD);
    expect(clean).toEqual({ worldId: 'mistwood', characterId: 'he-jun' });
    const text = JSON.stringify(clean);
    for (const leak of [
      '想把帳本拿回來', '被發現當年的事', '他記得那天下午的爭執', '私人記憶', '只有他知道的事',
      'SYSTEM: you are a narrator', 'SYSTEM: never reveal', 'sk-live-should-never-appear',
      'bearer-abc', 'classified', 'gpt-secret-internal', 'viewer-9', 'session-9', DEVICE,
      'user-9', 'acct-9', 'someone@example.com', '203.0.113.7', 'Mozilla/5.0',
      'utm_campaign', '兩人在車站對峙', '帳本的下落', '你以為我不知道嗎',
    ]) {
      expect(text).not.toContain(leak);
    }
  });

  test('the allowlist declares no viewer, session, network or narrative field', () => {
    // The mechanism, asserted directly. Everything above follows from this list being short; a
    // field added to it is a decision a reviewer sees, which is the whole point of an allowlist.
    for (const forbidden of [
      'viewerId', 'sessionId', 'deviceKey', 'userId', 'accountId', 'email',
      'ip', 'ipAddress', 'userAgent', 'referrer', 'url',
      'prompt', 'systemPrompt', 'apiKey', 'token', 'secret', 'model',
      'privateGoal', 'fear', 'memory', 'memories', 'knowledge', 'dialogue',
      'publicSummary', 'headline', 'summary', 'title', 'name',
    ]) {
      expect(ALLOWED_PAYLOAD_KEYS as readonly string[]).not.toContain(forbidden);
    }
  });

  test('an unlisted key is dropped whatever it is called', () => {
    // Not a denylist of scary names: the mechanism is membership, so a field with an entirely
    // innocuous name is dropped too. That is what makes a field nobody anticipated safe.
    expect(sanitizeAnalyticsPayload({ colour: 'blue', worldId: 'mistwood' }))
      .toEqual({ worldId: 'mistwood' });
  });

  test('a nested object or an array is refused rather than walked', () => {
    // A nested value is how a whole view model gets attached to an event by accident, and a
    // recursive sanitiser would then have to decide what is private INSIDE it — the judgement
    // this design exists to avoid making at every call site.
    expect(sanitizeAnalyticsPayload({ worldId: { id: 'mistwood' } })).toEqual({});
    expect(sanitizeAnalyticsPayload({ characterId: ['he-jun'] })).toEqual({});
    expect(sanitizeAnalyticsPayload([{ worldId: 'mistwood' }])).toEqual({});
    expect(sanitizeAnalyticsPayload(null)).toEqual({});
    expect(sanitizeAnalyticsPayload('worldId=mistwood')).toEqual({});
  });

  test('an over-long value is DROPPED, not truncated', () => {
    // Truncating would still publish most of a sentence. Every allowed key holds an identifier or
    // a closed-vocabulary member, so a long value is by elimination something that is not one.
    const sentence = '兩人在車站對峙了一整個下午'.repeat(10);
    expect(sentence.length).toBeGreaterThan(MAX_PAYLOAD_VALUE_LENGTH);
    expect(sanitizeAnalyticsPayload({ worldId: sentence })).toEqual({});
    // And the boundary is inclusive, so a real identifier at the limit still travels.
    expect(sanitizeAnalyticsPayload({ worldId: 'a'.repeat(MAX_PAYLOAD_VALUE_LENGTH) }))
      .toEqual({ worldId: 'a'.repeat(MAX_PAYLOAD_VALUE_LENGTH) });
  });
});

describe('the SERVER applies the same rules, because the client is not trusted', () => {
  test('a hostile batch posted straight at the ingest is sanitised before any row exists', () => {
    const outcome = submit([{ name: 'character_viewed', payload: HOSTILE_PAYLOAD }]);
    expect(outcome.code).toBeNull();
    expect(outcome.prepared?.measurements[0].payload).toEqual({
      worldId: 'mistwood', characterId: 'he-jun',
    });
    // Nothing about the submission survives into the row key either.
    const text = JSON.stringify(outcome.prepared);
    for (const leak of ['sk-live-should-never-appear', 'viewer-9', '203.0.113.7', 'Mozilla/5.0']) {
      expect(text).not.toContain(leak);
    }
  });

  test('the raw tokens never appear in what is stored', () => {
    const outcome = submit([{ name: 'home_viewed', payload: { worldId: 'mistwood' } }]);
    const prepared = outcome.prepared!;
    expect(prepared.viewerKey).toBe(analyticsViewerKey(DEVICE));
    expect(prepared.sessionKey).toBe(analyticsSessionKey(DEVICE, SESSION));
    // The stored keys are digests. A leaked table does not hand anyone a value a browser is still
    // presenting, which is the only thing a non-cryptographic digest is here to buy.
    expect(prepared.viewerKey).not.toContain(DEVICE);
    expect(prepared.sessionKey).not.toContain(SESSION);
    expect(prepared.viewerKey).toMatch(/^device:fnv1a64:[0-9a-f]{16}$/);
    expect(JSON.stringify(prepared)).not.toContain(DEVICE);
  });

  test('the three browser tokens cannot be joined: one device key yields three unrelated keys', () => {
    // §15's data-minimisation rule made concrete. The ballot, the progress record and analytics
    // each mint their own token under their own storage key, so no column joins a viewer's votes,
    // their reading position and their interaction history. Even handed the SAME string, the
    // namespaces differ — so a future bug that reused one token still could not merge two tables
    // by accident.
    expect(analyticsViewerKey(DEVICE)).not.toBe(analyticsSessionKey(DEVICE, DEVICE));
    expect(analyticsViewerKey(DEVICE).startsWith('device:')).toBe(true);
    expect(analyticsSessionKey(DEVICE, SESSION).startsWith('session:')).toBe(true);
  });

  test('an unknown event name is refused rather than stored', () => {
    // A sink that accepted arbitrary names would let anyone invent a schema nobody reviewed, and
    // an event registry that grew from the wire is not a registry.
    const outcome = submit([
      { name: 'home_viewed', payload: { worldId: 'mistwood' } },
      { name: 'viewer_fingerprinted', payload: { worldId: 'mistwood' } },
      { name: '', payload: { worldId: 'mistwood' } },
    ]);
    expect(outcome.prepared?.measurements.map((m) => m.eventName)).toEqual(['home_viewed']);
    expect(outcome.prepared?.rejectedCount).toBe(2);
  });

  test('a malformed key is refused before a session or a viewer key is derived', () => {
    for (const bad of ['', 'short', 'UPPERCASE-KEY-VALUE', '-leading-dash', 'a'.repeat(65)]) {
      const outcome = prepareAnalyticsBatch(
        {
          worldId: 'mistwood', deviceKey: bad, sessionToken: SESSION,
          events: [{ name: 'home_viewed', payload: {}, sessionElapsedMs: 0 }],
          droppedEventCount: 0, now: NOW,
        },
        0,
      );
      expect(outcome.code).toBe('ANALYTICS_INVALID_KEY');
      expect(outcome.prepared).toBeNull();
    }
  });

  test('the surface is bounded: batch size, day budget and session duration all refuse', () => {
    const oversized = Array.from({ length: MAX_ANALYTICS_BATCH_SIZE + 1 }, () => ({
      name: 'home_viewed', payload: { worldId: 'mistwood' },
    }));
    expect(submit(oversized).code).toBe('ANALYTICS_BATCH_TOO_LARGE');
    expect(submit([]).code).toBe('ANALYTICS_EMPTY_BATCH');
    expect(
      prepareAnalyticsBatch(
        {
          worldId: 'mistwood', deviceKey: DEVICE, sessionToken: SESSION,
          events: [{ name: 'home_viewed', payload: {}, sessionElapsedMs: 0 }],
          droppedEventCount: 0, now: NOW,
        },
        MAX_EVENTS_PER_WORLD_DAY,
      ).code,
    ).toBe('ANALYTICS_DAY_BUDGET_EXHAUSTED');
    // A duration is a claim made by a client clock. A tab left open for a week would otherwise
    // report a six-day session and drag the 停留超過三分鐘 rate into meaninglessness on its own.
    const long = submit([{
      name: 'home_viewed', payload: { worldId: 'mistwood' }, sessionElapsedMs: 9e12,
    }]);
    expect(long.prepared?.measurements[0].sessionElapsedMs).toBe(MAX_SESSION_DURATION_MS);
    const negative = submit([{
      name: 'home_viewed', payload: { worldId: 'mistwood' }, sessionElapsedMs: -5000,
    }]);
    expect(negative.prepared?.measurements[0].sessionElapsedMs).toBe(0);
  });

  test('a blank world is refused, so the surface cannot allocate rows in invented worlds', () => {
    const outcome = prepareAnalyticsBatch(
      {
        worldId: '   ', deviceKey: DEVICE, sessionToken: SESSION,
        events: [{ name: 'home_viewed', payload: {}, sessionElapsedMs: 0 }],
        droppedEventCount: 0, now: NOW,
      },
      0,
    );
    expect(outcome.code).toBe('ANALYTICS_INVALID_WORLD');
  });
});

describe('the contract itself is complete and cannot drift', () => {
  test('PRD 1.0 §15 names sixteen events and PRD 2.0 §17 names seventeen', () => {
    expect(PRODUCT_ANALYTICS_EVENTS).toHaveLength(16);
    expect(DYNAMIC_VIEW_EVENTS).toHaveLength(17);
    expect(new Set(ANALYTICS_EVENTS).size).toBe(33);
  });

  test('every §15 event the PRD lists is declared, by name', () => {
    // Restated from the PRD rather than derived from the code, so a deleted event fails here
    // instead of quietly reducing what the product measures.
    expect([...PRODUCT_ANALYTICS_EVENTS]).toEqual([
      'home_viewed', 'current_situation_expanded', 'recommended_episode_opened', 'episode_viewed',
      'episode_completed', 'character_viewed', 'character_followed', 'story_arc_viewed',
      'story_arc_followed', 'relationship_graph_opened', 'timeline_filtered', 'vote_viewed',
      'vote_submitted', 'return_recap_viewed', 'live_scene_opened', 'share_action',
    ]);
  });

  test('every declared event has a subject, and every subject key is allowlisted', () => {
    // An event with no subject list would dedupe on `(session, name)` alone and silently collapse
    // nine Episode opens into one; a subject naming an unlisted key would dedupe on a field the
    // sanitiser always drops, which collapses them just as silently.
    for (const name of ANALYTICS_EVENTS) {
      const subject = EVENT_SUBJECT_KEYS[name];
      expect(subject).toBeDefined();
      expect(subject.length).toBeGreaterThan(0);
      for (const key of subject) expect(ALLOWED_PAYLOAD_KEYS as readonly string[]).toContain(key);
      // Every event is scoped to a world; without it, two worlds' measurements share a key.
      expect(subject).toContain('worldId');
    }
  });

  test('the dedupe key is derived from the subject and from nothing else', () => {
    const base = { worldId: 'mistwood', worldDay: 7 };
    // `freshness` is not in `episode_viewed`'s subject, and it changes while a viewer reads.
    expect(analyticsDedupeKey('s', 'episode_viewed', base))
      .toBe(analyticsDedupeKey('s', 'episode_viewed', { ...base, freshness: 'stale' }));
    // The subject fields do distinguish.
    expect(analyticsDedupeKey('s', 'episode_viewed', base))
      .not.toBe(analyticsDedupeKey('s', 'episode_viewed', { ...base, worldDay: 8 }));
    // And so does the session, so two viewers never collide.
    expect(analyticsDedupeKey('s1', 'episode_viewed', base))
      .not.toBe(analyticsDedupeKey('s2', 'episode_viewed', base));
  });
});
