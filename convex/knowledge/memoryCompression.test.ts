/**
 * FR-E004 compression behaviour and failure paths (ART-27).
 *
 * The lossless *properties* — exact partition, round trip, recall preservation — live in
 * `memoryCompression.lossless.test.ts`. This file settles what the digest says, what it keeps
 * verbatim, and what it does when the input is wrong.
 */

import type { CharacterMemoryRecord } from '../canon/model';
import {
  compressCharacterMemories,
  expandCompressedMemories,
  HIGH_IMPORTANCE_RETENTION,
  MEMORY_DIGEST_KINDS,
  STABLE_BELIEF_MIN_SUPPORT,
  type MemoryCompressionRequest,
  type MemoryEventContext,
} from './memoryCompression';

const NOW = { worldDay: 30, timeSlot: 'noon' as const };

function memory(
  memoryId: string,
  overrides: Partial<CharacterMemoryRecord> = {},
): CharacterMemoryRecord {
  const worldDay = overrides.createdAt?.worldDay ?? 2;
  return {
    memoryId,
    characterId: 'ana',
    content: `what happened at ${memoryId}`,
    interpretation: 'the mill is unsafe',
    importance: 0.2,
    emotionalWeight: -0.4,
    confidence: 0.6,
    visibility: 'private',
    sourceEventId: `event-${memoryId}`,
    ...overrides,
    createdAt: { worldDay, timeSlot: 'morning', eventId: `event-${memoryId}`, ...overrides.createdAt },
  };
}

function context(
  eventId: string,
  overrides: Partial<MemoryEventContext> = {},
): MemoryEventContext {
  return { eventId, participantCharacterIds: ['ana'], ...overrides };
}

function request(overrides: Partial<MemoryCompressionRequest> = {}): MemoryCompressionRequest {
  return { characterId: 'ana', now: NOW, horizonDays: 5, eventContexts: [], ...overrides };
}

