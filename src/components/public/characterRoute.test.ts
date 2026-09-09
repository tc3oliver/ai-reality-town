/**
 * Unit tests for the public character page (ART-43, FR-I005). The headline
 * cases are the AC#2/#3 privacy boundary: the view model never surfaces
 * forbidden keys even when the input payload carries them. Pure jest (no jsdom).
 */

import {
  CHARACTER_FORBIDDEN_KEYS,
  characterCurrentArcs,
  characterRelationships,
  composeCharacterViewModel,
  forbiddenKeysInViewModel,
  parseCharacterRoute,
  type CharacterProjection,
  type CharacterRecentEvent,
  type CharacterRelationshipGraphInput,
  type CharacterViewerKnowledgeInput,
} from './characterRoute';

function character(overrides: Partial<CharacterProjection> = {}): CharacterProjection {
  return {
    id: 'char-a', worldId: 'mistwood', name: '艾拉', age: 28, occupation: '藥師',
    publicProfile: '鎮上的草藥師。', personality: '謹慎', values: '守諾',
    publicGoal: '治癒妹妹', fear: '失去家人', currentLocationId: 'mistwood-market',
    healthState: '健康', emotionalState: '憂慮', financialState: '小康', alive: true, active: true,
    ...overrides,
  };
}

const recent: CharacterRecentEvent[] = [
  { eventId: 'e1', worldDay: 3, timeSlot: 'noon', publicSummary: '簽下休戰。', episodeNumber: 3 },
  { eventId: 'e2', worldDay: 5, timeSlot: 'night', publicSummary: null, episodeNumber: null },
];

describe('parseCharacterRoute', () => {
  it('resolves a #character/<worldId>/<characterId> route', () => {
    expect(parseCharacterRoute('#character/mistwood/char-a')).toEqual({ worldId: 'mistwood', characterId: 'char-a' });
  });
  it('returns null for a single-segment or unrelated route', () => {
    expect(parseCharacterRoute('#character/char-a')).toBeNull();
    expect(parseCharacterRoute('#home/mistwood')).toBeNull();
    expect(parseCharacterRoute('')).toBeNull();
  });
});

describe('composeCharacterViewModel', () => {
  it('composes the identity + state card from the projection (AC#1)', () => {
    const vm = composeCharacterViewModel({ worldId: 'mistwood', character: character(), recentEvents: recent });
    expect(vm.hasContent).toBe(true);
    expect(vm.name).toBe('艾拉');
    expect(vm.age).toBe('28');
    expect(vm.occupation).toBe('藥師');
    expect(vm.publicProfile).toBe('鎮上的草藥師。');
    expect(vm.publicGoal).toBe('治癒妹妹');
    expect(vm.healthState).toBe('健康');
    expect(vm.alive).toBe(true);
  });

  it('renders recent major events with episode links when available (AC#1)', () => {
    const vm = composeCharacterViewModel({ worldId: 'mistwood', character: character(), recentEvents: recent });
    expect(vm.recentEvents).toHaveLength(2);
    expect(vm.recentEvents[0].episodeHref).toBe('#episode/mistwood/3');
    expect(vm.recentEvents[1].episodeHref).toBeNull();
    expect(vm.recentEvents[1].label).toContain('(無摘要)');
  });

  it('degrades gracefully when the projection is null (AC#1 absent states)', () => {
    const vm = composeCharacterViewModel({ worldId: 'mistwood', character: null, recentEvents: null });
    expect(vm.hasContent).toBe(false);
    expect(vm.name).toBe('未知角色');
    expect(vm.age).toBe('—');
    expect(vm.recentEvents).toEqual([]);
  });

  it('NEVER surfaces forbidden keys, even when the payload carries them (AC#2/#3)', () => {
    // Simulate a malformed/unsanitized payload that smuggles forbidden fields.
    const smuggled = {
      ...character(),
      privateProfile: '不該外洩的私事',
      privateGoal: '秘密目標',
      knowledge: { secret: '...' },
      memory: ['私人記憶'],
      prompt: 'system prompt',
      rawModelOutput: 'raw',
      adminNotes: 'admin only',
      secret: 'value',
      token: 'abc',
    } as unknown as CharacterProjection;
    const vm = composeCharacterViewModel({ worldId: 'mistwood', character: smuggled, recentEvents: recent });
    expect(forbiddenKeysInViewModel(vm)).toEqual([]);
    // None of the forbidden values leak into the rendered text either.
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('不該外洩');
    expect(serialized).not.toContain('system prompt');
  });

  it('CHARACTER_FORBIDDEN_KEYS covers the AC#2 private categories', () => {
    expect(CHARACTER_FORBIDDEN_KEYS).toContain('privateProfile');
    expect(CHARACTER_FORBIDDEN_KEYS).toContain('privateGoal');
    expect(CHARACTER_FORBIDDEN_KEYS).toContain('knowledge');
    expect(CHARACTER_FORBIDDEN_KEYS).toContain('memory');
    expect(CHARACTER_FORBIDDEN_KEYS).toContain('prompt');
    expect(CHARACTER_FORBIDDEN_KEYS).toContain('rawModelOutput');
    expect(CHARACTER_FORBIDDEN_KEYS).toContain('adminNotes');
  });
});


