/**
 * Three-minute active-arc primer (FR-H002, ART-38).
 *
 * Composes a focused ~2–4 minute primer for one active story arc from bounded
 * fields only — the arc cause (premise), the most recent turning point, the
 * core characters and their roles, and the current unresolved questions — so a
 * newcomer can understand the active mainline WITHOUT starting from Episode 1
 * (AC#2/#3). Pure module — no Convex imports, no clock, no randomness, no Canon
 * mutation, no LLM. Published via the public read-model store (modelKind `arc`,
 * modelRef `primer:<arcId>`) so per-visitor reads never trigger generation.
 */

import { countChineseCharacters } from '../recaps/recapFormats';

export const ARC_PRIMER_SCHEMA_VERSION = 1;
/** Hard upper bound keeping the primer within the ~4-minute ceiling (AC#1). */
export const ARC_PRIMER_MAX_CHARS = 1200;
/** Bounded core-character disclosure (FR-H002 核心人物角色). */
export const ARC_PRIMER_MAX_CHARACTERS = 6;
/** Bounded unresolved-question disclosure (FR-H002 當前未解問題). */
export const ARC_PRIMER_MAX_QUESTIONS = 4;

export type PrimerCharacter = { characterId: string; name: string; role: string | null };

export type ArcPrimer = {
  schemaVersion: typeof ARC_PRIMER_SCHEMA_VERSION;
  worldId: string;
  arcId: string;
  /** Bounded primer text covering cause / turning point / characters / questions (AC#1). */
  primerText: string;
  structured: {
    title: string;
    /** Arc cause / premise (起因). */
    cause: string | null;
    /** Most recent major turning point (最近重大轉折). */
    turningPoint: { eventId: string; summary: string } | null;
    /** Core characters and their roles (核心人物角色). */
    characters: PrimerCharacter[];
    /** Current unresolved questions (當前未解問題), current question first. */
    unresolvedQuestions: string[];
    /** Recommended entry so the viewer need not start at Episode 1 (AC#3). */
    recommendedEntry: { episodeNumber: number; worldDay: number } | null;
  };
};

export class ArcPrimerError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'ArcPrimerError';
  }
}

/** Truncate to at most `max` Chinese characters, preferring a clean boundary. */
export function truncatePrimerToChineseChars(text: string, max: number): string {
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
 * Compose the bounded arc primer (AC#1/#2). The text covers the four FR-H002
 * content areas from bounded inputs and is truncated to
 * {@link ARC_PRIMER_MAX_CHARS}; the structured payload keeps the bounded fields
 * (≤6 characters, ≤4 questions) so the primer can never degrade into a full
 * history dump and never requires starting from Episode 1 (AC#3).
 */
export function buildArcPrimer(input: {
  worldId: string;
  arcId: string;
  title: string;
  cause: string | null;
  turningPoint: { eventId: string; summary: string } | null;
  characters: readonly PrimerCharacter[];
  unresolvedQuestions: readonly string[];
  currentQuestion: string | null;
  recommendedEntry: { episodeNumber: number; worldDay: number } | null;
}): ArcPrimer {
  if (input.worldId.trim().length === 0) throw new ArcPrimerError('ARC_PRIMER_INVALID', 'worldId must be non-empty');
  if (input.arcId.trim().length === 0) throw new ArcPrimerError('ARC_PRIMER_INVALID', 'arcId must be non-empty');

  const characters = input.characters.slice(0, ARC_PRIMER_MAX_CHARACTERS);
  // Current question leads the unresolved-questions list, capped.
  const questionSeed = input.currentQuestion && input.currentQuestion.trim().length > 0 ? [input.currentQuestion] : [];
  const unresolvedQuestions = [...new Set([...questionSeed, ...input.unresolvedQuestions])]
    .slice(0, ARC_PRIMER_MAX_QUESTIONS);

  const parts: string[] = [input.title];
  if (input.cause) parts.push(`起因:${input.cause}`);
  if (input.turningPoint) parts.push(`最近重大轉折:${input.turningPoint.summary}`);
  if (characters.length > 0) {
    parts.push(`核心人物:${characters.map((character) => character.role ? `${character.name}(${character.role})` : character.name).join('、')}`);
  }
  if (unresolvedQuestions.length > 0) parts.push(`未解之謎:${unresolvedQuestions.join('、')}`);
  if (input.recommendedEntry) parts.push(`不必從第一集開始,建議從第${input.recommendedEntry.episodeNumber}集切入`);
  const composed = joinNonEmpty(parts) || `${input.title}:這條故事線正持續發展。`;
  const primerText = truncatePrimerToChineseChars(composed, ARC_PRIMER_MAX_CHARS);

  return {
    schemaVersion: ARC_PRIMER_SCHEMA_VERSION,
    worldId: input.worldId,
    arcId: input.arcId,
    primerText,
    structured: {
      title: input.title,
      cause: input.cause,
      turningPoint: input.turningPoint ? { ...input.turningPoint } : null,
      characters: characters.map((character) => ({ ...character })),
      unresolvedQuestions,
      recommendedEntry: input.recommendedEntry ? { ...input.recommendedEntry } : null,
    },
  };
}
