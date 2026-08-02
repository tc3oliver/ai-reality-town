import { CanonError, canonError } from '../shared/errors';
import type { CharacterMemoryRecord } from '../canon/model';
import type { KnowledgeRequester } from './authorization';

export function authorizeMemoryRead(
  memories: Record<string, CharacterMemoryRecord[]>,
  targetCharacterId: string,
  requester: KnowledgeRequester,
): CharacterMemoryRecord[] {
  if (requester.type === 'character' && requester.characterId !== targetCharacterId) {
    throw new CanonError(canonError(
      'MEMORY_ACCESS_DENIED',
      'a character may only read their own subjective memories',
      { targetCharacterId },
    ));
  }
  return (memories[targetCharacterId] ?? []).map((memory) => ({
    ...memory,
    createdAt: { ...memory.createdAt },
  }));
}