/**
 * The FR-I005 fields that had no source when ART-43 closed, and now have one (ART-151).
 *
 * Each case pins the RULE rather than the rendering, because the rule is the part two surfaces
 * have to agree on: 「所屬 Arc」 is answered by the same function the live map's character card
 * calls, and 「主要關係」 is read out of the published FR-I007 graph rather than out of Canon.
 */
describe('the fields ART-43 AC#1 could not deliver at the time', () => {
  const scenes = [
    { title: '磨坊對峙', status: 'active' as const, participantCharacterIds: ['char-a', 'char-b'], arcIds: ['arc-mill'] },
    { title: '昨日的和解', status: 'ended' as const, participantCharacterIds: ['char-a'], arcIds: ['arc-truce'] },
    { title: '市集閒談', status: 'active' as const, participantCharacterIds: ['char-c'], arcIds: ['arc-market'] },
  ];

  it('reports only arcs from active scenes the character is actually in', () => {
    expect(characterCurrentArcs('char-a', scenes)).toEqual([{ arcId: 'arc-mill', sceneTitle: '磨坊對峙' }]);
  });

  it('deduplicates an arc that runs through two concurrent scenes, first scene winning', () => {
    const concurrent = [
      { title: '第一場', status: 'active' as const, participantCharacterIds: ['char-a'], arcIds: ['arc-mill'] },
      { title: '第二場', status: 'active' as const, participantCharacterIds: ['char-a'], arcIds: ['arc-mill'] },
    ];
    expect(characterCurrentArcs('char-a', concurrent)).toEqual([{ arcId: 'arc-mill', sceneTitle: '第一場' }]);
  });

  it('names an arc from the published active-arc list, and keeps the membership when it is absent', () => {
    const vm = composeCharacterViewModel({
      worldId: 'mistwood', character: character(), recentEvents: null,
      activeScenes: scenes,
      activeArcs: [{ arcId: 'arc-mill', title: '磨坊之爭', status: 'escalating' }],
    });
    expect(vm.arcs).toEqual([{
      arcId: 'arc-mill', title: '磨坊之爭', status: 'escalating',
      href: '#arc/mistwood/arc-mill',
    }]);

    const unnamed = composeCharacterViewModel({
      worldId: 'mistwood', character: character(), recentEvents: null,
      activeScenes: scenes, activeArcs: [],
    });
    // The membership is the published fact; a missing title is a gap in the arc list, not
    // evidence the character is not in the arc.
    expect(unnamed.arcs).toEqual([{ arcId: 'arc-mill', title: 'arc-mill', status: '', href: '#arc/mistwood/arc-mill' }]);
  });

  const graph: CharacterRelationshipGraphInput = {
    worldDay: 12,
    arc: { arcId: 'arc-mill', title: '磨坊之爭', status: 'escalating' },
    edges: [
      {
        sourceCharacterId: 'char-b', targetCharacterId: 'char-a',
        relationshipType: 'trust', strength: 4, lastChangedWorldDay: 11,
        recentChanges: [{ reason: '共同守夜' }],
      },
      {
        sourceCharacterId: 'char-a', targetCharacterId: 'char-c',
        relationshipType: 'resentment', strength: 7, lastChangedWorldDay: 9,
      },
      { sourceCharacterId: 'char-b', targetCharacterId: 'char-c', relationshipType: 'fear', strength: 9, lastChangedWorldDay: 12 },
    ],
  };

  it('takes the other end of every edge that touches the character, strongest first', () => {
    expect(characterRelationships('char-a', 'mistwood', graph)).toEqual([
      {
        otherCharacterId: 'char-c', href: '#character/mistwood/char-c',
        relationshipType: 'resentment', strength: 7, lastChangedWorldDay: 9, reasons: [],
      },
      {
        otherCharacterId: 'char-b', href: '#character/mistwood/char-b',
        relationshipType: 'trust', strength: 4, lastChangedWorldDay: 11, reasons: ['共同守夜'],
      },
    ]);
  });

  it('carries no edge the character is not part of', () => {
    const others = characterRelationships('char-a', 'mistwood', graph)
      .map((relationship) => relationship.otherCharacterId);
    expect(others).not.toContain('char-a');
    // char-b–char-c touches neither end of char-a and must not appear as a relationship of theirs.
    expect(characterRelationships('char-a', 'mistwood', graph)).toHaveLength(2);
  });

  it('publishes the day the relationships are as of, so an empty list is not read as "none"', () => {
    const withGraph = composeCharacterViewModel({
      worldId: 'mistwood', character: character(), recentEvents: null, relationshipGraph: graph,
    });
    expect(withGraph.relationshipsAsOfWorldDay).toBe(12);

    const withoutGraph = composeCharacterViewModel({
      worldId: 'mistwood', character: character(), recentEvents: null,
    });
    expect(withoutGraph.relationships).toEqual([]);
    expect(withoutGraph.relationshipsAsOfWorldDay).toBeNull();
  });

  it('resolves the current location to its published name, and falls back to the id', () => {
    const named = composeCharacterViewModel({
      worldId: 'mistwood', character: character(), recentEvents: null,
      locations: [{ locationId: 'mistwood-market', name: '晨霧市集' }],
    });
    expect(named.locationName).toBe('晨霧市集');

    const unread = composeCharacterViewModel({
      worldId: 'mistwood', character: character(), recentEvents: null,
    });
    expect(unread.locationName).toBe('mistwood-market');

    const nowhere = composeCharacterViewModel({
      worldId: 'mistwood', character: character({ currentLocationId: null }), recentEvents: null,
    });
    expect(nowhere.locationName).toBe('\u2014');
  });

  it('carries the sprite key through untouched, including its absence', () => {
    const withSprite = composeCharacterViewModel({
      worldId: 'mistwood', character: character(), recentEvents: null, spriteKey: 'f1',
    });
    expect(withSprite.spriteKey).toBe('f1');
    expect(composeCharacterViewModel({
      worldId: 'mistwood', character: character(), recentEvents: null,
    }).spriteKey).toBeUndefined();
  });

  it('adds no forbidden key by way of the new fields', () => {
    const vm = composeCharacterViewModel({
      worldId: 'mistwood', character: character(), recentEvents: null,
      activeScenes: scenes, activeArcs: [], relationshipGraph: graph, spriteKey: 'f1',
      locations: [{ locationId: 'mistwood-market', name: '晨霧市集' }],
    });
    expect(forbiddenKeysInViewModel(vm)).toEqual([]);
  });
});

