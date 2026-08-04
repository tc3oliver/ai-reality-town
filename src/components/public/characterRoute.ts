/**
 * Pure, testable logic for the public character page (FR-I005, ART-43).
 *
 * The page's PRIMARY job is the public/private boundary (AC#2/#3): it renders
 * ONLY server-allowlisted character fields and can never surface unrevealed
 * Canon secrets, private memories, prompts, raw model output, or administrator
 * notes. That boundary is enforced server-side by the projection allowlist
 * (ART-84) + sanitizeForPublic; this module is the page-layer defence-in-depth —
 * {@link composeCharacterViewModel} constructs the view model from NAMED fields
 * only, so a forbidden key in the input payload can never reach the render.
 *
 * Pure module — no React, no Convex, no DOM, no clock, no randomness.
 */

/** Published character projection (§13.2) — fields the page may display. */
export type CharacterProjection = {
  id: string;
  worldId: string;
  name: string | null;
  age: number | null;
  occupation: string | null;
  publicProfile: string | null;
  personality: string | null;
  values: string | null;
  publicGoal: string | null;
  fear: string | null;
  currentLocationId: string | null;
  healthState: string | null;
  emotionalState: string | null;
  financialState: string | null;
  alive: boolean;
  active: boolean;
};

/** A recent major event relevant to this character (from the timeline). */
export type CharacterRecentEvent = {
  eventId: string;
  worldDay: number;
  timeSlot: string;
  publicSummary: string | null;
  episodeNumber: number | null;
};

/**
 * Keys that must NEVER appear in the character view model (AC#2). Mirrors the
 * server-side forbidden-field set; used by the defence-in-depth guard + tests.
 */
export const CHARACTER_FORBIDDEN_KEYS = [
  'privateProfile', 'privateGoal', 'knowledge', 'memory', 'memories',
  'prompt', 'rawModelOutput', 'adminNotes', 'secret', 'token',
] as const;

export type CharacterViewModel = {
  hasContent: boolean;
  characterId: string;
  name: string;
  age: string;
  occupation: string;
  publicProfile: string;
  personality: string;
  values: string;
  publicGoal: string;
  healthState: string;
  emotionalState: string;
  financialState: string;
  alive: boolean;
  active: boolean;
  recentEvents: Array<{ eventId: string; label: string; episodeHref: string | null }>;
};

const EM_DASH = '—';

/**
 * Resolve the world + character from `#character/<worldId>/<characterId>`. The
 * read needs the worldId, so the route is world-scoped (like `#episode/…`).
 */
export function parseCharacterRoute(hash: string): { worldId: string; characterId: string } | null {
  const stripped = hash.replace(/^#/, '');
  const match = stripped.match(/^character\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  const worldId = decodeURIComponent(match[1]);
  const characterId = decodeURIComponent(match[2]);
  return worldId.length > 0 && characterId.length > 0 ? { worldId, characterId } : null;
}

/**
 * Compose the character render model from the published projection and any
 * recent events for this character. The model is built from NAMED fields only
 * — it never copies the input object — so forbidden keys cannot leak (AC#2/#3,
 * page-layer defence-in-depth). Every field degrades to a safe placeholder.
 */
export function composeCharacterViewModel(input: {
  worldId: string;
  character: CharacterProjection | null;
  recentEvents: readonly CharacterRecentEvent[] | null;
}): CharacterViewModel {
  const character = input.character;
  const recent = input.recentEvents ?? [];
  return {
    hasContent: character !== null,
    characterId: character?.id ?? '',
    name: character?.name ?? '未知角色',
    age: character?.age != null ? String(character.age) : EM_DASH,
    occupation: character?.occupation ?? EM_DASH,
    publicProfile: character?.publicProfile ?? '',
    personality: character?.personality ?? '',
    values: character?.values ?? '',
    publicGoal: character?.publicGoal ?? '',
    healthState: character?.healthState ?? EM_DASH,
    emotionalState: character?.emotionalState ?? EM_DASH,
    financialState: character?.financialState ?? EM_DASH,
    alive: character?.alive ?? true,
    active: character?.active ?? true,
    recentEvents: recent.map((event) => ({
      eventId: event.eventId,
      label: `[日 ${event.worldDay} ${event.timeSlot}] ${event.publicSummary ?? '(無摘要)'}`,
      episodeHref: event.episodeNumber != null ? `#episode/${input.worldId}/${event.worldDay}` : null,
    })),
  };
}

/**
 * Defence-in-depth guard (AC#2/#3): the serialised view model must contain none
 * of the forbidden keys. Returns the list of forbidden keys found (empty = safe).
 * Pure — operates on the already-constructed view model.
 */
export function forbiddenKeysInViewModel(viewModel: CharacterViewModel): string[] {
  const serialized = JSON.stringify(viewModel);
  return CHARACTER_FORBIDDEN_KEYS.filter((key) => serialized.includes(`"${key}"`));
}
