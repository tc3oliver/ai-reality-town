/**
 * Unit tests for the public character page (ART-43, FR-I005). The headline
 * cases are the AC#2/#3 privacy boundary: the view model never surfaces
 * forbidden keys even when the input payload carries them. Pure jest (no jsdom).
 */

import {
  CHARACTER_FORBIDDEN_KEYS,
  composeCharacterViewModel,
  forbiddenKeysInViewModel,
  parseCharacterRoute,
  type CharacterProjection,
  type CharacterRecentEvent,
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
