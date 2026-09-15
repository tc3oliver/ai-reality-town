/**
 * Cached current-situation onboarding summary (FR-H001).
 *
 * Precomputes an approximately 300-Chinese-character entry summary composed of
 * bounded fields only (a major event, importance, up to four characters, up to
 * three facts, a question, a recommended episode, a scene) — it never shows the
 * full world history (AC#2). Pure module — no Convex imports, no clock, no
 * randomness, no Canon mutation, no LLM. The summary is cached via the public
 * read-model store so per-visitor reads never trigger generation (AC#4/#5) and
 * it refreshes after major mainline changes (AC#3).
 */

import { countChineseCharacters } from '../recaps/recapFormats';
import { factPredicateLabel, formatNameList } from '../shared/publicLabels';

export const ONBOARDING_SCHEMA_VERSION = 1;
export const ONBOARDING_MAX_CHARS = 300;
export const ONBOARDING_MAX_CHARACTERS = 4;
export const ONBOARDING_MAX_FACTS = 3;

export type OnboardingCharacter = { characterId: string; name: string };
export type OnboardingFact = { factId: string; predicate: string; value: string | number | boolean };
export type OnboardingSummary = {
  schemaVersion: typeof ONBOARDING_SCHEMA_VERSION;
  worldId: string;
  /** ≤ ONBOARDING_MAX_CHARS 中文字 (AC#1). */
  summaryText: string;
  structured: {
    majorEvent: { eventId: string; publicSummary: string } | null;
    importance: number;
    characters: OnboardingCharacter[];
    facts: OnboardingFact[];
    question: string | null;
    recommendedEpisode: { episodeNumber: number; worldDay: number } | null;
    scene: { title: string; summary: string } | null;
  };
};

export class OnboardingSummaryError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'OnboardingSummaryError';
  }
}

/** Truncate to at most `max` Chinese characters, preferring a clean boundary. */
export function truncateToChineseChars(text: string, max: number): string {
  if (countChineseCharacters(text) <= max) return text;
  let count = 0;
  let cutIndex = text.length;
  for (let index = 0; index < text.length; index += 1) {
    if (/[一-鿿]/.test(text[index])) {
      count += 1;
      if (count === max) { cutIndex = index + 1; break; }
      if (count > max) { cutIndex = index; break; }
    }
  }
  return `${text.slice(0, cutIndex)}…`;
}

function joinNonEmpty(parts: readonly string[]): string {
  return parts.filter((part) => part.trim().length > 0).join('。');
}

/**
 * Compose the cached onboarding summary from bounded inputs (AC#1/#2). The
 * composed text is truncated to {@link ONBOARDING_MAX_CHARS} 中文字; the
 * structured payload keeps the bounded fields (≤4 characters, ≤3 facts) so the
 * summary can never degrade into a full history dump.
 */
/**
 * One fact, as a viewer should read it (ART-183).
 *
 * The predicate is a SCHEMA KEY, and a fact's predicate is LLM-authored (see where
 * `onboardingSummaryFunctions.ts` collects them), so the vocabulary is open and no registry can
 * cover it. This function previously rendered `${predicate}是${value}` unconditionally, which put
 * 「currentArcPremise是An anonymous locker key…」 on the live home page: the reader was shown a
 * camelCase database key in the middle of a Chinese sentence.
 *
 * So there are two renderings, and the unregistered case is the important one:
 *
 * - A predicate with a zh-Hant label reads 「label:value」. `name`/`age` need this — 「Zhao Ming」
 *   alone says nothing.
 * - A predicate WITHOUT one renders the value alone. That is safe precisely because the value is
 *   public prose written for a reader while the predicate is not, and it degrades by dropping a
 *   label rather than by printing an identifier.
 */
function describeFact(fact: OnboardingFact): string {
  const label = factPredicateLabel(fact.predicate);
  const value = String(fact.value).trim();
  return label === null ? value : `${label}:${value}`;
}

export function buildOnboardingSummary(input: {
  worldId: string;
  majorEvent: { eventId: string; publicSummary: string } | null;
  importance: number;
  characters: readonly OnboardingCharacter[];
  facts: readonly OnboardingFact[];
  question: string | null;
  recommendedEpisode: { episodeNumber: number; worldDay: number } | null;
  scene: { title: string; summary: string } | null;
}): OnboardingSummary {
  if (input.worldId.trim().length === 0) throw new OnboardingSummaryError('ONBOARDING_INVALID', 'worldId must be non-empty');
  const characters = input.characters.slice(0, ONBOARDING_MAX_CHARACTERS);
  const facts = input.facts.slice(0, ONBOARDING_MAX_FACTS);

  const parts: string[] = [];
  if (input.majorEvent) parts.push(`近期大事:${input.majorEvent.publicSummary}`);
  if (characters.length > 0) parts.push(`關鍵人物:${formatNameList(characters.map((character) => character.name))}`);
  if (facts.length > 0) parts.push(`已知事實:${facts.map(describeFact).join('、')}`);
  if (input.question) parts.push(`懸而未決:${input.question}`);
  if (input.scene) parts.push(`場景:${input.scene.summary}`);
  if (input.recommendedEpisode) parts.push(`建議從第${input.recommendedEpisode.episodeNumber}集開始認識這個世界`);
  const composed = joinNonEmpty(parts) || '這個世界正等待你來探索。';
  const summaryText = truncateToChineseChars(composed, ONBOARDING_MAX_CHARS);

  return {
    schemaVersion: ONBOARDING_SCHEMA_VERSION,
    worldId: input.worldId,
    summaryText,
    structured: {
      majorEvent: input.majorEvent ? { ...input.majorEvent } : null,
      importance: typeof input.importance === 'number' && Number.isFinite(input.importance) ? input.importance : 0,
      characters: characters.map((character) => ({ ...character })),
      facts: facts.map((fact) => ({ ...fact })),
      question: input.question,
      recommendedEpisode: input.recommendedEpisode ? { ...input.recommendedEpisode } : null,
      scene: input.scene ? { ...input.scene } : null,
    },
  };
}
