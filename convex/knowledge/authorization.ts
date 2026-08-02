import { CanonError, canonError } from '../shared/errors';
import type { CharacterKnowledgeRecord } from '../canon/model';

export type KnowledgeRequester =
  | { type: 'character'; characterId: string }
  | { type: 'operations'; operatorId: string };

/** Least-privilege read gate used by cognition and operations queries. */
export function authorizeKnowledgeRead(
  ledger: Record<string, CharacterKnowledgeRecord[]>,
  targetCharacterId: string,
  requester: KnowledgeRequester,
): CharacterKnowledgeRecord[] {
  if (requester.type === 'character' && requester.characterId !== targetCharacterId) {
    throw new CanonError(canonError(
      'KNOWLEDGE_ACCESS_DENIED',
      'a character may only read their own knowledge ledger',
      { targetCharacterId },
    ));
  }
  return (ledger[targetCharacterId] ?? []).map((record) => ({
    ...record,
    learnedAt: { ...record.learnedAt },
  }));
}
