/**
 * The two properties of a rumor that are DERIVED rather than told to us (FR-E005).
 *
 * Pure module: no Convex, no clock, no randomness. Everything here is a function of the ordered
 * accepted events already folded into a projection, which is why replay and snapshot-resume
 * cannot disagree about a rumor's truth or its credibility.
 *
 * ## Why these two are derived and not fields on the event
 *
 * A provider proposes rumors. If a provider could also write `objectiveTruthStatus: 'true'`,
 * then a rumor would be a fact with extra steps — the model would be authoring the world's
 * verdict on its own output, and FR-E005 AC#1 (謠言不得自動轉為 Canon Fact) would be a naming
 * convention rather than a rule. So truth is computed by asking Canon, and Canon only answers
 * about facts that some accepted `fact_created` actually established.
 *
 * The same argument applies to 可信程度. A "credibility" the author picks is just a second
 * confidence field. The credibility that means something is the one the world produces: how many
 * characters hold this rumor, and what do they currently make of it.
 */

import type {
  CharacterKnowledgeRecord,
  KnowledgeTruthStatus,
  ProjectedFact,
  RumorChainState,
  RumorStance,
} from './model';

/** What one character currently holds about one rumor. Exactly one live record per pair. */
export type RumorHolding = {
  characterId: string;
  knowledgeId: string;
  versionId: string;
  stance: RumorStance;
  confidence: number;
};

/**
 * The identity of a claim, in the same shape `validators.ts` uses for `changedFactKeys`.
 *
 * Shared spelling on purpose: the rule that a rumor may not be laundered into a fact within one
 * event compares a rumor's claim key against a `fact_created` key, and two independently written
 * key formats that happen to agree today would stop agreeing the first time either grew a field.
 */
export const claimKey = (subjectType: string, subjectId: string, predicate: string): string =>
  `${subjectType}\u0000${subjectId}\u0000${predicate}`;

export const rumorClaimKey = (chain: Pick<RumorChainState, 'claim'>): string =>
  claimKey(chain.claim.subjectType, chain.claim.subjectId, chain.claim.predicate);

/**
 * Every character currently holding this rumor, in character-id order.
 *
 * SORTED, and that is load-bearing rather than tidy. `characterKnowledge` is a plain object whose
 * key order is insertion order after a replay from empty, but a projection that came back out of
 * a stored snapshot has been through Convex's document encoding and need not preserve it. Folding
 * credibility over an unsorted iteration would make the number depend on how the projection was
 * loaded, and `projectionIntegrityHash` would then flag a snapshot-resumed world as corrupt
 * against an identical replayed one.
 *
 * "Currently" means the uncorrected record: the rumor verbs supersede a holder's previous record
 * by the ledger's own `correctsKnowledgeId`/`correctedByKnowledgeId` link, so the live one is the
 * one nothing has corrected.
 */
export function rumorHolders(
  characterKnowledge: Record<string, readonly CharacterKnowledgeRecord[]>,
  rumorId: string,
): RumorHolding[] {
  const holdings: RumorHolding[] = [];
  for (const characterId of Object.keys(characterKnowledge).sort()) {
    for (const record of characterKnowledge[characterId] ?? []) {
      if (record.rumorId !== rumorId) continue;
      if (record.correctedByKnowledgeId !== undefined) continue;
      if (record.rumorVersionId === undefined || record.rumorStance === undefined) continue;
      holdings.push({
        characterId: record.characterId,
        knowledgeId: record.knowledgeId,
        versionId: record.rumorVersionId,
        stance: record.rumorStance,
        confidence: record.confidence,
      });
    }
  }
  return holdings;
}

/** The live record a character holds for a rumor, or `undefined` if they have never heard it. */
export function heldRumorRecord(
  characterKnowledge: Record<string, readonly CharacterKnowledgeRecord[]>,
  characterId: string,
  rumorId: string,
): CharacterKnowledgeRecord | undefined {
  return (characterKnowledge[characterId] ?? []).find((record) =>
    record.rumorId === rumorId && record.correctedByKnowledgeId === undefined);
}

