/**
 * Unit tests for the public Story Arc detail page (ART-69, FR-I006). Covers
 * every FR-I006 field (AC#1), the publication-safe boundary (AC#2), and the
 * resolved/archived-but-still-queryable behaviour (AC#3). Pure jest (no jsdom).
 *
 * Fixtures mirror the live published payloads verified against the dev
 * deployment (world `mistwood`, `arc:arc:mistwood:50` / `primer:arc:mistwood:50`).
 */

import {
  ARC_ACTIVE_STATUSES,
  ARC_FORBIDDEN_KEYS,
  composeArcViewModel,
  forbiddenKeysInArcViewModel,
  isActiveArcStatus,
  parseArcRoute,
  type ArcPrimerPayload,
  type ArcProjectionPayload,
} from './arcRoute';

function arc(overrides: Partial<ArcProjectionPayload> = {}): ArcProjectionPayload {
  return {
    worldId: 'mistwood',
    arcId: 'arc:mistwood:50',
    title: '磨坊之爭',
    premise: '何俊與趙明因磨坊停工而對立。',
    currentQuestion: '何俊會如何了結磨坊的事?',
    status: 'resolving',
    coreCharacterIds: ['he-jun', 'zhao-ming'],
    essentialBackstory: [
      { factId: 'f1', predicate: 'occupation', value: '磨坊管事', sourceEventId: 'mistwood#event#4' },
      { factId: 'f2', predicate: 'age', value: 39, sourceEventId: 'mistwood#event#4' },
    ],
    incitingEventId: 'mistwood#event#50',
    latestTurningPointEventId: 'mistwood#event#74',
    recommendedEntry: { episodeNumber: 3, worldDay: 2 },
    relatedEpisodes: [
      { episodeNumber: 3, worldDay: 2 },
      { episodeNumber: 5, worldDay: 4 },
    ],
    knownClues: [
      { factId: 'f1', predicate: 'occupation', value: '磨坊管事', sourceEventId: 'mistwood#event#4' },
      { factId: 'f9', predicate: 'auditOpen', value: true, sourceEventId: 'mistwood#event#74' },
    ],
    unresolvedQuestions: ['審計會揭露什麼?'],
    outcome: null,
    ...overrides,
  };
}

function primer(overrides: Partial<ArcPrimerPayload['structured']> = {}): ArcPrimerPayload {
  return {
    primerText: '磨坊之爭。起因:…',
    structured: {
      title: '磨坊之爭',
      cause: '磨坊停工。',
      turningPoint: { eventId: 'mistwood#event#74', summary: '審計被要求公開。' },
      characters: [
        { characterId: 'he-jun', name: '何俊', role: '磨坊管事' },
        { characterId: 'zhao-ming', name: '趙明', role: null },
      ],
      unresolvedQuestions: ['何俊會如何了結磨坊的事?'],
      recommendedEntry: { episodeNumber: 3, worldDay: 2 },
      ...overrides,
    },
  };
}

describe('parseArcRoute', () => {
  it('resolves a #arc/<worldId>/<arcId> route', () => {
    expect(parseArcRoute('#arc/mistwood/arc-a')).toEqual({ worldId: 'mistwood', arcId: 'arc-a' });
  });

  it('accepts colon-bearing arc ids as produced by the arc lifecycle', () => {
    expect(parseArcRoute('#arc/mistwood/arc:mistwood:50')).toEqual({
      worldId: 'mistwood',
      arcId: 'arc:mistwood:50',
    });
    expect(parseArcRoute(`#arc/mistwood/${encodeURIComponent('arc:mistwood:50')}`)).toEqual({
      worldId: 'mistwood',
      arcId: 'arc:mistwood:50',
    });
  });

  it('returns null for a single-segment, extra-segment, or unrelated route', () => {
    expect(parseArcRoute('#arc/arc-a')).toBeNull();
    expect(parseArcRoute('#arc/mistwood/arc-a/extra')).toBeNull();
    expect(parseArcRoute('#character/mistwood/char-a')).toBeNull();
    expect(parseArcRoute('')).toBeNull();
  });
});

