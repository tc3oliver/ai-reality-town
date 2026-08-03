/**
 * Pure, testable logic for the story-first public homepage (FR-I001, ART-41).
 *
 * The homepage React component is a thin render layer; every piece of logic
 * that has a correctness boundary lives here as a pure function so it can be
 * unit-tested without a DOM (the repo's jest setup has no jsdom). Two concerns:
 *
 *   - {@link parseHomeRoute}: resolves the public world from the `#home/<worldId>`
 *     hash route. Returns null for a bare/unknown route so the component can
 *     surface a format hint (a future public-world discovery query can replace
 *     the hard requirement for a worldId in the URL).
 *   - {@link composeHomepageViewModel}: normalises the three published
 *     projections (onboarding / world / live) the homepage consumes into a
 *     single render model, baking in the UX-001..006 / FR-I001 acceptance
 *     rules — first-viewport major-event priority, bounded newcomer disclosure
 *     (≤4 characters, ≤3 facts, one entry), and graceful unavailable states for
 *     every section so the P0 homepage never breaks when a model is missing.
 *
 * Pure module — no React, no Convex, no DOM, no clock, no randomness. The input
 * shapes mirror the published projection payloads (redeclared locally, as the
 * component does, to avoid importing Convex internals into the client bundle).
 */

/** Published onboarding summary (FR-H001) — fields the homepage reads. */
export type HomeOnboardingSummary = {
  summaryText: string;
  structured: {
    majorEvent: { eventId: string; publicSummary: string } | null;
    importance: number;
    characters: Array<{ characterId: string; name: string }>;
    facts: Array<{ factId: string; predicate: string; value: string | number | boolean }>;
    question: string | null;
    recommendedEpisode: { episodeNumber: number; worldDay: number } | null;
  };
};

/** Published world projection (§13.1) — fields the homepage reads. */
export type HomeWorldProjection = {
  name: string | null;
  currentWorldDay: number | null;
  currentTimeSlot: string | null;
};

/** Published live-state projection (FR-I002) — fields the homepage reads. */
export type HomeLiveProjection = {
  worldTime: { worldDay: number; timeSlot: string } | null;
};

/** Bounded newcomer disclosure (UX-002): at most four core characters. */
export const HOME_MAX_CHARACTERS = 4;
/** Bounded newcomer disclosure (UX-002): at most three essential facts. */
export const HOME_MAX_FACTS = 3;

/**
 * Resolve the public world from the `#home/<worldId>` hash route. Returns null
 * for a bare `#home` or any non-matching hash so the component can render a
 * format hint instead of guessing a world.
 */
export function parseHomeRoute(hash: string): { worldId: string } | null {
  const stripped = hash.replace(/^#/, '');
  const match = stripped.match(/^home\/([^/]+)$/);
  if (!match) return null;
  const worldId = decodeURIComponent(match[1]);
  return worldId.length > 0 ? { worldId } : null;
}

export type HomepageViewModel = {
  worldName: string;
  worldDay: string;
  timeSlot: string;
  /** Latest major event — prioritised in the first viewport (UX-001/AC#2). */
  majorEvent: string | null;
  /** ~30-second current-situation summary (UX-003 first layer). */
  currentSituation: string;
  /** ≤ {@link HOME_MAX_CHARACTERS} core characters (UX-002/AC#4). */
  characters: Array<{ characterId: string; name: string }>;
  /** ≤ {@link HOME_MAX_FACTS} essential facts, formatted as `predicate:value`. */
  facts: Array<{ factId: string; label: string }>;
  /** Recommended entry episode + its deep-link, or null (UX-002/AC#4). */
  recommendedEpisode: { episodeNumber: number; worldDay: number; href: string } | null;
  /** Live world time, or null when the live model is unpublished (AC#5). */
  live: { worldDay: number; timeSlot: string } | null;
  /** Voting is not yet an active capability (ART-45) — always false here (AC#5). */
  voteAvailable: boolean;
};

const PLACEHOLDER_WORLD_NAME = '這個世界';
const EM_DASH = '—';
const NO_SITUATION = '摘要尚不可用。';

/**
 * Compose the homepage render model from the three published projections,
 * applying the bounded-disclosure and graceful-fallback rules (AC#2/#4/#5).
 * Every field degrades to a safe placeholder when its source model is null, so
 * a missing or withheld projection never breaks the P0 homepage.
 */
export function composeHomepageViewModel(input: {
  worldId: string;
  summary: HomeOnboardingSummary | null;
  world: HomeWorldProjection | null;
  live: HomeLiveProjection | null;
}): HomepageViewModel {
  const summary = input.summary;
  const structured = summary?.structured;

  const recommendedEpisode = structured?.recommendedEpisode ?? null;
  const recommended = recommendedEpisode
    ? {
        episodeNumber: recommendedEpisode.episodeNumber,
        worldDay: recommendedEpisode.worldDay,
        href: `#episode/${input.worldId}/${recommendedEpisode.worldDay}`,
      }
    : null;

  const liveTime = input.live?.worldTime ?? null;

  return {
    worldName: input.world?.name ?? PLACEHOLDER_WORLD_NAME,
    worldDay: input.world?.currentWorldDay != null ? String(input.world.currentWorldDay) : EM_DASH,
    timeSlot: input.world?.currentTimeSlot ?? EM_DASH,
    majorEvent: structured?.majorEvent?.publicSummary ?? null,
    currentSituation: summary?.summaryText ?? NO_SITUATION,
    characters: (structured?.characters ?? []).slice(0, HOME_MAX_CHARACTERS).map((character) => ({
      characterId: character.characterId,
      name: character.name,
    })),
    facts: (structured?.facts ?? []).slice(0, HOME_MAX_FACTS).map((fact) => ({
      factId: fact.factId,
      label: `${fact.predicate}:${String(fact.value)}`,
    })),
    recommendedEpisode: recommended,
    live: liveTime ? { worldDay: liveTime.worldDay, timeSlot: liveTime.timeSlot } : null,
    voteAvailable: false,
  };
}
