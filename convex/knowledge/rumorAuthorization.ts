/**
 * Least-privilege reads over rumor chains (FR-E005).
 *
 * Pure module, and deliberately the same shape as `authorization.ts`: a rumor a character holds
 * IS knowledge they hold, so the gate over it must not be softer than the gate over the ledger
 * it lives in.
 *
 * ## What a character may see, and why it is so little
 *
 * A `RumorChainState` holds six things about a rumor. Five of them are the WORLD's knowledge, not
 * any character's:
 *
 *  - `originCharacterId` — who started it. Hearing a rumor tells you who told YOU, and nothing
 *    about who told them. Handing the origin to every listener would make anonymity impossible
 *    and would give any character a perfect answer to the question the whole feature is about.
 *  - `propagationChain` in full — the same argument, one step further: the chain is the map of
 *    who talks to whom, and it is not something a listener acquires by listening.
 *  - `credibility` — an aggregate over every holder's private confidence. Publishing it to a
 *    character would leak, in a single number, what other characters privately believe.
 *  - `objectiveTruthStatus` — Canon's verdict. A character who could read this would never need
 *    to weigh a rumor again, and 「不同角色可相信不同版本」 would collapse into everyone
 *    believing the true one.
 *  - `corrections` — being on the record is not the same as having been heard. A correction
 *    reaches a character through a `rumor_propagated`/`rumor_belief_changed` pair like anything
 *    else.
 *
 * So a character sees exactly what reached them: the version they were told, what they currently
 * make of it, and the hops they were personally party to. Operations sees the whole chain,
 * because reviewing a world means seeing what the world knows.
 */

import { CanonError, canonError } from '../shared/errors';
import type { RumorChainState, RumorPropagationHop, RumorVersionRecord, WorldProjection } from '../canon/model';
import { heldRumorRecord, rumorHolders, type RumorHolding } from '../canon/rumorChain';
import type { KnowledgeRequester } from './authorization';

/** What a character may learn about a rumor they hold. */
export type CharacterRumorView = {
  rumorId: string;
  /** The wording THEY were told — not `currentVersionId`, which may be a later distortion. */
  version: RumorVersionRecord;
  stance: RumorHolding['stance'];
  confidence: number;
  /** How they came by it: `told` for hearsay, the originator's own provenance at an origin. */
  sourceType: string;
  /** Only the tellings this character was on one end of. */
  personalChain: RumorPropagationHop[];
};

/** What operations may see: everything the world holds, including who currently believes what. */
export type OperationsRumorView = {
  chain: RumorChainState;
  holdings: RumorHolding[];
};

const cloneHop = (hop: RumorPropagationHop): RumorPropagationHop => ({ ...hop });

function cloneChain(chain: RumorChainState): RumorChainState {
  return {
    ...chain,
    claim: { ...chain.claim },
    versions: chain.versions.map((version) => ({ ...version, createdAt: { ...version.createdAt } })),
    propagationChain: chain.propagationChain.map(cloneHop),
    corrections: chain.corrections.map((correction) => ({ ...correction })),
  };
}

/**
 * Read one rumor chain as the requester is entitled to see it.
 *
 * Throws `KNOWLEDGE_ACCESS_DENIED` — the ledger's own code, not a new one — when a character asks
 * about a rumor no chain ever reached them with. Reusing the code matters: this is the same
 * refusal as "you may not read another character's ledger", because it is the same rule.
 */
export function authorizeRumorRead(
  projection: WorldProjection,
  rumorId: string,
  requester: KnowledgeRequester,
): OperationsRumorView | CharacterRumorView {
  const chain = projection.rumors?.[rumorId];
  if (!chain) {
    throw new CanonError(canonError('RUMOR_NOT_FOUND', 'rumor does not exist in this world', { rumorId }));
  }
  if (requester.type === 'operations') {
    return {
      chain: cloneChain(chain),
      holdings: rumorHolders(projection.characterKnowledge ?? {}, rumorId),
    };
  }
  const held = heldRumorRecord(projection.characterKnowledge ?? {}, requester.characterId, rumorId);
  if (!held || held.rumorVersionId === undefined || held.rumorStance === undefined) {
    // Deliberately the same refusal whether the rumor exists and never reached them or they are
    // simply not entitled to it: a distinguishable "exists but not yours" would let a character
    // enumerate the world's rumors by guessing ids.
    throw new CanonError(canonError(
      'KNOWLEDGE_ACCESS_DENIED',
      'a character may only read a rumor that reached them through its propagation chain',
      { rumorId },
    ));
  }
  const version = chain.versions.find(({ versionId }) => versionId === held.rumorVersionId);
  if (!version) {
    throw new CanonError(canonError('RUMOR_NOT_FOUND', 'the held rumor version is missing from its chain', {
      rumorId, versionId: held.rumorVersionId,
    }));
  }
  return {
    rumorId,
    version: { ...version, createdAt: { ...version.createdAt } },
    stance: held.rumorStance,
    confidence: held.confidence,
    sourceType: held.sourceType,
    personalChain: chain.propagationChain
      .filter((hop) => hop.fromCharacterId === requester.characterId || hop.toCharacterId === requester.characterId)
      .map(cloneHop),
  };
}

/**
 * Every rumor a character currently holds, in rumor-id order.
 *
 * A character may only ask about themselves, exactly as with the ledger; operations may ask about
 * anyone. Ordering is explicit rather than incidental so two calls against the same world return
 * the same list regardless of how the projection was loaded.
 */
export function authorizeCharacterRumorList(
  projection: WorldProjection,
  targetCharacterId: string,
  requester: KnowledgeRequester,
): CharacterRumorView[] {
  if (requester.type === 'character' && requester.characterId !== targetCharacterId) {
    throw new CanonError(canonError(
      'KNOWLEDGE_ACCESS_DENIED',
      'a character may only list their own rumors',
      { targetCharacterId },
    ));
  }
  const held = (projection.characterKnowledge?.[targetCharacterId] ?? [])
    .filter((record) => record.rumorId !== undefined && record.correctedByKnowledgeId === undefined);
  const views: CharacterRumorView[] = [];
  for (const record of held) {
    const rumorId = record.rumorId as string;
    if (!projection.rumors?.[rumorId]) continue;
    // Read through the single-rumor gate rather than assembling a view here, so the two can
    // never diverge on what a character is allowed to see.
    views.push(authorizeRumorRead(projection, rumorId, {
      type: 'character', characterId: targetCharacterId,
    }) as CharacterRumorView);
  }
  return views.sort((left, right) => left.rumorId.localeCompare(right.rumorId));
}