describe('isActiveArcStatus', () => {
  it('treats only the active family as active context (AC#3)', () => {
    expect(ARC_ACTIVE_STATUSES.every(isActiveArcStatus)).toBe(true);
    expect(isActiveArcStatus('resolved')).toBe(false);
    expect(isActiveArcStatus('archived')).toBe(false);
  });
});

describe('composeArcViewModel', () => {
  it('composes every FR-I006 field from the published projection (AC#1)', () => {
    const vm = composeArcViewModel({ worldId: 'mistwood', arc: arc(), primer: primer() });
    expect(vm.hasContent).toBe(true);
    expect(vm.arcId).toBe('arc:mistwood:50');
    expect(vm.title).toBe('磨坊之爭');
    expect(vm.premise).toBe('何俊與趙明因磨坊停工而對立。');
    expect(vm.currentQuestion).toBe('何俊會如何了結磨坊的事?');
    expect(vm.statusLabel).toEqual({ status: 'resolving', label: '收束中', isActiveContext: true });
    expect(vm.essentialBackstory.map((fact) => fact.label)).toEqual(['occupation:磨坊管事', 'age:39']);
    expect(vm.incitingEventId).toBe('mistwood#event#50');
    expect(vm.latestTurningPoint).toEqual({ eventId: 'mistwood#event#74', summary: '審計被要求公開。' });
    expect(vm.recommendedEntry).toEqual({ episodeNumber: 3, worldDay: 2, href: '#episode/mistwood/2' });
    expect(vm.relatedEpisodes).toEqual([
      { episodeNumber: 3, worldDay: 2, href: '#episode/mistwood/2' },
      { episodeNumber: 5, worldDay: 4, href: '#episode/mistwood/4' },
    ]);
    expect(vm.knownClues.map((clue) => clue.label)).toEqual(['occupation:磨坊管事', 'auditOpen:true']);
    expect(vm.unresolvedQuestions).toEqual(['審計會揭露什麼?']);
    expect(vm.outcome).toBeNull();
  });

  it('names core people from the primer and deep-links each one (AC#1)', () => {
    const vm = composeArcViewModel({ worldId: 'mistwood', arc: arc(), primer: primer() });
    expect(vm.coreCharacters).toEqual([
      { characterId: 'he-jun', name: '何俊', role: '磨坊管事', href: '#character/mistwood/he-jun' },
      { characterId: 'zhao-ming', name: '趙明', role: null, href: '#character/mistwood/zhao-ming' },
    ]);
  });

  it('falls back to the character id and drops the turning-point summary without a primer', () => {
    const vm = composeArcViewModel({ worldId: 'mistwood', arc: arc(), primer: null });
    expect(vm.coreCharacters.map((person) => person.name)).toEqual(['he-jun', 'zhao-ming']);
    expect(vm.latestTurningPoint).toEqual({ eventId: 'mistwood#event#74', summary: null });
    expect(vm.recommendedEntry?.episodeNumber).toBe(3);
  });

  it('never attaches a stale primer summary to a newer turning point', () => {
    const vm = composeArcViewModel({
      worldId: 'mistwood',
      arc: arc({ latestTurningPointEventId: 'mistwood#event#99' }),
      primer: primer(),
    });
    expect(vm.latestTurningPoint).toEqual({ eventId: 'mistwood#event#99', summary: null });
  });

  it('falls back to the primer questions when the arc lists none', () => {
    const vm = composeArcViewModel({
      worldId: 'mistwood',
      arc: arc({ unresolvedQuestions: [] }),
      primer: primer(),
    });
    expect(vm.unresolvedQuestions).toEqual(['何俊會如何了結磨坊的事?']);
  });

  it('surfaces the outcome only when the arc actually resolved (AC#1)', () => {
    const vm = composeArcViewModel({
      worldId: 'mistwood',
      arc: arc({ status: 'resolved', outcome: { summary: '磨坊重啟,審計公開。', sourceEventIds: ['mistwood#event#80'] } }),
      primer: primer(),
    });
    expect(vm.outcome).toEqual({ summary: '磨坊重啟,審計公開。' });
    expect(vm.statusLabel).toEqual({ status: 'resolved', label: '已完結', isActiveContext: false });
  });

  it('keeps archived arcs queryable but out of active context (AC#3)', () => {
    const vm = composeArcViewModel({ worldId: 'mistwood', arc: arc({ status: 'archived' }), primer: primer() });
    expect(vm.hasContent).toBe(true);
    expect(vm.title).toBe('磨坊之爭');
    expect(vm.relatedEpisodes).toHaveLength(2);
    expect(vm.statusLabel).toEqual({ status: 'archived', label: '已封存', isActiveContext: false });
  });

  it('degrades gracefully when the projection is missing (AC#1 absent states)', () => {
    const vm = composeArcViewModel({ worldId: 'mistwood', arc: null, primer: null });
    expect(vm.hasContent).toBe(false);
    expect(vm.title).toBe('未知故事線');
    expect(vm.statusLabel).toEqual({ status: '', label: '—', isActiveContext: false });
    expect(vm.coreCharacters).toEqual([]);
    expect(vm.essentialBackstory).toEqual([]);
    expect(vm.relatedEpisodes).toEqual([]);
    expect(vm.knownClues).toEqual([]);
    expect(vm.unresolvedQuestions).toEqual([]);
    expect(vm.latestTurningPoint).toBeNull();
    expect(vm.recommendedEntry).toBeNull();
    expect(vm.outcome).toBeNull();
  });

  it('still titles the page from the primer when only the primer is published', () => {
    const vm = composeArcViewModel({ worldId: 'mistwood', arc: null, primer: primer() });
    expect(vm.hasContent).toBe(false);
    expect(vm.title).toBe('磨坊之爭');
    expect(vm.premise).toBe('磨坊停工。');
  });

  it('NEVER surfaces forbidden keys, even when the payload carries them (AC#2)', () => {
    const smuggled = {
      ...arc(),
      hiddenTruth: '尚未揭露的真相',
      secretPlan: '秘密計畫',
      plannedTwist: '預定轉折',
      privateGoal: '私人目標',
      knowledge: { secret: '...' },
      memory: ['私人記憶'],
      prompt: 'system prompt',
      rawModelOutput: 'raw',
      adminNotes: 'admin only',
      secret: 'value',
      token: 'abc',
    } as unknown as ArcProjectionPayload;
    const vm = composeArcViewModel({ worldId: 'mistwood', arc: smuggled, primer: primer() });
    expect(forbiddenKeysInArcViewModel(vm)).toEqual([]);
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('尚未揭露的真相');
    expect(serialized).not.toContain('秘密計畫');
    expect(serialized).not.toContain('system prompt');
  });

  it('ARC_FORBIDDEN_KEYS covers the AC#2 private categories', () => {
    expect(ARC_FORBIDDEN_KEYS).toContain('hiddenTruth');
    expect(ARC_FORBIDDEN_KEYS).toContain('secretPlan');
    expect(ARC_FORBIDDEN_KEYS).toContain('plannedTwist');
    expect(ARC_FORBIDDEN_KEYS).toContain('privateGoal');
    expect(ARC_FORBIDDEN_KEYS).toContain('knowledge');
    expect(ARC_FORBIDDEN_KEYS).toContain('prompt');
    expect(ARC_FORBIDDEN_KEYS).toContain('rawModelOutput');
    expect(ARC_FORBIDDEN_KEYS).toContain('adminNotes');
  });
});
