import type { CharacterMemoryRecord, TimeSlot } from '../canon/model';
import type { KnowledgeRequester } from './authorization';
import { authorizeMemoryRead } from './memoryAuthorization';

export const MAX_RETRIEVED_MEMORIES = 12;

const SLOT_ORDER: Record<TimeSlot, number> = {
  morning: 0,
  noon: 1,
  afternoon: 2,
  evening: 3,
  night: 4,
};

export type MemoryRetrievalRequest = {
  targetCharacterId: string;
  requester: KnowledgeRequester;
  query: string;
  limit: number;
  now: { worldDay: number; timeSlot: TimeSlot };
  arcRelevantEventIds: string[];
};

export type MemoryScoreTrace = {
  memoryId: string;
  sourceEventId: string;
  semanticRelevance: number;
  importance: number;
  recency: number;
  emotionalWeight: number;
  arcRelevance: number;
  total: number;
};

export type MemoryRetrievalResult = {
  targetCharacterId: string;
  requestedLimit: number;
  appliedLimit: number;
  candidateCount: number;
  memories: CharacterMemoryRecord[];
  trace: MemoryScoreTrace[];
};

function tokens(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function semanticScore(memory: CharacterMemoryRecord, queryTokens: Set<string>): number {
  if (queryTokens.size === 0) return 0;
  const memoryTokens = tokens(`${memory.content} ${memory.interpretation}`);
  let overlap = 0;
  for (const token of queryTokens) if (memoryTokens.has(token)) overlap += 1;
  return overlap / queryTokens.size;
}

function recencyScore(memory: CharacterMemoryRecord, now: MemoryRetrievalRequest['now']): number {
  const then = memory.createdAt.worldDay * 5 + SLOT_ORDER[memory.createdAt.timeSlot];
  const current = now.worldDay * 5 + SLOT_ORDER[now.timeSlot];
  const elapsedSlots = Math.max(0, current - then);
  return 1 / (1 + elapsedSlots / 5);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function retrieveAuthorizedMemories(
  memoriesByCharacter: Record<string, CharacterMemoryRecord[]>,
  request: MemoryRetrievalRequest,
): MemoryRetrievalResult {
  if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > MAX_RETRIEVED_MEMORIES) {
    throw new Error(`memory retrieval limit must be an integer from 1 to ${MAX_RETRIEVED_MEMORIES}`);
  }
  if (!Number.isInteger(request.now.worldDay) || request.now.worldDay < 0) {
    throw new Error('memory retrieval world day must be a non-negative integer');
  }
  const authorized = authorizeMemoryRead(
    memoriesByCharacter,
    request.targetCharacterId,
    request.requester,
  );
  const queryTokens = tokens(request.query);
  const arcEvents = new Set(request.arcRelevantEventIds);
  const ranked = authorized.map((memory) => {
    const semanticRelevance = semanticScore(memory, queryTokens);
    const recency = recencyScore(memory, request.now);
    const emotionalWeight = Math.abs(memory.emotionalWeight);
    const arcRelevance = arcEvents.has(memory.sourceEventId) ? 1 : 0;
    const total = round(
      semanticRelevance * 0.35 + memory.importance * 0.25 + recency * 0.15
      + emotionalWeight * 0.1 + arcRelevance * 0.15,
    );
    return {
      memory,
      score: {
        memoryId: memory.memoryId,
        sourceEventId: memory.sourceEventId,
        semanticRelevance: round(semanticRelevance),
        importance: memory.importance,
        recency: round(recency),
        emotionalWeight,
        arcRelevance,
        total,
      },
    };
  }).sort((left, right) => right.score.total - left.score.total
    || left.memory.memoryId.localeCompare(right.memory.memoryId));
  const selected = ranked.slice(0, request.limit);
  return {
    targetCharacterId: request.targetCharacterId,
    requestedLimit: request.limit,
    appliedLimit: request.limit,
    candidateCount: authorized.length,
    memories: selected.map(({ memory }) => ({ ...memory, createdAt: { ...memory.createdAt } })),
    trace: selected.map(({ score }) => ({ ...score })),
  };
}
