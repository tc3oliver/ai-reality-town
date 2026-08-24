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
 *
 * The live hrefs are built here rather than in the component because they depend
 * on the deployment base path, which is `import.meta.env.BASE_URL` — an
 * expression Vite inlines at build time and Jest cannot see. Passing it in keeps
 * the accessibility suite able to render the real markup (ART-118 / FR-O001 AC#8).
 */

import { MISTWOOD_CHARACTER_VISUALS } from '../../../data/mistwoodCharacters';
import { liveMapHref, textLiveHref } from '../live/liveMapRoute';

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
export type HomeArc = { arcId: string; title: string; currentQuestion: string; status: string };

export type HomeLiveProjection = {
  worldTime: { worldDay: number; timeSlot: string } | null;
  /**
   * ART-129 reads two more fields of the SAME published model the homepage already fetched, so
   * the first screen costs no additional query. Both are optional and both are checked with
   * `Array.isArray` rather than `?? []`: the payload is an untyped published model, and a
   * malformed one must degrade the first screen rather than blank the homepage.
   */
  activeArcs?: HomeArc[];
  activeScenes?: Array<{ title: string; summary: string; sceneId?: string }>;
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
  /**
   * ≤ {@link HOME_MAX_CHARACTERS} core characters (UX-002/AC#4).
   *
   * ART-129 added `href` and `spriteKey`: AC#5 requires a character to be clickable through to
   * their page, and AC#4 requires them drawn with their existing visual binding. The sprite key
   * is resolved here rather than in the component so the whole first screen stays a pure model.
   */
  characters: Array<{ characterId: string; name: string; href: string; spriteKey: string | undefined }>;
  /** ≤ {@link HOME_MAX_FACTS} essential facts, formatted as `predicate:value`. */
  facts: Array<{ factId: string; label: string }>;
  /** Recommended entry episode + its deep-link, or null (UX-002/AC#4). */
  recommendedEpisode: { episodeNumber: number; worldDay: number; href: string } | null;
  /** Live world time, or null when the live model is unpublished (AC#5). */
  live: { worldDay: number; timeSlot: string } | null;
  /** The animated live map (FR-O001). */
  liveMapHref: string;
  /** Its non-map equivalent, which the homepage must also link (NFR-009 AC#3). */
  textLiveHref: string;
  /** Voting is not yet an active capability (ART-45) — always false here (AC#5). */
  voteAvailable: boolean;
  /**
   * The story arc the first screen leads with (FR-P001 / ART-129 AC#2), or null.
   *
   * Chosen with the SAME ordering the live overlay uses (`STORY_ARC_STATUS_PRIORITY`, imported
   * rather than restated) so the homepage and the map cannot disagree about which arc is the
   * primary one — two surfaces naming different arcs as "the" story is worse than either naming
   * none.
   */
  primaryArc: { arcId: string; title: string; currentQuestion: string; statusLabel: string; href: string } | null;
  /** The active scenes the live projection publishes, as first-screen links (AC#5). */
  activeScenes: Array<{ key: string; title: string; summary: string; href: string }>;
};

/**
 * Which arc leads the first screen, and what its state is called.
 *
 * RESTATED from `components/live/storyOverlayModel.ts` rather than imported: `clientPublic` may
 * not depend on `clientLive`, and the reverse edge already exists, so importing would be a cycle.
 * A restatement that drifts would be worse than the duplication — the homepage and the live
 * overlay would name different arcs as "the" story, which is worse than either naming none — so
 * `homeRoute.test.ts` reads the other module's source and asserts both tables match it.
 */
export const HOME_ARC_STATUS_PRIORITY: readonly string[] = [
  'climax',
  'escalating',
  'active',
  'resolving',
];

const HOME_ARC_STATUS_LABELS: Readonly<Record<string, string>> = {
  climax: '高潮',
  escalating: '升溫中',
  active: '進行中',
  resolving: '收束中',
};

/**
 * The primary arc, or `null`.
 *
 * Deterministic and total: ranked by {@link HOME_ARC_STATUS_PRIORITY}, ties broken by `arcId`, and
 * an unknown status ranks last but stays eligible — so a lifecycle stage added later degrades to
 * "sorted last" rather than to "disappears from the homepage".
 */
function pickPrimaryArc(arcs: readonly HomeArc[]): HomeArc | null {
  const rank = (status: string) => {
    const index = HOME_ARC_STATUS_PRIORITY.indexOf(status);
    return index === -1 ? HOME_ARC_STATUS_PRIORITY.length : index;
  };
  return [...arcs].sort((a, b) => rank(a.status) - rank(b.status) || a.arcId.localeCompare(b.arcId))[0] ?? null;
}

/** At most this many scenes lead the first screen; the rest are the live surface's job. */
export const HOME_MAX_SCENES = 2;

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
  /** Deployment path prefix (`import.meta.env.BASE_URL`). */
  base: string;
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
  const live = input.live ?? null;

  return {
    worldName: input.world?.name ?? PLACEHOLDER_WORLD_NAME,
    worldDay: input.world?.currentWorldDay != null ? String(input.world.currentWorldDay) : EM_DASH,
    timeSlot: input.world?.currentTimeSlot ?? EM_DASH,
    majorEvent: structured?.majorEvent?.publicSummary ?? null,
    currentSituation: summary?.summaryText ?? NO_SITUATION,
    characters: (structured?.characters ?? []).slice(0, HOME_MAX_CHARACTERS).map((character) => ({
      characterId: character.characterId,
      name: character.name,
      // AC#5 — clickable through to their page. Same shape every other surface links with.
      href: `#character/${input.worldId}/${character.characterId}`,
      // AC#4 — the binding the live map draws them with, resolved here so the first screen stays
      // a pure model. `undefined` for a character with no binding, which renders nothing rather
      // than borrowing another resident's appearance.
      // The BASE sprite key, not `mistwoodCharacterSpriteKeys` — that table maps to an ASSET
      // key, which for a palette variant is suffixed (`f6:mistwood-indigo-hair`) and is not a
      // sprite key at all. The homepage draws the base cell (see `CharacterSprite`), so it needs
      // the binding's own `spriteKey`.
      spriteKey: MISTWOOD_CHARACTER_VISUALS
        .find((visual) => visual.characterId === character.characterId)?.spriteKey,
    })),
    facts: (structured?.facts ?? []).slice(0, HOME_MAX_FACTS).map((fact) => ({
      factId: fact.factId,
      label: `${fact.predicate}:${String(fact.value)}`,
    })),
    recommendedEpisode: recommended,
    live: liveTime ? { worldDay: liveTime.worldDay, timeSlot: liveTime.timeSlot } : null,
    liveMapHref: liveMapHref(input.worldId, input.base),
    textLiveHref: textLiveHref(input.worldId, input.base),
    voteAvailable: false,
    primaryArc: (() => {
      const arc = pickPrimaryArc(Array.isArray(live?.activeArcs) ? (live?.activeArcs ?? []) : []);
      if (arc === null) return null;
      return {
        arcId: arc.arcId,
        title: arc.title,
        currentQuestion: arc.currentQuestion,
        statusLabel: HOME_ARC_STATUS_LABELS[arc.status] ?? arc.status,
        href: `#arc/${input.worldId}/${arc.arcId}`,
      };
    })(),
    activeScenes: (Array.isArray(live?.activeScenes) ? (live?.activeScenes ?? []) : [])
      .slice(0, HOME_MAX_SCENES)
      .map((scene, index) => ({
        key: scene.sceneId ?? `${index}`,
        title: scene.title,
        summary: scene.summary,
        // A scene's page IS the day's Episode; the map link belongs to the live surface, which
        // the first screen already offers as its lead entry point.
        href: `#episode/${input.worldId}/${liveTime?.worldDay ?? input.world?.currentWorldDay ?? 0}`,
      })),
  };
}