/** Freezing proves absence of mutation by making it throw, rather than by inspection. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe('FR-E004 long-term memory compression', () => {
  it('folds old memories into all five PRD digest kinds', () => {
    const memories = [
      memory('a', { createdAt: { worldDay: 2, timeSlot: 'morning', eventId: 'event-a' } }),
      memory('b', { createdAt: { worldDay: 3, timeSlot: 'evening', eventId: 'event-b' } }),
      memory('c', {
        interpretation: '  The Mill   is UNSAFE ',
        createdAt: { worldDay: 4, timeSlot: 'noon', eventId: 'event-c' },
      }),
    ];
    const result = compressCharacterMemories(memories, request({
      eventContexts: [
        context('event-a', { participantCharacterIds: ['ana', 'bo'], locationId: 'mill', arcIds: ['arc-flood'] }),
        context('event-b', { participantCharacterIds: ['ana', 'bo'], locationId: 'mill', arcIds: ['arc-flood'] }),
        context('event-c', { locationId: 'mill' }),
      ],
    }));

    expect(result.retainedMemories).toEqual([]);
    expect(result.foldedMemoryIds).toEqual(['a', 'b', 'c']);
    expect(result.digests.map((digest) => digest.digestId)).toEqual([
      'impression:ana',
      'belief:the mill is unsafe',
      'relationship:bo',
      'arc:arc-flood',
      'location:mill',
    ]);
    expect(result.digests.map((digest) => digest.kind)).toEqual([...MEMORY_DIGEST_KINDS]);
  });

  it('keys a stable belief on the normalized interpretation, not on the phrasing', () => {
    const belief = compressCharacterMemories([
      memory('a'),
      memory('b', { interpretation: 'The Mill Is Unsafe' }),
      memory('c', { interpretation: 'the mill is  unsafe  ' }),
    ], request({
      eventContexts: ['event-a', 'event-b', 'event-c'].map((eventId) => context(eventId)),
    })).digests.find((digest) => digest.kind === 'belief');

    expect(belief).toMatchObject({
      subject: 'the mill is unsafe',
      memoryCount: STABLE_BELIEF_MIN_SUPPORT,
      sourceMemoryIds: ['a', 'b', 'c'],
      sourceEventIds: ['event-a', 'event-b', 'event-c'],
    });
  });

  it('does not call a repeated reading stable below the support threshold', () => {
    const supported = Array.from({ length: STABLE_BELIEF_MIN_SUPPORT }, (_, index) => memory(`m${index}`));
    const contexts = supported.map((record) => context(record.sourceEventId));
    const beliefsFor = (records: CharacterMemoryRecord[]): string[] =>
      compressCharacterMemories(records, request({
        eventContexts: contexts.slice(0, records.length),
      })).digests.filter((digest) => digest.kind === 'belief').map((digest) => digest.subject);

    expect(beliefsFor(supported.slice(0, STABLE_BELIEF_MIN_SUPPORT - 1))).toEqual([]);
    expect(beliefsFor(supported)).toEqual(['the mill is unsafe']);
  });

  it('keeps recent memories and high-importance memories verbatim, and folds the rest', () => {
    const memories = [
      memory('old-trivial', { importance: HIGH_IMPORTANCE_RETENTION - 0.01 }),
      memory('old-important', { importance: HIGH_IMPORTANCE_RETENTION }),
      memory('recent-trivial', {
        importance: 0,
        createdAt: { worldDay: 26, timeSlot: 'morning', eventId: 'event-recent-trivial' },
      }),
    ];
    const result = compressCharacterMemories(memories, request({
      horizonDays: 5,
      eventContexts: memories.map((record) => context(record.sourceEventId)),
    }));

    expect(result.retainedMemories.map((record) => record.memoryId))
      .toEqual(['old-important', 'recent-trivial']);
    expect(result.foldedMemoryIds).toEqual(['old-trivial']);
    expect(result.retainedMemories[0]).toEqual(memories[1]);
  });

  it('reports statistics a reader can recompute from the expansion', () => {
    const memories = [
      memory('a', { importance: 0.1, emotionalWeight: 0.9, confidence: 0.4 }),
      memory('b', {
        importance: 0.5, emotionalWeight: 0.3, confidence: 0.8,
        createdAt: { worldDay: 9, timeSlot: 'night', eventId: 'event-b' },
      }),
    ];
    const result = compressCharacterMemories(memories, request({
      eventContexts: memories.map((record) => context(record.sourceEventId)),
    }));
    const impression = result.digests.find((digest) => digest.kind === 'impression')!;
    const sources = expandCompressedMemories(result, memories);

    expect(impression).toMatchObject({
      memoryCount: 2,
      meanImportance: 0.3,
      peakImportance: 0.5,
      meanConfidence: 0.6,
      meanEmotionalWeight: 0.6,
      firstWorldDay: 2,
      lastWorldDay: 9,
    });
    expect(impression.meanImportance).toBe(
      sources.reduce((total, record) => total + record.importance, 0) / sources.length,
    );
    expect(impression.summary).toBe(
      'A warm impression of world days 2-9, from 2 folded memories (mean importance 0.3).',
    );
  });

  it('is deterministic: no clock, no randomness, no dependence on input order of contexts', () => {
    const memories = [memory('b'), memory('a')];
    const contexts = [context('event-a', { locationId: 'mill' }), context('event-b', { locationId: 'mill' })];
    const first = compressCharacterMemories(memories, request({ eventContexts: contexts }));
    const second = compressCharacterMemories(memories, request({ eventContexts: [...contexts].reverse() }));

    expect(first).toEqual(second);
    expect(first.foldedMemoryIds).toEqual(['a', 'b']);
  });

  it('AC#2: leaves Canon and the supplied projection untouched, and returns unaliased records', () => {
    const memories = deepFreeze([memory('a', { importance: 1 }), memory('b')]);
    const before = JSON.stringify(memories);
    const result = compressCharacterMemories(memories, deepFreeze(request({
      eventContexts: [context('event-a', { locationId: 'mill' }), context('event-b')],
    })));

    result.retainedMemories[0].importance = 0;
    result.retainedMemories[0].createdAt.worldDay = 999;

    expect(JSON.stringify(memories)).toBe(before);
    expect(memories[0].importance).toBe(1);
    expect(memories[0].createdAt.worldDay).toBe(2);
  });

  describe('AC#4: a rejected compression produces nothing and changes nothing', () => {
    const cases: [name: string, code: string, run: (memories: CharacterMemoryRecord[]) => unknown][] = [
      ['a memory belonging to another character', 'MEMORY_ACCESS_DENIED',
        (memories) => compressCharacterMemories(
          [...memories, memory('intruder', { characterId: 'bo' })],
          request({ eventContexts: [context('event-a'), context('event-b'), context('event-intruder')] }),
        )],
      ['a duplicated memory id', 'MEMORY_COMPRESSION_INPUT_INVALID',
        (memories) => compressCharacterMemories(
          [...memories, memory('a')],
          request({ eventContexts: [context('event-a'), context('event-b')] }),
        )],
      ['a missing event context', 'UNKNOWN_EVENT_REFERENCE',
        (memories) => compressCharacterMemories(memories, request({
          eventContexts: [context('event-a')],
        }))],
      ['an event context no memory refers to', 'MEMORY_COMPRESSION_INPUT_INVALID',
        (memories) => compressCharacterMemories(memories, request({
          eventContexts: [context('event-a'), context('event-b'), context('event-unwitnessed')],
        }))],
      ['a duplicated event context', 'MEMORY_COMPRESSION_INPUT_INVALID',
        (memories) => compressCharacterMemories(memories, request({
          eventContexts: [context('event-a'), context('event-a'), context('event-b')],
        }))],
      ['an event context the character did not participate in', 'PARTICIPANT_MISMATCH',
        (memories) => compressCharacterMemories(memories, request({
          eventContexts: [context('event-a', { participantCharacterIds: ['bo'] }), context('event-b')],
        }))],
      ['a fractional horizon', 'MEMORY_COMPRESSION_INPUT_INVALID',
        (memories) => compressCharacterMemories(memories, request({ horizonDays: 1.5 }))],
      ['a negative horizon', 'MEMORY_COMPRESSION_INPUT_INVALID',
        (memories) => compressCharacterMemories(memories, request({ horizonDays: -1 }))],
      ['a negative world day', 'MEMORY_COMPRESSION_INPUT_INVALID',
        (memories) => compressCharacterMemories(memories, request({
          now: { worldDay: -1, timeSlot: 'noon' },
        }))],
      ['an empty character id', 'MEMORY_COMPRESSION_INPUT_INVALID',
        (memories) => compressCharacterMemories(memories, request({ characterId: '' }))],
    ];

    it.each(cases)('rejects %s with %s and keeps every source memory', (_name, code, run) => {
      const memories = deepFreeze([memory('a'), memory('b')]);
      const before = JSON.stringify(memories);

      expect(() => run(memories)).toThrow(`[${code}]`);
      expect(JSON.stringify(memories)).toBe(before);
      expect(memories.map((record) => record.memoryId)).toEqual(['a', 'b']);
    });
  });

  it('refuses to expand against a corpus that has lost a source memory', () => {
    const memories = [memory('a'), memory('b')];
    const result = compressCharacterMemories(memories, request({
      eventContexts: memories.map((record) => context(record.sourceEventId)),
    }));

    expect(() => expandCompressedMemories(result, [memories[0]]))
      .toThrow('[MEMORY_COMPRESSION_INPUT_INVALID]');
  });
});