/** True when this character has been told the rumor through the chain and still holds it. */
export const holdsRumor = (
  characterKnowledge: Record<string, readonly CharacterKnowledgeRecord[]>,
  characterId: string,
  rumorId: string,
): boolean => heldRumorRecord(characterKnowledge, characterId, rumorId) !== undefined;

/**
 * 客觀真假 for one claimed value, asked of Canon.
 *
 * `unknown` when Canon has never established a fact for this subject and predicate, which is the
 * ordinary case: most rumors are about things the record has not settled. This is a genuine third
 * answer and not a soft `false` — "the town does not know" and "the town knows otherwise" are
 * different states, and a rumor that later turns out true must not have been recorded as false in
 * the meantime.
 *
 * Comparison is strict. A rumor claiming the string `'true'` about a boolean fact is false, not
 * true-by-coercion; a rumor is a claim about a value, and near enough is not the same value.
 */
export function deriveObjectiveTruthStatus(
  facts: readonly ProjectedFact[],
  claim: RumorChainState['claim'],
  claimedValue: string | number | boolean,
): KnowledgeTruthStatus {
  const live = facts.find((fact) => fact.validUntilEventId === null
    && fact.subjectType === claim.subjectType
    && fact.subjectId === claim.subjectId
    && fact.predicate === claim.predicate);
  if (!live) return 'unknown';
  return live.value === claimedValue ? 'true' : 'false';
}

/** The chain's own truth status: the standing of its CURRENT version. */
export function deriveChainTruthStatus(
  facts: readonly ProjectedFact[],
  chain: RumorChainState,
): KnowledgeTruthStatus {
  const current = chain.versions.find(({ versionId }) => versionId === chain.currentVersionId);
  if (!current) return 'unknown';
  return deriveObjectiveTruthStatus(facts, chain.claim, current.claimedValue);
}

/**
 * The weight each stance contributes to credibility.
 *
 * A doubter is not a non-holder: they are still carrying the rumor around and will still repeat
 * it, so they count for something. A rejecter contributes nothing rather than a negative number —
 * credibility is bounded to 0..1 so it can be read as "how much of this town's belief does this
 * rumor hold", and letting rejection go negative would make a widely-disbelieved rumor score the
 * same as one nobody has ever heard.
 */
const STANCE_WEIGHT: Record<RumorStance, number> = { believes: 1, doubts: 0.5, rejects: 0 };

/** Six decimal places: enough to distinguish real differences, few enough to survive a round-trip. */
const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

/**
 * 可信程度 — mean stance-weighted confidence across current holders, in 0..1.
 *
 * Zero when nobody holds it. That is not a claim that the rumor is worthless; it is the honest
 * reading of a rumor that has died out, and it is the same number a rumor that was never spread
 * would carry.
 */
export function deriveCredibility(holdings: readonly RumorHolding[]): number {
  if (holdings.length === 0) return 0;
  let total = 0;
  for (const holding of holdings) {
    const confidence = Math.min(1, Math.max(0, holding.confidence));
    total += STANCE_WEIGHT[holding.stance] * confidence;
  }
  return round6(total / holdings.length);
}

/**
 * Recompute both derived fields for one chain against the projection state around it.
 *
 * Returns a NEW chain; the input is never mutated, so this is safe to call inside the reducer's
 * copy-on-write fold.
 */
export function withDerivedRumorFields(
  chain: RumorChainState,
  facts: readonly ProjectedFact[],
  characterKnowledge: Record<string, readonly CharacterKnowledgeRecord[]>,
): RumorChainState {
  return {
    ...chain,
    objectiveTruthStatus: deriveChainTruthStatus(facts, chain),
    credibility: deriveCredibility(rumorHolders(characterKnowledge, chain.rumorId)),
  };
}
