import type { CharacterMemoryRecord } from '../canon/model';
import { retrieveAuthorizedMemories, MAX_RETRIEVED_MEMORIES } from './memoryRetrieval';

function memory(
  memoryId: string,
  characterId: string,
  overrides: Partial<CharacterMemoryRecord> = {},
): CharacterMemoryRecord {
  return {
    memoryId,
    characterId,
    content: 'The station clock stopped during the storm',
    interpretation: 'Someone sent a warning',
    importance: 0.5,
    emotionalWeight: -0.2,
    confidence: 0.8,
    visibility: 'private',
    sourceEventId: `event-${memoryId}`,
    createdAt: { worldDay: 1, timeSlot: 'morning', eventId: `event-${memoryId}` },
    ...overrides,
  };
}

const baseRequest = {
  targetCharacterId: 'a',
  requester: { type: 'character' as const, characterId: 'a' },
  query: 'station storm warning',
  limit: 2,
  now: { worldDay: 4, timeSlot: 'night' as const },
  arcRelevantEventIds: ['event-arc'],
};

describe('FR-E003 bounded authorized memory retrieval', () => {
  it('ranks every required factor and returns only the bounded selection with traces', () => {
    const memories = {
      a: [
        memory('semantic', 'a', { importance: 0.1 }),
        memory('important', 'a', { content: 'unrelated', interpretation: 'unrelated', importance: 1 }),
        memory('recent', 'a', { content: 'unrelated', interpretation: 'unrelated', createdAt: { worldDay: 4, timeSlot: 'evening', eventId: 'event-recent' } }),
        memory('emotional', 'a', { content: 'unrelated', interpretation: 'unrelated', emotionalWeight: -1 }),
        memory('arc', 'a', { content: 'unrelated', interpretation: 'unrelated', sourceEventId: 'event-arc' }),
      ],
    };
    const result = retrieveAuthorizedMemories(memories, { ...baseRequest, limit: 5 });

    expect(result.candidateCount).toBe(5);
    expect(result.memories).toHaveLength(5);
    expect(result.trace).toHaveLength(5);
    expect(result.memories.slice(0, 2).map(({ memoryId }) => memoryId)).toEqual(['semantic', 'arc']);
    expect(result.trace[0]).toMatchObject({
      memoryId: 'semantic', semanticRelevance: 1, importance: 0.1,
    });
    expect(result.trace.find(({ memoryId }) => memoryId === 'important')).toMatchObject({ importance: 1 });
    expect(result.trace.find(({ memoryId }) => memoryId === 'recent')?.recency).toBeGreaterThan(0.8);
    expect(result.trace.find(({ memoryId }) => memoryId === 'emotional')).toMatchObject({ emotionalWeight: 1 });
    expect(result.trace.find(({ memoryId }) => memoryId === 'arc')).toMatchObject({ arcRelevance: 1 });
    expect(result.trace.every((entry) => entry.sourceEventId.startsWith('event-'))).toBe(true);
  });

  it('rejects cross-character retrieval before returning private candidates', () => {
    expect(() => retrieveAuthorizedMemories(
      { a: [memory('private', 'a')], b: [memory('other', 'b')] },
      { ...baseRequest, requester: { type: 'character', characterId: 'b' } },
    )).toThrow('[MEMORY_ACCESS_DENIED]');
  });

  it('rejects zero, fractional, and above-server-maximum limits', () => {
    for (const limit of [0, 1.5, MAX_RETRIEVED_MEMORIES + 1]) {
      expect(() => retrieveAuthorizedMemories({ a: [] }, { ...baseRequest, limit }))
        .toThrow(`1 to ${MAX_RETRIEVED_MEMORIES}`);
    }
  });

  it('uses world time deterministically and stable IDs to break score ties', () => {
    const records = { a: [memory('z', 'a'), memory('a', 'a')] };
    const first = retrieveAuthorizedMemories(records, baseRequest);
    const second = retrieveAuthorizedMemories(records, baseRequest);
    expect(first).toEqual(second);
    expect(first.memories.map(({ memoryId }) => memoryId)).toEqual(['a', 'z']);
  });

  it('returns selected records only and does not expose an unbounded history or prompt', () => {
    const records = { a: Array.from({ length: 30 }, (_, index) => memory(`m-${index}`, 'a')) };
    const result = retrieveAuthorizedMemories(records, { ...baseRequest, limit: 1 });
    expect(result.memories).toHaveLength(1);
    expect(result.trace).toHaveLength(1);
    expect(result).not.toHaveProperty('candidates');
    expect(result).not.toHaveProperty('prompt');
    expect(JSON.stringify(result)).not.toContain('m-29');
  });
});