/**
 * FR-I005's last two fields (ART-169).
 *
 * The page layer's job here is narrow and worth stating: it does NOT decide what a viewer may
 * know. That decision is made server-side, per row, against the editorial publication lifecycle
 * (`convex/publicRead/viewerKnowledgeProjection.ts`), and an unrevealed secret never reaches this
 * payload. What these cases pin is that the mapping is built from NAMED fields, that a row the
 * page cannot fully account for is dropped rather than rendered with a placeholder, and that the
 * scope and the omissions arrive on the view model instead of being silently dropped.
 */
describe('viewer-known secrets and dramatic irony', () => {
  const payload: CharacterViewerKnowledgeInput = {
    viewerKnownSecrets: [{
      secretId: 'secret-ledger',
      content: '他在水車停轉那晚把舊帳本搬離了磨坊。',
      revealedOnWorldDay: 6,
    }],
    dramaticIronyFacts: [{
      factId: 'e42:fact:0',
      subjectType: 'world',
      subjectId: 'mistwood',
      predicate: '聽證會日期',
      value: '第九日上午',
      revealedOnWorldDay: 7,
    }],
    omittedSecretCount: 2,
    omittedIronyFactCount: 3,
    oldestConsideredWorldDay: 5,
  };

  const vmWith = (input: CharacterViewerKnowledgeInput | null) => composeCharacterViewModel({
    worldId: 'mistwood', character: character(), recentEvents: null, viewerKnowledge: input,
  });

  it('renders a secret with a link to the day that revealed it', () => {
    expect(vmWith(payload).viewerKnownSecrets).toEqual([{
      secretId: 'secret-ledger',
      content: '他在水車停轉那晚把舊帳本搬離了磨坊。',
      revealedOnWorldDay: 6,
      episodeHref: '#episode/mistwood/6',
    }]);
  });

  it('renders an irony fact as a sentence the page owns', () => {
    expect(vmWith(payload).dramaticIronyFacts).toEqual([{
      factId: 'e42:fact:0',
      label: 'mistwood 的 聽證會日期:第九日上午',
      revealedOnWorldDay: 7,
      episodeHref: '#episode/mistwood/7',
    }]);
  });

  it('carries the omission counts and the window, so neither is silent', () => {
    const vm = vmWith(payload);
    expect(vm.viewerKnowledgeOmissions).toEqual({ secrets: 2, facts: 3 });
    expect(vm.viewerKnowledgeFromWorldDay).toBe(5);
  });

  it('is empty, not broken, when the model has not been read', () => {
    const vm = vmWith(null);
    expect(vm.viewerKnownSecrets).toEqual([]);
    expect(vm.dramaticIronyFacts).toEqual([]);
    expect(vm.viewerKnowledgeOmissions).toEqual({ secrets: 0, facts: 0 });
    expect(vm.viewerKnowledgeFromWorldDay).toBeNull();
  });

  it('drops a secret row it cannot fully account for rather than rendering a placeholder', () => {
    // The one section on this page whose rows ASSERT that something was already released. A row
    // with no day behind it cannot make that assertion, so it must not appear under the heading —
    // unlike 「所屬 Arc」, where falling back to the id is the honest answer.
    const vm = vmWith({
      viewerKnownSecrets: [
        { secretId: 'ok', content: '已公開的事', revealedOnWorldDay: 6 },
        { secretId: 'no-day', content: '沒有來源的事' },
        { secretId: 'no-content', revealedOnWorldDay: 6 },
        { content: '沒有編號的事', revealedOnWorldDay: 6 },
      ],
    });
    expect(vm.viewerKnownSecrets.map((secret) => secret.secretId)).toEqual(['ok']);
    expect(JSON.stringify(vm)).not.toContain('沒有來源的事');
  });

  it('survives a payload field of the wrong type instead of blanking the page', () => {
    // ART-94's timeline crashed the whole page by calling `.trim()` on a field that arrived
    // `undefined`. Every field here is read through a typed guard for that reason.
    const vm = vmWith({
      viewerKnownSecrets: [{ secretId: 7, content: null, revealedOnWorldDay: '6' }],
      dramaticIronyFacts: [{ factId: 'f', predicate: 'p', value: { nested: true }, revealedOnWorldDay: 3 }],
      omittedSecretCount: 'many',
      oldestConsideredWorldDay: -1,
    } as unknown as CharacterViewerKnowledgeInput);
    expect(vm.viewerKnownSecrets).toEqual([]);
    expect(vm.dramaticIronyFacts).toEqual([]);
    expect(vm.viewerKnowledgeOmissions.secrets).toBe(0);
    expect(vm.viewerKnowledgeFromWorldDay).toBeNull();
  });

  it('renders a boolean or numeric fact value rather than dropping it', () => {
    const vm = vmWith({
      dramaticIronyFacts: [
        { factId: 'f1', predicate: '水位', value: 3, revealedOnWorldDay: 7 },
        { factId: 'f2', predicate: '磨坊開放', value: false, revealedOnWorldDay: 7 },
      ],
    });
    expect(vm.dramaticIronyFacts.map((fact) => fact.label)).toEqual(['水位:3', '磨坊開放:false']);
  });

  it('adds no forbidden key by way of the two new fields', () => {
    // `CHARACTER_FORBIDDEN_KEYS` includes `secret`, and the guard matches WHOLE quoted keys —
    // so `viewerKnownSecrets` and `secretId` are not false positives, and a payload that
    // introduced a bare `secret` key still would be.
    expect(forbiddenKeysInViewModel(vmWith(payload))).toEqual([]);
  });
});
